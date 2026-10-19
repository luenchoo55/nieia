(function () {
  "use strict";

  var cards = window.NIEIA_CARDS || [];

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.getElementById("card")) return;

  // ---------- card draw ----------
  var card = document.getElementById("card");
  var drawBtn = document.getElementById("drawBtn");
  var tEl = document.getElementById("cardTitle");
  var mEl = document.getElementById("cardMessage");
  var last = -1;

  function draw() {
    var i;
    do { i = Math.floor(Math.random() * cards.length); } while (i === last && cards.length > 1);
    last = i;
    var reveal = function () {
      tEl.textContent = cards[i][0];
      mEl.textContent = cards[i][1];
      card.classList.add("flipped");
      card.setAttribute("aria-label", "宇宙訊息：" + cards[i][0] + "。" + cards[i][1]);
      drawBtn.textContent = "再抽一張";
    };
    if (card.classList.contains("flipped") && !reduce) {
      card.classList.remove("flipped");
      setTimeout(reveal, 650);
    } else {
      reveal();
    }
  }
  card.addEventListener("click", draw);
  card.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); draw(); }
  });
  drawBtn.addEventListener("click", draw);

  card.addEventListener("pointermove", function (e) {
    var r = card.getBoundingClientRect();
    card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  });
})();
