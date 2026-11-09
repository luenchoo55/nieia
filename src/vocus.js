import { cachedJson } from "./db.js";

// 方格子沙龍「最新文章」：網站後端去方格子抓，前台再向 /api/vocus 拿。
// 方格子不讓別的網站從瀏覽器直接讀，所以由這裡代抓。
// 抓到的結果在 Cloudflare 存 1 小時；抓成功就把結果存進資料庫，
// 之後方格子抓不到時改用資料庫裡上一次的文章，網站不會壞掉。
export const SALON_ID = "67e4f401fd897800019395cf";
export const SALON_URL = `https://vocus.cc/salon/${SALON_ID}`;
const SOURCE = `https://api.vocus.cc/api/contents?num=20&page=1&salonId=${SALON_ID}`;
const SHOW = 6;
const FRESH_SEC = 60 * 60;
const SAVED_ID = "vocusArticles";

// 只留「文章」，短文不放；整理成前台需要的欄位
export function pickArticles(data) {
  const list = Array.isArray(data?.contents) ? data.contents : [];
  return list
    .filter((x) => x && x.type === "article" && x.article?._id && x.title && !x.spam && !x.adult)
    .sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt)))
    .slice(0, SHOW)
    .map((x) => {
      const a = x.article;
      return {
        id: a._id,
        title: String(x.title).trim(),
        date: x.publishAt || a.lastPublishAt || null,
        url: `https://vocus.cc/article/${a._id}`,
      };
    });
}

async function fetchLatest() {
  const res = await fetch(SOURCE, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; nieia-site)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`vocus ${res.status}`);
  const items = pickArticles(await res.json());
  if (!items.length) throw new Error("vocus: no articles");
  return items;
}

export function mountVocus(app) {
  app.get("/api/vocus", (c) =>
    cachedJson(c, "/api/vocus", FRESH_SEC, async (db) => {
      const settings = db.collection("settings");
      try {
        const items = await fetchLatest();
        await settings.updateOne({ _id: SAVED_ID }, { $set: { items, savedAt: new Date() } }, { upsert: true });
        return { ok: true, salonUrl: SALON_URL, items, source: "live" };
      } catch (err) {
        console.error("vocus fetch failed:", err.message);
        const saved = await settings.findOne({ _id: SAVED_ID });
        return { ok: true, salonUrl: SALON_URL, items: saved?.items || [], source: saved ? "saved" : "none" };
      }
    })
  );
}
