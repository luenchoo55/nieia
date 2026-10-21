import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";

// 匯款方式：後台設定，預約療癒與工作坊報名共用。
// 只在客人送出預約或報名之後才提供，不放在公開頁面上。

const KEY = "payment";
export const REGIONS = {
  TW: { label: "台灣匯款", name: "台灣", currency: "TWD" },
  MY: { label: "馬來西亞匯款", name: "馬來西亞", currency: "MYR" },
};
const MAX_METHODS = 8;

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));

// 還沒在後台設定過時，沿用原本寫在程式裡的帳號
const DEFAULT = {
  TW: [
    { name: "銀行轉帳", details: "銀行：玉山銀行（代碼 808）\n帳號：0417968137184\n戶名：朱〇綸", linkLabel: "", linkUrl: "", enabled: true },
    { name: "iPass Money 或 LINE Pay", details: "LINE ID：Noxchoo\n請先加入 LINE 好友，再用 iPass Money 或 LINE Pay 付款", linkLabel: "加入 LINE 好友", linkUrl: "https://line.me/ti/p/~Noxchoo", enabled: true },
  ],
  MY: [
    { name: "銀行轉帳", details: "銀行：Hong Leong Bank\n帳號：20100081235\n戶名：CHOO WEI LUEN", linkLabel: "", linkUrl: "", enabled: true },
    { name: "TNG", details: "稍後開放", linkLabel: "", linkUrl: "", enabled: false },
  ],
};

export async function getPayment(db) {
  const doc = await db.collection("settings").findOne({ _id: KEY });
  return doc?.regions || DEFAULT;
}

// 「標籤：內容」的行拆成兩欄（帳號可以一鍵複製），其他行原樣顯示
function lines(details) {
  return String(details || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    return m ? [m[1].trim(), m[2].trim()] : ["", s];
  });
}

// 給客人看的：只列出開啟的方式
export function publicPayment(regions, region) {
  const r = REGIONS[region];
  if (!r) return null;
  const methods = (regions[region] || []).filter((m) => m.enabled).map((m) => ({
    name: m.name,
    lines: lines(m.details),
    link: m.linkUrl ? { label: m.linkLabel || "前往", url: m.linkUrl } : null,
  }));
  return { label: r.label, currency: r.currency, methods };
}

function cleanRegions(input) {
  const errors = [];
  const out = {};
  for (const region of Object.keys(REGIONS)) {
    const list = Array.isArray(input?.[region]) ? input[region] : [];
    if (list.length > MAX_METHODS) errors.push(`${REGIONS[region].name}最多 ${MAX_METHODS} 種匯款方式。`);
    out[region] = list.slice(0, MAX_METHODS).map((m, i) => {
      const item = {
        name: str(m?.name, 40),
        details: str(m?.details, 600),
        linkLabel: str(m?.linkLabel, 20),
        linkUrl: str(m?.linkUrl, 300),
        enabled: m?.enabled !== false,
      };
      const where = `${REGIONS[region].name}第 ${i + 1} 個`;
      if (!item.name) errors.push(`${where}匯款方式請填寫名稱。`);
      if (item.linkUrl && !/^https:\/\/[^\s]+$/i.test(item.linkUrl)) errors.push(`${where}匯款方式的連結要是 https:// 開頭的網址。`);
      return item;
    });
  }
  return { regions: out, errors };
}

export function mountPayment(app) {
  app.use("/api/admin/payment", requireAdmin);

  app.get("/api/admin/payment", (c) =>
    withDb(c.env, c.executionCtx, async (db) => c.json({ ok: true, regions: await getPayment(db) }))
  );

  app.put("/api/admin/payment", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const { regions, errors } = cleanRegions(body?.regions);
    if (errors.length) return bad(c, errors.join(" "));
    return withDb(c.env, c.executionCtx, async (db) => {
      await db.collection("settings").updateOne({ _id: KEY }, { $set: { regions, updatedAt: new Date() } }, { upsert: true });
      return c.json({ ok: true, regions });
    });
  });
}
