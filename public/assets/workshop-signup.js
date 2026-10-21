// 工作坊頁：列出還沒結束的場次，客人點進去就能報名
(function () {
  "use strict";
  var box = document.getElementById("wsLive");
  var host = document.getElementById("wsLiveList");
  if (!box || !host) return;

  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  var FORMAT = { onsite: "實體課", online: "線上課" };
  var STATE = { open: "報名中", full: "已額滿", started: "上課中" };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function prettyDate(date) {
    var p = date.split("-");
    var w = WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()];
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + w + "）";
  }
  function dateRange(ss) {
    var a = ss[0].date, b = ss[ss.length - 1].date;
    return a === b ? prettyDate(a) : prettyDate(a) + " 至 " + prettyDate(b);
  }
  function timeText(ss) {
    var s = ss[0];
    if (!s.start) return "";
    var same = ss.every(function (x) { return x.start === s.start && x.end === s.end; });
    return same ? s.start + (s.end ? "–" + s.end : "") : "";
  }
  function hoursText(h) { return (Number.isInteger(h) ? h : h.toFixed(1)) + " 小時"; }
  function facts(w) {
    var out = [w.sessions.length > 1 ? w.sessions.length + " 堂" : "1 堂", hoursText(w.hours), FORMAT[w.format]];
    if (w.teachers.length) out.push("老師：" + w.teachers.join("、"));
    return out;
  }

  // ---------- 列表 ----------
  function card(w) {
    var c = el("article", "ws-card glass");
    var top = el("div", "ws-top");
    top.appendChild(el("span", "ws-state is-" + w.state, STATE[w.state]));
    top.appendChild(el("span", "ws-when", dateRange(w.sessions) + (timeText(w.sessions) ? " " + timeText(w.sessions) : "")));
    c.appendChild(top);
    c.appendChild(el("h3", null, w.title));
    if (w.titleEn) c.appendChild(el("span", "en", w.titleEn));
    if (w.intro) c.appendChild(el("p", "ws-intro", w.intro));
    var f = el("div", "facts");
    facts(w).forEach(function (t) { f.appendChild(el("span", null, t)); });
    c.appendChild(f);
    if (w.location) c.appendChild(el("p", "ws-where", "地點：" + w.location));
    var foot = el("div", "ws-foot");
    foot.appendChild(el("strong", "ws-price", w.price || "費用請私訊詢問"));
    var btn = el("button", "btn " + (w.state === "open" ? "btn-primary" : "btn-ghost"), w.state === "open" ? "我要報名" : STATE[w.state]);
    btn.type = "button";
    btn.disabled = w.state !== "open";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", function () { openSignup(w, btn); });
    foot.appendChild(btn);
    c.appendChild(foot);
    return c;
  }

  fetch("/api/workshops").then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok || !data.items || !data.items.length) return;
    host.innerHTML = "";
    data.items.forEach(function (w) { host.appendChild(card(w)); });
    box.hidden = false;
  }).catch(function () { /* 讀取失敗就不顯示 */ });

  // ---------- 報名彈窗 ----------
  var sheet = null, lastFocus = null;
  function close() {
    if (!sheet) return;
    sheet.hidden = true;
    document.documentElement.classList.remove("no-scroll");
    document.removeEventListener("keydown", onKey);
    if (lastFocus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  function input(id, label, attrs, cls) {
    var f = el("label", "field" + (cls ? " " + cls : ""));
    f.htmlFor = id;
    f.appendChild(el("span", null, label));
    var i = el(attrs.rows ? "textarea" : "input");
    i.id = id;
    Object.keys(attrs).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    f.appendChild(i);
    return f;
  }

  function openSignup(w, from) {
    lastFocus = from;
    if (!sheet) {
      sheet = el("div", "sheet-backdrop detail-backdrop");
      sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = "";
    var c = el("section", "sheet glass detail-sheet");
    c.setAttribute("role", "dialog");
    c.setAttribute("aria-modal", "true");
    c.setAttribute("aria-labelledby", "wsfTitle");
    var x = el("button", "detail-x");
    x.type = "button"; x.setAttribute("aria-label", "關閉");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", close);
    c.appendChild(x);

    var head = el("header", "detail-head ws-sheet-head");
    var t = el("div", "detail-title");
    t.appendChild(el("span", "meta", "報名工作坊"));
    var h = el("h2", null, w.title); h.id = "wsfTitle";
    t.appendChild(h);
    t.appendChild(el("span", "meta", dateRange(w.sessions) + "｜" + (w.price || "費用請私訊詢問")));
    head.appendChild(t);
    c.appendChild(head);

    var body = el("div", "detail-body");
    var form = el("form", "ws-form");
    form.noValidate = true;
    var grid = el("div", "field-grid");
    grid.appendChild(input("wsfName", "姓名", { maxlength: "30", autocomplete: "name", required: "" }));
    grid.appendChild(input("wsfNameEn", "英文姓名（印在結業證書上，選填）", { maxlength: "60", autocomplete: "off" }));
    grid.appendChild(input("wsfEmail", "Email", { type: "email", maxlength: "120", autocomplete: "email", inputmode: "email", required: "" }));
    grid.appendChild(input("wsfIg", "IG 帳號（選填）", { maxlength: "31", autocomplete: "off", autocapitalize: "off", placeholder: "例如 nieia4928" }));
    grid.appendChild(input("wsfNote", "想說的話（選填）", { rows: "3", maxlength: "300", placeholder: "例如：想問複訓價格、是否需要準備什麼" }, "wide"));
    form.appendChild(grid);
    var hp = el("label", "hp", "請勿填寫");
    hp.setAttribute("aria-hidden", "true");
    var hpIn = el("input"); hpIn.id = "wsfWebsite"; hpIn.tabIndex = -1; hpIn.autocomplete = "off";
    hp.appendChild(hpIn);
    form.appendChild(hp);
    form.appendChild(el("p", "muted", "送出後阿綸會用 Email 或 IG 和你聯絡，確認名額與匯款方式。課程需提前訂購教材，請於課前兩週完成匯款。"));
    var msg = el("p", "form-msg");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);
    var send = el("button", "btn btn-primary btn-block", "送出報名");
    send.type = "submit";
    form.appendChild(send);
    body.appendChild(form);
    c.appendChild(body);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = function (id) { return document.getElementById(id).value.trim(); };
      var payload = {
        name: v("wsfName"), nameEn: v("wsfNameEn"), email: v("wsfEmail"),
        instagram: v("wsfIg"), note: v("wsfNote"), website: v("wsfWebsite"),
      };
      if (!payload.name) { msg.textContent = "請填寫姓名。"; document.getElementById("wsfName").focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { msg.textContent = "請填寫正確的 Email。"; document.getElementById("wsfEmail").focus(); return; }
      msg.textContent = "";
      send.disabled = true;
      send.textContent = "送出中…";
      fetch("/api/workshops/" + encodeURIComponent(w.id) + "/signup", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload),
      }).then(function (r) { return r.json().catch(function () { return {}; }); }, function () {
        return { ok: false, message: "連不上網站，請確認網路後再試。" };
      }).then(function (r) {
        send.disabled = false;
        send.textContent = "送出報名";
        if (!r.ok) { msg.textContent = r.message || "報名失敗，請再試一次，或 IG 私訊 @nieia4928。"; return; }
        done(body, payload.name);
      });
    });

    sheet.appendChild(c);
    sheet.hidden = false;
    document.documentElement.classList.add("no-scroll");
    document.addEventListener("keydown", onKey);
    document.getElementById("wsfName").focus({ preventScroll: true });
  }

  function done(body, name) {
    body.innerHTML = "";
    var d = el("div", "c-done");
    d.setAttribute("aria-live", "polite");
    var check = el("div", "c-check");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    d.appendChild(check);
    d.appendChild(el("h3", null, name + "，報名已送出"));
    d.appendChild(el("p", "muted", "阿綸會在 1 至 2 天內用 Email 或 IG 和你聯絡。等不到回覆的話，可以直接 IG 私訊 @nieia4928。"));
    var ok = el("button", "btn btn-ghost", "好的");
    ok.type = "button";
    ok.addEventListener("click", close);
    d.appendChild(ok);
    body.appendChild(d);
    ok.focus();
  }
})();
