// ビバリウム — 描画・タップで生き物の説明（式と家系図）・環境の設定・留守の計算・図鑑・ミッション・グラフ・シェア（生態は sim.js）
'use strict';
const VERSION = '2';   // version.txt と合わせる。更新したら index.html の ?v= も上げる
const SITE_URL = 'https://renmy-stack.github.io/vivarium/';
const OFFLINE_CAP = 3600;   // 留守中に進める上限（秒）。1 時間で 10〜30 秒かかる
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, sc = 1, cx = 0, cy = 0;

// ---------- 保存 ----------
const KEY = 'viv.';
function lsGet(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) {} }
let world = null, viewing = null;   // viewing: ともだちの皿（見ているだけ）
let speed = 1, selected = null, last = 0, acc = 0, tickerT = 0, lastEventN = 0;
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
  const top = $('hud').offsetHeight + 6, bottom = $('ctrl').offsetHeight + 14;
  const avail = Math.max(200, H - top - bottom);
  sc = Math.min(W - 12, avail) / (2 * VIV.R + 20);
  cx = W / 2; cy = top + avail / 2;
}
window.addEventListener('resize', resize);
const fmtT = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ':' + String(m).padStart(2, '0') : m + ':' + String(s % 60).padStart(2, '0'); };
function hueColor(h, l) { return 'hsl(' + Math.round(h) + ',70%,' + (l || 60) + '%)'; }
function creatureColor(c) { const l = 62 - c.diet * 18; return 'hsl(' + Math.round(c.hue) + ',' + Math.round(65 + c.diet * 25) + '%,' + l + '%)'; }

// 生き物を描く（g は皿の座標に変換済み）。から = 背中の板、どく = むらさきの斑点、め = 目の大きさ、はやさ = しっぽ、たべもの = キバ
function drawCreature(g, c, t) {
  const r = c.size, col = creatureColor(c);
  g.save(); g.translate(c.x, c.y); g.rotate(c.a);
  const wag = Math.sin(t * (4 + c.speed * 9) + c.id) * 0.5 * Math.min(1, c.speed);
  g.strokeStyle = col; g.lineWidth = Math.max(2, r * 0.35); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.8, 0); g.quadraticCurveTo(-r * 1.4, wag * r * 0.6, -r * (1.3 + c.speed * 0.5), wag * r * 1.2); g.stroke();
  g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, r * (1 + c.speed * 0.08), r * (1 - c.speed * 0.06), 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.stroke();
  if (c.shell > 0.2) {   // から: 背中の板（濃いほど 厚い）
    g.fillStyle = 'rgba(40,30,20,' + (0.25 + c.shell * 0.5).toFixed(2) + ')';
    const n = 2 + Math.round(c.shell * 3);
    for (let k = 0; k < n; k++) { const x = -r * 0.5 + (k / Math.max(1, n - 1)) * r * 0.8; g.beginPath(); g.ellipse(x, 0, r * 0.16, r * 0.62, 0, 0, 7); g.fill(); }
  }
  if (c.poison > 0.25) {   // どく: むらさきの 斑点
    g.fillStyle = 'rgba(150,60,220,' + (0.4 + c.poison * 0.5).toFixed(2) + ')';
    for (let k = 0; k < 4; k++) { const a = k * 1.7 + 0.5, d = r * 0.5; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.12 + c.poison * 0.12), 0, 7); g.fill(); }
  }
  const er = Math.max(1.5, Math.min(r * 0.45, 1.5 + c.sight / 45)), ex = r * 0.45, ey = r * 0.42;
  for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, s * ey, er, 0, 7); g.fill(); g.fillStyle = '#0f1f2b'; g.beginPath(); g.arc(ex + er * 0.35, s * ey, er * 0.55, 0, 7); g.fill(); }
  if (c.diet >= 0.5) { g.fillStyle = '#fff'; const n = c.diet > 0.75 ? 3 : 2; for (let k = 0; k < n; k++) { const y = (k - (n - 1) / 2) * r * 0.32; g.beginPath(); g.moveTo(r * 0.85, y - r * 0.12); g.lineTo(r * 1.15, y); g.lineTo(r * 0.85, y + r * 0.12); g.closePath(); g.fill(); } }
  else { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.arc(r * 0.75, 0, r * 0.22, -1.2, 1.2); g.stroke(); }
  if (c.hurt) { g.strokeStyle = 'rgba(150,60,220,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r + 4, 0, 7); g.stroke(); }
  g.restore();
}
function drawScene(g, t, w, withSelection) {
  const R = VIV.R;
  g.save(); g.translate(cx, cy); g.scale(sc, sc);
  g.fillStyle = '#183447'; g.beginPath(); g.arc(0, 0, R + 10, 0, 7); g.fill();
  const temp = w.settings.temp;
  const wat = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.2, 0, 0, R);
  wat.addColorStop(0, temp === 1 ? '#3a6f8a' : temp === 2 ? '#4a6a52' : '#2b5f70'); wat.addColorStop(1, temp === 1 ? '#24506a' : temp === 2 ? '#2d4a3a' : '#1d4453');
  g.fillStyle = wat; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
  if (w.settings.pond) { const P = VIV.POND; g.fillStyle = 'rgba(140,50,200,.35)'; g.beginPath(); g.arc(P.x, P.y, P.r, 0, 7); g.fill(); g.strokeStyle = 'rgba(190,120,255,.6)'; g.lineWidth = 2; g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(230,200,255,.8)'; g.font = '800 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('どく', P.x, P.y); }
  if (w.settings.wall) { g.fillStyle = '#c9a66b'; g.fillRect(-4, -R, 8, 2 * R); }
  g.strokeStyle = w.settings.season && VIV.seasonName(w) === 'ふゆ' ? '#a9c9a0' : '#7ee08a'; g.lineWidth = 2; g.lineCap = 'round';
  for (const gr of w.grass) { g.beginPath(); g.moveTo(gr.x - 3, gr.y + 3); g.lineTo(gr.x, gr.y - 4); g.lineTo(gr.x + 3, gr.y + 3); g.stroke(); }
  for (const m of w.meat) { g.globalAlpha = Math.min(1, m.life / 10); g.fillStyle = m.poison ? '#9c6ac9' : '#c96a6a'; g.beginPath(); g.arc(m.x, m.y, 3 + m.size * 0.25, 0, 7); g.fill(); g.fillStyle = '#f3d1d1'; g.beginPath(); g.arc(m.x - 1, m.y - 1, 1.5 + m.size * 0.1, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  for (const c of w.creatures) drawCreature(g, c, t);
  if (withSelection && selected && w.creatures.includes(selected)) {
    const c = selected;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.beginPath(); g.arc(c.x, c.y, c.sight, 0, 7); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#ffd54f'; g.lineWidth = 3; g.beginPath(); g.arc(c.x, c.y, c.size + 6, 0, 7); g.stroke();
  }
  g.restore();
  g.strokeStyle = temp === 1 ? '#7fb3cf' : temp === 2 ? '#c98a5a' : '#3d6d80'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, R + 7, 0, 7); g.stroke();
  g.restore();
}
function render(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0f1f2b'; ctx.fillRect(0, 0, W, H);
  drawScene(ctx, t, viewing || world, true);
}

// ---------- HUD ----------
function updateHud() {
  const w = viewing || world, s = VIV.summary(w);
  $('h-pop').textContent = s.pop; $('h-grass').textContent = s.grass; $('h-gen').textContent = s.maxGen; $('h-time').textContent = fmtT(w.stats.dishT);
  $('h-dex').textContent = Object.keys(w.dex).length; $('h-mis').textContent = Object.keys(w.missions).length;
  $('h-seasonbox').hidden = !w.settings.season; if (w.settings.season) $('h-season').textContent = VIV.seasonName(w);
  for (const seg of document.querySelectorAll('.seg')) { const k = seg.dataset.key, v = k === 'speed' ? speed : w.settings[k]; for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === v); }
  $('meteor').disabled = !!viewing || w.meteorT > 0; $('meteor').textContent = w.meteorT > 0 ? '☄ ' + Math.ceil(w.meteorT) + ' 秒' : '☄ いんせき';
  if (w.events.length > lastEventN) { const e = w.events[w.events.length - 1]; $('ticker').textContent = e.text; tickerT = 6; lastEventN = w.events.length; }
}
for (const seg of document.querySelectorAll('.seg')) for (const b of seg.querySelectorAll('button')) b.addEventListener('click', e => {
  e.preventDefault();
  const k = seg.dataset.key, v = +b.dataset.v;
  if (k === 'speed') { speed = v; lsSet('speed', String(v)); }
  else if (!viewing) { if (world.settings[k] !== v) VIV.setSetting(world, k, v); if (k === 'wall' && v) selected = null; }
  updateHud();
});
$('meteor').addEventListener('click', () => { if (!viewing && VIV.meteor(world)) { selected = null; showInfo(); updateHud(); } });

// ---------- タップ: 生き物の説明 ----------
cv.addEventListener('pointerdown', e => {
  const w = viewing || world, x = (e.clientX - cx) / sc, y = (e.clientY - cy) / sc;
  let best = null, bd = 18 / sc + 8;
  for (const c of w.creatures) { const d = Math.hypot(c.x - x, c.y - y) - c.size; if (d < bd) { bd = d; best = c; } }
  selected = best; showInfo();
});
function nameOf(c) {
  return c.diet > 0.7 ? (c.size > 18 ? 'キング' : c.speed > 1.3 ? 'ハンター' : c.size < 9 ? 'ちびハンター' : 'にくしょく') : c.shell > 0.5 && c.poison > 0.5 ? 'よろいどく' : c.shell > 0.6 ? 'かたいやつ' : c.poison > 0.6 ? 'どくもち' : c.diet >= 0.4 ? 'なんでも' : c.herd > 0.7 ? 'むれるやつ' : c.size > 20 ? 'でかぶつ' : c.size < 7 ? 'ちびすけ' : c.speed > 1.7 ? 'はやいやつ' : c.speed < 0.5 ? 'のろま' : c.sight > 170 ? 'めだま' : c.sight < 45 ? 'めくら' : c.herd < 0.1 ? 'ひとりずき' : 'ふつうの いきもの';
}
let lastInfoId = 0;
function showInfo() {
  const c = selected, w = viewing || world;
  $('info').hidden = !c;
  if (!c) { lastInfoId = 0; return; }
  $('i-name').textContent = nameOf(c);
  $('i-sub').textContent = c.gen + ' 世代目・' + Math.floor(c.age) + ' 秒・こども ' + c.kids;
  const G = VIV.GENES, pct = (v, [a, b]) => Math.round((v - a) / (b - a) * 100);
  $('ib-size').style.width = pct(c.size, G.size) + '%'; $('iv-size').textContent = c.size.toFixed(1);
  $('ib-speed').style.width = pct(c.speed, G.speed) + '%'; $('iv-speed').textContent = c.speed.toFixed(2);
  $('ib-sight').style.width = pct(c.sight, G.sight) + '%'; $('iv-sight').textContent = Math.round(c.sight);
  $('ib-diet').style.width = pct(c.diet, G.diet) + '%'; $('iv-diet').textContent = c.diet < 0.3 ? '草' : c.diet > 0.7 ? '肉' : 'どちらも';
  $('ib-shell').style.width = pct(c.shell, G.shell) + '%'; $('iv-shell').textContent = c.shell.toFixed(2);
  $('ib-poison').style.width = pct(c.poison, G.poison) + '%'; $('iv-poison').textContent = c.poison.toFixed(2);
  $('ib-herd').style.width = pct(c.herd, G.herd) + '%'; $('iv-herd').textContent = c.herd.toFixed(2);
  $('ib-hue').style.width = Math.round(c.hue / 360 * 100) + '%'; $('iv-hue').textContent = Math.round(c.hue) + '°';
  const temp = w.settings.temp;
  const parts = ['からだ ' + VIV.costBody(c).toFixed(1) + '（おおきさ²）', 'うごき ' + VIV.costMove(c, true).toFixed(1) + '（(おおきさ+8) × はやさ²）', 'め ' + VIV.costEye(c).toFixed(1)];
  if (c.shell > 0.01) parts.push('から ' + VIV.costShell(c).toFixed(1));
  if (c.poison > 0.01) parts.push('どく ' + VIV.costPoison(c).toFixed(1));
  if (temp) parts.push((temp === 1 ? 'さむさ ' : 'あつさ ') + VIV.costTemp(c, temp).toFixed(1));
  const lines = [];
  lines.push('1 秒に へる エネルギー <b>' + VIV.costPerSec(c, true, temp).toFixed(1) + '</b> ＝ ' + parts.join(' ＋ '));
  lines.push('くさ 1 つで <b>+' + VIV.grassGain(c).toFixed(0) + '</b>' + (c.diet >= 0.5 ? '、じぶんの 3/4 より 小さく 見える 相手（から で 大きく 見える）を 食べられる' : '') + '。<b>' + VIV.splitAt(c).toFixed(0) + '</b> たまると 2 つに わかれる。じゅみょう ' + VIV.lifespan(c).toFixed(0) + ' 秒');
  const ex = [];
  if (c.shell > 0.2) ex.push('から: 天敵には ' + VIV.effSize(c).toFixed(0) + ' の 大きさに 見える。うごきは ' + Math.round((1 - 0.35 * c.shell) * 100) + '%');
  if (c.poison > 0.25) ex.push('どく: 食べた 相手は ' + ((c.poison - 0.25) * 80).toFixed(0) + ' 減る');
  if (c.herd > 0.3) ex.push('むれ: 同じ色の 仲間に 集まり、仲間が 逃げたら いっしょに 逃げる');
  if (c.diet >= 0.5 && c.mem.length) ex.push('おぼえている 色: ' + c.mem.map(h => '<i style="display:inline-block;width:10px;height:10px;border-radius:5px;vertical-align:middle;background:' + hueColor(h) + '"></i>').join(' ') + '（この色を 狙いやすい）');
  if (ex.length) lines.push(ex.join('<br>'));
  $('i-why').innerHTML = lines.join('<br>');
  $('i-energy').textContent = 'エネルギー ' + Math.max(0, c.e).toFixed(0) + ' / ' + VIV.splitAt(c).toFixed(0) + (c.inPond ? '　☠ 毒の池の 中' : c.flee ? '　😱 にげている' : c.tk === 1 ? '　🎯 かりの さいちゅう' : c.tk === 2 ? '　🌱 くさへ' : c.tk === 3 ? '　🍖 にくへ' : '　💤 ぶらぶら');
  if (lastInfoId !== c.id) {
    lastInfoId = c.id;
    const strip = $('i-ancstrip'); strip.innerHTML = '';
    const line = c.anc.concat([{ size: c.size, speed: c.speed, sight: c.sight, diet: c.diet, hue: c.hue, shell: c.shell, poison: c.poison, herd: c.herd, gen: c.gen }]);
    for (const a of line) { const box = document.createElement('div'); const k = document.createElement('canvas'); k.width = 68; k.height = 68; const g = k.getContext('2d'), kk = Math.min(2.6, 13 / a.size); g.setTransform(kk, 0, 0, kk, 30, 34); drawCreature(g, Object.assign({ id: 1, x: 0, y: 0, a: 0, e: 0, mem: [] }, a), 0); box.appendChild(k); const l = document.createElement('div'); l.className = 'ag'; l.textContent = a.gen; box.appendChild(l); strip.appendChild(box); }
    strip.scrollLeft = 9999;
  }
}
$('i-close').addEventListener('click', () => { selected = null; showInfo(); });

// ---------- 図鑑・ミッション・きろく（グラフ） ----------
function openPanel(title, html) { $('p-title').textContent = title; $('p-body').innerHTML = html; $('panel').hidden = false; $('panel').querySelector('.pbox').scrollTop = 0; }
$('p-close').addEventListener('click', () => { $('panel').hidden = true; });
function sampleCreature(d) {
  const c = { id: 1, x: 0, y: 0, a: 0, size: 12, speed: 1, sight: 80, diet: 0.1, hue: 40, e: 0, shell: 0, poison: 0, herd: 0.2, mem: [] };
  ({ chibi: () => { c.size = 6; }, deka: () => { c.size = 22; }, hayai: () => { c.speed = 2; }, noroma: () => { c.speed = 0.4; }, medama: () => { c.sight = 200; }, mekura: () => { c.sight = 35; },
    niku: () => { c.diet = 0.85; c.hue = 0; }, hunter: () => { c.diet = 0.85; c.speed = 1.8; c.hue = 10; }, king: () => { c.diet = 0.85; c.size = 22; c.hue = 340; }, chibihunter: () => { c.diet = 0.85; c.size = 7; c.hue = 20; }, zatsu: () => { c.diet = 0.5; c.hue = 60; }, nagaiki: () => { c.size = 14; c.hue = 200; },
    katai: () => { c.shell = 0.9; c.hue = 30; }, doku: () => { c.poison = 0.9; c.hue = 280; }, mure: () => { c.herd = 0.9; c.hue = 120; }, hitori: () => { c.herd = 0; c.hue = 190; }, yoroi: () => { c.shell = 0.8; c.poison = 0.8; c.hue = 300; } })[d.id]();
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
function showMissions() {
  const w = viewing || world;
  let html = '<div class="mis">';
  for (const m of VIV.MISSIONS) { const t = w.missions[m.id]; html += '<div class="mi' + (t != null ? ' done' : '') + '"><div class="ck">' + (t != null ? '✓' : '') + '</div><div>' + m.text + (t != null ? '<small>' + fmtT(t) + ' に たっせい</small>' : '') + '</div></div>'; }
  html += '</div>';
  openPanel('ミッション ' + Object.keys(w.missions).length + ' / ' + VIV.MISSIONS.length, html);
}
function drawGraph(c, w) {
  const g = c.getContext('2d'), Wd = c.width, Hd = c.height, h = w.hist;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, Wd, Hd);
  g.fillStyle = '#fff'; g.fillRect(0, 0, Wd, Hd);
  if (h.length < 2) { g.fillStyle = '#0f1f2b'; g.font = '800 14px sans-serif'; g.textAlign = 'center'; g.fillText('まだ きろくが すくない（30 秒ごとに たまる）', Wd / 2, Hd / 2); return; }
  const L = 34, Rr = 10, T = 10, B = 22, gw = Wd - L - Rr, gh = Hd - T - B;
  const t0 = h[0][0], t1 = h[h.length - 1][0], tx = t => L + (t - t0) / Math.max(1, t1 - t0) * gw;
  const maxPop = Math.max(50, ...h.map(r => r[1]));
  g.strokeStyle = 'rgba(15,31,43,.12)'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = T + gh * k / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(Wd - Rr, y); g.stroke(); }
  g.fillStyle = 'rgba(15,31,43,.6)'; g.font = '10px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) g.fillText(Math.round(maxPop * (1 - k / 4)), L - 4, T + gh * k / 4);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(fmtT(t0), L, Hd - 6); g.fillText(fmtT(t1), Wd - Rr, Hd - 6);
  const line = (idx, col, scale) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); h.forEach((r, i) => { const y = T + gh * (1 - Math.min(1, r[idx] / scale)); if (i) g.lineTo(tx(r[0]), y); else g.moveTo(tx(r[0]), y); }); g.stroke(); };
  line(1, '#4cd26b', maxPop); line(2, '#e53935', maxPop);
  // 遺伝子の平均（右の軸 0〜1 に正規化）
  const G = VIV.GENES;
  const norm = (idx, [a, b], log) => h.map(r => log ? Math.log(r[idx] / a) / Math.log(b / a) : (r[idx] - a) / (b - a));
  const series = [[norm(3, G.size), '#ff9f43'], [norm(4, G.speed, true), '#42a5f5'], [norm(5, G.sight, true), '#ab47bc'], [norm(6, [0, 1]), '#8d6e63'], [norm(7, [0, 1]), '#5d4037'], [norm(8, [0, 1]), '#7e57c2'], [norm(9, [0, 1]), '#26a69a']];
  for (const [vals, col] of series) { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); vals.forEach((v, i) => { const y = T + gh * (1 - Math.max(0, Math.min(1, v))); if (i) g.lineTo(tx(h[i][0]), y); else g.moveTo(tx(h[i][0]), y); }); g.stroke(); g.setLineDash([]); }
}
function showRecords() {
  const w = viewing || world, st = w.stats, sp = VIV.species(w);
  let html = '<div class="recs"><div class="rc">さいだい 人口<b>' + st.maxPop + '</b></div><div class="rc">さいだい 世代<b>' + st.maxGen + '</b></div><div class="rc">皿の とし<b>' + fmtT(st.dishT) + '</b></div><div class="rc">ぜつめつ<b>' + st.extinctions + ' 回</b></div><div class="rc">うまれた<b>' + st.births + '</b></div><div class="rc">たべられた<b>' + st.eaten + '</b></div><div class="rc">どくで しんだ<b>' + st.poisoned + '</b></div><div class="rc">いんせき<b>' + st.meteors + ' 回</b></div></div>';
  html += '<div style="font-size:12px;font-weight:800;margin:4px 0">うつりかわり（実線: 人口・肉食、点線: 遺伝子の 平均）</div><canvas id="graph" width="760" height="400"></canvas><div class="glegend"><span><i style="background:#4cd26b"></i>人口</span><span><i style="background:#e53935"></i>肉食</span><span><i style="background:#ff9f43"></i>おおきさ</span><span><i style="background:#42a5f5"></i>はやさ</span><span><i style="background:#ab47bc"></i>め</span><span><i style="background:#8d6e63"></i>肉寄り</span><span><i style="background:#5d4037"></i>から</span><span><i style="background:#7e57c2"></i>どく</span><span><i style="background:#26a69a"></i>むれ</span></div>';
  html += '<div style="font-size:12px;font-weight:800;margin:4px 0">いま いる 種（色と かたちで まとめた）: ' + sp.length + '</div><div class="evlog" style="max-height:18vh">' + sp.slice(0, 8).map(g => '<div><span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:' + hueColor(g.hue) + '"></span> ' + g.n + ' 匹　おおきさ ' + g.size.toFixed(0) + '・はやさ ' + g.speed.toFixed(1) + '・め ' + g.sight.toFixed(0) + '・' + (g.diet < 0.3 ? '草' : g.diet > 0.7 ? '肉' : 'どちらも') + (g.shell > 0.3 ? '・から' : '') + (g.poison > 0.3 ? '・どく' : '') + '</div>').join('') + '</div>';
  html += '<div style="font-size:12px;font-weight:800;margin:8px 0 4px">できごと</div><div class="evlog">' + w.events.slice(-60).reverse().map(e => '<div><span>' + fmtT(e.t) + '</span>' + e.text + '</div>').join('') + '</div>';
  html += '<div class="rbtns">' + (viewing ? '' : '<button id="share" class="main">この皿を ともだちに 見せる</button><button id="newdish" class="sub">あたらしい 皿に する</button>') + '</div>';
  openPanel('きろく', html);
  drawGraph($('graph'), w);
  if (!viewing) { $('share').addEventListener('click', shareDish); $('newdish').addEventListener('click', () => { $('p-body').innerHTML = '<div style="text-align:center;font-weight:800">いまの 皿は きえます。いいですか？</div><div class="rbtns"><button id="yes" class="main">あたらしい 皿に する</button><button id="no" class="sub">やめる</button></div>'; $('yes').addEventListener('click', () => { world = VIV.createWorld((Math.floor(Math.random() * 65535) + 1) | 0); selected = null; lastEventN = 0; save(); $('panel').hidden = true; updateHud(); }); $('no').addEventListener('click', () => { $('panel').hidden = true; }); }); }
}
$('b-dex').addEventListener('click', showDex);
$('b-mis').addEventListener('click', showMissions);
$('b-rec').addEventListener('click', showRecords);

// ---------- 留守の計算 ----------
let offline = null;
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
    const txt = '<div style="text-align:left;font-size:13px;line-height:1.5">' + (evs.length ? evs.slice(-14).map(e => '・' + e.text).join('<br>') : '・とくに かわったことは なかった') + '</div><div style="margin-top:8px;font-weight:800">人口 ' + offline.pop0 + ' → ' + world.creatures.length + '　世代 ' + offline.gen0 + ' → ' + world.stats.maxGen + '</div>';
    $('overlay').hidden = true; offline = null; lastEventN = world.events.length;
    openPanel('るすちゅうの できごと', txt);
    save();
  }
}

// ---------- ともだちの皿 ----------
function openFriend(d) {
  viewing = VIV.worldFromDish(d, 1); viewing.stats.maxPop = d.maxPop; viewing.stats.dishT = d.minutes * 60; viewing.stats.extinctions = d.extinctions;
  selected = null;
  $('banner').hidden = false; $('banner-text').textContent = 'ともだちの 皿（見ているだけ）: 人口 ' + d.creatures.length + '・世代 ' + d.maxGen + '・図鑑 ' + d.dex + '・ミッション ' + d.missions;
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
  g.fillText('人口 ' + world.creatures.length + '　世代 ' + st.maxGen + '　皿の とし ' + fmtT(st.dishT) + '　図鑑 ' + Object.keys(world.dex).length + '/' + VIV.DEX.length + '　ミッション ' + Object.keys(world.missions).length + '/' + VIV.MISSIONS.length, S / 2, 70);
  const save0 = { cx, cy, sc }; cx = S / 2; cy = 90 + (S - 40) / 2; sc = (S - 40) / (2 * VIV.R + 20);
  drawScene(g, 0, world, false);
  cx = save0.cx; cy = save0.cy; sc = save0.sc;
  g.fillStyle = '#9fb3c0'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText(SITE_URL, S / 2, S + 100);
  return c.toDataURL('image/png');
}
function shareDish() {
  const dataUrl = dishImage();
  const bin = atob(dataUrl.split(',')[1]), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const file = new File([buf], 'vivarium.png', { type: 'image/png' });
  const st = world.stats;
  const text = 'ビバリウム: ぼくの 皿\n人口 ' + world.creatures.length + '・' + st.maxGen + ' 世代・図鑑 ' + Object.keys(world.dex).length + '/' + VIV.DEX.length + '・ミッション ' + Object.keys(world.missions).length + '/' + VIV.MISSIONS.length + '\n皿を 見に きて →\n' + SITE_URL + '#d=' + VIV.encodeDish(world) + '\n#ビバリウム';
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
  if (q.has('set')) for (const kv of q.get('set').split(',')) { const [k, v] = kv.split(':'); VIV.setSetting(world, k, +v); }
  if (q.has('ff')) { VIV.run(world, +q.get('ff')); lastEventN = world.events.length; updateHud(); }
  if (q.has('sel')) { selected = world.creatures.slice().sort((a, b) => b.anc.length - a.anc.length)[0] || null; showInfo(); }
  if (q.has('dex')) showDex();
  if (q.has('mis')) showMissions();
  if (q.has('rec')) showRecords();
  if (q.has('off')) startOffline(+q.get('off'));
}
requestAnimationFrame(frame);
