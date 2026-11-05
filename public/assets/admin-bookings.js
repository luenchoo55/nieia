// 後台：預約管理
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;

  var STATUS = {
    pending_payment: ["等待匯款", "closed"],
    payment_reported: ["已回報匯款", "booked"],
    confirmed: ["等待療癒", "open"],
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
    if (b.status === "cancelled") {
      var r = b.refund;
      subject = "【阿綸涅亞 NIEIA】預約已取消：" + b.serviceName + " " + when;
      lines = [
        b.name + " 你好：",
        "",
        "這次的預約已經取消了。",
        "",
        "療癒項目：" + b.serviceName,
        "時段：" + when,
        "預約編號：" + b.ref,
      ];
      if (r && r.amount > 0) lines.push("退款金額：" + money(r.amount, b.currency) + "（" + r.date + " 退款）");
      if (r && r.note) lines.push("說明：" + r.note);
      lines.push("", "期待之後還有機會與你相見，有任何問題歡迎 IG 私訊 @nieia4928。", "", "阿綸");
    } else if (b.status === "confirmed" && b.completed) {
      var paid = b.paidAmount != null ? b.paidAmount : b.amount;
      subject = "【阿綸涅亞 NIEIA】療癒完成與收據：" + b.serviceName;
      lines = [
        b.name + " 你好：",
        "",
        "這次的「" + b.serviceName + "」已經完成了，謝謝你的信任。",
        "隨信附上這次的收據，請查收。",
        "",
        "療癒項目：" + b.serviceName,
        async ? null : "療癒日期：" + when,
        "完成日期：" + b.completed.date,
        paid != null ? "實收金額：" + money(paid, b.currency) : null,
        "收據編號：" + b.ref,
        "",
        "療癒後的幾天，請多喝水、好好休息，留意身心的變化。有任何感受或問題，歡迎 IG 私訊 @nieia4928。",
        "",
        "與光同在，一切如是。",
        "阿綸",
      ].filter(function (x) { return x !== null; });
    } else if (b.status === "confirmed") {
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
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(b.email || "") +
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
    if (filter === "confirmed") return b.status === "confirmed" && !b.completed;
    if (filter === "completed") return b.status === "confirmed" && !!b.completed;
    return b.status === filter;
  }

  // 日期排序：asc＝舊到新（↑）、desc＝新到舊（↓）；記在這台裝置上
  var sortDir = "asc";
  try { if (localStorage.getItem("nieia-booking-sort") === "desc") sortDir = "desc"; } catch (e) {}
  function syncSortBtn() {
    var btn = document.getElementById("bookingSort");
    if (!btn) return;
    btn.querySelector(".sort-arrow").textContent = sortDir === "asc" ? "↑" : "↓";
    btn.setAttribute("aria-label", sortDir === "asc" ? "依日期排序：舊到新，點一下改成新到舊" : "依日期排序：新到舊，點一下改成舊到新");
    btn.title = sortDir === "asc" ? "目前：舊 → 新" : "目前：新 → 舊";
  }
  syncSortBtn();
  document.getElementById("bookingSort").addEventListener("click", function () {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    try { localStorage.setItem("nieia-booking-sort", sortDir); } catch (e) {}
    syncSortBtn();
    render();
  });

  function render() {
    list.innerHTML = "";
    var todo = items.filter(function (b) { return b.status === "pending_payment" || b.status === "payment_reported"; }).length;
    document.getElementById("bookingCount").textContent = items.length ? "待處理 " + todo + " 筆" : "";
    var shown = items.filter(matches).sort(function (a, b) {
      var d = String(a.startAt).localeCompare(String(b.startAt));
      return sortDir === "asc" ? d : -d;
    });
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
    side.appendChild(el("span", "bc-amount", b.refund && b.refund.amount > 0 ? "退 " + money(b.refund.amount, b.currency) : money(b.amount, b.currency, b.priceMode)));
    if (manual) side.appendChild(el("span", "src-tag", "手動"));
    var st = b.status === "confirmed" && b.completed ? ["已完成", "done"] : STATUS[b.status] || [b.status, "closed"];
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
      c.appendChild(el("p", "bc-pay" + (b.completed ? " bc-done" : ""), b.completed ? "✓ 療癒已完成（" + b.completed.date + "）" : "療癒還沒完成，做完後按「標記完成」"));
    }
    if (b.refund) {
      var kept = (b.paidAmount != null ? b.paidAmount : b.amount || 0) - b.refund.amount;
      c.appendChild(el("p", "bc-pay bc-refunded",
        (b.refund.amount > 0 ? "已退款 " + money(b.refund.amount, b.currency) + "（" + b.refund.date + "）" : "取消，不退款") +
        (b.refund.amount > 0 && kept <= 0 ? "・全額退款" : "・留下 " + money(kept, b.currency) + " 算收入") +
        (b.refund.note ? "・" + b.refund.note : "")));
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
    if (!manual) row(dl, "付款地區", b.regionChosen === false ? "客人還沒選付款方式" : REGION[b.region]);
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

    // 按鈕：常用的放外面（收款／收據、寫信），其他收進「更多」選單
    var actions = el("div", "actions bc-status-actions");
    var payForm = b.status !== "cancelled" ? paidForm(b) : null;
    var refundForm = b.status === "confirmed" ? refundFormFor(b) : null;
    function showForm(f) {
      [payForm, refundForm].forEach(function (x) { if (x && x !== f) x.hidden = true; });
      if (!f) return;
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").select();
    }
    if (b.status === "confirmed") {
      var rcBtn = el("button", "primary-action", "收據");
      rcBtn.type = "button";
      rcBtn.addEventListener("click", function () { showReceipt(b); });
      actions.appendChild(rcBtn);
      if (!b.completed) {
        var doneBtn = el("button", "primary-action", "標記完成");
        doneBtn.type = "button";
        doneBtn.addEventListener("click", function () { setCompleted(b, true, doneBtn); });
        actions.appendChild(doneBtn);
      }
    } else if (b.status !== "cancelled") {
      var ok = el("button", "primary-action", "確認收款");
      ok.type = "button";
      ok.addEventListener("click", function () { showForm(payForm); });
      actions.appendChild(ok);
    }
    var write = el("a", "mail-btn", b.status === "confirmed" && b.completed ? "Gmail 寄收據" : "Gmail 寫信");
    write.href = gmailUrl(b);
    write.target = "_blank"; write.rel = "noopener";
    if (!b.email) write.title = "這筆預約沒有 Email，收件人請自己填（或用「編輯資料」補上）";
    write.addEventListener("click", function () {
      if (b.status === "confirmed" && b.completed) attachReceipt(b);
      else if (!b.email) A.toast("這筆預約沒有 Email，請在 Gmail 填收件人");
    });
    actions.appendChild(write);

    var more = el("details", "bc-more");
    more.appendChild(el("summary", null, "更多"));
    var menu = el("div", "bc-menu");
    function item(text, cls, fn) {
      var x = el("button", cls || null, text);
      x.type = "button";
      x.addEventListener("click", function () { fn(x); });
      menu.appendChild(x);
      return x;
    }
    item("複製信件內容", null, function (x) { var m = letter(b); copyText(m.subject + "\n\n" + m.body, x, "複製信件內容"); });
    if (b.email) item("複製 Email", null, function (x) { copyText(b.email, x, "複製 Email"); });
    if (b.status !== "cancelled") {
      item("編輯資料", null, function () { more.open = false; if (manual) openManual(b); else openWebEdit(b); });
    }
    if (b.status === "confirmed") {
      if (b.completed) item("改回還沒完成", null, function (x) { more.open = false; setCompleted(b, false, x); });
      item("修改實收金額", null, function () { more.open = false; showForm(payForm); });
      // 已收款：取消時一定要說退多少（可以是 0），收支報表才算得對
      item("取消並退款", "danger", function () { more.open = false; showForm(refundForm); });
    } else if (b.status !== "cancelled") {
      var armed = null;
      item("取消預約", "danger", function (x) {
        if (!armed) {
          x.classList.add("confirm");
          x.textContent = "確定取消？時段會重新開放";
          armed = setTimeout(function () { armed = null; x.classList.remove("confirm"); x.textContent = "取消預約"; }, 5000);
          return;
        }
        clearTimeout(armed);
        setStatus(b, "cancelled", x, "已取消預約");
      });
    }
    // 永久刪除：按兩次才會刪，收支報表裡這筆收入也會一起消失
    var delArmed = null;
    item("刪除資料", "danger", function (x) {
      if (!delArmed) {
        x.classList.add("confirm");
        x.textContent = b.status === "confirmed" ? "確定刪除？收支報表的這筆收入也會消失" : "確定永久刪除？刪除後無法復原";
        delArmed = setTimeout(function () { delArmed = null; x.classList.remove("confirm"); x.textContent = "刪除資料"; }, 5000);
        return;
      }
      clearTimeout(delArmed);
      x.disabled = true;
      A.api("/api/admin/bookings/" + b.id, { method: "DELETE" }).then(function (r) {
        x.disabled = false;
        if (r.status === 401) return A.checkSession();
        if (!r.ok) { A.toast(r.message || "刪除失敗"); return; }
        items = items.filter(function (it) { return it.id !== b.id; });
        delete expanded[b.id];
        render();
        A.toast("已刪除這筆預約" + (r.slotReopened ? "，時段已重新開放" : ""));
        document.dispatchEvent(new Event("nieia:slots"));
        if (window.NieiaOverview) window.NieiaOverview.reload();
      });
    });
    if (menu.childNodes.length) {
      more.appendChild(menu);
      actions.appendChild(more);
    }
    if (actions.childNodes.length) c.appendChild(actions);
    if (payForm) c.appendChild(payForm);
    if (refundForm) c.appendChild(refundForm);
    return wrap;
  }

  // 取消並退款：退款金額預設全額，可改成部分退款或 0；留下的部分照樣算收入
  function refundFormFor(b) {
    var paid = b.paidAmount != null ? b.paidAmount : b.amount;
    var unit = b.currency === "MYR" ? "RM" : "NT$";
    var f = el("form", "bc-paid bc-refund");
    f.hidden = true;
    f.noValidate = true;
    var amtLabel = el("label", "field");
    amtLabel.appendChild(el("span", null, "退款金額（" + unit + "）"));
    var amt = el("input");
    amt.type = "number"; amt.inputMode = "numeric"; amt.min = "0"; amt.step = "1";
    if (paid != null) amt.max = String(paid);
    amt.value = paid == null ? "0" : String(paid);
    amtLabel.appendChild(amt);
    f.appendChild(amtLabel);
    var dateLabel = el("label", "field");
    dateLabel.appendChild(el("span", null, "退款日期"));
    var date = el("input");
    date.type = "date";
    date.value = todayLocal();
    dateLabel.appendChild(date);
    f.appendChild(dateLabel);
    var noteLabel = el("label", "field bc-refund-note");
    noteLabel.appendChild(el("span", null, "原因（選填）"));
    var note = el("input");
    note.maxLength = 200;
    note.placeholder = "例如 客人臨時有事";
    noteLabel.appendChild(note);
    f.appendChild(noteLabel);
    var sum = el("p", "bc-refund-sum");
    f.appendChild(sum);
    function update() {
      var n = Number(amt.value);
      if (amt.value === "" || !Number.isInteger(n) || n < 0) { sum.textContent = "請填退款金額，不退款請填 0。"; return; }
      if (paid != null && n > paid) { sum.textContent = "退款金額不能超過實收 " + money(paid, b.currency) + "。"; return; }
      sum.textContent = n === 0 ? "不退款，" + money(paid, b.currency) + " 照樣算收入。"
        : paid != null && n === paid ? "全額退款，這筆收入會在退款日扣回來。"
        : "退 " + money(n, b.currency) + "，留下 " + money(paid - n, b.currency) + " 算收入。";
    }
    amt.addEventListener("input", update);
    update();
    var save = el("button", "btn btn-small bc-refund-btn", "確定取消並退款");
    save.type = "submit";
    f.appendChild(save);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = Number(amt.value);
      if (amt.value === "" || !Number.isInteger(n) || n < 0 || (paid != null && n > paid)) { amt.focus(); update(); return; }
      setStatus(b, "cancelled", save, n > 0 ? "已取消並記錄退款 " + money(n, b.currency) : "已取消（不退款）", { refund: { amount: n, date: date.value, note: note.value.trim() } });
    });
    return f;
  }

  // 收據：用收銀台同一份收據（圖片＋文字），單號是預約編號
  function showReceipt(b) {
    if (!window.NieiaReceipt) { A.toast("收據還在載入，請稍候再試"); return; }
    var rc = receiptData(b);
    if (!rc) { A.toast("請先填寫實收金額"); return; }
    window.NieiaReceipt.show(rc, null);
  }

  function receiptData(b) {
    var paid = b.paidAmount != null ? b.paidAmount : b.amount;
    if (paid == null) return null;
    var when = b.mode === "async" && b.source !== "manual" ? "" : prettyDate(b.date, b.weekday) + (b.start ? " " + b.start + (b.end ? "–" + b.end : "") : "");
    var BOOKING_STATUS = { pending_payment: "待確認", payment_reported: "待確認", confirmed: b.completed ? "已完成" : "已成立", cancelled: "已取消" };
    var isPaid = b.status === "confirmed" || (b.status === "cancelled" && b.paidAmount != null);
    var payStatus = b.status === "cancelled" && b.refund
      ? "已退款 " + money(b.refund.amount, b.currency)
      : isPaid ? "已付款" : b.status === "payment_reported" ? "已回報匯款，待確認" : "尚未付款";
    var method = b.paymentReport && b.paymentReport.last5 ? "匯款（末五碼 " + b.paymentReport.last5 + "）" : "";
    return {
      no: b.ref,
      at: b.confirmedAt || b.updatedAt || b.createdAt,
      method: method,
      currency: b.currency,
      date: when,
      bookingStatus: BOOKING_STATUS[b.status] || "",
      paymentStatus: payStatus,
      paid: isPaid,
      customer: {
        name: b.name,
        contacts: [["IG", b.instagram ? "@" + b.instagram : ""], ["Email", b.email], ["電話／LINE", b.phone]],
      },
      lines: [{ name: b.serviceName, price: paid, qty: 1, amount: paid }],
      subtotal: paid,
      total: paid,
      adjustments: [],
      gifts: [],
    };
  }

  // 完成信附上收據：Gmail 連結沒辦法夾帶檔案，所以把收據圖片複製到剪貼簿（在信裡 Ctrl+V 貼上）
  function attachReceipt(b) {
    var rc = window.NieiaReceipt && window.NieiaReceipt.blob ? receiptData(b) : null;
    if (!rc) { A.toast("收據無法產生，請用「收據」按鈕下載後再附上"); return; }
    var fail = function () { A.toast("收據沒辦法自動複製，請用「收據」按鈕存下圖片再附上"); };
    try {
      if (!navigator.clipboard || !window.ClipboardItem) { fail(); return; }
      navigator.clipboard.write([new ClipboardItem({ "image/png": window.NieiaReceipt.blob(rc) })])
        .then(function () { A.toast("收據已複製：在 Gmail 信件裡按 Ctrl+V 貼上"); }, fail);
    } catch (e) { fail(); }
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

  function setCompleted(b, done, btn) {
    btn.disabled = true;
    A.api("/api/admin/bookings/" + b.id + "/complete", { method: "POST", body: { done: done } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { A.toast(r.message || "更新失敗"); return; }
      if (!done) delete b.completed;
      Object.assign(b, r.item);
      render();
      A.toast(done ? "已標記完成，移到「已完成」" : "已改回還沒完成");
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

  // 「更多」選單：點外面或按 Esc 就收起來
  document.addEventListener("click", function (e) {
    document.querySelectorAll(".bc-more[open]").forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".bc-more[open]").forEach(function (d) { d.open = false; });
  });

  // ---------- 手動新增個案 ----------
  var manualModal = null, services = null, editingId = null;
  var MANUAL_HINT = null;
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
  // b 有值＝編輯這筆手動個案；沒有＝新增
  function openManual(b) {
    if (!manualModal) manualModal = window.NieiaUI.modal("manualModal");
    if (MANUAL_HINT == null) MANUAL_HINT = $("manualHint").textContent;
    resetManual();
    editingId = b ? b.id : null;
    $("manualTitle").textContent = b ? "編輯個案" : "手動新增個案";
    $("manualHint").textContent = b ? "記錯了可以在這裡改。收款狀態、實收金額和取消請用卡片上的按鈕。" : MANUAL_HINT;
    $("mbPaidRow").hidden = !!b;
    $("mbBtn").textContent = b ? "儲存修改" : "新增個案";
    manualModal.open();
    loadServices().then(function () {
      if (b) {
        $("mbName").value = b.name || "";
        $("mbIg").value = b.instagram ? "@" + b.instagram : "";
        $("mbPhone").value = b.phone || "";
        $("mbEmail").value = b.email || "";
        var sel = $("mbService");
        if (b.serviceId && !sel.querySelector("option[value=\"" + b.serviceId + "\"]")) {
          var o = el("option", null, (b.serviceName || "原本的項目") + "（已刪除）"); o.value = b.serviceId; sel.appendChild(o);
        }
        sel.value = b.serviceId || "";
        $("mbMode").value = b.mode || "remote";
        $("mbDate").value = b.date || "";
        $("mbStart").value = b.start || "";
        $("mbEnd").value = b.end || "";
        $("mbCurrency").value = b.currency === "MYR" ? "MYR" : "TWD";
        $("mbAmount").value = b.amount == null ? "" : b.amount;
        $("mbNote").value = b.note || "";
      }
      $("mbName").focus();
    });
  }
  $("manualOpen").addEventListener("click", function () { openManual(null); });
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
    if (!editingId && body.paid && body.amount === "") { msg.textContent = "已收款的話請填金額。"; $("mbAmount").focus(); return; }
    msg.textContent = "";
    var btn = $("mbBtn");
    btn.disabled = true;
    if (editingId) {
      var eid = editingId;
      A.api("/api/admin/bookings/" + encodeURIComponent(eid), { method: "PUT", body: body }).then(function (r) {
        btn.disabled = false;
        if (r.status === 401) return A.checkSession();
        if (!r.ok) { msg.textContent = r.message || "儲存失敗，請再試一次。"; return; }
        items = items.map(function (x) { return x.id === eid ? r.item : x; });
        items.sort(function (a, b) { return String(a.startAt).localeCompare(String(b.startAt)); });
        expanded[eid] = true;
        render();
        manualModal.close();
        A.toast("已更新 " + r.item.name + " 的個案");
        if (window.NieiaOverview) window.NieiaOverview.reload();
      });
      return;
    }
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

  // ---------- 編輯客人自己預約的個案 ----------
  var webModal = null, webEditing = null;
  function slotLabel(x) {
    var p = x.date.split("-");
    return Number(p[1]) + "/" + Number(p[2]) + "（" + x.weekday + "）" + x.start + (x.end ? "–" + x.end : "");
  }
  function syncWebCustom() {
    var custom = $("weSlot").value === "custom" && !$("weSlotRow").hidden;
    document.querySelectorAll("#webEditModal .we-custom").forEach(function (f) { f.hidden = !custom; });
  }
  function openWebEdit(b) {
    if (!webModal) webModal = window.NieiaUI.modal("webEditModal");
    webEditing = b;
    $("webEditForm").reset();
    $("weMsg").textContent = "";
    $("weName").value = b.name || "";
    $("weIg").value = b.instagram ? "@" + b.instagram : "";
    $("weEmail").value = b.email || "";
    $("weNote").value = b.note || "";
    var async = b.mode === "async";
    $("weModeRow").hidden = async;
    $("weSlotRow").hidden = async;
    if (!async) $("weMode").value = b.mode === "onsite" ? "onsite" : "remote";
    var sel = $("weSlot");
    sel.innerHTML = "";
    sel.appendChild(el("option", null, "維持原本：" + slotLabel(b))).value = "keep";
    sel.appendChild(el("option", null, "自訂日期時間（不占用可預約時段）")).value = "custom";
    $("weDate").value = b.date || "";
    $("weStart").value = b.start || "";
    $("weEnd").value = b.end || "";
    syncWebCustom();
    webModal.open();
    $("weName").focus();
    if (async) return;
    var loading = el("option", null, "載入可預約時段中…"); loading.disabled = true; sel.appendChild(loading);
    A.api("/api/admin/slots").then(function (r) {
      loading.remove();
      if (!r.ok || webEditing !== b) return;
      var open = (r.slots || []).filter(function (x) { return x.status === "open"; });
      if (!open.length) { var none = el("option", null, "（沒有其他開放中的時段）"); none.disabled = true; sel.appendChild(none); return; }
      var g = el("optgroup"); g.label = "換到其他開放中的時段";
      open.forEach(function (x) { var o = el("option", null, slotLabel(x)); o.value = x.id; g.appendChild(o); });
      sel.appendChild(g);
    });
  }
  $("weSlot").addEventListener("change", syncWebCustom);
  $("webEditForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = webEditing, msg = $("weMsg");
    if (!b) return;
    var v = $("weSlot").value;
    var time = b.mode === "async" || v === "keep" ? { kind: "keep" }
      : v === "custom" ? { kind: "custom", date: $("weDate").value, start: $("weStart").value, end: $("weEnd").value }
      : { kind: "slot", slotId: v };
    var body = { name: $("weName").value.trim(), instagram: $("weIg").value.trim(), email: $("weEmail").value.trim(), note: $("weNote").value.trim(), mode: $("weMode").value, time: time };
    if (!body.name) { msg.textContent = "請填寫客人名字。"; $("weName").focus(); return; }
    if (!body.email) { msg.textContent = "請填寫 Email。"; $("weEmail").focus(); return; }
    if (time.kind === "custom" && (!time.date || !time.start)) { msg.textContent = "請填寫日期和開始時間。"; return; }
    msg.textContent = "";
    var btn = $("weBtn");
    btn.disabled = true;
    A.api("/api/admin/bookings/" + encodeURIComponent(b.id) + "/web", { method: "PUT", body: body }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { msg.textContent = r.message || "儲存失敗，請再試一次。"; return; }
      items = items.map(function (x) { return x.id === b.id ? r.item : x; });
      items.sort(function (a, c) { return String(a.startAt).localeCompare(String(c.startAt)); });
      expanded[b.id] = true;
      render();
      webModal.close();
      A.toast("已更新 " + r.item.name + " 的預約" + (r.slotReopened ? "，原本的時段已重新開放" : ""));
      if (window.NieiaOverview) window.NieiaOverview.reload();
      document.dispatchEvent(new Event("nieia:slots"));
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
