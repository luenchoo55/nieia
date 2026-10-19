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
  function call(path, method, body) {
    return A.api(path, { method: method || "GET", body: body }).then(function (r) {
      if (r.status === 401) { A.checkSession(); return r; }
      if (r.ok && r.market) { data = r; render(); }
      return r;
    });
  }
  function load() { return call("/api/admin/market"); }

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
      items = (m.services || []).map(function (s) { return { name: s.name, minutes: s.minutes || null, price: s.price || "", desc: s.desc || "" }; });
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
      if (r.ok) A.toast("已結束擺攤，首頁提醒已關閉");
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
    if (items.some(function (x, k) { return k !== skip && x.name === it.name; })) return "已經有同名的項目了。";
    return "";
  }
  function readItem(name, min, price, desc) {
    var m = min.value.trim();
    return { name: name.value.trim(), minutes: m ? Number(m) : null, price: price.value.trim(), desc: desc.value.trim() };
  }
  function input(label, value, opts) {
    var f = el("label", "field" + (opts.wide ? " wide" : ""));
    f.appendChild(el("span", null, label));
    var i = el("input");
    i.type = opts.type || "text";
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
    var p = input("價格", it.price, { max: 30, placeholder: "NT$200 或 隨喜" });
    var d = input("說明（客人會看到）", it.desc, { max: 120, wide: true });
    [n, mi, p, d].forEach(function (x) { row.appendChild(x.field); });
    var msg = el("p", "form-msg wide");
    msg.setAttribute("role", "status");
    row.appendChild(msg);
    var acts = el("div", "edit-actions wide");
    var ok = el("button", "btn", "儲存修改"); ok.type = "button";
    var cancel = el("button", "btn btn-ghost", "取消"); cancel.type = "button";
    ok.addEventListener("click", function () {
      var next = readItem(n.input, mi.input, p.input, d.input);
      var err = validItem(next, i);
      if (err) { msg.textContent = err; return; }
      items[i] = next;
      editing = -1;
      renderItems();
      saveItems("已更新項目");
    });
    cancel.addEventListener("click", function () { editing = -1; renderItems(); });
    [n, mi, p, d].forEach(function (x) {
      x.input.addEventListener("input", function () { msg.textContent = ""; });
      x.input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); ok.click(); }
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
      if (it.price) meta.push(it.price);
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
    var name = $("mkIName").value.trim();
    var min = $("mkIMin").value.trim();
    if (!name) { msg.textContent = "請填寫項目名稱。"; $("mkIName").focus(); return; }
    var err = validItem({ name: name, minutes: min ? Number(min) : null }, -1);
    if (err) { msg.textContent = err; return; }
    if (items.length >= 20) { msg.textContent = "最多 20 個項目。"; return; }
    msg.textContent = "";
    items.push({ name: name, minutes: min ? Number(min) : null, price: $("mkIPrice").value.trim(), desc: $("mkIDesc").value.trim() });
    ["mkIName", "mkIMin", "mkIPrice", "mkIDesc"].forEach(function (id) { $(id).value = ""; });
    renderItems();
    saveItems("已新增項目");
    $("mkIName").focus();
  });
  ["mkIName", "mkIMin", "mkIPrice", "mkIDesc"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("mkIAdd").click(); } });
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
    };
  }

  ["mkLocation", "mkAddress", "mkHours", "mkMinutes", "mkNote"].forEach(function (id) {
    $(id).addEventListener("input", function () { formDirty = true; });
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

  // ---------- 擺攤中每 15 秒自動更新排隊 ----------
  function startPolling() {
    if (timer) return;
    timer = setInterval(function () {
      var visible = !$("panel-market").hidden && !document.hidden;
      if (visible && data && data.market.active) load();
    }, 15000);
  }

  $("tab-market").addEventListener("click", function () { load().then(startPolling); });
  document.addEventListener("nieia:dash", function () { load().then(startPolling); });
})();
