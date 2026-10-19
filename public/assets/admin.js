(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  var STATUS_TEXT = { open: "可預約", closed: "暫停", booked: "已預約" };
  var slots = [];
  var filter = "all";

  // ---------- 小工具 ----------
  function api(path, options) {
    options = options || {};
    var init = { method: options.method || "GET", headers: {}, credentials: "same-origin" };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        data.status = res.status;
        return data;
      });
    }, function () {
      return { ok: false, status: 0, message: "連不上網站，請確認網路後再試。" };
    });
  }

  var toastTimer;
  function toast(text) {
    var el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function show(view) {
    ["loading", "setupView", "loginView", "dashView"].forEach(function (id) { $(id).hidden = id !== view; });
    $("logoutBtn").hidden = view !== "dashView";
  }

  function busy(btn, on, text) {
    btn.disabled = on;
    if (text) btn.textContent = text;
  }

  // 台灣／馬來西亞時間（UTC+8）的今天
  function todayLocal() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(date, n) {
    var d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayOf(date) { return WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()]; }
  function prettyDate(date) {
    var p = date.split("-");
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + weekdayOf(date) + "）";
  }
  function plusMinutes(time, mins) {
    var p = time.split(":");
    var total = Number(p[0]) * 60 + Number(p[1]) + mins;
    if (total >= 24 * 60) return null;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  // ---------- 登入 ----------
  function checkSession() {
    show("loading");
    api("/api/admin/me").then(function (r) {
      if (r.configured === false) return show("setupView");
      if (!r.ok) { $("loading").textContent = r.message || "暫時無法連線，請重新整理。"; return; }
      if (r.loggedIn) { show("dashView"); loadSlots(); document.dispatchEvent(new Event("nieia:dash")); }
      else { show("loginView"); $("password").focus(); }
    });
  }

  $("revealBtn").addEventListener("click", function () {
    var input = $("password");
    var on = input.type === "password";
    input.type = on ? "text" : "password";
    this.textContent = on ? "隱藏" : "顯示";
    this.setAttribute("aria-pressed", String(on));
  });

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("password").value;
    var msg = $("loginMsg");
    if (!pw) { msg.textContent = "請輸入後台密碼。"; return; }
    msg.textContent = "";
    busy($("loginBtn"), true, "登入中…");
    api("/api/admin/login", { method: "POST", body: { password: pw } }).then(function (r) {
      busy($("loginBtn"), false, "登入");
      if (r.ok) {
        $("password").value = "";
        show("dashView");
        loadSlots();
        document.dispatchEvent(new Event("nieia:dash"));
        toast("已登入");
      } else {
        msg.textContent = r.message || "登入失敗，請再試一次。";
        $("password").select();
      }
    });
  });

  $("logoutBtn").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).then(function () {
      slots = [];
      show("loginView");
      toast("已登出");
    });
  });

  // ---------- 新增時段 ----------
  var dateInput = $("slotDate");
  dateInput.min = todayLocal();
  dateInput.value = addDays(todayLocal(), 1);

  function currentEnd() {
    var start = $("slotStart").value;
    var len = $("slotLength").value;
    if (!start) return null;
    if (len === "custom") return $("slotEnd").value || null;
    return plusMinutes(start, Number(len));
  }

  function updatePreview() {
    var custom = $("slotLength").value === "custom";
    $("endField").hidden = !custom;
    var date = dateInput.value, start = $("slotStart").value, end = currentEnd();
    var weeks = Number($("slotWeeks").value);
    var out = "";
    if (date && start && end && end > start) {
      out = "將新增：" + prettyDate(date) + " " + start + "–" + end;
      if (weeks > 1) out += "，之後每週同一時間，共 " + weeks + " 個時段，最後一次是 " + prettyDate(addDays(date, (weeks - 1) * 7));
    }
    $("slotPreview").textContent = out;
  }
  ["slotDate", "slotStart", "slotLength", "slotEnd", "slotWeeks"].forEach(function (id) {
    $(id).addEventListener("input", updatePreview);
    $(id).addEventListener("change", updatePreview);
  });
  updatePreview();

  $("slotForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("slotMsg");
    var date = dateInput.value, start = $("slotStart").value, end = currentEnd();
    if (!date) { msg.textContent = "請選擇日期。"; return; }
    if (!start) { msg.textContent = "請選擇開始時間。"; return; }
    if (!end) { msg.textContent = $("slotLength").value === "custom" ? "請選擇結束時間。" : "療程會超過午夜，請選擇早一點的開始時間。"; return; }
    if (end <= start) { msg.textContent = "結束時間要晚於開始時間。"; return; }
    msg.textContent = "";
    busy($("slotBtn"), true, "新增中…");
    api("/api/admin/slots", { method: "POST", body: { date: date, start: start, end: end, weeks: Number($("slotWeeks").value) } }).then(function (r) {
      busy($("slotBtn"), false, "新增時段");
      if (r.status === 401) return checkSession();
      if (!r.ok) { msg.textContent = r.message || "新增失敗，請再試一次。"; return; }
      var text = "已新增 " + r.created.length + " 個時段";
      if (r.skipped && r.skipped.length) {
        text += "，略過 " + r.skipped.length + " 個重疊的時段";
        msg.textContent = "略過的時段：" + r.skipped.join("、");
      }
      toast(text);
      if (r.slots) { slots = r.slots; render(); } else loadSlots();
    });
  });

  // ---------- 時段列表 ----------
  function loadSlots() {
    $("slotList").innerHTML = '<p class="empty glass">載入中…</p>';
    api("/api/admin/slots").then(function (r) {
      if (r.status === 401) return checkSession();
      if (!r.ok) { $("slotList").innerHTML = ""; $("slotList").appendChild(emptyNote(r.message || "暫時無法載入時段，請重新整理。")); return; }
      slots = r.slots;
      render();
    });
  }

  function emptyNote(text) {
    var p = document.createElement("p");
    p.className = "empty glass";
    p.textContent = text;
    return p;
  }

  function render() {
    var list = $("slotList");
    list.innerHTML = "";
    var shown = slots.filter(function (s) { return filter === "all" || s.status === filter; });
    var openCount = slots.filter(function (s) { return s.status === "open"; }).length;
    $("slotCount").textContent = slots.length ? "共 " + slots.length + " 個，可預約 " + openCount + " 個" : "";

    if (!shown.length) {
      list.appendChild(emptyNote(slots.length ? "這個分類目前沒有時段。" : "還沒有任何時段。用上面的表單新增第一個可預約時段吧。"));
      return;
    }

    var byDate = {};
    var order = [];
    shown.forEach(function (s) {
      if (!byDate[s.date]) { byDate[s.date] = []; order.push(s.date); }
      byDate[s.date].push(s);
    });

    order.forEach(function (date) {
      var day = document.createElement("div");
      day.className = "day";
      var h = document.createElement("h3");
      h.textContent = prettyDate(date);
      day.appendChild(h);
      byDate[date].forEach(function (s) { day.appendChild(slotRow(s)); });
      list.appendChild(day);
    });
  }

  function slotRow(s) {
    var row = document.createElement("div");
    row.className = "slot glass" + (s.status === "closed" ? " is-closed" : "");

    var info = document.createElement("div");
    info.className = "info";
    var time = document.createElement("span");
    time.className = "time";
    time.textContent = s.start + "–" + s.end;
    var pill = document.createElement("span");
    pill.className = "pill " + s.status;
    pill.textContent = STATUS_TEXT[s.status] || s.status;
    info.appendChild(time);
    info.appendChild(pill);

    var actions = document.createElement("div");
    actions.className = "actions";
    if (s.status !== "booked") {
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = s.status === "open" ? "暫停" : "重新開放";
      toggle.addEventListener("click", function () { setStatus(s, s.status === "open" ? "closed" : "open", toggle); });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "刪除";
      var armed = null;
      del.addEventListener("click", function () {
        if (!armed) {
          del.classList.add("confirm");
          del.textContent = "確定刪除？";
          armed = setTimeout(function () { armed = null; del.classList.remove("confirm"); del.textContent = "刪除"; }, 4000);
          return;
        }
        clearTimeout(armed);
        removeSlot(s, del);
      });
      actions.appendChild(toggle);
      actions.appendChild(del);
    }

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  }

  function setStatus(s, status, btn) {
    btn.disabled = true;
    api("/api/admin/slots/" + s.id, { method: "PATCH", body: { status: status } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return checkSession();
      if (!r.ok) { toast(r.message || "更新失敗"); return; }
      s.status = status;
      render();
      toast(status === "open" ? "已重新開放" : "已暫停，客人看不到這個時段");
    });
  }

  function removeSlot(s, btn) {
    btn.disabled = true;
    api("/api/admin/slots/" + s.id, { method: "DELETE" }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return checkSession();
      if (!r.ok) { toast(r.message || "刪除失敗"); return; }
      slots = slots.filter(function (x) { return x.id !== s.id; });
      render();
      toast("已刪除");
    });
  }

  $("statusFilter").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-status]");
    if (!btn) return;
    filter = btn.getAttribute("data-status");
    this.querySelectorAll("[data-status]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    render();
  });

  // 給療癒項目與商品管理使用
  // 預約與時段在同一頁：切回這頁或預約狀態改變時，重新載入時段
  $("tab-bookings").addEventListener("click", loadSlots);
  document.addEventListener("nieia:slots", loadSlots);

  window.NieiaAdmin = { api: api, toast: toast, checkSession: checkSession };

  checkSession();
})();
