import { MongoClient } from "mongodb";

// 每個請求建立一個短暫的資料庫連線，用完即關閉。
// Cloudflare Worker 的請求彼此獨立，不能共用長期連線。
// 同一個請求裡（例如後台先檢查登入、再處理資料）重複呼叫時，沿用外層已開好的連線。
const openDbs = new WeakMap();

export async function withDb(env, ctx, fn) {
  const shared = ctx && openDbs.get(ctx);
  if (shared) return fn(shared);
  if (!env.MONGODB_URI) {
    const err = new Error("尚未設定 MONGODB_URI");
    err.code = "NO_URI";
    throw err;
  }
  const client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 8000,
  });
  try {
    await client.connect();
    const db = client.db(env.DB_NAME || "nieia");
    openDbs.set(ctx, db);
    return await fn(db);
  } finally {
    openDbs.delete(ctx);
    ctx.waitUntil(client.close());
  }
}

// 建立索引只需做一次；同一個 Worker 執行個體內記住已完成。
let indexesReady = false;
export async function ensureIndexes(db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection("availability").createIndex({ startAt: 1 }),
    db.collection("availability").createIndex({ status: 1, startAt: 1 }),
    // 登入失敗紀錄保留 1 小時（舊的 loginAttempts 是 15 分鐘，會自己清空）
    db.collection("loginFails").createIndex({ at: 1 }, { expireAfterSeconds: 3600 }),
    db.collection("loginFails").createIndex({ ip: 1, at: 1 }),
    db.collection("adminSessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("services").createIndex({ order: 1 }),
    db.collection("products").createIndex({ order: 1 }),
    db.collection("bookings").createIndex({ ref: 1 }, { unique: true }),
    db.collection("bookings").createIndex({ startAt: 1 }),
    db.collection("bookings").createIndex({ ip: 1, createdAt: 1 }),
    db.collection("tickets").createIndex({ sessionId: 1, status: 1, number: 1 }),
    db.collection("workshops").createIndex({ firstDate: -1 }),
    db.collection("workshops").createIndex({ "sessions.key": 1 }),
    db.collection("certificates").createIndex({ code: 1 }, { unique: true }),
    db.collection("certificates").createIndex({ no: 1 }, { unique: true }),
    db.collection("certificates").createIndex({ workshopId: 1 }),
    db.collection("certificates").createIndex({ issuedAt: -1 }),
    db.collection("checkinAttempts").createIndex({ at: 1 }, { expireAfterSeconds: 3600 }),
    db.collection("checkinAttempts").createIndex({ ip: 1, at: 1 }),
    db.collection("signupAttempts").createIndex({ at: 1 }, { expireAfterSeconds: 3600 }),
    db.collection("signupAttempts").createIndex({ ip: 1, at: 1 }),
    db.collection("certLookups").createIndex({ at: 1 }, { expireAfterSeconds: 3600 }),
    db.collection("certLookups").createIndex({ ip: 1, at: 1 }),
    db.collection("caseNotes").createIndex({ bookingId: 1 }),
    db.collection("ledger").createIndex({ date: -1 }),
  ]);
  indexesReady = true;
}

// 前台公開資料的快取：有存過就馬上回傳，超過 freshSec 秒才在背景重新查資料庫，
// 客人不必等連線資料庫（每次連線要 2～3 秒）。後台有變更時用 purgeCached 清掉。
const edgeCache = () => (typeof caches !== "undefined" ? caches.default : null);
const cacheKey = (c, path) => new Request(new URL(path, c.req.url).toString());
const JSON_TYPE = "application/json; charset=UTF-8";

export async function cachedJson(c, path, freshSec, load) {
  const cache = edgeCache();
  const key = cacheKey(c, path);
  const refresh = async () => {
    const body = JSON.stringify(await withDb(c.env, c.executionCtx, load));
    if (cache) {
      await cache.put(key, new Response(body, {
        headers: { "content-type": JSON_TYPE, "cache-control": "public, max-age=86400", "x-saved-at": String(Date.now()) },
      }));
    }
    return body;
  };
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const stale = Date.now() - Number(hit.headers.get("x-saved-at") || 0) > freshSec * 1000;
      if (stale) c.executionCtx.waitUntil(refresh().catch((err) => console.error(err)));
      return new Response(hit.body, { headers: { "content-type": JSON_TYPE, "x-cache": stale ? "stale" : "hit" } });
    }
  }
  return new Response(await refresh(), { headers: { "content-type": JSON_TYPE, "x-cache": "miss" } });
}

export function purgeCached(c, path) {
  const cache = edgeCache();
  if (cache) c.executionCtx.waitUntil(cache.delete(cacheKey(c, path)));
}
