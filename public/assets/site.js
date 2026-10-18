(function () {
  "use strict";

  // 依時段問候
  var g = document.querySelector("[data-greeting]");
  if (g) {
    var h = new Date().getHours();
    g.textContent = h < 5 ? "夜深了，" : h < 11 ? "早安，" : h < 14 ? "午安，" : h < 18 ? "下午好，" : "晚安，";
  }

  // 分類標籤：篩選列表
  document.querySelectorAll("[data-filter-group]").forEach(function (group) {
    var target = document.querySelector(group.getAttribute("data-filter-group"));
    if (!target) return;
    group.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      var key = btn.getAttribute("data-filter");
      group.querySelectorAll("[data-filter]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      target.querySelectorAll("[data-cat]").forEach(function (item) {
        item.hidden = key !== "all" && item.getAttribute("data-cat") !== key;
      });
    });
  });

  // 切換按鈕：切換面板
  document.querySelectorAll("[data-tabs]").forEach(function (tabs) {
    var buttons = tabs.querySelectorAll("[role='tab']");
    function select(btn) {
      buttons.forEach(function (b) {
        var on = b === btn;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(b.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
    }
    tabs.addEventListener("click", function (e) {
      var btn = e.target.closest("[role='tab']");
      if (btn) select(btn);
    });
    tabs.addEventListener("keydown", function (e) {
      var list = Array.prototype.slice.call(buttons);
      var i = list.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        var next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
        next.focus(); select(next);
      }
    });
  });
})();
