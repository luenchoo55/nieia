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
  stamp.src = "/assets/love-seal.png"; // 落款：彩色的紫色火焰蠟封
  // 卡片的白色紙張紋理（跟收據同一張）
  var paper = new Image();
  var paperReady = new Promise(function (ok) { paper.onload = paper.onerror = function () { ok(); }; });
  paper.src = "/assets/receipt-paper.jpg";
  var SONG = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
  // 卡片上的句子：跟網站標題同一個字體（霞鶩文楷）
  var KAI = '"LXGW WenKai TC", "Kaiti TC", "DFKai-SB", serif';
  var SANS = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
  var LATIN = '"Cormorant Garamond", "Times New Roman", serif';
  function fontsFor(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("900 70px " + SONG, "阿綸涅亞"),
      document.fonts.load("400 72px " + KAI, text),
      document.fonts.load("600 34px " + SANS, text + "IG 私訊「愛我」，抽一句給自己"),
      document.fonts.load("500 44px " + LATIN, "NIEIA @nieia4928"),
    ]).catch(function () {});
  }

  // 網頁卡片的字：最長一段剛好放進卡片高度的 66%（每字約 1.32 個字高，含字距）
  function fitCardText(segs) {
    var longest = Math.max.apply(null, segs.map(function (x) { return Array.from(x).length; }));
    var h = card.clientHeight * .66;
    var px = Math.min(24, Math.floor(h / (longest * 1.32)));
    textEl.style.fontSize = px + "px";
  }
  window.addEventListener("resize", function () { if (current) fitCardText(segments(current.text)); });

  function draw() {
    if (!pool.length) { ready.then(draw); return; }
    var pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && pick === last);
    last = pick;
    var reveal = function () {
      current = pick;
      // 遇到逗號就換一直行；其他地方不斷開，放不下就縮小字
      textEl.textContent = "";
      var segs = segments(pick.text);
      segs.forEach(function (seg, k) {
        if (k) textEl.appendChild(document.createElement("br"));
        textEl.appendChild(document.createTextNode(seg));
      });
      fitCardText(segs);
      card.classList.add("flipped");
      card.setAttribute("aria-label", "給你的一句愛的拍拍：" + pick.text);
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
  // 句子依逗號分段（逗號留在上一行的行尾）
  function segments(text) {
    return String(text).replace(/，/g, "，\n").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
  }
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

  // 直書：標點換成直排用的字形；逗號、句號放在字格右上角
  var VERT = { "「": "﹁", "」": "﹂", "『": "﹃", "』": "﹄", "（": "︵", "）": "︶", "(": "︵", ")": "︶", "—": "︱", "…": "︙", "～": "︴", "-": "︱" };
  var CORNER = "，。、．,.";
  // 每段（逗號分段）切成直行，每行最多 max 字；標點不放在行首
  function columns(text, max) {
    var cols = [];
    segments(text).forEach(function (seg) {
      var chars = Array.from(seg);
      while (chars.length) {
        var take = Math.min(max, chars.length);
        if (chars.length > take && NO_START.indexOf(chars[take]) >= 0) take++;
        cols.push(chars.splice(0, take));
      }
    });
    return cols;
  }
  function vChar(c, ch, x, y, size) {
    if (CORNER.indexOf(ch) >= 0) { c.fillText(ch, x + size * .58, y - size * .58); return; }
    c.fillText(VERT[ch] || ch, x, y);
  }
  function star(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
    c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
  }

  function render(pick) {
    var W = 1080, H = 1920;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    // 整張白紙紋理
    c.fillStyle = "#fff"; c.fillRect(0, 0, W, H);
    if (paper.naturalWidth) {
      var k = Math.max(W / paper.naturalWidth, H / paper.naturalHeight);
      var pw = paper.naturalWidth * k, ph = paper.naturalHeight * k;
      c.drawImage(paper, (W - pw) / 2, (H - ph) / 2, pw, ph);
    }
    // 四個角落透一點品牌的光
    [[W, 0, 900, "rgba(190,186,240,.55)"], [0, H, 950, "rgba(240,200,224,.5)"], [0, 0, 620, "rgba(250,222,196,.35)"], [W, H, 760, "rgba(196,224,246,.45)"]].forEach(function (o) {
      var rg = c.createRadialGradient(o[0], o[1], 0, o[0], o[1], o[2]);
      rg.addColorStop(0, o[3]); rg.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
    });
    // 細的雙線框，像一張信箋
    c.strokeStyle = "rgba(110,100,180,.5)";
    c.lineWidth = 2; c.strokeRect(58, 58, W - 116, H - 116);
    c.lineWidth = 1; c.strokeRect(74, 74, W - 148, H - 148);

    // 上方：品牌名＋分隔線
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.fillStyle = "#2E2750";
    spacing(c, 18); c.font = "900 64px " + SONG;
    c.fillText("阿綸涅亞", W / 2 + 9, 248);
    spacing(c, 20); c.font = "500 30px " + LATIN;
    c.fillStyle = "#625A80";
    c.fillText("NIEIA", W / 2 + 10, 302);
    spacing(c, 0);
    c.fillStyle = "rgba(110,100,180,.6)";
    c.fillRect(W / 2 - 130, 352, 96, 1.5); c.fillRect(W / 2 + 34, 352, 96, 1.5);
    star(c, W / 2, 353, 11);

    // 中間：直書句子（由右往左），太長就縮小字
    // 只在逗號換行：每一段放在同一直行，絕不從詞的中間斷開；依最長的一段決定字的大小
    var AREA = 920;
    var cols = segments(pick.text).map(function (x) { return Array.from(x); });
    var longestSeg = Math.max.apply(null, cols.map(function (x) { return x.length; }));
    var size = Math.min(104, Math.floor(AREA / (longestSeg * 1.12)));
    var step = size * 1.12, colStep = Math.min(size * 1.9, 220);
    var longestLen = Math.max.apply(null, cols.map(function (x) { return x.length; }));
    var top = 420 + (AREA - longestLen * step) / 2 + step / 2;
    var x0 = W / 2 + (cols.length - 1) * colStep / 2;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "400 " + size + "px " + KAI;
    c.fillStyle = "#2A2350";
    cols.forEach(function (col, i) {
      var x = x0 - i * colStep;
      col.forEach(function (ch, j) { vChar(c, ch, x, top + j * step, size); });
    });

    // 落款：彩色蠟封
    if (stamp.naturalWidth) {
      var sd = 196;
      c.save();
      c.shadowColor = "rgba(74,40,110,.28)"; c.shadowBlur = 26; c.shadowOffsetY = 10;
      c.drawImage(stamp, W / 2 - sd / 2, 1368, sd, sd * stamp.naturalHeight / stamp.naturalWidth);
      c.restore();
    }

    // 下方：帳號與邀請（避開限時動態下方的回覆列）
    c.textBaseline = "alphabetic";
    c.fillStyle = "#2E2750";
    spacing(c, 4); c.font = "600 50px " + LATIN;
    c.fillText("@nieia4928", W / 2 + 2, 1634);
    spacing(c, 3); c.font = "500 34px " + SANS;
    c.fillStyle = "#4A3F78";
    c.fillText("IG 私訊「愛我」，抽一句給自己", W / 2 + 2, 1690);
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
    var name = "給你的一句愛的拍拍.png";
    if (inApp) {
      // IG 裡不能下載：跳出圖片，長按儲存
      img.src = url;
      img.alt = "給你的一句愛的拍拍：" + current.text;
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
