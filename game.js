// ビバリウム — 描画・タップで生き物の説明・環境の設定・留守の計算・図鑑・記録・シェア（生態は sim.js）
'use strict';
const VERSION = '1';   // version.txt と合わせる。更新したら index.html の ?v= も上げる
const SITE_URL = 'https://renmy-stack.github.io/vivarium/';
const OFFLINE_CAP = 2 * 3600;   // 留守中に進める上限（秒）
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, sc = 1, cx = 0, cy = 0;

// ---------- 保存 ----------
const KEY = 'viv.';
function lsGet(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) {} }
let world = null, viewing = null;   // viewing: ともだちの皿（見ているだけ）
let speed = 1, selected = null, last = 0, acc = 0, saveT = 0, tickerT = 0, lastEventN = 0;
function load() {
  const s = lsGet('state'), w = s ? VIV.deserialize(s) : null;
  if (w) { world = w; speed = +(lsGet('speed') || 1); if (![1, 4, 16].includes(speed)) speed = 1; return true; }
  world = VIV.createWorld((Math.floor(Math.random() * 65535) + 1) | 0);
  return false;
}
function save() { if (!world) return; lsSet('state', VIV.serialize(world)); lsSet('savedAt', String(Date.now())); lsSet('speed', String(speed)); }
setInterval(save, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); else checkVersion(); });
window.addEventListener('pagehide', save);

// ---------- 画面 ----------
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const top = $('hud').offsetHeight + 8, bottom = $('ctrl').offsetHeight + 16;
  const avail = Math.max(200, H - top - bottom);
  sc = Math.min(W - 16, avail) / (2 * VIV.R + 20);
  cx = W / 2; cy = top + avail / 2;
}
window.addEventListener('resize', resize);
const fmtT = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ':' + String(m).padStart(2, '0') : m + ':' + String(s % 60).padStart(2, '0'); };
function hueColor(h, l) { return 'hsl(' + Math.round(h) + ',70%,' + (l || 60) + '%)'; }
function creatureColor(c) { const l = 62 - c.diet * 18; return 'hsl(' + Math.round(c.hue) + ',' + Math.round(65 + c.diet * 25) + '%,' + l + '%)'; }

// 生き物を描く（g は皿の座標に変換済み）
function drawCreature(g, c, t, alpha) {
  const r = c.size, col = creatureColor(c);
  g.save(); g.translate(c.x, c.y); g.rotate(c.a); if (alpha != null) g.globalAlpha = alpha;
  // しっぽ（速いほど よく動く・長い）
  const wag = Math.sin(t * (4 + c.speed * 9) + c.id) * 0.5 * Math.min(1, c.speed);
  g.strokeStyle = col; g.lineWidth = Math.max(2, r * 0.35); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.8, 0); g.quadraticCurveTo(-r * 1.4, wag * r * 0.6, -r * (1.3 + c.speed * 0.5), wag * r * 1.2); g.stroke();
  // 体
  g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, r * (1 + c.speed * 0.08), r * (1 - c.speed * 0.06), 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.stroke();
  // 目（め が よいほど 大きい）
  const er = Math.max(1.5, Math.min(r * 0.45, 1.5 + c.sight / 45)), ex = r * 0.45, ey = r * 0.42;
  for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, s * ey, er, 0, 7); g.fill(); g.fillStyle = '#0f1f2b'; g.beginPath(); g.arc(ex + er * 0.35, s * ey, er * 0.55, 0, 7); g.fill(); }
  // 口: 肉寄りは キバ
  if (c.diet >= 0.5) { g.fillStyle = '#fff'; const n = c.diet > 0.75 ? 3 : 2; for (let k = 0; k < n; k++) { const y = (k - (n - 1) / 2) * r * 0.32; g.beginPath(); g.moveTo(r * 0.85, y - r * 0.12); g.lineTo(r * 1.15, y); g.lineTo(r * 0.85, y + r * 0.12); g.closePath(); g.fill(); } }
  else { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.arc(r * 0.75, 0, r * 0.22, -1.2, 1.2); g.stroke(); }
  g.restore();
}
function render(t) {
  const w = viewing || world;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0f1f2b'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  // 皿
  const R = VIV.R;
  ctx.fillStyle = '#183447'; ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, 7); ctx.fill();
  const wat = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.2, 0, 0, R); wat.addColorStop(0, '#2b5f70'); wat.addColorStop(1, '#1d4453');
  ctx.fillStyle = wat; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
  // かべ
  if (w.settings.wall) { ctx.fillStyle = '#c9a66b'; ctx.fillRect(-4, -R, 8, 2 * R); }
  // 草
  ctx.strokeStyle = '#7ee08a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const g of w.grass) { ctx.beginPath(); ctx.moveTo(g.x - 3, g.y + 3); ctx.lineTo(g.x, g.y - 4); ctx.lineTo(g.x + 3, g.y + 3); ctx.stroke(); }
  // 肉
  for (const m of w.meat) { ctx.globalAlpha = Math.min(1, m.life / 10); ctx.fillStyle = '#c96a6a'; ctx.beginPath(); ctx.arc(m.x, m.y, 3 + m.size * 0.25, 0, 7); ctx.fill(); ctx.fillStyle = '#f3d1d1'; ctx.beginPath(); ctx.arc(m.x - 1, m.y - 1, 1.5 + m.size * 0.1, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  // 生き物
  for (const c of w.creatures) drawCreature(ctx, c, t);
  if (selected && w.creatures.includes(selected)) {
    const c = selected;
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(c.x, c.y, c.sight, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c.x, c.y, c.size + 6, 0, 7); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#3d6d80'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, 7); ctx.stroke();
  ctx.restore();
}

// ---------- HUD ----------
function updateHud() {
  const w = viewing || world, s = VIV.summary(w);
  $('h-pop').textContent = s.pop; $('h-grass').textContent = s.grass; $('h-gen').textContent = s.maxGen; $('h-time').textContent = fmtT(w.stats.dishT);
  $('h-dex').textContent = Object.keys(w.dex).length;
  for (const seg of document.querySelectorAll('.seg')) { const k = seg.dataset.key, v = k === 'speed' ? speed : w.settings[k]; for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === v); }
  if (w.events.length > lastEventN) { const e = w.events[w.events.length - 1]; $('ticker').textContent = e.text; tickerT = 6; lastEventN = w.events.length; }
}
for (const seg of document.querySelectorAll('.seg')) for (const b of seg.querySelectorAll('button')) b.addEventListener('click', e => {
  e.preventDefault();
  const k = seg.dataset.key, v = +b.dataset.v;
  if (k === 'speed') { speed = v; lsSet('speed', String(v)); }
  else if (!viewing) { world.settings[k] = v; if (k === 'wall' && v) selected = null; }
  updateHud();
});

// ---------- タップ: 生き物の説明 ----------
cv.addEventListener('pointerdown', e => {
  const w = viewing || world, x = (e.clientX - cx) / sc, y = (e.clientY - cy) / sc;
  let best = null, bd = 18 / sc + 8;
  for (const c of w.creatures) { const d = Math.hypot(c.x - x, c.y - y) - c.size; if (d < bd) { bd = d; best = c; } }
  selected = best; showInfo();
});
function showInfo() {
  const c = selected;
  $('info').hidden = !c;
  if (!c) return;
  const name = c.diet > 0.7 ? (c.size > 18 ? 'キング' : c.speed > 1.3 ? 'ハンター' : c.size < 9 ? 'ちびハンター' : 'にくしょく') : c.diet >= 0.4 ? 'なんでも' : c.size > 20 ? 'でかぶつ' : c.size < 7 ? 'ちびすけ' : c.speed > 1.7 ? 'はやいやつ' : c.speed < 0.5 ? 'のろま' : c.sight > 170 ? 'めだま' : c.sight < 45 ? 'めくら' : 'ふつうの いきもの';
  $('i-name').textContent = name;
  $('i-sub').textContent = c.gen + ' 世代目・' + Math.floor(c.age) + ' 秒・こども ' + c.kids;
  const G = VIV.GENES, pct = (v, [a, b]) => Math.round((v - a) / (b - a) * 100);
  $('ib-size').style.width = pct(c.size, G.size) + '%'; $('iv-size').textContent = c.size.toFixed(1);
  $('ib-speed').style.width = pct(c.speed, G.speed) + '%'; $('iv-speed').textContent = c.speed.toFixed(2);
  $('ib-sight').style.width = pct(c.sight, G.sight) + '%'; $('iv-sight').textContent = Math.round(c.sight);
  $('ib-diet').style.width = pct(c.diet, G.diet) + '%'; $('iv-diet').textContent = c.diet < 0.3 ? '草' : c.diet > 0.7 ? '肉' : 'どちらも';
  const body = (0.4 + c.size * c.size * 0.005).toFixed(1), mv = (c.size * c.speed * c.speed * 0.12).toFixed(1), eye = (c.sight * 0.006).toFixed(1);
  const lines = [];
  lines.push('1 秒に へる エネルギー <b>' + VIV.costPerSec(c, true).toFixed(1) + '</b> ＝ からだ ' + body + '（おおきさ²）＋ うごき ' + mv + '（おおきさ × はやさ²）＋ め ' + eye);
  lines.push('くさ 1 つで <b>+' + VIV.grassGain(c).toFixed(0) + '</b>' + (c.diet >= 0.5 ? '、じぶんの 3/4 より 小さい いきものを たべられる' : '') + '。<b>' + VIV.splitAt(c).toFixed(0) + '</b> たまると 2 つに わかれる。じゅみょう ' + VIV.lifespan(c).toFixed(0) + ' 秒');
  $('i-why').innerHTML = lines.join('<br>');
  $('i-energy').textContent = 'エネルギー ' + Math.max(0, c.e).toFixed(0) + ' / ' + VIV.splitAt(c).toFixed(0) + (c.flee ? '　😱 にげている' : c.tk === 1 ? '　🎯 かりの さいちゅう' : c.tk === 2 ? '　🌱 くさへ' : c.tk === 3 ? '　🍖 にくへ' : '　💤 ぶらぶら');
}
$('i-close').addEventListener('click', () => { selected = null; showInfo(); });

// ---------- 図鑑・記録 ----------
function openPanel(title, html) { $('p-title').textContent = title; $('p-body').innerHTML = html; $('panel').hidden = false; }
$('p-close').addEventListener('click', () => { $('panel').hidden = true; });
function sampleCreature(d) {
  const c = { id: 1, x: 0, y: 0, a: 0, size: 12, speed: 1, sight: 80, diet: 0.1, hue: 40, e: 0 };
  ({ chibi: () => { c.size = 6; }, deka: () => { c.size = 22; }, hayai: () => { c.speed = 2; }, noroma: () => { c.speed = 0.4; }, medama: () => { c.sight = 200; }, mekura: () => { c.sight = 35; },
    niku: () => { c.diet = 0.85; c.hue = 0; }, hunter: () => { c.diet = 0.85; c.speed = 1.8; c.hue = 10; }, king: () => { c.diet = 0.85; c.size = 22; c.hue = 340; }, chibihunter: () => { c.diet = 0.85; c.size = 7; c.hue = 20; }, zatsu: () => { c.diet = 0.5; c.hue = 60; }, nagaiki: () => { c.size = 14; c.hue = 200; } })[d.id]();
  return c;
}
function showDex() {
  const w = viewing || world;
  let html = '<div class="dex">';
  for (const d of VIV.DEX) { const got = w.dex[d.id]; html += '<div class="dx' + (got ? '' : ' locked') + '"><canvas data-id="' + d.id + '" width="88" height="88"></canvas><div class="t"><b>' + (got ? d.name : '？？？') + '</b>' + d.why + (got ? '<small>' + fmtT(got.t) + ' に ' + got.gen + ' 世代目で はじめて。これまで ' + got.n + ' 匹</small>' : '<small>まだ あらわれていない</small>') + '</div></div>'; }
  html += '</div>';
  openPanel('図鑑 ' + Object.keys(w.dex).length + ' / ' + VIV.DEX.length, html);
  for (const c of $('p-body').querySelectorAll('canvas')) { const g = c.getContext('2d'), d = VIV.DEX.find(x => x.id === c.dataset.id), got = w.dex[d.id]; g.setTransform(1.7, 0, 0, 1.7, 44, 44); if (!got) g.filter = 'grayscale(1) brightness(0.3)'; drawCreature(g, sampleCreature(d), 0); }
}
function showRecords() {
  const w = viewing || world, st = w.stats, sp = VIV.species(w);
  let html = '<div class="recs"><div class="rc">さいだい 人口<b>' + st.maxPop + '</b></div><div class="rc">さいだい 世代<b>' + st.maxGen + '</b></div><div class="rc">皿の とし<b>' + fmtT(st.dishT) + '</b></div><div class="rc">ぜつめつ<b>' + st.extinctions + ' 回</b></div><div class="rc">うまれた<b>' + st.births + '</b></div><div class="rc">たべられた<b>' + st.eaten + '</b></div></div>';
  html += '<div style="font-size:12px;font-weight:800;margin:4px 0">いま いる 種（色と かたちで まとめた）: ' + sp.length + '</div><div class="evlog" style="max-height:18vh">' + sp.slice(0, 8).map(g => '<div><span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:' + hueColor(g.hue) + '"></span> ' + g.n + ' 匹　おおきさ ' + g.size.toFixed(0) + '・はやさ ' + g.speed.toFixed(1) + '・め ' + g.sight.toFixed(0) + '・' + (g.diet < 0.3 ? '草' : g.diet > 0.7 ? '肉' : 'どちらも') + '</div>').join('') + '</div>';
  html += '<div style="font-size:12px;font-weight:800;margin:8px 0 4px">できごと</div><div class="evlog">' + w.events.slice(-40).reverse().map(e => '<div><span>' + fmtT(e.t) + '</span>' + e.text + '</div>').join('') + '</div>';
  html += '<div class="rbtns">' + (viewing ? '' : '<button id="share" class="main">この皿を ともだちに 見せる</button><button id="newdish" class="sub">あたらしい 皿に する</button>') + '</div>';
  openPanel('きろく', html);
  if (!viewing) { $('share').addEventListener('click', shareDish); $('newdish').addEventListener('click', () => { $('p-body').innerHTML = '<div style="text-align:center;font-weight:800">いまの 皿は きえます。いいですか？</div><div class="rbtns"><button id="yes" class="main">あたらしい 皿に する</button><button id="no" class="sub">やめる</button></div>'; $('yes').addEventListener('click', () => { world = VIV.createWorld((Math.floor(Math.random() * 65535) + 1) | 0); selected = null; lastEventN = 0; save(); $('panel').hidden = true; updateHud(); }); $('no').addEventListener('click', () => { $('panel').hidden = true; }); }); }
}
$('b-dex').addEventListener('click', showDex);
$('b-rec').addEventListener('click', showRecords);

// ---------- 留守の計算 ----------
let offline = null;   // { left, total, ev0 }
function startOffline(sec) {
  offline = { left: sec, total: sec, ev0: world.events.length, pop0: world.creatures.length, gen0: world.stats.maxGen };
  $('overlay').hidden = false; $('o-fill').style.width = '0%'; $('o-text').textContent = 'るすの あいだ ' + fmtT(sec) + ' ぶん';
}
function offlineSlice() {
  const t0 = performance.now();
  while (offline.left > 0 && performance.now() - t0 < 14) { VIV.step(world); offline.left -= VIV.DT; }
  $('o-fill').style.width = Math.round((1 - offline.left / offline.total) * 100) + '%';
  if (offline.left <= 0) {
    const evs = world.events.slice(offline.ev0);
    const txt = '<div style="text-align:left;font-size:13px;line-height:1.5">' + (evs.length ? evs.slice(-12).map(e => '・' + e.text).join('<br>') : '・とくに かわったことは なかった') + '</div><div style="margin-top:8px;font-weight:800">人口 ' + offline.pop0 + ' → ' + world.creatures.length + '　世代 ' + offline.gen0 + ' → ' + world.stats.maxGen + '</div>';
    $('overlay').hidden = true; offline = null; lastEventN = world.events.length;
    openPanel('るすちゅうの できごと', txt);
    save();
  }
}

// ---------- ともだちの皿 ----------
function openFriend(d) {
  viewing = VIV.worldFromDish(d, 1); viewing.stats.maxPop = d.maxPop; viewing.stats.dishT = d.minutes * 60; viewing.stats.extinctions = d.extinctions;
  selected = null;
  $('banner').hidden = false; $('banner-text').textContent = 'ともだちの 皿（見ているだけ）: 人口 ' + d.creatures.length + '・世代 ' + d.maxGen + '・図鑑 ' + d.dex;
  $('banner-btn').textContent = 'この皿を もらう'; $('banner-btn2').textContent = 'じぶんの 皿へ';
  $('banner-btn').onclick = () => { openPanel('ともだちの 皿を もらう', '<div style="font-weight:800;text-align:center">いまの じぶんの 皿は きえて、ともだちの 皿の つづきを そだてます。いいですか？</div><div class="rbtns"><button id="yes" class="main">もらう</button><button id="no" class="sub">やめる</button></div>'); $('yes').addEventListener('click', () => { world = VIV.worldFromDish(d, (Math.floor(Math.random() * 65535) + 1) | 0); viewing = null; selected = null; lastEventN = 0; $('banner').hidden = true; $('panel').hidden = true; save(); updateHud(); }); $('no').addEventListener('click', () => { $('panel').hidden = true; }); };
  $('banner-btn2').onclick = () => { viewing = null; selected = null; $('banner').hidden = true; updateHud(); };
  updateHud();
}

// ---------- シェア ----------
function dishImage() {
  const S = 600, c = document.createElement('canvas'); c.width = S * 2; c.height = (S + 120) * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  g.fillStyle = '#0f1f2b'; g.fillRect(0, 0, S, S + 120);
  g.fillStyle = '#fff'; g.font = '900 30px sans-serif'; g.textAlign = 'center'; g.fillText('ビバリウム', S / 2, 42);
  const st = world.stats; g.font = '800 16px sans-serif'; g.fillStyle = '#ffe08a';
  g.fillText('人口 ' + world.creatures.length + '　世代 ' + st.maxGen + '　皿の とし ' + fmtT(st.dishT) + '　図鑑 ' + Object.keys(world.dex).length + '/' + VIV.DEX.length, S / 2, 70);
  const save0 = { cx, cy, sc }; cx = S / 2; cy = 90 + (S - 40) / 2; sc = (S - 40) / (2 * VIV.R + 20);
  drawScene(g, 0);
  cx = save0.cx; cy = save0.cy; sc = save0.sc;
  g.fillStyle = '#9fb3c0'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText(SITE_URL, S / 2, S + 100);
  return c.toDataURL('image/png');
}
function drawScene(g, t) {
  const w = viewing || world, R = VIV.R;
  g.save(); g.translate(cx, cy); g.scale(sc, sc);
  g.fillStyle = '#183447'; g.beginPath(); g.arc(0, 0, R + 10, 0, 7); g.fill();
  g.fillStyle = '#1f4a5a'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
  if (w.settings.wall) { g.fillStyle = '#c9a66b'; g.fillRect(-4, -R, 8, 2 * R); }
  g.strokeStyle = '#7ee08a'; g.lineWidth = 2; g.lineCap = 'round';
  for (const gr of w.grass) { g.beginPath(); g.moveTo(gr.x - 3, gr.y + 3); g.lineTo(gr.x, gr.y - 4); g.lineTo(gr.x + 3, gr.y + 3); g.stroke(); }
  for (const m of w.meat) { g.fillStyle = '#c96a6a'; g.beginPath(); g.arc(m.x, m.y, 3 + m.size * 0.25, 0, 7); g.fill(); }
  for (const c of w.creatures) drawCreature(g, c, t);
  g.restore();
  g.strokeStyle = '#3d6d80'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, R + 7, 0, 7); g.stroke();
  g.restore();
}
function shareDish() {
  const dataUrl = dishImage();
  const bin = atob(dataUrl.split(',')[1]), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const file = new File([buf], 'vivarium.png', { type: 'image/png' });
  const st = world.stats;
  const text = 'ビバリウム: ぼくの 皿\n人口 ' + world.creatures.length + '・' + st.maxGen + ' 世代・図鑑 ' + Object.keys(world.dex).length + '/' + VIV.DEX.length + '\n皿を 見に きて →\n' + SITE_URL + '#d=' + VIV.encodeDish(world) + '\n#ビバリウム';
  const fallback = err => { if (!err || err.name !== 'AbortError') { $('shareimg').src = dataUrl; $('sharetext').value = text; $('sharebox').hidden = false; } };
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], text }).catch(fallback);
  else if (navigator.share) navigator.share({ text }).catch(fallback);
  else fallback();
}
$('closeshare').addEventListener('click', () => { $('sharebox').hidden = true; });
$('copy').addEventListener('click', () => {
  const ta = $('sharetext'); ta.select();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).catch(() => {}); else document.execCommand('copy');
  $('copy').textContent = 'コピーしました'; setTimeout(() => { $('copy').textContent = '文をコピー'; }, 1500);
});

// ---------- ループ ----------
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (offline) offlineSlice();
  else {
    const w = viewing || world;
    acc += dt * speed; let n = 0;
    while (acc >= VIV.DT && n < 24 * speed) { VIV.step(w); acc -= VIV.DT; n++; }
    if (n >= 24 * speed) acc = 0;
    if (selected && !w.creatures.includes(selected)) { selected = null; showInfo(); } else if (selected && n) showInfo();
  }
  if (tickerT > 0) { tickerT -= dt; if (tickerT <= 0) $('ticker').textContent = ''; }
  updateHud();
  render(now / 1000);
  requestAnimationFrame(frame);
}

// ---------- 開発用 ----------
window.ff = sec => { VIV.run(viewing || world, sec); updateHud(); return VIV.summary(viewing || world); };
window.W = () => world;

// ---------- 自動更新 ----------
async function checkVersion() {
  try {
    const r = await fetch('version.txt?ts=' + Date.now(), { cache: 'no-store' });
    const v = (await r.text()).trim();
    if (v && v !== VERSION && !offline) {
      let tried = ''; try { tried = sessionStorage.getItem(KEY + 'reloadFor') || ''; } catch (e) {}
      if (tried === v) return;
      try { sessionStorage.setItem(KEY + 'reloadFor', v); } catch (e) {}
      save(); location.reload();
    }
  } catch (e) {}
}
window.addEventListener('pageshow', e => { if (e.persisted) checkVersion(); });
checkVersion();

// ---------- 開始 ----------
try { if (lsGet('simv') !== String(VIV.SIM_VERSION)) { localStorage.removeItem(KEY + 'state'); localStorage.removeItem(KEY + 'savedAt'); lsSet('simv', String(VIV.SIM_VERSION)); } } catch (e) {}
const hadSave = load();
resize(); updateHud(); lastEventN = world.events.length;
{
  const q = new URLSearchParams(location.search), m = /[#&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
  const d = m ? VIV.decodeDish(m[1]) : null;
  if (d) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} openFriend(d); }
  else if (hadSave) {
    const at = +(lsGet('savedAt') || 0), el = at ? Math.min(OFFLINE_CAP, (Date.now() - at) / 1000) : 0;
    if (el > 30 && !q.has('nooff')) startOffline(el);
  }
  if (q.has('ff')) { VIV.run(world, +q.get('ff')); lastEventN = world.events.length; updateHud(); }
  if (q.has('sel')) { selected = world.creatures[0] || null; showInfo(); }
  if (q.has('dex')) showDex();
  if (q.has('rec')) showRecords();
  if (q.has('off')) startOffline(+q.get('off'));
}
requestAnimationFrame(frame);
