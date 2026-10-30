// 產生簡單的 Excel 檔（.xlsx）：全部用文字格式（電話開頭的 0 不會不見）
// window.nieiaXlsx(工作表名稱, [[第一列...], [第二列...]], 欄寬陣列) → Blob
// window.nieiaXlsxBook([{ name, rows, widths }, ...]) → 一個檔案裡放多個工作表
(function () {
  "use strict";

  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // 不壓縮的 zip（xlsx 本身就是 zip）
  function zip(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034B50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
      head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      parts.push(head.buffer, name, data);
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014B50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      central.push(cd.buffer, name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (n, p) { return n + p.byteLength; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function col(i) {
    var s = "";
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function sheetXml(rows, widths) {
    var cols = (widths || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("");
    var body = rows.map(function (r, ri) {
      return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
        if (v == null || v === "") return "";
        return '<c r="' + col(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + "</t></is></c>";
      }).join("") + "</row>";
    }).join("");
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + (cols ? "<cols>" + cols + "</cols>" : "") + "<sheetData>" + body + "</sheetData></worksheet>";
  }

  // 多個工作表：[{ name, rows, widths }] → Blob
  window.nieiaXlsxBook = function (sheets) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var used = {};
    var names = sheets.map(function (sh, i) {
      var n = String(sh.name || "").replace(/[\\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet" + (i + 1);
      while (used[n]) n = n.slice(0, 28) + " " + (i + 1);
      used[n] = true;
      return n;
    });
    var overrides = sheets.map(function (sh, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("");
    var sheetTags = names.map(function (n, i) { return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("");
    var rels = sheets.map(function (sh, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("");
    return zip([
      { name: "[Content_Types].xml", data: xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + overrides + "</Types>" },
      { name: "_rels/.rels", data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheetTags + "</sheets></workbook>" },
      { name: "xl/_rels/workbook.xml.rels", data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>" },
    ].concat(sheets.map(function (sh, i) { return { name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: xml + sheetXml(sh.rows, sh.widths) }; })));
  };

  window.nieiaXlsx = function (sheetName, rows, widths) {
    return window.nieiaXlsxBook([{ name: sheetName, rows: rows, widths: widths }]);
  };
})();
