# 產生 public/ 下的頁面：python3 tools/build_pages.py public
import os, sys
out = sys.argv[1]

def svg(body, vb="0 0 100 100", stroke="#fff", sw=2.4, fill="none"):
    return f'<svg viewBox="{vb}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>'

G = {
 "moon": svg('<path d="M64 20a32 32 0 1 0 18 52A27 27 0 0 1 64 20z" fill="rgba(255,255,255,.85)"/><path d="M28 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" stroke="none"/>'),
 "spiral": svg('<path d="M52 50a3 3 0 1 1-6 0a8 8 0 1 1 16 0a14 14 0 1 1-28 0a20 20 0 1 1 40 0a26 26 0 1 1-52 0"/>'),
 "constellation": svg('<path d="M18 70L36 46L56 54L72 26L86 40"/><circle cx="18" cy="70" r="3.5" fill="#fff"/><circle cx="36" cy="46" r="3" fill="#fff"/><circle cx="56" cy="54" r="3.5" fill="#fff"/><circle cx="72" cy="26" r="4.5" fill="#fff"/><circle cx="86" cy="40" r="3" fill="#fff"/>'),
 "rings": svg('<circle cx="50" cy="50" r="8" fill="rgba(255,255,255,.9)"/><circle cx="50" cy="50" r="20"/><circle cx="50" cy="50" r="32" stroke-opacity=".7"/><circle cx="50" cy="50" r="44" stroke-opacity=".4"/>'),
 "flame": svg('<path d="M50 14c8 14 24 24 24 44a24 24 0 0 1-48 0c0-12 7-19 12-25 1 9 5 13 10 14-3-12-2-22 2-33z" fill="rgba(255,255,255,.35)"/><path d="M50 52c4 6 9 9 9 16a9 9 0 0 1-18 0c0-6 5-10 9-16z" fill="#fff"/>'),
 "sun": svg('<circle cx="50" cy="50" r="14" fill="rgba(255,255,255,.9)"/><path d="M50 16v12M50 72v12M16 50h12M72 50h12M26 26l8 8M66 66l8 8M74 26l-8 8M34 66l-8 8"/>'),
 "lotus": svg('<path d="M50 78c-14 0-28-8-30-22 10 0 18 4 22 10-4-14 0-28 8-38 8 10 12 24 8 38 4-6 12-10 22-10-2 14-16 22-30 22z" fill="rgba(255,255,255,.35)"/><path d="M28 86h44"/>'),
 "wave": svg('<circle cx="68" cy="30" r="9" fill="#fff"/><path d="M12 58c10-8 20-8 30 0s20 8 30 0 14-6 18-4"/><path d="M12 72c10-8 20-8 30 0s20 8 30 0 14-6 18-4" stroke-opacity=".7"/><path d="M12 86c10-8 20-8 30 0s20 8 30 0 14-6 18-4" stroke-opacity=".4"/>'),
 "heart": svg('<path d="M50 80S16 60 16 36a16 16 0 0 1 34-6 16 16 0 0 1 34 6c0 24-34 44-34 44z" fill="rgba(255,255,255,.35)"/>'),
 "paw": svg('<ellipse cx="50" cy="64" rx="17" ry="14" fill="rgba(255,255,255,.85)" stroke="none"/><circle cx="28" cy="44" r="7" fill="#fff" stroke="none"/><circle cx="42" cy="30" r="7" fill="#fff" stroke="none"/><circle cx="58" cy="30" r="7" fill="#fff" stroke="none"/><circle cx="72" cy="44" r="7" fill="#fff" stroke="none"/>'),
 "blueprint": svg('<circle cx="50" cy="50" r="30"/><path d="M50 20v60M20 50h60M29 29l42 42M71 29L29 71" stroke-opacity=".55"/><circle cx="50" cy="50" r="10" fill="rgba(255,255,255,.9)"/>'),
 "door": svg('<path d="M28 86V44a22 22 0 0 1 44 0v42" /><path d="M36 86V46a14 14 0 0 1 28 0v40" fill="rgba(255,255,255,.55)" stroke-opacity=".6"/><path d="M18 86h64"/><path d="M50 14l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#fff" stroke="none"/>'),
 "book": svg('<path d="M18 26c10-4 22-4 32 4 10-8 22-8 32-4v50c-10-4-22-4-32 4-10-8-22-8-32-4z" fill="rgba(255,255,255,.3)"/><path d="M50 30v50"/>'),
 "card": svg('<rect x="28" y="16" width="44" height="64" rx="8" fill="rgba(255,255,255,.35)"/><path d="M50 36l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" stroke="none"/>'),
 "link": svg('<path d="M42 58l16-16"/><path d="M36 50l-8 8a11 11 0 0 0 16 16l8-8"/><path d="M64 50l8-8a11 11 0 0 0-16-16l-8 8"/>'),
 "bag": svg('<path d="M24 36h52l-4 46H28z" fill="rgba(255,255,255,.35)"/><path d="M38 36v-6a12 12 0 0 1 24 0v6"/>'),
 "pen": svg('<path d="M26 74l6-18 34-34 12 12-34 34z" fill="rgba(255,255,255,.35)"/><path d="M60 28l12 12"/><path d="M22 84h56"/>'),
 "camera": svg('<rect x="18" y="26" width="64" height="50" rx="16" fill="rgba(255,255,255,.3)"/><circle cx="50" cy="51" r="13"/><circle cx="68" cy="37" r="2.5" fill="#fff" stroke="none"/>'),
}

def art(glyph, g, cls=""):
    return f'<div class="art {g} {cls}">{G[glyph]}</div>'

I = {
 "home": '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
 "services": '<path d="M12 20c-4 0-8-3-8-7 3 0 5 1 6 3-1-4 0-8 2-11 2 3 3 7 2 11 1-2 3-3 6-3 0 4-4 7-8 7z"/>',
 "oracle": '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>',
 "workshops": '<path d="M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5z"/><path d="M12 6v13.5"/>',
 "about": '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
}
def icon(name, sw=1.6):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{I[name]}</svg>'
CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'

TABS = [("/", "home", "首頁"), ("/services", "services", "服務"), ("/oracle", "oracle", "訊息"), ("/workshops", "workshops", "工作坊"), ("/about", "about", "關於")]
def tabbar(cur):
    items = []
    for href, key, label in TABS:
        c = ' aria-current="page"' if key == cur else ''
        items.append(f'  <a href="{href}"{c}>{icon(key)}<span>{label}</span></a>')
    return '<nav class="tabbar" aria-label="主要選單">\n' + '\n'.join(items) + '\n</nav>'

def appbar(title, sub, back=True, centered=False):
    b = f'<a class="back" href="/">{BACK}首頁</a>' if back else ''
    c = ' centered' if centered else ''
    return f'''  <header class="appbar{c}">
    {b}
    <h1>{title}</h1>
    <p class="sub">{sub}</p>
  </header>'''

FOOT = '''  <footer class="foot">
    <div class="links">
      <a href="https://www.instagram.com/nieia9319/" target="_blank" rel="noopener">Instagram @nieia9319</a>
      <a href="https://linktr.ee/nieia9319" target="_blank" rel="noopener">Linktree</a>
    </div>
    <p>療癒屬於身心靈探索與能量調理，旨在陪伴與引導，無法取代任何正統醫療、心理諮商或法律診斷。如有相關疾病，請尋求專業醫療協助。</p>
  </footer>'''

def page(fname, title, cur, main, extra_js=()):
    js = ['/assets/holo.js', '/assets/site.js'] + list(extra_js)
    scripts = '\n'.join(f'<script src="{s}"></script>' for s in js)
    html = f'''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icons/favicon-16.png" type="image/png" sizes="16x16">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#9698E7">
<meta name="apple-mobile-web-app-title" content="NIEIA">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Noto+Sans+TC:wght@400;500;600&family=Noto+Serif+TC:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<div class="aura" aria-hidden="true"></div>
<canvas id="holoA" aria-hidden="true"></canvas>
<div class="holoB" id="holoB" aria-hidden="true" hidden></div>
<div class="grain" aria-hidden="true"></div>

<main class="app">
{main}

{FOOT}
</main>

{tabbar(cur)}
{scripts}
</body>
</html>
'''
    open(os.path.join(out, fname), 'w').write(html)

def row(href, glyph, g, title, en, desc, meta, cat=None, tag="a"):
    attr = f' data-cat="{cat}"' if cat else ''
    hrefattr = f' href="{href}"' if tag == "a" else ''
    go = f'<span class="go">{CHEV}</span>' if tag == "a" else ''
    en_html = f'<span class="en">{en}</span>' if en else ''
    meta_html = f'<span class="meta">{meta}</span>' if meta else ''
    desc_html = f'<span class="desc">{desc}</span>' if desc else ''
    return f'''      <{tag} class="row glass"{hrefattr}{attr}>
        {art(glyph, g)}
        <div class="text"><h3>{title}</h3>{en_html}{desc_html}{meta_html}</div>
        {go}
      </{tag}>'''

# ---------------- home ----------------
reasons = [("moon","g1","身體需要放鬆"),("wave","g2","情緒需要梳理"),("heart","g4","關係渴望和諧"),
           ("spiral","g3","想要個人成長"),("constellation","g6","尋求靈性支持"),("sun","g5","為特定事件祝福")]
tiles = '\n'.join(f'      <a class="tile glass" href="/services">{art(gl,g)}<span class="label">{t}</span></a>' for gl,g,t in reasons)
home = f'''  <header class="appbar">
    <p class="sub"><span data-greeting>你好，</span>歡迎來到</p>
    <div class="brand"><h1>阿綸涅亞</h1><span class="en">NIEIA</span></div>
  </header>

  <section class="feature glass" aria-labelledby="door-title">
    <div class="orb">{G["door"]}</div>
    <h2 id="door-title">療癒，是為你打開一扇門</h2>
    <p>在安全、不帶評判的空間裡，陪你看見自己本來就擁有的力量。台灣與馬來西亞皆可透過 IG 視訊遠距進行。</p>
    <div class="actions">
      <a class="btn btn-primary" href="/services">預約療癒</a>
      <a class="btn btn-ghost" href="/oracle">抽一張宇宙訊息</a>
    </div>
  </section>

  <section class="block" aria-labelledby="reasons-title">
    <div class="block-head"><h2 id="reasons-title">你是不是正在經歷</h2><a href="/services">看全部服務</a></div>
    <div class="tiles">
{tiles}
    </div>
  </section>

  <section class="block" aria-labelledby="more-title">
    <div class="block-head"><h2 id="more-title">更多</h2></div>
    <div class="rows">
{row("/oracle","card","g2","今日宇宙訊息","","靜下心，抽一張 68 張中屬於你的訊息。","")}
{row("/workshops","book","g3","工作坊","","臼井聖火靈氣、擴大療癒，兩天完整教學。","目前開放約課")}
{row("/shop","bag","g5","聖照選物","","紫色火焰、聖哲曼、默基瑟德等聖照卡。","")}
{row("/about","lotus","g1","關於阿綸","","在台灣當上班族的馬來西亞人，斜槓身心靈。","")}
    </div>
  </section>'''
page('index.html', '阿綸涅亞 NIEIA', 'home', home)

# ---------------- services ----------------
svc = [
 ("flame","g5","擴大療癒","Magnified Healing®","連結觀音與宇宙源頭的能量，深入情緒與靈性層面，溫柔地清理與平衡。","energy"),
 ("sun","g2","聖火／卡魯那靈氣","Holy Fire® Karuna Reiki","溫和而高頻的聖火能量，陪伴身心進入深層放鬆，協助淨化與調頻。","energy"),
 ("lotus","g4","準提佛母火典","Cundi Arathi","以準提佛母的火典儀式獻上祝福，為你的心願與生活帶來清淨的力量。","blessing"),
 ("wave","g3","引渡之光","Light of Transmutation","為已逝的摯愛送上光與祝福，陪伴離開的人與留下的人，各自安心前行。","blessing"),
 ("blueprint","g6","靈魂藍圖諮詢","Soul Plan Consultation","從你的出生資料，看見這一世的天賦、挑戰與靈魂想走的方向。","consult"),
 ("paw","g1","動物溝通","Animal Communication","聆聽毛孩想說的話，理解牠的感受與需要，讓彼此的陪伴更靠近。","consult"),
]
svc_rows = '\n'.join(row("#booking", gl, g, t, en, d, "IG 視訊遠距｜價格即將公布", cat) for gl,g,t,en,d,cat in svc)
services = f'''{appbar("療癒服務", "六種療癒方式，皆以 IG 視訊遠距進行，台灣與馬來西亞都能預約。選好項目後，預約時會依項目詢問需要的資料。")}

  <div class="chips" role="group" aria-label="依類型篩選" data-filter-group="#svc-list">
    <button class="chip" type="button" data-filter="all" aria-pressed="true">全部</button>
    <button class="chip" type="button" data-filter="energy" aria-pressed="false">能量療癒</button>
    <button class="chip" type="button" data-filter="blessing" aria-pressed="false">祝福儀式</button>
    <button class="chip" type="button" data-filter="consult" aria-pressed="false">諮詢與溝通</button>
  </div>

  <section class="rows" id="svc-list" aria-label="療癒項目">
{svc_rows}
  </section>

  <section class="notice glass" id="booking" aria-labelledby="notice-title">
    <h2 id="notice-title">預約須知</h2>
    <ul>
      <li>線上預約即將開放，目前請透過 IG 私訊 @nieia9319 預約。</li>
      <li>療程一律先付款，完成匯款後寄出確認信。</li>
      <li>需改期請於 24 小時前告知，改期需酌收行政費用。</li>
      <li>療程前請先追蹤並私訊 @nieia9319，當天以 IG 視訊進行。</li>
    </ul>
  </section>'''
page('services.html', '療癒服務｜阿綸涅亞 NIEIA', 'services', services, ['/assets/glyphs.js', '/assets/catalog.js'])

# ---------------- oracle ----------------
oracle = f'''{appbar("宇宙訊息", "靜下來，深呼吸一次，想著此刻心裡的問題，再輕觸卡片。68 張來自光的訊息，會有一張剛好屬於你。", centered=True)}

  <section class="deck" aria-label="抽卡">
    <div class="card" id="card" role="button" tabindex="0" aria-live="polite" aria-label="輕觸抽一張宇宙訊息">
      <div class="card-inner">
        <div class="face face-front">
          <div class="sigil"><span class="label">宇宙訊息</span></div>
        </div>
        <div class="face face-back">
          <h3 id="cardTitle">一切安好</h3>
          <p id="cardMessage">別擔心，一切都在神聖的安排之中。</p>
          <div class="count" id="cardCount"></div>
        </div>
      </div>
    </div>
    <button class="btn btn-primary" id="drawBtn" type="button">抽一張</button>
    <p class="deck-hint">抽到的卡片之後可以存成圖片，分享到 IG 限時動態。</p>
  </section>'''
page('oracle.html', '宇宙訊息｜阿綸涅亞 NIEIA', 'oracle', oracle, ['/assets/oracle.js'])

# ---------------- workshops ----------------
def ws_panel(pid, tabid, hidden, glyph, g, title, en, intro, facts, topics, prices):
    topics_html = ''.join(f'<span>{t}</span>' for t in topics)
    rows_html = '\n'.join(f'            <tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>' for a,b,c in prices)
    facts_html = ''.join(f'<span>{f}</span>' for f in facts)
    h = ' hidden' if hidden else ''
    return f'''  <section class="panel" id="{pid}" role="tabpanel" aria-labelledby="{tabid}"{h}>
    <div class="feature glass">
      <div class="orb">{G[glyph]}</div>
      <h2>{title}</h2>
      <div class="en">{en}</div>
      <p>{intro}</p>
      <div class="facts">{facts_html}</div>
    </div>
    <div class="card-block glass">
      <h2>課程內容</h2>
      <div class="topics">{topics_html}</div>
    </div>
    <div class="card-block glass">
      <h2>費用</h2>
      <table class="prices">
        <thead><tr><th scope="col">報名身分</th><th scope="col">台灣</th><th scope="col">馬來西亞</th></tr></thead>
        <tbody>
{rows_html}
        </tbody>
      </table>
      <div class="actions"><a class="btn btn-primary" href="https://www.instagram.com/nieia9319/" target="_blank" rel="noopener">IG 私訊約課</a></div>
    </div>
  </section>'''

workshops = f'''{appbar("工作坊", "兩天的完整教學，結束後就能為自己、家人、朋友與毛孩傳送能量。目前僅開放約課，額滿即止。")}

  <div class="seg" role="tablist" aria-label="選擇課程" data-tabs>
    <button type="button" role="tab" id="tab-reiki" aria-controls="panel-reiki" aria-selected="true">臼井聖火靈氣</button>
    <button type="button" role="tab" id="tab-mh" aria-controls="panel-mh" aria-selected="false" tabindex="-1">擴大療癒</button>
  </div>

{ws_panel("panel-reiki","tab-reiki",False,"sun","g2","臼井聖火靈氣 I & II 階","Usui / Holy Fire® Reiki I & II",
  "結合傳統臼井靈氣與高頻的聖火能量，以點燃與靈授點化的方式，讓能量直接由聖火源頭傳給學員。",
  ["2 天","至少 16 小時","僅開放約課"],
  ["靈氣的起源和歷史","靈氣五戒","人體能量系統","完整手位法","合掌冥想","病腺掃描","靈視法","乾浴法","凝視法","遠距離傳送靈氣","二階符號","靈授點化"],
  [("新生","NT$16,800","RM 2,100"),("複訓","NT$13,000","RM 1,600")])}

{ws_panel("panel-mh","tab-mh",True,"flame","g5","擴大療癒一階","Magnified Healing® 1st Phase",
  "透過擴大個人與宇宙能量源頭的連結，進行深入的靈性與情感療癒，完成後授證成為擴大療癒法的教師。",
  ["連續 2 天","至少 18 小時","第二天請穿白衣","僅開放約課"],
  ["神聖授權冥想","連結靈性中心點","清理光的管道","療癒自己與他人","連結神經系統","平衡因果業力","為揚升作準備","遠距療癒","療癒地球","點化與授證"],
  [("新生","NT$13,000","RM 1,800"),("複訓","NT$9,800","RM 900")])}

  <section class="notice glass" aria-labelledby="ws-notice">
    <h2 id="ws-notice">退費須知</h2>
    <ul>
      <li>課前 4 至 7 天取消：收取 10% 行政作業費</li>
      <li>課前 2 至 3 天取消：收取 15% 行政作業費</li>
      <li>課前當天取消：收取 50% 行政作業費</li>
      <li>課程需提前訂購教材，請於課前兩週完成匯款。</li>
    </ul>
  </section>'''
page('workshops.html', '工作坊｜阿綸涅亞 NIEIA', 'workshops', workshops)

# ---------------- about ----------------
creds = [
 ("flame","g5","擴大療癒法®一階工作坊教師","Teacher, Magnified Healing® 1st Phase"),
 ("flame","g5","擴大療癒法®一階線上復習與高深資訊教師","Teacher, 1st Phase & Advanced Studies"),
 ("flame","g5","擴大療癒法®二階慶典指導員","Teacher-Director, Magnified Healing® Celebration"),
 ("flame","g5","擴大療癒法®三階光能療癒教師","Teacher, 3rd Phase Light Healing"),
 ("sun","g2","臼井聖火靈氣 3 & 師傅階","Usui / Holy Fire® III Reiki Master"),
 ("sun","g2","聖火靈氣卡魯那師傅階","Holy Fire® III Karuna Reiki®"),
 ("constellation","g6","光的課程（行星二）","A Course in Light"),
 ("paw","g1","動物溝通","Animal Communication"),
 ("lotus","g4","譚崔項鍊、光語","Tantric Necklace, Light Language"),
]
cred_rows = '\n'.join(row("", gl, g, t, en, "", "", tag="div") for gl,g,t,en in creds)
links = '\n'.join([
 row("https://www.instagram.com/nieia9319/","camera","g4","Instagram","@nieia9319","私訊預約與約課","").replace('<a class="row glass" href="https://www.instagram.com/nieia9319/"','<a class="row glass" href="https://www.instagram.com/nieia9319/" target="_blank" rel="noopener"'),
 row("/shop","bag","g5","聖照選物","","紫色火焰、聖哲曼、默基瑟德等聖照卡",""),
 row("https://vocus.cc/salon/67e4f401fd897800019395cf","pen","g3","方格子文章","Vocus","阿綸的身心靈筆記","").replace('href="https://vocus','target="_blank" rel="noopener" href="https://vocus'),
 row("https://linktr.ee/nieia9319","link","g6","Linktree","","所有連結一次看","").replace('href="https://linktr','target="_blank" rel="noopener" href="https://linktr'),
])
about = f'''  <header class="appbar"><a class="back" href="/">{BACK}首頁</a></header>

  <section class="profile glass" aria-labelledby="about-title">
    <div class="avatar" aria-hidden="true">綸</div>
    <h1 id="about-title">阿綸涅亞</h1>
    <p>一個在台灣當上班族的馬來西亞人，也是斜槓的身心靈工作者。帶著對生命的慈悲與熱愛，陪伴每一個靈魂找回內在的純淨與力量。</p>
  </section>

  <section class="block" aria-labelledby="creds-title">
    <div class="block-head"><h2 id="creds-title">身心靈探索歷程</h2></div>
    <div class="rows">
{cred_rows}
    </div>
  </section>

  <section class="block" aria-labelledby="links-title">
    <div class="block-head"><h2 id="links-title">找到阿綸</h2></div>
    <div class="rows">
{links}
    </div>
  </section>'''
page('about.html', '關於阿綸｜阿綸涅亞 NIEIA', 'about', about)


# ---------------- shop ----------------
SEED_PRODUCTS = [("紫色火焰","flame","g1"),("YHWH 四字神名","sun","g5"),("聖哲曼聖照","lotus","g4"),("默基瑟德聖照","constellation","g6"),("瑟拉貝斯彼聖照","rings","g2")]
SHOP_URL = "https://myship.7-11.com.tw/general/detail/GM2512190455934"
shop_tiles = '\n'.join(
  f'      <a class="tile product glass" href="{SHOP_URL}" target="_blank" rel="noopener">{art(gl,g)}<span class="label">{n}</span><span class="price">NT$300</span><span class="pdesc">105 × 148 mm 聖照卡，可放在聖壇、書桌或隨身帶著。</span></a>'
  for n,gl,g in SEED_PRODUCTS)
shop = f'''{appbar("聖照選物", "阿綸親自挑選與加持的聖照卡。點選商品會前往 7-11 賣貨便下單，可在台灣的 7-11 取貨。")}

  <section class="tiles shop" id="shop-list" aria-label="商品">
{shop_tiles}
  </section>

  <section class="notice glass" aria-labelledby="shop-notice">
    <h2 id="shop-notice">購買須知</h2>
    <ul>
      <li>目前透過 7-11 賣貨便下單與取貨。</li>
      <li>馬來西亞的朋友想購買，請先 IG 私訊 @nieia9319 詢問寄送方式。</li>
    </ul>
  </section>'''
page('shop.html', '聖照選物｜阿綸涅亞 NIEIA', '', shop, ['/assets/glyphs.js', '/assets/catalog.js'])

# ---------------- 404 ----------------
nf = f'''  <section class="feature glass" aria-labelledby="nf-title" style="margin-top:2rem">
    <div class="orb">{G["door"]}</div>
    <h2 id="nf-title">找不到這一頁</h2>
    <p>這個網址可能已經更改或不存在。你可以回到首頁，或從下方選單前往想看的頁面。</p>
    <div class="actions"><a class="btn btn-primary" href="/">回到首頁</a></div>
  </section>'''
page('404.html', '找不到頁面｜阿綸涅亞 NIEIA', '', nf)
print("ok")
