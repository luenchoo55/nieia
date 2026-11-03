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
const QR_KEY_RE = /^[a-z2-9]{16}$/;
const MAX_QR_BYTES = 900 * 1024; // 後台會先縮小，收款碼通常 100–300 KB

function randomKey(len) {
  const abc = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

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
    // 收款碼圖片（例如 TNG／DuitNow QR）：圖片存在 photos，網址跟工作坊照片同一條路
    qr: m.qrKey ? `/api/photos/${m.qrKey}` : null,
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
        qrKey: QR_KEY_RE.test(m?.qrKey || "") ? m.qrKey : "",
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
  app.use("/api/admin/payment/*", requireAdmin);

  // 上傳收款碼圖片：先存起來拿到代碼，按「儲存」時才會掛到匯款方式上
  app.post("/api/admin/payment/qr", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(body?.dataUrl || "");
    if (!m) return bad(c, "請選擇 JPG、PNG 或 WebP 圖片。");
    const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > MAX_QR_BYTES) return bad(c, "圖片太大了，請換一張或裁小一點再上傳。", 413);
    return withDb(c.env, c.executionCtx, async (db) => {
      const key = randomKey(16);
      await db.collection("photos").insertOne({ _id: key, kind: "payment-qr", type: m[1], data: bytes, createdAt: new Date() });
      return c.json({ ok: true, qrKey: key, url: `/api/photos/${key}` });
    });
  });

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
      // 換掉或移除的收款碼圖片一起刪掉（上傳了但沒儲存的也一樣）
      const used = Object.values(regions).flat().map((x) => x.qrKey).filter(Boolean);
      await db.collection("photos").deleteMany({ kind: "payment-qr", _id: { $nin: used } });
      return c.json({ ok: true, regions });
    });
  });
}
