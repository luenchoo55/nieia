// 寄通知信給阿綸（透過 Resend）。
// 還沒有自己的網域時，Resend 只允許從 onboarding@resend.dev 寄到「註冊 Resend 的那個信箱」，
// 所以 NOTIFY_EMAIL 要填註冊 Resend 用的信箱。之後買了網域，就能改成用自己的寄件地址寄給客人。

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const REGION = { TW: "台灣", MY: "馬來西亞" };
const MODE = { remote: "IG 視訊遠距", onsite: "現場進行" };
const EXTRA_LABELS = {
  practiced: "曾習修擴大療癒", departedName: "亡者全名", relation: "與客人的關係",
  birthName: "出生時的完整姓名", birthDate: "出生日期",
  petName: "毛孩名字", species: "種類", petAge: "毛孩年齡", questions: "想溝通的問題",
};

function money(amount, currency, mode) {
  if (mode === "inquiry") return "隨喜服務";
  if (amount == null) return "金額待告知";
  return (currency === "MYR" ? "RM " : "NT$") + Number(amount).toLocaleString("en-US");
}

function table(rows) {
  return (
    '<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:15px;line-height:1.6">' +
    rows
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) =>
        `<tr><td style="padding:8px 12px 8px 0;color:#625A80;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eee">${esc(k)}</td>` +
        `<td style="padding:8px 0;color:#362F52;border-bottom:1px solid #eee">${esc(v)}</td></tr>`
      )
      .join("") +
    "</table>"
  );
}

function layout(title, intro, rows, adminUrl) {
  return `<div style="font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;color:#362F52;padding:8px">
<h2 style="font-weight:600;margin:0 0 8px">${esc(title)}</h2>
<p style="margin:0 0 16px;color:#625A80">${esc(intro)}</p>
${table(rows)}
<p style="margin:20px 0 0"><a href="${esc(adminUrl)}" style="display:inline-block;background:#4A3F78;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px">打開後台</a></p>
</div>`;
}

async function send(env, subject, html, replyTo) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || "NIEIA 預約通知 <onboarding@resend.dev>",
      to: [env.NOTIFY_EMAIL],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      html,
    }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text());
  return { ok: res.ok };
}

function when(b) {
  return `${b.date}（${b.weekday}）${b.start}–${b.end}`;
}

// 新預約
export function notifyNewBooking(c, b) {
  const adminUrl = new URL("/admin", c.req.url).toString();
  const extra = Object.entries(b.extra || {}).map(([k, v]) => [EXTRA_LABELS[k] || k, k === "practiced" ? (v === "yes" ? "有" : "沒有") : v]);
  const html = layout(
    "有新的預約",
    "客人已送出預約，正在等待匯款。收到款項後，請到後台按「確認收款」。直接按「回覆」就會寄給客人。",
    [
      ["療癒項目", b.serviceName],
      ["時段", when(b)],
      ["進行方式", MODE[b.mode || "remote"]],
      ["姓名", b.name],
      ["IG", "@" + b.instagram],
      ["Email", b.email],
      ["居住地", REGION[b.region]],
      ["金額", money(b.amount, b.currency, b.priceMode)],
      ["年齡", b.age],
      ["性別", b.gender],
      ["療癒原因", [...(b.reasons || []), ...(b.otherReason ? [b.otherReason] : [])].join("、")],
      ...extra,
      ["想說的話", b.note],
      ["預約編號", b.ref],
    ],
    adminUrl
  );
  c.executionCtx.waitUntil(send(c.env, `新預約：${b.serviceName}｜${b.date} ${b.start}｜${b.name}`, html, b.email).catch((e) => console.error(e)));
}

// 客人回報匯款
export function notifyPaymentReported(c, b, report) {
  const adminUrl = new URL("/admin", c.req.url).toString();
  const html = layout(
    "客人回報已匯款",
    "請核對帳戶是否收到款項，確認後到後台按「確認收款」。直接按「回覆」就會寄給客人。",
    [
      ["療癒項目", b.serviceName],
      ["時段", when(b)],
      ["進行方式", MODE[b.mode || "remote"]],
      ["姓名", b.name],
      ["IG", "@" + b.instagram],
      ["金額", money(b.amount, b.currency, b.priceMode)],
      ["匯款日期", report.paidDate],
      ["帳號末五碼", report.last5],
      ["匯款人", report.payerName],
      ["預約編號", b.ref],
    ],
    adminUrl
  );
  c.executionCtx.waitUntil(send(c.env, `已回報匯款：${b.name}｜末五碼 ${report.last5}`, html, b.email).catch((e) => console.error(e)));
}

function workshopPrice(p) {
  const parts = [];
  if (p?.twd != null) parts.push("NT$" + p.twd.toLocaleString("en-US"));
  if (p?.myr != null) parts.push("RM " + p.myr.toLocaleString("en-US"));
  return parts.join("／");
}

// 前台工作坊報名
export function notifyWorkshopSignup(c, w, a) {
  const adminUrl = new URL("/admin/workshops", c.req.url).toString();
  const dates = w.sessions.map((s) => s.date + (s.start ? ` ${s.start}${s.end ? "–" + s.end : ""}` : "")).join("、");
  const html = layout(
    "有新的工作坊報名",
    "學員已經加進這場工作坊的名單。請和學員聯絡，確認名額與匯款方式。直接按「回覆」就會寄給學員。",
    [
      ["工作坊", w.title],
      ["日期", dates],
      ["姓名", a.name],
      ["英文姓名", a.nameEn],
      ["Email", a.email],
      ["IG", a.instagram ? "@" + a.instagram : ""],
      ["報名身分", a.status === "retake" ? "複訓" : "新生"],
      ["居住地", REGION[a.region]],
      ["費用", workshopPrice(w.prices?.[a.status === "retake" ? "retake" : "new"])],
      ["想說的話", a.note],
      ["目前人數", `${(w.attendees || []).length + 1}${w.capacity ? " / " + w.capacity : ""} 位`],
    ],
    adminUrl
  );
  c.executionCtx.waitUntil(send(c.env, `工作坊報名：${w.title}｜${a.name}`, html, a.email).catch((e) => console.error(e)));
}

// 擺攤現場取號
export function notifyMarketTicket(c, m, t, ahead) {
  const adminUrl = new URL("/admin", c.req.url).toString();
  const s = (m.services || []).find((x) => x.name === t.service);
  const html = layout(
    `擺攤有人取號：${t.number} 號`,
    "客人剛在排隊頁取了號碼，可以到後台的「擺攤」分頁叫號。",
    [
      ["號碼", `${t.number} 號`],
      ["名字", t.name],
      ["項目", t.service],
      ["價格", s?.price],
      ["電話", t.phone],
      ["前面還有", `${ahead} 位`],
      ["地點", m.location],
    ],
    adminUrl
  );
  const subject = `擺攤取號 ${t.number} 號：${t.name}${t.service ? "｜" + t.service : ""}`;
  c.executionCtx.waitUntil(send(c.env, subject, html).catch((e) => console.error(e)));
}

// 全站登入錯誤太多，後台登入暫時鎖住
export function notifyLoginLocked(c, info) {
  const adminUrl = new URL("/admin", c.req.url).toString();
  const tw = (d) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const html = layout(
    "後台登入已暫時鎖住",
    "過去 1 小時內，後台密碼全站累計錯誤超過 10 次，所以先鎖住登入；最多 1 小時後會自動解鎖。如果不是你自己輸錯，建議到 Cloudflare 更換 ADMIN_PASSWORD，並確認 Zero Trust Access 設定正常。",
    [
      ["鎖住時間", tw(info.at) + "（台灣時間）"],
      ["1 小時內錯誤次數", `${info.total} 次`],
      ...info.byIp.map((r) => [`IP ${r._id}`, `${r.count} 次，最後一次 ${tw(r.last)}`]),
    ],
    adminUrl
  );
  c.executionCtx.waitUntil(send(c.env, `後台登入已鎖住：1 小時內錯了 ${info.total} 次`, html).catch((e) => console.error(e)));
}
