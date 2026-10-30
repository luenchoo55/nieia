import { ObjectId } from "mongodb";
import { withDb, ensureIndexes, cachedJson, purgeCached } from "./db.js";
import { requireAdmin, sameOrigin } from "./auth.js";
import { notifyWorkshopSignup } from "./notify.js";
import { REGIONS, getPayment, publicPayment } from "./payment.js";
import { cleanAmount } from "./ledger.js";

// 工作坊：場次、學員名單、出席、結業證書、大合照、線上簽到。
// 學員資料直接存在工作坊文件裡（一場通常不超過幾十人）；
// 證書另存一份快照，之後修改場次資料也不會改到已經發出的證書，除非重新產生。

const TYPES = ["spirit", "craft", "other"];
const FORMATS = ["onsite", "online"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ATTENDEES = 200;
const MAX_SESSIONS = 12;
const MAX_PHOTO_BYTES = 900 * 1024; // 後台會先壓縮，正常約 200–400 KB
const CHECKIN_PER_HOUR = 30; // 同一個網路位址一小時內最多簽到 30 次
const SIGNUP_PER_HOUR = 5; // 同一個網路位址一小時內最多報名 5 次
const LOOKUP_PER_HOUR = 20; // 同一個網路位址一小時內最多查詢證書 20 次
const PRICE_KINDS = ["new", "retake"];
const PRICE_LABEL = { new: "新生", retake: "複訓" };
const CURRENCIES = ["twd", "myr"];
const hasRetake = (w) => CURRENCIES.some((cur) => w.prices?.retake?.[cur] != null);

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));

// 去掉容易看錯的 0/O、1/I/L
function randomKey(len) {
  const abc = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}
function ip(c) {
  return c.req.header("cf-connecting-ip") || "local";
}
// 台灣／馬來西亞時間（UTC+8）的今天
function todayLocal() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function oid(v) {
  return ObjectId.isValid(v) ? new ObjectId(v) : null;
}
// 比對姓名時忽略空白、大小寫與全形半形差異
function norm(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// ---------- 欄位整理 ----------
function cleanSessions(input, old = []) {
  const errors = [];
  if (!Array.isArray(input) || !input.length) return { errors: ["請至少新增一堂課的日期。"], sessions: [] };
  if (input.length > MAX_SESSIONS) return { errors: [`最多 ${MAX_SESSIONS} 堂課。`], sessions: [] };
  const keep = new Map(old.map((s) => [s.key, s]));
  const sessions = input.map((s, i) => {
    const date = str(s?.date, 10);
    const start = str(s?.start, 5);
    const end = str(s?.end, 5);
    if (!DATE_RE.test(date)) errors.push(`第 ${i + 1} 堂請選擇日期。`);
    if (start && !TIME_RE.test(start)) errors.push(`第 ${i + 1} 堂的開始時間格式不正確。`);
    if (end && !TIME_RE.test(end)) errors.push(`第 ${i + 1} 堂的結束時間格式不正確。`);
    if (start && end && end <= start) errors.push(`第 ${i + 1} 堂的結束時間要晚於開始時間。`);
    // 保留原本的簽到代碼，已經寄出的簽到連結才不會失效
    const key = keep.has(s?.key) ? s.key : randomKey(10);
    return { key, date, start, end };
  });
  sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { errors, sessions };
}

function cleanTeachers(input) {
  const list = Array.isArray(input) ? input : [];
  const teachers = list
    .map((t) => ({ name: str(t?.name, 30), nameEn: str(t?.nameEn, 60) }))
    .filter((t) => t.name)
    .slice(0, 4);
  return { teachers, errors: teachers.length ? [] : ["請填寫至少一位授課老師。"] };
}

function cleanWorkshop(body, old) {
  const errors = [];
  const out = {
    title: str(body.title, 40),
    titleEn: str(body.titleEn, 80),
    type: TYPES.includes(body.type) ? body.type : "spirit",
    format: FORMATS.includes(body.format) ? body.format : "onsite",
    location: str(body.location, 120),
    roomUrl: str(body.roomUrl, 300),
    note: str(body.note, 500),
    // 前台報名：沒結束的場次會列在工作坊頁，關掉就不顯示
    signupOpen: body.signupOpen !== false,
    intro: str(body.intro, 5000),
  };
  if (!out.title) errors.push("請填寫工作坊名稱。");

  // 費用：新生／複訓 × 台灣（NT$）／馬來西亞（RM），留空代表不顯示
  out.prices = {};
  for (const who of PRICE_KINDS) {
    out.prices[who] = {};
    for (const cur of CURRENCIES) {
      const v = body.prices?.[who]?.[cur];
      if (v === "" || v == null) { out.prices[who][cur] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 9999999) { errors.push(`${PRICE_LABEL[who]}的${cur === "twd" ? "台灣" : "馬來西亞"}價格請填整數。`); continue; }
      out.prices[who][cur] = n;
    }
  }

  // 教材費（和學費分開收，只在後台記帳與提醒用，前台不顯示）：台灣／馬來西亞，留空代表沒有
  out.materialFee = {};
  for (const cur of CURRENCIES) {
    const v = body.materialFee?.[cur];
    if (v === "" || v == null) { out.materialFee[cur] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 9999999) { errors.push(`${cur === "twd" ? "台灣" : "馬來西亞"}的教材費請填整數。`); continue; }
    out.materialFee[cur] = n;
  }

  const cap = body.capacity === "" || body.capacity == null ? 0 : Number(body.capacity);
  if (!Number.isInteger(cap) || cap < 0 || cap > MAX_ATTENDEES) errors.push(`名額請填 1 到 ${MAX_ATTENDEES} 的整數，不限名額就留空。`);
  else out.capacity = cap; // 0 = 不限
  if (out.roomUrl && !/^https:\/\/[^\s]+$/i.test(out.roomUrl)) errors.push("線上教室連結要是 https:// 開頭的網址。");

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 200) errors.push("請填寫總時數（例如 16）。");
  else out.hours = Math.round(hours * 2) / 2; // 以半小時為單位

  const s = cleanSessions(body.sessions, old?.sessions || []);
  errors.push(...s.errors);
  out.sessions = s.sessions;

  // 最後報名日（含當天），留空就是開課前一天都能報名
  const dl = str(body.signupDeadline, 10);
  if (!dl) out.signupDeadline = "";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(dl)) errors.push("最後報名日的日期格式不正確。");
  else if (out.sessions.length && dl >= out.sessions[0].date) errors.push("最後報名日要在第一堂課之前。");
  else out.signupDeadline = dl;

  const t = cleanTeachers(body.teachers);
  errors.push(...t.errors);
  out.teachers = t.teachers;
  return { data: out, errors };
}

function cleanPerson(p) {
  return {
    name: str(p?.name, 30),
    nameEn: str(p?.nameEn, 60),
    email: str(p?.email, 120).toLowerCase(),
  };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- 給前端的樣子 ----------
function workshopSummary(w) {
  const attendees = w.attendees || [];
  return {
    id: w._id.toString(),
    title: w.title,
    type: w.type,
    format: w.format,
    sessions: w.sessions,
    hours: w.hours,
    attendeeCount: attendees.length,
    certCount: attendees.filter((a) => a.certCode).length,
    hasPhoto: Boolean(w.photoKey),
  };
}

function workshopView(w) {
  const { _id, ...rest } = w;
  return { ...rest, id: _id.toString(), attendees: (w.attendees || []).map((a) => ({ ...a })) };
}

function certView(cert, photoKey) {
  return {
    code: cert.code,
    no: cert.no,
    name: cert.name,
    nameEn: cert.nameEn,
    title: cert.title,
    titleEn: cert.titleEn,
    type: cert.type,
    format: cert.format,
    dates: cert.dates,
    hours: cert.hours,
    teachers: cert.teachers,
    issuedAt: cert.issuedAt,
    photo: photoKey ? `/api/photos/${photoKey}` : null,
  };
}

// 學員自己的報名資料：應付金額（依身分與居住地）與匯款方式，報名成功與之後用專屬網址查看都用這個
function signupView(w, a, payment) {
  const region = a.region || null;
  return {
    workshopId: w._id.toString(),
    attendeeId: a.id,
    token: a.token,
    title: w.title,
    sessions: w.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end })),
    name: a.name,
    status: a.status || "new",
    amount: region ? w.prices?.[a.status || "new"]?.[region === "TW" ? "twd" : "myr"] ?? null : null,
    payment: region ? publicPayment(payment, region) : null,
  };
}

// 前台工作坊頁：只給客人需要的資訊（不含簽到代碼、教室連結和名單）
function signupState(w, today) {
  if (today >= w.sessions[0].date) return "started";
  if (w.signupDeadline && today > w.signupDeadline) return "closed";
  if (w.capacity && (w.attendees || []).length >= w.capacity) return "full";
  return "open";
}
function publicWorkshop(w, today) {
  return {
    id: w._id.toString(),
    title: w.title,
    titleEn: w.titleEn || "",
    type: w.type,
    format: w.format,
    location: w.format === "onsite" ? w.location || "" : "",
    sessions: w.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end })),
    hours: w.hours,
    teachers: w.teachers.map((t) => t.name),
    intro: w.intro || "",
    prices: w.prices || null,
    signupDeadline: w.signupDeadline || "",
    state: signupState(w, today),
  };
}

// 證書編號：場次代號-年份-場次內流水號，例如 A-2027-002、AC-2028-001
// 場次代號在這場第一次發證書時決定，依序 A…Z、AA、AB…（像試算表的欄位名稱），之後不會改變。
const NO_RE = /^[A-Z]{1,3}-\d{4}-\d{3,}$/;
const unwrap = (r) => (r && r.value !== undefined ? r.value : r); // 舊版驅動程式回傳 { value }

function letterOf(n) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

async function workshopLetter(db, w) {
  if (w.letter) return w.letter;
  const seq = unwrap(await db.collection("counters").findOneAndUpdate(
    { _id: "workshopLetter" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }
  )).seq;
  // 同時有兩個請求在發同一場的證書時，以先寫進去的代號為準
  await db.collection("workshops").updateOne({ _id: w._id, letter: { $exists: false } }, { $set: { letter: letterOf(seq) } });
  const fresh = await db.collection("workshops").findOne({ _id: w._id }, { projection: { letter: 1 } });
  return (w.letter = fresh.letter);
}

async function nextCertNo(db, w, year) {
  const letter = await workshopLetter(db, w);
  const doc = unwrap(await db.collection("workshops").findOneAndUpdate(
    { _id: w._id }, { $inc: { certSeq: 1 } }, { returnDocument: "after", projection: { certSeq: 1 } }
  ));
  return `${letter}-${year}-${String(doc.certSeq).padStart(3, "0")}`;
}

function snapshot(w, a) {
  const dates = w.sessions.map((s) => s.date);
  return {
    name: a.name,
    nameEn: a.nameEn || "",
    title: w.title,
    titleEn: w.titleEn || "",
    type: w.type,
    format: w.format,
    dates: { first: dates[0], last: dates[dates.length - 1] },
    hours: w.hours,
    teachers: w.teachers,
  };
}

export function mountWorkshops(app) {
  // ================= 後台 =================
  app.use("/api/admin/workshops", requireAdmin);
  app.use("/api/admin/workshops/*", requireAdmin);
  app.use("/api/admin/certificates", requireAdmin);
  app.use("/api/admin/certificates/*", requireAdmin);

  // 後台改了工作坊（新增、修改、學員、發證書…），清掉前台工作坊列表的快取
  const purgeList = async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.res.ok) purgeCached(c, "/api/workshops");
  };
  app.use("/api/admin/workshops", purgeList);
  app.use("/api/admin/workshops/*", purgeList);

  async function readBody(c) {
    try { return await c.req.json(); } catch { return null; }
  }

  app.get("/api/admin/workshops", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const docs = await db.collection("workshops")
        .find({}, { projection: { "attendees.attended": 0 } })
        .sort({ firstDate: -1 })
        .limit(300)
        .toArray();
      return c.json({ ok: true, items: docs.map(workshopSummary) });
    })
  );

  app.post("/api/admin/workshops", async (c) => {
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    const { data, errors } = cleanWorkshop(body);
    if (errors.length) return bad(c, errors.join(" "));
    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const doc = { ...data, firstDate: data.sessions[0].date, attendees: [], photoKey: null, createdAt: new Date(), updatedAt: new Date() };
      const r = await db.collection("workshops").insertOne(doc);
      return c.json({ ok: true, item: workshopView({ ...doc, _id: r.insertedId }) });
    });
  });

  async function loadWorkshop(c, db) {
    const id = oid(c.req.param("id"));
    if (!id) return null;
    return db.collection("workshops").findOne({ _id: id });
  }

  app.get("/api/admin/workshops/:id", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      return c.json({ ok: true, item: workshopView(w) });
    })
  );

  app.patch("/api/admin/workshops/:id", async (c) => {
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    return withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const { data, errors } = cleanWorkshop(body, w);
      if (errors.length) return bad(c, errors.join(" "));
      // 刪掉的堂數，連同學員在那一堂的出席紀錄一起移除
      const keys = new Set(data.sessions.map((s) => s.key));
      const attendees = (w.attendees || []).map((a) => {
        const attended = {};
        for (const [k, v] of Object.entries(a.attended || {})) if (keys.has(k)) attended[k] = v;
        return { ...a, attended };
      });
      const set = { ...data, firstDate: data.sessions[0].date, attendees, updatedAt: new Date() };
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: set });
      return c.json({ ok: true, item: workshopView({ ...w, ...set }) });
    });
  });

  app.delete("/api/admin/workshops/:id", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return c.json({ ok: true });
      if ((w.attendees || []).some((a) => a.certCode)) {
        return bad(c, "這場工作坊已經發出證書，為了讓學員的證書連結繼續有效，不能刪除。", 409);
      }
      await db.collection("workshops").deleteOne({ _id: w._id });
      if (w.photoKey) await db.collection("photos").deleteOne({ _id: w.photoKey });
      return c.json({ ok: true });
    })
  );

  // ---------- 學員名單 ----------
  app.post("/api/admin/workshops/:id/attendees", async (c) => {
    const body = await readBody(c);
    const people = Array.isArray(body?.people) ? body.people.map(cleanPerson).filter((p) => p.name) : [];
    if (!people.length) return bad(c, "請至少填寫一位學員的姓名。");
    const badEmail = people.find((p) => p.email && !EMAIL_RE.test(p.email));
    if (badEmail) return bad(c, `${badEmail.name} 的 Email 格式不正確。`);
    return withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const list = w.attendees || [];
      const seen = new Set(list.map((a) => norm(a.name)));
      const added = [];
      const skipped = [];
      for (const p of people) {
        if (seen.has(norm(p.name))) { skipped.push(p.name); continue; }
        seen.add(norm(p.name));
        added.push({ id: randomKey(8), ...p, attended: {}, certCode: null, certNo: null, addedAt: new Date() });
      }
      if (list.length + added.length > MAX_ATTENDEES) return bad(c, `一場工作坊最多 ${MAX_ATTENDEES} 位學員。`);
      const attendees = list.concat(added);
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: { attendees, updatedAt: new Date() } });
      return c.json({ ok: true, added: added.length, skipped, item: workshopView({ ...w, attendees }) });
    });
  });

  app.patch("/api/admin/workshops/:id/attendees/:aid", async (c) => {
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    return withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const attendees = w.attendees || [];
      const a = attendees.find((x) => x.id === c.req.param("aid"));
      if (!a) return bad(c, "找不到這位學員。", 404);

      if ("name" in body || "nameEn" in body || "email" in body) {
        const p = cleanPerson({ name: body.name ?? a.name, nameEn: body.nameEn ?? a.nameEn, email: body.email ?? a.email });
        if (!p.name) return bad(c, "請填寫學員姓名。");
        if (p.email && !EMAIL_RE.test(p.email)) return bad(c, "Email 格式不正確。");
        if (attendees.some((x) => x !== a && norm(x.name) === norm(p.name))) return bad(c, "名單上已經有同名的學員。", 409);
        Object.assign(a, p);
      }
      if (body.certSent && a.certCode) a.certSentAt = new Date();
      // 學費、教材費：{ paid, amount, currency }；paid 為 false 就清除付款紀錄
      for (const field of ["tuition", "material"]) {
        const p = body[field];
        if (!p || typeof p !== "object") continue;
        if (!p.paid) { a[field] = null; continue; }
        const amount = cleanAmount(p.amount);
        if (amount == null) return bad(c, `請填寫${field === "tuition" ? "學費" : "教材費"}的實收金額（整數）。`);
        const currency = p.currency === "MYR" ? "MYR" : "TWD";
        const paidAt = /^d{4}-d{2}-d{2}$/.test(p.date || "") ? new Date(p.date + "T12:00:00+08:00") : a[field]?.paidAt || new Date();
        a[field] = { amount, currency, paidAt };
      }
      if (body.attended && typeof body.attended === "object") {
        const keys = new Set(w.sessions.map((s) => s.key));
        a.attended = { ...(a.attended || {}) };
        for (const [k, v] of Object.entries(body.attended)) {
          if (!keys.has(k)) continue;
          if (v) a.attended[k] = a.attended[k] || { at: new Date(), by: "admin" };
          else delete a.attended[k];
        }
      }
      // 只改這一位學員，避免覆蓋同時間其他學員的線上簽到
      await db.collection("workshops").updateOne(
        { _id: w._id, "attendees.id": a.id },
        { $set: { "attendees.$": a, updatedAt: new Date() } }
      );
      return c.json({ ok: true, attendee: a });
    });
  });

  app.delete("/api/admin/workshops/:id/attendees/:aid", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const a = (w.attendees || []).find((x) => x.id === c.req.param("aid"));
      if (!a) return c.json({ ok: true });
      if (a.certCode) return bad(c, "這位學員已經拿到證書，不能從名單移除。", 409);
      const attendees = w.attendees.filter((x) => x !== a);
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: { attendees, updatedAt: new Date() } });
      return c.json({ ok: true });
    })
  );

  // ---------- 大合照 ----------
  app.put("/api/admin/workshops/:id/photo", async (c) => {
    const body = await readBody(c);
    const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(body?.dataUrl || "");
    if (!m) return bad(c, "請選擇 JPG、PNG 或 WebP 圖片。");
    const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > MAX_PHOTO_BYTES) return bad(c, "照片太大了，請換一張或裁小一點再上傳。", 413);
    return withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const key = randomKey(16);
      await db.collection("photos").insertOne({ _id: key, workshopId: w._id, type: m[1], data: bytes, createdAt: new Date() });
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: { photoKey: key, updatedAt: new Date() } });
      if (w.photoKey) await db.collection("photos").deleteOne({ _id: w.photoKey });
      // 已發出的證書一起換成新照片
      await db.collection("certificates").updateMany({ workshopId: w._id }, { $set: { photoKey: key } });
      return c.json({ ok: true, photoKey: key });
    });
  });

  app.delete("/api/admin/workshops/:id/photo", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      if (w.photoKey) await db.collection("photos").deleteOne({ _id: w.photoKey });
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: { photoKey: null, updatedAt: new Date() } });
      await db.collection("certificates").updateMany({ workshopId: w._id }, { $set: { photoKey: null } });
      return c.json({ ok: true });
    })
  );

  // ---------- 發證書 ----------
  // 已經有證書的學員會用最新資料重新產生（編號與連結不變）
  app.post("/api/admin/workshops/:id/certificates", async (c) => {
    const body = await readBody(c);
    const ids = Array.isArray(body?.attendeeIds) ? body.attendeeIds.map(String) : [];
    if (!ids.length) return bad(c, "請選擇要發證書的學員。");
    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const w = await loadWorkshop(c, db);
      if (!w) return bad(c, "找不到這場工作坊，可能已經刪除了。", 404);
      const attendees = w.attendees || [];
      const certs = db.collection("certificates");
      const year = w.sessions[w.sessions.length - 1].date.slice(0, 4);
      const issued = [];
      for (const a of attendees) {
        if (!ids.includes(a.id)) continue;
        const snap = snapshot(w, a);
        if (a.certCode) {
          await certs.updateOne({ code: a.certCode }, { $set: { ...snap, photoKey: w.photoKey || null, updatedAt: new Date() } });
        } else {
          a.certCode = randomKey(12);
          a.certNo = await nextCertNo(db, w, year);
          await certs.insertOne({
            code: a.certCode, no: a.certNo, workshopId: w._id, attendeeId: a.id,
            ...snap, photoKey: w.photoKey || null, issuedAt: new Date(), updatedAt: new Date(),
          });
        }
        issued.push({ id: a.id, certCode: a.certCode, certNo: a.certNo });
      }
      await db.collection("workshops").updateOne({ _id: w._id }, { $set: { attendees, updatedAt: new Date() } });
      return c.json({ ok: true, issued, item: workshopView({ ...w, attendees }) });
    });
  });

  // ---------- 證書登記查詢 ----------
  app.get("/api/admin/certificates", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const q = str(c.req.query("q"), 40);
      const filter = {};
      if (q) {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = { $regex: safe, $options: "i" };
        filter.$or = [{ no: re }, { name: re }, { nameEn: re }, { title: re }, { "teachers.name": re }];
      }
      const docs = await db.collection("certificates").find(filter).sort({ issuedAt: -1 }).limit(200).toArray();
      return c.json({
        ok: true,
        items: docs.map((d) => ({
          code: d.code, no: d.no, name: d.name, nameEn: d.nameEn, title: d.title,
          dates: d.dates, hours: d.hours, teachers: d.teachers, format: d.format,
          workshopId: d.workshopId?.toString(), issuedAt: d.issuedAt,
        })),
      });
    })
  );

  // ================= 學員 =================
  // ---------- 前台：近期工作坊與報名 ----------
  app.get("/api/workshops", (c) =>
    cachedJson(c, "/api/workshops", 60, async (db) => {
      const today = todayLocal();
      // 還有任何一堂在今天或之後，就算還沒結束
      const docs = await db.collection("workshops")
        .find({ signupOpen: { $ne: false }, "sessions.date": { $gte: today } }, { projection: { "attendees.id": 1, title: 1, titleEn: 1, type: 1, format: 1, location: 1, sessions: 1, hours: 1, teachers: 1, intro: 1, prices: 1, capacity: 1, signupDeadline: 1 } })
        .sort({ firstDate: 1 })
        .limit(30)
        .toArray();
      return { ok: true, items: docs.map((w) => publicWorkshop(w, today)) };
    })
  );

  app.post("/api/workshops/:id/signup", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從工作坊頁報名。", 403);
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    if (body.website) return c.json({ ok: true }); // 機器人陷阱欄位
    const p = cleanPerson(body);
    const instagram = str(body.instagram, 40).replace(/^@+/, "");
    const note = str(body.note, 300);
    if (!p.name) return bad(c, "請填寫姓名。");
    if (!EMAIL_RE.test(p.email)) return bad(c, "請填寫正確的 Email，阿綸會用它和你聯絡。");
    if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) return bad(c, "IG 帳號只能有英文、數字、底線和句點。");
    // 新版頁面一定會送居住地；更新前就打開的舊頁面沒有這一題，照樣收下報名，匯款方式改由阿綸私訊告知
    const region = REGIONS[body.region] ? body.region : null;

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const tries = db.collection("signupAttempts");
      const recent = await tries.countDocuments({ ip: ip(c), at: { $gte: new Date(Date.now() - 3600e3) } });
      if (recent >= SIGNUP_PER_HOUR) return bad(c, "短時間內報名太多次，請稍後再試，或 IG 私訊 @nieia4928。", 429);
      await tries.insertOne({ ip: ip(c), at: new Date() });

      const w = await loadWorkshop(c, db);
      if (!w || w.signupOpen === false) return bad(c, "找不到這場工作坊，可能已經關閉報名了。", 404);
      const state = signupState(w, todayLocal());
      if (state === "started") return bad(c, "這場工作坊已經開始上課，不能再報名了。", 409);
      if (state === "closed") return bad(c, "這場工作坊已經截止報名了，可以 IG 私訊阿綸詢問。", 409);
      if (state === "full") return bad(c, "這場工作坊已經額滿了，可以 IG 私訊阿綸詢問下一場。", 409);
      const list = w.attendees || [];
      if (list.some((a) => norm(a.name) === norm(p.name) || (a.email && a.email === p.email))) {
        return bad(c, "你已經報名過這場工作坊了，阿綸會再和你聯絡。", 409);
      }
      const a = {
        id: randomKey(8), ...p, instagram, note, source: "web",
        token: randomKey(16), // 學員之後用專屬網址查看自己的報名與匯款資訊
        // 有設定複訓價格的場次才讓客人選身分
        status: hasRetake(w) && body.status === "retake" ? "retake" : "new",
        region,
        attended: {}, certCode: null, certNo: null, addedAt: new Date(),
      };
      // 用 $push 加在最後，避免和其他人同時報名或後台修改時互相覆蓋
      await db.collection("workshops").updateOne({ _id: w._id }, { $push: { attendees: a }, $set: { updatedAt: new Date() } });
      purgeCached(c, "/api/workshops"); // 剩餘名額變了
      notifyWorkshopSignup(c, w, a);
      return c.json({ ok: true, ...signupView(w, a, await getPayment(db)) });
    });
  });

  // 學員用報名後拿到的專屬網址，再次查看自己的報名與匯款資訊
  app.get("/api/workshops/:id/signup/:aid", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const t = str(c.req.query("t"), 40);
      const w = await loadWorkshop(c, db);
      const a = w && t && (w.attendees || []).find((x) => x.id === c.req.param("aid") && x.token === t);
      if (!a) return bad(c, "找不到這筆報名，請確認網址是否完整，或 IG 私訊 @nieia4928。", 404);
      return c.json({ ok: true, ...signupView(w, a, await getPayment(db)) });
    })
  );

  // 前台查詢證書：證書編號＋姓名（中文或英文）都對，才給證書連結
  app.post("/api/certs/lookup", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從證書查詢頁送出。", 403);
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    if (body.website) return bad(c, "查不到這張證書。", 404); // 機器人陷阱欄位
    const no = str(body.no, 20).toUpperCase().replace(/\s+/g, "").replace(/^NO\.?/, "");
    const who = norm(str(body.name, 60));
    if (!NO_RE.test(no)) return bad(c, "證書編號的格式像 A-2026-001，請確認後再試。");
    if (!who) return bad(c, "請填寫證書上的姓名。");

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const tries = db.collection("certLookups");
      const recent = await tries.countDocuments({ ip: ip(c), at: { $gte: new Date(Date.now() - 3600e3) } });
      if (recent >= LOOKUP_PER_HOUR) return bad(c, "短時間內查詢太多次，請稍後再試，或 IG 私訊 @nieia4928。", 429);
      await tries.insertOne({ ip: ip(c), at: new Date() });

      const cert = await db.collection("certificates").findOne({ no }, { projection: { code: 1, name: 1, nameEn: 1 } });
      if (!cert || (norm(cert.name) !== who && norm(cert.nameEn) !== who)) {
        return bad(c, "查不到這張證書。請確認證書編號和姓名與證書上的一樣，或私訊 IG @nieia4928。", 404);
      }
      return c.json({ ok: true, code: cert.code });
    });
  });

  // 證書頁：只有拿到連結（含隨機代碼）的人看得到
  app.get("/api/certs/:code", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const code = str(c.req.param("code"), 20);
      const cert = code ? await db.collection("certificates").findOne({ code }) : null;
      if (!cert) return bad(c, "找不到這張證書，請確認連結是否完整。", 404);
      return c.json({ ok: true, cert: certView(cert, cert.photoKey) });
    })
  );

  app.get("/api/photos/:key", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const key = str(c.req.param("key"), 20);
      const p = key ? await db.collection("photos").findOne({ _id: key }) : null;
      if (!p) return c.body(null, 404);
      const bytes = p.data?.buffer ? new Uint8Array(p.data.buffer) : p.data;
      // 換照片時代碼會跟著換，所以可以放心讓瀏覽器長期留存
      return c.body(bytes, 200, {
        "Content-Type": p.type,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    })
  );

  // ---------- 線上簽到 ----------
  async function findSession(db, key) {
    if (!/^[a-z2-9]{10}$/.test(key)) return {};
    const w = await db.collection("workshops").findOne({ "sessions.key": key });
    if (!w) return {};
    const index = w.sessions.findIndex((s) => s.key === key);
    return { w, s: w.sessions[index], index };
  }

  function sessionInfo(w, s, index) {
    return {
      title: w.title,
      titleEn: w.titleEn,
      format: w.format,
      roomUrl: w.roomUrl || "",
      session: { date: s.date, start: s.start, end: s.end, index: index + 1, total: w.sessions.length },
      open: s.date === todayLocal(),
    };
  }

  app.get("/api/checkin/:key", (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      const { w, s, index } = await findSession(db, c.req.param("key"));
      if (!w) return bad(c, "找不到這堂課的簽到，請確認連結是否完整。", 404);
      return c.json({ ok: true, ...sessionInfo(w, s, index) });
    })
  );

  app.post("/api/checkin/:key", async (c) => {
    if (!sameOrigin(c)) return bad(c, "請從簽到頁送出。", 403);
    const body = await readBody(c);
    if (!body) return bad(c, "資料格式不正確。");
    if (body.website) return c.json({ ok: true }); // 機器人陷阱欄位
    const who = norm(str(body.name, 60));
    if (!who) return bad(c, "請填寫報名時的姓名或 Email。");

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const tries = db.collection("checkinAttempts");
      const recent = await tries.countDocuments({ ip: ip(c), at: { $gte: new Date(Date.now() - 3600e3) } });
      if (recent >= CHECKIN_PER_HOUR) return bad(c, "短時間內嘗試太多次，請稍後再試，或私訊阿綸協助簽到。", 429);
      await tries.insertOne({ ip: ip(c), at: new Date() });

      const { w, s, index } = await findSession(db, c.req.param("key"));
      if (!w) return bad(c, "找不到這堂課的簽到，請確認連結是否完整。", 404);
      if (s.date !== todayLocal()) return bad(c, `簽到只在上課當天（${s.date}）開放。`, 409);

      const attendees = w.attendees || [];
      const a = attendees.find((x) => norm(x.name) === who || norm(x.nameEn) === who || (x.email && norm(x.email) === who));
      if (!a) return bad(c, "名單上找不到這個名字。請輸入報名時填寫的姓名或 Email，或私訊阿綸協助簽到。", 404);

      const already = Boolean(a.attended?.[s.key]);
      if (!already) {
        // 只改這一位學員這一堂的出席，避免多人同時簽到時互相覆蓋
        await db.collection("workshops").updateOne(
          { _id: w._id, "attendees.id": a.id },
          { $set: { [`attendees.$.attended.${s.key}`]: { at: new Date(), by: "self" } } }
        );
      }
      return c.json({ ok: true, already, name: a.name, ...sessionInfo(w, s, index) });
    });
  });
}
