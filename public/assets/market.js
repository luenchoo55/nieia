// 擺攤排隊頁：顯示叫號、取號、追蹤自己的號碼
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "nieia-ticket";
  var POLL = 15000;
  var market = null;
  var ticket = null; // { id, token }
  var lastStatus = null;
  var baseTitle = document.title;

  function api(path, options) {
    options = options || {};
    var init = { method: options.method || "GET", headers: {} };
    if (options.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) { d.status = res.status; return d; });
    }, function () { return { ok: false, message: "連不上網站，請確認網路後再試。" }; });
  }
  function est(minutes) {
    if (!minutes) return "不用等";
    if (minutes < 60) return "約 " + minutes + " 分鐘";
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return "約 " + h + " 小時" + (m ? " " + m + " 分鐘" : "");
  }

  // ---------- 號碼保存在這支手機 ----------
  function loadTicket() {
    var p = new URLSearchParams(location.search);
    if (p.get("ticket") && p.get("t")) return { id: p.get("ticket"), token: p.get("t") };
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (err) { return null; }
  }
  function saveTicket(t) {
    ticket = t;
    try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch (err) { /* 無痕模式 */ }
    try {
      history.replaceState(null, "", t ? "/market?ticket=" + encodeURIComponent(t.id) + "&t=" + encodeURIComponent(t.token) : "/market");
    } catch (err) { /* 舊瀏覽器 */ }
  }

  // ---------- 擺攤狀態 ----------
  function renderMarket() {
    $("mLoading").hidden = true;
    if (!market || !market.active) {
      $("mClosed").hidden = false;
      $("mOpen").hidden = true;
      return;
    }
    $("mClosed").hidden = true;
    $("mOpen").hidden = false;
    $("mLocation").textContent = market.location;
    $("mAddress").textContent = market.address || "";
    $("mHours").textContent = market.hours || "";
    $("mNote").hidden = !market.note;
    $("mNote").textContent = market.note || "";
    var ul = $("mServices");
    ul.innerHTML = "";
    (market.services || []).forEach(function (s) {
      var li = document.createElement("li");
      var left = document.createElement("div");
      left.className = "ms-name";
      var name = document.createElement("strong");
      name.textContent = s.name;
      left.appendChild(name);
      var meta = [];
      if (s.minutes) meta.push("約 " + s.minutes + " 分鐘");
      if (s.desc) meta.push(s.desc);
      if (meta.length) { var m = document.createElement("small"); m.textContent = meta.join("｜"); left.appendChild(m); }
      li.appendChild(left);
      if (s.price) { var b = document.createElement("span"); b.textContent = s.price; li.appendChild(b); }
      ul.appendChild(li);
    });
    ul.hidden = !market.services || !market.services.length;
    $("mServing").textContent = market.serving != null ? market.serving + " 號" : "—";
    $("mWaiting").textContent = market.waiting;
    $("mEst").textContent = est(market.estMinutes);

    var sel = $("kService");
    var has = market.services && market.services.length;
    $("kServiceField").hidden = !has;
    if (has && sel.options.length !== market.services.length + 1) {
      sel.innerHTML = "";
      var none = document.createElement("option");
      none.value = ""; none.textContent = "到攤位再決定";
      sel.appendChild(none);
      market.services.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.name; o.textContent = s.name + (s.price || s.minutes ? "（" + [s.price, s.minutes ? s.minutes + " 分鐘" : ""].filter(Boolean).join("，") + "）" : "");
        sel.appendChild(o);
      });
    }
    $("takePaused").hidden = market.accepting;
    $("takeBtn").disabled = !market.accepting;
  }

  // ---------- 自己的號碼 ----------
  var STATUS = {
    waiting: function (t) { return t.ahead ? "前面還有 " + t.ahead + " 位，預估等候" + est(t.estMinutes) + "。可以先去逛逛，快輪到時再回來。" : "下一位就是你了，請在攤位附近稍候。"; },
    serving: function () { return "輪到你了！請到攤位找阿綸。"; },
    done: function () { return "謝謝你今天來到攤位，願光與你同在。"; },
    skipped: function () { return "已經過號了。如果你還在附近，請直接到攤位告訴阿綸。"; },
    cancelled: function () { return "這個號碼已經取消。"; },
    ended: function () { return "這次擺攤已經結束，謝謝你。"; },
  };

  function renderTicket(t) {
    var view = $("tView");
    if (!t) { view.hidden = true; $("takeForm").hidden = false; return; }
    view.hidden = false;
    view.classList.toggle("is-called", t.status === "serving");
    $("tNumber").textContent = t.number;
    $("tName").textContent = t.name + (t.service ? "｜" + t.service : "");
    $("tStatus").textContent = (STATUS[t.status] || STATUS.done)(t);
    var active = t.status === "waiting";
    $("tCancel").hidden = !active;
    $("tAgain").hidden = active || t.status === "serving";
    $("takeForm").hidden = active || t.status === "serving";

    if (t.status === "serving" && lastStatus !== "serving") {
      document.title = "輪到你了｜" + baseTitle;
      try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (err) { /* 不支援震動 */ }
    } else if (t.status !== "serving") {
      document.title = baseTitle;
    }
    lastStatus = t.status;
  }

  function refresh() {
    return api("/api/market").then(function (r) {
      market = r.ok ? r.market : market;
      renderMarket();
      if (!ticket) { renderTicket(null); return; }
      return api("/api/market/tickets/" + encodeURIComponent(ticket.id) + "?t=" + encodeURIComponent(ticket.token)).then(function (tr) {
        if (tr.ok) renderTicket(tr.ticket);
        else if (tr.status === 404) { saveTicket(null); renderTicket(null); }
      });
    });
  }

  // ---------- 取號 ----------
  $("takeForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("takeMsg");
    var name = $("kName").value.trim();
    if (!name) { msg.textContent = "請填寫名字或暱稱，叫號時會用到。"; return; }
    msg.textContent = "";
    var btn = $("takeBtn");
    btn.disabled = true; btn.textContent = "取號中…";
    api("/api/market/tickets", {
      method: "POST",
      body: { name: name, phone: $("kPhone").value, service: $("kService").value, website: $("kWebsite").value },
    }).then(function (r) {
      btn.disabled = false; btn.textContent = "取號";
      if (!r.ok) { msg.textContent = r.message || "取號失敗，請再試一次。"; refresh(); return; }
      saveTicket({ id: r.ticket.id, token: r.ticket.token });
      renderTicket(r.ticket);
      refresh();
      window.scrollTo({ top: $("tView").offsetTop - 16, behavior: "smooth" });
    });
  });

  var armed = null;
  $("tCancel").addEventListener("click", function () {
    var btn = this;
    if (!armed) {
      btn.textContent = "確定取消？";
      armed = setTimeout(function () { armed = null; btn.textContent = "取消這個號碼"; }, 4000);
      return;
    }
    clearTimeout(armed); armed = null;
    btn.disabled = true;
    api("/api/market/tickets/" + encodeURIComponent(ticket.id) + "/cancel?t=" + encodeURIComponent(ticket.token), { method: "POST" }).then(function (r) {
      btn.disabled = false; btn.textContent = "取消這個號碼";
      if (!r.ok && r.status !== 409) return;
      refresh();
    });
  });
  $("tAgain").addEventListener("click", function () {
    saveTicket(null);
    renderTicket(null);
    $("kName").focus();
  });

  ticket = loadTicket();
  if (ticket) saveTicket(ticket);
  refresh();
  setInterval(function () { if (!document.hidden) refresh(); }, POLL);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
