import { Hono } from "hono";
import { MongoClient } from "mongodb";

// strict: false 讓 /api/health 和 /api/health/ 都能使用
const app = new Hono({ strict: false });

// 每個請求建立一個短暫的資料庫連線，用完即關閉。
// Cloudflare Worker 的請求彼此獨立，不能共用長期連線。
async function withDb(env, ctx, fn) {
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

// 連線測試：確認網站能連上 MongoDB Atlas。
app.get("/api/health", async (c) => {
  const started = Date.now();
  try {
    await withDb(c.env, c.executionCtx, (db) => db.command({ ping: 1 }));
    return c.json({ ok: true, database: "connected", ms: Date.now() - started });
  } catch (err) {
    const status = err.code === "NO_URI" ? 503 : 502;
    return c.json(
      {
        ok: false,
        database: err.code === "NO_URI" ? "not_configured" : "unreachable",
        message: err.code === "NO_URI"
          ? "請在 Cloudflare 的 Variables and Secrets 新增 MONGODB_URI。"
          : "無法連上資料庫，請確認連線字串、密碼與 Network Access 設定。",
        ms: Date.now() - started,
      },
      status
    );
  }
});

app.notFound((c) =>
  c.json({ ok: false, message: "找不到這個 API。", path: new URL(c.req.url).pathname }, 404)
);

export default app;
