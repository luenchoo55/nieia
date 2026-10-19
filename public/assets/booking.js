// 預約頁：選項目 → 選時段 → 填資料 → 送出 → 匯款資訊與回報
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var state = { services: [], slots: [], service: null, slot: null, date: null };

  var STATUS_TEXT = {
    pending_payment: "等待匯款：完成匯款並回報後，阿綸確認收款，預約就正式成立。",
    payment_reported: "已回報匯款，等待阿綸確認收款。",
    confirmed: "預約已成立，期待與你相見。療程前請先追蹤並私訊 IG @nieia4928。",
    cancelled: "這筆預約已經取消。如有疑問，請 IG 私訊 @nieia4928。",
  };
  var DONE_TITLE = { pending_payment: "預約已送出", payment_reported: "已回報匯款", confirmed: "預約已成立", cancelled: "預約已取消" };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(path, options) {
    options = options || {};
    var init = { method: options.method || "GET", headers: {} };
    if (options.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) { d.status = res.status; return d; });
    }, function () { return { ok: false, message: "連不上網站，請確認網路後再試。" }; });
  }
  function prettyDate(date, weekday) {
    var p = date.split("-");
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + weekday + "）";
  }
  function money(amount, currency) {
    if (amount == null) return null;
    return (currency === "MYR" ? "RM " : "NT$") + Number(amount).toLocaleString("en-US");
  }
  function region() {
    var r = document.querySelector('input[name="region"]:checked');
    return r ? r.value : null;
  }
  function priceFor(service, reg) {
    if (!service || service.priceMode !== "fixed") return null;
    var v = reg === "MY" ? service.priceMyr : service.priceTwd;
    return v == null ? null : money(v, reg === "MY" ? "MYR" : "TWD");
  }

  // ---------- 1. 療癒項目 ----------
  function renderServices() {
    var box = $("serviceChoices");
    box.innerHTML = "";
    if (!state.services.length) {
      box.appendChild(el("p", "muted", "目前沒有開放預約的療癒項目，請追蹤 IG @nieia4928 留意最新消息。"));
      return;
    }
    state.services.forEach(function (s) {
      var label = el("label", "choice");
      var input = el("input");
      input.type = "radio"; input.name = "service"; input.value = s.id;
      input.checked = state.service && state.service.id === s.id;
      input.addEventListener("change", function () { state.service = s; renderExtra(); renderSummary(); });
      label.appendChild(input);
      label.appendChild(window.nieiaArt(s.glyph, s.palette));
      var text = el("span", "text");
      text.appendChild(el("strong", null, s.name));
      var meta = [];
      if (s.duration) meta.push(s.duration + " 分鐘");
      meta.push(window.nieiaPrice(s, "service"));
      text.appendChild(el("span", "meta", meta.join("｜")));
      label.appendChild(text);
      box.appendChild(label);
    });
  }

  // ---------- 2. 時段 ----------
  function renderDates() {
    var chips = $("dateChips");
    var grid = $("timeGrid");
    chips.innerHTML = "";
    grid.innerHTML = "";
    if (!state.slots.length) {
      grid.appendChild(el("p", "muted", "目前沒有可預約的時段。阿綸會陸續開放新時段，也可以 IG 私訊 @nieia4928 詢問。"));
      return;
    }
    var dates = [];
    state.slots.forEach(function (s) { if (dates.indexOf(s.date) < 0) dates.push(s.date); });
    if (!state.date || dates.indexOf(state.date) < 0) state.date = dates[0];
    dates.forEach(function (d) {
      var first = state.slots.filter(function (s) { return s.date === d; })[0];
      var p = d.split("-");
      var b = el("button", "date-chip");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(d === state.date));
      b.appendChild(el("span", "d", Number(p[1]) + "/" + Number(p[2])));
      b.appendChild(el("span", "w", "週" + first.weekday));
      b.addEventListener("click", function () { state.date = d; renderDates(); });
      chips.appendChild(b);
    });
    state.slots.filter(function (s) { return s.date === state.date; }).forEach(function (s) {
      var b = el("button", "time", s.start + "–" + s.end);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(!!state.slot && state.slot.id === s.id));
      b.addEventListener("click", function () { state.slot = s; renderDates(); renderSummary(); });
      grid.appendChild(b);
    });
  }

  // ---------- 3. 依項目額外詢問 ----------
  var EXTRA_FIELDS = {
    magnified: [{ key: "practiced", label: "是否曾經習修過擴大療癒？", type: "radio", options: [["yes", "有"], ["no", "沒有"]] }],
    departed: [
      { key: "departedName", label: "亡者全名", type: "text", max: 60, required: true },
      { key: "relation", label: "與你的關係（選填）", type: "text", max: 30 },
    ],
    soulplan: [
      { key: "birthName", label: "出生時的完整姓名（與出生證明相同）", type: "text", max: 80, required: true },
      { key: "birthDate", label: "出生日期", type: "date", required: true },
    ],
    animal: [
      { key: "petName", label: "毛孩的名字", type: "text", max: 40, required: true },
      { key: "species", label: "種類（例如貓、狗、兔子）", type: "text", max: 40, required: true },
      { key: "petAge", label: "年齡（選填）", type: "text", max: 20 },
      { key: "questions", label: "想和毛孩溝通的問題（選填）", type: "textarea", max: 500 },
    ],
  };
  var extraValues = {};

  function renderExtra() {
    var box = $("extraFields");
    var kind = state.service && state.service.extra;
    var fields = EXTRA_FIELDS[kind];
    box.innerHTML = "";
    extraValues = {};
    if (!fields) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("p", "extra-title", state.service.name + "需要的資料"));
    var grid = el("div", "field-grid");
    fields.forEach(function (f, i) {
      var id = "ex-" + f.key;
      if (f.type === "radio") {
        var fs = el("fieldset", "field wide");
        fs.appendChild(el("legend", null, f.label));
        var wrap = el("div", "pills-choice");
        f.options.forEach(function (o) {
          var l = el("label");
          var r = el("input"); r.type = "radio"; r.name = id; r.value = o[0];
          r.addEventListener("change", function () { extraValues[f.key] = o[0]; });
          l.appendChild(r); l.appendChild(el("span", null, o[1]));
          wrap.appendChild(l);
        });
        fs.appendChild(wrap);
        grid.appendChild(fs);
        return;
      }
      var label = el("label", "field" + (f.type === "textarea" ? " wide" : ""));
      label.htmlFor = id;
      label.appendChild(el("span", null, f.label));
      var input = f.type === "textarea" ? el("textarea") : el("input");
      if (f.type === "textarea") input.rows = 3; else input.type = f.type === "date" ? "date" : "text";
      if (f.type === "date") input.max = new Date().toISOString().slice(0, 10);
      input.id = id;
      if (f.max) input.maxLength = f.max;
      if (f.required) input.required = true;
      input.addEventListener("input", function () { extraValues[f.key] = input.value; });
      label.appendChild(input);
      grid.appendChild(label);
    });
    box.appendChild(grid);
  }

  // ---------- 4. 確認 ----------
  function summaryRows(dl, rows) {
    dl.innerHTML = "";
    rows.forEach(function (r) {
      if (!r[1]) return;
      var wrap = el("div");
      wrap.appendChild(el("dt", null, r[0]));
      wrap.appendChild(el("dd", null, r[1]));
      dl.appendChild(wrap);
    });
  }
  function renderSummary() {
    var reg = region();
    summaryRows($("summary"), [
      ["療癒項目", state.service ? state.service.name : "尚未選擇"],
      ["時段", state.slot ? prettyDate(state.slot.date, state.slot.weekday) + " " + state.slot.start + "–" + state.slot.end : "尚未選擇"],
      ["費用", state.service ? (priceFor(state.service, reg) || (state.service.priceMode === "fixed" && !reg ? "選擇居住地後顯示" : "阿綸會另外告知金額")) : ""],
      ["進行方式", "IG 視訊遠距"],
    ]);
  }
  document.querySelectorAll('input[name="region"]').forEach(function (r) { r.addEventListener("change", renderSummary); });

  // ---------- 送出 ----------
  $("bookForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("bookMsg");
    var problems = [];
    if (!state.service) problems.push("請選擇療癒項目");
    if (!state.slot) problems.push("請選擇時段");
    if (!region()) problems.push("請選擇居住地");
    if (!$("fName").value.trim()) problems.push("請填寫姓名");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($("fEmail").value.trim())) problems.push("請填寫正確的 Email");
    if (!/^@?[A-Za-z0-9._]{1,30}$/.test($("fIg").value.trim())) problems.push("請填寫正確的 IG 帳號");
    if (!$("fAge").value) problems.push("請選擇年齡");
    if (!document.querySelector('input[name="gender"]:checked')) problems.push("請選擇性別");
    var reasons = Array.prototype.map.call(document.querySelectorAll('input[name="reasons"]:checked'), function (x) { return x.value; });
    if (!reasons.length && !$("fOther").value.trim()) problems.push("請至少選擇一個接受療癒的原因");
    if (!$("fAgree").checked) problems.push("請勾選同意預約須知");
    if (problems.length) { msg.textContent = problems.join("、") + "。"; return; }

    msg.textContent = "";
    var btn = $("bookBtn");
    btn.disabled = true; btn.textContent = "送出中…";
    api("/api/bookings", {
      method: "POST",
      body: {
        serviceId: state.service.id,
        slotId: state.slot.id,
        region: region(),
        name: $("fName").value,
        email: $("fEmail").value,
        instagram: $("fIg").value,
        age: $("fAge").value,
        gender: document.querySelector('input[name="gender"]:checked').value,
        reasons: reasons,
        otherReason: $("fOther").value,
        note: $("fNote").value,
        extra: extraValues,
        agree: true,
        website: $("fWebsite").value,
      },
    }).then(function (r) {
      btn.disabled = false; btn.textContent = "送出預約";
      if (!r.ok) {
        msg.textContent = r.message || "送出失敗，請再試一次。";
        if (r.status === 409) loadSlots(); // 時段被搶走時，重新整理可選時段
        return;
      }
      var url = "/booking?ref=" + encodeURIComponent(r.booking.ref) + "&t=" + encodeURIComponent(r.token);
      try { history.replaceState(null, "", url); } catch (err) { /* 舊瀏覽器 */ }
      showDone(r.booking, r.token);
    });
  });

  // ---------- 完成畫面 ----------
  var current = { ref: null, token: null };
  function showDone(b, token) {
    current.ref = b.ref; current.token = token;
    $("bookForm").hidden = true;
    $("doneView").hidden = false;
    $("doneTitle").textContent = DONE_TITLE[b.status] || "預約資訊";
    $("doneStatus").textContent = STATUS_TEXT[b.status] || "";
    $("doneRef").textContent = b.ref;
    summaryRows($("doneSummary"), [
      ["療癒項目", b.serviceName],
      ["時段", prettyDate(b.date, b.weekday) + " " + b.start + "–" + b.end],
      ["進行方式", "IG 視訊遠距"],
    ]);

    var showPay = b.status === "pending_payment" || b.status === "payment_reported";
    $("payCard").hidden = !showPay;
    $("reportForm").hidden = b.status !== "pending_payment";
    if (showPay && b.payment) {
      $("payTitle").textContent = b.payment.label;
      $("payAmount").textContent = money(b.amount, b.currency) ? "應付金額 " + money(b.amount, b.currency) : "金額將由阿綸透過 IG 私訊告知";
      var dl = $("payLines");
      dl.innerHTML = "";
      b.payment.lines.forEach(function (line) {
        var wrap = el("div");
        wrap.appendChild(el("dt", null, line[0]));
        var dd = el("dd");
        dd.appendChild(el("span", null, line[1]));
        if (line[0] === "帳號") {
          var copy = el("button", "mini-copy", "複製");
          copy.type = "button";
          copy.addEventListener("click", function () { copyText(line[1], copy); });
          dd.appendChild(copy);
        }
        wrap.appendChild(dd);
        dl.appendChild(wrap);
      });
    }

    var note = $("reportedNote");
    if (b.paymentReport) {
      note.hidden = false;
      note.textContent = "已回報：" + b.paymentReport.paidDate + " 匯款，帳號末五碼 " + b.paymentReport.last5 + "。";
    } else note.hidden = true;

    $("keepUrl").value = location.origin + "/booking?ref=" + encodeURIComponent(b.ref) + "&t=" + encodeURIComponent(token);
    $("rDate").value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyText(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = "已複製"; setTimeout(function () { btn.textContent = t; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { selectFallback(text); });
    } else selectFallback(text);
  }
  function selectFallback(text) {
    var input = $("keepUrl");
    var old = input.value;
    input.value = text; input.select();
    setTimeout(function () { input.value = old; }, 3000);
  }
  $("copyUrl").addEventListener("click", function () { copyText($("keepUrl").value, this); });

  $("reportForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("reportMsg");
    var last5 = $("rLast5").value.trim();
    if (!$("rDate").value) { msg.textContent = "請選擇匯款日期。"; return; }
    if (!/^\d{5}$/.test(last5)) { msg.textContent = "請填寫匯款帳號的末五碼（5 個數字）。"; return; }
    msg.textContent = "";
    var btn = $("reportBtn");
    btn.disabled = true; btn.textContent = "回報中…";
    api("/api/bookings/" + encodeURIComponent(current.ref) + "/payment?t=" + encodeURIComponent(current.token), {
      method: "POST",
      body: { paidDate: $("rDate").value, last5: last5, payerName: $("rName").value },
    }).then(function (r) {
      btn.disabled = false; btn.textContent = "回報匯款";
      if (!r.ok) { msg.textContent = r.message || "回報失敗，請再試一次。"; return; }
      showDone(r.booking, current.token);
    });
  });

  // ---------- 載入 ----------
  function loadSlots() {
    return api("/api/slots").then(function (r) {
      state.slots = r.ok ? r.slots : [];
      if (state.slot && !state.slots.some(function (s) { return s.id === state.slot.id; })) state.slot = null;
      renderDates();
      renderSummary();
    });
  }

  var ref = params.get("ref"), token = params.get("t");
  if (ref && token) {
    $("bookForm").hidden = true;
    api("/api/bookings/" + encodeURIComponent(ref) + "?t=" + encodeURIComponent(token)).then(function (r) {
      if (r.ok) { showDone(r.booking, token); return; }
      $("bookForm").hidden = false;
      $("bookMsg").textContent = r.message || "找不到這筆預約。";
      init();
    });
  } else init();

  function init() {
    api("/api/services").then(function (r) {
      state.services = r.ok ? r.items : [];
      var want = params.get("service");
      state.service = state.services.filter(function (s) { return s.id === want; })[0] || null;
      renderServices();
      renderExtra();
      renderSummary();
    });
    loadSlots();
  }
})();
