// ビバリウム — 皿の中の生態・遺伝・図鑑・記録（DOM 非依存。Node でも動く）
// 決定的: 1/20 秒の固定ステップ、乱数は種つき（状態に入れて保存）。変化はすべて「見えるルール」から出る
'use strict';
(function (root) {

const SIM_VERSION = 1;
const DT = 0.05;                 // 1 ステップ（秒）
const R = 360;                   // 皿の半径
const CELL = 60;                 // ご近所探しの格子
const FOOD_RATE = [8, 20, 40];    // 草が湧く速さ（/秒）: 少・中・多
const FOOD_CAP = 320;
const GRASS_E = 22;              // 草 1 つのエネルギー（草寄りの生き物が食べたとき）
const MEAT_LIFE = 40;            // 肉が腐るまでの秒
const POP_CAP = 260;             // これより多いと 分裂しない（皿の広さ）
const GENES = { size: [5, 26], speed: [0.3, 2.2], sight: [30, 220], diet: [0, 1] };
const START = { size: 10, speed: 1, sight: 80, diet: 0.08 };

// ---------- 乱数（状態に入れる） ----------
function rnd(w) { w.rs = (w.rs * 1103515245 + 12345) & 0x7fffffff; return w.rs / 0x7fffffff; }
function gauss(w) { const u = rnd(w) * 0.999998 + 0.000001, v = rnd(w); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------- 損得（画面の説明と同じ式） ----------
// 1 秒に減るエネルギー: 体（大きさの 2 乗）＋ 動き（大きさ × 速さの 2 乗。重い体を速く動かすのは高い）＋ 目
function costPerSec(c, moving) { return 0.4 + c.size * c.size * 0.005 + (moving ? c.size * c.speed * c.speed * 0.12 : 0.12) + c.sight * 0.006; }
// 分裂に必要なエネルギー（大きいほど多い）
function splitAt(c) { return 55 + c.size * 2.5; }
// 寿命（秒）。大きいほど長い
function lifespan(c) { return 110 + c.size * 1.5; }
// 草から得るエネルギー（肉寄りほど 草が食べにくい）
function grassGain(c) { return GRASS_E * (1 - 0.75 * c.diet); }
// 肉から得るエネルギー（肉寄りほど よく取れる）
function meatGain(c, e) { return e * (0.2 + 0.8 * c.diet); }
// 相手を食べられるか: 肉寄り（0.5 以上）で、相手が自分の 3/4 より小さい
function canEat(c, o) { return c.diet >= 0.5 && o.size <= c.size * 0.75; }
function moveSpeed(c) { return 55 * c.speed; }

// ---------- 世界 ----------
function createWorld(seed) {
  const w = { v: SIM_VERSION, seed: seed | 0, rs: (seed | 0) || 1, t: 0, nextId: 1, creatures: [], grass: [], meat: [],
    settings: { food: 1, where: 0, wall: 0 },
    stats: { maxPop: 0, maxGen: 0, births: 0, deaths: 0, eaten: 0, extinctions: 0, dishT: 0, firstCarn: null },
    events: [], dex: {}, foodAcc: 0 };
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
function makeCreature(w, g, x, y, gen, e) {
  return { id: w.nextId++, x, y, a: rnd(w) * 6.283185307179586, size: g.size, speed: g.speed, sight: g.sight, diet: g.diet, hue: g.hue,
    e, age: 0, gen, tk: 0, tid: 0, tx: 0, ty: 0, rt: 0, wt: 0, born: w.t, kids: 0, flee: 0 };
}
function seedCreatures(w, n, first) {
  for (let i = 0; i < n; i++) {
    const g = { size: START.size, speed: START.speed, sight: START.sight, diet: START.diet, hue: Math.floor(rnd(w) * 360) };
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
  const g = { size: c.size, speed: c.speed, sight: c.sight, diet: c.diet, hue: c.hue };
  const big = rnd(w) < 0.12 ? 2.5 : 1;   // たまに大きく変わる
  g.size = clamp(g.size * Math.exp(gauss(w) * 0.08 * big), GENES.size[0], GENES.size[1]);
  g.speed = clamp(g.speed * Math.exp(gauss(w) * 0.08 * big), GENES.speed[0], GENES.speed[1]);
  g.sight = clamp(g.sight * Math.exp(gauss(w) * 0.1 * big), GENES.sight[0], GENES.sight[1]);
  g.diet = clamp(g.diet + gauss(w) * 0.05 * big, GENES.diet[0], GENES.diet[1]);
  g.hue = ((g.hue + gauss(w) * 6 * big) % 360 + 360) % 360;
  return g;
}
function event(w, text, kind) { w.events.push({ t: w.t, text, kind: kind || '' }); if (w.events.length > 200) w.events.splice(0, w.events.length - 200); }

// ---------- 図鑑（遺伝子の条件で決まる。現れたら登録） ----------
const DEX = [
  { id: 'chibi', name: 'ちびすけ', why: 'おおきさ 7 より 小さい。体が小さいと エネルギーが 減りにくい', test: c => c.size < 7 },
  { id: 'deka', name: 'でかぶつ', why: 'おおきさ 20 より 大きい。大きいと 食べられにくいが、動くと すぐ おなかが すく', test: c => c.size > 20 },
  { id: 'hayai', name: 'はやいやつ', why: 'はやさ 1.7 より 速い。草に 先に 着けるが、エネルギーの 減りが 速い', test: c => c.speed > 1.7 },
  { id: 'noroma', name: 'のろま', why: 'はやさ 0.5 より 遅い。ほとんど 動かないので 減りが 少ない。草が まわりに あれば 生きられる', test: c => c.speed < 0.5 },
  { id: 'medama', name: 'めだま', why: 'め 170 より よい。遠くの 草と 天敵が 見える', test: c => c.sight > 170 },
  { id: 'mekura', name: 'めくら', why: 'め 45 より わるい。目に エネルギーを 使わない', test: c => c.sight < 45 },
  { id: 'niku', name: 'にくしょく', why: 'たべもの が 肉寄り（0.7 より 上）。草は ほとんど 食べられず、小さい 生き物を 食べる', test: c => c.diet > 0.7 },
  { id: 'hunter', name: 'ハンター', why: '肉寄り で 速い（1.3 より 上）。逃げる 相手に 追いつける', test: c => c.diet > 0.7 && c.speed > 1.3 },
  { id: 'king', name: 'キング', why: '肉寄り で 大きい（18 より 上）。ほとんどの 生き物を 食べられる', test: c => c.diet > 0.7 && c.size > 18 },
  { id: 'chibihunter', name: 'ちびハンター', why: '肉寄り で 小さい（9 より 下）。食べられる 相手は 少ないが、減りが 少ない', test: c => c.diet > 0.7 && c.size < 9 },
  { id: 'zatsu', name: 'なんでも', why: 'たべもの が まんなか（0.4〜0.6）。草も 肉も 半分ずつ', test: c => c.diet >= 0.4 && c.diet <= 0.6 },
  { id: 'nagaiki', name: 'ながいき', why: '150 秒 より 長く 生きた', test: c => c.age > 150 },
];
function checkDex(w, c) {
  for (const d of DEX) {
    if (w.dex[d.id]) { if (d.test(c)) w.dex[d.id].n++; continue; }
    if (d.test(c)) { w.dex[d.id] = { t: w.t, gen: c.gen, n: 1 }; event(w, '図鑑: 「' + d.name + '」が あらわれた', 'dex'); }
  }
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
  // 草が湧く
  w.foodAcc += FOOD_RATE[w.settings.food] * dt;
  while (w.foodAcc >= 1) { w.foodAcc -= 1; spawnGrass(w); }
  // 肉が腐る
  for (let i = w.meat.length - 1; i >= 0; i--) { w.meat[i].life -= dt; if (w.meat[i].life <= 0) w.meat.splice(i, 1); }
  const cs = w.creatures, gm = grid(w.grass), mm = grid(w.meat), cm = grid(cs);
  const byId = new Map(); for (const c of cs) byId.set(c.id, c);
  const dead = [];
  for (const c of cs) {
    c.age += dt; c.rt -= dt; c.wt -= dt; c.flee = 0;
    // 天敵から逃げる（自分より大きい 肉寄りが 見えたら）
    let fx = 0, fy = 0, threat = 0;
    near(cm, c.x, c.y, c.sight, o => {
      if (o === c || !canEat(o, c)) return;
      const dx = c.x - o.x, dy = c.y - o.y, d2 = dx * dx + dy * dy, s = c.sight * 0.7;
      if (d2 > s * s || blocked(w, c.x, o.x)) return;
      const d = Math.sqrt(d2) + 1; fx += dx / d; fy += dy / d; threat++;
    });
    let moving = true;
    if (threat) {
      c.flee = 1; c.tk = 0;
      c.a = Math.atan2(fy, fx);
    } else {
      // 狙いを決め直す（0.3 秒ごと、または 狙いが消えたら）
      if (c.rt <= 0 || (c.tk === 1 && !byId.has(c.tid))) {
        c.rt = 0.3; c.tk = 0;
        let best = 0, bx = 0, by = 0, bk = 0, bid = 0;
        const hungry = c.e < splitAt(c) * 0.9;
        if (c.diet < 0.85) near(gm, c.x, c.y, c.sight, g => {
          if (blocked(w, c.x, g.x)) return;
          const dx = g.x - c.x, dy = g.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          const v = grassGain(c) / (Math.sqrt(d2) + 20);
          if (v > best) { best = v; bx = g.x; by = g.y; bk = 2; }
        });
        if (c.diet > 0.15) near(mm, c.x, c.y, c.sight, m => {
          if (blocked(w, c.x, m.x)) return;
          const dx = m.x - c.x, dy = m.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          const v = meatGain(c, m.e) / (Math.sqrt(d2) + 20);
          if (v > best) { best = v; bx = m.x; by = m.y; bk = 3; }
        });
        if (c.diet >= 0.5 && hungry) near(cm, c.x, c.y, c.sight, o => {
          if (o === c || !canEat(c, o) || blocked(w, c.x, o.x)) return;
          const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy; if (d2 > c.sight * c.sight) return;
          const v = meatGain(c, o.size * 5) / (Math.sqrt(d2) + 40);
          if (v > best) { best = v; bx = o.x; by = o.y; bk = 1; bid = o.id; }
        });
        if (bk) { c.tk = bk; c.tx = bx; c.ty = by; c.tid = bid; }
      }
      if (c.tk === 1) { const o = byId.get(c.tid); if (o) { c.tx = o.x; c.ty = o.y; } }
      if (c.tk) c.a = Math.atan2(c.ty - c.y, c.tx - c.x);
      else { if (c.wt <= 0) { c.wt = 0.8 + rnd(w) * 1.5; c.a += (rnd(w) - 0.5) * 2.5; } moving = c.e < splitAt(c) * 0.98 || rnd(w) < 0.5; }
    }
    // 動く
    const v = moveSpeed(c) * (c.tk || threat ? 1 : 0.45) * (moving ? 1 : 0);
    let nx = c.x + Math.cos(c.a) * v * dt, ny = c.y + Math.sin(c.a) * v * dt;
    if (blocked(w, c.x, nx)) { nx = c.x; c.a += 2.5; }
    if (!inDish(nx, ny)) { const d = Math.sqrt(nx * nx + ny * ny); nx = nx / d * (R - 5); ny = ny / d * (R - 5); c.a = Math.atan2(-ny, -nx) + (rnd(w) - 0.5) * 1.5; }
    c.x = nx; c.y = ny;
    // 食べる
    if (c.tk === 2) { const dx = c.tx - c.x, dy = c.ty - c.y; if (dx * dx + dy * dy < (c.size * 0.5 + 8) * (c.size * 0.5 + 8)) { const gi = w.grass.findIndex(g => g.x === c.tx && g.y === c.ty); if (gi >= 0) { w.grass.splice(gi, 1); c.e += grassGain(c); } c.tk = 0; c.rt = 0; } }
    else if (c.tk === 3) { const dx = c.tx - c.x, dy = c.ty - c.y; if (dx * dx + dy * dy < (c.size * 0.5 + 8) * (c.size * 0.5 + 8)) { const mi = w.meat.findIndex(m => m.x === c.tx && m.y === c.ty); if (mi >= 0) { c.e += meatGain(c, w.meat[mi].e); w.meat.splice(mi, 1); } c.tk = 0; c.rt = 0; } }
    else if (c.tk === 1) { const o = byId.get(c.tid); if (o && !o.dead) { const dx = o.x - c.x, dy = o.y - c.y; if (dx * dx + dy * dy < (c.size + o.size * 0.5) * (c.size + o.size * 0.5)) { o.dead = 'eaten'; c.e += meatGain(c, o.size * 5); c.tk = 0; c.rt = 0; w.stats.eaten++; } } }
    // 減る
    c.e -= costPerSec(c, moving) * dt;
    // 分裂
    if (c.e >= splitAt(c) && cs.length + dead.length < POP_CAP + 40) {
      c.e *= 0.5; c.kids++;
      const g = mutate(w, c), a = rnd(w) * 6.283185307179586;
      let x = c.x + Math.cos(a) * (c.size + 4), y = c.y + Math.sin(a) * (c.size + 4);
      if (!inDish(x, y) || blocked(w, c.x, x)) { x = c.x; y = c.y; }
      const k = makeCreature(w, g, x, y, c.gen + 1, c.e);
      w.creatures.push(k); w.stats.births++;
      if (k.gen > w.stats.maxGen) { w.stats.maxGen = k.gen; if (k.gen % 10 === 0) event(w, k.gen + ' 世代目が うまれた', 'gen'); }
      checkDex(w, k);
      if (w.stats.firstCarn == null && k.diet > 0.7) { w.stats.firstCarn = w.t; event(w, 'はじめての 肉食が あらわれた', 'carn'); }
    }
    if (c.e <= 0) c.dead = 'starve';
    else if (c.age >= lifespan(c)) c.dead = 'old';
    if (c.age > 150 && !c.oldChecked) { c.oldChecked = 1; checkDex(w, c); }
  }
  // 死ぬ → 肉
  let n = 0;
  for (const c of cs) {
    if (c.dead) { w.stats.deaths++; if (c.dead !== 'eaten') w.meat.push({ x: c.x, y: c.y, e: c.size * 4, life: MEAT_LIFE, size: c.size, hue: c.hue }); }
    else cs[n++] = c;
  }
  cs.length = n;
  if (cs.length > w.stats.maxPop) { w.stats.maxPop = cs.length; for (const m of [50, 100, 150, 200]) if (cs.length === m) event(w, '人口が ' + m + ' に なった', 'pop'); }
  // 全滅 → 新しい種が流れ着く
  if (cs.length === 0) {
    w.stats.extinctions++; event(w, 'ぜつめつ… あたらしい たねが ながれついた', 'ext');
    seedCreatures(w, 10, false);
  }
}
function run(w, sec) { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) step(w); }

// ---------- まとめ（画面・記録用） ----------
function summary(w) {
  const cs = w.creatures, n = cs.length;
  const avg = k => n ? cs.reduce((s, c) => s + c[k], 0) / n : 0;
  return { pop: n, grass: w.grass.length, meat: w.meat.length, carn: cs.filter(c => c.diet > 0.7).length, herb: cs.filter(c => c.diet < 0.3).length,
    size: avg('size'), speed: avg('speed'), sight: avg('sight'), diet: avg('diet'), maxGen: w.stats.maxGen, maxPop: w.stats.maxPop, t: w.t };
}
// 種（色相で近いものをまとめる。画面の「いま いる 種」用）
function species(w) {
  const groups = [];
  for (const c of w.creatures) {
    let g = null;
    for (const h of groups) { let d = Math.abs(h.hue - c.hue); d = Math.min(d, 360 - d); if (d < 22 && Math.abs(h.diet - c.diet) < 0.25 && Math.abs(Math.log(h.size / c.size)) < 0.35) { g = h; break; } }
    if (g) { g.n++; g.hue = g.hue + (c.hue - g.hue) * 0.1; g.size += (c.size - g.size) / g.n; g.speed += (c.speed - g.speed) / g.n; g.sight += (c.sight - g.sight) / g.n; g.diet += (c.diet - g.diet) / g.n; }
    else groups.push({ hue: c.hue, size: c.size, speed: c.speed, sight: c.sight, diet: c.diet, n: 1 });
  }
  return groups.sort((a, b) => b.n - a.n);
}

// ---------- 保存・URL ----------
function serialize(w) { return JSON.stringify(w); }
function deserialize(s) { try { const w = JSON.parse(s); if (!w || w.v !== SIM_VERSION || !w.creatures) return null; if (!w.meat) w.meat = []; return w; } catch (e) { return null; } }
// 友達に見せる皿: 生き物 最大 120 匹（位置 2 バイト・遺伝子 3 バイト）＋ 記録
function encodeDish(w) {
  const cs = w.creatures.slice(0, 120), out = [];
  const u8 = v => out.push(clamp(Math.round(v), 0, 255));
  const u16 = v => { v = clamp(Math.round(v), 0, 65535); out.push(v & 255, (v >> 8) & 255); };
  u8(1); u8(SIM_VERSION); u16(w.stats.maxPop); u16(w.stats.maxGen); u16(Math.min(65535, w.stats.dishT / 60)); u8(w.stats.extinctions); u8(Object.keys(w.dex).length); u8(w.grass.length > 255 ? 255 : w.grass.length); u8(cs.length);
  for (const c of cs) {
    u8((c.x + R) / (2 * R) * 255); u8((c.y + R) / (2 * R) * 255);
    u8((c.size - 5) / 21 * 255); u8(Math.log(c.speed / 0.3) / Math.log(2.2 / 0.3) * 255); u8(Math.log(c.sight / 30) / Math.log(220 / 30) * 255); u8(c.diet * 255); u8(c.hue / 360 * 255); u8(Math.min(255, c.gen));
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
    const d = { maxPop: u16(), maxGen: u16(), minutes: u16(), extinctions: u8(), dex: u8(), grass: u8(), creatures: [] };
    const n = u8();
    for (let k = 0; k < n; k++) {
      const x = u8() / 255 * 2 * R - R, y = u8() / 255 * 2 * R - R;
      const size = 5 + u8() / 255 * 21, speed = 0.3 * Math.exp(u8() / 255 * Math.log(2.2 / 0.3)), sight = 30 * Math.exp(u8() / 255 * Math.log(220 / 30)), diet = u8() / 255, hue = u8() / 255 * 360, gen = u8();
      d.creatures.push({ x, y, size, speed, sight, diet, hue, gen });
    }
    if (i !== a.length) return null;
    return d;
  } catch (e) { return null; }
}
// 友達の皿を もらう: 生き物と記録の一部を引き継いだ 新しい世界
function worldFromDish(d, seed) {
  const w = createWorld(seed);
  w.creatures = [];
  for (const c of d.creatures) w.creatures.push(makeCreature(w, c, c.x, c.y, c.gen, 40));
  w.stats.maxGen = d.maxGen;
  for (const c of w.creatures) checkDex(w, c);
  event(w, 'ともだちの 皿を もらった', 'gift');
  return w;
}

const API = { SIM_VERSION, DT, R, FOOD_RATE, GENES, DEX, POP_CAP, createWorld, step, run, summary, species, serialize, deserialize, encodeDish, decodeDish, worldFromDish,
  costPerSec, splitAt, lifespan, grassGain, meatGain, canEat, moveSpeed, rnd };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.VIV = API;
})(this);
