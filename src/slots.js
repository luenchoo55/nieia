import { ObjectId } from "mongodb";
import { withDb, ensureIndexes } from "./db.js";
import { requireAdmin } from "./auth.js";

// 台灣與馬來西亞同為 UTC+8，所有時段都以這個時區記錄
const TZ = "+08:00";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function toInstant(date, time) {
  return new Date(`${date}T${time}:00${TZ}`);
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekday(date) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
function isRealDate(date) {
  return DATE_RE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function present(doc) {
  return {
    id: doc._id.toString(),
    date: doc.date,
    weekday: weekday(doc.date),
    start: doc.start,
    end: doc.end,
    status: doc.status,
  };
}

function bad(c, message, status = 400) {
  return c.json({ ok: false, message }, status);
}

function parseId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export function mountSlots(app) {
  // 公開：預約頁讀取可預約的時段
  app.get("/api/slots", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const docs = await db.collection("availability")
        .find({ status: "open", startAt: { $gt: new Date() } })
        .sort({ startAt: 1 })
        .limit(200)
        .toArray();
      return c.json({ ok: true, slots: docs.map(present) });
    })
  );

  // 以下皆需登入後台
  app.use("/api/admin/slots", requireAdmin);
  app.use("/api/admin/slots/*", requireAdmin);

  app.get("/api/admin/slots", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const from = new Date(Date.now() - 24 * 3600 * 1000);
      const docs = await db.collection("availability")
        .find({ startAt: { $gte: from } })
        .sort({ startAt: 1 })
        .limit(500)
        .toArray();
      return c.json({ ok: true, slots: docs.map(present) });
    })
  );

  app.post("/api/admin/slots", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }

    const date = String(body.date || "");
    const start = String(body.start || "");
    const end = String(body.end || "");
    const weeks = Number.parseInt(body.weeks ?? 1, 10);

    if (!isRealDate(date)) return bad(c, "請選擇正確的日期。");
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return bad(c, "請選擇開始與結束時間。");
    if (end <= start) return bad(c, "結束時間要晚於開始時間。");
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) return bad(c, "重複週數要在 1 到 12 週之間。");
    if (toInstant(date, start) <= new Date()) return bad(c, "這個時間已經過去了，請選擇未來的時間。");

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const col = db.collection("availability");
      const created = [];
      const skipped = [];

      for (let i = 0; i < weeks; i++) {
        const d = addDays(date, i * 7);
        const startAt = toInstant(d, start);
        const endAt = toInstant(d, end);
        const clash = await col.findOne({ startAt: { $lt: endAt }, endAt: { $gt: startAt } });
        if (clash) {
          skipped.push(`${d}（與 ${clash.start}–${clash.end} 重疊）`);
          continue;
        }
        const doc = { date: d, start, end, startAt, endAt, status: "open", createdAt: new Date() };
        const res = await col.insertOne(doc);
        created.push(present({ ...doc, _id: res.insertedId }));
      }

      if (!created.length) {
        return bad(c, "沒有新增任何時段，因為都和已有的時段重疊：" + skipped.join("、"), 409);
      }
      const from = new Date(Date.now() - 24 * 3600 * 1000);
      const all = await col.find({ startAt: { $gte: from } }).sort({ startAt: 1 }).limit(500).toArray();
      return c.json({ ok: true, created, skipped, slots: all.map(present) });
    });
  });

  app.patch("/api/admin/slots/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return bad(c, "找不到這個時段。", 404);
    let body = {};
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const status = body.status;
    if (status !== "open" && status !== "closed") return bad(c, "只能設定為開放或暫停。");

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("availability");
      const doc = await col.findOne({ _id: id });
      if (!doc) return bad(c, "找不到這個時段，可能已經刪除了。", 404);
      if (doc.status === "booked") return bad(c, "這個時段已經有人預約，不能直接更改。", 409);
      await col.updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
      return c.json({ ok: true, slot: present({ ...doc, status }) });
    });
  });

  app.delete("/api/admin/slots/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return bad(c, "找不到這個時段。", 404);

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("availability");
      const doc = await col.findOne({ _id: id });
      if (!doc) return bad(c, "找不到這個時段，可能已經刪除了。", 404);
      if (doc.status === "booked") return bad(c, "這個時段已經有人預約，不能刪除。", 409);
      await col.deleteOne({ _id: id });
      return c.json({ ok: true });
    });
  });
}

