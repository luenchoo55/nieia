// 線上簽到：學員在上課當天輸入姓名或 Email 完成簽到
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  var key = new URLSearchParams(location.search).get("k") || "";
  var info = null;

  function prettyDate(date) {
    var p = date.split("-");
    var w = WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()];
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + w + "）";
  }
  function api(method, body) {
    var init = { method: method, headers: {}, credentials: "same-origin" };
    if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch("/api/checkin/" + encodeURIComponent(key), init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) { d.status = res.status; return d; });
    }, function () { return { ok: false, status: 0, message: "連不上網站，請確認網路後再試。" }; });
  }
  function fail(message) {
    $("cLoading").hidden = true;
    $("cError").hidden = false;
    if (message) $("cErrorMsg").textContent = message;
  }

  function show(r) {
    info = r;
    var s = r.session;
    $("cSession").textContent = (s.total > 1 ? "第 " + s.index + " 堂・" : "") + prettyDate(s.date) + (s.start ? " " + s.start + (s.end ? "–" + s.end : "") : "");
    $("cTitle").textContent = r.title;
    $("cTitleEn").textContent = r.titleEn || "";
    $("cTitleEn").hidden = !r.titleEn;
    if (r.roomUrl) { $("cRoom").href = r.roomUrl; $("cRoomBox").hidden = false; }
    if (!r.open) {
      $("cClosed").hidden = false;
      $("cClosed").textContent = "簽到只在上課當天（" + prettyDate(s.date) + "）開放，到時候再點開這一頁就可以了。";
      $("cName").disabled = true;
      $("cBtn").disabled = true;
    }
    $("cLoading").hidden = true;
    $("cView").hidden = false;
    if (r.open) $("cName").focus();
  }

  if (!/^[a-z2-9]{10}$/.test(key)) { fail(); return; }
  api("GET").then(function (r) {
    if (!r.ok) return fail(r.status === 404 ? null : r.message);
    show(r);
  });

  $("cForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("cName").value.trim();
    var msg = $("cMsg");
    if (!name) { msg.textContent = "請填寫報名時的姓名或 Email。"; $("cName").focus(); return; }
    msg.textContent = "";
    var btn = $("cBtn");
    btn.disabled = true;
    btn.textContent = "簽到中…";
    api("POST", { name: name, website: $("cWebsite").value }).then(function (r) {
      btn.disabled = false;
      btn.textContent = "簽到";
      if (!r.ok) { msg.textContent = r.message || "簽到失敗，請再試一次。"; return; }
      $("cForm").hidden = true;
      $("cDone").hidden = false;
      $("cDoneTitle").textContent = r.name + "，" + (r.already ? "你已經簽到過了" : "簽到完成");
      $("cDoneText").textContent = info.session.total > 1
        ? "已記錄第 " + info.session.index + " 堂的出席。全部 " + info.session.total + " 堂都出席，課程結束後就會收到結業證書。"
        : "已記錄這堂課的出席，課程結束後就會收到結業證書。";
      if (info.roomUrl) $("cRoom").classList.replace("btn-ghost", "btn-primary");
    });
  });
})();
