import { Hono } from "hono";
import { withDb } from "./db.js";
import { mountAuth } from "./auth.js";
import { mountSlots } from "./slots.js";
import { mountCatalog } from "./catalog.js";
import { mountBookings } from "./bookings.js";
import { mountMarket } from "./market.js";
import { mountWorkshops } from "./workshops.js";
import { mountPayment } from "./payment.js";
import { mountLedger } from "./ledger.js";
import { mountNotes } from "./notes.js";
import { mountOverview } from "./overview.js";

// strict: false 讓 /api/health 和 /api/health/ 都能使用
const app = new Hono({ strict: false });

// 後台與 API 的回應不讓瀏覽器或搜尋引擎留存
app.use("/api/*", async (c, next) => {
  await next();
  // 工作坊大合照的網址換照片就會換，可以讓瀏覽器留存；其他一律不留存
  if (!(c.req.path.startsWith("/api/photos/") && c.res.status === 200)) c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
});

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

mountAuth(app);
mountSlots(app);
mountCatalog(app);
mountBookings(app);
mountMarket(app);
mountWorkshops(app);
mountPayment(app);
mountLedger(app);
mountNotes(app);
mountOverview(app);

app.notFound((c) =>
  c.json({ ok: false, message: "找不到這個 API。", path: new URL(c.req.url).pathname }, 404)
);

// 資料庫連不上或其他未預期的錯誤，回傳看得懂的訊息
app.onError((err, c) => {
  console.error(err);
  if (err.code === "NO_URI") {
    return c.json({ ok: false, message: "資料庫尚未設定，請在 Cloudflare 新增 MONGODB_URI。" }, 503);
  }
  return c.json({ ok: false, message: "伺服器暫時無法處理，請稍後再試。" }, 500);
});

export default app;
