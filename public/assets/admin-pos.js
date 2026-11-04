// 後台：收銀（收支分頁裡的「收銀」）。點商品或療癒項目加入購物車，結帳後記成收入並扣庫存
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  var U = window.NieiaUI;
  if (!A || !U) return;
  var el = U.el, button = U.button, money = U.money;

  var $ = function (id) { return document.getElementById(id); };
  var PAY = {
    TWD: [["cash", "現金"], ["linepay", "LINE Pay"], ["transfer", "轉帳"]],
    MYR: [["cash", "現金"], ["tng", "TNG"], ["transfer", "轉帳"]],
  };
  var QUICK = { TWD: [100, 500, 1000], MYR: [10, 50, 100] };
  var products = null, services = null;
  var currency = "TWD", method = "cash";
  var cart = []; // { key, kind, id, name, price, qty, stock }
  var busy = false;
  var promos = null, discountId = "", manual = "";

  function priceOf(x) { return currency === "MYR" ? x.priceMyr : x.priceTwd; }
  // 套用優惠後的金額（與伺服器結帳用同一份計算）
  function calc() {
    return window.nieiaPromo.compute(cart.map(function (l) {
      return { ref: l.kind === "custom" ? l.key : l.kind + ":" + l.id, name: l.name, price: l.price, qty: l.qty };
    }), promos, currency, { discountId: discountId, manual: manual });
  }
  function total() { return calc().total; }

  // ---------- 報表／收銀／優惠設定切換 ----------
  var VIEWS = { report: ["ldViewReport", "ldReport"], pos: ["ldViewPos", "posView"], promo: ["ldViewPromo", "promoView"] };
  function showView(view) {
    Object.keys(VIEWS).forEach(function (k) {
      var on = k === view;
      $(VIEWS[k][0]).setAttribute("aria-selected", String(on));
      $(VIEWS[k][0]).tabIndex = on ? 0 : -1;
      $(VIEWS[k][1]).hidden = !on;
    });
    $("ldHeadActs").hidden = view !== "report";
    if (view === "pos") load();
    else if (view === "promo") { if (window.NieiaPromoAdmin) window.NieiaPromoAdmin.load(); }
    else $("ldMonth").dispatchEvent(new Event("change")); // 報表重新載入，剛結帳的收入就會出現
  }
  Object.keys(VIEWS).forEach(function (k) {
    $(VIEWS[k][0]).addEventListener("click", function () { showView(k); });
  });

  // ---------- 品項 ----------
  function load() {
    return Promise.all([A.api("/api/admin/products"), A.api("/api/admin/services"), A.api("/api/admin/promos")]).then(function (r) {
      if (!U.guard(r[0]) || !U.guard(r[1]) || !U.guard(r[2])) return;
      products = r[0].items;
      services = r[1].items.filter(function (s) { return s.priceMode === "fixed"; });
      promos = r[2].promos;
      // 購物車裡的商品庫存跟著更新
      cart.forEach(function (l) {
        if (l.kind !== "product") return;
        var p = products.find(function (x) { return x.id === l.id; });
        l.stock = p && typeof p.stock === "number" ? p.stock : null;
      });
      renderGrid();
      renderCart();
    });
  }

  function tile(x, kind) {
    var price = priceOf(x);
    var stock = kind === "product" && typeof x.stock === "number" ? x.stock : null;
    var inCart = cart.filter(function (l) { return l.kind === kind && l.id === x.id; }).reduce(function (s, l) { return s + l.qty; }, 0);
    var noPrice = price == null;
    var out = stock != null && stock - inCart <= 0;
    var b = el("button", "pos-tile glass" + (noPrice || out ? " is-off" : "") + (inCart ? " is-in" : ""));
    b.type = "button";
    b.disabled = noPrice || out;
    b.appendChild(window.nieiaArt(x.glyph, x.palette));
    var text = el("span", "pos-tile-text");
    text.appendChild(el("strong", null, x.name));
    var sale = noPrice ? null : window.nieiaPromo.saleOf(kind + ":" + x.id, price, promos, currency);
    var meta = [noPrice ? (currency === "MYR" ? "沒有馬幣價格" : "沒有台幣價格") : money(sale ? sale.price : price, currency)];
    if (stock != null) meta.push(stock <= 0 ? "已售完" : "剩 " + stock);
    var metaEl = el("span", "pos-tile-meta", meta.join("・"));
    if (sale) { metaEl.appendChild(document.createTextNode(" ")); metaEl.appendChild(el("s", null, money(price, currency))); }
    text.appendChild(metaEl);
    b.appendChild(text);
    if (sale) b.appendChild(el("span", "pos-sale", sale.rule.name || "特價"));
    if (inCart) b.appendChild(el("span", "pos-badge", "× " + inCart));
    b.setAttribute("aria-label", x.name + "，" + meta.join("，") + (inCart ? "，購物車已有 " + inCart : ""));
    b.addEventListener("click", function () { add(kind, x); });
    return b;
  }

  function group(title, list, kind, empty) {
    var s = el("section", "pos-group");
    s.appendChild(el("h3", "pos-group-title", title));
    if (!list.length) { s.appendChild(el("p", "hint", empty)); return s; }
    var g = el("div", "pos-grid");
    list.forEach(function (x) { g.appendChild(tile(x, kind)); });
    s.appendChild(g);
    return s;
  }

  function renderGrid() {
    var host = $("posGrid");
    host.innerHTML = "";
    if (!products) { host.appendChild(el("p", "empty glass", "載入中…")); return; }
    host.appendChild(group("商品", products, "product", "還沒有商品，可以到「商品」分頁新增。"));
    host.appendChild(group("療癒項目", services, "service", "還沒有定價的療癒項目。"));
  }

  // ---------- 購物車 ----------
  function add(kind, x) {
    var key = kind + ":" + x.id;
    var line = cart.find(function (l) { return l.key === key; });
    if (line) {
      if (line.stock != null && line.qty >= line.stock) return;
      line.qty++;
    } else {
      cart.push({ key: key, kind: kind, id: x.id, name: x.name, price: priceOf(x), qty: 1, stock: kind === "product" && typeof x.stock === "number" ? x.stock : null });
    }
    $("posMsg").textContent = "";
    renderGrid();
    renderCart();
  }

  function setQty(line, qty) {
    if (qty <= 0) cart = cart.filter(function (l) { return l !== line; });
    else line.qty = line.stock != null ? Math.min(qty, line.stock) : qty;
    renderGrid();
    renderCart();
  }

  function renderCart() {
    var host = $("posLines");
    host.innerHTML = "";
    $("posClear").hidden = !cart.length;
    if (!cart.length) host.appendChild(el("p", "hint", "點商品或療癒項目加入，也可以在下方輸入其他品項。"));
    cart.forEach(function (l) {
      var row = el("div", "pos-line");
      var info = el("span", "pos-line-info");
      info.appendChild(el("strong", null, l.name));
      info.appendChild(el("span", null, money(l.price, currency) + (l.stock != null ? "・剩 " + l.stock : "")));
      row.appendChild(info);
      var step = el("span", "pos-step");
      var minus = button("−", "pos-step-btn", function () { setQty(l, l.qty - 1); });
      minus.setAttribute("aria-label", "減少 " + l.name);
      var plus = button("+", "pos-step-btn", function () { setQty(l, l.qty + 1); });
      plus.setAttribute("aria-label", "增加 " + l.name);
      plus.disabled = l.stock != null && l.qty >= l.stock;
      step.appendChild(minus);
      step.appendChild(el("span", "pos-qty", String(l.qty)));
      step.appendChild(plus);
      row.appendChild(step);
      row.appendChild(el("span", "pos-line-amt", money(l.price * l.qty, currency)));
      host.appendChild(row);
    });
    renderPromo();
    renderPay();
  }

  // 小計、各項優惠、整筆折扣選項、手動折扣、滿額禮提示
  function renderPromo() {
    var r = calc();
    var box = $("posPromo");
    box.innerHTML = "";
    if (cart.length && r.adjustments.length) {
      box.appendChild(promoRow("小計", money(r.subtotal, currency), "pos-sub"));
      r.adjustments.forEach(function (a) { box.appendChild(promoRow(a.label, "−" + money(a.amount, currency), "pos-off")); });
    }
    if (r.discountOptions.length) {
      var wrap = el("div", "pos-disc");
      wrap.appendChild(el("span", "pos-promo-label", "整筆折扣"));
      var chips = el("div", "pos-chips");
      [{ id: "", label: "不打折" }].concat(r.discountOptions).forEach(function (o) {
        var b = button(o.label, "chip", function () { discountId = o.id; renderCart(); });
        b.setAttribute("aria-pressed", String(discountId === o.id));
        chips.appendChild(b);
      });
      wrap.appendChild(chips);
      box.appendChild(wrap);
    } else discountId = "";
    if (r.manualOn) {
      var lab = el("label", "pos-manual");
      lab.appendChild(el("span", "pos-promo-label", "手動折扣"));
      var inp = el("input");
      inp.type = "number"; inp.inputMode = "numeric"; inp.min = "0"; inp.step = "1"; inp.placeholder = "減多少";
      inp.value = manual;
      inp.addEventListener("change", function () { manual = inp.value; renderCart(); });
      lab.appendChild(inp);
      box.appendChild(lab);
    } else manual = "";
    if (cart.length && (r.gifts.length || r.nextGift)) {
      var g = el("div", "pos-gift");
      if (r.gifts.length) g.appendChild(el("strong", null, "✦ 贈品：" + r.gifts.join("、")));
      if (r.nextGift) g.appendChild(el("span", null, "再 " + money(r.nextGift.short, currency) + " 就送「" + r.nextGift.gift + "」"));
      box.appendChild(g);
    }
    $("posTotal").textContent = money(r.total, currency);
  }
  function promoRow(label, value, cls) {
    var row = el("div", "pos-prow " + cls);
    row.appendChild(el("span", null, label));
    row.appendChild(el("span", null, value));
    return row;
  }

  $("posClear").addEventListener("click", function () { cart = []; discountId = ""; manual = ""; $("posGiven").value = ""; renderGrid(); renderCart(); });

  // 其他品項：例如隨喜、沒有建檔的東西
  $("posCustom").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("posCustomName").value.trim();
    var price = $("posCustomPrice").value;
    if (!name) { $("posCustomName").focus(); return; }
    if (price === "" || !/^\d+$/.test(price)) { $("posCustomPrice").focus(); return; }
    cart.push({ key: "custom:" + Date.now(), kind: "custom", name: name, price: Number(price), qty: 1, stock: null });
    $("posCustomName").value = ""; $("posCustomPrice").value = "";
    renderCart();
  });

  // ---------- 付款 ----------
  function renderPay() {
    var box = $("posPay");
    box.innerHTML = "";
    if (!PAY[currency].some(function (m) { return m[0] === method; })) method = "cash";
    PAY[currency].forEach(function (m) {
      var b = button(m[1], null, function () { method = m[0]; renderPay(); });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(method === m[0]));
      box.appendChild(b);
    });
    $("posCash").hidden = method !== "cash";
    var q = $("posQuick");
    q.innerHTML = "";
    QUICK[currency].forEach(function (n) {
      q.appendChild(button("+" + n, "mini", function () { $("posGiven").value = (Number($("posGiven").value) || 0) + n; renderChange(); }));
    });
    q.appendChild(button("剛好", "mini", function () { $("posGiven").value = total() || ""; renderChange(); }));
    q.appendChild(button("清除", "mini", function () { $("posGiven").value = ""; renderChange(); }));
    renderChange();
  }

  function renderChange() {
    var t = total();
    var given = $("posGiven").value;
    var out = $("posChange");
    var short = false;
    out.classList.remove("is-short");
    if (method !== "cash" || given === "" || !t) out.textContent = "—";
    else if (Number(given) < t) { out.textContent = "還差 " + money(t - Number(given), currency); out.classList.add("is-short"); short = true; }
    else out.textContent = money(Number(given) - t, currency);
    $("posCheckout").disabled = busy || !cart.length || short;
    $("posCheckout").textContent = cart.length ? "結帳 " + money(t, currency) : "結帳";
  }
  $("posGiven").addEventListener("input", renderChange);

  document.querySelectorAll("[data-pcur]").forEach(function (b) {
    b.addEventListener("click", function () {
      var c = b.getAttribute("data-pcur");
      if (c === currency) return;
      if (cart.length && !confirm("換幣別會清空購物車，確定嗎？")) return;
      currency = c;
      cart = [];
      $("posGiven").value = "";
      document.querySelectorAll("[data-pcur]").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
      renderGrid();
      renderCart();
    });
  });

  $("posCheckout").addEventListener("click", function () {
    if (!cart.length || busy) return;
    var t = total();
    var given = Number($("posGiven").value) || 0;
    busy = true;
    renderChange();
    $("posCheckout").textContent = "結帳中…";
    $("posMsg").textContent = "";
    A.api("/api/admin/ledger/checkout", {
      method: "POST",
      body: {
        currency: currency, method: method, discountId: discountId, manual: manual,
        items: cart.map(function (l) { return { kind: l.kind, id: l.id, name: l.name, price: l.price, qty: l.qty }; }),
      },
    }).then(function (r) {
      busy = false;
      if (r.status === 401) { renderChange(); return A.checkSession(); }
      if (!r.ok) { $("posMsg").textContent = r.message || "結帳失敗，請再試一次。"; load(); return; }
      var change = method === "cash" && given > t ? "，找零 " + money(given - t, currency) : "";
      A.toast("已結帳 " + money(r.total, r.currency) + change);
      showReceipt(r.receipt, method === "cash" && given ? given : null);
      cart = [];
      discountId = ""; manual = "";
      $("posGiven").value = "";
      load();
      if (window.NieiaOverview) window.NieiaOverview.reload();
    });
  });

  // ---------- 收據：圖片＋文字訊息 ----------
  var receiptModal = U.modal("receiptModal");
  var receiptBlob = null, receiptName = "";

  function stamp(iso) {
    var d = new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString();
    return d.slice(0, 10).replace(/-/g, "/") + " " + d.slice(11, 16);
  }

  function receiptText(rc, given) {
    var m = function (v) { return rmoney(v, rc.currency); };
    var out = ["【阿綸涅亞 NIEIA 療癒服務憑證】", "訂單編號：#" + rc.no, "收據建立時間：" + stamp(rc.at)];
    if (has(rc.date)) out.push("預約日期：" + rc.date);
    if (has(rc.bookingStatus)) out.push("預約狀態：" + rc.bookingStatus);
    (rc.rows || []).forEach(function (r) { if (has(r[1])) out.push(r[0] + "：" + r[1]); });
    var cust = rc.customer || {};
    if (has(cust.name)) out.push("客戶姓名：" + cust.name);
    (cust.contacts || []).forEach(function (c) { if (c && has(c[1])) out.push(c[0] + "：" + c[1]); });
    out.push("－－－－－－－－－－");
    (rc.lines || []).forEach(function (l) {
      out.push(l.name);
      out.push("　" + m(l.price) + " × " + l.qty + "　" + m(l.amount));
    });
    out.push("－－－－－－－－－－");
    var adj = rc.adjustments || [];
    if (adj.length) {
      out.push("小計：" + m(rc.subtotal));
      adj.forEach(function (a) { out.push(a.label + "：−" + m(a.amount)); });
    }
    out.push("總金額：" + m(rc.total));
    if (has(rc.paymentStatus)) out.push("付款狀態：" + rc.paymentStatus);
    if (has(rc.method)) out.push("付款方式：" + rc.method);
    (rc.gifts || []).forEach(function (g) { out.push("贈品：" + g); });
    if (given != null) {
      out.push("收現金：" + m(given));
      out.push("找零：" + m(Math.max(0, given - rc.total)));
    }
    out.push("");
    out.push("謝謝你的到來，願光一路陪伴你 ✦");
    out.push("IG @nieia4928");
    return out.join("\n");
  }

  // 收據圖片用 canvas 畫，配色與字體跟網站一致
  var FONT_DISPLAY = '"LXGW WenKai TC", "Noto Serif TC", serif';
  var FONT_BODY = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
  var FONT_SONG = "\"Noto Serif TC\", \"Songti TC\", \"PMingLiU\", \"MingLiU\", serif"; // 收據標題的粗宋體
  var FONT_TYPE = "\"Special Elite\", \"Noto Serif TC\", \"Songti TC\", \"PMingLiU\", serif"; // 復古打字機：英數字打字機字、中文宋體
  var FONT_LATIN = '"Cormorant Garamond", "Times New Roman", serif';

  function loadFonts(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("700 40px " + FONT_DISPLAY, text),
      document.fonts.load("900 34px " + FONT_SONG, "阿綸涅亞"),
      document.fonts.load("400 14px \"Special Elite\"", "NIEIA SERVICE RECEIPT 0123456789$,.-=*#@RM"),
      document.fonts.load("400 14px \"Noto Serif TC\"", text),
      document.fonts.load("600 14px \"Noto Serif TC\"", text),
      document.fonts.load("400 20px " + FONT_BODY, text),
      document.fonts.load("600 20px " + FONT_BODY, text),
      document.fonts.load("500 40px " + FONT_LATIN, "NIEIA0123456789$,RM"),
    ]).catch(function () {});
  }

  // 收據右下角的紫色印章（public/assets/nieia-stamp.png，白底已去掉）
  var stampImg = null;
  function loadStamp() {
    if (stampImg) return stampImg.ready;
    stampImg = new Image();
    stampImg.ready = new Promise(function (ok) { stampImg.onload = stampImg.onerror = function () { ok(); }; });
    stampImg.src = "/assets/nieia-stamp.png";
    return stampImg.ready;
  }

  // 收據的紙張底圖（public/assets/receipt-paper.jpg）
  var paperImg = null;
  function loadPaper() {
    if (paperImg) return paperImg.ready;
    paperImg = new Image();
    paperImg.ready = new Promise(function (ok) { paperImg.onload = paperImg.onerror = function () { ok(); }; });
    paperImg.src = "/assets/receipt-paper.jpg";
    return paperImg.ready;
  }

  function fitText(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
    return s + "…";
  }

  // 收據金額：整數不顯示小數，有小數最多兩位
  function rmoney(amount, currency) {
    if (amount == null || amount === "") return "";
    var n = Number(amount);
    return (n < 0 ? "−" : "") + (currency === "MYR" ? "RM " : "NT$") + Math.abs(n).toLocaleString("en-US", Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function has(v) { return v != null && String(v).trim() !== ""; }

  // 自動換行：英數字以單字為單位、中文逐字；超長的單字（例如訂單編號、Email）也會切開
  function wrap(ctx, text, max) {
    text = String(text);
    var tokens = text.match(/[A-Za-z0-9@._\-+#$,:/()'’]+|\s+|[\s\S]/g) || [];
    var lines = [], cur = "";
    function push() { lines.push(cur.replace(/\s+$/, "")); cur = ""; }
    tokens.forEach(function (t) {
      if (ctx.measureText(cur + t).width <= max) { cur += t; return; }
      if (/^\s+$/.test(t)) { push(); return; }
      if (cur) push();
      while (ctx.measureText(t).width > max) {
        var i = 1;
        while (i < t.length && ctx.measureText(t.slice(0, i + 1)).width <= max) i++;
        lines.push(t.slice(0, i));
        t = t.slice(i);
      }
      cur = t;
    });
    if (cur || !lines.length) push();
    return lines;
  }

  // 收據圖片用 canvas 畫，配色與字體跟網站一致；opts.print = 白底、深色字的列印／PDF 版
  function drawReceipt(rc, given, opts) {
    opts = opts || {};
    // 復古打字機風格：這個函式裡所有字都換成打字機字體＋宋體
    var FONT_BODY = FONT_TYPE, FONT_LATIN = FONT_TYPE, FONT_DISPLAY = FONT_SONG;
    var print = !!opts.print;
    var W = 440, PAD = 36, S = 2, CW = W - PAD * 2;
    var lines = rc.lines || [], adj = rc.adjustments || [], gifts = rc.gifts || [];
    var cust = rc.customer || {};
    var contacts = (cust.contacts || []).filter(function (c) { return c && has(c[1]); });
    // 先畫在夠高的畫布上，最後依實際高度裁切
    var H = 1300 + lines.length * 150 + adj.length * 50 + gifts.length * 50 + contacts.length * 50 + (rc.rows || []).length * 50;
    var cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    var ctx = cv.getContext("2d");
    ctx.scale(S, S);
    var ink = print ? "#1F1A33" : "#3A3160";
    var soft = print ? "#4A4560" : "#5E5680";
    var btn = print ? "#3A3066" : "#463C78";
    var lav = print ? "#5B4C9E" : "#6E64B4";
    var rule = print ? "#5B4C9E" : "#8A82C4";
    var green = print ? "#1F5F45" : "#2F6E55";
    var bg = "#FFFFFF";
    var sp = 0;
    function spacing(px) { sp = px; }

    // 打字機效果：一個字一個字打，每個字的高低、濃淡有一點點不同，偶爾有墨水暈開的重影。
    // 用訂單編號當亂數種子，同一張收據每次畫出來都一樣
    var seed = 0;
    String(rc.no || "").split("").forEach(function (ch) { seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; });
    seed = seed || 1234567;
    function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function measure(text) {
      var w = 0, chars = Array.from(String(text));
      chars.forEach(function (ch, i) { w += ctx.measureText(ch).width + (i < chars.length - 1 ? sp : 0); });
      return w;
    }
    function type(text, x, y0) {
      text = String(text);
      var align = ctx.textAlign, w = measure(text);
      var cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      var base = ctx.globalAlpha;
      ctx.textAlign = "left";
      Array.from(text).forEach(function (ch) {
        var cw = ctx.measureText(ch).width;
        if (ch.trim()) {
          var dy = (rand() - .5) * (print ? .5 : 1.1);
          var dx = (rand() - .5) * (print ? .2 : .5);
          ctx.globalAlpha = base * (print ? .95 : .78 + rand() * .22);
          ctx.fillText(ch, cx + dx, y0 + dy);
          if (!print && rand() < .22) { // 墨水暈開的淡淡重影
            ctx.globalAlpha = base * .18;
            ctx.fillText(ch, cx + dx + .6, y0 + dy + .3);
          }
        }
        cx += cw + sp;
      });
      ctx.globalAlpha = base;
      ctx.textAlign = align;
    }
    function font(f) { ctx.font = f; }
    function round(x, y0, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y0, w, h, r); else ctx.rect(x, y0, w, h);
      ctx.fill();
    }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!print && paperImg && paperImg.complete && paperImg.naturalWidth) {
      // 紙張底圖：寬度貼齊收據，收據比較長時往下接（每接一次上下翻轉，接縫才不明顯）
      var ph = W * paperImg.naturalHeight / paperImg.naturalWidth;
      for (var py = 0, k = 0; py < H; py += ph, k++) {
        ctx.save();
        if (k % 2) { ctx.translate(0, py + ph); ctx.scale(1, -1); ctx.drawImage(paperImg, 0, 0, W, ph); }
        else ctx.drawImage(paperImg, 0, py, W, ph);
        ctx.restore();
      }
    }

    // ---------- 1. 品牌區 ----------
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink;
    spacing(6); font("900 34px " + FONT_SONG);
    type("阿綸涅亞", W / 2 + 3, 66);
    spacing(9); font("500 17px " + FONT_LATIN);
    ctx.fillStyle = soft;
    type("NIEIA", W / 2 + 4.5, 92);
    ctx.fillStyle = lav;
    ctx.fillRect(W / 2 - 72, 109, 56, 1);
    ctx.fillRect(W / 2 + 16, 109, 56, 1);
    spacing(0); font("400 11px " + FONT_BODY);
    type("*", W / 2, 116);
    spacing(5); font("600 13px " + FONT_LATIN);
    ctx.fillStyle = btn;
    type("SERVICE RECEIPT", W / 2 + 2.5, 138);
    spacing(4); font("400 12px " + FONT_BODY);
    ctx.fillStyle = soft;
    type("療癒服務憑證", W / 2 + 2, 158);
    spacing(0);

    var y = 200;
    var LABEL_W = 104;
    function dashes(y0, ch) {
      ctx.save();
      font("400 13px " + FONT_TYPE);
      ctx.fillStyle = rule;
      ctx.textAlign = "left";
      var old = sp; sp = 0;
      var unit = ctx.measureText(ch).width, nChars = Math.floor(CW / unit);
      type(new Array(nChars + 1).join(ch), PAD + (CW - nChars * unit) / 2, y0);
      sp = old;
      ctx.restore();
    }
    function hr() {
      y += 8;
      dashes(y, "- ");
      y += 30;
    }
    function heading(zh, en) {
      ctx.textAlign = "left";
      spacing(3); font("600 12px " + FONT_BODY);
      ctx.fillStyle = lav;
      type(zh, PAD, y);
      var w = measure(zh);
      spacing(2); font("500 12px " + FONT_LATIN);
      type(en, PAD + w + 8, y);
      spacing(0);
      y += 26;
    }
    // 左邊標籤、右邊數值；數值太長會自動換行（靠右）。沒有資料就整列不畫
    function kv(label, value, o) {
      if (!has(value)) return;
      o = o || {};
      var lh = 21;
      ctx.textAlign = "left";
      font("400 13px " + FONT_BODY);
      ctx.fillStyle = soft;
      type(label, PAD, y);
      font(o.valueFont || "400 15px " + FONT_BODY);
      ctx.fillStyle = o.color || ink;
      ctx.textAlign = "right";
      var ls = wrap(ctx, value, CW - LABEL_W);
      ls.forEach(function (ln, i) { type(ln, W - PAD, y + i * lh); });
      y += (ls.length - 1) * lh + 25;
    }

    // ---------- 2. 訂單資訊 ----------
    heading("訂單資訊", "ORDER");
    kv("訂單編號", "#" + rc.no);
    kv("收據建立時間", stamp(rc.at));
    kv("預約日期", rc.date);
    kv("預約狀態", rc.bookingStatus);
    (rc.rows || []).forEach(function (r) { kv(r[0], r[1]); }); // 舊格式的額外資訊

    // ---------- 3. 客戶資訊（沒有資料就整段不顯示） ----------
    if (has(cust.name) || contacts.length) {
      hr();
      heading("客戶資訊", "CLIENT");
      kv("客戶姓名", cust.name);
      contacts.forEach(function (c) { kv(c[0], c[1], { valueFont: "400 15px " + FONT_BODY }); });
    }

    // ---------- 4. 服務明細 ----------
    hr();
    heading("服務明細", "DETAILS");
    lines.forEach(function (l, idx) {
      font("400 16px " + FONT_BODY);
      var amt = rmoney(l.amount, rc.currency);
      var amtW = ctx.measureText(amt).width;
      ctx.fillStyle = ink;
      ctx.textAlign = "right";
      type(amt, W - PAD, y);
      ctx.textAlign = "left";
      var nameLines = wrap(ctx, l.name, CW - amtW - 18);
      nameLines.forEach(function (ln, i) { type(ln, PAD, y + i * 22); });
      y += (nameLines.length - 1) * 22 + 21;
      font("400 12.5px " + FONT_BODY);
      ctx.fillStyle = soft;
      type("單價 " + rmoney(l.price, rc.currency) + "　×　數量 " + l.qty, PAD, y);
      y += idx < lines.length - 1 ? 34 : 26;
    });

    // ---------- 5. 金額結算 ----------
    hr();
    heading("金額結算", "SUMMARY");
    var count = lines.reduce(function (s, l) { return s + Number(l.qty || 0); }, 0);
    var sub = rc.subtotal != null ? rc.subtotal : rc.total;
    kv("小計（共 " + count + " 件）", rmoney(sub, rc.currency), { valueFont: "400 15px " + FONT_BODY });
    adj.forEach(function (a) { kv(a.label, "−" + rmoney(a.amount, rc.currency), { color: print ? "#8A2F52" : "#B0466A" }); });
    // 總金額：淡紫色底、大的襯線字
    var boxTop = y - 2;
    dashes(boxTop + 4, "=");
    dashes(boxTop + 70, "=");
    ctx.textAlign = "left";
    spacing(2); font("600 15px " + FONT_BODY);
    ctx.fillStyle = ink;
    type("總金額 TOTAL", PAD + 2, boxTop + 43);
    spacing(0);
    var total = rmoney(rc.total, rc.currency);
    var size = 32;
    font("500 " + size + "px " + FONT_LATIN);
    while (size > 18 && measure(total) > CW - 84) { size -= 2; font("500 " + size + "px " + FONT_LATIN); }
    ctx.textAlign = "right";
    ctx.fillStyle = btn;
    type(total, W - PAD - 2, boxTop + 45);
    y = boxTop + 70 + 34;
    kv("付款狀態", rc.paymentStatus, { color: rc.paid === false ? (print ? "#8A4A1F" : "#A34D3B") : green });
    kv("付款方式", rc.method);
    if (given != null) {
      kv("收現金", rmoney(given, rc.currency), { valueFont: "400 15px " + FONT_BODY });
      kv("找零", rmoney(Math.max(0, given - rc.total), rc.currency), { color: green });
    }
    if (gifts.length) {
      font("600 14px " + FONT_BODY);
      var gl = [];
      gifts.forEach(function (gf) { wrap(ctx, "* 贈品：" + gf, CW - 32).forEach(function (x) { gl.push(x); }); });
      var bh = 18 + gl.length * 22;
      ctx.fillStyle = print ? "rgba(91,76,158,.07)" : "rgba(110,100,180,.08)";
      round(PAD, y - 6, CW, bh, 12);
      ctx.textAlign = "center";
      ctx.fillStyle = btn;
      gl.forEach(function (x, i) { type(x, W / 2, y + 16 + i * 22); });
      y += bh + 14;
    }

    // ---------- 6. 品牌結尾 ----------
    y -= 6;
    hr();
    ctx.textAlign = "center";
    spacing(5); font("600 18px " + FONT_DISPLAY);
    ctx.fillStyle = ink;
    type("謝謝你的到來", W / 2 + 2.5, y);
    spacing(3); font("400 13px " + FONT_BODY);
    ctx.fillStyle = soft;
    type("願光一路陪伴你", W / 2 + 1.5, y + 26);
    spacing(1.5); font("500 15px " + FONT_LATIN);
    ctx.fillStyle = btn;
    type("IG @nieia4928", W / 2, y + 50);
    spacing(0);
    y += 50 + 30;
    if (!print) {
      spacing(10); font("400 12px " + FONT_BODY);
      ctx.fillStyle = "#9698E7";
      type("*  *  *", W / 2, y);
      spacing(0);
      y += 6;
    }
    var outH = Math.ceil(y + 24);
    // 火焰印章當水印：正放、放大、很淡，置中在品牌區下方的內容區。
    // 用 multiply 疊上去，效果等同墊在背景，深色文字不受影響
    if (stampImg && stampImg.complete && stampImg.naturalWidth) {
      var bodyTop = 180, SD = Math.min(CW + 20, outH - bodyTop - 40);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = print ? .07 : .1;
      ctx.drawImage(stampImg, (W - SD) / 2, bodyTop + (outH - bodyTop - SD) / 2, SD, SD);
      ctx.restore();
    }
    var out = document.createElement("canvas");
    out.width = W * S; out.height = outH * S;
    out.getContext("2d").drawImage(cv, 0, 0);
    return out;
  }

  var lastReceipt = null;
  function showReceipt(rc, given) {
    if (!rc) return;
    // 收銀結帳一定是當場付清
    if (rc.paymentStatus == null && !rc.bookingStatus) { rc.paymentStatus = "已付款"; rc.paid = true; }
    lastReceipt = { rc: rc, given: given };
    var text = receiptText(rc, given);
    $("receiptNo").textContent = "#" + rc.no;
    $("receiptText").value = text;
    $("receiptImg").removeAttribute("src");
    receiptBlob = null;
    receiptName = "收據_" + rc.no + ".png";
    receiptModal.open();
    Promise.all([loadPaper(), loadFonts(text + "阿綸涅亞療癒服務憑證訂單資訊客戶明細金額結算編號收據建立時間預約日期狀態姓名聯絡單價數量小計共件總付款方式收現金找零贈品謝謝你的到來願光一路陪伴你"), loadStamp()]).then(function () {
      var cv = drawReceipt(rc, given);
      $("receiptImg").src = cv.toDataURL("image/png");
      cv.toBlob(function (b) {
        receiptBlob = b;
        var file = b && window.File ? new File([b], receiptName, { type: "image/png" }) : null;
        $("receiptShare").hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
        $("receiptCopyImg").hidden = !(navigator.clipboard && window.ClipboardItem);
      }, "image/png");
    });
  }

  // 預約也用同一份收據（後台預約卡片的「收據」按鈕）
  window.NieiaReceipt = { show: showReceipt, draw: drawReceipt };

  function flash(btn, text) {
    var old = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { btn.textContent = old; }, 1600);
  }

  $("receiptDownload").addEventListener("click", function () {
    if (receiptBlob) U.download(receiptBlob, receiptName);
  });
  $("receiptShare").addEventListener("click", function () {
    if (!receiptBlob) return;
    var file = new File([receiptBlob], receiptName, { type: "image/png" });
    navigator.share({ files: [file], text: $("receiptText").value }).catch(function () {});
  });
  // 列印／存成 PDF：白底深色字的版本，放進隱藏的 iframe 列印
  $("receiptPrint").addEventListener("click", function () {
    if (!lastReceipt) return;
    var url = drawReceipt(lastReceipt.rc, lastReceipt.given, { print: true }).toDataURL("image/png");
    var old = document.getElementById("receiptPrintFrame");
    if (old) old.remove();
    var f = document.createElement("iframe");
    f.id = "receiptPrintFrame";
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open();
    d.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + receiptName.replace(/\.png$/, "") + "</title><style>@page{margin:12mm}html,body{margin:0;background:#fff}img{display:block;width:100%;max-width:110mm;margin:0 auto}</style></head><body><img alt=\"收據\"></body></html>");
    d.close();
    var img = d.querySelector("img");
    img.onload = function () { setTimeout(function () { f.contentWindow.focus(); f.contentWindow.print(); }, 50); };
    img.src = url;
  });
  $("receiptCopyImg").addEventListener("click", function () {
    var btn = this;
    if (!receiptBlob) return;
    navigator.clipboard.write([new ClipboardItem({ "image/png": receiptBlob })]).then(function () { flash(btn, "已複製圖片"); }, function () { flash(btn, "無法複製，請改用下載"); });
  });
  $("receiptCopy").addEventListener("click", function () {
    var btn = this, ta = $("receiptText");
    var done = function () { flash(btn, "已複製文字"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); });
    else { ta.select(); try { document.execCommand("copy"); done(); } catch (e) { /* 手動複製 */ } }
  });

  renderPay();
})();
