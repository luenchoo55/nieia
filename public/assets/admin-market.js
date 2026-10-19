// 後台：擺攤模式
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var timer = null;
  var formDirty = false;

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

    if (!formDirty) {
      $("mkLocation").value = m.location || "";
      $("mkAddress").value = m.address || "";
      $("mkHours").value = m.hours || "";
      $("mkMinutes").value = m.minutesPer || 15;
      $("mkNote").value = m.note || "";
      $("mkServices").value = (m.services || []).map(function (s) { return s.price ? s.name + "｜" + s.price : s.name; }).join("\n");
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

  ["mkLocation", "mkAddress", "mkHours", "mkMinutes", "mkServices", "mkNote"].forEach(function (id) {
    $(id).addEventListener("input", function () { formDirty = true; });
  });
  function save() {
    var msg = $("mkMsg");
    if (!$("mkLocation").value.trim()) { msg.textContent = "請填寫地點名稱。"; return Promise.resolve(null); }
    msg.textContent = "";
    $("mkSave").disabled = true;
    return A.api("/api/admin/market", {
      method: "PUT",
      body: {
        location: $("mkLocation").value, address: $("mkAddress").value, hours: $("mkHours").value,
        minutesPer: Number($("mkMinutes").value), services: $("mkServices").value, note: $("mkNote").value,
      },
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
  if (window.qrcode) {
    var qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("mkQr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } else {
    $("mkQr").textContent = "QR Code 暫時無法顯示，請複製網址自行製作。";
  }
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
