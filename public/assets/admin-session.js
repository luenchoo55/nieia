// 後台獨立頁面（例如工作坊）共用：確認登入、呼叫 API、顯示提示
// 登入本身在 /admin 進行，這裡只檢查是否已經登入
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

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
    ["loading", "loginNeeded", "dashView"].forEach(function (id) { $(id).hidden = id !== view; });
  }

  function checkSession() {
    api("/api/admin/me").then(function (r) {
      if (r.ok && r.loggedIn) {
        if ($("dashView").hidden) { show("dashView"); document.dispatchEvent(new Event("nieia:dash")); }
        return;
      }
      if (!r.ok && r.configured !== false) { $("loading").textContent = r.message || "暫時無法連線，請重新整理。"; return; }
      if (r.configured === false) $("loginNeededText").textContent = "後台還沒有設定好：" + (r.message || "請先依照後台頁面的說明在 Cloudflare 新增需要的 Secret。");
      show("loginNeeded");
    });
  }

  window.NieiaAdmin = { api: api, toast: toast, checkSession: checkSession };
  checkSession();
})();
