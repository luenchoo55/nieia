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

  // 依預約狀態準備好回信的主旨與內容
  function letter(b) {
    var when = b.mode === "async" ? "不需預約時段，完成後傳送作品" : prettyDate(b.date, b.weekday) + " " + b.start + "–" + b.end;
    var fee = b.priceMode === "inquiry" ? "隨喜服務" : money(b.amount, b.currency, b.priceMode);
    var onsite = b.mode === "onsite";
    var async = b.mode === "async";
    var how = onsite ? "現場進行（地點：＿＿＿＿）" : async ? "線上完成，不需視訊，完成後會傳送作品給你" : "IG 視訊（請先追蹤並私訊 @nieia4928）";
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
        onsite ? "療程在現場進行，地點：＿＿＿＿。" : async ? "這個項目由阿綸在線上完成，不需要視訊，完成後會傳送作品給你。" : "療程當天以 IG 視訊進行，請先追蹤並私訊 @nieia4928。",
        "",
        "阿綸",
      ];
    }
    return { subject: subject, body: lines.join("\n") };
  }

  // 電腦沒有設定郵件 App 時 mailto: 會沒反應，所以直接開 Gmail 的寫信畫面
  function gmailUrl(b) {
    var m = letter(b);
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(b.email) +
      "&su=" + encodeURIComponent(m.subject) + "&body=" + encodeURIComponent(m.body);
  }

  function copyText(text, btn, label) {
    var done = function () { btn.textContent = "已複製"; setTimeout(function () { btn.textContent = label; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { A.toast("無法複製，請手動選取"); });
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

  // 每筆預約平常只顯示一行摘要，點一下展開細節（展開狀態在重新整理列表時保留）
  var expanded = {};
  function shortDate(date, weekday) {
    var p = date.split("-");
    return Number(p[1]) + "/" + Number(p[2]) + "（" + weekday + "）";
  }

  function card(b) {
    var wrap = el("article", "booking-card glass" + (b.status === "cancelled" ? " is-closed" : ""));
    var manual = b.source === "manual";
    var open = !!expanded[b.id];

    var head = el("button", "bc-summary");
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    var when = el("span", "bc-when");
    when.appendChild(el("span", "bc-date", shortDate(b.date, b.weekday)));
    when.appendChild(el("span", "time", b.start ? b.start + (b.end ? "–" + b.end : "") : b.mode === "async" ? "不需時段" : "未定時間"));
    head.appendChild(when);
    var who = el("span", "bc-who");
    who.appendChild(el("strong", null, b.name));
    who.appendChild(el("span", "bc-svc", b.serviceName + (b.mode === "onsite" ? "（現場）" : "")));
    head.appendChild(who);
    var side = el("span", "bc-side");
    side.appendChild(el("span", "bc-amount", money(b.amount, b.currency, b.priceMode)));
    if (manual) side.appendChild(el("span", "src-tag", "手動"));
    var st = STATUS[b.status] || [b.status, "closed"];
    side.appendChild(el("span", "pill " + st[1], st[0]));
    var chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chev.setAttribute("viewBox", "0 0 24 24");
    chev.setAttribute("class", "bc-chev");
    chev.setAttribute("aria-hidden", "true");
    chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    side.appendChild(chev);
    head.appendChild(side);
    wrap.appendChild(head);

    var c = el("div", "bc-body");
    c.hidden = !open;
    wrap.appendChild(c);
    head.addEventListener("click", function () {
      open = !open;
      if (open) expanded[b.id] = true; else delete expanded[b.id];
      head.setAttribute("aria-expanded", String(open));
      c.hidden = !open;
    });

    var main = el("p", "bc-main");
    main.appendChild(document.createTextNode(b.serviceName + (b.mode === "onsite" ? "（現場）" : b.mode === "async" ? "（不需視訊）" : "")));
    main.appendChild(el("span", "bc-date", "　" + prettyDate(b.date, b.weekday) + (b.mode === "async" && !manual ? " 預約" : "") + (manual ? "・手動新增" : "")));
    c.appendChild(main);

    if (b.status === "confirmed") {
      var paid = b.paidAmount != null ? b.paidAmount : b.amount;
      c.appendChild(el("p", "bc-pay", "實收：" + (paid == null ? "還沒填（記帳需要，請按「修改實收金額」）" : money(paid, b.currency))));
    }
    if (b.paymentReport) {
      c.appendChild(el("p", "bc-pay", "已回報匯款：" + b.paymentReport.paidDate + "，末五碼 " + b.paymentReport.last5 + (b.paymentReport.payerName ? "，" + b.paymentReport.payerName : "")));
    }

    var details = el("details", "bc-details");
    details.appendChild(el("summary", null, "客人資料"));
    var dl = el("dl", "summary");
    row(dl, "預約編號", b.ref);
    if (b.instagram) {
      var ig = el("a", null, "@" + b.instagram);
      ig.href = "https://www.instagram.com/" + encodeURIComponent(b.instagram) + "/";
      ig.target = "_blank"; ig.rel = "noopener";
      row(dl, "IG", ig);
    }
    row(dl, "電話／LINE", b.phone);
    row(dl, "Email", b.email);
    if (!manual) row(dl, "居住地", REGION[b.region]);
    row(dl, "年齡", b.age);
    row(dl, "性別", b.gender);
    row(dl, "療癒原因", (b.reasons || []).concat(b.otherReason ? [b.otherReason] : []).join("、"));
    Object.keys(b.extra || {}).forEach(function (k) {
      var v = b.extra[k];
      if (k === "practiced") v = v === "yes" ? "有" : "沒有";
      row(dl, EXTRA_LABELS[k] || k, v);
    });
    row(dl, manual ? "備註" : "想說的話", b.note);
    details.appendChild(dl);
    c.appendChild(details);

    // 個案筆記：只有後台看得到，打開時才載入
    if (b.status !== "cancelled") {
      var notes = el("details", "bc-details");
      notes.appendChild(el("summary", null, "個案筆記"));
      var noteHost = el("div");
      notes.appendChild(noteHost);
      notes.addEventListener("toggle", function () {
        if (notes.open && !noteHost.childNodes.length && window.NieiaUI) window.NieiaUI.mountNotes(noteHost, { bookingId: b.id, date: b.date });
      });
      c.appendChild(notes);
    }

    var reply = el("div", "bc-reply");
    var to = el("p", "bc-email");
    to.appendChild(el("span", null, "回覆客人"));
    to.appendChild(document.createTextNode(b.email));
    reply.appendChild(to);
    var mail = el("div", "actions mail-actions");
    var write = el("a", "mail-btn", "用 Gmail 寫信");
    write.href = gmailUrl(b);
    write.target = "_blank"; write.rel = "noopener";
    mail.appendChild(write);
    var copyLetter = el("button", null, "複製信件內容");
    copyLetter.type = "button";
    copyLetter.addEventListener("click", function () { var m = letter(b); copyText(m.subject + "\n\n" + m.body, copyLetter, "複製信件內容"); });
    mail.appendChild(copyLetter);
    var copy = el("button", null, "複製 Email");
    copy.type = "button";
    copy.addEventListener("click", function () { copyText(b.email, copy, "複製 Email"); });
    mail.appendChild(copy);
    reply.appendChild(mail);
    if (b.email) c.appendChild(reply); // 手動新增的個案可能沒有 Email

    if (b.status !== "cancelled") {
      var actions = el("div", "actions bc-status-actions");
      var payForm = paidForm(b);
      if (b.status !== "confirmed") {
        var ok = el("button", "primary-action", "確認收款");
        ok.type = "button";
        ok.addEventListener("click", function () { payForm.hidden = !payForm.hidden; if (!payForm.hidden) payForm.querySelector("input").focus(); });
        actions.appendChild(ok);
      } else {
        var rcBtn = el("button", "primary-action", "收據");
        rcBtn.type = "button";
        rcBtn.addEventListener("click", function () { showReceipt(b); });
        actions.appendChild(rcBtn);
        var fix = el("button", null, "修改實收金額");
        fix.type = "button";
        fix.addEventListener("click", function () { payForm.hidden = !payForm.hidden; if (!payForm.hidden) payForm.querySelector("input").focus(); });
        actions.appendChild(fix);
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
      c.appendChild(payForm);
    }
    return wrap;
  }

  // 收據：用收銀台同一份收據（圖片＋文字），單號是預約編號
  function showReceipt(b) {
    if (!window.NieiaReceipt) { A.toast("收據還在載入，請稍候再試"); return; }
    var paid = b.paidAmount != null ? b.paidAmount : b.amount;
    if (paid == null) { A.toast("請先填寫實收金額"); return; }
    var when = prettyDate(b.date, b.weekday) + (b.start ? " " + b.start + (b.end ? "–" + b.end : "") : "");
    window.NieiaReceipt.show({
      no: b.ref,
      at: b.confirmedAt || b.updatedAt || b.createdAt,
      method: "",
      currency: b.currency,
      rows: [["客人", b.name], ["療程日期", when]],
      lines: [{ name: b.serviceName, price: paid, qty: 1, amount: paid }],
      subtotal: paid,
      total: paid,
      adjustments: [],
      gifts: [],
    }, null);
  }

  // 確認收款時填實收金額（記帳用）；有固定價格就先帶入
  function paidForm(b) {
    var f = el("form", "bc-paid");
    f.hidden = true;
    f.noValidate = true;
    var label = el("label", "field");
    label.appendChild(el("span", null, "實收金額（" + (b.currency === "MYR" ? "RM" : "NT$") + "）"));
    var input = el("input");
    input.type = "number"; input.inputMode = "numeric"; input.min = "0"; input.step = "1";
    var paid = b.paidAmount != null ? b.paidAmount : b.amount;
    input.value = paid == null ? "" : paid;
    input.placeholder = b.priceMode === "inquiry" ? "隨喜收到的金額" : "";
    label.appendChild(input);
    f.appendChild(label);
    var save = el("button", "btn btn-primary btn-small", b.status === "confirmed" ? "儲存" : "確認收款");
    save.type = "submit";
    f.appendChild(save);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (input.value === "") { A.toast("請填寫實收金額"); input.focus(); return; }
      if (b.status === "confirmed") savePaid(b, input.value, save);
      else setStatus(b, "confirmed", save, "已確認收款，預約成立", { paidAmount: input.value });
    });
    return f;
  }

  function savePaid(b, value, btn) {
    btn.disabled = true;
    A.api("/api/admin/bookings/" + b.id, { method: "PATCH", body: { paidAmount: value } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { A.toast(r.message || "儲存失敗"); return; }
      Object.assign(b, r.item);
      render();
      A.toast("已更新實收金額");
    });
  }

  function setStatus(b, status, btn, doneText, extra) {
    btn.disabled = true;
    A.api("/api/admin/bookings/" + b.id, { method: "PATCH", body: Object.assign({ status: status }, extra) }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { A.toast(r.message || "更新失敗"); return; }
      Object.assign(b, r.item);
      render();
      A.toast(doneText + (r.slotReopened ? "，時段已重新開放" : ""));
      // 時段列表在同一頁，跟著更新
      document.dispatchEvent(new Event("nieia:slots"));
      if (window.NieiaOverview) window.NieiaOverview.reload();
    });
  }

  // ---------- 手動新增個案 ----------
  var manualModal = null, services = null;
  function $(id) { return document.getElementById(id); }
  function todayLocal() {
    return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  }
  function selectedService() {
    var id = $("mbService").value;
    return (services || []).find(function (s) { return s.id === id; });
  }
  // 選了項目或換幣別：帶入進行方式與固定價格（之後仍可自己改）
  function fillFromService() {
    $("mbMsg").textContent = "";
    var s = selectedService();
    if (!s) return;
    if (s.mode && s.mode !== "both") $("mbMode").value = s.mode;
    if (s.priceMode === "fixed") {
      var p = $("mbCurrency").value === "MYR" ? s.priceMyr : s.priceTwd;
      $("mbAmount").value = p == null ? "" : p;
    }
  }
  function loadServices() {
    if (services) return Promise.resolve();
    $("mbService").innerHTML = "<option value=\"\">載入中…</option>";
    return A.api("/api/admin/services").then(function (r) {
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { $("mbService").innerHTML = "<option value=\"\">無法載入，請重新整理</option>"; return; }
      services = r.items;
      var sel = $("mbService");
      sel.innerHTML = "";
      sel.appendChild(el("option", null, "請選擇")).value = "";
      services.forEach(function (s) {
        var o = el("option", null, s.name + (s.published ? "" : "（未上架）"));
        o.value = s.id;
        sel.appendChild(o);
      });
    });
  }
  function resetManual() {
    $("manualForm").reset();
    $("mbDate").value = todayLocal();
    $("mbPaid").checked = true;
    $("mbMsg").textContent = "";
  }
  $("manualOpen").addEventListener("click", function () {
    if (!manualModal) manualModal = window.NieiaUI.modal("manualModal");
    resetManual();
    manualModal.open();
    loadServices().then(function () { $("mbName").focus(); });
  });
  $("mbService").addEventListener("change", fillFromService);
  $("mbCurrency").addEventListener("change", fillFromService);
  $("manualForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("mbMsg");
    var body = {
      name: $("mbName").value.trim(),
      instagram: $("mbIg").value.trim(),
      phone: $("mbPhone").value.trim(),
      email: $("mbEmail").value.trim(),
      serviceId: $("mbService").value,
      mode: $("mbMode").value,
      date: $("mbDate").value,
      start: $("mbStart").value,
      end: $("mbEnd").value,
      currency: $("mbCurrency").value,
      amount: $("mbAmount").value,
      paid: $("mbPaid").checked,
      note: $("mbNote").value.trim(),
    };
    if (!body.name) { msg.textContent = "請填寫客人名字。"; $("mbName").focus(); return; }
    if (!body.serviceId) { msg.textContent = "請選擇療癒項目。"; $("mbService").focus(); return; }
    if (!body.date) { msg.textContent = "請選擇日期。"; return; }
    if (body.end && !body.start) { msg.textContent = "有結束時間的話也請填開始時間。"; return; }
    if (body.paid && body.amount === "") { msg.textContent = "已收款的話請填金額。"; $("mbAmount").focus(); return; }
    msg.textContent = "";
    var btn = $("mbBtn");
    btn.disabled = true;
    A.api("/api/admin/bookings", { method: "POST", body: body }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { msg.textContent = r.message || "新增失敗，請再試一次。"; return; }
      items.push(r.item);
      expanded[r.item.id] = true; // 新增後直接展開，方便寫筆記
      items.sort(function (a, b) { return String(a.startAt).localeCompare(String(b.startAt)); });
      // 切到能看到這筆的分類
      filter = r.item.status === "confirmed" ? "confirmed" : "todo";
      document.querySelectorAll("#bookingFilter [data-bstatus]").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-bstatus") === filter)); });
      render();
      manualModal.close();
      A.toast("已新增 " + r.item.name + " 的個案");
      if (window.NieiaOverview) window.NieiaOverview.reload();
    });
  });

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
