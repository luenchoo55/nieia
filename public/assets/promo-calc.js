// 收銀優惠計算：後台收銀頁與伺服器結帳共用同一份，算出來的金額一定一致。
// 順序：特價商品 → 套餐組合 → 組合價 → 整筆訂單折扣 → 手動折扣 → 依折扣後總額判斷滿額禮。
// 特價、組合價、套餐折掉的金額算在相關品項上；整筆折扣與手動折扣再依各項金額比例分攤，
// 記帳時每一項記的是折扣後的實收。
(function (root) {
  "use strict";

  function priceFor(rule, currency) {
    var v = currency === "MYR" ? rule.myr : rule.twd;
    return v == null || v === "" ? null : Number(v);
  }

  // 特價商品：打折（pct，例如 50 = 半價）或固定特價；回傳 { price, rule }，沒有特價就回傳 null
  function saleOf(ref, price, promos, currency) {
    var sale = (promos && promos.sale) || {};
    if (!sale.enabled) return null;
    var best = null;
    (sale.items || []).forEach(function (s) {
      if (!s.on || !s.refs || s.refs.indexOf(ref) < 0) return;
      var p = Number(s.pct) > 0 && Number(s.pct) < 100 ? Math.round(price * Number(s.pct) / 100) : priceFor(s, currency);
      if (p != null && p < price && (!best || p < best.price)) best = { price: p, rule: s };
    });
    return best;
  }

  // 購物車展開成一件一件，方便套餐與組合價挑選（單價用特價後的）
  function units(lines) {
    var out = [];
    lines.forEach(function (l, i) {
      for (var k = 0; k < l.qty; k++) out.push({ line: i, ref: l.ref, price: l.eff, used: false });
    });
    return out;
  }

  // lines: [{ ref: "product:<id>" | "service:<id>" | "custom:…", name, price, qty }]
  // opts: { discountId, manual }
  function compute(lines, promos, currency, opts) {
    promos = promos || {};
    opts = opts || {};
    var subtotal = lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var adjustments = [];

    // 特價商品：每條規則合計一行
    var saleBy = {};
    lines = lines.map(function (l) {
      var s = saleOf(l.ref, l.price, promos, currency);
      if (s) {
        var k = s.rule.id;
        if (!saleBy[k]) { saleBy[k] = { kind: "sale", label: s.rule.name || "特價", amount: 0 }; adjustments.push(saleBy[k]); }
        saleBy[k].amount += (l.price - s.price) * l.qty;
      }
      return { ref: l.ref, name: l.name, price: l.price, qty: l.qty, eff: s ? s.price : l.price };
    });
    var pool = units(lines);
    // 每一項目前的金額（特價後），組合價與套餐再從參與的品項扣
    var base = lines.map(function (l) { return l.eff * l.qty; });
    function spread(picked, saved) {
      var sum = picked.reduce(function (t, u) { return t + u.price; }, 0);
      picked.forEach(function (u) { base[u.line] -= sum ? saved * u.price / sum : 0; });
    }

    // 套餐組合：A＋B＋C 一組自訂價，每一組各取一件
    var sets = promos.sets || {};
    if (sets.enabled) (sets.items || []).forEach(function (s) {
      var price = priceFor(s, currency);
      if (!s.on || price == null || !s.refs || s.refs.length < 2) return;
      var count = 0, saved = 0;
      for (;;) {
        var pick = [];
        var ok = s.refs.every(function (ref) {
          var u = pool.find(function (x) { return !x.used && x.ref === ref && pick.indexOf(x) < 0; });
          if (u) pick.push(u);
          return !!u;
        });
        if (!ok) break;
        var orig = pick.reduce(function (t, u) { return t + u.price; }, 0);
        if (orig <= price) break;
        pick.forEach(function (u) { u.used = true; });
        spread(pick, orig - price);
        count++;
        saved += orig - price;
      }
      if (saved > 0) adjustments.push({ kind: "set", label: s.name + (count > 1 ? " × " + count : ""), amount: saved });
    });

    // 組合價：指定商品合計滿 N 件算一組優惠價（可以多款合併），挑單價高的先算
    var bundles = promos.bundles || {};
    if (bundles.enabled) (bundles.items || []).forEach(function (b) {
      var price = priceFor(b, currency);
      var n = Number(b.qty);
      if (!b.on || price == null || !(n >= 2) || !b.refs || !b.refs.length) return;
      var avail = pool.filter(function (u) { return !u.used && b.refs.indexOf(u.ref) >= 0; })
        .sort(function (a, c) { return c.price - a.price; });
      var groups = Math.floor(avail.length / n);
      if (!groups) return;
      var take = avail.slice(0, groups * n);
      var orig = take.reduce(function (t, u) { return t + u.price; }, 0);
      var saved = orig - groups * price;
      if (saved <= 0) return;
      take.forEach(function (u) { u.used = true; });
      spread(take, saved);
      adjustments.push({ kind: "bundle", label: b.name + (groups > 1 ? " × " + groups : ""), amount: saved });
    });

    var running = subtotal - adjustments.reduce(function (t, a) { return t + a.amount; }, 0);

    // 整筆訂單折扣：結帳時選一個，例如 9 折
    var od = promos.orderDiscount || {};
    var discountOptions = od.enabled ? (od.options || []).filter(function (o) { return o.on && Number(o.percent) > 0 && Number(o.percent) < 100; }) : [];
    var chosen = discountOptions.find(function (o) { return o.id === opts.discountId; });
    if (chosen && running > 0) {
      var off = Math.round(running * (100 - Number(chosen.percent)) / 100);
      if (off > 0) { adjustments.push({ kind: "order", label: chosen.label || "整筆折扣", amount: off }); running -= off; }
    }

    // 手動折扣：直接減金額
    var manualOn = !!(promos.manual && promos.manual.enabled);
    var manual = manualOn ? Math.min(Math.max(0, Math.floor(Number(opts.manual) || 0)), running) : 0;
    if (manual > 0) { adjustments.push({ kind: "manual", label: "手動折扣", amount: manual }); running -= manual; }

    var total = Math.max(0, running);

    // 滿額禮：依折扣後總額
    var gifts = [], nextGift = null;
    var gc = promos.gift || {};
    if (gc.enabled) {
      var tiers = (gc.tiers || []).filter(function (t) { return t.on && t.gift && priceFor(t, currency) != null; })
        .map(function (t) { return { gift: t.gift, at: priceFor(t, currency) }; })
        .sort(function (a, c) { return a.at - c.at; });
      var reached = tiers.filter(function (t) { return total >= t.at; });
      gifts = gc.mode === "all" ? reached : reached.slice(-1);
      var next = tiers.find(function (t) { return total < t.at; });
      if (next) nextGift = { gift: next.gift, at: next.at, short: next.at - total };
    }

    // 整筆折扣與手動折扣依各項金額比例分攤，餘數補在金額最大的一項
    var baseSum = base.reduce(function (t, a) { return t + a; }, 0);
    // + 1e-6：避免小數誤差少算 1 元
    var amounts = base.map(function (a) { return baseSum > 0 ? Math.floor(a * total / baseSum + 1e-6) : 0; });
    var rest = total - amounts.reduce(function (t, a) { return t + a; }, 0);
    if (rest && lines.length) {
      var big = 0;
      base.forEach(function (a, i) { if (a > base[big]) big = i; });
      amounts[big] += rest;
    }

    return {
      subtotal: subtotal, adjustments: adjustments, total: total, amounts: amounts,
      gifts: gifts.map(function (g) { return g.gift; }), nextGift: nextGift,
      discountOptions: discountOptions.map(function (o) { return { id: o.id, label: o.label }; }),
      manualOn: manualOn,
    };
  }

  root.nieiaPromo = { compute: compute, saleOf: saleOf };
})(typeof window !== "undefined" ? window : globalThis);
