import { ObjectId } from "mongodb";
import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";

// 收支記帳：預約、工作坊、擺攤的收入每次查詢時即時從原始資料算出來（改了預約，報表就跟著變）；
// 支出與其他收入（例如商品賣出）手動新增，存在 ledger。新台幣與馬幣分開計算，不換算。

const CURRENCIES = ["TWD", "MYR"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
export const PRODUCT_CATEGORY = "商品";

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const oid = (v) => (ObjectId.isValid(v) ? new ObjectId(v) : null);
// 台灣／馬來西亞時間（UTC+8）的日期
export const twDate = (d) => new Date(new Date(d).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
export const todayLocal = () => twDate(Date.now());

export function money(amount, currency) {
  return (currency === "MYR" ? "RM " : "NT$") + Number(amount).toLocaleString("en-US");
}
export function cleanAmount(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10000000 ? n : undefined;
}

// 擺攤號碼存的是價格文字（例如「NT$300」「RM 30」「隨喜」），換回金額與幣別
export function ticketPrice(text) {
  const s = String(text || "");
  if (/隨喜/.test(s)) return { free: true };
  const num = (s.replace(/,/g, "").match(/\d+/) || [])[0];
  if (!num) return { unknown: true };
  return { amount: Number(num), currency: /RM|MYR|馬幣/i.test(s) ? "MYR" : "TWD" };
}

// 預約的實收金額：確認收款時填的 paidAmount，沒填就用預約時的固定價格
export const bookingPaid = (b) => (b.paidAmount != null ? b.paidAmount : b.amount ?? null);

// 所有收入與支出明細。每筆：{ date, type, source, category, currency, amount, label, ref }
// amount 為 null 代表金額還沒填（例如隨喜預約），報表會另外列出提醒補上
export async function ledgerEntries(db) {
  const [bookings, workshops, tickets, sessions, marketExtra, manual] = await Promise.all([
    db.collection("bookings").find({ status: "confirmed" }, { projection: { token: 0, ip: 0 } }).toArray(),
    db.collection("workshops").find({}, { projection: { title: 1, sessions: 1, "attendees.id": 1, "attendees.name": 1, "attendees.email": 1, "attendees.tuition": 1, "attendees.material": 1 } }).toArray(),
    db.collection("tickets").find({ status: "done" }, { projection: { sessionId: 1, price: 1, createdAt: 1 } }).toArray(),
    db.collection("marketSessions").find({}, { projection: { location: 1, startedAt: 1 } }).toArray(),
    db.collection("marketIncome").find({}).toArray(),
    db.collection("ledger").find({}).toArray(),
  ]);
  const out = [];

  for (const b of bookings) {
    out.push({
      date: twDate(b.confirmedAt || b.updatedAt || b.startAt),
      type: "income", source: "booking", category: "療癒預約",
      currency: b.currency, amount: bookingPaid(b),
      label: `${b.name}｜${b.serviceName}｜${b.date}`,
      ref: b._id.toString(),
    });
  }

  for (const w of workshops) {
    for (const a of w.attendees || []) {
      for (const [field, category] of [["tuition", "工作坊學費"], ["material", "工作坊教材費"]]) {
        const p = a[field];
        if (!p || !p.paidAt) continue;
        out.push({
          date: twDate(p.paidAt), type: "income", source: "workshop", category,
          currency: p.currency, amount: p.amount,
          label: `${a.name}｜${w.title}`, ref: w._id.toString(),
        });
      }
    }
  }

  // 擺攤：每一場、每種幣別合計一筆；隨喜的號碼另外看有沒有填實收
  const sessionInfo = new Map(sessions.map((s) => [s._id, s]));
  const extraBy = new Map(marketExtra.map((x) => [x._id, x]));
  const bySession = new Map();
  for (const t of tickets) {
    const g = bySession.get(t.sessionId) || { first: t.createdAt, sums: {}, free: 0, unknown: 0, count: 0 };
    if (t.createdAt < g.first) g.first = t.createdAt;
    const p = ticketPrice(t.price);
    if (p.free) g.free++;
    else if (p.unknown) g.unknown++;
    else g.sums[p.currency] = (g.sums[p.currency] || 0) + p.amount;
    g.count++;
    bySession.set(t.sessionId, g);
  }
  for (const [sid, g] of bySession) {
    const s = sessionInfo.get(sid) || {};
    const date = twDate(s.startedAt || g.first);
    const label = `擺攤${s.location ? "｜" + s.location : ""}（${g.count} 位）`;
    for (const [currency, amount] of Object.entries(g.sums)) {
      out.push({ date, type: "income", source: "market", category: "擺攤", currency, amount, label, ref: sid });
    }
    const extra = extraBy.get(sid);
    if (extra) {
      out.push({ date, type: "income", source: "market", category: "擺攤隨喜", currency: extra.currency, amount: extra.amount, label: `${label}　隨喜 ${g.free} 位`, ref: sid });
    } else if (g.free || g.unknown) {
      out.push({ date, type: "income", source: "market", category: "擺攤隨喜", currency: Object.keys(g.sums)[0] || "TWD", amount: null, label: `${label}　隨喜／未標價 ${g.free + g.unknown} 位`, ref: sid, freeCount: g.free + g.unknown });
    }
  }

  for (const e of manual) {
    out.push({
      date: e.date, type: e.type, source: "manual", category: e.category,
      currency: e.currency, amount: e.amount,
      label: [e.productName && `${e.productName} × ${e.qty}`, e.note].filter(Boolean).join("｜"),
      ref: e._id.toString(),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function totals(entries) {
  const t = {};
  for (const cur of CURRENCIES) t[cur] = { income: 0, expense: 0 };
  for (const e of entries) {
    if (e.amount == null || !t[e.currency]) continue;
    t[e.currency][e.type] += e.amount;
  }
  for (const cur of CURRENCIES) t[cur].net = t[cur].income - t[cur].expense;
  return t;
}

function byCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.amount == null) continue;
    const k = `${e.type}|${e.category}|${e.currency}`;
    map.set(k, (map.get(k) || 0) + e.amount);
  }
  return [...map].map(([k, amount]) => {
    const [type, category, currency] = k.split("|");
    return { type, category, currency, amount };
  }).sort((a, b) => a.type.localeCompare(b.type) || b.amount - a.amount);
}

export function mountLedger(app) {
  app.use("/api/admin/ledger", requireAdmin);
  app.use("/api/admin/ledger/*", requireAdmin);

  app.get("/api/admin/ledger", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const month = MONTH_RE.test(c.req.query("month") || "") ? c.req.query("month") : todayLocal().slice(0, 7);
      const all = await ledgerEntries(db);
      const entries = all.filter((e) => e.date.startsWith(month));
      // 金額還沒填的收入，不論哪個月都列出來提醒
      const missing = all.filter((e) => e.amount == null);
      const year = month.slice(0, 4);
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        months.push({ month: key, totals: totals(all.filter((e) => e.date.startsWith(key))) });
      }
      return c.json({ ok: true, month, entries, totals: totals(entries), categories: byCategory(entries), missing, year: months });
    })
  );

  // 手動新增收入或支出；選了商品會自動扣庫存
  app.post("/api/admin/ledger", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const type = body.type === "income" ? "income" : body.type === "expense" ? "expense" : null;
    if (!type) return bad(c, "請選擇收入或支出。");
    const date = str(body.date, 10);
    if (!DATE_RE.test(date)) return bad(c, "請選擇日期。");
    const currency = CURRENCIES.includes(body.currency) ? body.currency : null;
    if (!currency) return bad(c, "請選擇幣別。");
    const amount = cleanAmount(body.amount);
    if (amount == null) return bad(c, "請填寫金額（整數）。");
    const category = str(body.category, 20);
    if (!category) return bad(c, "請填寫類別。");
    const doc = { type, date, currency, amount, category, note: str(body.note, 300), createdAt: new Date() };

    return withDb(c.env, c.executionCtx, async (db) => {
      if (type === "income" && body.productId) {
        const pid = oid(body.productId);
        const qty = Number(body.qty);
        if (!pid) return bad(c, "找不到這個商品。", 404);
        if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return bad(c, "數量請填 1 以上的整數。");
        const p = await db.collection("products").findOne({ _id: pid });
        if (!p) return bad(c, "找不到這個商品，可能已經刪除了。", 404);
        Object.assign(doc, { productId: pid, productName: p.name, qty, category: PRODUCT_CATEGORY });
        // 有記庫存的商品才扣
        if (typeof p.stock === "number") {
          await db.collection("products").updateOne({ _id: pid }, { $inc: { stock: -qty }, $set: { updatedAt: new Date() } });
        }
      }
      const r = await db.collection("ledger").insertOne(doc);
      return c.json({ ok: true, id: r.insertedId.toString() });
    });
  });

  // 刪除手動紀錄；商品賣出的紀錄刪掉時，把扣掉的庫存加回去
  app.delete("/api/admin/ledger/:id", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const id = oid(c.req.param("id"));
      const e = id && (await db.collection("ledger").findOne({ _id: id }));
      if (!e) return c.json({ ok: true });
      await db.collection("ledger").deleteOne({ _id: id });
      if (e.productId && e.qty) {
        await db.collection("products").updateOne({ _id: e.productId, stock: { $type: "number" } }, { $inc: { stock: e.qty } });
      }
      return c.json({ ok: true });
    })
  );

  // 擺攤隨喜的實收合計（每一場一筆）；金額留空就是清除
  app.put("/api/admin/ledger/market/:sid", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const sid = str(c.req.param("sid"), 40);
    const amount = cleanAmount(body.amount);
    if (amount === undefined) return bad(c, "金額請填整數。");
    const currency = CURRENCIES.includes(body.currency) ? body.currency : "TWD";
    return withDb(c.env, c.executionCtx, async (db) => {
      if (amount == null) await db.collection("marketIncome").deleteOne({ _id: sid });
      else await db.collection("marketIncome").updateOne({ _id: sid }, { $set: { amount, currency, updatedAt: new Date() } }, { upsert: true });
      return c.json({ ok: true });
    });
  });
}
