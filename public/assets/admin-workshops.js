// 後台：工作坊（場次、學員名單、點名、簽到、課前通知、抽籤、大合照、結業證書、證書登記）
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;

  var $ = function (id) { return document.getElementById(id); };
  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  var TYPE = { spirit: "身心靈", craft: "手工", other: "其他" };
  var FORMAT = { onsite: "實體", online: "線上" };
  var list = [];
  var current = null; // 目前打開的工作坊（含學員）
  var loaded = false;

  // ---------- 小工具 ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el("button", cls || null, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function weekdayOf(date) { return WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()]; }
  function prettyDate(date) {
    var p = date.split("-");
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + weekdayOf(date) + "）";
  }
  function shortDate(date) { var p = date.split("-"); return Number(p[1]) + "/" + Number(p[2]); }
  function todayLocal() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function addDays(date, n) {
    var d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function sessionText(s) {
    return prettyDate(s.date) + (s.start ? " " + s.start + (s.end ? "–" + s.end : "") : "");
  }
  function dateRange(sessions) {
    if (!sessions || !sessions.length) return "";
    var a = sessions[0].date, b = sessions[sessions.length - 1].date;
    return a === b ? prettyDate(a) : prettyDate(a) + " 至 " + prettyDate(b);
  }
  function hoursText(h) { return (Number.isInteger(h) ? h : h.toFixed(1)) + " 小時"; }
  function money(p) {
    var parts = [];
    if (p && p.twd != null) parts.push("NT$" + Number(p.twd).toLocaleString("en-US"));
    if (p && p.myr != null) parts.push("RM " + Number(p.myr).toLocaleString("en-US"));
    return parts.join("／");
  }
  function priceText(ps) {
    if (!ps) return "";
    return [["new", "新生"], ["retake", "複訓"]].map(function (k) { var m = money(ps[k[0]]); return m ? k[1] + " " + m : ""; }).filter(Boolean).join("\n");
  }
  function teacherText(ts) { return (ts || []).map(function (t) { return t.name; }).join("、"); }
  function origin() { return location.origin; }
  function checkinUrl(s) { return origin() + "/checkin?k=" + s.key; }
  function certUrl(code) { return origin() + "/cert?c=" + code; }
  function gmail(params) {
    var q = ["view=cm", "fs=1"];
    Object.keys(params).forEach(function (k) { if (params[k]) q.push(k + "=" + encodeURIComponent(params[k])); });
    return "https://mail.google.com/mail/?" + q.join("&");
  }
  function copy(text, btn, label) {
    var done = function () { btn.textContent = "已複製"; setTimeout(function () { btn.textContent = label; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { A.toast("無法複製，請手動選取"); });
    else A.toast("無法複製，請手動選取");
  }
  function guard(r) {
    if (r.status === 401) { A.checkSession(); return false; }
    if (!r.ok) { A.toast(r.message || "操作失敗，請再試一次"); return false; }
    return true;
  }
  function armed(btn, label, confirmText, action) {
    var timer = null;
    btn.addEventListener("click", function () {
      if (!timer) {
        btn.classList.add("confirm");
        btn.textContent = confirmText;
        timer = setTimeout(function () { timer = null; btn.classList.remove("confirm"); btn.textContent = label; }, 4500);
        return;
      }
      clearTimeout(timer); timer = null;
      btn.classList.remove("confirm"); btn.textContent = label;
      action();
    });
  }
  function fullAttendance(w, a) {
    return w.sessions.every(function (s) { return a.attended && a.attended[s.key]; });
  }

  // ================= 所有工作坊 =================
  function notHeld(w, count) {
    return count === 0 && w.sessions[w.sessions.length - 1].date < todayLocal();
  }
  // 重新發佈：日期整體往後挪到一週後開始（保留每堂之間的間隔），並重新開放前台報名
  function republishDraft(w) {
    var copy = JSON.parse(JSON.stringify(w));
    var from = new Date(w.sessions[0].date + "T00:00:00Z");
    var to = new Date(addDays(todayLocal(), 7) + "T00:00:00Z");
    var shift = Math.round((to - from) / 86400000);
    copy.sessions.forEach(function (s) { s.date = addDays(s.date, shift); });
    copy.signupOpen = true;
    return copy;
  }

  function loadList() {
    if (!list.length) { $("wsList").innerHTML = ""; $("wsList").appendChild(el("p", "empty glass", "載入中…")); }
    A.api("/api/admin/workshops").then(function (r) {
      if (!guard(r)) return;
      loaded = true;
      list = r.items;
      renderList();
    });
  }

  function renderList() {
    var host = $("wsList");
    host.innerHTML = "";
    if (!list.length) {
      host.appendChild(el("p", "empty glass", "還沒有任何工作坊。按「新增工作坊」建立第一場。"));
      return;
    }
    var today = todayLocal();
    // 結束時名單是空的：課程沒有開成，詢問要不要重新發佈
    list.filter(function (w) { return notHeld(w, w.attendeeCount); }).forEach(function (w) {
      var ask = el("div", "ws-ask glass");
      ask.setAttribute("role", "status");
      ask.appendChild(el("p", null, "「" + w.title + "」（" + shortDate(w.sessions[0].date) + "）結束時沒有學員，課程可能沒有開成。要改日期重新發佈嗎？"));
      ask.appendChild(button("重新發佈", "btn btn-primary btn-small", function () { openWorkshop(w.id, true); }));
      host.appendChild(ask);
    });
    list.forEach(function (w) {
      var last = w.sessions[w.sessions.length - 1].date;
      var row = el("button", "ws-row glass");
      row.type = "button";
      var when = el("div", "ws-when");
      when.appendChild(el("span", "ws-d", shortDate(w.sessions[0].date)));
      when.appendChild(el("span", "ws-w", w.sessions.length > 1 ? "共 " + w.sessions.length + " 堂" : "週" + weekdayOf(w.sessions[0].date)));
      var text = el("div", "text");
      text.appendChild(el("h3", null, w.title));
      text.appendChild(el("p", "meta", [TYPE[w.type], FORMAT[w.format], hoursText(w.hours), "學員 " + w.attendeeCount + " 位", w.certCount ? "已發證書 " + w.certCount + " 張" : ""].filter(Boolean).join("・")));
      var state = notHeld(w, w.attendeeCount) ? ["沒有開成", "warn"] : last < today ? ["已結束", "closed"] : w.sessions[0].date <= today ? ["進行中", "booked"] : ["即將開始", "open"];
      row.appendChild(when);
      row.appendChild(text);
      row.appendChild(el("span", "pill " + state[1], state[0]));
      row.addEventListener("click", function () { openWorkshop(w.id); });
      host.appendChild(row);
    });
  }

  // ---------- 新增／編輯表單 ----------
  function blankWorkshop() {
    var d = addDays(todayLocal(), 7);
    return {
      title: "", titleEn: "", type: "spirit", format: "onsite", location: "", roomUrl: "", hours: 16,
      sessions: [{ date: d, start: "10:00", end: "18:00" }, { date: addDays(d, 1), start: "10:00", end: "18:00" }],
      teachers: [{ name: "阿綸", nameEn: "" }],
      signupOpen: true, intro: "", prices: null, capacity: 0,
    };
  }

  function input(id, value, attrs) {
    var i = el("input");
    i.id = id;
    i.value = value == null ? "" : value;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function field(label, control, cls) {
    var f = el("label", "field" + (cls ? " " + cls : ""));
    f.htmlFor = control.id;
    f.appendChild(el("span", null, label));
    f.appendChild(control);
    return f;
  }
  function select(id, options, value) {
    var s = el("select");
    s.id = id;
    Object.keys(options).forEach(function (k) {
      var o = el("option", null, options[k]);
      o.value = k;
      if (k === value) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }

  // draft：重新發佈時預先改好日期的資料
  function openEditor(w, host, draft) {
    closeEditors();
    var isNew = !w;
    var data = JSON.parse(JSON.stringify(draft || w || blankWorkshop()));
    var copying = isNew && draft; // 再開一場：用舊場次的設定新增一場
    var heading = copying ? "再開一場" : isNew ? "新增工作坊" : draft ? "重新發佈工作坊" : "編輯工作坊資料";
    var card = el("section", "glass form-card editor ws-editor");
    card.setAttribute("aria-label", heading);
    card.appendChild(el("h2", null, heading));
    if (copying) card.appendChild(el("p", "hint", "已經複製「" + draft.title + "」的所有設定，日期往後挪到一週後開始。學員、點名、照片和證書不會帶過來，原本那一場也不會改變。確認新的上課日期後按「建立新的一場」。"));
    else if (draft) card.appendChild(el("p", "hint", "日期已經往後挪到一週後開始，也重新開放前台報名。確認新的上課日期後按「重新發佈」，這場就會再出現在網站的工作坊頁。"));
    var form = el("form");
    form.noValidate = true;

    var grid = el("div", "field-grid");
    var fTitle = input("wfTitle", data.title, { maxlength: 40, placeholder: "例如 臼井聖火靈氣 I & II 階", required: "" });
    var fTitleEn = input("wfTitleEn", data.titleEn, { maxlength: 80, placeholder: "例如 Usui / Holy Fire Reiki I & II" });
    var fType = select("wfType", TYPE, data.type);
    var fFormat = select("wfFormat", { onsite: "實體", online: "線上" }, data.format);
    var fHours = input("wfHours", data.hours, { type: "number", inputmode: "decimal", min: "0.5", max: "200", step: "0.5" });
    var fLocation = input("wfLocation", data.location, { maxlength: 120, placeholder: "例如 台北市大安區（會寫在課前通知信裡）" });
    var fRoom = input("wfRoom", data.roomUrl, { maxlength: 300, placeholder: "https://…（視訊平台的教室連結）", inputmode: "url" });

    grid.appendChild(field("工作坊名稱（印在證書上）", fTitle, "wide"));
    grid.appendChild(field("英文名稱（印在證書上，選填）", fTitleEn, "wide"));
    grid.appendChild(field("類型", fType));
    grid.appendChild(field("上課形式", fFormat));
    grid.appendChild(field("總時數（印在證書上）", fHours));
    var locField = field("上課地點", fLocation, "wide");
    var roomField = field("線上教室連結（平台確定後再填也可以）", fRoom, "wide");
    grid.appendChild(locField);
    grid.appendChild(roomField);
    form.appendChild(grid);

    function syncKinds() {
      var online = fFormat.value === "online";
      locField.hidden = online;
      roomField.hidden = !online;
    }
    fFormat.addEventListener("change", syncKinds);
    syncKinds();

    // 堂數
    var sesBox = el("fieldset", "field wide ws-sub");
    sesBox.appendChild(el("legend", null, "上課日期（一天一堂；線上課分幾個晚上上，就新增幾堂）"));
    var sesList = el("div", "sub-list");
    sesBox.appendChild(sesList);
    function sessionRow(s, i) {
      var r = el("div", "sub-row");
      var d = input("wfS" + i + "d", s.date, { type: "date", required: "" });
      var st = input("wfS" + i + "s", s.start, { type: "time", step: "900" });
      var en = input("wfS" + i + "e", s.end, { type: "time", step: "900" });
      r.appendChild(field("第 " + (i + 1) + " 堂日期", d));
      r.appendChild(field("開始", st));
      r.appendChild(field("結束", en));
      [d, st, en].forEach(function (x, j) {
        x.addEventListener("change", function () { data.sessions[i][["date", "start", "end"][j]] = x.value; });
      });
      var rm = button("移除", "sub-rm", function () { data.sessions.splice(i, 1); drawSessions(); });
      rm.disabled = data.sessions.length === 1;
      rm.setAttribute("aria-label", "移除第 " + (i + 1) + " 堂");
      r.appendChild(rm);
      return r;
    }
    function drawSessions() {
      sesList.innerHTML = "";
      data.sessions.forEach(function (s, i) { sesList.appendChild(sessionRow(s, i)); });
    }
    drawSessions();
    sesBox.appendChild(button("新增一堂", "btn btn-ghost btn-small", function () {
      var last = data.sessions[data.sessions.length - 1];
      data.sessions.push({ date: last ? addDays(last.date, 1) : todayLocal(), start: last ? last.start : "10:00", end: last ? last.end : "18:00" });
      drawSessions();
    }));
    form.appendChild(sesBox);

    // 老師
    var tBox = el("fieldset", "field wide ws-sub");
    tBox.appendChild(el("legend", null, "授課老師（雙教師就新增一位，證書上會並排署名）"));
    var tList = el("div", "sub-list");
    tBox.appendChild(tList);
    function drawTeachers() {
      tList.innerHTML = "";
      data.teachers.forEach(function (t, i) {
        var r = el("div", "sub-row teacher-row");
        var n = input("wfT" + i + "n", t.name, { maxlength: 30, placeholder: "例如 阿綸" });
        var e = input("wfT" + i + "e", t.nameEn, { maxlength: 60, placeholder: "英文名字（選填）" });
        n.addEventListener("input", function () { t.name = n.value; });
        e.addEventListener("input", function () { t.nameEn = e.value; });
        r.appendChild(field("老師姓名", n));
        r.appendChild(field("英文名字", e));
        var rm = button("移除", "sub-rm", function () { data.teachers.splice(i, 1); drawTeachers(); });
        rm.disabled = data.teachers.length === 1;
        rm.setAttribute("aria-label", "移除老師 " + (t.name || i + 1));
        r.appendChild(rm);
        tList.appendChild(r);
      });
    }
    drawTeachers();
    var addT = button("新增老師", "btn btn-ghost btn-small", function () {
      if (data.teachers.length >= 4) return;
      data.teachers.push({ name: "", nameEn: "" });
      drawTeachers();
    });
    tBox.appendChild(addT);
    form.appendChild(tBox);

    // 前台報名
    var pBox = el("fieldset", "field wide ws-sub");
    pBox.appendChild(el("legend", null, "前台報名（課程結束前會列在網站的工作坊頁，客人可以直接報名）"));
    var pGrid = el("div", "field-grid");
    var fOpen = el("input");
    fOpen.type = "checkbox"; fOpen.id = "wfOpen"; fOpen.checked = data.signupOpen !== false;
    var openField = el("label", "field check");
    openField.htmlFor = "wfOpen";
    openField.appendChild(fOpen);
    openField.appendChild(el("span", null, "顯示在前台並開放報名"));
    // 費用：新生／複訓 × 台灣／馬來西亞，留空就不顯示
    var prices = data.prices || {};
    var priceInputs = {};
    var priceGrid = el("div", "field-grid ws-prices");
    [["new", "新生"], ["retake", "複訓"]].forEach(function (who) {
      priceInputs[who[0]] = {};
      [["twd", "台灣 NT$"], ["myr", "馬來西亞 RM"]].forEach(function (cur) {
        var v = prices[who[0]] && prices[who[0]][cur[0]];
        var i = input("wfP" + who[0] + cur[0], v == null ? "" : v, { type: "number", inputmode: "numeric", min: "0", step: "1", placeholder: "不顯示就留空" });
        priceInputs[who[0]][cur[0]] = i;
        priceGrid.appendChild(field(who[1] + "・" + cur[1], i));
      });
    });
    var fCap = input("wfCap", data.capacity || "", { type: "number", inputmode: "numeric", min: "1", max: "200", step: "1", placeholder: "不限就留空" });
    var fIntro = el("textarea");
    fIntro.id = "wfIntro"; fIntro.rows = 10; fIntro.maxLength = 5000; fIntro.value = data.intro || "";
    fIntro.placeholder = "空一行就是新的段落\n\n# 課程內容\n- 靈氣的起源和歷史\n- 完整手位法\n\n**粗體**也可以用";
    pGrid.appendChild(openField);
    pGrid.appendChild(field("名額", fCap));
    var priceBox = el("div", "field wide");
    priceBox.appendChild(el("span", null, "費用（前台顯示成價目表；有填複訓價格，報名時客人才能選「複訓」）"));
    priceBox.appendChild(priceGrid);
    pGrid.appendChild(priceBox);
    pGrid.appendChild(field("課程介紹（選填，客人在前台按「課程介紹」才會打開；空一行分段，「# 」小標題，「- 」條列）", fIntro, "wide"));
    pBox.appendChild(pGrid);
    pBox.appendChild(el("p", "hint-text", "實體課的上課地點也會顯示在前台；線上教室連結不會公開。"));
    form.appendChild(pBox);

    var msg = el("p", "form-msg");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);
    var bar = el("div", "editor-actions");
    var save = el("button", "btn btn-primary", copying ? "建立新的一場" : isNew ? "建立工作坊" : draft ? "重新發佈" : "儲存");
    save.type = "submit";
    bar.appendChild(save);
    bar.appendChild(button("取消", "btn btn-ghost", closeEditors));
    if (!isNew) {
      var del = button("刪除這場工作坊", "btn btn-ghost danger-btn");
      armed(del, "刪除這場工作坊", "確定刪除？名單與點名紀錄都會刪除", function () {
        del.disabled = true;
        A.api("/api/admin/workshops/" + w.id, { method: "DELETE" }).then(function (r) {
          del.disabled = false;
          if (!guard(r)) return;
          A.toast("已刪除工作坊");
          closeEditors();
          showHome();
          loadList();
        });
      });
      bar.appendChild(del);
    }
    form.appendChild(bar);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = {
        title: fTitle.value, titleEn: fTitleEn.value, type: fType.value, format: fFormat.value,
        hours: fHours.value, location: fLocation.value, roomUrl: fRoom.value.trim(),
        sessions: data.sessions, teachers: data.teachers,
        signupOpen: fOpen.checked, capacity: fCap.value.trim(), intro: fIntro.value,
        prices: {
          new: { twd: priceInputs.new.twd.value.trim(), myr: priceInputs.new.myr.value.trim() },
          retake: { twd: priceInputs.retake.twd.value.trim(), myr: priceInputs.retake.myr.value.trim() },
        },
      };
      if (!body.title.trim()) { msg.textContent = "請填寫工作坊名稱。"; fTitle.focus(); return; }
      msg.textContent = "";
      save.disabled = true;
      A.api(isNew ? "/api/admin/workshops" : "/api/admin/workshops/" + w.id, { method: isNew ? "POST" : "PATCH", body: body }).then(function (r) {
        save.disabled = false;
        if (r.status === 401) return A.checkSession();
        if (!r.ok) { msg.textContent = r.message || "儲存失敗，請再試一次。"; return; }
        A.toast(copying ? "已建立新的一場，前台的工作坊頁會顯示這一場" : isNew ? "已建立工作坊" : draft ? "已重新發佈，前台的工作坊頁會再顯示這一場" : "已儲存");
        closeEditors();
        current = r.item;
        loadList();
        showDetail();
      });
    });

    card.appendChild(form);
    host.appendChild(card);
    fTitle.focus();
  }

  function closeEditors() {
    $("wsEditorHost").innerHTML = "";
    $("wsDetailEditorHost").innerHTML = "";
  }

  $("wsNew").addEventListener("click", function () { openEditor(null, $("wsEditorHost")); });

  // ================= 單一場工作坊 =================
  function showHome() {
    current = null;
    $("wsDetail").hidden = true;
    $("wsHome").hidden = false;
  }
  $("wsBack").addEventListener("click", function () { closeEditors(); showHome(); renderList(); });

  function openWorkshop(id, republish) {
    closeEditors();
    A.api("/api/admin/workshops/" + id).then(function (r) {
      if (!guard(r)) return;
      current = r.item;
      resetDraw();
      showDetail();
      if (republish) openRepublish();
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  function openRepublish() {
    openEditor(current, $("wsDetailEditorHost"), republishDraft(current));
    $("wsDetailEditorHost").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showDetail() {
    if (!current) return;
    $("wsHome").hidden = true;
    $("wsDetail").hidden = false;
    renderHead();
    renderRoster();
    renderSessions();
    renderDrawPool();
    renderPhoto();
    renderCerts();
  }

  $("wsEdit").addEventListener("click", function () { openEditor(current, $("wsDetailEditorHost")); });
  $("wsRepublish").addEventListener("click", openRepublish);
  // 再開一場：複製設定新增一場（不帶學員、點名、照片、證書；簽到代碼由後端重新產生）
  $("wsCopy").addEventListener("click", function () {
    openEditor(null, $("wsDetailEditorHost"), republishDraft(current));
    $("wsDetailEditorHost").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function renderHead() {
    var w = current;
    $("wsTitle").textContent = w.title;
    $("wsTitleEn").textContent = w.titleEn || "";
    $("wsTitleEn").hidden = !w.titleEn;
    $("wsAsk").hidden = !notHeld(w, (w.attendees || []).length);
    $("wsCopy").hidden = !(w.sessions[w.sessions.length - 1].date < todayLocal());
    var pills = $("wsPills");
    pills.innerHTML = "";
    pills.appendChild(el("span", "pill booked", TYPE[w.type]));
    pills.appendChild(el("span", "pill " + (w.format === "online" ? "open" : "closed"), FORMAT[w.format]));
    var dl = $("wsFacts");
    dl.innerHTML = "";
    function fact(k, v) {
      if (!v) return;
      var d = el("div");
      d.appendChild(el("dt", null, k));
      var dd = el("dd");
      if (v instanceof Node) dd.appendChild(v); else dd.textContent = v;
      d.appendChild(dd);
      dl.appendChild(d);
    }
    fact("日期", w.sessions.map(sessionText).join("\n"));
    fact("時數", hoursText(w.hours));
    fact("授課老師", teacherText(w.teachers));
    if (w.format === "online") {
      if (w.roomUrl) {
        var a = el("a", null, w.roomUrl);
        a.href = w.roomUrl; a.target = "_blank"; a.rel = "noopener";
        fact("線上教室", a);
      } else fact("線上教室", "還沒填連結（平台確定後到「編輯資料」補上）");
    } else fact("地點", w.location);
    fact("證書代號", w.letter ? w.letter + "（證書編號 " + w.letter + "-" + w.sessions[w.sessions.length - 1].date.slice(0, 4) + "-001 起）" : "第一次發證書時自動決定（A、B、C…）");
    fact("前台報名", w.signupOpen === false ? "不顯示在前台" : "開放中" + (w.capacity ? "（名額 " + w.capacity + " 位）" : "（不限名額）"));
    fact("費用", priceText(w.prices));
  }

  // ---------- 名單與點名 ----------
  function renderRoster() {
    var w = current;
    var t = $("wsRoster");
    t.innerHTML = "";
    var people = w.attendees || [];
    var full = people.filter(function (a) { return fullAttendance(w, a); }).length;
    $("wsRosterCount").textContent = people.length ? "共 " + people.length + " 位，全勤 " + full + " 位" : "";
    $("wsAddBox").open = !people.length;
    if (!people.length) {
      t.appendChild(el("caption", "empty", "名單還是空的。在下方「新增學員」一位一位輸入，或一次貼上整份名單。"));
      return;
    }
    t.appendChild(el("caption", "hp", "學員名單與每一堂的出席"));
    var thead = el("thead");
    var hr = el("tr");
    var th0 = el("th", null, "學員");
    th0.scope = "col";
    hr.appendChild(th0);
    w.sessions.forEach(function (s, i) {
      var th = el("th", "att-col");
      th.scope = "col";
      th.appendChild(el("span", null, "第 " + (i + 1) + " 堂"));
      th.appendChild(el("small", null, shortDate(s.date)));
      hr.appendChild(th);
    });
    var thA = el("th", "act-col", "");
    thA.appendChild(el("span", "hp", "操作"));
    hr.appendChild(thA);
    thead.appendChild(hr);
    t.appendChild(thead);

    var tb = el("tbody");
    people.forEach(function (a) {
      var tr = el("tr");
      var th = el("th", "who");
      th.scope = "row";
      th.appendChild(el("strong", null, a.name));
      var sub = [a.nameEn, a.email, a.instagram && "IG @" + a.instagram].filter(Boolean).join("・");
      if (sub) th.appendChild(el("span", null, sub));
      if (a.note) th.appendChild(el("span", null, "想說的話：" + a.note));
      if (a.source === "web") th.appendChild(el("span", "pill booked", "網站報名・" + (a.status === "retake" ? "複訓" : "新生") + (a.region ? "・" + (a.region === "MY" ? "馬來西亞" : "台灣") : "")));
      if (a.certNo) th.appendChild(el("span", "pill open", a.certNo));
      tr.appendChild(th);
      w.sessions.forEach(function (s, i) {
        var td = el("td", "att-col");
        var box = el("input");
        box.type = "checkbox";
        box.checked = Boolean(a.attended && a.attended[s.key]);
        box.setAttribute("aria-label", a.name + " 第 " + (i + 1) + " 堂出席");
        var how = a.attended && a.attended[s.key];
        if (how && how.by === "self") td.title = "學員自行簽到";
        box.addEventListener("change", function () { setAttendance(a, s.key, box); });
        td.appendChild(box);
        if (how && how.by === "self") td.appendChild(el("small", "self-mark", "自簽"));
        tr.appendChild(td);
      });
      var tdA = el("td", "act-col");
      tdA.appendChild(button("編輯", "mini", function () { editPerson(a, tr); }));
      if (!a.certCode) {
        var rm = button("移除", "mini danger");
        armed(rm, "移除", "確定？", function () { removePerson(a, rm); });
        tdA.appendChild(rm);
      }
      tr.appendChild(tdA);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  function setAttendance(a, key, box) {
    var body = { attended: {} };
    body.attended[key] = box.checked;
    box.disabled = true;
    A.api("/api/admin/workshops/" + current.id + "/attendees/" + a.id, { method: "PATCH", body: body }).then(function (r) {
      box.disabled = false;
      if (!guard(r)) { box.checked = !box.checked; return; }
      Object.assign(a, r.attendee);
      renderRoster();
      renderCerts();
    });
  }

  function editPerson(a, tr) {
    var w = current;
    var row = el("tr", "edit-row");
    var td = el("td");
    td.colSpan = w.sessions.length + 2;
    var form = el("form", "field-grid");
    form.noValidate = true;
    var n = input("wpName", a.name, { maxlength: 30 });
    var ne = input("wpNameEn", a.nameEn, { maxlength: 60, placeholder: "印在證書上，選填" });
    var em = input("wpEmail", a.email, { maxlength: 120, type: "email", inputmode: "email" });
    form.appendChild(field("姓名", n));
    form.appendChild(field("英文姓名", ne));
    form.appendChild(field("Email", em));
    var msg = el("p", "form-msg wide");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);
    var bar = el("div", "editor-actions wide");
    var save = el("button", "btn btn-primary btn-small", "儲存");
    save.type = "submit";
    bar.appendChild(save);
    bar.appendChild(button("取消", "btn btn-ghost btn-small", function () { row.remove(); }));
    form.appendChild(bar);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = { name: n.value, nameEn: ne.value, email: em.value };
      save.disabled = true;
      A.api("/api/admin/workshops/" + w.id + "/attendees/" + a.id, { method: "PATCH", body: body }).then(function (r) {
        save.disabled = false;
        if (r.status === 401) return A.checkSession();
        if (!r.ok) { msg.textContent = r.message || "儲存失敗"; return; }
        Object.assign(a, r.attendee);
        renderRoster();
        renderCerts();
        A.toast(a.certCode ? "已儲存。要讓證書也改過來，請按「更新已發出的證書」" : "已儲存");
      });
    });
    td.appendChild(form);
    row.appendChild(td);
    var open = tr.nextSibling && tr.nextSibling.classList && tr.nextSibling.classList.contains("edit-row");
    if (open) tr.nextSibling.remove();
    tr.after(row);
    n.focus();
  }

  function removePerson(a, btn) {
    btn.disabled = true;
    A.api("/api/admin/workshops/" + current.id + "/attendees/" + a.id, { method: "DELETE" }).then(function (r) {
      btn.disabled = false;
      if (!guard(r)) return;
      current.attendees = current.attendees.filter(function (x) { return x !== a; });
      renderRoster();
      renderDrawPool();
      renderCerts();
      A.toast("已從名單移除");
    });
  }

  // 貼上名單：支援逗號、全形逗號、Tab（從試算表複製）
  function parsePeople(text) {
    return text.split(/\r?\n/).map(function (line) {
      var parts = line.split(/\t|,|，|、/).map(function (x) { return x.trim(); });
      var email = "";
      parts = parts.filter(function (x) {
        if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) { email = x; return false; }
        return true;
      });
      return { name: parts[0] || "", nameEn: parts[1] || "", email: email };
    }).filter(function (p) { return p.name; });
  }
  $("wsAddText").addEventListener("input", function () {
    var ps = parsePeople(this.value);
    $("wsAddPreview").textContent = ps.length ? "將加入 " + ps.length + " 位：" + ps.map(function (p) { return p.name + (p.email ? "（有 Email）" : ""); }).join("、") : "";
  });
  function addPeople(people, btn, msg, onDone) {
    btn.disabled = true;
    A.api("/api/admin/workshops/" + current.id + "/attendees", { method: "POST", body: { people: people } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { msg.textContent = r.message || "加入失敗，請再試一次。"; return; }
      current = r.item;
      if (r.skipped && r.skipped.length) msg.textContent = "名單上已經有：" + r.skipped.join("、") + "，沒有重複加入。";
      if (r.added) A.toast(people.length === 1 ? "已加入 " + people[0].name : "已加入 " + r.added + " 位學員");
      renderRoster();
      renderSessions();
      renderDrawPool();
      renderCerts();
      loadList();
      onDone(r);
    });
  }

  // 單個輸入：加完清空欄位、游標回到姓名，方便連續輸入下一位
  $("wsOneForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var p = { name: $("wsOneName").value.trim(), nameEn: $("wsOneNameEn").value.trim(), email: $("wsOneEmail").value.trim() };
    var msg = $("wsOneMsg");
    if (!p.name) { msg.textContent = "請填寫學員姓名。"; $("wsOneName").focus(); return; }
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { msg.textContent = "Email 格式不正確。"; $("wsOneEmail").focus(); return; }
    msg.textContent = "";
    addPeople([p], $("wsOneBtn"), msg, function (r) {
      if (!r.added) return;
      $("wsOneName").value = $("wsOneNameEn").value = $("wsOneEmail").value = "";
      $("wsAddBox").open = true;
      $("wsOneName").focus();
    });
  });

  $("wsAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var people = parsePeople($("wsAddText").value);
    var msg = $("wsAddMsg");
    if (!people.length) { msg.textContent = "請至少填寫一位學員的姓名。"; return; }
    msg.textContent = "";
    addPeople(people, $("wsAddBtn"), msg, function () {
      $("wsAddText").value = "";
      $("wsAddPreview").textContent = "";
    });
  });

  // ---------- 簽到與課前通知 ----------
  function letterFor(w, s, i) {
    var lines = [
      "你好：",
      "",
      "提醒你，「" + w.title + "」" + (w.sessions.length > 1 ? "第 " + (i + 1) + " 堂" : "") + "即將開始，以下是上課資訊：",
      "",
      "時間：" + sessionText(s),
    ];
    if (w.format === "online") {
      lines.push("線上教室：" + (w.roomUrl || "＿＿＿＿（教室連結）"));
      lines.push("簽到連結：" + checkinUrl(s));
      lines.push("");
      lines.push("上課當天請點簽到連結，輸入報名時填寫的姓名或 Email 就完成簽到。");
    } else {
      lines.push("地點：" + (w.location || "＿＿＿＿"));
    }
    lines.push("", "期待與你相見。", "", "阿綸");
    return {
      subject: "【阿綸涅亞 NIEIA】課前提醒：" + w.title + (w.sessions.length > 1 ? " 第 " + (i + 1) + " 堂" : "") + "｜" + shortDate(s.date),
      body: lines.join("\n"),
    };
  }

  function renderSessions() {
    var w = current;
    var emails = (w.attendees || []).map(function (a) { return a.email; }).filter(Boolean);
    var missing = (w.attendees || []).filter(function (a) { return !a.email; }).length;
    $("wsCheckinHint").textContent = (w.format === "online"
      ? "線上課的學員在上課當天點簽到連結、輸入姓名或 Email 就會自動打勾。課前通知信會附上教室與簽到連結。"
      : "實體課直接在上方名單打勾點名就好。課前通知信會附上上課地點。") +
      (missing ? "（有 " + missing + " 位學員沒有 Email，收不到通知信。）" : "");
    var host = $("wsSessions");
    host.innerHTML = "";
    w.sessions.forEach(function (s, i) {
      var box = el("div", "session-card");
      var head = el("div", "session-head");
      head.appendChild(el("strong", null, (w.sessions.length > 1 ? "第 " + (i + 1) + " 堂　" : "") + sessionText(s)));
      var count = (w.attendees || []).filter(function (a) { return a.attended && a.attended[s.key]; }).length;
      head.appendChild(el("span", "count", "出席 " + count + " / " + (w.attendees || []).length));
      box.appendChild(head);

      if (w.format === "online") {
        var row = el("div", "copy-row");
        var url = input("wsCk" + i, checkinUrl(s), { readonly: "" });
        url.setAttribute("aria-label", "第 " + (i + 1) + " 堂簽到連結");
        var cp = button("複製簽到連結", "btn btn-ghost btn-small");
        cp.addEventListener("click", function () { copy(url.value, cp, "複製簽到連結"); });
        row.appendChild(url);
        row.appendChild(cp);
        box.appendChild(row);
      }

      var acts = el("div", "actions mail-actions");
      var m = letterFor(w, s, i);
      var send = el("a", "mail-btn", "用 Gmail 寄課前通知");
      if (emails.length) {
        // 用密件副本，學員之間看不到彼此的 Email
        send.href = gmail({ bcc: emails.join(","), su: m.subject, body: m.body });
        send.target = "_blank"; send.rel = "noopener";
      } else {
        send.setAttribute("aria-disabled", "true");
        send.classList.add("is-disabled");
        send.title = "名單上還沒有學員的 Email";
      }
      acts.appendChild(send);
      var cl = button("複製信件內容", "mini");
      cl.addEventListener("click", function () { copy(m.subject + "\n\n" + m.body, cl, "複製信件內容"); });
      acts.appendChild(cl);
      if (emails.length) {
        var ce = button("複製全部 Email", "mini");
        ce.addEventListener("click", function () { copy(emails.join(", "), ce, "複製全部 Email"); });
        acts.appendChild(ce);
      }
      box.appendChild(acts);
      host.appendChild(box);
    });
  }

  // ---------- 抽籤 ----------
  var drawMode = "pick";
  var drawn = {}; // 抽人時已經抽過的學員
  function rand(n) {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rand(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function resetDraw() {
    drawn = {};
    var st = $("drawStage");
    st.innerHTML = "";
    st.appendChild(el("p", "draw-empty", "按「抽籤」開始，結果會顯示在這裡，可以全螢幕分享給大家看。"));
  }
  function renderDrawPool() {
    var w = current;
    var sel = $("drawPool");
    var prev = sel.value;
    sel.innerHTML = "";
    var all = el("option", null, "全部學員（" + (w.attendees || []).length + " 位）");
    all.value = "all";
    sel.appendChild(all);
    w.sessions.forEach(function (s, i) {
      var n = (w.attendees || []).filter(function (a) { return a.attended && a.attended[s.key]; }).length;
      var o = el("option", null, (w.sessions.length > 1 ? "第 " + (i + 1) + " 堂" : "") + "已出席的學員（" + shortDate(s.date) + "，" + n + " 位）");
      o.value = s.key;
      sel.appendChild(o);
    });
    var today = w.sessions.filter(function (s) { return s.date === todayLocal(); })[0];
    sel.value = prev && sel.querySelector('option[value="' + prev + '"]') ? prev : (today ? today.key : "all");
  }
  function pool() {
    var key = $("drawPool").value;
    return (current.attendees || []).filter(function (a) { return key === "all" || (a.attended && a.attended[key]); });
  }
  $("drawMode").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]");
    if (!b) return;
    drawMode = b.getAttribute("data-mode");
    this.querySelectorAll("[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    document.querySelectorAll(".draw [data-for]").forEach(function (f) { f.hidden = f.getAttribute("data-for") !== drawMode; });
    resetDraw();
  });
  $("drawPool").addEventListener("change", resetDraw);
  $("drawReset").addEventListener("click", function () { resetDraw(); A.toast("已重新開始"); });

  function showResult(title, build) {
    var st = $("drawStage");
    st.innerHTML = "";
    st.appendChild(el("p", "draw-title", title));
    var body = el("div", "draw-body");
    build(body);
    st.appendChild(body);
    st.classList.remove("pop");
    void st.offsetWidth;
    st.classList.add("pop");
  }

  $("drawGo").addEventListener("click", function () {
    var people = pool();
    if (!people.length) { A.toast($("drawPool").value === "all" ? "名單上還沒有學員" : "這一堂還沒有人出席，請先點名或改成全部學員"); return; }
    if (drawMode === "pick") {
      var noRepeat = $("drawNoRepeat").checked;
      var left = noRepeat ? people.filter(function (a) { return !drawn[a.id]; }) : people;
      if (!left.length) { A.toast("大家都抽過了，按「重新開始」可以再抽一輪"); return; }
      var n = Math.max(1, Math.min(Number($("drawCount").value) || 1, left.length));
      var picked = shuffle(left).slice(0, n);
      picked.forEach(function (a) { drawn[a.id] = true; });
      showResult(noRepeat ? "還沒抽到的有 " + (left.length - n) + " 位" : "從 " + people.length + " 位中抽出", function (b) {
        b.classList.add("names");
        picked.forEach(function (a) { b.appendChild(el("span", "draw-name", a.name)); });
      });
    } else if (drawMode === "order") {
      var order = shuffle(people);
      showResult("分享順序", function (b) {
        var ol = el("ol", "draw-order");
        order.forEach(function (a) { ol.appendChild(el("li", null, a.name)); });
        b.appendChild(ol);
      });
    } else if (drawMode === "group") {
      var size = Math.max(2, Number($("drawSize").value) || 2);
      var mixed = shuffle(people);
      var groups = [];
      for (var i = 0; i < mixed.length; i += size) groups.push(mixed.slice(i, i + size));
      // 最後一組人數太少，就併到前一組
      if (groups.length > 1 && groups[groups.length - 1].length < Math.ceil(size / 2)) groups[groups.length - 2] = groups[groups.length - 2].concat(groups.pop());
      showResult("共 " + groups.length + " 組", function (b) {
        b.classList.add("groups");
        groups.forEach(function (g, gi) {
          var card = el("div", "draw-group");
          card.appendChild(el("span", "g-no", "第 " + (gi + 1) + " 組"));
          card.appendChild(el("span", "g-names", g.map(function (a) { return a.name; }).join("、")));
          b.appendChild(card);
        });
      });
    }
  });

  $("drawFull").addEventListener("click", function () {
    var st = $("drawStage");
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (st.requestFullscreen) st.requestFullscreen().catch(function () { A.toast("這個瀏覽器不支援全螢幕，可以直接分享整個視窗"); });
    else A.toast("這個瀏覽器不支援全螢幕，可以直接分享整個視窗");
  });

  // ---------- 大合照 ----------
  function renderPhoto() {
    var key = current.photoKey;
    $("wsPhoto").hidden = !key;
    $("wsPhotoDel").hidden = !key;
    $("wsPhotoLabel").textContent = key ? "換一張照片" : "選擇照片";
    if (key) $("wsPhotoImg").src = "/api/photos/" + key;
    $("wsPhotoMsg").textContent = "";
  }

  // 縮到長邊 1600px 以內、存成 JPEG，控制在 600 KB 左右
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var q = 0.85, out = c.toDataURL("image/jpeg", q);
        while (out.length * 0.75 > 600 * 1024 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  $("wsPhotoInput").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    var msg = $("wsPhotoMsg");
    msg.textContent = "";
    $("wsPhotoLabel").textContent = "上傳中…";
    compress(file).then(function (dataUrl) {
      return A.api("/api/admin/workshops/" + current.id + "/photo", { method: "PUT", body: { dataUrl: dataUrl } });
    }).then(function (r) {
      if (!guard(r)) { renderPhoto(); return; }
      current.photoKey = r.photoKey;
      renderPhoto();
      A.toast("已上傳大合照，學員的證書頁也會一起更新");
    }, function () {
      renderPhoto();
      msg.textContent = "這張照片無法讀取，請換成 JPG 或 PNG 再試一次。";
    });
  });

  var delPhoto = $("wsPhotoDel");
  armed(delPhoto, "移除照片", "確定移除？", function () {
    A.api("/api/admin/workshops/" + current.id + "/photo", { method: "DELETE" }).then(function (r) {
      if (!guard(r)) return;
      current.photoKey = null;
      renderPhoto();
      A.toast("已移除照片");
    });
  });

  // ---------- 結業證書 ----------
  function certLetter(w, a) {
    return {
      subject: "【阿綸涅亞 NIEIA】你的結業證書：" + w.title,
      body: [
        a.name + " 你好：",
        "",
        "恭喜你完成「" + w.title + "」，謝謝你這段時間的投入。",
        "這是你的結業證書，點開連結就能查看、下載，也有適合分享到 IG 限時動態的版本：",
        "",
        certUrl(a.certCode),
        "",
        "證書編號：" + a.certNo,
        "",
        "阿綸",
      ].join("\n"),
    };
  }

  function issue(ids, btn, doneText) {
    if (!ids.length) return;
    btn.disabled = true;
    A.api("/api/admin/workshops/" + current.id + "/certificates", { method: "POST", body: { attendeeIds: ids } }).then(function (r) {
      btn.disabled = false;
      if (!guard(r)) return;
      current = r.item;
      renderRoster();
      renderCerts();
      loadList();
      loadCerts();
      A.toast(doneText.replace("{n}", r.issued.length));
      $("wsCerts").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function renderCerts() {
    var w = current;
    var people = w.attendees || [];
    var issued = people.filter(function (a) { return a.certCode; });
    var ready = people.filter(function (a) { return !a.certCode && fullAttendance(w, a); });
    $("wsCertCount").textContent = people.length ? "已發 " + issued.length + " / " + people.length + " 張" : "";
    var all = $("wsIssueAll");
    all.textContent = ready.length ? "為全勤學員發證書（" + ready.length + " 位）" : "為全勤學員發證書";
    all.disabled = !ready.length;
    $("wsReissue").hidden = !issued.length;
    // 按鈕不能按時說明原因
    var why = "";
    if (!people.length) why = "名單還是空的，先在上方「新增學員」加入學員。";
    else if (!ready.length && issued.length < people.length) why = "目前沒有全勤的學員。先在名單裡點名，或在下方學員旁按「仍要發證書」。";
    $("wsCertWhy").textContent = why;
    $("wsCertWhy").hidden = !why;

    var host = $("wsCerts");
    host.innerHTML = "";
    if (!people.length) return;
    people.forEach(function (a) {
      var row = el("div", "cert-row");
      var info = el("div", "cert-info");
      info.appendChild(el("strong", null, a.name));
      if (a.certCode) {
        info.appendChild(el("span", "cert-no", a.certNo));
        info.appendChild(el("span", "cert-meta", a.email ? (a.certSentAt ? "已寄 Email（" + shortDate(String(a.certSentAt).slice(0, 10)) + "）・" : "") + a.email : "還沒有 Email"));
      } else {
        var done = w.sessions.filter(function (s) { return a.attended && a.attended[s.key]; }).length;
        info.appendChild(el("span", "cert-no muted-no", fullAttendance(w, a) ? "全勤，可以發證書" : "出席 " + done + " / " + w.sessions.length + " 堂"));
      }
      row.appendChild(info);
      var acts = el("div", "actions mail-actions");
      if (a.certCode) {
        var open = el("a", "mail-btn", "查看證書");
        open.href = "/cert?c=" + a.certCode; open.target = "_blank"; open.rel = "noopener";
        acts.appendChild(open);
        if (a.email) {
          var m = certLetter(w, a);
          var send = el("a", "mail-btn" + (a.certSentAt ? "" : " is-primary"), a.certSentAt ? "再寄一次" : "寄 Email");
          send.href = gmail({ to: a.email, su: m.subject, body: m.body });
          send.target = "_blank"; send.rel = "noopener";
          send.addEventListener("click", function () { markSent(a); });
          acts.appendChild(send);
        } else {
          acts.appendChild(button("補上 Email", "mini", function () { askEmail(a, row); }));
        }
        var cp = button("複製連結", "mini");
        cp.addEventListener("click", function () { copy(certUrl(a.certCode), cp, "複製連結"); });
        acts.appendChild(cp);
      } else {
        var one = button(fullAttendance(w, a) ? "發證書" : "仍要發證書", "mini");
        one.addEventListener("click", function () { issue([a.id], one, "已發出證書"); });
        acts.appendChild(one);
      }
      row.appendChild(acts);
      host.appendChild(row);
    });
  }

  // 打開 Gmail 寄信時順便記下來，下次就知道誰已經寄過
  function markSent(a) {
    A.api("/api/admin/workshops/" + current.id + "/attendees/" + a.id, { method: "PATCH", body: { certSent: true } }).then(function (r) {
      if (!r.ok) return;
      a.certSentAt = r.attendee.certSentAt;
      renderCerts();
    });
  }

  function askEmail(a, row) {
    var form = el("form", "cert-email");
    form.noValidate = true;
    var i = input("wsCertEmail-" + a.id, "", { type: "email", inputmode: "email", maxlength: "120", placeholder: a.name + " 的 Email" });
    i.setAttribute("aria-label", a.name + " 的 Email");
    form.appendChild(i);
    var save = el("button", "mini", "儲存");
    save.type = "submit";
    form.appendChild(save);
    form.appendChild(button("取消", "mini", function () { renderCerts(); }));
    var msg = el("p", "form-msg");
    msg.setAttribute("role", "alert");
    form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = i.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Email 格式不正確。"; i.focus(); return; }
      save.disabled = true;
      A.api("/api/admin/workshops/" + current.id + "/attendees/" + a.id, { method: "PATCH", body: { email: email } }).then(function (r) {
        save.disabled = false;
        if (!guard(r)) return;
        a.email = r.attendee.email;
        renderRoster();
        renderSessions();
        renderCerts();
      });
    });
    row.appendChild(form);
    i.focus();
  }

  $("wsIssueAll").addEventListener("click", function () {
    var w = current;
    var ids = (w.attendees || []).filter(function (a) { return !a.certCode && fullAttendance(w, a); }).map(function (a) { return a.id; });
    issue(ids, this, "已發出 {n} 張證書");
  });
  $("wsReissue").addEventListener("click", function () {
    var ids = (current.attendees || []).filter(function (a) { return a.certCode; }).map(function (a) { return a.id; });
    issue(ids, this, "已更新 {n} 張證書");
  });

  // ================= 證書登記 =================
  function loadCerts() {
    var q = $("certQ").value.trim();
    A.api("/api/admin/certificates" + (q ? "?q=" + encodeURIComponent(q) : "")).then(function (r) {
      if (!guard(r)) return;
      var host = $("certList");
      host.innerHTML = "";
      $("certCount").textContent = q ? "找到 " + r.items.length + " 張" : r.items.length ? "最近 " + r.items.length + " 張" : "";
      if (!r.items.length) {
        host.appendChild(el("p", "hint", q ? "找不到符合「" + q + "」的證書。" : "還沒有發出任何證書。"));
        return;
      }
      r.items.forEach(function (c) {
        var row = el("div", "cert-row");
        var info = el("div", "cert-info");
        info.appendChild(el("strong", null, c.name + (c.nameEn ? "　" + c.nameEn : "")));
        info.appendChild(el("span", "cert-no", c.no));
        info.appendChild(el("span", "cert-meta", c.title + "・" + (c.dates.first === c.dates.last ? c.dates.first : c.dates.first + " 至 " + c.dates.last) + "・" + teacherText(c.teachers)));
        row.appendChild(info);
        var acts = el("div", "actions mail-actions");
        var open = el("a", "mail-btn", "查看證書");
        open.href = "/cert?c=" + c.code; open.target = "_blank"; open.rel = "noopener";
        acts.appendChild(open);
        var cp = button("複製連結", "mini");
        cp.addEventListener("click", function () { copy(certUrl(c.code), cp, "複製連結"); });
        acts.appendChild(cp);
        if (c.workshopId) acts.appendChild(button("打開工作坊", "mini", function () { openWorkshop(c.workshopId); }));
        row.appendChild(acts);
        host.appendChild(row);
      });
    });
  }
  $("certSearch").addEventListener("submit", function (e) { e.preventDefault(); loadCerts(); });

  // ---------- 確認登入後載入 ----------
  document.addEventListener("nieia:dash", function () {
    if (!loaded) { loadList(); loadCerts(); }
  });
})();
