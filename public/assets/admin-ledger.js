// 後台：收支記帳與每月報表（新台幣、馬幣分開）
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  var U = window.NieiaUI;
  if (!A || !U) return;
  var el = U.el, button = U.button, money = U.money;

  var $ = function (id) { return document.getElementById(id); };
  var CATS = {
    expense: ["場地", "材料", "交通", "廣告", "平台手續費", "器材", "進貨", "其他"],
    income: ["商品", "其他收入"],
  };
  var SOURCE = { booking: "預約", workshop: "工作坊", market: "擺攤", manual: "手動" };
  var data = null;
  var type = "expense";
  var products = [];

  function thisMonth() { return U.today().slice(0, 7); }

  function load() {
    var month = $("ldMonth").value || thisMonth();
    if (!data) { $("ldBody").innerHTML = ""; $("ldBody").appendChild(el("p", "empty glass", "載入中…")); }
    return A.api("/api/admin/ledger?month=" + month).then(function (r) {
      if (!U.guard(r)) return;
      data = r;
      render();
    });
  }

  function totalCard(cur, t) {
    var c = el("div", "ld-total glass");
    c.appendChild(el("span", "ov-label", cur === "TWD" ? "新台幣" : "馬幣"));
    var dl = el("dl", "ld-nums");
    [["收入", t.income, ""], ["支出", t.expense, ""], ["結餘", t.net, t.net < 0 ? "neg" : "pos"]].forEach(function (x) {
      var w = el("div", x[2]);
      w.appendChild(el("dt", null, x[0]));
      w.appendChild(el("dd", null, money(x[1], cur)));
      dl.appendChild(w);
    });
    c.appendChild(dl);
    return c;
  }

  function section(title, count) {
    var s = el("section", "glass form-card ov-section");
    var h = el("div", "block-head");
    h.appendChild(el("h3", null, title));
    if (count != null) h.appendChild(el("span", "count", count));
    s.appendChild(h);
    return s;
  }

  function render() {
    var d = data;
    var host = $("ldBody");
    host.innerHTML = "";
    var m = Number(d.month.slice(5));

    var totals = el("div", "ld-totals");
    totals.appendChild(totalCard("TWD", d.totals.TWD));
    totals.appendChild(totalCard("MYR", d.totals.MYR));
    host.appendChild(totals);

    if (d.missing.length) host.appendChild(missingCard(d.missing));

    // 依類別
    var cat = section(m + " 月分類統計");
    if (!d.categories.length) cat.appendChild(el("p", "hint", "這個月還沒有收支。"));
    ["income", "expense"].forEach(function (t) {
      var rows = d.categories.filter(function (x) { return x.type === t; });
      if (!rows.length) return;
      cat.appendChild(el("p", "ld-sub", t === "income" ? "收入" : "支出"));
      rows.forEach(function (x) {
        var line = el("div", "ld-line");
        line.appendChild(el("span", "ld-cat", x.category));
        line.appendChild(el("span", "ld-amt " + t, money(x.amount, x.currency)));
        cat.appendChild(line);
      });
    });
    host.appendChild(cat);

    // 明細
    var list = section(m + " 月明細", d.entries.length ? d.entries.length + " 筆" : "");
    if (!d.entries.length) list.appendChild(el("p", "hint", "這個月還沒有收支。"));
    d.entries.forEach(function (e) {
      var line = el("div", "ld-entry");
      line.appendChild(el("span", "ld-date", U.prettyDate(e.date)));
      var main = el("span", "ld-main");
      main.appendChild(el("strong", null, e.category));
      main.appendChild(el("span", null, [SOURCE[e.source], e.label].filter(Boolean).join("｜")));
      line.appendChild(main);
      line.appendChild(el("span", "ld-amt " + e.type, (e.type === "expense" ? "−" : "") + money(e.amount, e.currency)));
      if (e.source === "manual") {
        var del = button("刪除", "mini danger");
        U.armed(del, "刪除", "確定？", function () {
          del.disabled = true;
          A.api("/api/admin/ledger/" + e.ref, { method: "DELETE" }).then(function (r) {
            del.disabled = false;
            if (!U.guard(r)) return;
            A.toast(e.category === "商品" ? "已刪除，庫存已加回去" : "已刪除");
            load();
          });
        });
        line.appendChild(del);
      }
      list.appendChild(line);
    });
    host.appendChild(list);

    // 全年每月
    var yr = section(d.month.slice(0, 4) + " 年每月結餘");
    var tbl = el("table", "ld-year");
    var thead = el("thead");
    var hr = el("tr");
    ["月份", "新台幣收入", "新台幣支出", "馬幣收入", "馬幣支出"].forEach(function (x) { var th = el("th", null, x); th.scope = "col"; hr.appendChild(th); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el("tbody");
    d.year.forEach(function (y) {
      var t = y.totals;
      if (!t.TWD.income && !t.TWD.expense && !t.MYR.income && !t.MYR.expense && y.month !== d.month) return;
      var tr = el("tr", y.month === d.month ? "is-current" : "");
      var th = el("th", null, Number(y.month.slice(5)) + " 月");
      th.scope = "row";
      tr.appendChild(th);
      [[t.TWD.income, "TWD"], [t.TWD.expense, "TWD"], [t.MYR.income, "MYR"], [t.MYR.expense, "MYR"]].forEach(function (x) {
        tr.appendChild(el("td", null, x[0] ? money(x[0], x[1]) : "—"));
      });
      tr.addEventListener("click", function () { $("ldMonth").value = y.month; load(); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var wrap = el("div", "roster-wrap");
    wrap.appendChild(tbl);
    yr.appendChild(wrap);
    host.appendChild(yr);
  }

  // 金額還沒填的收入：隨喜／價格未定的預約、擺攤的隨喜
  function missingCard(list) {
    var s = section("待補金額", list.length + " 筆");
    s.classList.add("ld-missing");
    s.appendChild(el("p", "hint", "這些收入還不知道實際收了多少，填好後才會算進報表。"));
    list.forEach(function (e) {
      var f = el("form", "ld-fill");
      f.noValidate = true;
      var info = el("span", "ld-main");
      info.appendChild(el("strong", null, U.prettyDate(e.date) + "　" + e.category));
      info.appendChild(el("span", null, e.label));
      f.appendChild(info);
      var amt = el("input");
      amt.type = "number"; amt.inputMode = "numeric"; amt.min = "0"; amt.step = "1";
      amt.placeholder = "實收金額";
      amt.setAttribute("aria-label", "實收金額");
      var cur = el("select");
      cur.setAttribute("aria-label", "幣別");
      [["TWD", "NT$"], ["MYR", "RM"]].forEach(function (c) { var o = el("option", null, c[1]); o.value = c[0]; cur.appendChild(o); });
      cur.value = e.currency || "TWD";
      if (e.source === "booking") cur.disabled = true; // 預約的幣別依客人居住地
      var save = el("button", "mini", "儲存");
      save.type = "submit";
      f.appendChild(cur);
      f.appendChild(amt);
      f.appendChild(save);
      f.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (amt.value === "") { amt.focus(); return; }
        save.disabled = true;
        var req = e.source === "booking"
          ? A.api("/api/admin/bookings/" + e.ref, { method: "PATCH", body: { paidAmount: amt.value } })
          : A.api("/api/admin/ledger/market/" + encodeURIComponent(e.ref), { method: "PUT", body: { amount: amt.value, currency: cur.value } });
        req.then(function (r) {
          save.disabled = false;
          if (!U.guard(r)) return;
          A.toast("已填入實收金額");
          load();
          if (window.NieiaOverview) window.NieiaOverview.reload();
        });
      });
      s.appendChild(f);
    });
    return s;
  }

  // ---------- 下載這個月 ----------
  function downloadMonth() {
    if (!data) return;
    var d = data;
    var rows = [["日期", "收入／支出", "來源", "類別", "幣別", "金額", "說明"]].concat(d.entries.map(function (e) {
      return [e.date, e.type === "income" ? "收入" : "支出", SOURCE[e.source] || e.source, e.category, e.currency, e.amount == null ? "未填" : String(e.amount), e.label];
    }));
    var sum = [["幣別", "收入", "支出", "結餘"]];
    ["TWD", "MYR"].forEach(function (c) { var t = d.totals[c]; sum.push([c === "TWD" ? "新台幣" : "馬幣", String(t.income), String(t.expense), String(t.net)]); });
    sum.push([]);
    sum.push(["收入／支出", "類別", "幣別", "金額"]);
    d.categories.forEach(function (x) { sum.push([x.type === "income" ? "收入" : "支出", x.category, x.currency, String(x.amount)]); });
    var name = "收支_" + d.month + ".xlsx";
    U.download(window.nieiaXlsxBook([
      { name: d.month + " 統計", rows: sum, widths: [12, 14, 10, 12] },
      { name: d.month + " 明細", rows: rows, widths: [12, 10, 8, 14, 6, 10, 50] },
    ]), name);
    A.toast("已下載 " + name);
  }

  // ---------- 新增收支 ----------
  function setType(t) {
    type = t;
    document.querySelectorAll("[data-ltype]").forEach(function (b) {
      var on = b.getAttribute("data-ltype") === t;
      b.setAttribute("aria-checked", String(on));
    });
    var dl = $("ldCategories");
    dl.innerHTML = "";
    CATS[t].forEach(function (c) { var o = el("option"); o.value = c; dl.appendChild(o); });
    $("ldCategory").placeholder = t === "income" ? "例如 商品、其他收入" : "例如 場地、材料、交通";
    syncProduct();
  }

  function isProduct() { return type === "income" && $("ldCategory").value.trim() === "商品"; }

  function syncProduct() {
    var on = isProduct();
    $("ldProductField").hidden = !on;
    $("ldQtyField").hidden = !on;
    if (on && !products.length) loadProducts();
    if (on) fillPrice();
  }

  function loadProducts() {
    A.api("/api/admin/products").then(function (r) {
      if (!U.guard(r)) return;
      products = r.items;
      var sel = $("ldProduct");
      sel.innerHTML = "";
      products.forEach(function (p) {
        var o = el("option", null, p.name + (typeof p.stock === "number" ? "（庫存 " + p.stock + "）" : ""));
        o.value = p.id;
        sel.appendChild(o);
      });
      fillPrice();
    });
  }

  // 選商品時，金額自動帶入「單價 × 數量」
  function fillPrice() {
    var p = products.find(function (x) { return x.id === $("ldProduct").value; });
    if (!p) return;
    var price = $("ldCurrency").value === "MYR" ? p.priceMyr : p.priceTwd;
    var qty = Number($("ldQty").value) || 1;
    if (price != null) $("ldAmount").value = price * qty;
  }

  document.querySelectorAll("[data-ltype]").forEach(function (b) {
    b.addEventListener("click", function () { setType(b.getAttribute("data-ltype")); });
  });
  $("ldCategory").addEventListener("input", syncProduct);
  $("ldProduct").addEventListener("change", fillPrice);
  $("ldQty").addEventListener("input", fillPrice);
  $("ldCurrency").addEventListener("change", function () { if (isProduct()) fillPrice(); });

  $("ldForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("ldMsg");
    var body = {
      type: type, date: $("ldDate").value, category: $("ldCategory").value,
      currency: $("ldCurrency").value, amount: $("ldAmount").value, note: $("ldNote").value,
    };
    if (!body.date) { msg.textContent = "請選擇日期。"; return; }
    if (!body.category.trim()) { msg.textContent = "請填寫類別。"; $("ldCategory").focus(); return; }
    if (body.amount === "") { msg.textContent = "請填寫金額。"; $("ldAmount").focus(); return; }
    if (isProduct()) { body.productId = $("ldProduct").value; body.qty = $("ldQty").value; }
    msg.textContent = "";
    $("ldSave").disabled = true;
    A.api("/api/admin/ledger", { method: "POST", body: body }).then(function (r) {
      $("ldSave").disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { msg.textContent = r.message || "新增失敗，請再試一次。"; return; }
      A.toast(isProduct() ? "已新增，庫存已扣除" : "已新增");
      $("ldAmount").value = ""; $("ldNote").value = "";
      if (body.productId) products = [];
      $("ldMonth").value = body.date.slice(0, 7);
      load();
      syncProduct();
      if (window.NieiaOverview) window.NieiaOverview.reload();
    });
  });

  $("ldMonth").value = thisMonth();
  $("ldDate").value = U.today();
  $("ldMonth").addEventListener("change", load);
  $("ldDownload").addEventListener("click", downloadMonth);
  $("tab-ledger").addEventListener("click", load);
  setType("expense");
})();
