import { ObjectId } from "mongodb";
import { withDb } from "./db.js";
import { requireAdmin } from "./auth.js";

// 縮圖可選的圖案與色調（前台 glyphs.js 也有同一份清單）
export const GLYPHS = ["moon", "spiral", "constellation", "rings", "flame", "sun", "lotus", "wave", "heart", "paw", "blueprint", "door", "book", "card", "bag", "pen"];
export const PALETTES = ["g1", "g2", "g3", "g4", "g5", "g6"];
// 預約時依項目額外詢問的資料
export const EXTRAS = ["none", "magnified", "departed", "soulplan", "animal"];

// ---------- 欄位驗證 ----------
const F = {
  text: (max, required = false) => ({ type: "text", max, required }),
  int: (min, max) => ({ type: "int", min, max }),
  oneOf: (values, fallback) => ({ type: "enum", values, fallback }),
  bool: (fallback) => ({ type: "bool", fallback }),
  url: () => ({ type: "url" }),
};

function clean(schema, input, partial) {
  const out = {};
  const errors = [];
  for (const [key, rule] of Object.entries(schema.fields)) {
    const label = schema.labels[key] || key;
    if (!(key in input)) {
      if (partial) continue;
      if (rule.required) { errors.push(`請填寫${label}。`); continue; }
    }
    let v = input[key];
    switch (rule.type) {
      case "text": {
        v = v == null ? "" : String(v).trim();
        if (rule.required && !v) errors.push(`請填寫${label}。`);
        else if (v.length > rule.max) errors.push(`${label}最多 ${rule.max} 個字。`);
        out[key] = v;
        break;
      }
      case "int": {
        if (v === "" || v == null) { out[key] = null; break; }
        const n = Number(v);
        if (!Number.isInteger(n) || n < rule.min || n > rule.max) errors.push(`${label}要是 ${rule.min} 到 ${rule.max} 之間的整數。`);
        else out[key] = n;
        break;
      }
      case "enum":
        out[key] = rule.values.includes(v) ? v : rule.fallback;
        break;
      case "bool":
        out[key] = v === undefined ? rule.fallback : Boolean(v);
        break;
      case "url": {
        v = v == null ? "" : String(v).trim();
        if (v && !/^https:\/\/[^\s]+$/i.test(v)) errors.push(`${label}要是 https:// 開頭的網址。`);
        out[key] = v;
        break;
      }
    }
  }
  return { data: out, errors };
}

// ---------- 兩種資料的欄位 ----------
export const SCHEMAS = {
  services: {
    collection: "services",
    seedKey: "seed:services:v1",
    fields: {
      name: F.text(40, true),
      en: F.text(60),
      desc: F.text(300),
      category: F.oneOf(["energy", "blessing", "consult"], "energy"),
      duration: F.int(15, 480),
      priceMode: F.oneOf(["coming", "fixed", "inquiry"], "coming"),
      priceTwd: F.int(0, 1000000),
      priceMyr: F.int(0, 100000),
      extra: F.oneOf(EXTRAS, "none"),
      glyph: F.oneOf(GLYPHS, "lotus"),
      palette: F.oneOf(PALETTES, "g1"),
      published: F.bool(true),
    },
    labels: { name: "名稱", en: "英文名稱", desc: "介紹", duration: "療程長度", priceTwd: "台幣價格", priceMyr: "馬幣價格" },
    seed: [
      { name: "擴大療癒", extra: "magnified", en: "Magnified Healing®", desc: "連結觀音與宇宙源頭的能量，深入情緒與靈性層面，溫柔地清理與平衡。", category: "energy", glyph: "flame", palette: "g5" },
      { name: "聖火／卡魯那靈氣", en: "Holy Fire® Karuna Reiki", desc: "溫和而高頻的聖火能量，陪伴身心進入深層放鬆，協助淨化與調頻。", category: "energy", glyph: "sun", palette: "g2" },
      { name: "準提佛母火典", en: "Cundi Arathi", desc: "以準提佛母的火典儀式獻上祝福，為你的心願與生活帶來清淨的力量。", category: "blessing", glyph: "lotus", palette: "g4" },
      { name: "引渡之光", extra: "departed", en: "Light of Transmutation", desc: "為已逝的摯愛送上光與祝福，陪伴離開的人與留下的人，各自安心前行。", category: "blessing", glyph: "wave", palette: "g3" },
      { name: "靈魂藍圖諮詢", extra: "soulplan", en: "Soul Plan Consultation", desc: "從你的出生資料，看見這一世的天賦、挑戰與靈魂想走的方向。", category: "consult", glyph: "blueprint", palette: "g6" },
      { name: "動物溝通", extra: "animal", en: "Animal Communication", desc: "聆聽毛孩想說的話，理解牠的感受與需要，讓彼此的陪伴更靠近。", category: "consult", glyph: "paw", palette: "g1" },
    ],
  },
  products: {
    collection: "products",
    seedKey: "seed:products:v1",
    fields: {
      name: F.text(40, true),
      desc: F.text(300),
      priceTwd: F.int(0, 1000000),
      priceMyr: F.int(0, 100000),
      url: F.url(),
      glyph: F.oneOf(GLYPHS, "card"),
      palette: F.oneOf(PALETTES, "g2"),
      soldOut: F.bool(false),
      published: F.bool(true),
    },
    labels: { name: "名稱", desc: "介紹", priceTwd: "台幣價格", priceMyr: "馬幣價格", url: "購買連結" },
    seed: [
      ["紫色火焰", "flame", "g1"],
      ["YHWH 四字神名", "sun", "g5"],
      ["聖哲曼聖照", "lotus", "g4"],
      ["默基瑟德聖照", "constellation", "g6"],
      ["瑟拉貝斯彼聖照", "rings", "g2"],
    ].map(([name, glyph, palette]) => ({
      name, glyph, palette,
      desc: "105 × 148 mm 聖照卡，可放在聖壇、書桌或隨身帶著。",
      priceTwd: 300,
      url: "https://myship.7-11.com.tw/general/detail/GM2512190455934",
    })),
  },
};

// 第一次使用時，把網站原本的內容匯入資料庫（只做一次，之後刪光也不會再匯入）
const seeded = new Set(); // 同一個 Worker 執行個體內記住已檢查過，省下一次查詢
const EXTRA_BY_NAME = { "擴大療癒": "magnified", "引渡之光": "departed", "靈魂藍圖諮詢": "soulplan", "動物溝通": "animal" };
async function migrateExtras(db) {
  const settings = db.collection("settings");
  if (await settings.findOne({ _id: "migrate:services:extra:v1" })) return;
  const col = db.collection("services");
  const docs = await col.find({}).toArray();
  for (const d of docs) {
    if (d.extra === undefined) await col.updateOne({ _id: d._id }, { $set: { extra: EXTRA_BY_NAME[d.name] || "none" } });
  }
  try { await settings.insertOne({ _id: "migrate:services:extra:v1", at: new Date() }); } catch (err) { if (err.code !== 11000) throw err; }
}

async function seedOnce(db, schema) {
  if (seeded.has(schema.seedKey)) return;
  if (schema.collection === "services") await migrateExtras(db);
  const settings = db.collection("settings");
  if (await settings.findOne({ _id: schema.seedKey })) { seeded.add(schema.seedKey); return; }
  const col = db.collection(schema.collection);
  if ((await col.countDocuments({})) === 0) {
    const now = new Date();
    const docs = schema.seed.map((item, i) => ({ ...clean(schema, item, false).data, order: i + 1, createdAt: now, updatedAt: now }));
    if (docs.length) await col.insertMany(docs);
  }
  try {
    await settings.insertOne({ _id: schema.seedKey, at: new Date() });
  } catch (err) {
    if (err.code !== 11000) throw err; // 另一個請求同時完成了
  }
  seeded.add(schema.seedKey);
}

function present(doc) {
  const { _id, createdAt, updatedAt, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

const bad = (c, message, status = 400) => c.json({ ok: false, message }, status);
const parseId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
async function readJson(c) {
  try { return await c.req.json(); } catch { return null; }
}

const edgeCache = () => (typeof caches !== "undefined" ? caches.default : null);
const PUBLIC_TTL = 60;

function mountOne(app, publicPath, adminPath, schema) {
  const col = (db) => db.collection(schema.collection);
  const listAll = async (db) => (await col(db).find({}).sort({ order: 1 }).toArray()).map(present);
  const cacheKey = (c) => new Request(new URL(publicPath, c.req.url).toString());

  // 後台有變更時，清掉前台的快取，讓客人馬上看到新內容
  const purge = (c) => {
    const cache = edgeCache();
    if (cache) c.executionCtx.waitUntil(cache.delete(cacheKey(c)));
  };

  // 公開：只回傳已上架的
  app.get(publicPath, async (c) => {
    const cache = edgeCache();
    if (cache) {
      const hit = await cache.match(cacheKey(c));
      if (hit) return new Response(hit.body, { status: 200, headers: { "content-type": "application/json; charset=UTF-8", "x-cache": "hit" } });
    }
    return withDb(c.env, c.executionCtx, async (db) => {
      await seedOnce(db, schema);
      const docs = await col(db).find({ published: true }).sort({ order: 1 }).toArray();
      const body = JSON.stringify({ ok: true, items: docs.map(present) });
      if (cache) {
        c.executionCtx.waitUntil(cache.put(cacheKey(c), new Response(body, {
          headers: { "content-type": "application/json; charset=UTF-8", "cache-control": `public, max-age=${PUBLIC_TTL}` },
        })));
      }
      return new Response(body, { status: 200, headers: { "content-type": "application/json; charset=UTF-8" } });
    });
  });

  app.use(adminPath, requireAdmin);
  app.use(adminPath + "/*", requireAdmin);

  app.get(adminPath, (c) =>
    withDb(c.env, c.executionCtx, async (db) => {
      await seedOnce(db, schema);
      return c.json({ ok: true, items: await listAll(db) });
    })
  );

  app.post(adminPath, async (c) => {
    const body = await readJson(c);
    if (!body) return bad(c, "資料格式不正確。");
    const { data, errors } = clean(schema, body, false);
    if (errors.length) return bad(c, errors.join(" "));
    return withDb(c.env, c.executionCtx, async (db) => {
      const last = await col(db).find({}).sort({ order: -1 }).limit(1).toArray();
      const now = new Date();
      const doc = { ...data, order: (last[0]?.order || 0) + 1, createdAt: now, updatedAt: now };
      const res = await col(db).insertOne(doc);
      purge(c);
      return c.json({ ok: true, item: present({ ...doc, _id: res.insertedId }), items: await listAll(db) });
    });
  });

  app.patch(adminPath + "/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return bad(c, "找不到這個項目。", 404);
    const body = await readJson(c);
    if (!body) return bad(c, "資料格式不正確。");
    const { data, errors } = clean(schema, body, true);
    if (errors.length) return bad(c, errors.join(" "));
    return withDb(c.env, c.executionCtx, async (db) => {
      const doc = await col(db).findOne({ _id: id });
      if (!doc) return bad(c, "找不到這個項目，可能已經刪除了。", 404);
      await col(db).updateOne({ _id: id }, { $set: { ...data, updatedAt: new Date() } });
      purge(c);
      return c.json({ ok: true, item: present({ ...doc, ...data }), items: await listAll(db) });
    });
  });

  // 往上或往下移一格：和相鄰的項目交換順序
  app.post(adminPath + "/:id/move", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return bad(c, "找不到這個項目。", 404);
    const body = (await readJson(c)) || {};
    const up = body.direction === "up";
    return withDb(c.env, c.executionCtx, async (db) => {
      const doc = await col(db).findOne({ _id: id });
      if (!doc) return bad(c, "找不到這個項目，可能已經刪除了。", 404);
      const [next] = await col(db)
        .find({ order: up ? { $lt: doc.order } : { $gt: doc.order } })
        .sort({ order: up ? -1 : 1 })
        .limit(1)
        .toArray();
      if (!next) return c.json({ ok: true, moved: false, items: await listAll(db) });
      await Promise.all([
        col(db).updateOne({ _id: doc._id }, { $set: { order: next.order } }),
        col(db).updateOne({ _id: next._id }, { $set: { order: doc.order } }),
      ]);
      purge(c);
      return c.json({ ok: true, moved: true, items: await listAll(db) });
    });
  });

  app.delete(adminPath + "/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return bad(c, "找不到這個項目。", 404);
    return withDb(c.env, c.executionCtx, async (db) => {
      const doc = await col(db).findOne({ _id: id });
      if (!doc) return bad(c, "找不到這個項目，可能已經刪除了。", 404);
      await col(db).deleteOne({ _id: id });
      purge(c);
      return c.json({ ok: true, items: await listAll(db) });
    });
  });
}

export function mountCatalog(app) {
  mountOne(app, "/api/services", "/api/admin/services", SCHEMAS.services);
  mountOne(app, "/api/products", "/api/admin/products", SCHEMAS.products);
}
