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


  // ---------- 療癒項目詳細介紹彈窗 ----------
  function svcMeta(s, bookable) {
    var meta = [];
    if (s.mode === "onsite") meta.push("現場進行");
    else if (s.mode === "both") meta.push("遠距或現場");
    if (s.duration) meta.push(s.duration + " 分鐘");
    meta.push(bookable ? window.nieiaPrice(s, "service") : "價格即將公布，尚未開放預約");
    return meta.join("｜");
  }
  // 把後台寫的介紹轉成段落：空行分段、「1. 」「# 」小標題、「- 」條列、**粗體**
  function inline(parent, text) {
    String(text).split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.appendChild(el("strong", null, part.slice(2, -2)));
      else parent.appendChild(document.createTextNode(part));
    });
  }
  function richText(src) {
    var box = el("div", "rich");
    var list = null, para = null;
    String(src || "").replace(/\r/g, "").split("\n").forEach(function (raw) {
      var line = raw.trim();
      if (!line) { list = null; para = null; return; }
      var m;
      if ((m = line.match(/^(?:#+\s*|(\d+)[.、]\s*)(.+)$/)) && (line.charAt(0) === "#" || m[2].length <= 30)) {
        list = null; para = null;
        var h = el("h3");
        if (m[1]) h.appendChild(el("span", "num", m[1]));
        inline(h, m[2]);
        box.appendChild(h);
        return;
      }
      if ((m = line.match(/^[-•・*]\s+(.+)$/))) {
        para = null;
        if (!list) { list = el("ul"); box.appendChild(list); }
        var li = el("li");
        var kv = m[1].match(/^([^：:]{1,16})[：:]\s*(.+)$/);
        if (kv && kv[1].indexOf("**") < 0) { li.appendChild(el("strong", null, kv[1] + "：")); inline(li, kv[2]); }
        else inline(li, m[1]);
        list.appendChild(li);
        return;
      }
      list = null;
      if (para) para.appendChild(el("br"));
      else { para = el("p"); box.appendChild(para); }
      inline(para, line);
    });
    return box;
  }

  // 工作坊頁的課程介紹也用同一套分段規則
  window.nieiaRichText = richText;

  // ---------- 匯款方式（預約療癒與工作坊報名共用） ----------
  function copyText(text, btn) {
    var done = function () { btn.textContent = "已複製"; setTimeout(function () { btn.textContent = "複製"; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  }
  window.nieiaPayment = function (payment) {
    var box = el("div", "pay-methods");
    (payment && payment.methods || []).forEach(function (m) {
      var sec = el("section", "pay-method");
      sec.appendChild(el("h3", null, m.name));
      var dl = el("dl", "pay-lines");
      m.lines.forEach(function (line) {
        var wrap = el("div", line[0] ? null : "plain");
        if (line[0]) wrap.appendChild(el("dt", null, line[0]));
        var dd = el("dd");
        dd.appendChild(el("span", null, line[1]));
        // 帳號（或一長串數字）可以一鍵複製
        if (/帳號|帳戶|account/i.test(line[0]) || /^[\d\s-]{6,}$/.test(line[1])) {
          var copy = el("button", "mini-copy", "複製");
          copy.type = "button";
          copy.addEventListener("click", function () { copyText(line[1].replace(/[\s-]/g, ""), copy); });
          dd.appendChild(copy);
        }
        wrap.appendChild(dd);
        dl.appendChild(wrap);
      });
      sec.appendChild(dl);
      if (m.link) {
        var a = el("a", "btn btn-ghost pay-link", m.link.label);
        a.href = m.link.url; a.target = "_blank"; a.rel = "noopener";
        sec.appendChild(a);
      }
      box.appendChild(sec);
    });
    if (!box.children.length) box.appendChild(el("p", "muted", "匯款方式會由阿綸私訊告訴你。"));
    return box;
  };

  var sheet = null, lastFocus = null;
  function closeDetail() {
    if (!sheet) return;
    sheet.hidden = true;
    document.documentElement.classList.remove("no-scroll");
    document.removeEventListener("keydown", onKey);
    if (lastFocus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === "Escape") closeDetail(); }
  function openDetail(s, bookable, from) {
    lastFocus = from;
    if (!sheet) {
      sheet = el("div", "sheet-backdrop detail-backdrop");
      sheet.addEventListener("click", function (e) { if (e.target === sheet) closeDetail(); });
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = "";
    var card = el("section", "sheet glass detail-sheet");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "detailTitle");
    var x = el("button", "detail-x");
    x.type = "button"; x.setAttribute("aria-label", "關閉");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", closeDetail);
    card.appendChild(x);

    var head = el("header", "detail-head");
    head.appendChild(window.nieiaArt(s.glyph, s.palette));
    var t = el("div", "detail-title");
    var h = el("h2", null, s.name); h.id = "detailTitle";
    t.appendChild(h);
    if (s.en) t.appendChild(el("span", "en", s.en));
    t.appendChild(el("span", "meta", svcMeta(s, bookable)));
    head.appendChild(t);
    card.appendChild(head);

    var body = el("div", "detail-body");
    body.appendChild(s.detail ? richText(s.detail) : richText(s.desc || ""));
    card.appendChild(body);

    var foot = el("footer", "detail-foot");
    if (bookable) {
      foot.appendChild(el("p", "detail-ask", "想預約這個療癒嗎？"));
      var acts = el("div", "actions");
      var go = el("a", "btn btn-primary", "預約療癒");
      go.href = "/booking?service=" + encodeURIComponent(s.id);
      var later = el("button", "btn btn-ghost", "再看看");
      later.type = "button"; later.addEventListener("click", closeDetail);
      acts.appendChild(go); acts.appendChild(later);
      foot.appendChild(acts);
    } else {
      foot.appendChild(el("p", "detail-ask", "價格即將公布，目前還不能線上預約。想先了解可以私訊 IG。"));
      var acts2 = el("div", "actions");
      var ig = el("a", "btn btn-primary", "IG 私訊阿綸");
      ig.href = "https://www.instagram.com/nieia4928/"; ig.target = "_blank"; ig.rel = "noopener";
      var close = el("button", "btn btn-ghost", "關閉");
      close.type = "button"; close.addEventListener("click", closeDetail);
      acts2.appendChild(ig); acts2.appendChild(close);
      foot.appendChild(acts2);
    }
    card.appendChild(foot);
    sheet.appendChild(card);
    sheet.hidden = false;
    body.scrollTop = 0;
    document.documentElement.classList.add("no-scroll");
    document.addEventListener("keydown", onKey);
    x.focus({ preventScroll: true });
  }

  // ---------- 療癒服務頁 ----------
  var svcList = document.getElementById("svc-list");
  if (svcList) {
    fetch("/api/services").then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok || !data.items) return;
      svcList.innerHTML = "";
      data.items.forEach(function (s) {
        var bookable = s.priceMode && s.priceMode !== "coming";
        var row = el("a", "row glass" + (bookable ? "" : " not-bookable"));
        row.href = bookable ? "/booking?service=" + encodeURIComponent(s.id) : "#" + s.id;
        row.setAttribute("aria-haspopup", "dialog");
        row.setAttribute("data-cat", s.category);
        row.appendChild(window.nieiaArt(s.glyph, s.palette));
        var text = el("div", "text");
        text.appendChild(el("h3", null, s.name));
        if (s.en) text.appendChild(el("span", "en", s.en));
        if (s.desc) text.appendChild(el("span", "desc", s.desc));
        text.appendChild(el("span", "meta", svcMeta(s, bookable)));
        row.appendChild(text);
        var go = el("span", "go");
        go.innerHTML = CHEV;
        row.appendChild(go);
        row.addEventListener("click", function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return; // 另開分頁時照原本連結
          e.preventDefault();
          openDetail(s, bookable, row);
        });
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
