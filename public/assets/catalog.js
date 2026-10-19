// 前台：從後台讀取療癒項目與商品；讀取失敗時保留頁面上原本的內容
(function () {
  "use strict";

  function money(item) {
    var parts = [];
    if (item.priceTwd != null) parts.push("NT$" + Number(item.priceTwd).toLocaleString("en-US"));
    if (item.priceMyr != null) parts.push("RM " + Number(item.priceMyr).toLocaleString("en-US"));
    return parts.join("｜");
  }

  window.nieiaPrice = function (item, kind) {
    if (kind === "product") {
      if (item.soldOut) return "已售完";
      return money(item) || "價格請私訊詢問";
    }
    if (item.priceMode === "coming") return "價格即將公布";
    if (item.priceMode === "inquiry") return "隨喜服務";
    return money(item) || "價格即將公布";
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // ---------- 療癒服務頁 ----------
  var svcList = document.getElementById("svc-list");
  if (svcList) {
    fetch("/api/services").then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok || !data.items) return;
      svcList.innerHTML = "";
      data.items.forEach(function (s) {
        var row = el("a", "row glass");
        row.href = "/booking?service=" + encodeURIComponent(s.id);
        row.setAttribute("data-cat", s.category);
        row.appendChild(window.nieiaArt(s.glyph, s.palette));
        var text = el("div", "text");
        text.appendChild(el("h3", null, s.name));
        if (s.en) text.appendChild(el("span", "en", s.en));
        if (s.desc) text.appendChild(el("span", "desc", s.desc));
        var meta = ["IG 視訊遠距"];
        if (s.duration) meta.push(s.duration + " 分鐘");
        meta.push(window.nieiaPrice(s, "service"));
        text.appendChild(el("span", "meta", meta.join("｜")));
        row.appendChild(text);
        var go = el("span", "go");
        go.innerHTML = CHEV;
        row.appendChild(go);
        svcList.appendChild(row);
      });
      if (!data.items.length) svcList.appendChild(el("p", "notice glass", "目前沒有開放的療癒項目，請追蹤 IG @nieia4928 留意最新消息。"));
      // 重新套用目前選中的分類
      var active = document.querySelector('[data-filter-group="#svc-list"] [aria-pressed="true"]');
      if (active) active.click();
    }).catch(function () { /* 保留原本內容 */ });
  }

  // ---------- 聖照選物頁 ----------
  var shop = document.getElementById("shop-list");
  if (shop) {
    fetch("/api/products").then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok || !data.items) return;
      shop.innerHTML = "";
      data.items.forEach(function (p) {
        var canBuy = p.url && !p.soldOut;
        var tile = el(canBuy ? "a" : "div", "tile product glass" + (p.soldOut ? " sold-out" : ""));
        if (canBuy) { tile.href = p.url; tile.target = "_blank"; tile.rel = "noopener"; }
        tile.appendChild(window.nieiaArt(p.glyph, p.palette));
        tile.appendChild(el("span", "label", p.name));
        tile.appendChild(el("span", "price", window.nieiaPrice(p, "product")));
        if (p.desc) tile.appendChild(el("span", "pdesc", p.desc));
        shop.appendChild(tile);
      });
      if (!data.items.length) shop.appendChild(el("p", "notice glass", "目前沒有上架的商品。"));
    }).catch(function () { /* 保留原本內容 */ });
  }
})();
