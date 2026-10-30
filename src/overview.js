import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";
import { ledgerEntries, totals, todayLocal, twDate } from "./ledger.js";

// 後台總覽與打開後台時的提醒，以及「下載全部資料」的備份。

const DEFAULT_LOW_STOCK = 3;
const OLD_DAYS = 90; // 超過 3 個月沒來
const OLD_MIN_VISITS = 2; // 來過至少 2 次才算老客人
const MATERIAL_DAYS = 14; // 課前兩週提醒還沒付教材費

const addDays = (date, n) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const regionCurrency = (r) => (r === "MY" ? "MYR" : "TWD");
const feeFor = (fee, region) => (fee ? fee[region === "MY" ? "myr" : "twd"] ?? null : null);
const tuitionFor = (w, a) => w.prices?.[a.status || "new"]?.[a.region === "MY" ? "myr" : "twd"] ?? null;
export const hasMaterialFee = (w) => w.materialFee && (w.materialFee.twd != null || w.materialFee.myr != null);

// 很久沒來的老客人：把預約（已成立）、工作坊、擺攤（完成）的每一次來訪，
// 依 Email／IG／電話認成同一個人（同一筆資料裡的這幾個視為同一人；都沒有才用姓名），
// 來過至少 2 次、最後一次超過 3 個月的列出來
const norm = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
function keysOf(r) {
  const keys = [];
  const email = norm(r.email);
  const ig = norm(r.instagram).replace(/^@+/, "");
  const phone = String(r.phone || "").replace(/\D/g, "");
  if (email) keys.push("e:" + email);
  if (ig) keys.push("i:" + ig);
  if (phone.length >= 6) keys.push("t:" + phone);
  if (!keys.length && norm(r.name)) keys.push("n:" + norm(r.name));
  return keys;
}

async function oldCustomers(db, today) {
  const [bookings, workshops, tickets, sessions] = await Promise.all([
    db.collection("bookings").find({ status: "confirmed", date: { $lte: today } }, { projection: { name: 1, email: 1, instagram: 1, date: 1 } }).toArray(),
    db.collection("workshops").find({ firstDate: { $lte: today } }, { projection: { firstDate: 1, "attendees.name": 1, "attendees.email": 1, "attendees.instagram": 1 } }).toArray(),
    db.collection("tickets").find({ status: "done" }, { projection: { name: 1, phone: 1, sessionId: 1, createdAt: 1 } }).toArray(),
    db.collection("marketSessions").find({}, { projection: { startedAt: 1 } }).toArray(),
  ]);
  const started = new Map(sessions.map((s) => [s._id, s.startedAt]));
  const visits = [
    ...bookings.map((b) => ({ ...b, date: b.date })),
    ...workshops.flatMap((w) => (w.attendees || []).map((a) => ({ ...a, date: w.firstDate }))),
    ...tickets.map((t) => ({ ...t, date: twDate(started.get(t.sessionId) || t.createdAt) })),
  ].map((v) => ({ ...v, keys: keysOf(v) })).filter((v) => v.keys.length);

  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  for (const v of visits) for (let i = 1; i < v.keys.length; i++) {
    const a = find(v.keys[0]), b = find(v.keys[i]);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const v of visits) {
    const root = find(v.keys[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(v);
  }
  const cutoff = addDays(today, -OLD_DAYS);
  const out = [];
  for (const list of groups.values()) {
    if (list.length < OLD_MIN_VISITS) continue;
    list.sort((a, b) => b.date.localeCompare(a.date));
    if (list[0].date >= cutoff) continue;
    const pick = (f) => (list.find((v) => v[f]) || {})[f] || "";
    out.push({ name: pick("name"), lastVisit: list[0].date, visitCount: list.length, instagram: pick("instagram"), email: pick("email"), phone: pick("phone") });
  }
  return out.sort((a, b) => a.lastVisit.localeCompare(b.lastVisit));
}

function bookingRow(b) {
  return {
    id: b._id.toString(), ref: b.ref, date: b.date, start: b.start, end: b.end, name: b.name,
    serviceName: b.serviceName, status: b.status, mode: b.mode || "remote",
    amount: b.amount, currency: b.currency, priceMode: b.priceMode, paymentReport: b.paymentReport ? { last5: b.paymentReport.last5, paidDate: b.paymentReport.paidDate } : null,
  };
}

async function overview(db) {
  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const [soon, pending, workshops, products, entries, olds] = await Promise.all([
    db.collection("bookings").find({ date: { $in: [today, tomorrow] }, status: { $ne: "cancelled" } }).sort({ date: 1, start: 1 }).toArray(),
    db.collection("bookings").find({ status: { $in: ["pending_payment", "payment_reported"] } }).sort({ startAt: 1 }).limit(200).toArray(),
    db.collection("workshops").find({ firstDate: { $gte: addDays(today, -60) } }).toArray(),
    db.collection("products").find({ stock: { $type: "number" } }).sort({ order: 1 }).toArray(),
    ledgerEntries(db),
    oldCustomers(db, today),
  ]);

  // 還沒結束的工作坊（最後一堂還沒過）
  const active = workshops
    .filter((w) => w.sessions?.length && w.sessions[w.sessions.length - 1].date >= today)
    .sort((a, b) => a.sessions[0].date.localeCompare(b.sessions[0].date));

  const upcoming = active.map((w) => {
    const people = w.attendees || [];
    return {
      id: w._id.toString(), title: w.title, format: w.format, location: w.location || "",
      firstDate: w.sessions[0].date, start: w.sessions[0].start, sessions: w.sessions.length,
      attendees: people.length, capacity: w.capacity || 0,
      unpaidTuition: people.filter((a) => !a.tuition).length,
      unpaidMaterial: hasMaterialFee(w) ? people.filter((a) => !a.material).length : 0,
      started: w.sessions[0].date <= today,
    };
  });

  // 工作坊學費還沒付（還沒結束的場次）
  const pendingTuition = [];
  const materialDue = [];
  for (const w of active) {
    const first = w.sessions[0].date;
    const materialSoon = hasMaterialFee(w) && first <= addDays(today, MATERIAL_DAYS);
    for (const a of w.attendees || []) {
      const base = { workshopId: w._id.toString(), title: w.title, firstDate: first, attendeeId: a.id, name: a.name, region: a.region || null };
      if (!a.tuition) pendingTuition.push({ ...base, amount: tuitionFor(w, a), currency: regionCurrency(a.region) });
      if (materialSoon && !a.material) materialDue.push({ ...base, amount: feeFor(w.materialFee, a.region), currency: regionCurrency(a.region) });
    }
  }

  const lowStock = products
    .filter((p) => p.stock <= (p.lowStock ?? DEFAULT_LOW_STOCK))
    .map((p) => ({ id: p._id.toString(), name: p.name, stock: p.stock, lowStock: p.lowStock ?? DEFAULT_LOW_STOCK, published: p.published !== false }));

  const month = today.slice(0, 7);
  return {
    ok: true,
    today, tomorrow, month,
    bookingsToday: soon.filter((b) => b.date === today).map(bookingRow),
    bookingsTomorrow: soon.filter((b) => b.date === tomorrow).map(bookingRow),
    pendingBookings: pending.map(bookingRow),
    pendingTuition,
    monthTotals: totals(entries.filter((e) => e.date.startsWith(month))),
    missingAmounts: entries.filter((e) => e.amount == null).length,
    upcomingWorkshops: upcoming,
    materialDue,
    lowStock,
    oldCustomers: olds,
  };
}

// ---------- 匯出備份 ----------
// 每個資料表一個工作表。登入紀錄、各種嘗試次數、圖片檔、客人查詢用的 token 與 IP 不匯出。
const SHEETS = [
  ["bookings", "預約"],
  ["availability", "時段"],
  ["services", "療癒項目"],
  ["products", "商品"],
  ["workshops", "工作坊"],
  ["certificates", "證書"],
  ["marketSessions", "擺攤場次"],
  ["tickets", "擺攤號碼"],
  ["marketIncome", "擺攤隨喜實收"],
  ["ledger", "手動收支"],
  ["caseNotes", "個案筆記"],
  ["settings", "設定"],
  ["counters", "編號計數"],
];
const SKIP_FIELDS = new Set(["token", "ip"]);

function flatten(value, prefix, out) {
  if (value == null) { out[prefix] = ""; return; }
  if (value instanceof Date) { out[prefix] = value.toISOString(); return; }
  if (typeof value === "object" && value._bsontype === "ObjectId") { out[prefix] = value.toString(); return; }
  if (Array.isArray(value)) { out[prefix] = JSON.stringify(value); return; }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) { out[prefix] = ""; return; }
    for (const [k, v] of entries) {
      if (SKIP_FIELDS.has(k)) continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  out[prefix] = value;
}

function toRows(docs) {
  const flat = docs.map((d) => { const o = {}; flatten(d, "", o); return o; });
  const cols = [];
  for (const o of flat) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
  return [cols, ...flat.map((o) => cols.map((k) => (o[k] == null ? "" : String(o[k]))))];
}

async function exportAll(db) {
  const sheets = [];
  for (const [name, label] of SHEETS) {
    const docs = await db.collection(name).find({}).toArray();
    if (name === "workshops") {
      // 學員另外一個工作表，一位一列比較好看
      const people = [];
      for (const w of docs) for (const a of w.attendees || []) people.push({ workshopId: w._id, workshop: w.title, ...a });
      sheets.push({ name: label, rows: toRows(docs.map(({ attendees, ...w }) => ({ ...w, attendeeCount: (attendees || []).length }))) });
      sheets.push({ name: "工作坊學員", rows: toRows(people) });
      continue;
    }
    if (name === "settings") {
      sheets.push({ name: label, rows: [["_id", "內容"], ...docs.map((d) => { const { _id, ...rest } = d; return [String(_id), JSON.stringify(rest)]; })] });
      continue;
    }
    sheets.push({ name: label, rows: toRows(docs) });
  }
  // 收入支出明細（含自動帶入的收入）
  const entries = await ledgerEntries(db);
  sheets.push({
    name: "收支明細",
    rows: [["日期", "收入／支出", "來源", "類別", "幣別", "金額", "說明"], ...entries.map((e) => [
      e.date, e.type === "income" ? "收入" : "支出",
      { booking: "預約", workshop: "工作坊", market: "擺攤", manual: "手動" }[e.source] || e.source,
      e.category, e.currency, e.amount == null ? "未填" : String(e.amount), e.label,
    ])],
  });
  return sheets;
}

export function mountOverview(app) {
  app.use("/api/admin/overview", requireAdmin);
  app.use("/api/admin/export", requireAdmin);

  app.get("/api/admin/overview", (c) => withDb(c.env, c.executionCtx, async (db) => c.json(await overview(db))));

  app.get("/api/admin/export", (c) =>
    withDb(c.env, c.executionCtx, async (db) => c.json({ ok: true, exportedAt: new Date().toISOString(), sheets: await exportAll(db) }))
  );
}
