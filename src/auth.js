import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { withDb, ensureIndexes } from "./db.js";
import { notifyLoginLocked } from "./notify.js";

const COOKIE = "nieia_admin";
const SESSION_HOURS = 12; // 登入後最多 12 小時
const IDLE_MS = 60 * 60 * 1000; // 閒置 1 小時自動登出
const TOUCH_MS = 60 * 1000; // 最後活動時間每分鐘最多更新一次
const MAX_FAILS = 5; // 同一個 IP：15 分鐘內最多錯 5 次
const IP_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX_FAILS = 10; // 全站：1 小時內錯超過 10 次就鎖住後台登入
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

// 比較時花費固定時間，避免從回應時間猜出密碼
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 還缺哪個 Secret；都設好了就回傳 null
function missingSecret(env) {
  if (!env.ADMIN_PASSWORD) return "ADMIN_PASSWORD";
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return "SESSION_SECRET";
  return null;
}
const SETUP_MESSAGE = {
  ADMIN_PASSWORD: "請在 Cloudflare 的 Variables and Secrets 新增 ADMIN_PASSWORD（後台密碼）。",
  SESSION_SECRET: "請在 Cloudflare 的 Variables and Secrets 新增 SESSION_SECRET（至少 32 個字元的隨機字串）。",
};

// 登入憑證用獨立的 SESSION_SECRET 簽章，與後台密碼無關
function signingKey(env) {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Cookie 內容：登入紀錄編號.簽章
async function makeToken(env, sid) {
  const sig = await crypto.subtle.sign("HMAC", await signingKey(env), enc.encode(sid));
  return sid + "." + b64url(sig);
}

// 簽章正確才回傳登入紀錄編號，否則回傳 null（不必查資料庫）
async function readToken(env, token) {
  if (!token || missingSecret(env)) return null;
  const [sid, sig] = token.split(".");
  if (!sid || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await signingKey(env), b64urlDecode(sig), enc.encode(sid));
    return ok ? sid : null;
  } catch {
    return null;
  }
}

// 到資料庫確認登入紀錄還有效；touch 為 true 時更新最後活動時間
async function findSession(db, sid, touch) {
  const s = await db.collection("adminSessions").findOne({ _id: sid });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || now - s.lastSeenAt.getTime() > IDLE_MS) {
    await db.collection("adminSessions").deleteOne({ _id: sid });
    return null;
  }
  if (touch && now - s.lastSeenAt.getTime() > TOUCH_MS) {
    await db.collection("adminSessions").updateOne({ _id: sid }, { $set: { lastSeenAt: new Date(now) } });
  }
  return s;
}

function clientIp(c) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
}

// 後台自動更新（例如擺攤排隊每 15 秒刷新）會帶這個標頭，不算一次「有動作」
function isBackground(c) {
  return c.req.header("x-nieia-background") === "1";
}

// 會改變資料的請求，只接受來自本站頁面的呼叫
export function sameOrigin(c) {
  const origin = c.req.header("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

export async function requireAdmin(c, next) {
  const sid = await readToken(c.env, getCookie(c, COOKIE));
  if (!sid) return c.json({ ok: false, message: "請先登入後台。" }, 401);
  // 檢查登入和後面的處理共用同一個資料庫連線
  return withDb(c.env, c.executionCtx, async (db) => {
    await ensureIndexes(db);
    if (!(await findSession(db, sid, !isBackground(c)))) {
      deleteCookie(c, COOKIE, { path: "/", secure: true });
      return c.json({ ok: false, message: "登入已過期，請重新登入。" }, 401);
    }
    if (c.req.method !== "GET" && !sameOrigin(c)) {
      return c.json({ ok: false, message: "這個請求不是從後台頁面送出的。" }, 403);
    }
    await next();
  });
}

export function mountAuth(app) {
  app.get("/api/admin/me", async (c) => {
    const missing = missingSecret(c.env);
    if (missing) return c.json({ ok: false, configured: false, missing, message: SETUP_MESSAGE[missing] }, 503);
    const sid = await readToken(c.env, getCookie(c, COOKIE));
    if (!sid) return c.json({ ok: true, configured: true, loggedIn: false });
    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const loggedIn = !!(await findSession(db, sid, !isBackground(c)));
      if (!loggedIn) deleteCookie(c, COOKIE, { path: "/", secure: true });
      return c.json({ ok: true, configured: true, loggedIn });
    });
  });

  app.post("/api/admin/login", async (c) => {
    const missing = missingSecret(c.env);
    if (missing) return c.json({ ok: false, message: SETUP_MESSAGE[missing] }, 503);
    if (!sameOrigin(c)) return c.json({ ok: false, message: "請從後台頁面登入。" }, 403);

    let body = {};
    try { body = await c.req.json(); } catch { /* 空白或格式錯誤 */ }
    const password = typeof body.password === "string" ? body.password : "";
    const ip = clientIp(c);

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const fails = db.collection("loginFails");
      const now = Date.now();
      const globalFails = await fails.countDocuments({ at: { $gte: new Date(now - GLOBAL_WINDOW_MS) } });
      if (globalFails > GLOBAL_MAX_FAILS) {
        return c.json({ ok: false, message: "後台登入因為錯誤次數太多暫時鎖住，最多 1 小時後會自動解鎖。" }, 429);
      }
      const ipFails = await fails.countDocuments({ ip, at: { $gte: new Date(now - IP_WINDOW_MS) } });
      if (ipFails >= MAX_FAILS) {
        return c.json({ ok: false, message: "密碼錯誤次數太多，請 15 分鐘後再試。" }, 429);
      }

      const ok = equalBytes(await sha256(password), await sha256(c.env.ADMIN_PASSWORD));
      if (!ok) {
        await fails.insertOne({ ip, at: new Date() });
        if (globalFails + 1 > GLOBAL_MAX_FAILS) {
          await notifyLockOnce(c, db);
          return c.json({ ok: false, message: "後台登入因為錯誤次數太多暫時鎖住，最多 1 小時後會自動解鎖。" }, 429);
        }
        const left = MAX_FAILS - ipFails - 1;
        return c.json({
          ok: false,
          message: left > 0 ? `密碼不正確，還可以再試 ${left} 次。` : "密碼錯誤次數太多，請 15 分鐘後再試。",
        }, 401);
      }

      await fails.deleteMany({ ip });
      const sid = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const at = new Date();
      await db.collection("adminSessions").insertOne({
        _id: sid,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(at.getTime() + SESSION_HOURS * 3600 * 1000),
        ip,
        userAgent: (c.req.header("user-agent") || "").slice(0, 300),
      });
      setCookie(c, COOKIE, await makeToken(c.env, sid), {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/",
        maxAge: SESSION_HOURS * 3600,
      });
      return c.json({ ok: true });
    });
  });

  // 登出：刪掉資料庫裡這筆登入紀錄，就算 Cookie 被複製走也不能再用
  app.post("/api/admin/logout", async (c) => {
    const sid = await readToken(c.env, getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/", secure: true });
    if (sid) await withDb(c.env, c.executionCtx, (db) => db.collection("adminSessions").deleteOne({ _id: sid }));
    return c.json({ ok: true });
  });

  // 登出所有裝置：刪掉全部登入紀錄
  app.post("/api/admin/logout-all", requireAdmin, async (c) => {
    const r = await withDb(c.env, c.executionCtx, (db) => db.collection("adminSessions").deleteMany({}));
    deleteCookie(c, COOKIE, { path: "/", secure: true });
    return c.json({ ok: true, count: r.deletedCount });
  });
}

// 同一次鎖定只寄一封通知信：鎖定紀錄 1 小時內寄過就不再寄
async function notifyLockOnce(c, db) {
  const now = new Date();
  try {
    await db.collection("loginLocks").updateOne(
      { _id: "global", $or: [{ notifiedAt: { $lt: new Date(now - GLOBAL_WINDOW_MS) } }, { notifiedAt: { $exists: false } }] },
      { $set: { notifiedAt: now } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code === 11000) return; // 已經寄過
    throw err;
  }
  const byIp = await db.collection("loginFails").aggregate([
    { $match: { at: { $gte: new Date(now - GLOBAL_WINDOW_MS) } } },
    { $group: { _id: "$ip", count: { $sum: 1 }, last: { $max: "$at" } } },
    { $sort: { count: -1 } },
  ]).toArray();
  notifyLoginLocked(c, { at: now, total: byIp.reduce((n, r) => n + r.count, 0), byIp });
}
