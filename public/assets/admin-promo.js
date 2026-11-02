// 後台：優惠設定（收支分頁裡的「優惠設定」）。改完按「儲存優惠設定」，收銀結帳時自動套用
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  var U = window.NieiaUI;
  if (!A || !U) return;
  var el = U.el, button = U.button;

  var $ = function (id) { return document.getElementById(id); };
  var promos = null, catalog = [], dirty = false;

  function uid() { return Math.random().toString(36).slice(2, 10); }

  var TYPES = [
    { key: "sale", icon: "特", palette: "g4", title: "特價商品", desc: "指定商品直接打折或改成特價，例如所有中卡半價。", list: "items", unit: "個" },
    { key: "gift", icon: "禮", palette: "g2", title: "滿額禮", desc: "折扣後的總額達到門檻時提醒送贈品，並印在收據上。", list: "tiers", unit: "階" },
    { key: "orderDiscount", icon: "%", palette: "g5", title: "整筆訂單折扣", desc: "啟用的折扣會出現在購物車讓你選，例如 9 折。", list: "options", unit: "個" },
    { key: "manual", icon: "−", palette: "g3", title: "手動折扣", desc: "結帳時手動輸入要減多少，可以和整筆折扣一起用。" },
    { key: "bundles", icon: "組", palette: "g1", title: "組合價", desc: "指定商品數量達到門檻時套用優惠價，例如明信片 3 張 100；也可以多款合併，例如小卡任選 6 張 300。", list: "items", unit: "組" },
    { key: "sets", icon: "套", palette: "g6", title: "套餐組合", desc: "把不同商品或療癒項目搭成一組自訂價，例如 A＋B＋C 一組 1000。", list: "items", unit: "組" },
  ];

  function load() {
    return Promise.all([A.api("/api/admin/promos"), A.api("/api/admin/products"), A.api("/api/admin/services")]).then(function (r) {
      if (!U.guard(r[0]) || !U.guard(r[1]) || !U.guard(r[2])) return;
      promos = r[0].promos;
      catalog = r[1].items.map(function (p) { return { ref: "product:" + p.id, name: p.name, kind: "商品" }; })
        .concat(r[2].items.filter(function (s) { return s.priceMode === "fixed"; }).map(function (s) { return { ref: "service:" + s.id, name: s.name, kind: "療癒" }; }));
      dirty = false;
      $("promoMsg").textContent = "";
      render();
    });
  }

  function changed() {
    dirty = true;
    $("promoSave").textContent = "儲存優惠設定（尚未儲存）";
  }

  // ---------- 小元件 ----------
  function input(value, attrs, onInput) {
    var i = el("input");
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    i.value = value == null ? "" : value;
    i.addEventListener("input", function () { onInput(i.value); changed(); });
    return i;
  }
  function num(value, label, onInput, ph) {
    return input(value, { type: "number", inputmode: "numeric", min: "0", step: "1", "aria-label": label, placeholder: ph || "" }, function (v) { onInput(v === "" ? null : Number(v)); });
  }
  function toggle(on, onChange, labels) {
    labels = labels || ["啟用中", "未啟用"];
    var b = button(on ? labels[0] : labels[1], "promo-toggle" + (on ? " is-on" : ""));
    b.setAttribute("aria-pressed", String(!!on));
    b.addEventListener("click", function () { onChange(!on); changed(); render(); });
    return b;
  }
  function removeBtn(list, item) {
    var b = button("×", "promo-x");
    b.setAttribute("aria-label", "刪除");
    b.addEventListener("click", function () { list.splice(list.indexOf(item), 1); changed(); render(); });
    return b;
  }
  function priceInputs(item, ph) {
    var w = el("span", "promo-prices");
    w.appendChild(el("span", "promo-cur", "NT$"));
    w.appendChild(num(item.twd, "台幣金額", function (v) { item.twd = v; }, ph));
    w.appendChild(el("span", "promo-cur", "RM"));
    w.appendChild(num(item.myr, "馬幣金額", function (v) { item.myr = v; }, "選填"));
    return w;
  }
  // 選擇適用的商品／療癒項目
  function refPicker(item) {
    var box = el("div", "promo-refs");
    if (!catalog.length) { box.appendChild(el("span", "hint", "還沒有商品或定價的療癒項目。")); return box; }
    item.refs = item.refs || [];
    catalog.forEach(function (c) {
      var on = item.refs.indexOf(c.ref) >= 0;
      var b = button(c.name, "chip");
      b.setAttribute("aria-pressed", String(on));
      b.title = c.kind;
      b.addEventListener("click", function () {
        if (on) item.refs.splice(item.refs.indexOf(c.ref), 1); else item.refs.push(c.ref);
        changed(); render();
      });
      box.appendChild(b);
    });
    return box;
  }
  function field(label, node, cls) {
    var w = el("label", "promo-field" + (cls ? " " + cls : ""));
    w.appendChild(el("span", null, label));
    w.appendChild(node);
    return w;
  }
  function addBtn(text, onClick) {
    return button("＋ " + text, "mini promo-add", function () { onClick(); changed(); render(); });
  }

  // ---------- 各種優惠的內容 ----------
  var BODY = {
    sale: function (cfg, body) {
      cfg.items.forEach(function (x) {
        var row = el("div", "promo-item" + (x.on ? "" : " is-off"));
        var head = el("div", "promo-item-head");
        head.appendChild(toggle(x.on, function (v) { x.on = v; }, ["開", "關"]));
        head.appendChild(input(x.name, { maxlength: "30", placeholder: "名稱，例如 中卡半價", "aria-label": "特價名稱" }, function (v) { x.name = v; }));
        head.appendChild(removeBtn(cfg.items, x));
        row.appendChild(head);
        row.appendChild(refPicker(x));
        var how = el("div", "promo-line");
        how.appendChild(field("打幾折", num(x.pct, "折數", function (v) { x.pct = v; }, "半價填 50"), "promo-narrow"));
        how.appendChild(el("span", "promo-or", "或固定特價"));
        how.appendChild(priceInputs(x, "特價"));
        row.appendChild(how);
        row.appendChild(el("p", "hint", "填了折數就照原價打折（台幣、馬幣都適用），沒填折數才用固定特價。"));
        body.appendChild(row);
      });
      body.appendChild(addBtn("新增特價", function () { cfg.items.push({ id: uid(), on: true, name: "", refs: [], pct: null, twd: null, myr: null }); }));
    },
    gift: function (cfg, body) {
      var seg = el("div", "seg promo-seg");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", "送禮方式");
      [["highest", "只送最高階"], ["all", "累積贈送"]].forEach(function (m) {
        var b = button(m[1], null, function () { cfg.mode = m[0]; changed(); render(); });
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(cfg.mode === m[0]));
        seg.appendChild(b);
      });
      body.appendChild(field("送禮方式", seg));
      body.appendChild(el("p", "hint", cfg.mode === "all" ? "達到的每一階都送。關掉某一階＝這次先不送，設定保留。" : "只送達到的最高一階。關掉某一階＝這次先不送，設定保留。"));
      cfg.tiers.forEach(function (t, i) {
        var row = el("div", "promo-item promo-tier" + (t.on ? "" : " is-off"));
        row.appendChild(toggle(t.on, function (v) { t.on = v; }, ["第 " + (i + 1) + " 階", "第 " + (i + 1) + " 階（關）"]));
        row.appendChild(el("span", "promo-word", "滿"));
        row.appendChild(priceInputs(t, "門檻"));
        row.appendChild(el("span", "promo-word", "送"));
        row.appendChild(input(t.gift, { maxlength: "40", placeholder: "贈品，例如 抽獎乙次", "aria-label": "贈品" }, function (v) { t.gift = v; }));
        row.appendChild(removeBtn(cfg.tiers, t));
        body.appendChild(row);
      });
      body.appendChild(addBtn("新增一階", function () { cfg.tiers.push({ id: uid(), on: true, twd: null, myr: null, gift: "" }); }));
    },
    orderDiscount: function (cfg, body) {
      cfg.options.forEach(function (o) {
        var row = el("div", "promo-item promo-opt" + (o.on ? "" : " is-off"));
        row.appendChild(toggle(o.on, function (v) { o.on = v; }, ["開", "關"]));
        row.appendChild(input(o.label, { maxlength: "20", placeholder: "名稱，例如 老客人 9 折", "aria-label": "折扣名稱" }, function (v) { o.label = v; }));
        row.appendChild(field("打幾折", num(o.percent, "折數", function (v) { o.percent = v; }, "9 折填 90"), "promo-narrow"));
        row.appendChild(removeBtn(cfg.options, o));
        body.appendChild(row);
      });
      body.appendChild(addBtn("新增折扣", function () { cfg.options.push({ id: uid(), on: true, label: "", percent: null }); }));
    },
    manual: function () {},
    bundles: function (cfg, body) {
      cfg.items.forEach(function (x) {
        var row = el("div", "promo-item" + (x.on ? "" : " is-off"));
        var head = el("div", "promo-item-head");
        head.appendChild(toggle(x.on, function (v) { x.on = v; }, ["開", "關"]));
        head.appendChild(input(x.name, { maxlength: "30", placeholder: "名稱，例如 中卡任選 3 張", "aria-label": "組合價名稱" }, function (v) { x.name = v; }));
        head.appendChild(removeBtn(cfg.items, x));
        row.appendChild(head);
        row.appendChild(refPicker(x));
        var how = el("div", "promo-line");
        how.appendChild(field("滿幾件", num(x.qty, "件數", function (v) { x.qty = v; }, "例如 3"), "promo-narrow"));
        how.appendChild(el("span", "promo-or", "一組"));
        how.appendChild(priceInputs(x, "優惠價"));
        row.appendChild(how);
        body.appendChild(row);
      });
      body.appendChild(addBtn("新增組合價", function () { cfg.items.push({ id: uid(), on: true, name: "", refs: [], qty: null, twd: null, myr: null }); }));
    },
    sets: function (cfg, body) {
      cfg.items.forEach(function (x) {
        var row = el("div", "promo-item" + (x.on ? "" : " is-off"));
        var head = el("div", "promo-item-head");
        head.appendChild(toggle(x.on, function (v) { x.on = v; }, ["開", "關"]));
        head.appendChild(input(x.name, { maxlength: "30", placeholder: "名稱，例如 療癒＋中卡套餐", "aria-label": "套餐名稱" }, function (v) { x.name = v; }));
        head.appendChild(removeBtn(cfg.items, x));
        row.appendChild(head);
        row.appendChild(el("p", "hint", "選要搭在一起的品項（每樣各一件，至少兩樣）："));
        row.appendChild(refPicker(x));
        var how = el("div", "promo-line");
        how.appendChild(el("span", "promo-or", "套餐價"));
        how.appendChild(priceInputs(x, "套餐價"));
        row.appendChild(how);
        body.appendChild(row);
      });
      body.appendChild(addBtn("新增套餐", function () { cfg.items.push({ id: uid(), on: true, name: "", refs: [], twd: null, myr: null }); }));
    },
  };

  function card(t) {
    var cfg = promos[t.key] || (promos[t.key] = { enabled: false });
    if (t.list && !cfg[t.list]) cfg[t.list] = [];
    if (t.key === "gift" && !cfg.mode) cfg.mode = "highest";
    var c = el("section", "promo-card glass" + (cfg.enabled ? " is-enabled" : ""));
    var head = el("div", "promo-head");
    var icon = el("span", "promo-icon " + t.palette, t.icon);
    icon.setAttribute("aria-hidden", "true");
    head.appendChild(icon);
    var text = el("div", "promo-title");
    var h = el("h3", null, t.title);
    if (t.list) {
      var on = cfg[t.list].filter(function (x) { return x.on; }).length;
      if (cfg[t.list].length) h.appendChild(el("span", "promo-count", on + " " + t.unit + (on < cfg[t.list].length ? "（共 " + cfg[t.list].length + "）" : "")));
    }
    text.appendChild(h);
    text.appendChild(el("p", null, t.desc));
    head.appendChild(text);
    head.appendChild(toggle(cfg.enabled, function (v) { cfg.enabled = v; if (v && t.list && !cfg[t.list].length) seed(t.key, cfg); }));
    c.appendChild(head);
    if (cfg.enabled && t.key !== "manual") {
      var body = el("div", "promo-body");
      BODY[t.key](cfg, body);
      c.appendChild(body);
    }
    return c;
  }

  // 剛啟用時先放一筆空白的，省一個步驟
  function seed(key, cfg) {
    if (key === "gift") cfg.tiers.push({ id: uid(), on: true, twd: null, myr: null, gift: "" });
    else if (key === "orderDiscount") cfg.options.push({ id: uid(), on: true, label: "", percent: null });
    else if (key === "sale") cfg.items.push({ id: uid(), on: true, name: "", refs: [], pct: null, twd: null, myr: null });
    else if (key === "bundles") cfg.items.push({ id: uid(), on: true, name: "", refs: [], qty: null, twd: null, myr: null });
    else if (key === "sets") cfg.items.push({ id: uid(), on: true, name: "", refs: [], twd: null, myr: null });
  }

  function render() {
    var host = $("promoBody");
    host.innerHTML = "";
    if (!promos) { host.appendChild(el("p", "empty glass", "載入中…")); return; }
    var wrap = el("div", "promo-list");
    TYPES.forEach(function (t) { wrap.appendChild(card(t)); });
    host.appendChild(wrap);
  }

  $("promoSave").addEventListener("click", function () {
    if (!promos) return;
    var btn = this;
    btn.disabled = true;
    $("promoMsg").textContent = "";
    A.api("/api/admin/promos", { method: "PUT", body: { promos: promos } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { $("promoMsg").textContent = r.message || "儲存失敗，請再試一次。"; btn.textContent = "儲存優惠設定（尚未儲存）"; return; }
      promos = r.promos;
      dirty = false;
      btn.textContent = "儲存優惠設定";
      A.toast("優惠設定已儲存");
      render();
    });
  });

  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  window.NieiaPromoAdmin = { load: function () { return dirty ? Promise.resolve() : load(); } };
})();
