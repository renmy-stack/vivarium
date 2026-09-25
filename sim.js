// ビバリウム — 皿の中の生態・遺伝・図鑑・ミッション・記録（DOM 非依存。Node でも動く）
// 決定的: 1/20 秒の固定ステップ、乱数は種つき（状態に入れて保存）。変化はすべて「見えるルール」から出る
'use strict';
(function (root) {

const SIM_VERSION = 2;
const DT = 0.05;                 // 1 ステップ（秒）
const R = 360;                   // 皿の半径
const CELL = 60;                 // ご近所探しの格子
const FOOD_RATE = [8, 20, 40];   // 草が湧く速さ（/秒）: 少・中・多
const FOOD_CAP = 320;
const GRASS_E = 22;              // 草 1 つのエネルギー（草寄りの生き物が食べたとき）
const MEAT_LIFE = 40;            // 肉が腐るまでの秒
const POP_CAP = 260;             // これより多いと 分裂しない（皿の広さ）
const POND = { x: 120, y: 90, r: 85, dmg: 6 };   // 毒の池（あり のとき）
const SEASON_PERIOD = 240;       // 季節 1 周（秒）
const METEOR_CD = 60;            // いんせき の間隔（秒）
const GENES = { size: [5, 26], speed: [0.3, 2.2], sight: [30, 220], diet: [0, 1], shell: [0, 1], poison: [0, 1], herd: [0, 1] };
const START = { size: 10, speed: 1, sight: 80, diet: 0.08, shell: 0, poison: 0, herd: 0.2 };
const ANC_MAX = 8;               // 家系図で さかのぼる数

// ---------- 乱数（状態に入れる） ----------
function rnd(w) { w.rs = (w.rs * 1103515245 + 12345) & 0x7fffffff; return w.rs / 0x7fffffff; }
function gauss(w) { const u = rnd(w) * 0.999998 + 0.000001, v = rnd(w); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hueDiff(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// ---------- 損得（画面の説明と同じ式） ----------
// 1 秒に減るエネルギー = 体（おおきさ²）＋ 動き（おおきさ × はやさ²。重い体を速く動かすのは高い）＋ め ＋ から ＋ どく ＋ 温度
function costBody(c) { return 0.4 + c.size * c.size * 0.005; }
function costMove(c, moving) { return moving ? (c.size + 8) * c.speed * c.speed * 0.1 : 0.12; }   // 体には 最低限の重さ（8）がある。小さくても 速く動けば 高い
function costEye(c) { return c.sight * 0.006; }
function costShell(c) { return c.shell * c.size * 0.04; }
function costPoison(c) { return c.poison * 0.8; }
// 温度: さむい と 小さい体は 熱が逃げる。あつい と 大きい体は 熱がこもる
function costTemp(c, temp) { return temp === 1 ? Math.max(0, 12 - c.size) * 0.5 : temp === 2 ? Math.max(0, c.size - 12) * 0.5 : 0; }
function costPerSec(c, moving, temp) { return costBody(c) + costMove(c, moving) + costEye(c) + costShell(c) + costPoison(c) + costTemp(c, temp || 0); }
function splitAt(c) { return 55 + c.size * 2.5; }
function lifespan(c) { return 110 + c.size * 1.5; }
function grassGain(c) { return GRASS_E * (1 - 0.75 * c.diet); }
function meatGain(c, e) { return e * (0.2 + 0.8 * c.diet); }
// 相手を食べられるか: 肉寄り（0.5 以上）で、相手（から のぶん 大きく見える）が自分の 3/4 より小さい
function effSize(o) { return o.size * (1 + o.shell); }
function canEat(c, o) { return c.diet >= 0.5 && effSize(o) <= c.size * 0.75; }
// から が 重いと 遅い
function moveSpeed(c) { return 55 * c.speed * (1 - 0.35 * c.shell); }
function inPond(w, x, y) { if (!w.settings.pond) return false; const dx = x - POND.x, dy = y - POND.y; return dx * dx + dy * dy < POND.r * POND.r; }
function seasonPhase(w) { return w.settings.season ? (w.t % SEASON_PERIOD) / SEASON_PERIOD : 0.25; }   // 0 冬 → 0.25 春 → 0.5 夏 → 0.75 秋
function seasonName(w) { const p = seasonPhase(w); return p < 0.125 || p >= 0.875 ? 'ふゆ' : p < 0.375 ? 'はる' : p < 0.625 ? 'なつ' : 'あき'; }
function grassRate(w) {
  let r = FOOD_RATE[w.settings.food];
  if (w.settings.season) r *= 1 + 0.7 * Math.sin((seasonPhase(w) - 0.25) * 6.283185307179586 + 1.5707963);   // 夏 1.7 倍・冬 0.3 倍
  if (w.settings.temp === 1) r *= 0.8;
  return r;
}

// ---------- 世界 ----------
function createWorld(seed) {
  const w = { v: SIM_VERSION, seed: seed | 0, rs: (seed | 0) || 1, t: 0, nextId: 1, creatures: [], grass: [], meat: [],
    settings: { food: 1, where: 0, wall: 0, temp: 0, pond: 0, season: 0 },
    stats: { maxPop: 0, maxGen: 0, births: 0, deaths: 0, eaten: 0, poisoned: 0, extinctions: 0, dishT: 0, firstCarn: null, meteors: 0, winters: 0, meteorPop: 0 },
    events: [], dex: {}, missions: {}, hist: [], foodAcc: 0, meteorT: 0, histT: 0, lastSeason: '' };
  seedCreatures(w, 12, true);
  for (let i = 0; i < 90; i++) spawnGrass(w);
  return w;
}
function inDish(x, y) { return x * x + y * y <= (R - 4) * (R - 4); }
function randomPos(w, side) {
  for (let k = 0; k < 20; k++) {
    const a = rnd(w) * 6.283185307179586, d = Math.sqrt(rnd(w)) * (R - 12);
    let x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (side === 1 && x > -10) x = -Math.abs(x) - 10; if (side === 2 && x < 10) x = Math.abs(x) + 10;
    if (inDish(x, y)) return [x, y];
  }
  return [0, 0];
}
function snap(c) { return { size: c.size, speed: c.speed, sight: c.sight, diet: c.diet, hue: c.hue, shell: c.shell, poison: c.poison, herd: c.herd, gen: c.gen }; }
function makeCreature(w, g, x, y, gen, e, anc) {
  return { id: w.nextId++, x, y, a: rnd(w) * 6.283185307179586, size: g.size, speed: g.speed, sight: g.sight, diet: g.diet, hue: g.hue,
    shell: g.shell || 0, poison: g.poison || 0, herd: g.herd == null ? 0.2 : g.herd,
    e, age: 0, gen, tk: 0, tid: 0, tx: 0, ty: 0, rt: 0, wt: 0, born: w.t, kids: 0, flee: 0, mem: [], anc: anc || [] };
}
function seedCreatures(w, n, first) {
  for (let i = 0; i < n; i++) {
    const g = Object.assign({}, START, { hue: Math.floor(rnd(w) * 360) });
    if (!first) { g.size *= Math.exp(gauss(w) * 0.15); g.speed *= Math.exp(gauss(w) * 0.15); }
    const p = randomPos(w, 0);
    w.creatures.push(makeCreature(w, g, p[0], p[1], first ? 0 : (w.stats.maxGen || 0), 40));
  }
}
function spawnGrass(w) {
  if (w.grass.length >= FOOD_CAP) return;
  const p = randomPos(w, w.settings.where);
  w.grass.push({ x: p[0], y: p[1] });
}
function mutate(w, c) {
  const g = snap(c);
  const big = rnd(w) < 0.12 ? 2.5 : 1;   // たまに大きく変わる
  g.size = clamp(g.size * Math.exp(gauss(w) * 0.08 * big), GENES.size[0], GENES.size[1]);
  g.speed = clamp(g.speed * Math.exp(gauss(w) * 0.08 * big), GENES.speed[0], GENES.speed[1]);
  g.sight = clamp(g.sight * Math.exp(gauss(w) * 0.1 * big), GENES.sight[0], GENES.sight[1]);
  g.diet = clamp(g.diet + gauss(w) * 0.05 * big, 0, 1);
  g.shell = clamp(g.shell + gauss(w) * 0.05 * big, 0, 1);
  g.poison = clamp(g.poison + gauss(w) * 0.05 * big, 0, 1);
  g.herd = clamp(g.herd + gauss(w) * 0.06 * big, 0, 1);
  g.hue = ((g.hue + gauss(w) * 6 * big) % 360 + 360) % 360;
  return g;
}
function event(w, text, kind) { w.events.push({ t: w.t, text, kind: kind || '' }); if (w.events.length > 300) w.events.splice(0, w.events.length - 300); }

// ---------- 図鑑（遺伝子の条件で決まる。現れたら登録） ----------
const DEX = [
  { id: 'chibi', name: 'ちびすけ', why: 'おおきさ 7 より 小さい。体が小さいと エネルギーが 減りにくい', test: c => c.size < 7 },
  { id: 'deka', name: 'でかぶつ', why: 'おおきさ 20 より 大きい。大きいと 食べられにくいが、動くと すぐ おなかが すく', test: c => c.size > 20 },
  { id: 'hayai', name: 'はやいやつ', why: 'はやさ 1.7 より 速い。草に 先に 着けるが、エネルギーの 減りが 速い', test: c => c.speed > 1.7 },
  { id: 'noroma', name: 'のろま', why: 'はやさ 0.5 より 遅い。ほとんど 動かないので 減りが 少ない', test: c => c.speed < 0.5 },
  { id: 'medama', name: 'めだま', why: 'め 170 より よい。遠くの 草と 天敵が 見える。毒の池も 見えて 避ける', test: c => c.sight > 170 },
  { id: 'mekura', name: 'めくら', why: 'め 45 より わるい。目に エネルギーを 使わない', test: c => c.sight < 45 },
  { id: 'niku', name: 'にくしょく', why: 'たべもの が 肉寄り（0.7 より 上）。草は ほとんど 食べられず、小さい 生き物を 食べる', test: c => c.diet > 0.7 },
  { id: 'hunter', name: 'ハンター', why: '肉寄り で 速い（1.3 より 上）。逃げる 相手に 追いつける', test: c => c.diet > 0.7 && c.speed > 1.3 },
  { id: 'king', name: 'キング', why: '肉寄り で 大きい（18 より 上）。ほとんどの 生き物を 食べられる', test: c => c.diet > 0.7 && c.size > 18 },
  { id: 'chibihunter', name: 'ちびハンター', why: '肉寄り で 小さい（9 より 下）。食べられる 相手は 少ないが、減りが 少ない', test: c => c.diet > 0.7 && c.size < 9 },
  { id: 'zatsu', name: 'なんでも', why: 'たべもの が まんなか（0.4〜0.6）。草も 肉も 半分ずつ', test: c => c.diet >= 0.4 && c.diet <= 0.6 },
  { id: 'nagaiki', name: 'ながいき', why: '150 秒 より 長く 生きた', test: c => c.age > 150 },
  { id: 'katai', name: 'かたいやつ', why: 'から 0.6 より 上。大きく 見えるので 食べられにくいが、重くて 遅い', test: c => c.shell > 0.6 },
  { id: 'doku', name: 'どくもち', why: 'どく 0.6 より 上。食べた 相手が 弱る。持つだけで エネルギーが かかる', test: c => c.poison > 0.6 },
  { id: 'mure', name: 'むれるやつ', why: 'むれ 0.7 より 上。同じ色の 仲間に 集まる。仲間が 逃げたら いっしょに 逃げる', test: c => c.herd > 0.7 },
  { id: 'hitori', name: 'ひとりずき', why: 'むれ 0.1 より 下。仲間に 集まらないので 草を 取り合わない', test: c => c.herd < 0.1 },
  { id: 'yoroi', name: 'よろいどく', why: 'から と どく が 両方 0.5 より 上。食べにくく、食べたら 弱る', test: c => c.shell > 0.5 && c.poison > 0.5 },
];
function checkDex(w, c) {
  for (const d of DEX) {
    if (w.dex[d.id]) { if (d.test(c)) w.dex[d.id].n++; continue; }
    if (d.test(c)) { w.dex[d.id] = { t: w.t, gen: c.gen, n: 1 }; event(w, '図鑑: 「' + d.name + '」が あらわれた', 'dex'); }
  }
}

// ---------- ミッション（1 秒ごとに判定。達成したら記録） ----------
const MISSIONS = [
  { id: 'pop100', text: '人口を 100 に', test: (w, s) => s.pop >= 100 },
  { id: 'gen50', text: '50 世代 まで 育てる', test: (w, s) => s.maxGen >= 50 },
  { id: 'carn10', text: '肉食を 10 匹に', test: (w, s) => s.carn >= 10 },
  { id: 'dex6', text: '図鑑を 6 種 集める', test: (w, s) => Object.keys(w.dex).length >= 6 },
  { id: 'hour1', text: '皿の とし 1 時間', test: (w, s) => w.stats.dishT >= 3600 },
  { id: 'carn30', text: '肉食を 30 匹に', test: (w, s) => s.carn >= 30 },
  { id: 'gen200', text: '200 世代 まで 育てる', test: (w, s) => s.maxGen >= 200 },
  { id: 'pop200', text: '人口を 200 に（くさ を おおい に）', test: (w, s) => s.pop >= 200 },
  { id: 'cold', text: 'さむい で 平均の おおきさ 16 以上', test: (w, s) => w.settings.temp === 1 && s.pop >= 20 && s.size >= 16 },
  { id: 'hot', text: 'あつい で 平均の おおきさ 9 以下', test: (w, s) => w.settings.temp === 2 && s.pop >= 20 && s.size <= 9 },
  { id: 'shell20', text: 'から 0.5 以上 を 20 匹', test: (w, s) => w.creatures.filter(c => c.shell >= 0.5).length >= 20 },
  { id: 'poison20', text: 'どく 0.5 以上 を 20 匹', test: (w, s) => w.creatures.filter(c => c.poison >= 0.5).length >= 20 },
  { id: 'poisoned10', text: '肉食を どくで 10 匹 やっつける', test: (w, s) => w.stats.poisoned >= 10 },
  { id: 'split', text: 'かべ で 分けて、左右で 色が 60° 以上 ちがう 2 つの 種に', test: (w, s) => { if (!w.settings.wall) return false; const L = w.creatures.filter(c => c.x < 0), Rr = w.creatures.filter(c => c.x >= 0); if (L.length < 15 || Rr.length < 15) return false; const h = a => { let x = 0, y = 0; for (const c of a) { x += Math.cos(c.hue / 57.29578); y += Math.sin(c.hue / 57.29578); } return Math.atan2(y, x) * 57.29578; }; return hueDiff(h(L), h(Rr)) >= 60; } },
  { id: 'herd', text: '同じ色の 仲間 10 匹が 半径 60 に 集まる', test: (w, s) => { for (const c of w.creatures) { if (c.herd < 0.5) continue; let n = 0; for (const o of w.creatures) { const dx = o.x - c.x, dy = o.y - c.y; if (dx * dx + dy * dy < 3600 && hueDiff(o.hue, c.hue) < 25) n++; } if (n >= 10) return true; } return false; } },
  { id: 'pond', text: '毒の池 あり で 30 世代 進める', test: (w, s) => w.settings.pond && w.stats.pondGen != null && s.maxGen - w.stats.pondGen >= 30 },
  { id: 'winter3', text: '季節 あり で 冬を 3 回 越える', test: (w, s) => w.stats.winters >= 3 },
  { id: 'meteor', text: 'いんせき の あと、人口を 100 に 戻す', test: (w, s) => w.stats.meteorPop > 0 && s.pop >= 100 },
  { id: 'both', text: 'キング と ちびハンター が 同時に いる', test: (w, s) => w.creatures.some(c => c.diet > 0.7 && c.size > 18) && w.creatures.some(c => c.diet > 0.7 && c.size < 9) },
  { id: 'hour6', text: '皿の とし 6 時間', test: (w, s) => w.stats.dishT >= 6 * 3600 },
];
function checkMissions(w) {
  const s = summary(w);
  for (const m of MISSIONS) { if (w.missions[m.id]) continue; if (m.test(w, s)) { w.missions[m.id] = w.t; event(w, 'ミッション たっせい: ' + m.text, 'mission'); } }
}

// ---------- 1 ステップ ----------
function grid(list) {
  const m = new Map();
  for (const o of list) { const k = ((o.x / CELL) | 0) * 1000 + ((o.y / CELL) | 0); let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(o); }
  return m;
}
function near(m, x, y, rad, fn) {
  const c0 = ((x - rad) / CELL) | 0, c1 = ((x + rad) / CELL) | 0, r0 = ((y - rad) / CELL) | 0, r1 = ((y + rad) / CELL) | 0;
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) { const a = m.get(i * 1000 + j); if (a) for (const o of a) fn(o); }
}
function blocked(w, x0, x1) { return w.settings.wall && ((x0 < 0) !== (x1 < 0)); }
function step(w) {
  const dt = DT;
  w.t += dt; w.stats.dishT += dt;
  if (w.meteorT > 0) w.meteorT -= dt;
  // 季節
  if (w.settings.season) { const sn = seasonName(w); if (sn !== w.lastSeason) { if (sn === 'ふゆ' && w.lastSeason) { w.stats.winters++; event(w, 'ふゆが きた（草が へる）', 'season'); } w.lastSeason = sn; } }
  // 草が湧く
  w.foodAcc += grassRate(w) * dt;
  while (w.foodAcc >= 1) { w.foodAcc -= 1; spawnGrass(w); }
  // 肉が腐る（あつい と 2 倍）
  const rot = w.settings.temp === 2 ? 2 : 1;
  for (let i = w.meat.length - 1; i >= 0; i--) { w.meat[i].life -= dt * rot; if (w.meat[i].life <= 0) w.meat.splice(i, 1); }
  const cs = w.creatures, gm = grid(w.grass), mm = grid(w.meat), cm = grid(cs), temp = w.settings.temp;
  const byId = new Map(); for (const c of cs) byId.set(c.id, c);
  for (const c of cs) c.fled = c.flee;   // 前のステップで逃げていたか（仲間の警戒に使う）
  for (const c of cs) {
    c.age += dt; c.rt -= dt; c.wt -= dt; c.flee = 0;
    // 天敵から逃げる（自分を食べられる相手が 見えたら）。むれ: 近くの 同じ色の 仲間が 逃げていたら いっしょに
    let fx = 0, fy = 0, threat = 0;
    near(cm, c.x, c.y, c.sight, o => {
      if (o === c) return;
      const dx = c.x - o.x, dy = c.y - o.y, d2 = dx * dx + dy * dy;
      if (canEat(o, c)) { const s = c.sight * 0.7; if (d2 > s * s || blocked(w, c.x, o.x)) return; const d = Math.sqrt(d2) + 1; fx += dx / d; fy += dy / d; threat++; }
      else if (c.herd > 0.3 && o.fled && d2 < 3600 && hueDiff(o.hue, c.hue) < 25) { fx += Math.cos(o.a); fy += Math.sin(o.a); threat++; }
    });
    let moving = true;
    if (threat) { c.flee = 1; c.tk = 0; c.a = Math.atan2(fy, fx); }
    else {
      if (c.rt <= 0 || (c.tk === 1 && !byId.has(c.tid))) {
        c.rt = 0.3; c.tk = 0;
        let best = 0, bx = 0, by = 0, bk = 0, bid = 0;
        const hungry = c.e < splitAt(c) * 0.9;
        if (c.diet < 0.85) near(gm, c.x, c.y, c.sight, g => {
          if (blocked(w, c.x, g.x)) return;
          const dx = g.x - c.x, dy = g.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          let v = grassGain(c) / (Math.sqrt(d2) + 20);
          if (c.sight >= 90 && inPond(w, g.x, g.y)) v *= 0.15;   // め がよいと 毒の池の 草は 避ける
          if (v > best) { best = v; bx = g.x; by = g.y; bk = 2; }
        });
        if (c.diet > 0.15) near(mm, c.x, c.y, c.sight, m => {
          if (blocked(w, c.x, m.x)) return;
          const dx = m.x - c.x, dy = m.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          let v = meatGain(c, m.e) / (Math.sqrt(d2) + 20);
          if (c.sight >= 90 && inPond(w, m.x, m.y)) v *= 0.15;
          if (v > best) { best = v; bx = m.x; by = m.y; bk = 3; }
        });
        if (c.diet >= 0.5 && hungry) near(cm, c.x, c.y, c.sight, o => {
          if (o === c || !canEat(c, o) || blocked(w, c.x, o.x)) return;
          const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          let v = meatGain(c, o.size * 5) / (Math.sqrt(d2) + 40);
          for (const h of c.mem) if (hueDiff(h, o.hue) < 30) v *= 1.6;   // 食べたことのある色を おぼえて 狙う
          if (v > best) { best = v; bx = o.x; by = o.y; bk = 1; bid = o.id; }
        });
        if (bk) { c.tk = bk; c.tx = bx; c.ty = by; c.tid = bid; }
        // むれ: 同じ色の 仲間の まんなかを おぼえる
        c.hn = 0;
        if (c.herd > 0.3) { let hx = 0, hy = 0, hn = 0; near(cm, c.x, c.y, c.sight, o => { if (o !== c && hueDiff(o.hue, c.hue) < 25 && !blocked(w, c.x, o.x)) { hx += o.x; hy += o.y; hn++; } }); if (hn) { c.hn = hn; c.hx = hx / hn; c.hy = hy / hn; } }
      }
      if (c.tk === 1) { const o = byId.get(c.tid); if (o) { c.tx = o.x; c.ty = o.y; } }
      if (c.tk) c.a = Math.atan2(c.ty - c.y, c.tx - c.x);
      else {
        // むれ: 同じ色の 仲間の まんなかへ（おぼえた位置）
        if (c.hn && c.wt <= 0 && rnd(w) < c.herd) { const d = Math.hypot(c.hx - c.x, c.hy - c.y); c.wt = 0.4 + rnd(w) * 0.6; if (d > 30) c.a = Math.atan2(c.hy - c.y, c.hx - c.x); else c.a += (rnd(w) - 0.5) * 2.5; }
        else if (c.wt <= 0) { c.wt = 0.8 + rnd(w) * 1.5; c.a += (rnd(w) - 0.5) * 2.5; }
        moving = c.e < splitAt(c) * 0.98 || rnd(w) < 0.5;
      }
    }
    // 動く（め がよいと 毒の池に 入る前に 曲がる）
    const v = moveSpeed(c) * (c.tk || threat ? 1 : 0.45) * (moving ? 1 : 0);
    let nx = c.x + Math.cos(c.a) * v * dt, ny = c.y + Math.sin(c.a) * v * dt;
    if (w.settings.pond && c.sight >= 90 && !inPond(w, c.x, c.y) && inPond(w, nx, ny) && c.tk !== 1) { c.a += 1.6; nx = c.x; ny = c.y; }
    if (blocked(w, c.x, nx)) { nx = c.x; c.a += 2.5; }
    if (!inDish(nx, ny)) { const d = Math.sqrt(nx * nx + ny * ny); nx = nx / d * (R - 5); ny = ny / d * (R - 5); c.a = Math.atan2(-ny, -nx) + (rnd(w) - 0.5) * 1.5; }
    c.x = nx; c.y = ny;
    // 食べる
    const reach = c.size * 0.5 + 8;
    if (c.tk === 2) { const dx = c.tx - c.x, dy = c.ty - c.y; if (dx * dx + dy * dy < reach * reach) { const gi = w.grass.findIndex(g => g.x === c.tx && g.y === c.ty); if (gi >= 0) { w.grass.splice(gi, 1); c.e += grassGain(c); } c.tk = 0; c.rt = 0; } }
    else if (c.tk === 3) { const dx = c.tx - c.x, dy = c.ty - c.y; if (dx * dx + dy * dy < reach * reach) { const mi = w.meat.findIndex(m => m.x === c.tx && m.y === c.ty); if (mi >= 0) { const m = w.meat[mi]; c.e += meatGain(c, m.e); if (m.poison > 0.25) { c.e -= (m.poison - 0.25) * 55; c.hurt = 1; } w.meat.splice(mi, 1); } c.tk = 0; c.rt = 0; } }
    else if (c.tk === 1) { const o = byId.get(c.tid); if (o && !o.dead) { const dx = o.x - c.x, dy = o.y - c.y; if (dx * dx + dy * dy < (c.size + o.size * 0.5) * (c.size + o.size * 0.5)) { o.dead = 'eaten'; c.e += meatGain(c, o.size * 5); if (o.poison > 0.25) { c.e -= (o.poison - 0.25) * 80; c.hurt = 1; } c.mem.push(o.hue); if (c.mem.length > 3) c.mem.shift(); c.tk = 0; c.rt = 0; w.stats.eaten++; } } }
    // 減る（毒の池の中は さらに）
    c.e -= costPerSec(c, moving, temp) * dt;
    if (inPond(w, c.x, c.y)) { c.e -= POND.dmg * dt; c.inPond = 1; } else c.inPond = 0;
    // 分裂
    if (c.e >= splitAt(c) && cs.length < POP_CAP + 40) {
      c.e *= 0.5; c.kids++;
      const g = mutate(w, c), a = rnd(w) * 6.283185307179586;
      let x = c.x + Math.cos(a) * (c.size + 4), y = c.y + Math.sin(a) * (c.size + 4);
      if (!inDish(x, y) || blocked(w, c.x, x)) { x = c.x; y = c.y; }
      const anc = c.anc.slice(-(ANC_MAX - 1)).concat([snap(c)]);
      const k = makeCreature(w, g, x, y, c.gen + 1, c.e, anc);
      w.creatures.push(k); w.stats.births++;
      if (k.gen > w.stats.maxGen) { w.stats.maxGen = k.gen; if (k.gen % 10 === 0) event(w, k.gen + ' 世代目が うまれた', 'gen'); }
      checkDex(w, k);
      if (w.stats.firstCarn == null && k.diet > 0.7) { w.stats.firstCarn = w.t; event(w, 'はじめての 肉食が あらわれた', 'carn'); }
    }
    if (c.e <= 0) c.dead = c.hurt ? 'poison' : 'starve';
    else if (c.age >= lifespan(c)) c.dead = 'old';
    if (c.hurt && c.e > 0) c.hurt = 0;
    if (c.age > 150 && !c.oldChecked) { c.oldChecked = 1; checkDex(w, c); }
  }
  // 死ぬ → 肉（どくもち の肉は 毒）
  let n = 0;
  for (const c of cs) {
    if (c.dead) {
      w.stats.deaths++;
      if (c.dead === 'poison') w.stats.poisoned++;
      if (c.dead !== 'eaten') w.meat.push({ x: c.x, y: c.y, e: c.size * 4, life: MEAT_LIFE, size: c.size, hue: c.hue, poison: c.poison > 0.25 ? c.poison : 0 });
    } else cs[n++] = c;
  }
  cs.length = n;
  if (cs.length > w.stats.maxPop) { w.stats.maxPop = cs.length; for (const m of [50, 100, 150, 200]) if (cs.length === m) event(w, '人口が ' + m + ' に なった', 'pop'); }
  // 全滅 → 新しい種が流れ着く
  if (cs.length === 0) { w.stats.extinctions++; event(w, 'ぜつめつ… あたらしい たねが ながれついた', 'ext'); seedCreatures(w, 10, false); }
  // 1 秒ごと: ミッション。30 秒ごと: グラフ用の記録
  const tf = Math.round(w.t / DT);
  if (tf % 20 === 0) checkMissions(w);
  if (tf % 600 === 0) { const s = summary(w); w.hist.push([Math.round(w.t), s.pop, s.carn, +s.size.toFixed(1), +s.speed.toFixed(2), +s.sight.toFixed(0), +s.diet.toFixed(2), +s.shell.toFixed(2), +s.poison.toFixed(2), +s.herd.toFixed(2)]); if (w.hist.length > 720) w.hist.splice(0, w.hist.length - 720); }
}
function run(w, sec) { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) step(w); }
// 設定を変える（毒の池を置いた世代を おぼえる など）
function setSetting(w, k, v) {
  w.settings[k] = v;
  if (k === 'pond') { if (v) { w.stats.pondGen = w.stats.maxGen; event(w, '毒の池を おいた', 'env'); } else w.stats.pondGen = null; }
  if (k === 'temp') event(w, v === 1 ? 'さむく した' : v === 2 ? 'あつく した' : 'ふつうの あたたかさに もどした', 'env');
  if (k === 'season') event(w, v ? '季節が めぐるように した' : '季節を とめた', 'env');
  if (k === 'wall') event(w, v ? 'かべで 皿を 分けた' : 'かべを とった', 'env');
}
// いんせき: 人口を 半分に
function meteor(w) {
  if (w.meteorT > 0 || w.creatures.length < 4) return false;
  const before = w.creatures.length;
  w.creatures = w.creatures.filter(() => rnd(w) < 0.5);
  w.stats.meteors++; w.stats.meteorPop = before; w.meteorT = METEOR_CD;
  event(w, 'いんせきが おちた！ 人口 ' + before + ' → ' + w.creatures.length, 'meteor');
  return true;
}

// ---------- まとめ（画面・記録用） ----------
function summary(w) {
  const cs = w.creatures, n = cs.length;
  const avg = k => n ? cs.reduce((s, c) => s + c[k], 0) / n : 0;
  return { pop: n, grass: w.grass.length, meat: w.meat.length, carn: cs.filter(c => c.diet > 0.7).length, herb: cs.filter(c => c.diet < 0.3).length,
    size: avg('size'), speed: avg('speed'), sight: avg('sight'), diet: avg('diet'), shell: avg('shell'), poison: avg('poison'), herd: avg('herd'), maxGen: w.stats.maxGen, maxPop: w.stats.maxPop, t: w.t };
}
function species(w) {
  const groups = [];
  for (const c of w.creatures) {
    let g = null;
    for (const h of groups) { if (hueDiff(h.hue, c.hue) < 22 && Math.abs(h.diet - c.diet) < 0.25 && Math.abs(Math.log(h.size / c.size)) < 0.35) { g = h; break; } }
    if (g) { g.n++; g.size += (c.size - g.size) / g.n; g.speed += (c.speed - g.speed) / g.n; g.sight += (c.sight - g.sight) / g.n; g.diet += (c.diet - g.diet) / g.n; g.shell += (c.shell - g.shell) / g.n; g.poison += (c.poison - g.poison) / g.n; }
    else groups.push({ hue: c.hue, size: c.size, speed: c.speed, sight: c.sight, diet: c.diet, shell: c.shell, poison: c.poison, n: 1 });
  }
  return groups.sort((a, b) => b.n - a.n);
}

// ---------- 保存・URL ----------
function serialize(w) { return JSON.stringify(w); }
function deserialize(s) { try { const w = JSON.parse(s); if (!w || w.v !== SIM_VERSION || !w.creatures) return null; if (!w.meat) w.meat = []; if (!w.missions) w.missions = {}; if (!w.hist) w.hist = []; return w; } catch (e) { return null; } }
function encodeDish(w) {
  const cs = w.creatures.slice(0, 100), out = [];
  const u8 = v => out.push(clamp(Math.round(v), 0, 255));
  const u16 = v => { v = clamp(Math.round(v), 0, 65535); out.push(v & 255, (v >> 8) & 255); };
  u8(1); u8(SIM_VERSION); u16(w.stats.maxPop); u16(w.stats.maxGen); u16(Math.min(65535, w.stats.dishT / 60)); u8(w.stats.extinctions); u8(Object.keys(w.dex).length); u8(Object.keys(w.missions).length); u8(cs.length);
  for (const c of cs) {
    u8((c.x + R) / (2 * R) * 255); u8((c.y + R) / (2 * R) * 255);
    u8((c.size - 5) / 21 * 255); u8(Math.log(c.speed / 0.3) / Math.log(2.2 / 0.3) * 255); u8(Math.log(c.sight / 30) / Math.log(220 / 30) * 255); u8(c.diet * 255); u8(c.hue / 360 * 255); u8(Math.min(255, c.gen));
    u8(c.shell * 255); u8(c.poison * 255); u8(c.herd * 255);
  }
  let bin = ''; for (const v of out) bin += String.fromCharCode(v);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeDish(str) {
  try {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const a = Array.from(bin, ch => ch.charCodeAt(0));
    let i = 0; const u8 = () => a[i++], u16 = () => { const v = a[i] | (a[i + 1] << 8); i += 2; return v; };
    if (u8() !== 1 || u8() !== SIM_VERSION) return null;
    const d = { maxPop: u16(), maxGen: u16(), minutes: u16(), extinctions: u8(), dex: u8(), missions: u8(), creatures: [] };
    const n = u8();
    for (let k = 0; k < n; k++) {
      const x = u8() / 255 * 2 * R - R, y = u8() / 255 * 2 * R - R;
      const size = 5 + u8() / 255 * 21, speed = 0.3 * Math.exp(u8() / 255 * Math.log(2.2 / 0.3)), sight = 30 * Math.exp(u8() / 255 * Math.log(220 / 30)), diet = u8() / 255, hue = u8() / 255 * 360, gen = u8();
      const shell = u8() / 255, poison = u8() / 255, herd = u8() / 255;
      d.creatures.push({ x, y, size, speed, sight, diet, hue, gen, shell, poison, herd });
    }
    if (i !== a.length) return null;
    return d;
  } catch (e) { return null; }
}
function worldFromDish(d, seed) {
  const w = createWorld(seed);
  w.creatures = [];
  for (const c of d.creatures) w.creatures.push(makeCreature(w, c, c.x, c.y, c.gen, 40));
  w.stats.maxGen = d.maxGen;
  for (const c of w.creatures) checkDex(w, c);
  event(w, 'ともだちの 皿を もらった', 'gift');
  return w;
}

const API = { SIM_VERSION, DT, R, FOOD_RATE, GENES, DEX, MISSIONS, POP_CAP, POND, SEASON_PERIOD, METEOR_CD, createWorld, step, run, summary, species, serialize, deserialize, encodeDish, decodeDish, worldFromDish,
  costPerSec, costBody, costMove, costEye, costShell, costPoison, costTemp, splitAt, lifespan, grassGain, meatGain, canEat, effSize, moveSpeed, inPond, seasonName, seasonPhase, grassRate, setSetting, meteor, hueDiff, rnd };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.VIV = API;
})(this);
