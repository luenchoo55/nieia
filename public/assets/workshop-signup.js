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
  // 跨年或不是今年的場次要寫出年份，才不會看起來像日期倒過來
  function dateRange(ss) {
    var a = ss[0].date, b = ss[ss.length - 1].date;
    var year = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 4);
    var withYear = a.slice(0, 4) !== b.slice(0, 4) || a.slice(0, 4) !== year;
    var fmt = function (d) { return (withYear ? Number(d.slice(0, 4)) + " 年 " : "") + prettyDate(d); };
    return a === b ? fmt(a) : fmt(a) + " 至 " + fmt(b);
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

  // ---------- 費用 ----------
  var KINDS = [["new", "新生"], ["retake", "複訓"]];
  var CURS = [["twd", "台灣", "NT$"], ["myr", "馬來西亞", "RM "]];
  function amount(cur, v) { return cur[2] + Number(v).toLocaleString("en-US"); }
  function has(p, k, c) { return p && p[k] && p[k][c] != null; }
  function hasRetake(w) { return CURS.some(function (c) { return has(w.prices, "retake", c[0]); }); }
  // 和「課程」頁一樣的價目表：只列出有填價格的身分與地區
  function priceTable(w) {
    var p = w.prices;
    var kinds = KINDS.filter(function (k) { return CURS.some(function (c) { return has(p, k[0], c[0]); }); });
    var curs = CURS.filter(function (c) { return kinds.some(function (k) { return has(p, k[0], c[0]); }); });
    if (!kinds.length) return el("p", "ws-price", "費用請私訊詢問");
    var t = el("table", "prices");
    var hr = el("tr");
    var th0 = el("th", null, "報名身分"); th0.scope = "col"; hr.appendChild(th0);
    curs.forEach(function (c) { var th = el("th", null, c[1]); th.scope = "col"; hr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    var tb = el("tbody");
    kinds.forEach(function (k) {
      var tr = el("tr");
      tr.appendChild(el("td", null, k[1]));
      curs.forEach(function (c) { tr.appendChild(el("td", null, has(p, k[0], c[0]) ? amount(c, p[k[0]][c[0]]) : "—")); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }
  function priceLine(p) {
    return CURS.filter(function (c) { return p && p[c[0]] != null; }).map(function (c) { return amount(c, p[c[0]]); }).join("／");
  }

  // ---------- 我的報名（記在這台裝置，換裝置就用專屬網址） ----------
  var MINE = "nieia-ws-signups";
  function mineAll() {
    try { return JSON.parse(localStorage.getItem(MINE)) || {}; } catch (e) { return {}; }
  }
  function mineOf(id) { return mineAll()[id] || null; }
  function remember(r) {
    var all = mineAll();
    all[r.workshopId] = { a: r.attendeeId, t: r.token };
    try { localStorage.setItem(MINE, JSON.stringify(all)); } catch (e) { /* 無痕模式 */ }
  }
  function forget(id) {
    var all = mineAll();
    delete all[id];
    try { localStorage.setItem(MINE, JSON.stringify(all)); } catch (e) { /* 無痕模式 */ }
  }
  function mineUrl(r) {
    return location.origin + "/workshops?ws=" + r.workshopId + "&a=" + r.attendeeId + "&t=" + r.token;
  }
  function loadMine(id, m) {
    return fetch("/api/workshops/" + encodeURIComponent(id) + "/signup/" + encodeURIComponent(m.a) + "?t=" + encodeURIComponent(m.t))
      .then(function (res) { return res.json().then(function (d) { d.status404 = res.status === 404; return d; }); })
      .catch(function () { return { ok: false, message: "連不上網站，請確認網路後再試。" }; });
  }
  // 打開「我的報名」：先開彈窗，再讀資料
  function openMine(w, m, from) {
    var s = openSheet(w, "我的報名", from);
    s.body.appendChild(el("p", "muted", "讀取中…"));
    loadMine(w.id, m).then(function (r) {
      if (r.ok) { done(s.body, w, r, true); return; }
      if (r.status404) forget(w.id);
      s.body.innerHTML = "";
      s.body.appendChild(el("p", "form-msg", r.message || "讀取失敗，請再試一次。"));
    });
  }

  // ---------- 列表 ----------
  function card(w) {
    var c = el("article", "ws-card glass");
    var top = el("div", "ws-top");
    top.appendChild(el("span", "ws-state is-" + w.state, STATE[w.state]));
    top.appendChild(el("span", "ws-when", dateRange(w.sessions) + (timeText(w.sessions) ? " " + timeText(w.sessions) : "")));
    c.appendChild(top);
    // 標題本身是打開課程介紹的按鈕，鍵盤也能操作；費用只放在課程介紹彈窗裡
    var h = el("h3");
    var more = el("button", "ws-title", w.title);
    more.type = "button";
    more.setAttribute("aria-haspopup", "dialog");
    more.addEventListener("click", function () { openIntro(w, more); });
    h.appendChild(more);
    c.appendChild(h);
    if (w.titleEn) c.appendChild(el("span", "en", w.titleEn));
    if (w.location) c.appendChild(el("p", "ws-where", "地點：" + w.location));
    // 最後一排：左邊堂數／時數／老師，右邊報名按鈕
    var row = el("div", "ws-bottom");
    var f = el("div", "facts");
    facts(w).forEach(function (t) { f.appendChild(el("span", null, t)); });
    row.appendChild(f);
    row.appendChild(signupButton(w));
    c.appendChild(row);
    // 點卡片任何地方都打開課程介紹（報名按鈕自己處理）
    c.classList.add("is-clickable");
    c.addEventListener("click", function (e) {
      if (e.target.closest("button, a")) return;
      if (window.getSelection && String(window.getSelection())) return; // 正在選取文字時不打開
      openIntro(w, more);
    });
    return c;
  }
  function signupButton(w, from) {
    var m = mineOf(w.id);
    if (m) {
      var mine = el("button", "btn btn-primary", "查看我的報名");
      mine.type = "button";
      mine.setAttribute("aria-haspopup", "dialog");
      mine.addEventListener("click", function () { openMine(w, m, from || mine); });
      return mine;
    }
    var btn = el("button", "btn " + (w.state === "open" ? "btn-primary" : "btn-ghost"), w.state === "open" ? "我要報名" : STATE[w.state]);
    btn.type = "button";
    btn.disabled = w.state !== "open";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", function () { openSignup(w, from || btn); });
    return btn;
  }

  var items = [];
  function refreshCards() {
    host.innerHTML = "";
    items.forEach(function (w) { host.appendChild(card(w)); });
  }
  // 專屬網址：/workshops?ws=場次&a=學員&t=代碼，換裝置也能打開
  function openFromUrl() {
    var q = new URLSearchParams(location.search);
    var id = q.get("ws"), m = { a: q.get("a"), t: q.get("t") };
    if (!id || !m.a || !m.t) return;
    var w = items.filter(function (x) { return x.id === id; })[0];
    if (w) { remember({ workshopId: id, attendeeId: m.a, token: m.t }); refreshCards(); openMine(w, m); return; }
    // 已經不在列表上的場次（例如已結束）：用報名資料裡的名稱與日期
    loadMine(id, m).then(function (r) {
      if (!r.ok) return;
      var s = openSheet({ id: id, title: r.title, sessions: r.sessions }, "我的報名");
      done(s.body, null, r, true);
    });
  }

  fetch("/api/workshops").then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok || !data.items || !data.items.length) { openFromUrl(); return; }
    host.innerHTML = "";
    items = data.items;
    refreshCards();
    box.hidden = false;
    openFromUrl();
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

  // 彈窗外框：標題列＋可捲動的內容區，課程介紹和報名共用
  function openSheet(w, kicker, from) {
    if (from) lastFocus = from;
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
    t.appendChild(el("span", "meta", kicker));
    var h = el("h2", null, w.title); h.id = "wsfTitle";
    t.appendChild(h);
    if (w.titleEn) t.appendChild(el("span", "en", w.titleEn));
    t.appendChild(el("span", "meta", dateRange(w.sessions)));
    head.appendChild(t);
    c.appendChild(head);

    var body = el("div", "detail-body");
    c.appendChild(body);
    sheet.appendChild(c);
    sheet.hidden = false;
    body.scrollTop = 0;
    document.documentElement.classList.add("no-scroll");
    document.addEventListener("keydown", onKey);
    return { card: c, body: body, x: x };
  }

  // ---------- 課程介紹彈窗 ----------
  function openIntro(w, from) {
    var s = openSheet(w, "課程介紹", from);
    var rich = window.nieiaRichText;
    if (w.intro) s.body.appendChild(rich ? rich(w.intro) : el("p", "ws-intro", w.intro));
    // 每一堂的日期與時間，一律寫出年份
    var when = el("section", "ws-fee ws-sessions");
    when.appendChild(el("h3", null, "上課日期"));
    var ol = el("ol");
    w.sessions.forEach(function (x, i) {
      var li = el("li");
      if (w.sessions.length > 1) li.appendChild(el("span", "ws-no", "第 " + (i + 1) + " 堂"));
      li.appendChild(el("span", "ws-day", Number(x.date.slice(0, 4)) + " 年 " + prettyDate(x.date)));
      if (x.start) li.appendChild(el("span", "ws-time", x.start + (x.end ? "–" + x.end : "")));
      ol.appendChild(li);
    });
    when.appendChild(ol);
    s.body.appendChild(when);
    var fee = el("section", "ws-fee");
    fee.appendChild(el("h3", null, "費用"));
    fee.appendChild(priceTable(w));
    s.body.appendChild(fee);
    var foot = el("footer", "detail-foot");
    var info = el("p", "detail-ask", facts(w).join("｜") + (w.location ? "｜" + w.location : ""));
    foot.appendChild(info);
    var acts = el("div", "actions");
    acts.appendChild(signupButton(w, from));
    var later = el("button", "btn btn-ghost", "再看看");
    later.type = "button";
    later.addEventListener("click", close);
    acts.appendChild(later);
    foot.appendChild(acts);
    s.card.appendChild(foot);
    s.x.focus({ preventScroll: true });
  }

  function openSignup(w, from) {
    var s = openSheet(w, "報名工作坊", from);
    var body = s.body;
    var form = el("form", "ws-form");
    form.noValidate = true;
    var grid = el("div", "field-grid");
    grid.appendChild(input("wsfName", "姓名", { maxlength: "30", autocomplete: "name", required: "" }));
    grid.appendChild(input("wsfNameEn", "英文姓名（印在結業證書上，選填）", { maxlength: "60", autocomplete: "off" }));
    grid.appendChild(input("wsfEmail", "Email", { type: "email", maxlength: "120", autocomplete: "email", inputmode: "email", required: "" }));
    grid.appendChild(input("wsfIg", "IG 帳號（選填）", { maxlength: "31", autocomplete: "off", autocapitalize: "off", placeholder: "例如 nieia4928" }));
    // 有複訓價格才讓客人選身分，旁邊直接顯示對應的費用
    // 居住地：決定匯款方式與應付的幣別
    var region = "";
    var rs = el("fieldset", "field wide");
    rs.appendChild(el("legend", null, "居住地（送出後會顯示對應的匯款方式）"));
    var rwrap = el("div", "pills-choice");
    [["TW", "台灣"], ["MY", "馬來西亞"]].forEach(function (o) {
      var l = el("label");
      var r = el("input"); r.type = "radio"; r.name = "wsfRegion"; r.value = o[0];
      r.addEventListener("change", function () { region = o[0]; });
      l.appendChild(r); l.appendChild(el("span", null, o[1]));
      rwrap.appendChild(l);
    });
    rs.appendChild(rwrap);
    grid.appendChild(rs);

    var status = "new";
    if (hasRetake(w)) {
      var fs = el("fieldset", "field wide");
      fs.appendChild(el("legend", null, "報名身分"));
      var wrap = el("div", "pills-choice");
      KINDS.forEach(function (k) {
        var l = el("label");
        var r = el("input"); r.type = "radio"; r.name = "wsfStatus"; r.value = k[0]; r.checked = k[0] === "new";
        r.addEventListener("change", function () { status = k[0]; });
        l.appendChild(r);
        var fee = priceLine(w.prices[k[0]]);
        l.appendChild(el("span", null, k[1] + (fee ? "　" + fee : "")));
        wrap.appendChild(l);
      });
      fs.appendChild(wrap);
      grid.appendChild(fs);
    }
    grid.appendChild(input("wsfNote", "想說的話（選填）", { rows: "3", maxlength: "300", placeholder: "例如：是否需要準備什麼、想先了解的事" }, "wide"));
    form.appendChild(grid);
    var hp = el("label", "hp", "請勿填寫");
    hp.setAttribute("aria-hidden", "true");
    var hpIn = el("input"); hpIn.id = "wsfWebsite"; hpIn.tabIndex = -1; hpIn.autocomplete = "off";
    hp.appendChild(hpIn);
    form.appendChild(hp);
    form.appendChild(el("p", "muted", "送出後會顯示應付金額與匯款方式。課程需提前訂購教材，請於課前兩週完成匯款。"));
    var msg = el("p", "form-msg");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);
    var send = el("button", "btn btn-primary btn-block", "送出報名");
    send.type = "submit";
    form.appendChild(send);
    body.appendChild(form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = function (id) { return document.getElementById(id).value.trim(); };
      var payload = {
        name: v("wsfName"), nameEn: v("wsfNameEn"), email: v("wsfEmail"),
        instagram: v("wsfIg"), note: v("wsfNote"), website: v("wsfWebsite"), status: status, region: region,
      };
      if (!payload.name) { msg.textContent = "請填寫姓名。"; document.getElementById("wsfName").focus(); return; }
      if (!region) { msg.textContent = "請選擇居住地。"; rwrap.querySelector("input").focus(); return; }
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
        remember(r);
        done(body, w, r);
        refreshCards();
      });
    });

    document.getElementById("wsfName").focus({ preventScroll: true });
  }

  // again：之後再打開（「查看我的報名」或專屬網址），不是剛送出
  function done(body, w, r, again) {
    body.innerHTML = "";
    var d = el("div", "c-done");
    d.setAttribute("aria-live", "polite");
    var check = el("div", "c-check");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    d.appendChild(check);
    d.appendChild(el("h3", null, again ? r.name + "，這是你的報名" : r.name + "，報名已送出"));
    d.appendChild(el("p", "muted", "請在課前兩週完成匯款，匯款後 IG 私訊 @nieia4928 告訴阿綸，方便核對。"));
    body.appendChild(d);

    // 應付金額與匯款方式（只在報名成功後顯示）
    if (r.payment) {
      var pay = el("section", "pay ws-pay");
      pay.appendChild(el("h2", null, r.payment.label));
      var cur = r.payment.currency === "MYR" ? CURS[1] : CURS[0];
      pay.appendChild(el("p", "amount", r.amount != null
        ? "應付金額 " + amount(cur, r.amount) + "（" + (r.status === "retake" ? "複訓" : "新生") + "）"
        : "金額將由阿綸告訴你"));
      pay.appendChild(window.nieiaPayment ? window.nieiaPayment(r.payment) : el("p", "muted", "匯款方式會由阿綸私訊告訴你。"));
      body.appendChild(pay);
    }

    // 專屬網址：換手機或清掉瀏覽器資料也能再打開
    var keep = el("section", "ws-keep");
    keep.appendChild(el("h3", null, "保存這個網址"));
    keep.appendChild(el("p", "muted", "之後可以用這個網址再查看應付金額與匯款方式。在這台裝置回到工作坊頁，按「查看我的報名」也可以。"));
    var row = el("div", "copy-row");
    var url = el("input");
    url.readOnly = true; url.value = mineUrl(r); url.setAttribute("aria-label", "我的報名專屬網址");
    url.addEventListener("focus", function () { url.select(); });
    var cp = el("button", "btn btn-ghost", "複製");
    cp.type = "button";
    cp.addEventListener("click", function () {
      var ok2 = function () { cp.textContent = "已複製"; setTimeout(function () { cp.textContent = "複製"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url.value).then(ok2, function () { url.select(); });
      else url.select();
    });
    row.appendChild(url);
    row.appendChild(cp);
    keep.appendChild(row);
    body.appendChild(keep);

    var ok = el("button", "btn btn-ghost", "好的");
    ok.type = "button";
    ok.addEventListener("click", close);
    var end = el("div", "actions ws-done-acts");
    end.appendChild(ok);
    body.appendChild(end);
    body.scrollTop = 0;
    ok.focus({ preventScroll: true });
  }
})();
