// node test_sim.js [分] [種] [餌 0-2] — 皿を回して、人口・遺伝子の平均・肉食・図鑑・できごとの推移を見る
'use strict';
const V = require('./sim.js');
const minutes = +(process.argv[2] || 60), seed = +(process.argv[3] || 1), food = process.argv[4] != null ? +process.argv[4] : 1;
const w = V.createWorld(seed); w.settings.food = food; if (process.argv[5]) for (const [k, v] of Object.entries(JSON.parse(process.argv[5]))) V.setSetting(w, k, v);
const t0 = Date.now();
let extAt = [];
console.log('分   人口  草  肉 | 大きさ 速さ 目  肉寄り から どく むれ | 肉食 草食 | 世代 | 種');
for (let m = 1; m <= minutes; m++) {
  const e0 = w.stats.extinctions;
  V.run(w, 60);
  if (w.stats.extinctions > e0) extAt.push(m);
  if (m % 5 === 0 || m === 1) {
    const s = V.summary(w), sp = V.species(w);
    console.log(String(m).padStart(3) + ' ' + String(s.pop).padStart(4) + ' ' + String(s.grass).padStart(3) + ' ' + String(s.meat).padStart(3) + ' | ' + s.size.toFixed(1).padStart(5) + ' ' + s.speed.toFixed(2) + ' ' + s.sight.toFixed(0).padStart(3) + ' ' + s.diet.toFixed(2) + ' ' + s.shell.toFixed(2) + ' ' + s.poison.toFixed(2) + ' ' + s.herd.toFixed(2) + ' | ' + String(s.carn).padStart(3) + ' ' + String(s.herb).padStart(4) + ' | ' + String(s.maxGen).padStart(3) + '  | ' + sp.length + ' (' + sp.slice(0, 3).map(g => g.n + '匹 大' + g.size.toFixed(0) + ' 速' + g.speed.toFixed(1) + ' 肉' + g.diet.toFixed(1)).join(', ') + ')');
  }
}
const ms = Date.now() - t0;
console.log('\n' + minutes + ' 分を ' + ms + 'ms（1 分あたり ' + Math.round(ms / minutes) + 'ms）');
console.log('最大人口 ' + w.stats.maxPop + '  最大世代 ' + w.stats.maxGen + '  うまれた ' + w.stats.births + '  死んだ ' + w.stats.deaths + '  食べられた ' + w.stats.eaten + '  ぜつめつ ' + w.stats.extinctions + (extAt.length ? '（' + extAt.join(',') + ' 分）' : ''));
console.log('図鑑: ' + Object.entries(w.dex).map(([k, v]) => V.DEX.find(d => d.id === k).name + '(' + Math.round(v.t / 60) + '分,' + v.n + ')').join(' '));
console.log('ミッション: ' + Object.keys(w.missions).map(k => V.MISSIONS.find(m => m.id === k).text).join(' / '));
console.log('できごと:'); for (const e of w.events.slice(-12)) console.log('  ' + Math.round(e.t / 60) + '分 ' + e.text);
// 保存の往復と URL
const s = V.serialize(w), w2 = V.deserialize(s);
console.log('\n保存 ' + Math.round(s.length / 1024) + 'KB 往復 ' + (w2 && w2.creatures.length === w.creatures.length ? 'OK' : 'NG'));
const enc = V.encodeDish(w), dec = V.decodeDish(enc);
console.log('URL ' + enc.length + ' 文字 往復 ' + (dec && dec.creatures.length === Math.min(100, w.creatures.length) && dec.maxPop === w.stats.maxPop ? 'OK' : 'NG'));
// 決定性
const a = V.createWorld(5), b = V.createWorld(5); V.run(a, 120); V.run(b, 120);
console.log('決定性 ' + (V.serialize(a) === V.serialize(b) ? 'OK' : 'NG'));
