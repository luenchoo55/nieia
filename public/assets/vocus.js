// 首頁「最新文章」：向 /api/vocus 拿方格子沙龍最新 6 篇文章，列在同一張卡片裡（只有標題和日期）。
// 拿不到時只留下「看更多文章」按鈕和一句提示，頁面其他地方不受影響。
(function () {
  var list = document.getElementById("vocusList");
  if (!list) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function prettyDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric" }).format(d);
    } catch (e) {
      return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
    }
  }

  function row(a) {
    var link = el("a", "vocus-row");
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.appendChild(el("span", "vocus-title", a.title));
    var date = prettyDate(a.date);
    if (date) {
      var t = el("time", null, date);
      t.dateTime = a.date;
      link.appendChild(t);
    }
    return link;
  }

  function showFallback() {
    list.textContent = "";
    list.appendChild(el("p", "vocus-note", "文章暫時載入不了，可以直接到方格子沙龍看阿綸的文章。"));
  }

  fetch("/api/vocus", { headers: { accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var items = (d && Array.isArray(d.items)) ? d.items.filter(function (a) { return a && a.url && a.title; }) : [];
      if (!items.length) return showFallback();
      list.textContent = "";
      items.slice(0, 6).forEach(function (a) { list.appendChild(row(a)); });
    })
    .catch(showFallback);
})();
