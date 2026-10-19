import { ObjectId } from "mongodb";
import { withDb, ensureIndexes } from "./db.js";
import { requireAdmin, sameOrigin } from "./auth.js";

// 擺攤模式：設定存在 settings 的 "market" 文件，排隊號碼存在 tickets
const KEY = "market";
const MAX_ACTIVE_PER_IP = 3;
const PUBLIC_TTL = 10; // 前台每 10 秒最多查一次資料庫

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
  sessionId: null,
  nextNumber: 1,
};

async function getMarket(db) {
  const doc = await db.collection("settings").findOne({ _id: KEY });
  return { ...DEFAULTS, ...(doc || {}) };
}

// 現場項目：名稱、分鐘、價格、說明（也相容舊的「名稱｜價格」文字格式）
function parseServices(input) {
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
        price: str(s.price, 30),
        desc: str(s.desc, 120),
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
    serving: q.serving,
    waiting: q.waiting,
    estMinutes: q.estMinutes || 0,
  };
}

const edgeCache = () => (typeof caches !== "undefined" ? caches.default : null);
function purge(c) {
  const cache = edgeCache();
  if (cache) c.executionCtx.waitUntil(cache.delete(new Request(new URL("/api/market", c.req.url).toString())));
}

export function mountMarket(app) {
  // ---------- 前台：擺攤狀態（首頁提醒與排隊頁共用） ----------
  app.get("/api/market", async (c) => {
    const cache = edgeCache();
    const key = new Request(new URL("/api/market", c.req.url).toString());
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: { "content-type": "application/json; charset=UTF-8" } });
    }
    return withDb(c.env, c.executionCtx, async (db) => {
      const m = await getMarket(db);
      const body = JSON.stringify({ ok: true, market: publicMarket(m, await queueState(db, m)) });
      if (cache) {
        c.executionCtx.waitUntil(cache.put(key, new Response(body, {
          headers: { "content-type": "application/json; charset=UTF-8", "cache-control": `public, max-age=${PUBLIC_TTL}` },
        })));
      }
      return new Response(body, { headers: { "content-type": "application/json; charset=UTF-8" } });
    });
  });

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

      const ticket = {
        sessionId: m.sessionId, number, name, phone, service,
        status: "waiting", token: newToken(), ip: ip(c), createdAt: new Date(),
      };
      const res = await tickets.insertOne(ticket);
      purge(c);
      const aheadList = await tickets.find({ sessionId: m.sessionId, status: "waiting", number: { $lt: number } }).limit(500).toArray();
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
        hours: m.hours, note: m.note, minutesPer: m.minutesPer, services: m.services, startedAt: m.startedAt || null,
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
      services: parseServices(body.services),
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
      await db.collection("settings").updateOne(
        { _id: KEY },
        { $set: { active: true, accepting: true, sessionId: new ObjectId().toString(), nextNumber: 1, startedAt: new Date() } },
        { upsert: true }
      );
      purge(c);
      return c.json(await adminState(db));
    })
  );

  app.post("/api/admin/market/end", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      await db.collection("settings").updateOne({ _id: KEY }, { $set: { active: false, endedAt: new Date() } }, { upsert: true });
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
}
