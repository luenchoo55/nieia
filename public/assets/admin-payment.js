// 後台：匯款方式（台灣、馬來西亞各自可以有好幾種，預約療癒與工作坊報名共用）
(function () {
  "use strict";
  var A = window.NieiaAdmin;
  if (!A) return;

  var $ = function (id) { return document.getElementById(id); };
  var REGIONS = [["TW", "台灣"], ["MY", "馬來西亞"]];
  var MAX = 8;
  var data = null;
  var loaded = false;
  var uid = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el("button", cls || null, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function field(label, control, cls) {
    var f = el("label", "field" + (cls ? " " + cls : ""));
    f.htmlFor = control.id;
    f.appendChild(el("span", null, label));
    f.appendChild(control);
    return f;
  }
  function control(tag, value, attrs, onInput) {
    var c = el(tag);
    c.id = "pay-" + (++uid);
    c.value = value || "";
    Object.keys(attrs || {}).forEach(function (k) { c.setAttribute(k, attrs[k]); });
    c.addEventListener("input", function () { onInput(c.value); });
    return c;
  }

  function methodCard(region, list, m, i) {
    var card = el("fieldset", "pay-card glass");
    card.appendChild(el("legend", null, (m.name || "新的匯款方式") + (m.enabled ? "" : "（不顯示）")));
    var grid = el("div", "field-grid");
    grid.appendChild(field("名稱", control("input", m.name, { maxlength: "40", placeholder: "例如 銀行轉帳、iPass Money 或 LINE Pay" }, function (v) { m.name = v; }), "wide"));
    grid.appendChild(field("內容（一行一項，「標籤：內容」）", control("textarea", m.details, { rows: "4", maxlength: "600", placeholder: "銀行：玉山銀行（代碼 808）\n帳號：0417968137184\n戶名：朱〇綸" }, function (v) { m.details = v; }), "wide"));
    grid.appendChild(field("按鈕文字（選填）", control("input", m.linkLabel, { maxlength: "20", placeholder: "例如 加入 LINE 好友" }, function (v) { m.linkLabel = v; })));
    grid.appendChild(field("按鈕連結（選填）", control("input", m.linkUrl, { maxlength: "300", inputmode: "url", placeholder: "https://…" }, function (v) { m.linkUrl = v.trim(); })));
    var on = el("input");
    on.type = "checkbox"; on.id = "pay-" + (++uid); on.checked = m.enabled !== false;
    on.addEventListener("change", function () { m.enabled = on.checked; render(); });
    var onField = el("label", "field check");
    onField.htmlFor = on.id;
    onField.appendChild(on);
    onField.appendChild(el("span", null, "顯示給客人"));
    grid.appendChild(onField);
    card.appendChild(grid);

    var acts = el("div", "editor-actions");
    var up = button("上移", "mini", function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); render(); });
    up.disabled = i === 0;
    var down = button("下移", "mini", function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); render(); });
    down.disabled = i === list.length - 1;
    acts.appendChild(up);
    acts.appendChild(down);
    acts.appendChild(button("刪除", "mini danger", function () { list.splice(i, 1); render(); }));
    card.appendChild(acts);
    return card;
  }

  function render() {
    var host = $("payRegions");
    host.innerHTML = "";
    REGIONS.forEach(function (r, ri) {
      var list = data[r[0]] = data[r[0]] || [];
      var sec = el("section", "pay-region");
      sec.appendChild(el("h3", null, r[1] + "（居住在" + r[1] + "的客人會看到）"));
      list.forEach(function (m, i) { sec.appendChild(methodCard(r[0], list, m, i)); });
      var add = button("新增" + r[1] + "匯款方式", "btn btn-ghost btn-small", function () {
        list.push({ name: "", details: "", linkLabel: "", linkUrl: "", enabled: true });
        render();
        var cards = $("payRegions").querySelectorAll(".pay-region")[ri].querySelectorAll(".pay-card");
        cards[cards.length - 1].querySelector("input").focus();
      });
      add.disabled = list.length >= MAX;
      sec.appendChild(add);
      host.appendChild(sec);
    });
  }

  function load() {
    A.api("/api/admin/payment").then(function (r) {
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { $("payRegions").innerHTML = ""; $("payRegions").appendChild(el("p", "empty glass", r.message || "讀取失敗，請重新整理。")); return; }
      loaded = true;
      data = r.regions;
      render();
    });
  }

  $("payForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!data) return;
    var msg = $("payMsg");
    var missing = REGIONS.some(function (r) { return data[r[0]].some(function (m) { return !m.name.trim(); }); });
    if (missing) { msg.textContent = "每一種匯款方式都要填名稱。"; return; }
    msg.textContent = "";
    var btn = $("paySave");
    btn.disabled = true;
    A.api("/api/admin/payment", { method: "PUT", body: { regions: data } }).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) return A.checkSession();
      if (!r.ok) { msg.textContent = r.message || "儲存失敗，請再試一次。"; return; }
      data = r.regions;
      render();
      A.toast("已儲存匯款方式");
    });
  });

  // 切到「匯款方式」分頁時才讀取
  $("tab-payment").addEventListener("click", function () { if (!loaded) load(); });
  document.addEventListener("nieia:dash", function () {
    if ($("tab-payment").getAttribute("aria-selected") === "true" && !loaded) load();
  });
})();
