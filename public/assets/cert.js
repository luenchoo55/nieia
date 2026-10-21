// 學員證書頁：讀取證書資料，用 canvas 畫出橫式證書與 IG 限動直式版本，並提供下載與分享
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var C = { paper: "#EAE7E0", ink: "#1C1B19", soft: "#4A4843", mute: "#6B6862", seal: "#B23A2B", sealInk: "#F4F1EA", block: "#CFCBC2" };
  var SERIF = '"Noto Serif TC", "Songti TC", serif';
  var SANS = '"Noto Sans TC", "PingFang TC", sans-serif';
  var LATIN = '"Cormorant Garamond", "Times New Roman", serif';
  var ORG = "阿綸涅亞", ORG_EN = "NIEIA";
  var cert = null, photo = null, qr = null;

  // ---------- 文字與日期 ----------
  var CN_DIGITS = "〇一二三四五六七八九";
  function season(date) {
    var m = Number(date.slice(5, 7));
    var s = m >= 3 && m <= 5 ? "春" : m >= 6 && m <= 8 ? "夏" : m >= 9 && m <= 11 ? "秋" : "冬";
    return date.slice(0, 4).split("").map(function (d) { return CN_DIGITS[Number(d)]; }).join("") + "・" + s;
  }
  function dotDate(d) { return d.replace(/-/g, "."); }
  function dateRange(dates) {
    var a = dates.first, b = dates.last;
    if (a === b) return dotDate(a);
    if (a.slice(0, 4) !== b.slice(0, 4)) return dotDate(a) + "–" + dotDate(b);
    if (a.slice(0, 7) === b.slice(0, 7)) return dotDate(a) + "–" + b.slice(8);
    return dotDate(a) + "–" + b.slice(5).replace("-", ".");
  }
  function hoursNum(h) { return Number.isInteger(h) ? String(h) : h.toFixed(1); }
  function hoursEn(h) { return hoursNum(h) + (h === 1 ? " hour" : " hours"); }
  function formatText(f) { return f === "online" ? ["線上課程", "Online Course"] : ["實體課程", "In person"]; }
  function prettyDateZh(dates) {
    var f = function (d) { var p = d.split("-"); return p[0] + " 年 " + Number(p[1]) + " 月 " + Number(p[2]) + " 日"; };
    return dates.first === dates.last ? f(dates.first) : f(dates.first) + " 至 " + f(dates.last);
  }

  // ---------- 畫布工具 ----------
  function setFont(ctx, weight, size, family, italic) {
    ctx.font = (italic ? "italic " : "") + weight + " " + size + "px " + family;
  }
  // 自己處理字距，避免依賴較新的 ctx.letterSpacing
  function measure(ctx, str, spacing) {
    if (!spacing) return ctx.measureText(str).width;
    var w = 0;
    for (var i = 0; i < str.length; i++) w += ctx.measureText(str[i]).width + (i < str.length - 1 ? spacing : 0);
    return w;
  }
  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.fillStyle = opt.color || C.ink;
    var sp = opt.spacing || 0;
    var w = measure(ctx, str, sp);
    if (opt.align === "right") x -= w;
    else if (opt.align === "center") x -= w / 2;
    if (!sp) { ctx.textAlign = "left"; ctx.fillText(str, x, y); return w; }
    ctx.textAlign = "left";
    for (var i = 0; i < str.length; i++) {
      ctx.fillText(str[i], x, y);
      x += ctx.measureText(str[i]).width + sp;
    }
    return w;
  }
  // 字太長時縮小字級，回傳實際字級
  function fit(ctx, str, weight, size, min, family, maxW, spacingEm, italic) {
    var s = size;
    while (s > min) {
      setFont(ctx, weight, s, family, italic);
      if (measure(ctx, str, s * (spacingEm || 0)) <= maxW) break;
      s -= 1;
    }
    setFont(ctx, weight, s, family, italic);
    return s;
  }
  // 依寬度斷行（中文逐字、英文以空白為單位）
  function wrap(ctx, str, maxW, spacing) {
    var tokens = str.match(/[A-Za-z0-9'’&.\-/]+\s*|\s+|./g) || [];
    var lines = [], line = "";
    tokens.forEach(function (t) {
      var next = line + t;
      if (line && measure(ctx, next.trimEnd(), spacing) > maxW) { lines.push(line.trimEnd()); line = t.trimStart(); }
      else line = next;
    });
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }
  function vertical(ctx, str, cx, top, size, step, color) {
    ctx.fillStyle = color || C.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      ctx.save();
      ctx.translate(cx, top + step * i + step / 2);
      if (ch === "・") { ctx.fillText("・", 0, 0); }
      else ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }
  function line(ctx, x1, y1, x2, y2, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  var grainTile = null;
  function grain(ctx, w, h, strength) {
    if (!grainTile) {
      grainTile = document.createElement("canvas");
      grainTile.width = grainTile.height = 160;
      var g = grainTile.getContext("2d");
      var img = g.createImageData(160, 160);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function seal(ctx, cx, cy, size) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-3 * Math.PI / 180);
    ctx.fillStyle = C.seal;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    setFont(ctx, 900, Math.round(size * 0.31), SERIF);
    vertical(ctx, "修畢", 0, -size * 0.34, Math.round(size * 0.31), size * 0.34, C.sealInk);
    ctx.restore();
  }

  function drawQr(ctx, x, y, size) {
    if (!qr) return;
    var n = qr.getModuleCount();
    var quiet = 2, cell = size / (n + quiet * 2);
    ctx.fillStyle = C.paper;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = C.ink;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }

  // 照片：裁切填滿、轉黑白、加顆粒
  function drawPhoto(ctx, x, y, w, h) {
    if (!photo) {
      ctx.fillStyle = C.block;
      ctx.fillRect(x, y, w, h);
      return;
    }
    var r = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
    var sw = w / r, sh = h / r;
    var sx = (photo.naturalWidth - sw) / 2, sy = (photo.naturalHeight - sh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = "grayscale(1) contrast(1.08) brightness(1.02)";
    ctx.drawImage(photo, sx, sy, sw, sh, x, y, w, h);
    ctx.filter = "none";
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#8a8376";
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    grain(ctx, x + w, y + h, 0.16);
    ctx.restore();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // ================= 橫式證書（以 1123×794 為基準）=================
  function drawMain(canvas, scale) {
    var W = 1123, H = 794;
    canvas.width = W * scale;
    canvas.height = H * scale;
    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 0.11);

    var top = 56, bottom = H - 56, left = 64, right = W - 64;

    // 左欄：直排「結業」與季節落款
    setFont(ctx, 900, 236, SERIF);
    vertical(ctx, "結業", left + 118, top - 8, 236, 236);
    setFont(ctx, 400, 13, SERIF);
    vertical(ctx, season(cert.dates.last), left + 236 + 28, top + 6, 13, 18.5, C.mute);
    var divX = left + 236 + 20 + 16 + 48;
    line(ctx, divX, top, divX, bottom, 0.55);

    var x0 = divX + 48, x1 = right, width = x1 - x0;

    // 頂端：主辦單位與證書編號
    setFont(ctx, 500, 13, SANS);
    var ow = text(ctx, ORG, x0, top + 22, { spacing: 13 * 0.24 });
    setFont(ctx, 400, 16, LATIN, true);
    text(ctx, ORG_EN, x0 + ow + 10, top + 22);
    text(ctx, "No. " + cert.no, x1, top + 22, { align: "right" });
    line(ctx, x0, top + 36, x1, top + 36);

    // 簽名區（最下方）
    var sigLine = bottom - 40;
    var blocks = cert.teachers.map(function (t) { return { label: "授課老師", labelEn: "INSTRUCTOR", name: t.name, en: t.nameEn }; });
    blocks.push({ label: "主辦單位", labelEn: "ORGANIZER", name: ORG, en: ORG_EN, org: true });
    var gap = 24, stamp = 76;
    var bw = (width - stamp * 2 - gap * (blocks.length + 1)) / blocks.length;
    blocks.forEach(function (b, i) {
      var bx = x0 + i * (bw + gap);
      var sz = fit(ctx, b.name, 400, 22, 14, SERIF, bw - (b.org ? 60 : 0), 0.1);
      var nw = text(ctx, b.name, bx, sigLine - 10, { spacing: sz * 0.1 });
      if (b.org) { setFont(ctx, 400, 20, LATIN, true); text(ctx, b.en, bx + nw + 8, sigLine - 10); }
      line(ctx, bx, sigLine, bx + bw, sigLine);
      // 中英標籤放得下就同一行，放不下就分兩行
      setFont(ctx, 400, 11, SANS);
      var lw = measure(ctx, b.label, 11 * 0.16);
      setFont(ctx, 400, 10, SANS);
      var oneLine = lw + 10 + measure(ctx, b.labelEn, 10 * 0.16) <= bw;
      setFont(ctx, 400, 11, SANS);
      text(ctx, b.label, bx, sigLine + 18, { spacing: 11 * 0.16, color: C.soft });
      setFont(ctx, 400, 10, SANS);
      text(ctx, b.labelEn, oneLine ? bx + lw + 10 : bx, oneLine ? sigLine + 18 : sigLine + 32, { spacing: 10 * 0.16, color: C.mute });
      if (!b.org && b.en) { fit(ctx, b.en, 400, 16, 11, LATIN, bw, 0, true); text(ctx, b.en, bx, oneLine ? sigLine + 38 : sigLine + 50, { color: C.soft }); }
    });
    seal(ctx, x1 - stamp - gap - stamp / 2, bottom - stamp / 2, stamp);
    drawQr(ctx, x1 - stamp, bottom - stamp, stamp);

    // 中段：依內容高度平均分配上下間距
    var textW = width;

    // A：證書名稱、姓名、聲明
    var nameSize = fit(ctx, cert.name, 600, 64, 34, SERIF, textW, 0.12);
    var nameW = measure(ctx, cert.name, nameSize * 0.12);
    setFont(ctx, 400, 28, LATIN, true);
    var enW = cert.nameEn ? measure(ctx, cert.nameEn, 0) : 0;
    var enInline = cert.nameEn && nameW + 24 + enW <= textW;
    var hA = 40 + 18 + nameSize * 1.15 + (cert.nameEn && !enInline ? 34 : 0) + 14 + 24 + 26;

    // B：工作坊名稱
    var titleSize = fit(ctx, cert.title, 600, 30, 18, SERIF, width, 0.08);
    var titleEnSize = cert.titleEn ? fit(ctx, cert.titleEn, 400, 22, 14, LATIN, width, 0, true) : 0;
    var hB = titleSize * 1.2 + (cert.titleEn ? titleEnSize * 1.4 : 0);

    // C：日期、時數、形式
    var hC = 66;
    var areaTop = top + 36, areaBottom = sigLine - 48;
    var space = (areaBottom - areaTop - hA - hB - hC) / 4;
    var y = areaTop + space;

    // 畫 A
    setFont(ctx, 400, 34, LATIN, true);
    text(ctx, "Certificate of Completion", x0, y + 30);
    var ny = y + 40 + 18 + nameSize * 0.92;
    setFont(ctx, 600, nameSize, SERIF);
    text(ctx, cert.name, x0, ny, { spacing: nameSize * 0.12 });
    var after = ny;
    if (cert.nameEn) {
      setFont(ctx, 400, 28, LATIN, true);
      if (enInline) text(ctx, cert.nameEn, x0 + nameW + 24, ny);
      else { fit(ctx, cert.nameEn, 400, 28, 16, LATIN, textW, 0, true); after = ny + 34; text(ctx, cert.nameEn, x0, after); }
    }
    setFont(ctx, 400, 14, SANS);
    text(ctx, "完成本工作坊全部課程，特此證明。", x0, after + 14 + 18, { color: C.soft });
    setFont(ctx, 400, 17, LATIN, true);
    text(ctx, "has completed the following workshop in full.", x0, after + 14 + 18 + 26, { color: C.soft });
    y += hA + space;

    // 畫 B
    setFont(ctx, 600, titleSize, SERIF);
    text(ctx, cert.title, x0, y + titleSize * 0.95, { spacing: titleSize * 0.08 });
    if (cert.titleEn) {
      setFont(ctx, 400, titleEnSize, LATIN, true);
      text(ctx, cert.titleEn, x0, y + titleSize * 1.2 + titleEnSize * 1.05);
    }
    y += hB + space;

    // 畫 C
    line(ctx, x0, y, x1, y);
    line(ctx, x0, y + hC, x1, y + hC);
    var colW = width / 3;
    var f = formatText(cert.format);
    var cells = [
      ["日期", "DATE", dateRange(cert.dates), ""],
      ["時數", "HOURS", hoursNum(cert.hours) + " 小時", " / " + hoursEn(cert.hours)],
      ["形式", "FORMAT", f[0], " / " + f[1]],
    ];
    cells.forEach(function (cell, i) {
      var cx = x0 + colW * i + (i ? 16 : 0);
      if (i) line(ctx, x0 + colW * i, y, x0 + colW * i, y + hC);
      setFont(ctx, 400, 11, SANS);
      text(ctx, cell[0] + "　" + cell[1], cx, y + 24, { spacing: 11 * 0.2, color: C.mute });
      var maxW = colW - (i ? 32 : 16);
      var vs = fit(ctx, cell[2], 400, 22, 14, SERIF, maxW * (cell[3] ? 0.5 : 1), 0);
      var vw = text(ctx, cell[2], cx, y + 52);
      if (cell[3]) { fit(ctx, cell[3], 400, Math.round(vs * 0.86), 11, LATIN, maxW - vw, 0, true); text(ctx, cell[3], cx + vw, y + 52, { color: C.soft }); }
    });
  }

  // ================= IG 限動版（以 540×960 為基準）=================
  function drawStory(canvas, scale) {
    var W = 540, H = 960;
    canvas.width = W * scale;
    canvas.height = H * scale;
    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 0.11);
    var left = 40, right = W - 40, width = right - left;

    setFont(ctx, 500, 12, SANS);
    var ow = text(ctx, ORG, left, 66, { spacing: 12 * 0.24 });
    setFont(ctx, 400, 15, LATIN, true);
    text(ctx, ORG_EN, left + ow + 8, 66);
    text(ctx, "No. " + cert.no, right, 66, { align: "right" });
    line(ctx, left, 78, right, 78);

    setFont(ctx, 900, 150, SERIF);
    vertical(ctx, "結業", right - 75, 98, 150, 150);
    setFont(ctx, 400, 26, LATIN, true);
    text(ctx, "Certificate", left, 140);
    text(ctx, "of Completion", left, 170);
    setFont(ctx, 400, 13, SERIF);
    text(ctx, season(cert.dates.last), left, 214, { spacing: 13 * 0.3, color: C.soft });

    var y = 420;
    if (photo) { drawPhoto(ctx, left, y, width, 250); y += 250 + 40; }
    else y = 470;

    var ns = fit(ctx, cert.name, 600, 44, 26, SERIF, width, 0.12);
    text(ctx, cert.name, left, y + ns * 0.9, { spacing: ns * 0.12 });
    var nw = measure(ctx, cert.name, ns * 0.12);
    y += ns * 1.1;
    if (cert.nameEn) {
      setFont(ctx, 400, 21, LATIN, true);
      if (nw + 16 + measure(ctx, cert.nameEn) <= width) text(ctx, cert.nameEn, left + nw + 16, y - ns * 0.2);
      else { fit(ctx, cert.nameEn, 400, 21, 14, LATIN, width, 0, true); y += 26; text(ctx, cert.nameEn, left, y); }
    }
    y += 28;
    setFont(ctx, 400, 19, SERIF);
    wrap(ctx, cert.title, width, 19 * 0.08).slice(0, 3).forEach(function (l) { text(ctx, l, left, y, { spacing: 19 * 0.08 }); y += 28; });
    if (cert.titleEn) {
      setFont(ctx, 400, 17, LATIN, true);
      wrap(ctx, cert.titleEn, width, 0).slice(0, 2).forEach(function (l) { text(ctx, l, left, y - 4); y += 22; });
    }

    var by = H - 44 - 74;
    line(ctx, left, by, right, by);
    setFont(ctx, 400, 18, SERIF);
    var info = dateRange(cert.dates) + "　" + hoursNum(cert.hours) + " 小時" + (cert.format === "online" ? "　線上" : "");
    fit(ctx, info, 400, 18, 13, SERIF, width - 90, 0);
    text(ctx, info, left, by + 30);
    setFont(ctx, 400, 12, SANS);
    text(ctx, "@nieia4928", left, by + 56, { spacing: 12 * 0.16, color: C.soft });
    seal(ctx, right - 30, by + 40, 60);
  }

  // ---------- 下載與分享 ----------
  function fileName(kind) { return "NIEIA-" + cert.no + (kind === "story" ? "-story" : "") + ".png"; }
  function render(kind, scale) {
    var c = document.createElement("canvas");
    (kind === "story" ? drawStory : drawMain)(c, scale);
    return c;
  }
  function toBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
  }
  function download(kind, btn) {
    btn.disabled = true;
    toBlob(render(kind, kind === "story" ? 2 : 3)).then(function (blob) {
      btn.disabled = false;
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fileName(kind);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }
  function share(kind, btn) {
    btn.disabled = true;
    toBlob(render(kind, kind === "story" ? 2 : 3)).then(function (blob) {
      btn.disabled = false;
      var file = new File([blob], fileName(kind), { type: "image/png" });
      navigator.share({ files: [file], title: "結業證書｜" + cert.title }).catch(function () { /* 使用者取消分享 */ });
    });
  }
  function canShareFiles() {
    try {
      return Boolean(navigator.canShare && navigator.canShare({ files: [new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" })] }));
    } catch (e) { return false; }
  }

  // ---------- 頁面文字 ----------
  function fillInfo() {
    document.title = "結業證書｜" + cert.name + "｜" + cert.title + "｜阿綸涅亞 NIEIA";
    $("cpName").textContent = cert.name;
    $("cpNameEn").textContent = cert.nameEn || "";
    var dl = $("cpFacts");
    dl.innerHTML = "";
    function fact(label, zh, en, cls) {
      var d = document.createElement("div");
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      if (cls) dd.className = cls;
      dd.textContent = zh;
      if (en) { var i = document.createElement("i"); i.textContent = en; dd.appendChild(i); }
      d.appendChild(dt);
      d.appendChild(dd);
      dl.appendChild(d);
    }
    var f = formatText(cert.format);
    fact("工作坊", cert.title, cert.titleEn);
    fact("日期", prettyDateZh(cert.dates));
    fact("時數", hoursNum(cert.hours) + " 小時", hoursEn(cert.hours));
    fact("形式", f[0], f[1]);
    fact("授課老師", cert.teachers.map(function (t) { return t.name; }).join("、"), cert.teachers.map(function (t) { return t.nameEn; }).filter(Boolean).join(" & "));
    fact("主辦單位", ORG + " " + ORG_EN);
    fact("證書編號", "No. " + cert.no, "", "no");
    var issued = new Date(cert.issuedAt);
    $("cpVerify").textContent = "這張證書由阿綸涅亞 NIEIA 於 " + issued.getFullYear() + " 年 " + (issued.getMonth() + 1) + " 月 " + issued.getDate() + " 日發出，編號 " + cert.no + " 已登記在工作室的證書紀錄中。";

    var label = "結業證書：" + cert.name + (cert.nameEn ? "（" + cert.nameEn + "）" : "") + "完成「" + cert.title + "」，" + prettyDateZh(cert.dates) + "，共 " + hoursNum(cert.hours) + " 小時，" + f[0] + "，授課老師 " + cert.teachers.map(function (t) { return t.name; }).join("、") + "，主辦單位阿綸涅亞 NIEIA，證書編號 " + cert.no + "。";
    $("cvMain").setAttribute("aria-label", label);
    $("cvStory").setAttribute("aria-label", "IG 限時動態版本的" + label);

    if (photo) {
      $("cpPhoto").hidden = false;
      $("cpPhotoImg").src = photo.src;
      $("cpPhotoImg").alt = "「" + cert.title + "」的大合照";
      $("cpPhotoCap").textContent = cert.title + "　大合照　" + prettyDateZh(cert.dates);
    }
  }

  function paint() {
    drawMain($("cvMain"), Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
    drawStory($("cvStory"), 2);
  }

  // ---------- 載入 ----------
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var chars = [cert.name, cert.title, ORG, "結業修畢完成本工作坊全部課程特此證明授課老師主辦單位日期時數形式線上實體課程小時", season(cert.dates.last), cert.teachers.map(function (t) { return t.name; }).join("")].join("");
    var latin = [cert.nameEn, cert.titleEn, "Certificate of Completion No. 0123456789 hours Online Course In person", cert.teachers.map(function (t) { return t.nameEn; }).join(" ")].join(" ");
    var loads = [
      document.fonts.load('900 100px "Noto Serif TC"', chars),
      document.fonts.load('600 40px "Noto Serif TC"', chars),
      document.fonts.load('400 20px "Noto Serif TC"', chars + "0123456789.–"),
      document.fonts.load('400 14px "Noto Sans TC"', chars + "@nieia"),
      document.fonts.load('500 14px "Noto Sans TC"', ORG),
      document.fonts.load('italic 400 20px "Cormorant Garamond"', latin),
    ];
    // 字型最多等 6 秒，網路慢也能先看到證書
    return Promise.race([Promise.all(loads), new Promise(function (r) { setTimeout(r, 6000); })]);
  }
  function loadPhoto(url) {
    if (!url) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }
  function fail(message) {
    $("cpStatus").hidden = true;
    $("cpError").hidden = false;
    if (message) $("cpErrorMsg").textContent = message;
  }

  // 沒有證書代碼：顯示查詢表單（證書編號＋姓名）
  function lookup() {
    $("cpStatus").hidden = true;
    $("cpLookup").hidden = false;
    var msg = $("lkMsg"), btn = $("lkBtn");
    $("lkForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var no = $("lkNo").value.trim(), name = $("lkName").value.trim();
      if (!no) { msg.textContent = "請填寫證書編號。"; $("lkNo").focus(); return; }
      if (!name) { msg.textContent = "請填寫證書上的姓名。"; $("lkName").focus(); return; }
      msg.textContent = "";
      btn.disabled = true;
      btn.textContent = "查詢中…";
      fetch("/api/certs/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ no: no, name: name, website: $("lkWebsite").value }),
      }).then(function (res) { return res.json().catch(function () { return {}; }); }, function () {
        return { ok: false, message: "連不上網站，請確認網路後再試。" };
      }).then(function (r) {
        if (r.ok && r.code) { location.href = "/cert?c=" + encodeURIComponent(r.code); return; }
        btn.disabled = false;
        btn.textContent = "查詢證書";
        msg.textContent = r.message || "查詢失敗，請再試一次。";
      });
    });
  }

  var code = new URLSearchParams(location.search).get("c") || "";
  if (!code) { lookup(); return; }
  if (!/^[a-z2-9]{12}$/.test(code)) { fail(); return; }

  fetch("/api/certs/" + encodeURIComponent(code)).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) { data.status = res.status; return data; });
  }, function () { return { ok: false, status: 0, message: "連不上網站，請確認網路後重新整理。" }; }).then(function (r) {
    if (!r.ok) { fail(r.status === 404 ? null : r.message); return; }
    cert = r.cert;
    if (window.qrcode) {
      qr = window.qrcode(0, "M");
      qr.addData(location.origin + "/cert?c=" + code);
      qr.make();
    }
    return Promise.all([loadFonts(), loadPhoto(cert.photo)]).then(function (res) {
      photo = res[1];
      fillInfo();
      paint();
      $("cpStatus").hidden = true;
      $("cpCert").hidden = false;
      var shareable = canShareFiles();
      $("shareMain").hidden = $("shareStory").hidden = !shareable;
      $("dlMain").addEventListener("click", function () { download("main", this); });
      $("dlStory").addEventListener("click", function () { download("story", this); });
      $("shareMain").addEventListener("click", function () { share("main", this); });
      $("shareStory").addEventListener("click", function () { share("story", this); });
      var t;
      window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(paint, 200); });
    });
  });
})();
