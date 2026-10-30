// 後台：擺攤模式
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var timer = null;
  var formDirty = false;
  var items = [];
  var editing = -1; // 正在編輯的項目位置，-1 表示沒有

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function call(path, method, body, background) {
    return A.api(path, { method: method || "GET", body: body, background: background }).then(function (r) {
      if (r.status === 401) { A.checkSession(); return r; }
      if (r.ok && r.market) { data = r; render(); }
      return r;
    });
  }
  function load(background) { return call("/api/admin/market", "GET", undefined, background); }

  // ---------- 畫面 ----------
  function render() {
    var m = data.market;
    var pill = $("mkPill");
    pill.className = "pill " + (m.active ? (m.accepting ? "open" : "booked") : "closed");
    pill.textContent = m.active ? (m.accepting ? "擺攤中" : "擺攤中，暫停取號") : "未擺攤";
    $("mkHint").textContent = m.active
      ? "首頁正在顯示擺攤提醒。客人可以在排隊頁取號，叫號後他們的手機會顯示「輪到你了」。"
      : "填好下方的擺攤資訊並儲存，就可以開始擺攤。開始後，首頁會出現擺攤提醒，客人可以用手機取號。";
    $("mkStart").hidden = m.active;
    $("mkEnd").hidden = !m.active;
    $("mkAccept").hidden = !m.active;
    $("mkAccept").textContent = m.accepting ? "暫停取號" : "恢復取號";
    $("mkQueue").hidden = !m.active;

    if (!formDirty && editing < 0) {
      $("mkLocation").value = m.location || "";
      $("mkAddress").value = m.address || "";
      $("mkHours").value = m.hours || "";
      $("mkMinutes").value = m.minutesPer || 15;
      $("mkNote").value = m.note || "";
      $("mkShowProducts").checked = m.showProducts !== false;
      $("mkCurrency").value = m.currency === "MYR" ? "MYR" : "TWD";
      items = (m.services || []).map(function (s) { return { name: s.name, minutes: s.minutes || null, free: Boolean(s.free), twd: s.twd == null ? null : s.twd, myr: s.myr == null ? null : s.myr, desc: s.desc || "" }; });
      renderItems();
    }

    var tickets = data.tickets || [];
    var serving = tickets.filter(function (t) { return t.status === "serving"; })[0];
    var waiting = tickets.filter(function (t) { return t.status === "waiting"; });
    var past = tickets.filter(function (t) { return ["done", "skipped", "cancelled"].indexOf(t.status) >= 0; }).reverse();
    $("mkServing").textContent = serving ? serving.number + " 號" : "—";
    $("mkServingName").textContent = serving ? serving.name + (serving.service ? "｜" + serving.service : "") : "";
    $("mkCount").textContent = "等候 " + waiting.length + " 位";
    $("mkNext").textContent = waiting.length ? "叫下一位（" + waiting[0].number + " 號）" : (serving ? "完成目前這位" : "目前沒有人排隊");
    $("mkNext").disabled = !waiting.length && !serving;

    var wl = $("mkWaiting");
    wl.innerHTML = "";
    if (!waiting.length) wl.appendChild(el("p", "hint", "目前沒有人在等候。"));
    waiting.forEach(function (t) { wl.appendChild(ticketRow(t, true)); });
    var pl = $("mkPast");
    pl.innerHTML = "";
    $("mkPastLabel").textContent = "已結束的號碼（" + past.length + "）";
    past.forEach(function (t) { pl.appendChild(ticketRow(t, false)); });
  }

  var LABEL = { done: "完成", skipped: "過號", cancelled: "已取消" };
  function ticketRow(t, active) {
    var row = el("div", "q-row" + (active ? "" : " is-past"));
    row.appendChild(el("span", "q-num", String(t.number)));
    var info = el("div", "q-info");
    info.appendChild(el("strong", null, t.name));
    var meta = [];
    if (t.service) meta.push(t.service);
    if (!active) meta.push(LABEL[t.status] || t.status);
    if (meta.length) info.appendChild(el("span", null, meta.join("｜")));
    if (t.phone) {
      var tel = el("a", "q-tel", t.phone);
      tel.href = "tel:" + t.phone;
      info.appendChild(tel);
    }
    row.appendChild(info);
    var actions = el("div", "actions");
    if (active) {
      actions.appendChild(btn("叫號", function (b) { setTicket(t, "serving", b); }));
      actions.appendChild(btn("過號", function (b) { setTicket(t, "skipped", b); }));
    } else if (t.status === "skipped") {
      actions.appendChild(btn("重新排入", function (b) { setTicket(t, "waiting", b); }));
    }
    row.appendChild(actions);
    return row;
  }
  function btn(text, fn) {
    var b = el("button", null, text);
    b.type = "button";
    b.addEventListener("click", function () { fn(b); });
    return b;
  }
  function setTicket(t, status, b) {
    b.disabled = true;
    call("/api/admin/market/tickets/" + t.id, "PATCH", { status: status }).then(function (r) {
      b.disabled = false;
      if (!r.ok) A.toast(r.message || "更新失敗");
      else if (status === "serving") A.toast("已叫 " + t.number + " 號");
    });
  }

  // ---------- 操作 ----------
  $("mkNext").addEventListener("click", function () {
    var b = this;
    b.disabled = true;
    call("/api/admin/market/next", "POST").then(function (r) {
      b.disabled = false;
      if (!r.ok) { A.toast(r.message || "叫號失敗"); return; }
      A.toast(r.called ? "已叫 " + r.called + " 號" : "目前沒有人在等候");
    });
  });

  $("mkStart").addEventListener("click", function () {
    var b = this;
    if (!$("mkLocation").value.trim()) { $("mkMsg").textContent = "請先填寫地點名稱並儲存。"; $("mkLocation").focus(); return; }
    var go = function () {
      b.disabled = true;
      call("/api/admin/market/start", "POST").then(function (r) {
        b.disabled = false;
        if (!r.ok) { A.toast(r.message || "無法開始擺攤"); return; }
        A.toast("已開始擺攤，首頁會顯示提醒");
        loadHistory();
        startPolling();
      });
    };
    if (formDirty) save().then(function (r) { if (r && r.ok) go(); }); else go();
  });

  var endArmed = null;
  $("mkEnd").addEventListener("click", function () {
    var b = this;
    if (!endArmed) {
      b.textContent = "確定結束？排隊會清空";
      b.classList.add("confirm");
      endArmed = setTimeout(function () { endArmed = null; b.textContent = "結束擺攤"; b.classList.remove("confirm"); }, 5000);
      return;
    }
    clearTimeout(endArmed); endArmed = null;
    b.classList.remove("confirm"); b.textContent = "結束擺攤";
    b.disabled = true;
    call("/api/admin/market/end", "POST").then(function (r) {
      b.disabled = false;
      if (r.ok) { A.toast("已結束擺攤，首頁提醒已關閉"); loadHistory(); }
    });
  });

  $("mkAccept").addEventListener("click", function () {
    var b = this;
    var next = !data.market.accepting;
    b.disabled = true;
    call("/api/admin/market/accepting", "POST", { accepting: next }).then(function (r) {
      b.disabled = false;
      if (r.ok) A.toast(next ? "已恢復取號" : "已暫停取號，排隊中的客人不受影響");
    });
  });

  // ---------- 現場項目 ----------
  function validItem(it, skip) {
    if (!it.name) return "請填寫項目名稱。";
    if (it.minutes != null && !(Number.isInteger(it.minutes) && it.minutes >= 1 && it.minutes <= 240)) return "分鐘要是 1 到 240 之間的整數。";
    if ([it.twd, it.myr].some(function (n) { return n != null && !(Number.isInteger(n) && n >= 0 && n <= 1000000); })) return "金額要是整數（不用加小數點或符號）。";
    if (items.some(function (x, k) { return k !== skip && x.name === it.name; })) return "已經有同名的項目了。";
    return "";
  }
  function readItem(name, min, pick, desc) {
    var m = min.value.trim();
    var free = pick.free.checked;
    var num = function (i) { var v = i.value.trim(); return !free && v ? Number(v) : null; };
    return { name: name.value.trim(), minutes: m ? Number(m) : null, free: free, twd: num(pick.twd), myr: num(pick.myr), desc: desc.value.trim() };
  }
  // 每個項目各存台幣與馬幣價格；擺攤資訊的「價格幣別」決定排隊頁顯示哪一個
  function money(sym, n) { return n == null ? "" : sym + Number(n).toLocaleString("en-US"); }
  function priceText(it) {
    if (it.free) return "隨喜";
    var shown = $("mkCurrency").value === "MYR" ? "MYR" : "TWD";
    var parts = [money("NT$", it.twd), money("RM ", it.myr)].filter(Boolean);
    if (!parts.length) return "";
    var missing = shown === "MYR" ? it.myr == null : it.twd == null;
    return parts.join("／") + (missing ? "（" + (shown === "MYR" ? "馬幣" : "台幣") + "價格未填，排隊頁不顯示價格）" : "");
  }
  function pricePicker(it) {
    var f = el("div", "field price-field wide");
    var lbl = el("span", null, "價格（兩種都可以填，排隊頁依「價格幣別」顯示）");
    f.appendChild(lbl);
    var box = el("div", "price-pick");
    function amount(sym, label, value) {
      var wrap = el("span", "price-amt");
      var s = el("span", "price-sym", sym);
      s.setAttribute("aria-hidden", "true");
      var i = el("input");
      i.type = "number"; i.inputMode = "numeric"; i.min = 0; i.max = 1000000; i.step = 1;
      i.setAttribute("aria-label", label);
      i.value = value == null ? "" : value;
      wrap.appendChild(s); wrap.appendChild(i);
      box.appendChild(wrap);
      return i;
    }
    var twd = amount("NT$", "台幣價格", it.twd);
    var myr = amount("RM", "馬幣價格", it.myr);
    var freeLbl = el("label", "price-free");
    var free = el("input");
    free.type = "checkbox";
    free.checked = Boolean(it.free);
    freeLbl.appendChild(free);
    freeLbl.appendChild(document.createTextNode("隨喜"));
    box.appendChild(freeLbl);
    f.appendChild(box);
    // 勾「隨喜」時不用填金額
    function sync() {
      [twd, myr].forEach(function (i) { i.parentNode.hidden = free.checked; if (free.checked) i.value = ""; });
    }
    free.addEventListener("change", sync);
    sync();
    return { field: f, free: free, twd: twd, myr: myr, reset: function () { twd.value = ""; myr.value = ""; free.checked = false; sync(); } };
  }
  function input(label, value, opts) {
    var f = el("label", "field" + (opts.wide ? " wide" : ""));
    f.appendChild(el("span", null, label));
    var i = el(opts.textarea ? "textarea" : "input");
    if (opts.textarea) i.rows = 3;
    else i.type = opts.type || "text";
    if (opts.type === "number") { i.min = 1; i.max = 240; i.inputMode = "numeric"; }
    if (opts.max) i.maxLength = opts.max;
    if (opts.placeholder) i.placeholder = opts.placeholder;
    i.value = value == null ? "" : value;
    f.appendChild(i);
    return { field: f, input: i };
  }
  function renderEditor(it, i) {
    var row = el("div", "item-add item-edit");
    var n = input("項目名稱", it.name, { max: 40 });
    var mi = input("分鐘", it.minutes, { type: "number" });
    var p = pricePicker(it);
    var d = input("說明（客人會看到）", it.desc, { max: 500, wide: true, textarea: true });
    [n, mi, p, d].forEach(function (x) { row.appendChild(x.field); });
    var msg = el("p", "form-msg wide");
    msg.setAttribute("role", "status");
    row.appendChild(msg);
    var acts = el("div", "edit-actions wide");
    var ok = el("button", "btn", "儲存修改"); ok.type = "button";
    var cancel = el("button", "btn btn-ghost", "取消"); cancel.type = "button";
    ok.addEventListener("click", function () {
      var next = readItem(n.input, mi.input, p, d.input);
      var err = validItem(next, i);
      if (err) { msg.textContent = err; return; }
      items[i] = next;
      editing = -1;
      renderItems();
      saveItems("已更新項目");
    });
    cancel.addEventListener("click", function () { editing = -1; renderItems(); });
    [n.input, mi.input, p.twd, p.myr, p.free, d.input].forEach(function (x) {
      x.addEventListener("input", function () { msg.textContent = ""; });
      x.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && x.tagName === "INPUT") { e.preventDefault(); ok.click(); }
        if (e.key === "Escape") { e.preventDefault(); cancel.click(); }
      });
    });
    acts.appendChild(ok); acts.appendChild(cancel);
    row.appendChild(acts);
    setTimeout(function () { n.input.focus(); }, 0);
    return row;
  }
  function renderItems() {
    var box = $("mkItems");
    box.innerHTML = "";
    if (!items.length) { box.appendChild(el("p", "hint", "還沒有項目。用下方表單新增，客人取號時可以選擇想做的項目。")); return; }
    items.forEach(function (it, i) {
      if (i === editing) { box.appendChild(renderEditor(it, i)); return; }
      var row = el("div", "item-row");
      var info = el("div", "item-info");
      info.appendChild(el("strong", null, it.name));
      var meta = [];
      if (it.minutes) meta.push(it.minutes + " 分鐘");
      if (priceText(it)) meta.push(priceText(it));
      if (meta.length) info.appendChild(el("span", null, meta.join("｜")));
      if (it.desc) info.appendChild(el("span", "item-desc", it.desc));
      row.appendChild(info);
      var actions = el("div", "actions");
      var busy = editing >= 0;
      var up = btn("↑", function () { moveItem(i, -1); }); up.setAttribute("aria-label", "往上移"); up.disabled = busy || i === 0;
      var down = btn("↓", function () { moveItem(i, 1); }); down.setAttribute("aria-label", "往下移"); down.disabled = busy || i === items.length - 1;
      var edit = btn("編輯", function () { editing = i; renderItems(); }); edit.disabled = busy;
      var del = btn("刪除", function () { items.splice(i, 1); renderItems(); saveItems("已刪除項目"); }); del.disabled = busy;
      actions.appendChild(up); actions.appendChild(down); actions.appendChild(edit); actions.appendChild(del);
      row.appendChild(actions);
      box.appendChild(row);
    });
  }
  function moveItem(i, d) {
    var j = i + d;
    if (j < 0 || j >= items.length) return;
    var t = items[i]; items[i] = items[j]; items[j] = t;
    renderItems();
    saveItems("已調整順序");
  }
  $("mkIAdd").addEventListener("click", function () {
    var msg = $("mkIMsg");
    var it = readItem($("mkIName"), $("mkIMin"), addPrice, $("mkIDesc"));
    if (!it.name) { msg.textContent = "請填寫項目名稱。"; $("mkIName").focus(); return; }
    var err = validItem(it, -1);
    if (err) { msg.textContent = err; return; }
    if (items.length >= 20) { msg.textContent = "最多 20 個項目。"; return; }
    msg.textContent = "";
    items.push(it);
    ["mkIName", "mkIMin", "mkIDesc"].forEach(function (id) { $(id).value = ""; });
    addPrice.reset();
    renderItems();
    saveItems("已新增項目");
    $("mkIName").focus();
  });
  ["mkIName", "mkIMin", "mkIDesc"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter" && this.tagName !== "TEXTAREA") { e.preventDefault(); $("mkIAdd").click(); } });
  });
  // 新增表單的價格欄也用同一個元件，放在「說明」前面
  var addPrice = pricePicker({});
  $("mkIDesc").parentNode.parentNode.insertBefore(addPrice.field, $("mkIDesc").parentNode);
  [addPrice.twd, addPrice.myr].forEach(function (i) {
    i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("mkIAdd").click(); } });
  });
  // 項目一變動就存，不用另外按儲存
  function saveItems(doneText) {
    return A.api("/api/admin/market", { method: "PUT", body: formBody() }).then(function (r) {
      if (r.status === 401) { A.checkSession(); return r; }
      if (!r.ok) { A.toast(r.message || "儲存失敗"); return r; }
      var keepDirty = formDirty;
      formDirty = true; // 不要讓伺服器回傳的資料蓋掉正在編輯的欄位
      data = r; render();
      formDirty = keepDirty;
      A.toast(doneText);
      return r;
    });
  }
  function formBody() {
    return {
      location: $("mkLocation").value, address: $("mkAddress").value, hours: $("mkHours").value,
      minutesPer: Number($("mkMinutes").value), services: items, note: $("mkNote").value,
      currency: $("mkCurrency").value,
      showProducts: $("mkShowProducts").checked,
    };
  }

  ["mkLocation", "mkAddress", "mkHours", "mkMinutes", "mkNote"].forEach(function (id) {
    $(id).addEventListener("input", function () { formDirty = true; });
  });
  // 改幣別：所有項目一起改成顯示另一種幣別的價格，直接存
  $("mkCurrency").addEventListener("change", function () {
    if (editing < 0) renderItems();
    saveItems("排隊頁改成顯示" + ($("mkCurrency").value === "MYR" ? "馬幣（RM）" : "台幣（NT$）") + "價格");
  });
  // 勾選後直接存，不用另外按儲存
  $("mkShowProducts").addEventListener("change", function () {
    saveItems(this.checked ? "排隊頁會顯示現場商品" : "排隊頁不顯示現場商品");
  });
  function save() {
    var msg = $("mkMsg");
    if (!$("mkLocation").value.trim()) { msg.textContent = "請填寫地點名稱。"; return Promise.resolve(null); }
    msg.textContent = "";
    $("mkSave").disabled = true;
    return A.api("/api/admin/market", {
      method: "PUT",
      body: formBody(),
    }).then(function (r) {
      $("mkSave").disabled = false;
      if (r.status === 401) { A.checkSession(); return r; }
      if (!r.ok) { msg.textContent = r.message || "儲存失敗"; return r; }
      formDirty = false;
      data = r; render();
      A.toast("已儲存擺攤資訊");
      return r;
    });
  }
  $("mkForm").addEventListener("submit", function (e) { e.preventDefault(); save(); });

  // ---------- QR Code ----------
  var url = location.origin + "/market";
  $("mkUrl").value = url;
  var qr = null;
  if (window.qrcode) {
    qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("mkQr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } else {
    $("mkQr").textContent = "QR Code 暫時無法顯示，請複製網址自行製作。";
    $("mkQrDl").hidden = true;
  }

  // 下載可列印的 PNG：上方標題、中間 QR Code、下方網址
  function qrImage() {
    var n = qr.getModuleCount();
    var W = 1200, pad = 110, size = W - pad * 2, cell = size / (n + 4);
    var H = 1560;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    var font = getComputedStyle(document.body).fontFamily || "sans-serif";
    g.fillStyle = "#3A2F4A"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "600 76px " + font; g.fillText("掃描取號", W / 2, 120);
    g.font = "40px " + font; g.fillStyle = "#6B5F7B"; g.fillText("阿綸涅亞 NIEIA", W / 2, 200);
    var top = 260;
    g.fillStyle = "#000";
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
      if (qr.isDark(r, k)) g.fillRect(Math.floor(pad + (k + 2) * cell), Math.floor(top + (r + 2) * cell), Math.ceil(cell), Math.ceil(cell));
    }
    g.font = "34px " + font; g.fillStyle = "#6B5F7B";
    g.fillText(url.replace(/^https?:\/\//, ""), W / 2, top + size + 70);
    g.fillText("用手機相機對準，就能看到排隊情況並取號", W / 2, top + size + 130);
    return c;
  }
  $("mkQrDl").addEventListener("click", function () {
    if (!qr) return;
    var b = this;
    b.disabled = true;
    qrImage().toBlob(function (blob) {
      b.disabled = false;
      if (!blob) { A.toast("下載失敗，請再試一次"); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "nieia-market-qr.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      A.toast("已下載 QR Code 圖片");
    }, "image/png");
  });
  $("mkCopy").addEventListener("click", function () {
    var b = this;
    var done = function () { b.textContent = "已複製"; setTimeout(function () { b.textContent = "複製網址"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { $("mkUrl").select(); });
    else $("mkUrl").select();
  });

  // ---------- 擺攤紀錄 ----------
  var WEEK = "日一二三四五六";
  var STATUS = { waiting: "等候中", serving: "服務中", done: "完成", skipped: "過號", cancelled: "已取消" };
  var downloaded = {}; // 這次打開後台下載過的場次，刪除時少問一句
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function day(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + "（" + WEEK[d.getDay()] + "）";
  }
  function hm(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function stamp(iso) { return iso ? day(iso).replace(/（.）/, "") + " " + hm(iso) : ""; }
  function sessionTitle(s) {
    return (day(s.startedAt) || "日期不明") + " " + (s.location || "地點未記錄");
  }

  function loadHistory() {
    return A.api("/api/admin/market/history").then(function (r) {
      if (r.status === 401) { A.checkSession(); return; }
      if (r.ok) renderHistory(r.sessions || []);
    });
  }

  function renderHistory(list) {
    var box = $("mkHistory");
    box.innerHTML = "";
    $("mkHCount").textContent = list.length ? "共 " + list.length + " 場" : "";
    if (!list.length) { box.appendChild(el("p", "hint", "還沒有擺攤紀錄。")); return; }
    list.forEach(function (s) { box.appendChild(historyRow(s)); });
  }

  function historyRow(s) {
    var row = el("div", "mk-h-row");
    var info = el("div", "q-info");
    info.appendChild(el("strong", null, sessionTitle(s)));
    var time = s.startedAt ? hm(s.startedAt) + (s.endedAt ? "–" + hm(s.endedAt) : "") : "";
    var meta = [];
    if (time) meta.push(time);
    if (s.current) meta.push("擺攤中");
    meta.push("取號 " + s.total + " 位");
    if (s.done) meta.push("完成 " + s.done);
    if (s.skipped) meta.push("過號 " + s.skipped);
    if (s.cancelled) meta.push("取消 " + s.cancelled);
    info.appendChild(el("span", null, meta.join("｜")));
    if (s.address) info.appendChild(el("span", null, s.address));
    row.appendChild(info);

    var detail = el("div", "mk-h-detail");
    detail.hidden = true;
    var tickets = null;
    function fetchTickets() {
      if (tickets) return Promise.resolve(tickets);
      return A.api("/api/admin/market/history/" + encodeURIComponent(s.id)).then(function (r) {
        if (r.status === 401) { A.checkSession(); return null; }
        if (!r.ok) { A.toast(r.message || "讀取失敗"); return null; }
        tickets = r.tickets || [];
        return tickets;
      });
    }

    var actions = el("div", "actions");
    var view = btn("查看名單", function (b) {
      if (!detail.hidden) { detail.hidden = true; b.textContent = "查看名單"; return; }
      b.disabled = true;
      fetchTickets().then(function (list) {
        b.disabled = false;
        if (!list) return;
        detail.innerHTML = "";
        if (!list.length) detail.appendChild(el("p", "hint", "這一場沒有人取號。"));
        list.forEach(function (t) { detail.appendChild(pastTicket(t)); });
        detail.hidden = false;
        b.textContent = "收起名單";
      });
    });
    var dl = btn("下載 Excel", function (b) {
      b.disabled = true;
      fetchTickets().then(function (list) {
        b.disabled = false;
        if (!list) return;
        downloadExcel(s, list);
        downloaded[s.id] = true;
      });
    });
    var delArmed = null;
    var del = btn("刪除", function (b) {
      if (s.current) { A.toast("這一場還在擺攤中，請先結束擺攤再刪除"); return; }
      if (!delArmed) {
        b.textContent = downloaded[s.id] ? "確定刪除？" : "還沒下載，確定刪除？";
        b.classList.add("confirm");
        delArmed = setTimeout(function () { delArmed = null; b.textContent = "刪除"; b.classList.remove("confirm"); }, 5000);
        return;
      }
      clearTimeout(delArmed); delArmed = null;
      b.disabled = true;
      A.api("/api/admin/market/history/" + encodeURIComponent(s.id), { method: "DELETE" }).then(function (r) {
        b.disabled = false;
        if (r.status === 401) { A.checkSession(); return; }
        if (!r.ok) { A.toast(r.message || "刪除失敗"); b.textContent = "刪除"; b.classList.remove("confirm"); return; }
        A.toast("已刪除 " + sessionTitle(s) + " 的紀錄");
        renderHistory(r.sessions || []);
        load();
      });
    });
    del.classList.add("danger");
    del.disabled = s.current;
    actions.appendChild(view); actions.appendChild(dl); actions.appendChild(del);
    row.appendChild(actions);
    row.appendChild(detail);
    return row;
  }

  function pastTicket(t) {
    var r = el("div", "q-row is-past");
    r.appendChild(el("span", "q-num", String(t.number)));
    var info = el("div", "q-info");
    info.appendChild(el("strong", null, t.name));
    var meta = [];
    if (t.service) meta.push(t.service + (t.price ? " " + t.price : ""));
    meta.push(STATUS[t.status] || t.status);
    meta.push(hm(t.createdAt) + " 取號");
    info.appendChild(el("span", null, meta.join("｜")));
    if (t.phone) {
      var tel = el("a", "q-tel", t.phone);
      tel.href = "tel:" + t.phone;
      info.appendChild(tel);
    }
    r.appendChild(info);
    return r;
  }

  function downloadExcel(s, list) {
    if (!window.nieiaXlsx) { A.toast("Excel 工具沒有載入，請重新整理後再試"); return; }
    var rows = [
      ["擺攤紀錄", sessionTitle(s)],
      ["攤位位置", s.address || ""],
      ["時間", s.startedAt ? stamp(s.startedAt) + (s.endedAt ? " – " + hm(s.endedAt) : "") : ""],
      ["取號人數", String(s.total), "完成 " + s.done + "｜過號 " + s.skipped + "｜取消 " + s.cancelled],
      [],
      ["號碼", "名字", "電話", "項目", "價格", "狀態", "取號時間", "叫號時間", "結束時間"],
    ];
    list.forEach(function (t) {
      rows.push([String(t.number), t.name, t.phone, t.service, t.price, STATUS[t.status] || t.status, stamp(t.createdAt), stamp(t.calledAt), stamp(t.doneAt)]);
    });
    var d = s.startedAt ? new Date(s.startedAt) : new Date();
    var name = "擺攤紀錄_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + (s.location ? "_" + s.location.replace(/[\\\/:*?"<>|\s]+/g, "") : "") + ".xlsx";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(window.nieiaXlsx("擺攤紀錄", rows, [8, 14, 14, 18, 12, 10, 18, 18, 18]));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    A.toast("已下載 " + name);
  }

  // ---------- 擺攤中每 15 秒自動更新排隊 ----------
  function startPolling() {
    if (timer) return;
    timer = setInterval(function () {
      var visible = !$("panel-market").hidden && !document.hidden;
      if (visible && data && data.market.active) load(true);
    }, 15000);
  }

  $("tab-market").addEventListener("click", function () { load().then(startPolling); loadHistory(); });
  document.addEventListener("nieia:dash", function () { load().then(startPolling); loadHistory(); });
})();
