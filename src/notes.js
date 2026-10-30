import { ObjectId } from "mongodb";
import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";
import { todayLocal } from "./ledger.js";

// 個案筆記：每次療癒（預約）都可以寫，存在 caseNotes。
// 只有這裡讀寫這個資料表；前台 API 與通知信的程式完全不會讀取，所以筆記內容不可能出現在客人看得到的地方。

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const oid = (v) => (ObjectId.isValid(v) ? new ObjectId(v) : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function noteView(n) {
  return { id: n._id.toString(), bookingId: n.bookingId.toString(), date: n.date, text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt };
}

export function mountNotes(app) {
  app.use("/api/admin/notes", requireAdmin);
  app.use("/api/admin/notes/*", requireAdmin);

  app.get("/api/admin/notes", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const bid = oid(c.req.query("booking"));
      if (!bid) return bad(c, "請指定預約。");
      const list = await db.collection("caseNotes").find({ bookingId: bid }).sort({ date: -1, createdAt: -1 }).toArray();
      return c.json({ ok: true, items: list.map(noteView) });
    })
  );

  app.post("/api/admin/notes", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const text = str(body.text, 10000);
    if (!text) return bad(c, "請寫下筆記內容。");
    const bid = oid(body.bookingId);
    if (!bid) return bad(c, "請指定預約。");
    return withDb(c.env, c.executionCtx, async (db) => {
      const b = await db.collection("bookings").findOne({ _id: bid }, { projection: { date: 1 } });
      if (!b) return bad(c, "找不到這筆預約。", 404);
      const doc = { bookingId: bid, date: DATE_RE.test(body.date || "") ? body.date : b.date || todayLocal(), text, createdAt: new Date(), updatedAt: new Date() };
      const r = await db.collection("caseNotes").insertOne(doc);
      return c.json({ ok: true, item: noteView({ ...doc, _id: r.insertedId }) });
    });
  });

  app.patch("/api/admin/notes/:id", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const id = oid(c.req.param("id"));
    const text = str(body.text, 10000);
    if (!id) return bad(c, "找不到這則筆記。", 404);
    if (!text) return bad(c, "筆記內容不能是空的；不需要的話請按刪除。");
    const set = { text, updatedAt: new Date() };
    if (DATE_RE.test(body.date || "")) set.date = body.date;
    return withDb(c.env, c.executionCtx, async (db) => {
      const r = await db.collection("caseNotes").findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after" });
      const doc = r && r.value !== undefined ? r.value : r;
      if (!doc) return bad(c, "找不到這則筆記，可能已經刪除了。", 404);
      return c.json({ ok: true, item: noteView(doc) });
    });
  });

  app.delete("/api/admin/notes/:id", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const id = oid(c.req.param("id"));
      if (id) await db.collection("caseNotes").deleteOne({ _id: id });
      return c.json({ ok: true });
    })
  );
}
