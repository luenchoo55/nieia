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
    var out = [
      "【阿綸涅亞 NIEIA 收據】",
      "單號：#" + rc.no,
      "時間：" + stamp(rc.at),
      "付款：" + rc.method,
      "－－－－－－－－－－",
    ];
    rc.lines.forEach(function (l) {
      out.push(l.name);
      out.push("　" + money(l.price, rc.currency) + " × " + l.qty + "　" + money(l.amount, rc.currency));
    });
    out.push("－－－－－－－－－－");
    if (rc.adjustments && rc.adjustments.length) {
      out.push("小計：" + money(rc.subtotal, rc.currency));
      rc.adjustments.forEach(function (a) { out.push(a.label + "：−" + money(a.amount, rc.currency)); });
    }
    out.push("合計：" + money(rc.total, rc.currency));
    (rc.gifts || []).forEach(function (g) { out.push("贈品：" + g); });
    if (given != null) {
      out.push("收現金：" + money(given, rc.currency));
      out.push("找零：" + money(Math.max(0, given - rc.total), rc.currency));
    }
    out.push("");
    out.push("謝謝你的到來，願光一路陪伴你 ✦");
    out.push("IG @nieia4928");
    return out.join("\n");
  }

  // 收據圖片用 canvas 畫，配色與字體跟網站一致
  var FONT_DISPLAY = '"LXGW WenKai TC", "Noto Serif TC", serif';
  var FONT_BODY = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
  var FONT_LATIN = '"Cormorant Garamond", "Times New Roman", serif';

  function loadFonts(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("700 40px " + FONT_DISPLAY, text),
      document.fonts.load("400 20px " + FONT_BODY, text),
      document.fonts.load("600 20px " + FONT_BODY, text),
      document.fonts.load("500 40px " + FONT_LATIN, "NIEIA0123456789$,RM"),
    ]).catch(function () {});
  }

  function fitText(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
    return s + "…";
  }

  function drawReceipt(rc, given) {
    var W = 440, PAD = 36, S = 2;
    var lineH = 62;
    var H = 400 + rc.lines.length * lineH + ((rc.adjustments || []).length + 1) * 26 + (rc.gifts || []).length * 30 + 260; // 先畫在夠高的畫布上，最後依實際高度裁切
    var cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    var ctx = cv.getContext("2d");
    ctx.scale(S, S);
    var ink = "#362F52", soft = "#625A80", btn = "#4A3F78", line = "rgba(54,47,82,.16)";
    function spacing(px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }

    // 背景：奶白底＋上方柔和的光暈
    ctx.fillStyle = "#FCF8F8";
    ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(150,152,231,.55)");
    g.addColorStop(.5, "rgba(238,193,221,.55)");
    g.addColorStop(1, "rgba(244,203,146,.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 150);
    var fade = ctx.createLinearGradient(0, 40, 0, 150);
    fade.addColorStop(0, "rgba(252,248,248,0)");
    fade.addColorStop(1, "#FCF8F8");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 40, W, 110);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink;
    spacing(6);
    ctx.font = "700 34px " + FONT_DISPLAY;
    ctx.fillText("阿綸涅亞", W / 2, 66);
    spacing(8);
    ctx.font = "500 17px " + FONT_LATIN;
    ctx.fillStyle = soft;
    ctx.fillText("NIEIA", W / 2, 92);

    // 「收據」小膠囊
    spacing(8);
    ctx.font = "600 14px " + FONT_BODY;
    var pw = 84, ph = 28, px = W / 2 - pw / 2, py = 108;
    ctx.strokeStyle = btn; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 14); else ctx.rect(px, py, pw, ph);
    ctx.stroke();
    ctx.fillStyle = btn;
    ctx.fillText("收據", W / 2 + 4, py + 19);
    spacing(0);

    var y = 172;
    function row(label, value, opts) {
      opts = opts || {};
      ctx.textAlign = "left";
      ctx.font = (opts.labelFont || "400 14px ") + FONT_BODY;
      ctx.fillStyle = soft;
      ctx.fillText(label, PAD, y);
      ctx.textAlign = "right";
      ctx.font = opts.valueFont || "600 14px " + FONT_BODY;
      ctx.fillStyle = opts.color || ink;
      ctx.fillText(value, W - PAD, y);
    }
    function dashed() {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = line;
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      ctx.restore();
    }

    row("單號", "#" + rc.no); y += 26;
    row("時間", stamp(rc.at)); y += 26;
    row("付款", rc.method); y += 22;
    dashed(); y += 34;

    rc.lines.forEach(function (l) {
      ctx.textAlign = "left";
      ctx.font = "600 16px " + FONT_BODY;
      ctx.fillStyle = ink;
      ctx.fillText(fitText(ctx, l.name, W - PAD * 2 - 110), PAD, y);
      ctx.textAlign = "right";
      ctx.fillText(money(l.amount, rc.currency), W - PAD, y);
      ctx.textAlign = "left";
      ctx.font = "400 13px " + FONT_BODY;
      ctx.fillStyle = soft;
      ctx.fillText(money(l.price, rc.currency) + " × " + l.qty, PAD, y + 22);
      y += lineH;
    });
    y -= 18;
    dashed(); y += 30;

    var count = rc.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    var adj = rc.adjustments || [];
    row("共 " + count + " 件", money(adj.length ? rc.subtotal : rc.total, rc.currency), { color: soft, valueFont: "400 14px " + FONT_BODY }); y += 26;
    adj.forEach(function (a) {
      row(a.label, "−" + money(a.amount, rc.currency), { color: "#B0466A", valueFont: "600 14px " + FONT_BODY }); y += 26;
    });
    y -= 4;
    ctx.fillStyle = ink;
    ctx.fillRect(PAD, y, W - PAD * 2, 1.5);
    y += 46;
    row("合計", money(rc.total, rc.currency), { labelFont: "600 18px ", valueFont: "500 40px " + FONT_LATIN, color: btn });
    y += 20;
    ctx.fillStyle = ink;
    ctx.fillRect(PAD, y, W - PAD * 2, 1.5);
    y += 32;
    if (given != null) {
      row("收現金", money(given, rc.currency), { color: soft }); y += 26;
      row("找零", money(Math.max(0, given - rc.total), rc.currency), { color: "#2F7A5B" }); y += 30;
    }

    // 贈品：虛線框
    var gifts = rc.gifts || [];
    if (gifts.length) {
      var bh = 16 + gifts.length * 26;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = btn;
      ctx.fillStyle = "rgba(238,193,221,.25)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(PAD, y - 6, W - PAD * 2, bh, 12); else ctx.rect(PAD, y - 6, W - PAD * 2, bh);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.textAlign = "center";
      ctx.font = "600 15px " + FONT_BODY;
      ctx.fillStyle = btn;
      gifts.forEach(function (gf, i) { ctx.fillText("✦ 贈品：" + gf, W / 2, y + 20 + i * 26); });
      y += bh + 18;
    }
    y += 26;

    ctx.textAlign = "center";
    spacing(6);
    ctx.font = "700 18px " + FONT_DISPLAY;
    ctx.fillStyle = ink;
    ctx.fillText("謝謝你的到來", W / 2, y); y += 26;
    spacing(2);
    ctx.font = "400 13px " + FONT_BODY;
    ctx.fillStyle = soft;
    ctx.fillText("願光一路陪伴你　IG @nieia4928", W / 2, y); y += 28;
    spacing(10);
    ctx.fillStyle = "#9698E7";
    ctx.font = "400 14px " + FONT_BODY;
    ctx.fillText("✦ ✦ ✦", W / 2, y);
    spacing(0);
    var outH = Math.ceil(y + 34);
    var out = document.createElement("canvas");
    out.width = W * S; out.height = outH * S;
    out.getContext("2d").drawImage(cv, 0, 0);
    return out;
  }

  function showReceipt(rc, given) {
    if (!rc) return;
    var text = receiptText(rc, given);
    $("receiptNo").textContent = "#" + rc.no;
    $("receiptText").value = text;
    $("receiptImg").removeAttribute("src");
    receiptBlob = null;
    receiptName = "收據_" + rc.no + ".png";
    receiptModal.open();
    loadFonts(text + "阿綸涅亞收據單號時間付款共件小計合計收現金找零贈品謝謝你的到來願光一路陪伴你").then(function () {
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
