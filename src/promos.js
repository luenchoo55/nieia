import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";
import "../public/assets/promo-calc.js";

// 收銀優惠設定：特價商品、滿額禮、整筆訂單折扣、手動折扣、組合價、套餐組合，存在 settings 的 "promos"。
// 計算邏輯在 public/assets/promo-calc.js，後台收銀頁與這裡的結帳共用。

const KEY = "promos";
export const computePromos = (...args) => globalThis.nieiaPromo.compute(...args);

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const amt = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10000000 ? n : null;
};
const id = (v) => (/^[A-Za-z0-9_-]{1,24}$/.test(String(v || "")) ? String(v) : Math.random().toString(36).slice(2, 10));
const refs = (v) => (Array.isArray(v) ? v.filter((r) => /^(product|service):[0-9a-f]{24}$/.test(r)).slice(0, 30) : []);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export const EMPTY = {
  sale: { enabled: false, items: [] },
  gift: { enabled: false, mode: "highest", tiers: [] },
  orderDiscount: { enabled: false, options: [] },
  manual: { enabled: false },
  bundles: { enabled: false, items: [] },
  sets: { enabled: false, items: [] },
};

function clean(b) {
  b = b || {};
  return {
    sale: {
      enabled: !!b.sale?.enabled,
      items: list(b.sale?.items, 20).map((x) => {
        const p = Number(x.pct);
        return { id: id(x.id), on: x.on !== false, name: str(x.name, 30), refs: refs(x.refs), pct: Number.isInteger(p) && p > 0 && p < 100 ? p : null, twd: amt(x.twd), myr: amt(x.myr) };
      }),
    },
    gift: {
      enabled: !!b.gift?.enabled,
      mode: b.gift?.mode === "all" ? "all" : "highest",
      tiers: list(b.gift?.tiers, 10).map((t) => ({ id: id(t.id), on: t.on !== false, twd: amt(t.twd), myr: amt(t.myr), gift: str(t.gift, 40) })),
    },
    orderDiscount: {
      enabled: !!b.orderDiscount?.enabled,
      options: list(b.orderDiscount?.options, 10).map((o) => {
        const p = Number(o.percent);
        return { id: id(o.id), on: o.on !== false, label: str(o.label, 20), percent: Number.isInteger(p) && p > 0 && p < 100 ? p : null };
      }),
    },
    manual: { enabled: !!b.manual?.enabled },
    bundles: {
      enabled: !!b.bundles?.enabled,
      items: list(b.bundles?.items, 20).map((x) => {
        const q = Number(x.qty);
        return { id: id(x.id), on: x.on !== false, name: str(x.name, 30), refs: refs(x.refs), qty: Number.isInteger(q) && q >= 2 && q <= 100 ? q : null, twd: amt(x.twd), myr: amt(x.myr) };
      }),
    },
    sets: {
      enabled: !!b.sets?.enabled,
      items: list(b.sets?.items, 20).map((x) => ({ id: id(x.id), on: x.on !== false, name: str(x.name, 30), refs: refs(x.refs), twd: amt(x.twd), myr: amt(x.myr) })),
    },
  };
}

function problems(p) {
  const out = [];
  p.sale.items.forEach((x, i) => {
    const n = x.name || `第 ${i + 1} 個`;
    if (!x.name) out.push(`特價商品第 ${i + 1} 個：請填寫名稱。`);
    if (!x.refs.length) out.push(`特價「${n}」：請選擇商品。`);
    if (x.pct == null && x.twd == null && x.myr == null) out.push(`特價「${n}」：請填寫折數或特價。`);
  });
  p.gift.tiers.forEach((t, i) => {
    if (!t.gift) out.push(`滿額禮第 ${i + 1} 階：請填寫贈品。`);
    if (t.twd == null && t.myr == null) out.push(`滿額禮第 ${i + 1} 階：請填寫門檻金額。`);
  });
  p.orderDiscount.options.forEach((o, i) => {
    if (o.percent == null) out.push(`整筆折扣第 ${i + 1} 個：折數請填 1–99（例如 9 折填 90）。`);
  });
  p.bundles.items.forEach((x, i) => {
    const n = x.name || `第 ${i + 1} 組`;
    if (!x.name) out.push(`組合價第 ${i + 1} 組：請填寫名稱。`);
    if (!x.refs.length) out.push(`組合價「${n}」：請選擇商品。`);
    if (x.qty == null) out.push(`組合價「${n}」：件數請填 2 以上。`);
    if (x.twd == null && x.myr == null) out.push(`組合價「${n}」：請填寫優惠價。`);
  });
  p.sets.items.forEach((x, i) => {
    const n = x.name || `第 ${i + 1} 組`;
    if (!x.name) out.push(`套餐組合第 ${i + 1} 組：請填寫名稱。`);
    if (x.refs.length < 2) out.push(`套餐「${n}」：至少選兩樣。`);
    if (x.twd == null && x.myr == null) out.push(`套餐「${n}」：請填寫套餐價。`);
  });
  return out;
}

export async function getPromos(db) {
  const doc = await db.collection("settings").findOne({ _id: KEY });
  return { ...EMPTY, ...(doc?.promos || {}) };
}

export function mountPromos(app) {
  app.use("/api/admin/promos", requireAdmin);

  app.get("/api/admin/promos", (c) =>
    withDb(c.env, c.executionCtx, async (db) => c.json({ ok: true, promos: await getPromos(db) }))
  );

  app.put("/api/admin/promos", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return bad(c, "資料格式不正確。"); }
    const promos = clean(body.promos);
    const errs = problems(promos);
    if (errs.length) return bad(c, errs.join(" "));
    return withDb(c.env, c.executionCtx, async (db) => {
      await db.collection("settings").updateOne({ _id: KEY }, { $set: { promos, updatedAt: new Date() } }, { upsert: true });
      return c.json({ ok: true, promos });
    });
  });
}
