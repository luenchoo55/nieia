// 首頁：6 張蓋著的宇宙訊息牌，憑直覺選一張翻開
(function () {
  "use strict";
  var spread = document.getElementById("spread");
  var cards = window.NIEIA_CARDS || [];
  if (!spread || !cards.length) return;

  var minis = Array.prototype.slice.call(spread.querySelectorAll(".mini-card"));
  var reading = document.getElementById("reading");
  var tEl = document.getElementById("readTitle");
  var mEl = document.getElementById("readMsg");
  var status = document.getElementById("drawStatus");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var deal = [];
  var picked = false;

  // 每次洗牌，6 張牌各自對應一則不重複的訊息
  function shuffle() {
    var pool = cards.map(function (_, i) { return i; });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    deal = pool.slice(0, minis.length);
  }

  function pick(idx) {
    if (picked) return;
    picked = true;
    var card = cards[deal[idx]];
    minis.forEach(function (m, i) {
      m.disabled = true;
      if (i === idx) {
        m.querySelector(".mini-title").textContent = card[0];
        m.classList.add("flipped");
        m.setAttribute("aria-label", "你抽到的牌：" + card[0]);
      } else {
        m.classList.add("dim");
      }
    });
    tEl.textContent = card[0];
    mEl.textContent = card[1];
    setTimeout(function () {
      reading.hidden = false;
      status.textContent = "你抽到的是「" + card[0] + "」。" + card[1];
      if (!reduce) reading.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, reduce ? 0 : 650);
  }

  function reset() {
    reading.hidden = true;
    minis.forEach(function (m, i) {
      m.classList.remove("flipped", "dim");
      m.setAttribute("aria-label", "選第 " + (i + 1) + " 張牌");
    });
    spread.classList.remove("shuffling");
    void spread.offsetWidth; // 重新觸發洗牌動畫
    if (!reduce) spread.classList.add("shuffling");
    setTimeout(function () {
      minis.forEach(function (m) { m.disabled = false; m.querySelector(".mini-title").textContent = ""; });
      shuffle();
      picked = false;
      status.textContent = "已重新洗牌，再選一張吧。";
      minis[0].focus({ preventScroll: true });
    }, reduce ? 0 : 700);
  }

  minis.forEach(function (m, i) { m.addEventListener("click", function () { pick(i); }); });
  document.getElementById("reshuffle").addEventListener("click", reset);
  shuffle();
})();
