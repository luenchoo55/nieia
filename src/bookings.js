import { ObjectId } from "mongodb";
import { withDb, ensureIndexes } from "./db.js";
import { requireAdmin, sameOrigin } from "./auth.js";
import { cleanAmount, twDate } from "./ledger.js";
import { notifyNewBooking, notifyPaymentReported } from "./notify.js";
import { REGIONS, getPayment, publicPayment } from "./payment.js";

// 匯款資訊在後台「匯款方式」設定（src/payment.js），只在預約成功後提供給該位客人

const MIN_NOTICE_HOURS = 12; // 至少要在療程開始前 12 小時預約
const MAX_PER_HOUR = 5; // 同一個網路位址一小時內最多送出 5 筆

const AGES = ["20 歲以下", "21–30 歲", "31–40 歲", "41–50 歲", "51–60 歲", "61 歲以上"];
const GENDERS = ["女", "男", "多元", "不便透露"];
const REASONS = ["身體放鬆", "情緒梳理", "關係和諧", "個人成長", "靈性支持", "特定事件與遠距祝福"];
const STATUS = ["pending_payment", "payment_reported", "confirmed", "cancelled"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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

function publicView(b, payment) {
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
    mode: b.mode || "remote",
    payment: publicPayment(payment, b.region),
    paymentReport: b.paymentReport || null,
    // 預約時不問居住地：還沒回報匯款前，客人可以在完成頁改選台灣或馬來西亞的付款方式
    ...(canPickRegion(b)
      ? { regionChosen: !!b.regionChosen, prices: b.prices || null, payments: { TW: publicPayment(payment, "TW"), MY: publicPayment(payment, "MY") } }
      : {}),
  };
}

function canPickRegion(b) {
  return b.regionChosen !== undefined && b.status === "pending_payment" && !b.paymentReport;
}

function adminView(b) {
  const { _id, token, ip: _ip, ...rest } = b;
  return { id: _id.toString(), ...rest, weekday: weekday(b.date), slotId: b.slotId?.toString() };
}

// 手動新增／編輯個案共用的欄位檢查
function readManual(body) {
  const name = str(body.name, 40);
  const instagram = str(body.instagram, 60).replace(/^@+/, "");
  const email = str(body.email, 120);
  const phone = str(body.phone, 30);
  const note = str(body.note, 1000);
  const date = str(body.date, 10);
  const start = str(body.start, 5);
  const end = str(body.end, 5);
  const currency = body.currency === "MYR" ? "MYR" : "TWD";
  const amount = cleanAmount(body.amount);
  const paid = body.paid === true;
  const mode = ["remote", "onsite", "async"].includes(body.mode) ? body.mode : null;

  const errors = [];
  if (!ObjectId.isValid(body.serviceId)) errors.push("請選擇療癒項目。");
  if (!name) errors.push("請填寫客人名字。");
  if (!DATE_RE.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) errors.push("請選擇日期。");
  if (start && !TIME_RE.test(start)) errors.push("開始時間不正確。");
  if (end && (!start || !TIME_RE.test(end) || end <= start)) errors.push("結束時間要晚於開始時間。");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email 格式不正確。");
  if (!mode) errors.push("請選擇進行方式。");
  if (amount === undefined) errors.push("金額請填整數。");
  if (paid && amount == null) errors.push("已收款的話請填金額。");
  return { errors, name, instagram, email, phone, note, date, start, end, currency, amount, paid, mode };
}

export function mountBookings(app) {
  // ---------- 客人：建立預約 ----------
  app.post("/api/bookings", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從預約頁送出。", 403);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    if (body.website) return c.json({ ok: true, ref: "N0000000" }); // 機器人陷阱欄位

    // 居住地改成在完成頁選付款方式時決定；先記台灣，regionChosen = false
    const askedRegion = body.region === "MY" ? "MY" : body.region === "TW" ? "TW" : null;
    const region = askedRegion || "TW";
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
      if (!service.priceMode || service.priceMode === "coming") {
        return bad(c, "這個療癒項目的價格還沒公布，暫時無法預約，請選擇其他項目。", 409);
      }

      // 進行方式：項目設定「遠距或現場皆可」時由客人選擇
      const svcMode = service.mode || "remote";
      const mode = svcMode === "both" ? (["remote", "onsite"].includes(body.mode) ? body.mode : null) : svcMode;
      if (!mode) return bad(c, "請選擇想要的進行方式（IG 視訊遠距或現場）。");
      // 不需視訊的項目不用選時段
      const noSlot = mode === "async";
      if (!noSlot && !ObjectId.isValid(body.slotId)) return bad(c, "請選擇時段。");

      const { out: extra, errors: extraErrors } = cleanExtra(service.extra || "none", body.extra);
      if (extraErrors.length) return bad(c, extraErrors.join(" "));

      // 鎖定時段：只有「仍可預約」且「時間還夠早」的時段才會被搶下，避免兩個人同時預約到同一格
      const slots = db.collection("availability");
      const ref = newRef();
      let slotId = null, slot = null;
      if (!noSlot) {
        const earliest = new Date(Date.now() + MIN_NOTICE_HOURS * 3600e3);
        slotId = new ObjectId(body.slotId);
        const claim = await slots.updateOne(
          { _id: slotId, status: "open", startAt: { $gt: earliest } },
          { $set: { status: "booked", bookingRef: ref, updatedAt: new Date() } }
        );
        if (!claim.matchedCount) {
          return bad(c, "這個時段剛剛被預約走了，或已經太接近療程時間，請選擇其他時段。", 409);
        }
        slot = await slots.findOne({ _id: slotId });
      }
      const now = new Date();

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
        // 沒有時段的預約，日期記預約當天，排序時間用送出時間
        ...(slot
          ? { slotId, date: slot.date, start: slot.start, end: slot.end, startAt: slot.startAt }
          : { date: twDate(now), start: "", end: "", startAt: now }),
        region,
        regionChosen: !!askedRegion,
        currency: REGIONS[region].currency,
        amount,
        prices: service.priceMode === "fixed" ? { TWD: service.priceTwd ?? null, MYR: service.priceMyr ?? null } : null,
        priceMode: service.priceMode || "coming",
        mode,
        name, email, instagram, age, gender, reasons, otherReason, note,
        extra,
        ip: ip(c),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await bookings.insertOne(booking);
      } catch (err) {
        // 寫入失敗就把時段還回去
        if (slotId) await slots.updateOne({ _id: slotId, bookingRef: ref }, { $set: { status: "open" }, $unset: { bookingRef: "" } });
        throw err;
      }
      notifyNewBooking(c, { ...booking, weekday: weekday(booking.date) });
      return c.json({ ok: true, token: booking.token, booking: publicView(booking, await getPayment(db)) });
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
      return c.json({ ok: true, booking: publicView(b, await getPayment(db)) });
    })
  );

  // ---------- 客人：在完成頁選了台灣或馬來西亞的付款方式 ----------
  app.post("/api/bookings/:ref/region", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從預約頁送出。", 403);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const region = REGIONS[body.region] ? body.region : null;
    if (!region) return bad(c, "請選擇付款方式。");
    return withDb(c.env, c.executionCtx, async (db) => {
      const b = await findOwn(c, db);
      if (!b) return bad(c, "找不到這筆預約，請確認網址是否完整。", 404);
      if (!canPickRegion(b)) return bad(c, "這筆預約已經不能更改付款方式，請 IG 私訊 @nieia4928。", 409);
      const currency = REGIONS[region].currency;
      const amount = b.priceMode === "fixed" ? (b.prices?.[currency] ?? null) : b.amount;
      const set = { region, currency, amount, regionChosen: true, updatedAt: new Date() };
      await db.collection("bookings").updateOne({ _id: b._id, status: "pending_payment" }, { $set: set });
      return c.json({ ok: true, booking: publicView({ ...b, ...set }, await getPayment(db)) });
    });
  });

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
      return c.json({ ok: true, booking: publicView({ ...b, paymentReport, status: "payment_reported" }, await getPayment(db)) });
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

  // 手動新增個案：IG 私訊等管道接到的客人，由阿綸自己輸入。
  // 不佔時段、不寄信；有收款就直接成立（收入自動進收支報表），之後可以寫個案筆記。
  app.post("/api/admin/bookings", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const { errors, name, instagram, email, phone, note, date, start, end, currency, amount, paid, mode } = readManual(body);
    if (errors.length) return bad(c, errors.join(" "));

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const service = await db.collection("services").findOne({ _id: new ObjectId(body.serviceId) });
      if (!service) return bad(c, "找不到這個療癒項目。", 404);
      const now = new Date();
      const startAt = new Date(`${date}T${start || "00:00"}:00+08:00`);
      const booking = {
        ref: newRef(),
        token: newToken(),
        source: "manual",
        status: paid ? "confirmed" : "pending_payment",
        serviceId: service._id,
        serviceName: service.name,
        extraKind: "none",
        date, start, end: start ? end : "", startAt,
        region: currency === "MYR" ? "MY" : "TW",
        currency,
        amount,
        priceMode: service.priceMode || "fixed",
        mode,
        name, email, instagram, phone, note,
        age: "", gender: "", reasons: [], otherReason: "", extra: {},
        ...(paid ? { paidAmount: amount, confirmedAt: now } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const r = await db.collection("bookings").insertOne(booking);
      return c.json({ ok: true, item: adminView({ ...booking, _id: r.insertedId }) });
    });
  });

  // ---------- 編輯客人自己預約的個案：改客人寫錯的資料，或幫客人換時段 ----------
  app.put("/api/admin/bookings/:id/web", async (c) => {
    const id = ObjectId.isValid(c.req.param("id")) ? new ObjectId(c.req.param("id")) : null;
    if (!id) return bad(c, "找不到這筆預約。", 404);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const name = str(body.name, 40);
    const email = str(body.email, 120);
    const instagram = str(body.instagram, 60).replace(/^@+/, "");
    const note = str(body.note, 1000);
    const time = body.time || { kind: "keep" };
    const errors = [];
    if (!name) errors.push("請填寫客人名字。");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("請填寫正確的 Email。");
    if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) errors.push("IG 帳號只能有英文、數字、底線和點。");
    if (!["keep", "slot", "custom"].includes(time.kind)) errors.push("時段選擇不正確。");
    if (time.kind === "slot" && !ObjectId.isValid(time.slotId)) errors.push("請選擇時段。");
    if (time.kind === "custom") {
      const d = str(time.date, 10), st = str(time.start, 5), en = str(time.end, 5);
      if (!DATE_RE.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) errors.push("請選擇日期。");
      if (!TIME_RE.test(st)) errors.push("請填寫開始時間。");
      if (en && (!TIME_RE.test(en) || en <= st)) errors.push("結束時間要晚於開始時間。");
    }
    if (errors.length) return bad(c, errors.join(" "));

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("bookings");
      const slots = db.collection("availability");
      const b = await col.findOne({ _id: id });
      if (!b) return bad(c, "找不到這筆預約，可能已經刪除了。", 404);
      if (b.source === "manual") return bad(c, "手動新增的個案請用另一個編輯表單。", 409);
      if (b.status === "cancelled") return bad(c, "已取消的預約不能編輯。", 409);

      const set = { name, email, instagram, note, updatedAt: new Date() };
      // 進行方式：只能在遠距和現場之間切換（不需視訊的項目沒有時段，維持原樣）
      if (b.mode !== "async" && ["remote", "onsite"].includes(body.mode)) set.mode = body.mode;

      let unset = null, releaseOld = false;
      if (b.mode !== "async" && time.kind === "slot" && String(b.slotId || "") !== time.slotId) {
        const slotId = new ObjectId(time.slotId);
        const claim = await slots.updateOne(
          { _id: slotId, status: "open", startAt: { $gt: new Date() } },
          { $set: { status: "booked", bookingRef: b.ref, updatedAt: new Date() } }
        );
        if (!claim.matchedCount) return bad(c, "這個時段已經被預約或已經過了，請選擇其他時段。", 409);
        const slot = await slots.findOne({ _id: slotId });
        Object.assign(set, { slotId, date: slot.date, start: slot.start, end: slot.end, startAt: slot.startAt });
        releaseOld = !!b.slotId;
      } else if (b.mode !== "async" && time.kind === "custom") {
        const d = str(time.date, 10), st = str(time.start, 5), en = str(time.end, 5);
        Object.assign(set, { date: d, start: st, end: en, startAt: new Date(`${d}T${st}:00+08:00`) });
        if (b.slotId) { unset = { slotId: "" }; releaseOld = true; }
      }
      try {
        await col.updateOne({ _id: id }, { $set: set, ...(unset ? { $unset: unset } : {}) });
      } catch (err) {
        if (set.slotId) await slots.updateOne({ _id: set.slotId, bookingRef: b.ref }, { $set: { status: "open" }, $unset: { bookingRef: "" } });
        throw err;
      }
      // 原本的時段還沒到就重新開放給別人預約
      let slotReopened = false;
      if (releaseOld) {
        const r = await slots.updateOne(
          { _id: b.slotId, bookingRef: b.ref, startAt: { $gt: new Date() } },
          { $set: { status: "open", updatedAt: new Date() }, $unset: { bookingRef: "" } }
        );
        slotReopened = r.modifiedCount > 0;
      }
      const next = { ...b, ...set };
      if (unset) delete next.slotId;
      return c.json({ ok: true, item: adminView(next), slotReopened });
    });
  });

  // ---------- 編輯手動新增的個案（記錯名字、日期、金額時可以改） ----------
  app.put("/api/admin/bookings/:id", async (c) => {
    const id = ObjectId.isValid(c.req.param("id")) ? new ObjectId(c.req.param("id")) : null;
    if (!id) return bad(c, "找不到這筆預約。", 404);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const { errors, name, instagram, email, phone, note, date, start, end, currency, amount, mode } = readManual(body);
    if (errors.length) return bad(c, errors.join(" "));

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("bookings");
      const b = await col.findOne({ _id: id });
      if (!b) return bad(c, "找不到這筆預約，可能已經刪除了。", 404);
      if (b.source !== "manual") return bad(c, "只有手動新增的個案可以編輯。", 409);
      if (b.status === "cancelled") return bad(c, "已取消的個案不能編輯。", 409);
      if (b.status === "confirmed" && amount == null) return bad(c, "已收款的個案請填金額。");
      const service = await db.collection("services").findOne({ _id: new ObjectId(body.serviceId) });
      if (!service) return bad(c, "找不到這個療癒項目。", 404);
      const set = {
        serviceId: service._id,
        serviceName: service.name,
        priceMode: service.priceMode || "fixed",
        date, start, end: start ? end : "",
        startAt: new Date(`${date}T${start || "00:00"}:00+08:00`),
        region: currency === "MYR" ? "MY" : "TW",
        currency, amount, mode,
        name, email, instagram, phone, note,
        updatedAt: new Date(),
      };
      // 實收金額原本就等於金額（新增時直接收款）就跟著改；另外修改過實收金額的就保留
      if (b.status === "confirmed" && (b.paidAmount == null || b.paidAmount === b.amount)) set.paidAmount = amount;
      await col.updateOne({ _id: id }, { $set: set });
      return c.json({ ok: true, item: adminView({ ...b, ...set }) });
    });
  });

  app.patch("/api/admin/bookings/:id", async (c) => {
    const id = ObjectId.isValid(c.req.param("id")) ? new ObjectId(c.req.param("id")) : null;
    if (!id) return bad(c, "找不到這筆預約。", 404);
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    // 只改實收金額時可以不帶狀態
    const status = body.status ?? (body.paidAmount !== undefined ? "confirmed" : undefined);
    if (!STATUS.includes(status)) return bad(c, "狀態不正確。");
    const paidAmount = cleanAmount(body.paidAmount);
    if (paidAmount === undefined) return bad(c, "實收金額請填整數。");

    return withDb(c.env, c.executionCtx, async (db) => {
      const col = db.collection("bookings");
      const b = await col.findOne({ _id: id });
      if (!b) return bad(c, "找不到這筆預約，可能已經刪除了。", 404);
      if (b.status === "cancelled" && status !== "cancelled") return bad(c, "已取消的預約不能恢復，請客人重新預約。", 409);

      const set = { status, updatedAt: new Date() };
      // 確認收款：記下實收金額（記帳用）；沒填就用預約時的固定價格，兩個都沒有就要填
      if (status === "confirmed") {
        if (paidAmount != null) set.paidAmount = paidAmount;
        else if (b.paidAmount == null && b.amount == null) return bad(c, "這筆預約沒有固定價格，請填寫實收金額。");
        if (b.status !== "confirmed") set.confirmedAt = new Date();
      }
      if (status === "cancelled") set.cancelledAt = new Date();
      // 取消並退款：只用在已收款（已成立）的預約。退款金額可以是 0（不退款），留下的部分照樣算收入
      if (body.refund != null) {
        if (status !== "cancelled" || b.status !== "confirmed") return bad(c, "只有已成立的預約可以取消並退款。", 409);
        const paidNow = b.paidAmount != null ? b.paidAmount : b.amount;
        const r = body.refund || {};
        const refundAmount = cleanAmount(r.amount);
        if (refundAmount == null || refundAmount === undefined) return bad(c, "請填寫退款金額（整數，不退款請填 0）。");
        if (paidNow != null && refundAmount > paidNow) return bad(c, "退款金額不能超過實收金額。");
        const refundDate = DATE_RE.test(r.date || "") ? r.date : twDate(new Date());
        set.refund = { amount: refundAmount, date: refundDate, note: str(r.note, 200), at: new Date() };
      }
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
