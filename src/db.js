import { MongoClient } from "mongodb";

// 每個請求建立一個短暫的資料庫連線，用完即關閉。
// Cloudflare Worker 的請求彼此獨立，不能共用長期連線。
export async function withDb(env, ctx, fn) {
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
    return await fn(client.db(env.DB_NAME || "nieia"));
  } finally {
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
    db.collection("loginAttempts").createIndex({ at: 1 }, { expireAfterSeconds: 900 }),
    db.collection("loginAttempts").createIndex({ ip: 1, at: 1 }),
    db.collection("services").createIndex({ order: 1 }),
    db.collection("products").createIndex({ order: 1 }),
    db.collection("bookings").createIndex({ ref: 1 }, { unique: true }),
    db.collection("bookings").createIndex({ startAt: 1 }),
    db.collection("bookings").createIndex({ ip: 1, createdAt: 1 }),
    db.collection("tickets").createIndex({ sessionId: 1, status: 1, number: 1 }),
  ]);
  indexesReady = true;
}
