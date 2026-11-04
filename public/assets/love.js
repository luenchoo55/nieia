// 「愛我」抽卡：抽一句肯定、鼓勵或陪伴的話，存成 IG 限時動態大小的圖片（1080 × 1920）
(function () {
  "use strict";
  var card = document.getElementById("card");
  if (!card) return;
  var drawBtn = document.getElementById("drawBtn");
  var textEl = document.getElementById("loveText");
  var saveBtn = document.getElementById("loveSave");
  var sheet = document.getElementById("loveSheet");
  document.body.appendChild(sheet); // 放到最外層，才不會被下方選單蓋住
  var img = document.getElementById("loveImg");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // IG／FB／LINE 內建瀏覽器常常不能下載或分享檔案：改成跳出圖片讓客人長按儲存
  // 手機（觸控螢幕）用系統分享選單，裡面有「儲存影像」和 Instagram；電腦直接下載
  var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  var inApp = /Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent || "");

  var pool = [], last = null, current = null, blob = null, url = null;
  var ready = fetch("/assets/love-cards.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (data) {
    (data.categories || []).forEach(function (c) {
      if (c.enabled === false) return;
      (c.sentences || []).forEach(function (s) { if (s && String(s).trim()) pool.push({ cat: c.name, text: String(s).trim() }); });
    });
  }).catch(function () {
    pool.push({ cat: "溫柔肯定", text: "你本來的樣子，就很好。" });
  });

  // 字型、印章先載好，畫出來的圖片才會正確
  var stamp = new Image();
  var stampReady = new Promise(function (ok) { stamp.onload = stamp.onerror = function () { ok(); }; });
  stamp.src = "/assets/nieia-stamp.png";
  // 卡片的白色紙張紋理（跟收據同一張）
  var paper = new Image();
  var paperReady = new Promise(function (ok) { paper.onload = paper.onerror = function () { ok(); }; });
  paper.src = "/assets/receipt-paper.jpg";
  var SONG = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
  var SANS = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
  var LATIN = '"Cormorant Garamond", "Times New Roman", serif';
  function fontsFor(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("900 70px " + SONG, text + "阿綸涅亞"),
      document.fonts.load("600 34px " + SANS, text + "IG 私訊「愛我」，抽一句給自己"),
      document.fonts.load("500 44px " + LATIN, "NIEIA @nieia4928"),
    ]).catch(function () {});
  }

  function draw() {
    if (!pool.length) { ready.then(draw); return; }
    var pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && pick === last);
    last = pick;
    var reveal = function () {
      current = pick;
      textEl.textContent = pick.text;
      card.classList.add("flipped");
      card.setAttribute("aria-label", "給你的一句愛：" + pick.text);
      drawBtn.textContent = "再抽一張";
      makeImage(pick);
    };
    if (card.classList.contains("flipped") && !reduce) {
      card.classList.remove("flipped");
      setTimeout(reveal, 650);
    } else reveal();
  }
  card.addEventListener("click", draw);
  card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); draw(); } });
  drawBtn.addEventListener("click", draw);
  card.addEventListener("pointermove", function (e) {
    var r = card.getBoundingClientRect();
    card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  });

  // ---------- 產生限時動態圖片 ----------
  // 中文斷行：句首不放標點、句尾不放左括號
  var NO_START = "，。、！？；：」』）…—～,.!?;:)";
  var NO_END = "「『（(";
  function wrap(ctx, text, max) {
    var chars = Array.from(text), lines = [], cur = "";
    chars.forEach(function (ch) {
      if (cur && ctx.measureText(cur + ch).width > max) {
        if (NO_START.indexOf(ch) >= 0) { cur += ch; return; } // 標點跟著上一行
        var tail = cur.slice(-1);
        if (NO_END.indexOf(tail) >= 0) { lines.push(cur.slice(0, -1)); cur = tail + ch; return; }
        lines.push(cur); cur = ch; return;
      }
      cur += ch;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function spacing(ctx, px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }

  function render(pick) {
    var W = 1080, H = 1920;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    // 背景：品牌的四色柔光（紫 → 粉 → 杏 → 淺藍）
    var g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#C9C6F3"); g.addColorStop(.38, "#F2D2E6"); g.addColorStop(.7, "#FAE2CC"); g.addColorStop(1, "#CFE5F6");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    [[W * .2, H * .18, 520, "rgba(255,255,255,.55)"], [W * .85, H * .55, 560, "rgba(255,255,255,.45)"], [W * .3, H * .9, 600, "rgba(150,152,231,.25)"]].forEach(function (o) {
      var rg = c.createRadialGradient(o[0], o[1], 0, o[0], o[1], o[2]);
      rg.addColorStop(0, o[3]); rg.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
    });
    // 細小的星光（固定位置，每張都一樣）
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 70; i++) {
      c.fillStyle = "rgba(255,255,255," + (.35 + rnd() * .5).toFixed(2) + ")";
      c.beginPath(); c.arc(rnd() * W, rnd() * H, rnd() * 2.4 + .6, 0, Math.PI * 2); c.fill();
    }

    // 品牌名（避開 IG 限時動態上方的頭像區）
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.fillStyle = "#362F52";
    spacing(c, 14); c.font = "900 64px " + SONG;
    c.fillText("阿綸涅亞", W / 2 + 7, 250);
    spacing(c, 20); c.font = "500 30px " + LATIN;
    c.fillStyle = "#625A80";
    c.fillText("NIEIA", W / 2 + 10, 302);
    spacing(c, 0);

    // 卡片
    var cx = 110, cy = 380, cw = 860, ch = 1140;
    c.save();
    c.shadowColor = "rgba(74,63,120,.22)"; c.shadowBlur = 70; c.shadowOffsetY = 24;
    c.fillStyle = "#fff";
    round(c, cx, cy, cw, ch, 56); c.fill();
    c.restore();
    if (paper.naturalWidth) {
      // 紙張紋理鋪滿卡片（等比例放大到蓋住整張卡片）
      c.save();
      round(c, cx, cy, cw, ch, 56); c.clip();
      var k = Math.max(cw / paper.naturalWidth, ch / paper.naturalHeight);
      var pw = paper.naturalWidth * k, ph = paper.naturalHeight * k;
      c.drawImage(paper, cx + (cw - pw) / 2, cy + (ch - ph) / 2, pw, ph);
      c.restore();
    }
    c.strokeStyle = "rgba(150,152,231,.55)"; c.lineWidth = 2;
    round(c, cx + 24, cy + 24, cw - 48, ch - 48, 40); c.stroke();

    // 句子：粗宋體，太長就自動縮小
    var size = 72, lines;
    do {
      c.font = "900 " + size + "px " + SONG; spacing(c, size * .06);
      lines = wrap(c, pick.text, cw - 200);
      if (lines.length <= 4) break;
      size -= 4;
    } while (size > 48);
    var lh = size * 1.6, top = cy + 150, area = 620;
    var ty = top + (area - lines.length * lh) / 2 + size;
    c.fillStyle = "#2E2750";
    lines.forEach(function (ln, k) { c.fillText(ln, W / 2 + size * .03, ty + k * lh); });
    spacing(c, 0);

    // 落款＋印章
    c.font = "500 30px " + SANS; spacing(c, 6);
    c.fillStyle = "#7A7299";
    c.fillText("— 給你的一句愛 —", W / 2 + 3, cy + 860);
    spacing(c, 0);
    if (stamp.naturalWidth) {
      var sd = 200;
      c.globalAlpha = .92;
      c.drawImage(stamp, W / 2 - sd / 2, cy + 900, sd, sd);
      c.globalAlpha = 1;
    }

    // 帳號與邀請（避開下方的回覆列）
    c.fillStyle = "#362F52";
    spacing(c, 4); c.font = "600 46px " + LATIN;
    c.fillText("@nieia4928", W / 2 + 2, 1608);
    spacing(c, 3); c.font = "500 34px " + SANS;
    c.fillStyle = "#4A3F78";
    c.fillText("IG 私訊「愛我」，抽一句給自己", W / 2 + 2, 1668);
    spacing(c, 0);
    return cv;
  }

  function makeImage(pick) {
    blob = null;
    saveBtn.hidden = false;
    saveBtn.disabled = true;
    Promise.all([fontsFor(pick.text), stampReady, paperReady]).then(function () {
      if (pick !== current) return;
      render(pick).toBlob(function (b) {
        if (pick !== current) return;
        blob = b;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(b);
        saveBtn.disabled = false;
      }, "image/png");
    });
  }

  function closeSheet() { sheet.hidden = true; document.documentElement.classList.remove("no-scroll"); saveBtn.focus(); }
  document.getElementById("loveSheetClose").addEventListener("click", closeSheet);
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  saveBtn.addEventListener("click", function () {
    if (!blob) return;
    var name = "給你的一句愛.png";
    if (inApp) {
      // IG 裡不能下載：跳出圖片，長按儲存
      img.src = url;
      img.alt = "給你的一句愛：" + current.text;
      sheet.hidden = false;
      document.documentElement.classList.add("no-scroll");
      return;
    }
    var file = window.File ? new File([blob], name, { type: "image/png" }) : null;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function () {});
      return;
    }
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  });
})();
