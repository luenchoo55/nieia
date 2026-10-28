import { ObjectId } from "mongodb";
import { withDb, ensureIndexes, cachedJson, purgeCached } from "./db.js";
import { requireAdmin, sameOrigin } from "./auth.js";
import { notifyMarketTicket } from "./notify.js";

// 擺攤模式：設定存在 settings 的 "market" 文件，排隊號碼存在 tickets
const KEY = "market";
const MAX_ACTIVE_PER_IP = 3;
const PUBLIC_TTL = 10; // 前台資料超過 10 秒，就在背景重新查一次資料庫

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const ip = (c) => c.req.header("cf-connecting-ip") || "local";

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const DEFAULTS = {
  active: false,
  accepting: true,
  location: "",
  address: "",
  hours: "",
  note: "",
  minutesPer: 15,
  services: [],
  currency: "TWD", // 所有現場項目共用的幣別：TWD 台幣、MYR 馬幣
  showProducts: true, // 排隊頁顯示聖照選物的商品（只能看，不能下單）
  sessionId: null,
  nextNumber: 1,
};

async function getMarket(db) {
  const doc = await db.collection("settings").findOne({ _id: KEY });
  const m = { ...DEFAULTS, ...(doc || {}) };
  m.currency = m.currency === "MYR" ? "MYR" : "TWD";
  m.services = parseServices(m.services, m.currency); // 價格文字依目前的幣別重新產生，改幣別時所有項目一起改
  return m;
}

// 價格：每個項目各存台幣與馬幣價格（或「隨喜」），排隊頁顯示哪一個由擺攤設定的幣別決定；
// price 是顯示用的文字，排隊頁、通知信、擺攤紀錄都用它
const amountOf = (v) => {
  const n = Number(v);
  return v !== "" && v != null && Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};
function parsePrice(s, currency) {
  let free = s.free === true;
  let twd = s.twd;
  let myr = s.myr;
  if (s.twd == null && s.myr == null && s.amount != null) {
    // 舊格式：只有一個金額，幣別跟著擺攤設定
    if (currency === "MYR") myr = s.amount;
    else twd = s.amount;
  } else if (s.free == null && s.twd == null && s.myr == null) {
    // 更舊的資料只有文字，例如「NT$200」「RM 30」「隨喜」「300」
    const text = String(s.price || "");
    const num = (text.replace(/,/g, "").match(/\d+/) || [])[0];
    free = /隨喜/.test(text);
    if (/RM|MYR|馬幣/i.test(text)) myr = num;
    else twd = num;
  }
  twd = free ? null : amountOf(twd);
  myr = free ? null : amountOf(myr);
  const amount = currency === "MYR" ? myr : twd;
  const price = free ? "隨喜" : amount == null ? "" : (currency === "MYR" ? "RM " : "NT$") + amount.toLocaleString("en-US");
  return { free, twd, myr, price };
}

// 現場項目：名稱、分鐘、價格、說明（也相容舊的「名稱｜價格」文字格式）
function parseServices(input, currency) {
  const list = Array.isArray(input) ? input : String(input || "").split("\n");
  return list
    .map((item) => {
      if (typeof item === "string") {
        const [name, price] = item.split(/[｜|]/);
        return { name, price };
      }
      return item || {};
    })
    .map((s) => {
      const minutes = Number(s.minutes);
      return {
        name: str(s.name, 40),
        minutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : null,
        ...parsePrice(s, currency),
        desc: str(s.desc, 500),
      };
    })
    .filter((s) => s.name)
    .slice(0, 20);
}

// 依每位客人選的項目估算時間；沒選項目或項目沒填分鐘時，用「每位大約幾分鐘」
function minutesFor(m, ticket) {
  const s = (m.services || []).find((x) => x.name === ticket.service);
  return (s && s.minutes) || m.minutesPer || 15;
}
const sumMinutes = (m, tickets) => tickets.reduce((n, t) => n + minutesFor(m, t), 0);

async function queueState(db, m) {
  if (!m.sessionId) return { serving: null, waiting: 0 };
  const tickets = db.collection("tickets");
  const [serving] = await tickets.find({ sessionId: m.sessionId, status: "serving" }).sort({ number: -1 }).limit(1).toArray();
  const waitingList = await tickets.find({ sessionId: m.sessionId, status: "waiting" }).sort({ number: 1 }).limit(500).toArray();
  return { serving: serving ? serving.number : null, waiting: waitingList.length, estMinutes: sumMinutes(m, waitingList) };
}

function publicMarket(m, q) {
  if (!m.active) return { active: false };
  return {
    active: true,
    accepting: m.accepting,
    location: m.location,
    address: m.address,
    hours: m.hours,
    note: m.note,
    minutesPer: m.minutesPer,
    services: m.services,
    currency: m.currency,
    showProducts: m.showProducts !== false,
    serving: q.serving,
    waiting: q.waiting,
    estMinutes: q.estMinutes || 0,
  };
}

const purge = (c) => purgeCached(c, "/api/market");

export function mountMarket(app) {
  // ---------- 前台：擺攤狀態（首頁提醒與排隊頁共用） ----------
  app.get("/api/market", (c) =>
    cachedJson(c, "/api/market", PUBLIC_TTL, async (db) => {
      const m = await getMarket(db);
      return { ok: true, market: publicMarket(m, await queueState(db, m)) };
    })
  );

  // ---------- 前台：取號 ----------
  app.post("/api/market/tickets", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從排隊頁取號。", 403);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    if (body.website) return bad(c, "取號失敗，請再試一次。");
    const name = str(body.name, 20);
    const phone = str(body.phone, 20).replace(/[\s-]/g, "");
    const service = str(body.service, 40);
    if (!name) return bad(c, "請填寫名字或暱稱，叫號時會用到。");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) return bad(c, "電話號碼格式不正確，請只填數字，也可以留空。");

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const m = await getMarket(db);
      if (!m.active) return bad(c, "目前沒有在擺攤喔。", 409);
      if (!m.accepting) return bad(c, "目前暫停取號，請稍後再試，或直接到攤位詢問。", 409);
      if (service && m.services.length && !m.services.some((s) => s.name === service)) return bad(c, "請重新選擇想做的項目。");

      const tickets = db.collection("tickets");
      const mine = await tickets.countDocuments({ sessionId: m.sessionId, ip: ip(c), status: { $in: ["waiting", "serving"] } });
      if (mine >= MAX_ACTIVE_PER_IP) return bad(c, "這支手機已經取了好幾個號碼，請等叫號後再取。", 429);

      // 用 $inc 原子性地拿下一個號碼，兩個人同時取號也不會重複
      const counter = await db.collection("settings").findOneAndUpdate(
        { _id: KEY, sessionId: m.sessionId },
        { $inc: { nextNumber: 1 } },
        { returnDocument: "before" }
      );
      const prev = counter && (counter.value !== undefined ? counter.value : counter);
      if (!prev) return bad(c, "擺攤剛剛結束了。", 409);
      const number = prev.nextNumber || 1;

      // 記下取號當時的價格，之後改了項目價格，擺攤紀錄也不會跟著變
      const price = (m.services.find((s) => s.name === service) || {}).price || "";
      const ticket = {
        sessionId: m.sessionId, number, name, phone, service, price,
        status: "waiting", token: newToken(), ip: ip(c), createdAt: new Date(),
      };
      const res = await tickets.insertOne(ticket);
      purge(c);
      const aheadList = await tickets.find({ sessionId: m.sessionId, status: "waiting", number: { $lt: number } }).limit(500).toArray();
      notifyMarketTicket(c, m, ticket, aheadList.length);
      return c.json({ ok: true, ticket: { id: res.insertedId.toString(), token: ticket.token, number, name, service, status: "waiting", ahead: aheadList.length, estMinutes: sumMinutes(m, aheadList) } });
    });
  });

  async function ownTicket(c, db) {
    const id = c.req.param("id");
    const t = c.req.query("t") || "";
    if (!ObjectId.isValid(id) || !t) return null;
    const ticket = await db.collection("tickets").findOne({ _id: new ObjectId(id) });
    return ticket && ticket.token === t ? ticket : null;
  }

  // ---------- 前台：查看自己的號碼 ----------
  app.get("/api/market/tickets/:id", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const t = await ownTicket(c, db);
      if (!t) return bad(c, "找不到這個號碼。", 404);
      const m = await getMarket(db);
      const sameSession = m.active && m.sessionId === t.sessionId;
      const aheadList = t.status === "waiting"
        ? await db.collection("tickets").find({ sessionId: t.sessionId, status: "waiting", number: { $lt: t.number } }).limit(500).toArray()
        : [];
      const ahead = aheadList.length;
      const q = sameSession ? await queueState(db, m) : { serving: null };
      return c.json({
        ok: true,
        ticket: {
          id: t._id.toString(), number: t.number, name: t.name, service: t.service,
          status: sameSession ? t.status : (t.status === "waiting" || t.status === "serving" ? "ended" : t.status),
          ahead, estMinutes: sumMinutes(m, aheadList), serving: q.serving,
        },
      });
    })
  );

  // ---------- 前台：取消自己的號碼 ----------
  app.post("/api/market/tickets/:id/cancel", (c) => {
    if (!sameOrigin(c)) return bad(c, "請從排隊頁操作。", 403);
    return withDb(c.env, c.executionCtx, async (db) => {
      const t = await ownTicket(c, db);
      if (!t) return bad(c, "找不到這個號碼。", 404);
      if (t.status !== "waiting") return bad(c, "這個號碼已經不在等候中了。", 409);
      await db.collection("tickets").updateOne({ _id: t._id }, { $set: { status: "cancelled", doneAt: new Date() } });
      purge(c);
      return c.json({ ok: true });
    });
  });

  // ---------- 後台 ----------
  app.use("/api/admin/market", requireAdmin);
  app.use("/api/admin/market/*", requireAdmin);

  async function adminState(db) {
    const m = await getMarket(db);
    const list = m.sessionId
      ? await db.collection("tickets").find({ sessionId: m.sessionId }).sort({ number: 1 }).limit(500).toArray()
      : [];
    return {
      ok: true,
      market: {
        active: m.active, accepting: m.accepting, location: m.location, address: m.address,
        hours: m.hours, note: m.note, minutesPer: m.minutesPer, services: m.services, currency: m.currency, showProducts: m.showProducts !== false, startedAt: m.startedAt || null,
      },
      tickets: list.map(({ _id, token, ip: _ip, sessionId, ...t }) => ({ id: _id.toString(), ...t })),
    };
  }

  app.get("/api/admin/market", (c) => withDb(c.env, c.executionCtx, async (db) => c.json(await adminState(db))));

  // 儲存擺攤資訊（地點、時間、項目）
  app.put("/api/admin/market", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const minutes = Number(body.minutesPer);
    const set = {
      location: str(body.location, 60),
      address: str(body.address, 120),
      hours: str(body.hours, 60),
      note: str(body.note, 300),
      minutesPer: Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : 15,
      currency: body.currency === "MYR" ? "MYR" : "TWD",
      services: parseServices(body.services, body.currency),
      showProducts: body.showProducts !== false,
    };
    return withDb(c.env, c.executionCtx, async (db) => {
      await db.collection("settings").updateOne({ _id: KEY }, { $set: set }, { upsert: true });
      purge(c);
      return c.json(await adminState(db));
    });
  });

  app.post("/api/admin/market/start", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const m = await getMarket(db);
      if (!m.location) return bad(c, "請先填寫擺攤地點並儲存。");
      if (m.active) return c.json(await adminState(db));
      const sessionId = new ObjectId().toString();
      const startedAt = new Date();
      await db.collection("settings").updateOne(
        { _id: KEY },
        { $set: { active: true, accepting: true, sessionId, nextNumber: 1, startedAt } },
        { upsert: true }
      );
      // 每一場存一筆紀錄，下一場改了地點也不會蓋掉
      await db.collection("marketSessions").insertOne({
        _id: sessionId, location: m.location, address: m.address, hours: m.hours, services: m.services, startedAt,
      });
      purge(c);
      return c.json(await adminState(db));
    })
  );

  app.post("/api/admin/market/end", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const m = await getMarket(db);
      const endedAt = new Date();
      await db.collection("settings").updateOne({ _id: KEY }, { $set: { active: false, endedAt } }, { upsert: true });
      if (m.active && m.sessionId) await db.collection("marketSessions").updateOne({ _id: m.sessionId }, { $set: { endedAt } });
      purge(c);
      return c.json(await adminState(db));
    })
  );

  app.post("/api/admin/market/accepting", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    return withDb(c.env, c.executionCtx, async (db) => {
      await db.collection("settings").updateOne({ _id: KEY }, { $set: { accepting: Boolean(body.accepting) } }, { upsert: true });
      purge(c);
      return c.json(await adminState(db));
    });
  });

  // 叫下一位：正在服務的人標記完成，號碼最小的等候者改為服務中
  app.post("/api/admin/market/next", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const m = await getMarket(db);
      if (!m.active) return bad(c, "目前沒有在擺攤。", 409);
      const tickets = db.collection("tickets");
      const now = new Date();
      const serving = await tickets.find({ sessionId: m.sessionId, status: "serving" }).toArray();
      for (const t of serving) await tickets.updateOne({ _id: t._id }, { $set: { status: "done", doneAt: now } });
      const [next] = await tickets.find({ sessionId: m.sessionId, status: "waiting" }).sort({ number: 1 }).limit(1).toArray();
      if (next) await tickets.updateOne({ _id: next._id }, { $set: { status: "serving", calledAt: now } });
      purge(c);
      const state = await adminState(db);
      return c.json({ ...state, called: next ? next.number : null });
    })
  );

  // 單一號碼：改為服務中、完成、過號或取消
  app.patch("/api/admin/market/tickets/:id", async (c) => {
    const id = ObjectId.isValid(c.req.param("id")) ? new ObjectId(c.req.param("id")) : null;
    if (!id) return bad(c, "找不到這個號碼。", 404);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const status = body.status;
    if (!["waiting", "serving", "done", "skipped", "cancelled"].includes(status)) return bad(c, "狀態不正確。");
    return withDb(c.env, c.executionCtx, async (db) => {
      const tickets = db.collection("tickets");
      const t = await tickets.findOne({ _id: id });
      if (!t) return bad(c, "找不到這個號碼。", 404);
      const now = new Date();
      if (status === "serving") {
        // 同一時間只服務一位
        const others = await tickets.find({ sessionId: t.sessionId, status: "serving" }).toArray();
        for (const o of others) if (!o._id.equals(id)) await tickets.updateOne({ _id: o._id }, { $set: { status: "done", doneAt: now } });
      }
      const set = { status };
      if (status === "serving") set.calledAt = now;
      if (["done", "skipped", "cancelled"].includes(status)) set.doneAt = now;
      await tickets.updateOne({ _id: id }, { $set: set });
      purge(c);
      return c.json(await adminState(db));
    });
  });

  // ---------- 擺攤紀錄 ----------
  // 舊的場次（加上紀錄功能之前）沒有 marketSessions 文件，從號碼本身推算日期；最後一場用目前的擺攤設定補上地點
  async function sessionList(db) {
    const m = await getMarket(db);
    const [docs, groups] = await Promise.all([
      db.collection("marketSessions").find({}).toArray(),
      db.collection("tickets").aggregate([
        { $group: { _id: "$sessionId", total: { $sum: 1 }, statuses: { $push: "$status" }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" }, lastDone: { $max: "$doneAt" } } },
      ]).toArray(),
    ]);
    const byId = new Map(docs.map((d) => [d._id, d]));
    const ids = new Set([...docs.map((d) => d._id), ...groups.map((g) => g._id).filter(Boolean)]);
    const counts = new Map(groups.map((g) => [g._id, g]));
    return [...ids].map((id) => {
      const d = byId.get(id) || (id === m.sessionId ? { location: m.location, address: m.address, startedAt: m.startedAt, endedAt: m.active ? null : m.endedAt } : {});
      const g = counts.get(id) || { total: 0, statuses: [] };
      const n = (s) => g.statuses.filter((x) => x === s).length;
      return {
        id,
        location: d.location || "",
        address: d.address || "",
        startedAt: d.startedAt || g.first || null,
        endedAt: d.endedAt || (id === m.sessionId && m.active ? null : g.lastDone || g.last || null),
        current: Boolean(m.active && id === m.sessionId),
        total: g.total, done: n("done"), skipped: n("skipped"), cancelled: n("cancelled"),
      };
    }).sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  }

  app.get("/api/admin/market/history", (c) =>
    withDb(c.env, c.executionCtx, async (db) => c.json({ ok: true, sessions: await sessionList(db) }))
  );

  app.get("/api/admin/market/history/:sid", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const sid = c.req.param("sid");
      const list = await db.collection("tickets").find({ sessionId: sid }).sort({ number: 1 }).toArray();
      return c.json({
        ok: true,
        tickets: list.map(({ _id, token, ip: _ip, sessionId, ...t }) => ({ id: _id.toString(), ...t })),
      });
    })
  );

  app.delete("/api/admin/market/history/:sid", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const sid = c.req.param("sid");
      const m = await getMarket(db);
      if (m.active && m.sessionId === sid) return bad(c, "這一場還在擺攤中，請先結束擺攤再刪除。", 409);
      const res = await db.collection("tickets").deleteMany({ sessionId: sid });
      await db.collection("marketSessions").deleteOne({ _id: sid });
      return c.json({ ok: true, deleted: res.deletedCount, sessions: await sessionList(db) });
    })
  );
}
