// 後台：總覽、打開後台時的提醒、下載全部資料
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  var U = window.NieiaUI;
  if (!A || !U) return;
  var el = U.el, button = U.button, money = U.money;

  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var remind = U.modal("remindModal");

  var STATUS = { pending_payment: ["等待匯款", "closed"], payment_reported: ["已回報匯款", "booked"], confirmed: ["已成立", "open"] };

  function goTab(id) {
    remind.close();
    var t = $("tab-" + id);
    if (!t) return;
    t.click();
    t.scrollIntoView({ block: "nearest", inline: "center" });
    document.querySelector(".admin-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function load() {
    return A.api("/api/admin/overview").then(function (r) {
      if (r.status === 401) { A.checkSession(); return null; }
      if (!r.ok) { $("ovBody").innerHTML = ""; $("ovBody").appendChild(el("p", "empty glass", r.message || "暫時無法載入總覽。")); return null; }
      data = r;
      render();
      return r;
    });
  }

  // ---------- 總覽 ----------
  function stat(label, value, sub, onClick) {
    var b = el(onClick ? "button" : "div", "ov-stat glass");
    if (onClick) { b.type = "button"; b.addEventListener("click", onClick); }
    b.appendChild(el("span", "ov-label", label));
    var v = el("strong", "ov-value");
    (Array.isArray(value) ? value : [value]).forEach(function (x) { v.appendChild(el("span", null, x)); });
    b.appendChild(v);
    if (sub) b.appendChild(el("span", "ov-sub", sub));
    return b;
  }

  function bookingLine(b, showDate) {
    var row = el("button", "ov-line");
    row.type = "button";
    row.addEventListener("click", function () { goTab("bookings"); });
    var when = el("span", "ov-when", (showDate ? U.prettyDate(b.date) + " " : "") + b.start + "–" + b.end);
    row.appendChild(when);
    var main = el("span", "ov-main");
    main.appendChild(el("strong", null, b.name));
    main.appendChild(el("span", null, b.serviceName + (b.mode === "onsite" ? "（現場）" : "")));
    row.appendChild(main);
    var st = STATUS[b.status] || [b.status, "closed"];
    row.appendChild(el("span", "pill " + st[1], st[0]));
    return row;
  }

  function tuitionLine(x, label) {
    var row = el("a", "ov-line");
    row.href = "/admin/workshops";
    row.appendChild(el("span", "ov-when", U.prettyDate(x.firstDate)));
    var main = el("span", "ov-main");
    main.appendChild(el("strong", null, x.name));
    main.appendChild(el("span", null, x.title + "・" + label));
    row.appendChild(main);
    row.appendChild(el("span", "ov-amt", x.amount == null ? "金額未設定" : money(x.amount, x.currency)));
    return row;
  }

  function render() {
    var d = data;
    var host = $("ovBody");
    host.innerHTML = "";

    var stats = el("div", "ov-stats");
    var mt = d.monthTotals;
    var monthNo = Number(d.month.slice(5));
    stats.appendChild(stat(monthNo + " 月收入", [money(mt.TWD.income, "TWD"), money(mt.MYR.income, "MYR")],
      d.missingAmounts ? "有 " + d.missingAmounts + " 筆金額待補" : "支出 " + money(mt.TWD.expense, "TWD") + "・" + money(mt.MYR.expense, "MYR"),
      function () { goTab("ledger"); }));
    var pendingCount = d.pendingBookings.length + d.pendingTuition.length;
    stats.appendChild(stat("待匯款", pendingCount + " 筆", "預約 " + d.pendingBookings.length + "・工作坊 " + d.pendingTuition.length, function () { goTab("bookings"); }));
    stats.appendChild(stat("這週預約", d.week.count + " 位", U.prettyDate(d.week.start) + "–" + U.prettyDate(d.week.end), function () { goTab("bookings"); }));
    host.appendChild(stats);

    // 進行中的工作坊：列在「工作坊管理」卡片裡，沒有就不顯示
    var w = $("ovWorkshops");
    w.innerHTML = "";
    w.hidden = !d.upcomingWorkshops.length;
    d.upcomingWorkshops.forEach(function (x) {
      var row = el("a", "ov-line");
      row.href = "/admin/workshops";
      row.appendChild(el("span", "ov-when", U.prettyDate(x.firstDate) + (x.start ? " " + x.start : "")));
      var main = el("span", "ov-main");
      main.appendChild(el("strong", null, x.title));
      var bits = [(x.format === "online" ? "線上" : x.location || "實體") , "報名 " + x.attendees + (x.capacity ? "／" + x.capacity : "") + " 位"];
      if (x.unpaidTuition) bits.push("學費未付 " + x.unpaidTuition);
      if (x.unpaidMaterial) bits.push("教材費未付 " + x.unpaidMaterial);
      main.appendChild(el("span", null, bits.join("・")));
      row.appendChild(main);
      row.appendChild(el("span", "pill " + (x.started ? "booked" : "open"), x.started ? "上課中" : "報名中"));
      w.appendChild(row);
    });
  }

  // ---------- 提醒彈窗 ----------
  function renderRemind() {
    var d = data;
    var body = $("remindBody");
    body.innerHTML = "";
    var any = false;
    function group(title, items, draw, more) {
      if (!items.length) return;
      any = true;
      var s = el("section", "remind-group");
      var h = el("h3", null, title);
      h.appendChild(el("span", "count", " " + items.length));
      s.appendChild(h);
      items.slice(0, 8).forEach(function (x) { s.appendChild(draw(x)); });
      if (items.length > 8) {
        var all = button("查看全部 " + items.length + " 筆", "mini", more || function () {
          items.slice(8).forEach(function (x) { s.insertBefore(draw(x), all); });
          all.remove();
        });
        s.appendChild(all);
      }
      body.appendChild(s);
    }
    $("remindTitle").textContent = U.prettyDate(d.today) + " 的提醒";

    group("今天的預約", d.bookingsToday, function (b) { return bookingLine(b); }, function () { goTab("bookings"); });
    group("明天的預約", d.bookingsTomorrow, function (b) { return bookingLine(b); }, function () { goTab("bookings"); });
    group("待匯款的預約", d.pendingBookings, function (b) { return bookingLine(b, true); }, function () { goTab("bookings"); });
    group("工作坊學費未付", d.pendingTuition, function (x) { return tuitionLine(x, "學費未付"); }, function () { location.href = "/admin/workshops"; });
    group("教材費未付（兩週內開課）", d.materialDue, function (x) { return tuitionLine(x, "教材費未付"); }, function () { location.href = "/admin/workshops"; });
    group("庫存不足的商品", d.lowStock, function (p) {
      var row = el("button", "ov-line");
      row.type = "button";
      row.addEventListener("click", function () { goTab("products"); });
      var main = el("span", "ov-main");
      main.appendChild(el("strong", null, p.name));
      main.appendChild(el("span", null, "低於 " + p.lowStock + " 件就提醒" + (p.published ? "" : "・已下架")));
      row.appendChild(main);
      row.appendChild(el("span", "ov-amt warn", p.stock <= 0 ? "沒有庫存" : "剩 " + p.stock + " 件"));
      return row;
    }, function () { goTab("products"); });
    group("超過 3 個月沒來的老客人", d.oldCustomers, function (cu) {
      var row = el("div", "ov-line ov-stack");
      var main = el("span", "ov-main");
      main.appendChild(el("strong", null, cu.name));
      main.appendChild(el("span", null, [cu.instagram && "IG @" + cu.instagram, cu.email, cu.phone].filter(Boolean).join("・")));
      row.appendChild(main);
      row.appendChild(el("span", "ov-amt", "來過 " + cu.visitCount + " 次・上次 " + U.fullDate(cu.lastVisit)));
      return row;
    });

    if (!any) body.appendChild(el("p", "empty", "今天沒有需要特別注意的事，好好休息 ✨"));
  }

  function showRemind() {
    if (!data) return;
    renderRemind();
    remind.open();
  }

  // ---------- 下載全部資料 ----------
  function exportAll() {
    var btn = $("ovExport");
    btn.disabled = true;
    btn.textContent = "準備中…";
    A.api("/api/admin/export").then(function (r) {
      btn.disabled = false;
      btn.textContent = "下載全部資料";
      if (!U.guard(r)) return;
      var sheets = r.sheets.map(function (sh) {
        var widths = (sh.rows[0] || []).map(function (_, ci) {
          var max = 6;
          sh.rows.slice(0, 200).forEach(function (row) { var v = row[ci]; if (v) max = Math.max(max, Math.min(50, String(v).length * 1.6)); });
          return Math.round(max);
        });
        return { name: sh.name, rows: sh.rows, widths: widths };
      });
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, "0"); };
      var name = "NIEIA備份_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".xlsx";
      U.download(window.nieiaXlsxBook(sheets), name);
      A.toast("已下載 " + name);
    });
  }

  $("ovRemind").addEventListener("click", function () { if (data) showRemind(); else load().then(function (r) { if (r) showRemind(); }); });
  $("ovExport").addEventListener("click", exportAll);
  // 每次打開後台（打開頁面或登入後）跳出提醒
  document.addEventListener("nieia:dash", function () {
    load().then(function (r) { if (r) showRemind(); });
  });
  window.NieiaOverview = { reload: load };
})();
