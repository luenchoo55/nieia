// 後台：預約管理
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;

  var STATUS = {
    pending_payment: ["等待匯款", "closed"],
    payment_reported: ["已回報匯款", "booked"],
    confirmed: ["已成立", "open"],
    cancelled: ["已取消", "closed"],
  };
  var REGION = { TW: "台灣", MY: "馬來西亞" };
  var EXTRA_LABELS = {
    practiced: "曾習修擴大療癒", departedName: "亡者全名", relation: "與客人的關係",
    birthName: "出生時的完整姓名", birthDate: "出生日期",
    petName: "毛孩名字", species: "種類", petAge: "毛孩年齡", questions: "想溝通的問題",
  };
  var items = [];
  var filter = "todo";
  var list = document.getElementById("bookingList");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function money(amount, currency, mode) {
    if (mode === "inquiry") return "隨喜";
    if (amount == null) return "金額待告知";
    return (currency === "MYR" ? "RM " : "NT$") + Number(amount).toLocaleString("en-US");
  }
  function prettyDate(date, weekday) {
    var p = date.split("-");
    return Number(p[1]) + " 月 " + Number(p[2]) + " 日（" + weekday + "）";
  }

  // 依預約狀態準備好回信內容，打開郵件 App
  function mailto(b) {
    var when = prettyDate(b.date, b.weekday) + " " + b.start + "–" + b.end;
    var fee = b.priceMode === "inquiry" ? "隨喜服務" : money(b.amount, b.currency, b.priceMode);
    var onsite = b.mode === "onsite";
    var how = onsite ? "現場進行（地點：＿＿＿＿）" : "IG 視訊（請先追蹤並私訊 @nieia4928）";
    var subject, lines;
    if (b.status === "confirmed") {
      subject = "【阿綸涅亞 NIEIA】預約確認：" + b.serviceName + " " + when;
      lines = [
        b.name + " 你好：",
        "",
        "已經收到你的款項，這次的預約正式成立，期待與你相見。",
        "",
        "療癒項目：" + b.serviceName,
        "時段：" + when,
        "進行方式：" + how,
        "預約編號：" + b.ref,
        "",
        "需要改期請於 24 小時前告知。",
        "",
        "阿綸",
      ];
    } else {
      subject = "【阿綸涅亞 NIEIA】已收到你的預約：" + b.serviceName + " " + when;
      lines = [
        b.name + " 你好：",
        "",
        "謝謝你的預約，以下是預約內容：",
        "",
        "療癒項目：" + b.serviceName,
        "時段：" + when,
        "費用：" + fee,
        "預約編號：" + b.ref,
        "",
        b.paymentReport ? "已看到你回報的匯款（末五碼 " + b.paymentReport.last5 + "），核對後會再通知你。" : "完成匯款後，請在預約頁面回報匯款末五碼，阿綸確認收款後預約就正式成立。",
        onsite ? "療程在現場進行，地點：＿＿＿＿。" : "療程當天以 IG 視訊進行，請先追蹤並私訊 @nieia4928。",
        "",
        "阿綸",
      ];
    }
    return "mailto:" + encodeURIComponent(b.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
  }

  function copyEmail(b, btn) {
    var done = function () { btn.textContent = "已複製"; setTimeout(function () { btn.textContent = "複製 Email"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(b.email).then(done, function () {});
  }

  function load() {
    if (!items.length) { list.innerHTML = ""; list.appendChild(el("p", "empty glass", "載入中…")); }
    A.api("/api/admin/bookings").then(function (r) {
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { list.innerHTML = ""; list.appendChild(el("p", "empty glass", r.message || "暫時無法載入預約。")); return; }
      items = r.items;
      render();
    });
  }

  function matches(b) {
    if (filter === "all") return true;
    if (filter === "todo") return b.status === "pending_payment" || b.status === "payment_reported";
    return b.status === filter;
  }

  function render() {
    list.innerHTML = "";
    var todo = items.filter(function (b) { return b.status === "pending_payment" || b.status === "payment_reported"; }).length;
    document.getElementById("bookingCount").textContent = items.length ? "待處理 " + todo + " 筆" : "";
    var shown = items.filter(matches);
    if (!shown.length) {
      list.appendChild(el("p", "empty glass", items.length ? "這個分類目前沒有預約。" : "還沒有任何預約。客人在預約頁送出後，就會出現在這裡。"));
      return;
    }
    shown.forEach(function (b) { list.appendChild(card(b)); });
  }

  function row(dl, label, value) {
    if (value == null || value === "") return;
    var w = el("div");
    w.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (value instanceof Node) dd.appendChild(value); else dd.textContent = value;
    w.appendChild(dd);
    dl.appendChild(w);
  }

  function card(b) {
    var c = el("article", "booking-card glass" + (b.status === "cancelled" ? " is-closed" : ""));
    var head = el("div", "bc-head");
    var when = el("div", "bc-when");
    when.appendChild(el("span", "time", b.start + "–" + b.end));
    when.appendChild(el("span", "bc-date", prettyDate(b.date, b.weekday)));
    head.appendChild(when);
    var st = STATUS[b.status] || [b.status, "closed"];
    head.appendChild(el("span", "pill " + st[1], st[0]));
    c.appendChild(head);

    var main = el("p", "bc-main");
    main.appendChild(el("strong", null, b.name));
    main.appendChild(document.createTextNode("　" + b.serviceName + (b.mode === "onsite" ? "（現場）" : "") + "　" + money(b.amount, b.currency, b.priceMode)));
    c.appendChild(main);

    if (b.paymentReport) {
      c.appendChild(el("p", "bc-pay", "已回報匯款：" + b.paymentReport.paidDate + "，末五碼 " + b.paymentReport.last5 + (b.paymentReport.payerName ? "，" + b.paymentReport.payerName : "")));
    }

    var details = el("details", "bc-details");
    details.appendChild(el("summary", null, "客人資料"));
    var dl = el("dl", "summary");
    row(dl, "預約編號", b.ref);
    var ig = el("a", null, "@" + b.instagram);
    ig.href = "https://www.instagram.com/" + encodeURIComponent(b.instagram) + "/";
    ig.target = "_blank"; ig.rel = "noopener";
    row(dl, "IG", ig);
    row(dl, "Email", b.email);
    row(dl, "居住地", REGION[b.region]);
    row(dl, "年齡", b.age);
    row(dl, "性別", b.gender);
    row(dl, "療癒原因", (b.reasons || []).concat(b.otherReason ? [b.otherReason] : []).join("、"));
    Object.keys(b.extra || {}).forEach(function (k) {
      var v = b.extra[k];
      if (k === "practiced") v = v === "yes" ? "有" : "沒有";
      row(dl, EXTRA_LABELS[k] || k, v);
    });
    row(dl, "想說的話", b.note);
    details.appendChild(dl);
    c.appendChild(details);

    var mail = el("div", "actions mail-actions");
    var write = el("a", "mail-btn", "寫信給客人");
    write.href = mailto(b);
    mail.appendChild(write);
    var copy = el("button", null, "複製 Email");
    copy.type = "button";
    copy.addEventListener("click", function () { copyEmail(b, copy); });
    mail.appendChild(copy);
    mail.appendChild(el("span", "bc-email", b.email));
    c.appendChild(mail);

    if (b.status !== "cancelled") {
      var actions = el("div", "actions");
      if (b.status !== "confirmed") {
        var ok = el("button", "primary-action", "確認收款");
        ok.type = "button";
        ok.addEventListener("click", function () { setStatus(b, "confirmed", ok, "已確認收款，預約成立"); });
        actions.appendChild(ok);
      }
      var cancel = el("button", "danger", "取消預約");
      cancel.type = "button";
      var armed = null;
      cancel.addEventListener("click", function () {
        if (!armed) {
          cancel.classList.add("confirm");
          cancel.textContent = "確定取消？時段會重新開放";
          armed = setTimeout(function () { armed = null; cancel.classList.remove("confirm"); cancel.textContent = "取消預約"; }, 5000);
          return;
        }
        clearTimeout(armed);
        setStatus(b, "cancelled", cancel, "已取消預約");
      });
      actions.appendChild(cancel);
      c.appendChild(actions);
    }
    return c;
  }

  function setStatus(b, status, btn, doneText) {
    btn.disabled = true;
    A.api("/api/admin/bookings/" + b.id, { method: "PATCH", body: { status: status } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { A.toast(r.message || "更新失敗"); return; }
      Object.assign(b, r.item);
      render();
      A.toast(doneText + (r.slotReopened ? "，時段已重新開放" : ""));
    });
  }

  document.getElementById("bookingFilter").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-bstatus]");
    if (!btn) return;
    filter = btn.getAttribute("data-bstatus");
    this.querySelectorAll("[data-bstatus]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === btn)); });
    render();
  });
  document.getElementById("tab-bookings").addEventListener("click", load);
  document.addEventListener("nieia:dash", load);
})();
