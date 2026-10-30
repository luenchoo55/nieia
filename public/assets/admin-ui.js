// 後台共用：小工具、彈窗、個案筆記
// 個案筆記只存在後台的 caseNotes，前台與通知信都讀不到
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;

  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function money(amount, currency) {
    if (amount == null) return "未填";
    return (currency === "MYR" ? "RM " : "NT$") + Number(amount).toLocaleString("en-US");
  }
  function today() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function prettyDate(date) {
    if (!date) return "";
    var p = date.split("-");
    return Number(p[1]) + "/" + Number(p[2]) + "（" + WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()] + "）";
  }
  function fullDate(date) {
    if (!date) return "";
    var p = date.split("-");
    return p[0] + "/" + Number(p[1]) + "/" + Number(p[2]);
  }
  // 點兩下才執行（例如刪除），第一下先變成「確定？」
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
  function guard(r) {
    if (r.status === 401) { A.checkSession(); return false; }
    if (!r.ok) { A.toast(r.message || "操作失敗，請再試一次。"); return false; }
    return true;
  }
  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // ---------- 彈窗 ----------
  var openModals = [];
  function modal(id) {
    var m = document.getElementById(id);
    function close() {
      m.hidden = true;
      openModals = openModals.filter(function (x) { return x !== api; });
      if (!openModals.length) document.documentElement.classList.remove("modal-open");
      if (api.onClose) api.onClose();
    }
    var api = {
      el: m,
      open: function () {
        m.hidden = false;
        if (openModals.indexOf(api) < 0) openModals.push(api);
        document.documentElement.classList.add("modal-open");
        var panel = m.querySelector(".ws-modal-panel");
        if (panel) panel.scrollTop = 0;
        var c = m.querySelector("[data-close]");
        if (c) c.focus();
      },
      close: close,
      onClose: null,
    };
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest("[data-close]")) close(); });
    return api;
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openModals.length) openModals[openModals.length - 1].close();
  });

  // ---------- 個案筆記 ----------
  // opts: { bookingId, date }；items 有給就直接顯示，沒給就依 bookingId 載入
  function mountNotes(host, opts, items, onChange) {
    host.innerHTML = "";
    host.classList.add("notes");
    var listEl = el("div", "note-list");
    host.appendChild(listEl);

    function draw(list) {
      listEl.innerHTML = "";
      if (!list.length) listEl.appendChild(el("p", "hint", "還沒有筆記。"));
      list.forEach(function (n) { listEl.appendChild(noteRow(n, list)); });
    }

    function noteRow(n, list) {
      var row = el("article", "note");
      var head = el("div", "note-head");
      head.appendChild(el("span", "note-date", fullDate(n.date)));
      var acts = el("div", "note-acts");
      acts.appendChild(button("編輯", "mini", function () { edit(); }));
      var del = button("刪除", "mini danger");
      armed(del, "刪除", "確定刪除？", function () {
        del.disabled = true;
        A.api("/api/admin/notes/" + n.id, { method: "DELETE" }).then(function (r) {
          del.disabled = false;
          if (!guard(r)) return;
          list.splice(list.indexOf(n), 1);
          draw(list);
          A.toast("已刪除筆記");
          if (onChange) onChange();
        });
      });
      acts.appendChild(del);
      head.appendChild(acts);
      row.appendChild(head);
      row.appendChild(el("p", "note-text", n.text));

      function edit() {
        row.innerHTML = "";
        var f = form(n, function (body) {
          return A.api("/api/admin/notes/" + n.id, { method: "PATCH", body: body }).then(function (r) {
            if (!guard(r)) return false;
            Object.assign(n, r.item);
            draw(list);
            A.toast("已儲存筆記");
            if (onChange) onChange();
            return true;
          });
        }, function () { draw(list); });
        row.appendChild(f);
      }
      return row;
    }

    function form(n, submit, cancel) {
      var f = el("form", "note-form");
      f.noValidate = true;
      var ta = el("textarea");
      ta.rows = 5; ta.maxLength = 10000;
      ta.placeholder = "這次療癒的狀況、感受、下次要注意的事…（只有後台看得到）";
      ta.value = n ? n.text : "";
      ta.setAttribute("aria-label", "筆記內容");
      var date = el("input");
      date.type = "date";
      date.value = (n && n.date) || opts.date || today();
      date.setAttribute("aria-label", "筆記日期");
      var bar = el("div", "note-bar");
      bar.appendChild(date);
      var save = el("button", "btn btn-primary btn-small", n ? "儲存" : "新增筆記");
      save.type = "submit";
      bar.appendChild(save);
      if (cancel) bar.appendChild(button("取消", "btn btn-ghost btn-small", cancel));
      f.appendChild(ta);
      f.appendChild(bar);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!ta.value.trim()) { ta.focus(); return; }
        save.disabled = true;
        submit({ text: ta.value, date: date.value }).then(function (ok) {
          save.disabled = false;
          if (ok && !n) ta.value = "";
        });
      });
      setTimeout(function () { if (n) ta.focus(); }, 0);
      return f;
    }

    var list = items ? items.slice() : null;
    var addForm = form(null, function (body) {
      body.bookingId = opts.bookingId;
      return A.api("/api/admin/notes", { method: "POST", body: body }).then(function (r) {
        if (!guard(r)) return false;
        list.unshift(r.item);
        draw(list);
        A.toast("已新增筆記");
        if (onChange) onChange();
        return true;
      });
    });
    host.appendChild(addForm);

    if (list) draw(list);
    else {
      listEl.appendChild(el("p", "hint", "載入中…"));
      A.api("/api/admin/notes?booking=" + encodeURIComponent(opts.bookingId)).then(function (r) {
        if (!guard(r)) { listEl.innerHTML = ""; return; }
        list = r.items;
        draw(list);
      });
    }
  }

  window.NieiaUI = {
    el: el, button: button, money: money, today: today, prettyDate: prettyDate, fullDate: fullDate,
    armed: armed, guard: guard, download: download, modal: modal, mountNotes: mountNotes,
  };
})();
