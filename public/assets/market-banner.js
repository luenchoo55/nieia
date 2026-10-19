// 首頁：擺攤中時顯示提醒橫幅，並在這次瀏覽第一次進站時彈出提醒
(function () {
  "use strict";
  var banner = document.getElementById("marketBanner");
  var sheet = document.getElementById("marketSheet");
  if (!banner) return;
  // 彈出提醒要放在最外層，才不會被底部選單蓋住
  if (sheet) document.body.appendChild(sheet);

  function detail(m) {
    var parts = [m.location];
    if (m.serving != null) parts.push("現在叫號 " + m.serving + " 號");
    parts.push(m.waiting ? "等候 " + m.waiting + " 位" : "現在不用排隊");
    return parts.join("｜");
  }

  function closeSheet() {
    sheet.hidden = true;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") closeSheet(); }

  function update(first) {
    fetch("/api/market").then(function (r) { return r.json(); }).then(function (data) {
      var m = data && data.market;
      if (!m || !m.active) { banner.hidden = true; return; }
      document.getElementById("mbDetail").textContent = detail(m);
      banner.hidden = false;
      if (!first || !sheet) return;
      var key = "nieia-market-seen:" + m.location + ":" + m.hours;
      var seen = false;
      try { seen = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch (err) { /* 無痕模式 */ }
      if (seen) return;
      var text = m.location + (m.address ? "（" + m.address + "）" : "") + (m.hours ? "，" + m.hours : "") + "。";
      text += m.accepting ? "到攤位附近可以直接用手機取號，不用站著排隊。" : "目前暫停取號，可以直接到攤位找阿綸。";
      document.getElementById("msDetail").textContent = text;
      sheet.hidden = false;
      document.addEventListener("keydown", onKey);
      var btn = document.getElementById("msClose");
      btn.focus();
    }).catch(function () { /* 讀取失敗就不顯示 */ });
  }

  if (sheet) {
    document.getElementById("msClose").addEventListener("click", closeSheet);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
  }
  update(true);
  setInterval(function () { if (!document.hidden) update(false); }, 60000);
})();
