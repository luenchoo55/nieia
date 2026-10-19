// 後台：療癒項目與商品管理
(function () {
  "use strict";

  var A = window.NieiaAdmin;
  if (!A) return;

  var GLYPH_LABELS = {
    moon: "月亮", spiral: "螺旋", constellation: "星座", rings: "光圈", flame: "火焰", sun: "太陽",
    lotus: "蓮花", wave: "海浪", heart: "愛心", paw: "腳掌", blueprint: "藍圖", door: "門",
    book: "書", card: "卡片", bag: "提袋", pen: "筆",
  };
  var GLYPHS = Object.keys(GLYPH_LABELS);
  var PALETTES = window.NIEIA_PALETTES;

  var KINDS = {
    services: {
      api: "/api/admin/services",
      noun: "療癒項目",
      priceKind: "service",
      blank: { name: "", en: "", desc: "", category: "energy", duration: "", priceMode: "coming", priceTwd: "", priceMyr: "", extra: "none", mode: "remote", glyph: "lotus", palette: "g1", published: true },
      fields: [
        { key: "name", label: "名稱", type: "text", max: 40, required: true },
        { key: "en", label: "英文名稱", type: "text", max: 60, hint: "選填，會以英文字體顯示在名稱下方" },
        { key: "desc", label: "介紹", type: "textarea", max: 300 },
        { key: "category", label: "分類", type: "select", options: [["energy", "能量療癒"], ["blessing", "祝福儀式"], ["consult", "諮詢與溝通"]] },
        { key: "duration", label: "療程長度（分鐘）", type: "number", min: 15, max: 480, hint: "選填" },
        { key: "mode", label: "進行方式", type: "select", options: [["remote", "IG 視訊遠距"], ["onsite", "現場進行"], ["both", "遠距或現場皆可（客人預約時選擇）"]] },
        { key: "priceMode", label: "價格顯示", type: "select", options: [["coming", "價格即將公布"], ["fixed", "固定價格"], ["inquiry", "隨喜服務"]] },
        { key: "priceTwd", label: "台幣價格（NT$）", type: "number", min: 0, max: 1000000, showIf: function (v) { return v.priceMode === "fixed"; } },
        { key: "priceMyr", label: "馬幣價格（RM）", type: "number", min: 0, max: 100000, showIf: function (v) { return v.priceMode === "fixed"; }, hint: "沒填就不顯示馬幣價格" },
        { key: "extra", label: "預約時額外詢問", type: "select", options: [["none", "不需要"], ["magnified", "是否習修過擴大療癒"], ["departed", "亡者全名（引渡之光）"], ["soulplan", "出生日期與姓名拼音（靈魂藍圖）"], ["animal", "毛孩資料（動物溝通）"]] },
        { key: "glyph", label: "縮圖圖案", type: "glyph" },
        { key: "palette", label: "縮圖色調", type: "palette" },
        { key: "published", label: "上架（客人看得到）", type: "check" },
      ],
    },
    products: {
      api: "/api/admin/products",
      noun: "商品",
      priceKind: "product",
      blank: { name: "", desc: "", priceTwd: "", priceMyr: "", url: "", glyph: "card", palette: "g2", soldOut: false, published: true },
      fields: [
        { key: "name", label: "名稱", type: "text", max: 40, required: true },
        { key: "desc", label: "介紹", type: "textarea", max: 300 },
        { key: "priceTwd", label: "台幣價格（NT$）", type: "number", min: 0, max: 1000000 },
        { key: "priceMyr", label: "馬幣價格（RM）", type: "number", min: 0, max: 100000, hint: "沒填就不顯示馬幣價格" },
        { key: "url", label: "購買連結", type: "url", hint: "例如 7-11 賣貨便的商品網址，要以 https:// 開頭" },
        { key: "glyph", label: "縮圖圖案", type: "glyph" },
        { key: "palette", label: "縮圖色調", type: "palette" },
        { key: "soldOut", label: "已售完", type: "check" },
        { key: "published", label: "上架（客人看得到）", type: "check" },
      ],
    },
  };

  var state = { services: { items: [], loaded: false }, products: { items: [], loaded: false } };
  var fieldId = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- 列表 ----------
  function load(kind) {
    var list = document.querySelector('[data-list="' + kind + '"]');
    if (!state[kind].loaded) {
      list.innerHTML = "";
      list.appendChild(el("p", "empty glass", "載入中…"));
    }
    A.api(KINDS[kind].api).then(function (r) {
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { list.innerHTML = ""; list.appendChild(el("p", "empty glass", r.message || "暫時無法載入，請重新整理。")); return; }
      state[kind].items = r.items;
      state[kind].loaded = true;
      render(kind);
    });
  }

  function applyItems(kind, r) {
    if (r && r.items) { state[kind].items = r.items; state[kind].loaded = true; render(kind); }
    else load(kind);
  }

  function render(kind) {
    var cfg = KINDS[kind];
    var list = document.querySelector('[data-list="' + kind + '"]');
    list.innerHTML = "";
    var items = state[kind].items;
    if (!items.length) {
      list.appendChild(el("p", "empty glass", "還沒有任何" + cfg.noun + "。按上方的「新增" + cfg.noun + "」開始。"));
      return;
    }
    items.forEach(function (item, i) {
      var row = el("div", "row glass catalog-row" + (item.published ? "" : " is-closed"));
      row.appendChild(window.nieiaArt(item.glyph, item.palette));
      var text = el("div", "text");
      text.appendChild(el("h3", null, item.name));
      text.appendChild(el("span", "desc", window.nieiaPrice(item, cfg.priceKind)));
      var pills = el("div", "pills");
      pills.appendChild(el("span", "pill " + (item.published ? "open" : "closed"), item.published ? "上架中" : "已下架"));
      if (item.soldOut) pills.appendChild(el("span", "pill closed", "已售完"));
      text.appendChild(pills);
      row.appendChild(text);

      var actions = el("div", "actions");
      actions.appendChild(button("編輯", function () { openEditor(kind, item); }));
      var up = button("↑", function () { move(kind, item, "up", up); });
      up.setAttribute("aria-label", "往上移");
      up.disabled = i === 0;
      var down = button("↓", function () { move(kind, item, "down", down); });
      down.setAttribute("aria-label", "往下移");
      down.disabled = i === items.length - 1;
      actions.appendChild(up);
      actions.appendChild(down);
      var toggle = button(item.published ? "下架" : "上架", function () {
        var before = item.published;
        item.published = !before;
        render(kind);
        save(kind, item.id, { published: item.published }, null, before ? "已下架" : "已上架").then(function (r) {
          if (!r || !r.ok) { item.published = before; render(kind); }
        });
      });
      actions.appendChild(toggle);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function button(text, onClick) {
    var b = el("button", null, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function move(kind, item, direction, btn) {
    var items = state[kind].items;
    var i = items.indexOf(item);
    var j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= items.length) return;
    var snapshot = items.slice();
    items[i] = items[j]; items[j] = item;
    render(kind);
    A.api(KINDS[kind].api + "/" + item.id + "/move", { method: "POST", body: { direction: direction } }).then(function (r) {
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { state[kind].items = snapshot; render(kind); A.toast(r.message || "調整順序失敗"); return; }
      applyItems(kind, r);
    });
  }

  function save(kind, id, data, btn, doneText) {
    if (btn) btn.disabled = true;
    var cfg = KINDS[kind];
    var req = id
      ? A.api(cfg.api + "/" + id, { method: "PATCH", body: data })
      : A.api(cfg.api, { method: "POST", body: data });
    return req.then(function (r) {
      if (btn) btn.disabled = false;
      if (r.status === 401) { A.checkSession(); return r; }
      if (!r.ok) { A.toast(r.message || "儲存失敗"); return r; }
      A.toast(doneText || "已儲存");
      applyItems(kind, r);
      return r;
    });
  }

  // ---------- 編輯表單 ----------
  function openEditor(kind, item) {
    var cfg = KINDS[kind];
    var host = document.querySelector('[data-editor="' + kind + '"]');
    var values = {};
    Object.keys(cfg.blank).forEach(function (k) {
      var v = item && item[k] !== undefined ? item[k] : cfg.blank[k];
      values[k] = v == null ? "" : v;
    });

    host.innerHTML = "";
    var card = el("section", "glass form-card editor");
    card.appendChild(el("h2", null, item ? "編輯" + cfg.noun : "新增" + cfg.noun));
    var form = el("form");
    form.noValidate = true;
    var grid = el("div", "field-grid");
    var controls = [];

    cfg.fields.forEach(function (f) {
      var c = buildField(f, values, function () { refresh(); });
      controls.push({ f: f, node: c });
      grid.appendChild(c);
    });

    function refresh() {
      controls.forEach(function (c) {
        if (c.f.showIf) c.node.hidden = !c.f.showIf(values);
        if (c.f.type === "glyph" || c.f.type === "palette") c.node.update();
      });
    }
    refresh();

    form.appendChild(grid);
    var msg = el("p", "form-msg");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);

    var bar = el("div", "editor-actions");
    var saveBtn = el("button", "btn btn-primary", item ? "儲存變更" : "新增" + cfg.noun);
    saveBtn.type = "submit";
    var cancel = el("button", "btn btn-ghost", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", function () { host.innerHTML = ""; });
    bar.appendChild(saveBtn);
    bar.appendChild(cancel);

    if (item) {
      var del = el("button", "btn btn-ghost danger-btn", "刪除");
      del.type = "button";
      var armed = null;
      del.addEventListener("click", function () {
        if (!armed) {
          del.textContent = "確定刪除？刪除後無法復原";
          del.classList.add("confirm");
          armed = setTimeout(function () { armed = null; del.textContent = "刪除"; del.classList.remove("confirm"); }, 5000);
          return;
        }
        clearTimeout(armed);
        del.disabled = true;
        A.api(cfg.api + "/" + item.id, { method: "DELETE" }).then(function (r) {
          del.disabled = false;
          if (r.status === 401) return A.checkSession();
          if (!r.ok) { A.toast(r.message || "刪除失敗"); return; }
          host.innerHTML = "";
          A.toast("已刪除");
          applyItems(kind, r);
        });
      });
      bar.appendChild(del);
    }
    form.appendChild(bar);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = String(values.name || "").trim();
      if (!name) { msg.textContent = "請填寫名稱。"; return; }
      msg.textContent = "";
      var data = {};
      Object.keys(values).forEach(function (k) { data[k] = values[k]; });
      ["priceTwd", "priceMyr", "duration"].forEach(function (k) {
        if (k in data) data[k] = data[k] === "" ? null : Number(data[k]);
      });
      saveBtn.disabled = true;
      save(kind, item && item.id, data, null, item ? "已儲存變更" : "已新增").then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) host.innerHTML = "";
        else if (r && r.message) msg.textContent = r.message;
      });
    });

    card.appendChild(form);
    host.appendChild(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    var first = card.querySelector("input, textarea, select");
    if (first) first.focus({ preventScroll: true });
  }

  function buildField(f, values, onChange) {
    var id = "cf-" + (++fieldId);
    var wrap;
    if (f.type === "check") {
      wrap = el("label", "field check");
      wrap.htmlFor = id;
      var cb = el("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = Boolean(values[f.key]);
      cb.addEventListener("change", function () { values[f.key] = cb.checked; onChange(); });
      wrap.appendChild(cb);
      wrap.appendChild(el("span", null, f.label));
      return wrap;
    }

    if (f.type === "glyph" || f.type === "palette") {
      wrap = el("div", "field picker-field wide");
      var legend = el("span", null, f.label);
      legend.id = id;
      wrap.appendChild(legend);
      var picker = el("div", "picker");
      picker.setAttribute("role", "radiogroup");
      picker.setAttribute("aria-labelledby", id);
      var choices = f.type === "glyph" ? GLYPHS : PALETTES;
      var btns = choices.map(function (choice, idx) {
        var b = el("button", "pick");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", f.type === "glyph" ? GLYPH_LABELS[choice] : "色調 " + (idx + 1));
        b.addEventListener("click", function () { values[f.key] = choice; onChange(); });
        picker.appendChild(b);
        return { b: b, choice: choice };
      });
      wrap.update = function () {
        btns.forEach(function (x) {
          var on = values[f.key] === x.choice;
          x.b.setAttribute("aria-checked", String(on));
          x.b.tabIndex = on ? 0 : -1;
          x.b.innerHTML = "";
          var art = f.type === "glyph" ? window.nieiaArt(x.choice, values.palette) : window.nieiaArt(values.glyph, x.choice);
          x.b.appendChild(art);
        });
      };
      wrap.appendChild(picker);
      return wrap;
    }

    wrap = el("label", "field" + (f.type === "textarea" ? " wide" : ""));
    wrap.htmlFor = id;
    wrap.appendChild(el("span", null, f.label + (f.required ? "" : "")));
    var input;
    if (f.type === "textarea") {
      input = el("textarea");
      input.rows = 3;
    } else if (f.type === "select") {
      input = el("select");
      f.options.forEach(function (o) {
        var opt = el("option", null, o[1]);
        opt.value = o[0];
        input.appendChild(opt);
      });
    } else {
      input = el("input");
      input.type = f.type === "number" ? "number" : f.type === "url" ? "url" : "text";
      if (f.type === "number") { input.inputMode = "numeric"; input.min = f.min; input.max = f.max; input.step = 1; }
    }
    input.id = id;
    if (f.max && f.type !== "number") input.maxLength = f.max;
    if (f.required) input.required = true;
    input.value = values[f.key] == null ? "" : values[f.key];
    input.addEventListener(f.type === "select" ? "change" : "input", function () { values[f.key] = input.value; onChange(); });
    wrap.appendChild(input);
    if (f.hint) wrap.appendChild(el("small", "hint", f.hint));
    return wrap;
  }

  // ---------- 啟動 ----------
  document.querySelectorAll("[data-new]").forEach(function (b) {
    b.addEventListener("click", function () { openEditor(b.getAttribute("data-new"), null); });
  });

  // 第一次切到分頁時才載入
  ["services", "products"].forEach(function (kind) {
    var tab = document.getElementById("tab-" + kind);
    tab.addEventListener("click", function () { if (!state[kind].loaded) load(kind); });
  });
  document.addEventListener("nieia:dash", function () {
    state.services.loaded = false;
    state.products.loaded = false;
    load("services");
    load("products");
  });
})();
