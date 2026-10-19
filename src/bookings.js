import { ObjectId } from "mongodb";
import { withDb, ensureIndexes } from "./db.js";
import { requireAdmin, sameOrigin } from "./auth.js";
import { notifyNewBooking, notifyPaymentReported } from "./notify.js";

// ---------- 匯款資訊（只在預約成功後提供給該位客人） ----------
const PAYMENT = {
  TW: {
    label: "台灣匯款",
    currency: "TWD",
    lines: [
      ["銀行", "玉山銀行（代碼 808）"],
      ["帳號", "0417968137184"],
      ["戶名", "朱〇綸"],
    ],
  },
  MY: {
    label: "馬來西亞匯款",
    currency: "MYR",
    lines: [
      ["銀行", "Hong Leong Bank"],
      ["帳號", "20100081235"],
      ["戶名", "CHOO WEI LUEN"],
    ],
  },
};

const MIN_NOTICE_HOURS = 12; // 至少要在療程開始前 12 小時預約
const MAX_PER_HOUR = 5; // 同一個網路位址一小時內最多送出 5 筆

const AGES = ["20 歲以下", "21–30 歲", "31–40 歲", "41–50 歲", "51–60 歲", "61 歲以上"];
const GENDERS = ["女", "男", "多元", "不便透露"];
const REASONS = ["身體放鬆", "情緒梳理", "關係和諧", "個人成長", "靈性支持", "特定事件與遠距祝福"];
const STATUS = ["pending_payment", "payment_reported", "confirmed", "cancelled"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));

function newRef() {
  // 去掉容易看錯的 0/O、1/I/L
  const abc = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "N" + Array.from(bytes, (b) => abc[b % abc.length]).join("");
}
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function ip(c) {
  return c.req.header("cf-connecting-ip") || "local";
}
function weekday(date) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

// 依療癒項目額外詢問的欄位
function cleanExtra(kind, input) {
  const x = input && typeof input === "object" ? input : {};
  const errors = [];
  let out = {};
  if (kind === "magnified") {
    const v = x.practiced;
    if (v !== "yes" && v !== "no") errors.push("請選擇是否曾經習修過擴大療癒。");
    out = { practiced: v };
  } else if (kind === "departed") {
    const name = str(x.departedName, 60);
    if (!name) errors.push("請填寫亡者全名。");
    out = { departedName: name, relation: str(x.relation, 30) };
  } else if (kind === "soulplan") {
    const birthName = str(x.birthName, 80);
    const birthDate = str(x.birthDate, 10);
    if (!birthName) errors.push("請填寫出生時的完整姓名。");
    if (!DATE_RE.test(birthDate)) errors.push("請選擇出生日期。");
    out = { birthName, birthDate };
  } else if (kind === "animal") {
    const petName = str(x.petName, 40);
    const species = str(x.species, 40);
    if (!petName) errors.push("請填寫毛孩的名字。");
    if (!species) errors.push("請填寫毛孩的種類。");
    out = { petName, species, petAge: str(x.petAge, 20), questions: str(x.questions, 500) };
  }
  return { out, errors };
}

function publicView(b) {
  return {
    ref: b.ref,
    status: b.status,
    serviceName: b.serviceName,
    date: b.date,
    weekday: weekday(b.date),
    start: b.start,
    end: b.end,
    region: b.region,
    amount: b.amount,
    currency: b.currency,
    priceMode: b.priceMode || null,
    payment: PAYMENT[b.region],
    paymentReport: b.paymentReport || null,
  };
}

function adminView(b) {
  const { _id, token, ip: _ip, ...rest } = b;
  return { id: _id.toString(), ...rest, weekday: weekday(b.date), slotId: b.slotId?.toString() };
}

export function mountBookings(app) {
  // ---------- 客人：建立預約 ----------
  app.post("/api/bookings", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從預約頁送出。", 403);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    if (body.website) return c.json({ ok: true, ref: "N0000000" }); // 機器人陷阱欄位

    const region = body.region === "MY" ? "MY" : body.region === "TW" ? "TW" : null;
    const name = str(body.name, 40);
    const email = str(body.email, 120);
    const instagram = str(body.instagram, 60).replace(/^@+/, "");
    const age = AGES.includes(body.age) ? body.age : "";
    const gender = GENDERS.includes(body.gender) ? body.gender : "";
    const reasons = Array.isArray(body.reasons) ? body.reasons.filter((r) => REASONS.includes(r)) : [];
    const otherReason = str(body.otherReason, 100);
    const note = str(body.note, 1000);

    const errors = [];
    if (!ObjectId.isValid(body.serviceId)) errors.push("請選擇療癒項目。");
    if (!ObjectId.isValid(body.slotId)) errors.push("請選擇時段。");
    if (!region) errors.push("請選擇你住在台灣或馬來西亞。");
    if (!name) errors.push("請填寫姓名。");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("請填寫正確的 Email。");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(instagram)) errors.push("請填寫正確的 IG 帳號。");
    if (!age) errors.push("請選擇年齡區間。");
    if (!gender) errors.push("請選擇性別。");
    if (!reasons.length && !otherReason) errors.push("請至少選擇一個接受療癒的原因。");
    if (body.agree !== true) errors.push("請先閱讀並同意預約須知。");
    if (errors.length) return bad(c, errors.join(" "));

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const bookings = db.collection("bookings");

      const recent = await bookings.countDocuments({ ip: ip(c), createdAt: { $gte: new Date(Date.now() - 3600e3) } });
      if (recent >= MAX_PER_HOUR) return bad(c, "短時間內送出太多筆預約，請稍後再試，或 IG 私訊 @nieia4928。", 429);

      const service = await db.collection("services").findOne({ _id: new ObjectId(body.serviceId), published: true });
      if (!service) return bad(c, "這個療癒項目目前沒有開放預約，請重新選擇。", 409);

      const { out: extra, errors: extraErrors } = cleanExtra(service.extra || "none", body.extra);
      if (extraErrors.length) return bad(c, extraErrors.join(" "));

      // 鎖定時段：只有「仍可預約」且「時間還夠早」的時段才會被搶下，避免兩個人同時預約到同一格
      const slots = db.collection("availability");
      const earliest = new Date(Date.now() + MIN_NOTICE_HOURS * 3600e3);
      const slotId = new ObjectId(body.slotId);
      const ref = newRef();
      const claim = await slots.updateOne(
        { _id: slotId, status: "open", startAt: { $gt: earliest } },
        { $set: { status: "booked", bookingRef: ref, updatedAt: new Date() } }
      );
      if (!claim.matchedCount) {
        return bad(c, "這個時段剛剛被預約走了，或已經太接近療程時間，請選擇其他時段。", 409);
      }
      const slot = await slots.findOne({ _id: slotId });

      const amount = service.priceMode === "fixed"
        ? (region === "TW" ? service.priceTwd : service.priceMyr) ?? null
        : null;

      const booking = {
        ref,
        token: newToken(),
        status: "pending_payment",
        serviceId: service._id,
        serviceName: service.name,
        extraKind: service.extra || "none",
        slotId,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        startAt: slot.startAt,
        region,
        currency: PAYMENT[region].currency,
        amount,
        priceMode: service.priceMode || "coming",
        name, email, instagram, age, gender, reasons, otherReason, note,
        extra,
        ip: ip(c),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      try {
        await bookings.insertOne(booking);
      } catch (err) {
        // 寫入失敗就把時段還回去
        await slots.updateOne({ _id: slotId, bookingRef: ref }, { $set: { status: "open" }, $unset: { bookingRef: "" } });
        throw err;
      }
      notifyNewBooking(c, { ...booking, weekday: weekday(booking.date) });
      return c.json({ ok: true, token: booking.token, booking: publicView(booking) });
    });
  });

  // ---------- 客人：查看自己的預約（需要預約時拿到的通行碼） ----------
  async function findOwn(c, db) {
    const ref = str(c.req.param("ref"), 12).toUpperCase();
    const token = c.req.query("t") || c.req.header("x-booking-token") || "";
    if (!ref || !token) return null;
    const b = await db.collection("bookings").findOne({ ref });
    if (!b || b.token !== token) return null;
    return b;
  }

  app.get("/api/bookings/:ref", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const b = await findOwn(c, db);
      if (!b) return bad(c, "找不到這筆預約，請確認網址是否完整。", 404);
      return c.json({ ok: true, booking: publicView(b) });
    })
  );

  // ---------- 客人：回報匯款 ----------
  app.post("/api/bookings/:ref/payment", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從預約頁送出。", 403);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const paidDate = str(body.paidDate, 10);
    const last5 = str(body.last5, 10);
    const payerName = str(body.payerName, 40);
    if (!DATE_RE.test(paidDate)) return bad(c, "請選擇匯款日期。");
    if (!/^\d{5}$/.test(last5)) return bad(c, "請填寫匯款帳號的末五碼（5 個數字）。");

    return withDb(c.env, c.executionCtx, async (db) => {
      const b = await findOwn(c, db);
      if (!b) return bad(c, "找不到這筆預約，請確認網址是否完整。", 404);
      if (b.status === "cancelled") return bad(c, "這筆預約已經取消了，如有疑問請 IG 私訊 @nieia4928。", 409);
      if (b.status === "confirmed") return bad(c, "阿綸已經確認收到款項，不需要再回報。", 409);
      const paymentReport = { paidDate, last5, payerName, at: new Date() };
      await db.collection("bookings").updateOne(
        { _id: b._id },
        { $set: { paymentReport, status: "payment_reported", updatedAt: new Date() } }
      );
      notifyPaymentReported(c, { ...b, weekday: weekday(b.date) }, paymentReport);
      return c.json({ ok: true, booking: publicView({ ...b, paymentReport, status: "payment_reported" }) });
    });
  });

  // ---------- 後台 ----------
  app.use("/api/admin/bookings", requireAdmin);
  app.use("/api/admin/bookings/*", requireAdmin);

  app.get("/api/admin/bookings", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const since = new Date(Date.now() - 30 * 864e5);
      const docs = await db.collection("bookings")
        .find({ startAt: { $gte: since } })
        .sort({ startAt: 1 })
        .limit(500)
        .toArray();
      return c.json({ ok: true, items: docs.map(adminView) });
    })
  );

  app.patch("/api/admin/bookings/:id", async (c) => {
    const id = ObjectId.isValid(c.req.param("id")) ? new ObjectId(c.req.param("id")) : null;
    if (!id) return bad(c, "找不到這筆預約。", 404);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const status = body.status;
    if (!STATUS.includes(status)) return bad(c, "狀態不正確。");

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("bookings");
      const b = await col.findOne({ _id: id });
      if (!b) return bad(c, "找不到這筆預約，可能已經刪除了。", 404);
      if (b.status === "cancelled" && status !== "cancelled") return bad(c, "已取消的預約不能恢復，請客人重新預約。", 409);

      const set = { status, updatedAt: new Date() };
      if (status === "confirmed") set.confirmedAt = new Date();
      if (status === "cancelled") set.cancelledAt = new Date();
      await col.updateOne({ _id: id }, { $set: set });

      // 取消時，把還沒到的時段重新開放
      let slotReopened = false;
      if (status === "cancelled" && b.status !== "cancelled" && b.slotId) {
        const r = await db.collection("availability").updateOne(
          { _id: b.slotId, bookingRef: b.ref, startAt: { $gt: new Date() } },
          { $set: { status: "open", updatedAt: new Date() }, $unset: { bookingRef: "" } }
        );
        slotReopened = r.modifiedCount > 0;
      }
      return c.json({ ok: true, item: adminView({ ...b, ...set }), slotReopened });
    });
  });
}
