import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { withDb, ensureIndexes } from "./db.js";

const COOKIE = "nieia_admin";
const SESSION_DAYS = 7;
const MAX_FAILS = 5; // 15 分鐘內最多錯 5 次

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

// 登入憑證的簽章金鑰由後台密碼推導；更換密碼後，舊的登入會全部失效。
async function signingKey(env) {
  const raw = await sha256("nieia-session-v1:" + env.ADMIN_PASSWORD);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeToken(env) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = await crypto.subtle.sign("HMAC", await signingKey(env), enc.encode(payload));
  return payload + "." + b64url(sig);
}

async function readToken(env, token) {
  if (!token || !env.ADMIN_PASSWORD) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    const ok = await crypto.subtle.verify("HMAC", await signingKey(env), b64urlDecode(sig), enc.encode(payload));
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

function clientIp(c) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
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
  if (!(await readToken(c.env, getCookie(c, COOKIE)))) {
    return c.json({ ok: false, message: "請先登入後台。" }, 401);
  }
  if (c.req.method !== "GET" && !sameOrigin(c)) {
    return c.json({ ok: false, message: "這個請求不是從後台頁面送出的。" }, 403);
  }
  await next();
}

export function mountAuth(app) {
  app.get("/api/admin/me", async (c) => {
    if (!c.env.ADMIN_PASSWORD) {
      return c.json({ ok: false, configured: false, message: "請在 Cloudflare 的 Variables and Secrets 新增 ADMIN_PASSWORD。" }, 503);
    }
    const loggedIn = await readToken(c.env, getCookie(c, COOKIE));
    return c.json({ ok: true, configured: true, loggedIn });
  });

  app.post("/api/admin/login", async (c) => {
    if (!c.env.ADMIN_PASSWORD) {
      return c.json({ ok: false, message: "後台密碼尚未設定，請在 Cloudflare 新增 ADMIN_PASSWORD。" }, 503);
    }
    if (!sameOrigin(c)) return c.json({ ok: false, message: "請從後台頁面登入。" }, 403);

    let body = {};
    try { body = await c.req.json(); } catch { /* 空白或格式錯誤 */ }
    const password = typeof body.password === "string" ? body.password : "";
    const ip = clientIp(c);

    return withDb(c.env, c.executionCtx, async (db) => {
      await ensureIndexes(db);
      const attempts = db.collection("loginAttempts");
      const since = new Date(Date.now() - 15 * 60 * 1000);
      const fails = await attempts.countDocuments({ ip, at: { $gte: since } });
      if (fails >= MAX_FAILS) {
        return c.json({ ok: false, message: "密碼錯誤次數太多，請 15 分鐘後再試。" }, 429);
      }

      const ok = equalBytes(await sha256(password), await sha256(c.env.ADMIN_PASSWORD));
      if (!ok) {
        await attempts.insertOne({ ip, at: new Date() });
        const left = MAX_FAILS - fails - 1;
        return c.json({
          ok: false,
          message: left > 0 ? `密碼不正確，還可以再試 ${left} 次。` : "密碼錯誤次數太多，請 15 分鐘後再試。",
        }, 401);
      }

      await attempts.deleteMany({ ip });
      setCookie(c, COOKIE, await makeToken(c.env), {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/",
        maxAge: SESSION_DAYS * 86400,
      });
      return c.json({ ok: true });
    });
  });

  app.post("/api/admin/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  });
}
