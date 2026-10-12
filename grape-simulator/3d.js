// グレープシミュレーターの 3D モード（自分の目で歩きまわって、フルーツのキャラたちと撃ちあう）。index.html で、game.js の次に読みこむ。
// 絵は WebGL で描く：地面（山や坂）と、箱を組み合わせた建物や木を、太陽の光で明るく・暗くして、影もつける（シャドウマップ）。
// あそび方：マップに落ちている銃をひろって、ほかのキャラたちと撃ちあう。最後の1人になったら勝ち。
// バックルームは、暗くて広い部屋で、出口をさがす。バクテリアが追ってくる。出口を見つけたら、つぎのレベルへ（レベル0〜3）。
(() => {
'use strict';
const tr = (s, v) => window.GrapeLang.t(s, v);
const SND = () => window.GrapeSound || { play() {} };
const byId = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ---- 行列（4×4、たての列ごとにならべる） ----
const I4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const M = (...ms) => ms.reduce(mul);
const T = (x, y, z) => { const o = I4(); o[12] = x; o[13] = y; o[14] = z; return o; };
const S = (x, y, z) => { const o = I4(); o[0] = x; o[5] = y; o[10] = z; return o; };
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a), o = I4(); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; };
const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a), o = I4(); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; };
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a), o = I4(); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; };
function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
function ortho(l, r, b, t, n, f) { const o = I4(); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); return o; }
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(e, c, up) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
// 向き（yaw: 左右、pitch: 上下）から、前の向き。yaw 0 は -z の方
const fwd = (yaw, pitch = 0) => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];

// ---- でこぼこ（地面の形） ----
function hash2(x, z, s) { let n = (x * 374761393 + z * 668265263 + s * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, s) { let t = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { t += a * vnoise(x * f, z * f, s + i); a *= 0.5; f *= 2; } return t; }
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickC = (rng, list) => list[Math.floor(rng() * list.length)];

// ---- 武器 ----
// dmg 1発のダメージ、rate つぎに撃てるまでの時間（びょう）、mag 1回にこめられる数、reload こめなおす時間、spread ばらつき、pellets 1回に出る弾の数
const GUNS = {
  pistol: { name: 'ピストル', dmg: 24, rate: 0.3, mag: 12, reload: 1.2, spread: 0.018, range: 70, pellets: 1, sound: 'bang', pitch: 1, len: 0.32 },
  shotgun: { name: 'ショットガン', dmg: 11, rate: 0.9, mag: 5, reload: 2.0, spread: 0.075, range: 28, pellets: 9, sound: 'bang', pitch: 0.7, len: 0.7 },
  mgun: { name: 'マシンガン', dmg: 15, rate: 0.11, mag: 30, reload: 1.9, spread: 0.032, range: 90, pellets: 1, auto: true, sound: 'mg', pitch: 1, len: 0.8 },
  sniper: { name: 'スナイパー', dmg: 95, rate: 1.4, mag: 1, reload: 2.3, spread: 0.002, range: 250, pellets: 1, sound: 'bang', pitch: 0.5, len: 1.1, zoom: true },
};
const FIST = { dmg: 20, rate: 0.45, range: 2.2 };
// コンピューターのキャラの強さ。aim0 はじめのねらいのずれ、aimMin いちばん上手なときのずれ、react 見つけてから撃つまで（びょう）、
// shots 1びょうに撃とうとする回数（連射の銃 / ほかの銃）、hurt プレイヤーへのダメージの倍率、sight 見つけられるきょり、grace はじめにプレイヤーをねらわない時間
const BOT = { aim0: 0.14, aimMin: 0.06, aimGain: 0.02, react: [0.9, 1.6], shots: [5, 1.6], hurt: 0.5, sight: 20, turn: 3, grace: 15 };

// ---- ステージ（マップ）を作る ----
// h: 地面の高さ（ます目ごと）、boxes: かべや建物（{x0,y0,z0,x1,y1,z1,col,kind}）、water/lava: 水や溶岩の高さ、
// sun: 太陽の向き、sky: [天頂, 地平線]、fog: もやの色、fogD: もやの遠さ、gravity: 重力、mode: 'battle' か 'escape'
function makeWorld(id) {
  const rng = mulberry(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + Math.floor(Math.random() * 1000));
  const W = {
    id, N: 100, boxes: [], water: null, lava: null, gravity: 22, mode: 'battle', ceiling: null, shadows: true, maze: null,
    sun: norm([0.45, 0.85, 0.3]), sunCol: [1, 0.96, 0.85], sky: ['#3f8fd8', '#cfe8f7'], skyLow: '#9bb37a', fog: '#cfe8f7', fogD: 120,
    ground: (x, z, h, n) => (n < 0.45 ? '#58a848' : '#4f9a3a'), stars: false, planet: false, extra: [], exit: null,
  };
  let hf = () => 0;
  const height = (x, z) => hf(x, z);
  const box = (x0, y0, z0, x1, y1, z1, col, kind) => W.boxes.push({ x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), col: hexRgb(col), kind });
  const tree = (x, z, palm) => {
    const y = height(x, z);
    if (palm) { box(x - 0.15, y, z - 0.15, x + 0.15, y + 4, z + 0.15, '#9c6b3f'); box(x - 1.6, y + 3.8, z - 1.6, x + 1.6, y + 4.2, z + 1.6, '#2f7a2f'); return; }
    box(x - 0.2, y, z - 0.2, x + 0.2, y + 2.2, z + 0.2, '#7a5230');
    box(x - 1.1, y + 1.8, z - 1.1, x + 1.1, y + 3.6, z + 1.1, '#3f8a3a');
    box(x - 0.7, y + 3.6, z - 0.7, x + 0.7, y + 4.5, z + 0.7, '#4f9a3a');
  };
  // 中に入れて、外の階段で屋上にも上がれる家（入り口は -z がわ）
  const house = (x, z, w, d, hgt, wall, roof) => {
    const y = height(x + w / 2, z + d / 2), t = 0.3;
    box(x, y, z + d - t, x + w, y + hgt, z + d, wall);
    box(x, y, z, x + t, y + hgt, z + d, wall);
    box(x + w - t, y, z, x + w, y + hgt, z + d, wall);
    box(x, y, z, x + w / 2 - 0.8, y + hgt, z + t, wall);
    box(x + w / 2 + 0.8, y, z, x + w, y + hgt, z + t, wall);
    box(x + w / 2 - 0.8, y + 2.3, z, x + w / 2 + 0.8, y + hgt, z + t, wall);
    box(x - 0.2, y + hgt, z - 0.2, x + w + 0.2, y + hgt + 0.3, z + d + 0.2, roof);
    for (let k = 0; k < Math.ceil((hgt + 0.3) / 0.45); k++) box(x + w, y, z + d - 1.4 - k * 0.5, x + w + 1.2, y + 0.45 * (k + 1), z + d - 0.9 - k * 0.5, '#9aa0a8');
  };
  const crates = (n) => { for (let k = 0; k < n; k++) { const x = 6 + rng() * (W.N - 12), z = 6 + rng() * (W.N - 12), y = height(x, z); const st = 1 + Math.floor(rng() * 2); for (let j = 0; j < st; j++) box(x, y + j * 1.3, z, x + 1.3, y + (j + 1) * 1.3, z + 1.3, j % 2 ? '#b77f45' : '#c98b4a'); } };
  switch (id) {
    case 'city': {
      W.ground = () => '#3d4046';
      for (let bx = 8; bx < W.N - 14; bx += 18) for (let bz = 8; bz < W.N - 14; bz += 18) {
        if (rng() < 0.35) { house(bx + 1, bz + 1, 9, 8, 3.2, pickC(rng, ['#c46a4a', '#d9b36a', '#6aa88a']), '#55595f'); continue; }
        const w = 9 + rng() * 3, d = 9 + rng() * 3, hgt = 8 + Math.floor(rng() * 14), col = pickC(rng, ['#7a8fb0', '#8a7ab8', '#c46a4a', '#9aa0a8']);
        for (let y = 0; y < hgt; y += 2) { box(bx, y, bz, bx + w, y + 1.4, bz + d, col); box(bx + 0.05, y + 1.4, bz + 0.05, bx + w - 0.05, y + 2, bz + d - 0.05, '#2d3a4f'); }
      }
      for (let k = 0; k < 10; k++) { const x = 6 + rng() * 88, z = 6 + rng() * 88; box(x, 0, z, x + 1.8, 1.3, z + 4, pickC(rng, ['#d23a2a', '#3c7dd9', '#f0c030'])); }
      break;
    }
    case 'hills': case 'endless':
      if (id === 'endless') W.N = 140;
      hf = (x, z) => 9 * fbm(x / 28, z / 28, 3) - 3;
      for (let k = 0; k < (id === 'endless' ? 60 : 35); k++) tree(4 + rng() * (W.N - 8), 4 + rng() * (W.N - 8));
      for (let k = 0; k < 12; k++) { const x = 4 + rng() * (W.N - 8), z = 4 + rng() * (W.N - 8), y = height(x, z); box(x, y - 0.5, z, x + 1 + rng() * 2, y + 1 + rng(), z + 1 + rng() * 2, '#8a8a8a'); }
      house(30, 40, 10, 8, 3.2, '#d9b36a', '#8e1f16'); house(65, 60, 9, 8, 3.2, '#c46a4a', '#55595f');
      W.sky = ['#5fa8e0', '#d6eef8'];
      break;
    case 'tower': {
      W.ground = () => '#4b515b';
      const cx = 50, cz = 50;   // まん中の高いとう。外がわのらせん階段で、上まで登れる
      for (let y = 0; y < 30; y += 3) { box(cx - 4, y, cz - 4, cx + 4, y + 2.6, cz + 4, '#7a7390'); box(cx - 4.2, y + 2.6, cz - 4.2, cx + 4.2, y + 3, cz + 4.2, '#5a5470'); }
      for (let k = 0; k < 75; k++) {
        const a = k * 0.42, r = 6, y = k * 0.4;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        box(x - 1.1, y, z - 1.1, x + 1.1, y + 0.4, z + 1.1, '#9aa0a8');
      }
      box(cx - 5, 30, cz - 5, cx + 5, 30.4, cz + 5, '#5a5470');
      crates(25);
      house(15, 15, 9, 8, 3.2, '#c46a4a', '#55595f'); house(75, 75, 9, 8, 3.2, '#6aa88a', '#55595f');
      W.sun = norm([-0.8, 0.35, 0.2]); W.sunCol = [1, 0.75, 0.5]; W.sky = ['#c86a4a', '#f4b86a']; W.fog = '#f0c090'; W.skyLow = '#a0705a';
      break;
    }
    case 'sea':
      hf = (x, z) => { const r = Math.hypot(x - 50, z - 50); return 4 * (1 - r / 38) + 1.2 * fbm(x / 10, z / 10, 5) - 0.6; };
      W.water = 0;
      W.ground = (x, z, h) => (h < 1 ? '#d9c08a' : '#58a848');
      for (let k = 0; k < 18; k++) { const a = rng() * 6.28, r = 8 + rng() * 22; tree(50 + Math.cos(a) * r, 50 + Math.sin(a) * r, true); }
      box(48, 0.2, 80, 52, 0.6, 96, '#9c6b3f');
      house(42, 38, 10, 8, 3.2, '#efe0b0', '#3c7dd9');
      W.sky = ['#3f9ae0', '#bfe6f7'];
      break;
    case 'volcano':
      hf = (x, z) => { const r = Math.hypot(x - 50, z - 50); const cone = r < 7 ? 12 + (r / 7) * 4 : 16 * Math.max(0, 1 - (r - 7) / 30); return cone + 1.8 * fbm(x / 9, z / 9, 9) + 0.05; };
      W.lava = 0.4;
      W.ground = (x, z, h) => (h > 9 ? '#3d3236' : '#2b2327');
      for (let k = 0; k < 20; k++) { const x = 5 + rng() * 90, z = 5 + rng() * 90, y = height(x, z); box(x, y - 0.4, z, x + 1.5, y + 1.6, z + 1.5, '#5a4248'); }
      W.sun = norm([0.3, 0.6, -0.5]); W.sunCol = [1, 0.55, 0.35]; W.sky = ['#2a1418', '#62302a']; W.fog = '#4a2420'; W.fogD = 70; W.skyLow = '#3a1c20';
      break;
    case 'lab':
      W.ground = () => '#5b646e';
      for (let k = 0; k < 9; k++) { const x = 8 + (k % 3) * 30 + rng() * 6, z = 8 + Math.floor(k / 3) * 30 + rng() * 6; house(x, z, 12, 10, 3.6, '#9aa5b0', '#5b646e'); }
      for (let k = 0; k < 14; k++) { const x = 6 + rng() * 88, z = 6 + rng() * 88; box(x, 0, z, x + 2.5, 0.35, z + 1.2, '#d6dce2', 'spike'); }
      W.sky = ['#9aa5b0', '#cfd6dc']; W.fog = '#cfd6dc'; W.fogD = 90;
      break;
    case 'space':
      hf = (x, z) => { let h = 1.5 * fbm(x / 14, z / 14, 13); for (const [cx, cz, r] of [[30, 30, 9], [70, 40, 12], [45, 75, 7], [80, 80, 10]]) { const d = Math.hypot(x - cx, z - cz) / r; if (d < 1.25) h += d < 1 ? -3 * (1 - d * d) : 2 * (1.25 - d) * 4 * (d - 1); } return h; };
      W.gravity = 7; W.ground = () => '#7d818c'; W.sky = ['#000000', '#0b0f2a']; W.stars = true; W.planet = true; W.fog = '#0b0f2a'; W.fogD = 140; W.skyLow = '#20232c';
      W.sun = norm([0.6, 0.5, 0.2]);
      for (let k = 0; k < 18; k++) { const x = 5 + rng() * 90, z = 5 + rng() * 90, y = height(x, z); box(x, y - 0.3, z, x + 1.2 + rng(), y + 1.2 + rng(), z + 1.2, '#6b6f7a'); }
      house(48, 48, 10, 8, 3.2, '#d5dbe1', '#9aa3ad');
      break;
    case 'park':
      hf = (x, z) => { const d = Math.hypot((x - 62) / 10, (z - 45) / 7); return d < 1 ? -0.9 * (1 - d * d) : 0.25 * fbm(x / 8, z / 8, 2); };
      W.water = -0.3;
      for (let k = 0; k < 30; k++) { const x = 4 + rng() * 92, z = 4 + rng() * 92; if (Math.hypot((x - 62) / 12, (z - 45) / 9) > 1) tree(x, z); }
      for (let k = 0; k < 12; k++) box(22 + k * 0.6, 0, 20, 23 + k * 0.6, 3 - k * 0.24, 21.2, '#e23b3b');   // すべり台
      box(21, 0, 20, 21.4, 3, 21.2, '#6b737e');
      for (const [x, z] of [[40, 20], [44, 20], [40, 24], [44, 24]]) box(x, 0, z, x + 0.25, 3, z + 0.25, '#6b737e');
      box(40, 3, 20, 44.25, 3.25, 24.25, '#6b737e'); box(40, 1.5, 20, 44.25, 1.7, 24.25, '#6b737e');
      for (let k = 0; k < 6; k++) { const x = 10 + rng() * 80, z = 10 + rng() * 80; box(x, 0.4, z, x + 2.2, 0.55, z + 0.6, '#9c6b3f'); }
      break;
    case 'station':
      W.ground = (x, z) => (z > 44 && z < 56 ? '#6f6a63' : '#8c887e');
      box(4, 0, 30, 96, 1.2, 44, '#8c887e'); box(4, 0, 56, 96, 1.2, 70, '#8c887e');
      box(4, 1.2, 43.6, 96, 1.22, 44, '#e8c547'); box(4, 1.2, 56, 96, 1.22, 56.4, '#e8c547');
      for (let x = 8; x < 96; x += 12) { box(x, 1.2, 33, x + 0.4, 5, 33.4, '#9aa5b0'); box(x, 1.2, 66.6, x + 0.4, 5, 67, '#9aa5b0'); }
      box(4, 5, 30, 96, 5.3, 38, '#d9d4c7'); box(4, 5, 62, 96, 5.3, 70, '#d9d4c7');
      for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) box(10 + k * 15, j * 0.4, 44.4 + j * 0.5, 12 + k * 15, (j + 1) * 0.4, 44.9 + j * 0.5, '#77736a');
      W.train = { z: 50, x: -40, dir: 1, run: false, timer: 12 };
      crates(14);
      break;
    case 'backrooms':
      return makeBackLevel(W, brLevel);
    default:   // グラウンドと、それ以外
      W.ground = (x, z, h, n) => (n < 0.5 ? '#5a6068' : '#4b515b');
      hf = (x, z) => 0.3 * fbm(x / 8, z / 8, 1);
      crates(30);
      for (let k = 0; k < 8; k++) { const x = 8 + rng() * 84, z = 8 + rng() * 84; if (rng() < 0.5) box(x, 0, z, x + 5, 2.4, z + 0.4, '#9aa0a8'); else box(x, 0, z, x + 0.4, 2.4, z + 5, '#9aa0a8'); }
      house(20, 60, 10, 8, 3.2, '#c46a4a', '#55595f'); house(65, 25, 10, 8, 3.2, '#7a8fb0', '#55595f');
  }
  buildHeights(W, hf);
  return W;
}
function buildHeights(W, hf) {
  const N = W.N, H = new Float32Array((N + 1) * (N + 1));
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) H[z * (N + 1) + x] = hf(x, z);
  W.h = H;
}
// ---- バックルーム（出口をさがす。見つけたら、つぎのレベルへ） ----
// 暗くて、天井の明かりのまわりだけが明るい。広い部屋に柱がならんで、ところどころ、かべがある。
// N: 広さ、ceil: 天井の高さ、light: 明かりの色、lightStep: 明かりのならぶ間かく、lightP: 明かりがある割合、flicker: チカチカする割合、
// pillarStep/pillarP/pillar: 柱の間かく・ある割合・太さ、walls: かべの数、amb: 明かりの無い所の明るさ、bact: バクテリアの、出てくるまでの時間と速さ
const BR_LEVELS = [
  { name: 'レベル0', desc: '黄色い部屋', N: 72, ceil: 3.0, wall: '#c9b858', floor: '#7d6e30', ceilCol: '#b5ab82', light: [1, 0.95, 0.72], lightStep: 6, lightP: 0.55,
    flicker: 0.12, pillarStep: 6, pillarP: 0.35, pillar: 0.6, walls: 24, fog: '#0d0b04', fogD: 26, amb: 0.06, bact: { delay: 25, speed: 2.8, sprint: 5.0 } },
  { name: 'レベル1', desc: 'くらいコンクリートの倉庫', N: 80, ceil: 4.2, wall: '#7c7f84', floor: '#55585c', ceilCol: '#5a5d61', light: [0.8, 0.88, 1], lightStep: 9, lightP: 0.45,
    flicker: 0.25, pillarStep: 8, pillarP: 0.6, pillar: 1.2, walls: 16, crates: 45, fog: '#060708', fogD: 22, amb: 0.04, bact: { delay: 20, speed: 3.0, sprint: 5.2 } },
  { name: 'レベル2', desc: 'パイプだらけの通路', maze: true, N: 54, ceil: 2.6, wall: '#4a3f36', floor: '#3a3430', ceilCol: '#2e2a26', light: [1, 0.55, 0.3], lightP: 0.35,
    flicker: 0.3, fog: '#050403', fogD: 16, amb: 0.03, bact: { delay: 18, speed: 3.1, sprint: 5.3 } },
  { name: 'レベル3', desc: '機械の電気室', N: 76, ceil: 3.6, wall: '#3c4048', floor: '#2c2f35', ceilCol: '#25282d', light: [0.6, 0.85, 1], lightStep: 8, lightP: 0.45,
    flicker: 0.35, pillarStep: 7, pillarP: 0.3, pillar: 0.8, walls: 20, machines: 30, fog: '#030406', fogD: 20, amb: 0.035, bact: { delay: 14, speed: 3.2, sprint: 5.4 } },
];
let brLevel = 0;
function makeBackLevel(W, lv) {
  const L = BR_LEVELS[lv], N = L.N, rng = mulberry((Date.now() % 100000) + lv * 7919);
  Object.assign(W, { N, mode: 'escape', level: lv, shadows: false, ceiling: L.ceil, sky: [L.fog, L.fog], fog: L.fog, fogD: L.fogD, sun: norm([0.2, 1, 0.1]), sunCol: [0, 0, 0],
                     ground: () => L.floor, skyLow: L.fog, dark: true, amb: L.amb, lights: [], start: { x: 3, z: 3 } });
  buildHeights(W, () => 0);
  const vary = (hex, k) => { const c = hexRgb(hex), m = 1 + (rng() - 0.5) * k; return c.map((v) => clamp(v * m, 0, 1)); };
  const box = (x0, y0, z0, x1, y1, z1, hex, k = 0.08) => W.boxes.push({ x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), col: vary(hex, k) });
  const nearStart = (x0, z0, x1, z1) => x0 < 7 && z0 < 7 && x1 > 0 && z1 > 0;
  box(0, 0, -0.3, N, L.ceil, 0, L.wall); box(0, 0, N, N, L.ceil, N + 0.3, L.wall); box(-0.3, 0, 0, 0, L.ceil, N, L.wall); box(N, 0, 0, N + 0.3, L.ceil, N, L.wall);
  const light = (x, z) => W.lights.push({ x, z, y: L.ceil - 0.08, col: L.light, flicker: rng() < L.flicker, phase: rng() * 100 });
  if (L.maze) {   // パイプの通路：せまい めいろ。かべにそって、パイプが走る
    const cell = 3, C = N / cell, east = [], south = [], seen = new Set(['0,0']), stack = [[0, 0]];
    for (let z = 0; z < C; z++) { east.push(Array(C).fill(false)); south.push(Array(C).fill(false)); }
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cx + dx, cz + dz, dx, dz]).filter(([x, z]) => x >= 0 && z >= 0 && x < C && z < C && !seen.has(x + ',' + z));
      if (!next.length) { stack.pop(); continue; }
      const [x, z, dx, dz] = next[Math.floor(rng() * next.length)];
      if (dx === 1) east[cz][cx] = true; else if (dx === -1) east[z][x] = true; else if (dz === 1) south[cz][cx] = true; else south[z][x] = true;
      seen.add(x + ',' + z);
      stack.push([x, z]);
    }
    for (let k = 0; k < C * 3; k++) { const x = Math.floor(rng() * (C - 1)), z = Math.floor(rng() * (C - 1)); if (rng() < 0.5) east[z][x] = true; else south[z][x] = true; }
    const pipe = (x0, z0, x1, z1) => { box(x0, L.ceil - 0.55, z0, x1, L.ceil - 0.35, z1, rng() < 0.5 ? '#8a5a33' : '#6b737e', 0.2); };
    for (let z = 0; z < C; z++) for (let x = 0; x < C; x++) {
      if (x < C - 1 && !east[z][x]) { const wx = (x + 1) * cell; box(wx - 0.15, 0, z * cell, wx + 0.15, L.ceil, (z + 1) * cell, L.wall); pipe(wx - 0.4, z * cell, wx - 0.15, (z + 1) * cell); }
      if (z < C - 1 && !south[z][x]) { const wz = (z + 1) * cell; box(x * cell, 0, wz - 0.15, (x + 1) * cell, L.ceil, wz + 0.15, L.wall); pipe(x * cell, wz + 0.15, (x + 1) * cell, wz + 0.4); }
      if (rng() < L.lightP || (x === 0 && z === 0)) light(x * cell + cell / 2, z * cell + cell / 2);
    }
    W.start = { x: 1.5, z: 1.5 };
  } else {
    for (let x = L.pillarStep; x < N - 2; x += L.pillarStep) for (let z = L.pillarStep; z < N - 2; z += L.pillarStep) {
      const h = L.pillar / 2;
      if (rng() < L.pillarP && !nearStart(x - h, z - h, x + h, z + h)) box(x - h, 0, z - h, x + h, L.ceil, z + h, L.wall);
    }
    for (let k = 0; k < L.walls; k++) {   // かべ（ときどき、まん中に出入り口）
      const len = 4 + rng() * 10, x = 2 + rng() * (N - 4 - len), z = 2 + rng() * (N - 4), horiz = rng() < 0.5;
      const seg = (a, b) => { if (horiz) { if (!nearStart(x + a, z - 0.2, x + b, z + 0.2)) box(x + a, 0, z - 0.15, x + b, L.ceil, z + 0.15, L.wall); } else if (!nearStart(z - 0.2, x + a, z + 0.2, x + b)) box(z - 0.15, 0, x + a, z + 0.15, L.ceil, x + b, L.wall); };
      if (rng() < 0.5 && len > 6) { const d = len / 2 - 0.9; seg(0, d); seg(d + 1.8, len); } else seg(0, len);
    }
    for (let k = 0; k < (L.crates || 0); k++) {   // 倉庫の木箱
      const x = 3 + rng() * (N - 6), z = 3 + rng() * (N - 6), st = 1 + Math.floor(rng() * 3);
      if (nearStart(x, z, x + 1.3, z + 1.3)) continue;
      for (let j = 0; j < st; j++) box(x, j * 1.2, z, x + 1.2, (j + 1) * 1.2, z + 1.2, '#6b5a3e', 0.25);
    }
    for (let k = 0; k < (L.machines || 0); k++) {   // 電気室の機械（小さなランプが光る）
      const x = 3 + rng() * (N - 6), z = 3 + rng() * (N - 6), w = 1 + rng() * 1.5, d = 0.8 + rng(), h = 1.4 + rng() * 1.2;
      if (nearStart(x, z, x + w, z + d)) continue;
      box(x, 0, z, x + w, h, z + d, '#4a5058', 0.2);
      for (let j = 0; j < 3; j++) W.extra.push({ x0: x + 0.15 + j * 0.25, y0: h - 0.35, z0: z - 0.02, x1: x + 0.27 + j * 0.25, y1: h - 0.23, z1: z, col: [[1, 0.2, 0.2], [0.2, 1, 0.3], [1, 0.8, 0.2]][j] });
    }
    for (let x = L.lightStep / 2; x < N; x += L.lightStep) for (let z = L.lightStep / 2; z < N; z += L.lightStep) if (rng() < L.lightP) light(x, z);
    light(3.5, 3.5);
  }
  box(-0.3, L.ceil, -0.3, N + 0.3, L.ceil + 0.3, N + 0.3, L.ceilCol, 0);
  for (const l of W.lights) if (!l.flicker) W.extra.push({ x0: l.x - 0.6, y0: L.ceil - 0.06, z0: l.z - 0.35, x1: l.x + 0.6, y1: L.ceil, z1: l.z + 0.35, col: l.col });
  // 通れる所の地図をつくって、はじめの場所から いちばん遠い所に出口を置く
  buildOcc(W);
  const d = occBfs(W, W.start.x, W.start.z);
  let far = 0;
  d.forEach((v) => { if (v > far) far = v; });
  const cand = [];
  d.forEach((v, i) => { if (v > far * 0.7) cand.push(i); });   // いちばん遠い所に近い所の、どこか
  const fi = cand[Math.floor(rng() * cand.length)];
  W.exit = { x: (fi % W.occW + 0.5) * OCC, z: (Math.floor(fi / W.occW) + 0.5) * OCC };
  W.bactCfg = L.bact;
  return W;
}
// 通れる所の地図（OCC ます ごと。1 は、かべや柱がある）
const OCC = 0.5;
function buildOcc(W) {
  const G = Math.ceil(W.N / OCC), occ = new Uint8Array(G * G);
  for (const b of W.boxes) {
    if (b.y0 > 1.7 || b.y1 < 0.3) continue;
    for (let gz = Math.max(0, Math.floor((b.z0 - 0.3) / OCC)); gz <= Math.min(G - 1, Math.floor((b.z1 + 0.3) / OCC)); gz++)
      for (let gx = Math.max(0, Math.floor((b.x0 - 0.3) / OCC)); gx <= Math.min(G - 1, Math.floor((b.x1 + 0.3) / OCC)); gx++) occ[gz * G + gx] = 1;
  }
  W.occ = occ; W.occW = G;
}
// (x, z) から、通れる所をたどった歩数（ます）。行けない所は -1
function occBfs(W, x, z) {
  const G = W.occW, d = new Int32Array(G * G).fill(-1), q = new Int32Array(G * G);
  const s = clamp(Math.floor(z / OCC), 0, G - 1) * G + clamp(Math.floor(x / OCC), 0, G - 1);
  let h = 0, t = 0;
  d[s] = 0; q[t++] = s;
  while (h < t) {
    const i = q[h++], ix = i % G, iz = (i - ix) / G;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx, nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
      const n = nz * G + nx;
      if (d[n] < 0 && !W.occ[n]) { d[n] = d[i] + 1; q[t++] = n; }
    }
  }
  return d;
}

// ---- ゲームの状態 ----
let gl = null, P = null, W = null, on = false, raf = 0, last = 0, ended = false, startTime = 0, mapId = 'ground', prevPaused = false;
let ents = [], loot = [], parts = [], tracers = [], flashes = [], feed = [], train = null, bact = null;
const keys = new Set(), touch = { mx: 0, mz: 0, fire: false, look: null, stick: null, jump: false, swap: false };
let simTime = 0;   // ゲームの中の時間（びょう）
let flash = true;  // 懐中電灯（バックルーム）
let intro = null;  // ノークリップの動画（{ t: 時間, step: どこまで進んだか }）
let locked = false, mouseDown = false, aimZoom = false, hitMarkT = 0, dmgT = 0, msgT = 0;
const H_BODY = 1.8, EYE = 1.6, R_BODY = 0.3;

function heightAt(x, z) {
  const N = W.N;
  x = clamp(x, 0, N - 0.001); z = clamp(z, 0, N - 0.001);
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, w = N + 1, H = W.h;
  const a = H[zi * w + xi], b = H[zi * w + xi + 1], c = H[(zi + 1) * w + xi], d = H[(zi + 1) * w + xi + 1];
  return fx + fz < 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
// 箱を、8 ます ごとの入れ物に分けておく（ぶつかりを、近くの箱だけで調べるため）
let grid = new Map();
function buildGrid() {
  grid = new Map();
  W.boxes.forEach((b, i) => {
    if (b.x1 - b.x0 > 40 && b.z1 - b.z0 > 40) { (grid.big = grid.big || []).push(i); return; }   // めいろの天井のような、大きな板
    for (let gx = Math.floor(b.x0 / 8); gx <= Math.floor(b.x1 / 8); gx++) for (let gz = Math.floor(b.z0 / 8); gz <= Math.floor(b.z1 / 8); gz++) {
      const k = gx * 4096 + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
}
function boxesNear(x, z) {
  const out = new Set();
  for (let gx = Math.floor(x / 8) - 1; gx <= Math.floor(x / 8) + 1; gx++) for (let gz = Math.floor(z / 8) - 1; gz <= Math.floor(z / 8) + 1; gz++) {
    const l = grid.get(gx * 4096 + gz);
    if (l) for (const i of l) out.add(W.boxes[i]);
  }
  for (const i of grid.big || []) out.add(W.boxes[i]);
  return out;
}
const overlaps = (e, b) => e.x - R_BODY < b.x1 && e.x + R_BODY > b.x0 && e.z - R_BODY < b.z1 && e.z + R_BODY > b.z0 && e.y < b.y1 - 0.001 && e.y + H_BODY > b.y0;
function blockedAt(x, z, y) {
  const t = { x, z, y };
  for (const b of boxesNear(x, z)) if (overlaps(t, b)) return true;
  return false;
}
// 体を動かす（よこ → たての順に、箱と地面にぶつけて止める）。低い段（0.55 まで）は、自動で上がる
function moveBody(e, dx, dy, dz) {
  for (const [axis, d] of [['x', dx], ['z', dz]]) {
    if (!d) continue;
    const before = e[axis];
    e[axis] += d;
    for (const b of boxesNear(e.x, e.z)) {
      if (!overlaps(e, b)) continue;
      if (e.onGround && b.y1 - e.y <= 0.55 && !blockedAt(e.x, e.z, b.y1)) { e.y = b.y1; continue; }
      e[axis] = d > 0 ? b[axis + '0'] - R_BODY - 0.001 : b[axis + '1'] + R_BODY + 0.001;
      e.blocked = true;
    }
    const lim = W.N - 1;
    if (e[axis] < 1 || e[axis] > lim) { e[axis] = clamp(e[axis], 1, lim); e.blocked = true; }
    if (W.water != null && heightAt(e.x, e.z) < W.water - 1.4) { e[axis] = before; e.blocked = true; }   // ふかい水の中には入れない
  }
  e.onGround = false;
  e.y += dy;
  for (const b of boxesNear(e.x, e.z)) {
    if (!overlaps(e, b)) continue;
    if (dy <= 0) { e.y = b.y1; e.vy = 0; e.onGround = true; } else { e.y = b.y0 - H_BODY - 0.001; e.vy = 0; }
  }
  const g = heightAt(e.x, e.z);
  if (e.y <= g) { e.y = g; e.vy = 0; e.onGround = true; }
}
// 線を、ある向きに出したとき、最初に当たるもの。{ t: きょり, ent, head, box, ground }
function slab(o, d, x0, y0, z0, x1, y1, z1, maxT) {
  let t0 = 0, t1 = maxT;
  for (const [a, lo, hi] of [[0, x0, x1], [1, y0, y1], [2, z0, z1]]) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return -1; continue; }
    let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
function raycast(o, d, maxT, skip) {
  let best = { t: maxT };
  for (const b of W.boxes) { const t = slab(o, d, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, best.t); if (t >= 0 && t < best.t) best = { t, box: b }; }
  for (let t = 0.3; t < best.t; t += 0.4) {   // 地面
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    if (y < heightAt(x, z)) { best = { t: Math.max(0, t - 0.2), ground: true }; break; }
  }
  for (const e of ents) {
    if (e === skip || !e.alive) continue;
    const tb = slab(o, d, e.x - 0.36, e.y, e.z - 0.36, e.x + 0.36, e.y + 1.36, e.z + 0.36, best.t);
    if (tb >= 0 && tb < best.t) best = { t: tb, ent: e, head: false };
    const th = slab(o, d, e.x - 0.3, e.y + 1.36, e.z - 0.3, e.x + 0.3, e.y + 1.92, e.z + 0.3, best.t);
    if (th >= 0 && th < best.t) best = { t: th, ent: e, head: true };
  }
  if (bact && bact.on && bact.alive && skip !== bact) {
    const tb = slab(o, d, bact.x - 0.35, 0, bact.z - 0.35, bact.x + 0.35, 3.0 * bactScale(), bact.z + 0.35, best.t);
    if (tb >= 0 && tb < best.t) best = { t: tb, bact: true };
  }
  return best;
}
function canSee(a, b) {
  const o = [a.x, a.y + EYE, a.z], d = [b.x - o[0], b.y + 1.2 - o[1], b.z - o[2]], len = Math.hypot(d[0], d[1], d[2]);
  const h = raycast(o, [d[0] / len, d[1] / len, d[2] / len], len, a);
  return h.ent === b || h.t >= len - 0.3;
}

// ---- キャラ ----
function makeEnt(kind, x, z, isPlayer) {
  const pal = window.GRAPE.art3d.palette(kind);
  return { kind, name: pal.name, pal: { skin: hexRgb(pal.P), dark: hexRgb(pal.D), shirt: hexRgb(pal.S || pal.P), stem: hexRgb(pal.G || '#5cb85c'), blood: hexRgb(pal.blood || '#d0182e') },
           x, y: heightAt(x, z), z, vy: 0, yaw: Math.random() * 6.28, pitch: 0, hp: 100, alive: true, isPlayer, slots: [null, null, null], cur: 0,
           cool: 0, reloadT: 0, walk: 0, onGround: true, kills: 0, think: 0, goal: null, target: null, enemy: null, strafe: 1, fallT: 0, aimErr: BOT.aim0, readyT: 0 };
}
const gunOf = (e) => e.slots[e.cur];
function giveGun(e, type) {
  const g = { type, ammo: GUNS[type].mag };
  let i = e.slots.findIndex((s) => !s);
  if (i < 0) i = e.cur;
  e.slots[i] = g;
  e.cur = i;
  return g;
}
function damage(e, n, by, head) {
  if (!e.alive || ended) return;
  e.hp -= n;
  if (by && !e.isPlayer && by !== e) e.target = by;
  bleed(e.x, e.y + (head ? 1.7 : 1.1), e.z, e.pal.blood, Math.round(n / 4) + 3);
  if (e.isPlayer) { dmgT = 0.35; SND().play('hit', 0.7); }
  if (e.hp > 0) return;
  e.alive = false;
  e.fallT = 0;
  bleed(e.x, e.y + 1, e.z, e.pal.blood, 22);
  SND().play('death', e.isPlayer ? 1 : 0.6);
  const g = gunOf(e);
  if (g) loot.push({ type: g.type, x: e.x, z: e.z, y: e.y });
  if (by && by !== e) by.kills++;
  const who = (q) => (q.isPlayer ? tr('あなた') : q.name);
  addFeed(by && by !== e ? tr('{a} が {b} をたおした', { a: who(by), b: who(e) }) : tr('{b} がたおれた', { b: who(e) }));
  if (by && by.isPlayer) hitMark(true);
}
function bleed(x, y, z, col, n) {
  for (let k = 0; k < n; k++) {
    parts.push({ x: x + rand(-0.2, 0.2), y: y + rand(-0.2, 0.2), z: z + rand(-0.2, 0.2), vx: rand(-2.5, 2.5), vy: rand(0, 3.5), vz: rand(-2.5, 2.5),
                 col, s: rand(0.06, 0.12), life: 8 });
  }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
}
function addFeed(text) { feed.unshift({ text, t: 5 }); if (feed.length > 4) feed.pop(); renderFeed(); }
function renderFeed() { const el = byId('v3feed'); el.textContent = ''; for (const f of feed) { const d = document.createElement('div'); d.textContent = f.text; el.append(d); } }
function hitMark(kill) { hitMarkT = 0.2; byId('v3hit').classList.toggle('kill', !!kill); }
function message(text, color = '#ffffff', sec = 2.4) { const el = byId('v3msg'); el.textContent = tr(text); el.style.color = color; el.classList.remove('hidden'); msgT = sec; }

// 撃つ（武器が無ければパンチ）
function shoot(e) {
  if (!e.alive || e.cool > 0 || e.reloadT > 0) return false;
  const g = gunOf(e), eye = [e.x, e.y + EYE, e.z];
  if (!g) {
    e.cool = FIST.rate;
    e.punchT = 0.2;
    const h = raycast(eye, fwd(e.yaw, e.pitch), FIST.range, e);
    if (h.ent) { damage(h.ent, FIST.dmg * (h.ent.isPlayer && !e.isPlayer ? BOT.hurt : 1), e, h.head); if (e.isPlayer) hitMark(); }
    if (h.bact) hitBact(FIST.dmg);
    SND().play('hit', 0.4);
    return true;
  }
  const G = GUNS[g.type];
  if (g.ammo <= 0) { reload(e); return false; }
  g.ammo--;
  e.cool = G.rate;
  e.kick = 0.12;
  const err = e.isPlayer ? (aimZoom && G.zoom ? 0 : G.spread) : G.spread + e.aimErr;
  const muzzle = e.isPlayer ? camToWorld([0.2, -0.19, -0.4 - G.len * 0.45]) : [e.x + Math.sin(e.yaw) * 0.6, e.y + 1.25, e.z - Math.cos(e.yaw) * 0.6];
  for (let k = 0; k < G.pellets; k++) {
    const d = norm(fwd(e.yaw + rand(-err, err), e.pitch + rand(-err, err)));
    const h = raycast(eye, d, G.range, e);
    const end = [eye[0] + d[0] * h.t, eye[1] + d[1] * h.t, eye[2] + d[2] * h.t];
    tracers.push({ a: muzzle, b: end, life: 0.06 });
    if (h.ent) { damage(h.ent, G.dmg * (h.head ? 1.8 : 1) * (h.ent.isPlayer && !e.isPlayer ? BOT.hurt : 1), e, h.head); if (e.isPlayer) hitMark(); }
    else if (h.bact) hitBact(G.dmg);
    else if (h.t < G.range) for (let j = 0; j < 3; j++) parts.push({ x: end[0], y: end[1], z: end[2], vx: rand(-1, 1), vy: rand(0.5, 2), vz: rand(-1, 1), col: [0.85, 0.82, 0.7], s: 0.05, life: 0.5 });
  }
  flashes.push({ p: muzzle, life: 0.05 });
  const dist = Math.hypot(e.x - P.x, e.z - P.z);
  SND().play(G.sound, e.isPlayer ? 0.9 : clamp(1 - dist / 70, 0.05, 0.6), G.pitch);
  if (g.ammo <= 0) reload(e);
  return true;
}
function reload(e) {
  const g = gunOf(e);
  if (!g || e.reloadT > 0 || g.ammo >= GUNS[g.type].mag) return;
  e.reloadT = GUNS[g.type].reload;
  if (e.isPlayer) SND().play('click', 0.6);
}
function hitBact(n) {
  if (!bact.alive) return;
  hitMark();
  bact.hp -= n;
  bact.stun = 0.25;
  bleed(bact.x, 2.0, bact.z, [0.04, 0.04, 0.05], 5);
  SND().play('bactScreech', 0.6, rand(1.2, 1.4));
  if (bact.hp <= 0) { bact.alive = false; bact.timer = 15; message('バクテリアをたおした…でも、また来るかも', '#bbbbbb', 3); SND().play('death', 0.8, 0.6); }
}

// ---- はじめる・やめる ----
function freeSpot() {
  for (let k = 0; k < 300; k++) {
    const x = 4 + Math.random() * (W.N - 8), z = 4 + Math.random() * (W.N - 8), y = heightAt(x, z);
    if ((W.water == null || y > W.water + 0.2) && (W.lava == null || y > W.lava + 0.3) && !blockedAt(x, z, y)) return [x, z];
  }
  return [W.N / 2, W.N / 2];
}
function start(id, opts = {}) {
  mapId = id || window.GRAPE.art3d.current();
  brLevel = clamp(opts.level || 0, 0, BR_LEVELS.length - 1);
  intro = mapId === 'backrooms' && brLevel === 0 && opts.intro !== false ? { t: 0, step: 0 } : null;
  W = makeWorld(intro ? 'ground' : mapId);
  buildGrid();
  ents = []; loot = []; parts = []; tracers = []; flashes = []; feed = [];
  renderFeed();
  ended = false;
  if (W.mode === 'escape') {
    P = makeEnt('grape', W.start.x, W.start.z, true);
    P.yaw = Math.PI * 0.75;
    giveGun(P, 'pistol');
    bact = { x: 0, z: 0, yaw: 0, on: false, timer: W.bactCfg.delay, hp: 300, alive: true, stun: 0, walk: 0, field: null, repath: 0, sees: false, click: 0, beat: 0, growl: 2 };
    flash = true;
    W.exitSeen = false;
  } else {
    const [px, pz] = freeSpot();
    P = makeEnt('grape', px, pz, true);
    const kinds = window.GRAPE.art3d.kinds().filter((k) => k !== 'grape');
    for (let k = 0; k < 9; k++) { const [x, z] = freeSpot(); ents.push(makeEnt(kinds[k % kinds.length], x, z, false)); }
    const types = Object.keys(GUNS);
    for (let k = 0; k < 34; k++) { const [x, z] = freeSpot(); loot.push({ type: types[k % types.length], x, z, y: heightAt(x, z) }); }
    for (let k = 0; k < 12; k++) { const [x, z] = freeSpot(); loot.push({ type: 'heal', x, z, y: heightAt(x, z) }); }
    bact = null;
  }
  if (intro) {   // ノークリップの動画：はじめは、グラウンドの、ひらけた所を歩いている
    ents = []; loot = []; bact = null;
    W.boxes = W.boxes.filter((b) => Math.hypot((b.x0 + b.x1) / 2 - 50, (b.z0 + b.z1) / 2 - 50) > 14);
    buildGrid();
    P = makeEnt('grape', 50, 58, true);
    P.yaw = 0; P.pitch = -0.05;
  }
  ents.unshift(P);
  train = W.train ? Object.assign({}, W.train) : null;
  on = true;
  aimZoom = false;
  prevPaused = window.GRAPE.stats().paused;
  window.GRAPE.setPaused(true);
  byId('v3d').classList.remove('hidden');
  byId('v3end').classList.add('hidden');
  byId('v3msg').classList.add('hidden');
  byId('v3touch').classList.toggle('hidden', !matchMedia('(pointer: coarse)').matches);
  startTime = performance.now();
  simTime = 0;
  if (!gl) initGL();
  if (gl) buildStatic();
  byId('v3nogl').classList.toggle('hidden', !!gl);
  mapImg = null;
  resize();
  byId('v3d').classList.toggle('intro', !!intro);
  byId('v3fade').style.opacity = 0;
  if (intro) { cv.style.filter = ''; byId('v3hint').classList.add('hidden'); last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); return; }
  message(W.mode === 'escape' ? tr(BR_LEVELS[brLevel].name) + '：' + tr(BR_LEVELS[brLevel].desc) + ' — ' + tr('出口をさがせ！') : '銃をひろって、最後の1人になろう！', '#ffd24a', 3.5);
  byId('v3flash').classList.toggle('hidden', W.mode !== 'escape');
  const hint = byId('v3hint');
  hint.textContent = tr(matchMedia('(pointer: coarse)').matches ? '左をなぞって歩く、右をなぞって見回す。🔫で撃つ、⤴でジャンプ'
                                                                 : 'クリックすると、マウスで見回せる。WASDで歩く、クリックで撃つ、スペースでジャンプ、Rでこめなおし、1 2 3で武器をえらぶ。Escでマウスをもどす');
  hint.classList.remove('hidden');
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => hint.classList.add('hidden'), 7000);
  last = 0;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}
function stop() {
  if (!on) return;
  on = false;
  cancelAnimationFrame(raf);
  if (document.pointerLockElement) document.exitPointerLock();
  byId('v3d').classList.add('hidden');
  if (cv) cv.style.filter = '';
  intro = null;
  window.GRAPE.setPaused(prevPaused);
  keys.clear();
  mouseDown = false; touch.fire = false;
}
function finish(win) {
  if (ended) return;
  ended = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const alive = ents.filter((e) => e.alive).length, t = Math.round((performance.now() - startTime) / 1000);
  const last = W.mode === 'escape' && brLevel === BR_LEVELS.length - 1;
  byId('v3endTitle').textContent = W.mode === 'escape'
    ? (win ? (last ? tr('🎉 バックルームから だっしゅつ成功！') : tr('🎉 {lv}から だっしゅつ！', { lv: tr(BR_LEVELS[brLevel].name) })) : tr('😱 バクテリアに つかまった…'))
    : tr(win ? '🏆 さいごの1人！ あなたの勝ち！' : 'やられた…');
  byId('v3endText').textContent = W.mode === 'escape'
    ? (win ? (last ? tr('ぜんぶのレベルをクリアした！ タイム {m}分{s}びょう', { m: Math.floor(t / 60), s: t % 60 })
                   : tr('つぎは {lv}（{desc}）。タイム {m}分{s}びょう', { lv: tr(BR_LEVELS[brLevel + 1].name), desc: tr(BR_LEVELS[brLevel + 1].desc), m: Math.floor(t / 60), s: t % 60 }))
           : tr('もう一回、出口をさがそう'))
    : tr('{n}位　たおした数：{k}', { n: win ? 1 : alive + 1, k: P.kills });
  byId('v3next').classList.toggle('hidden', !(W.mode === 'escape' && win && !last));
  if (win && last && window.GrapeShop) window.GrapeShop.event('escapeAll');
  byId('v3end').classList.remove('hidden');
  SND().play(win ? 'quest' : 'groan', 1);
  if (win && window.GrapeShop) {
    window.GrapeShop.event(W.mode === 'escape' ? 'escape' : 'win3d');
    if (W.mode !== 'escape') window.GrapeShop.addCoins(30);
  }
}


// ---- ノークリップの動画 ----
// 0〜2.6びょう：グラウンドを歩く。2.6びょう：「メリッ」と床がきしんで、画面がバグったようにゆれる。
// 2.6〜3.8びょう：床にめりこむ。3.8〜5.4びょう：まっくらな中を落ちる。5.4びょう：バックルームの天井から落ちてきて、6.2びょうで着地
function updateIntro(dt) {
  const I = intro, t = (I.t += dt), fade = byId('v3fade');
  const once = (k, fn) => { if (I.step < k) { I.step = k; fn(); } };
  if (t < 2.6) {
    const f = fwd(P.yaw);
    moveBody(P, f[0] * 3 * dt, -1 * dt, f[2] * 3 * dt);
    P.walk += dt * 7;
  } else if (t < 3.8) {
    once(1, () => { SND().play('meri', 1); });
    const k = (t - 2.6) / 1.2;
    P.y = heightAt(P.x, P.z) - k * k * 2.6;
    P.yaw += (Math.random() - 0.5) * 0.08; P.pitch = -0.05 - k * 0.4 + (Math.random() - 0.5) * 0.08;
    cv.style.filter = Math.random() < 0.3 ? `hue-rotate(${Math.floor(Math.random() * 360)}deg) contrast(1.6)` : Math.random() < 0.15 ? 'invert(1)' : '';
    fade.style.opacity = clamp((k - 0.5) * 2, 0, 1);
    if (k > 0.2) subs('メリッ…', '#ffffff');
  } else if (t < 5.4) {
    once(2, () => { SND().play('fall', 1); subs('ノークリップ', '#ff66ff'); });
    cv.style.filter = '';
    fade.style.opacity = 1;
    byId('v3subs').style.transform = `translate(-50%, -50%) translate(${(Math.random() - 0.5) * 10}px, ${(Math.random() - 0.5) * 6}px)`;
  } else if (t < 6.2) {
    once(3, () => {   // バックルームへ
      W = makeWorld('backrooms');
      buildGrid();
      if (gl) buildStatic();
      mapImg = null;
      ents = [];
      P = makeEnt('grape', W.start.x, W.start.z, true);
      P.yaw = Math.PI * 0.75;
      giveGun(P, 'pistol');
      ents.push(P);
      bact = { x: 0, z: 0, yaw: 0, on: false, timer: W.bactCfg.delay, hp: 300, alive: true, stun: 0, walk: 0, field: null, repath: 0, sees: false, click: 0, beat: 0, growl: 2 };
      flash = true; W.exitSeen = false;
      byId('v3subs').classList.add('hidden');
    });
    const k = (t - 5.4) / 0.8;
    P.y = (W.ceiling - 0.4) * (1 - k * k);
    P.pitch = -0.6 + k * 0.6;
    fade.style.opacity = clamp(1 - k * 1.5, 0, 1);
  } else {
    once(4, () => { SND().play('thud', 1); });
    P.y = 0; P.pitch = 0;
    fade.style.opacity = 0;
    intro = null;
    byId('v3d').classList.remove('intro');
    startTime = performance.now(); simTime = 0;
    message(tr(BR_LEVELS[0].name) + '：' + tr(BR_LEVELS[0].desc) + ' — ' + tr('出口をさがせ！'), '#ffd24a', 3.5);
    byId('v3flash').classList.remove('hidden');
  }
}
function subs(text, color) { const el = byId('v3subs'); if (el.textContent !== tr(text)) el.textContent = tr(text); el.style.color = color; el.classList.remove('hidden'); }
function skipIntro() { if (!intro) return; if (intro.t < 5.4) { intro.t = 5.39; intro.step = Math.max(intro.step, 2); } }

// ---- 1コマ動かす ----
function update(dt) {
  if (intro) { updateIntro(dt); return; }
  if (ended) return;
  simTime += dt;
  const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
  const mx = clamp(k('d', 'ArrowRight') - k('a', 'ArrowLeft') + touch.mx, -1, 1), mz = clamp(k('w', 'ArrowUp') - k('s', 'ArrowDown') + touch.mz, -1, 1);
  if (P.alive) {
    const run = keys.has('Shift') || Math.hypot(touch.mx, touch.mz) > 0.95;
    const sp = (run ? 7 : 5.2) * (aimZoom ? 0.5 : 1) * (W.water != null && heightAt(P.x, P.z) < W.water ? 0.55 : 1);
    const f = fwd(P.yaw), r = [Math.cos(P.yaw), 0, Math.sin(P.yaw)];
    let vx = f[0] * mz + r[0] * mx, vz = f[2] * mz + r[2] * mx;
    const len = Math.hypot(vx, vz);
    if (len > 1) { vx /= len; vz /= len; }
    P.vy -= W.gravity * dt;
    if ((keys.has(' ') || touch.jump) && P.onGround) P.vy = W.gravity > 10 ? 8 : 5.5;
    touch.jump = false;
    moveBody(P, vx * sp * dt, P.vy * dt, vz * sp * dt);
    P.walk += len > 0.1 && P.onGround ? dt * 9 : 0;
    const fire = mouseDown || touch.fire, g = gunOf(P);
    if (fire && (!P.fireHeld || (g && GUNS[g.type].auto))) { if (shoot(P)) P.fireHeld = true; }
    if (!fire) P.fireHeld = false;
    pickup();
  }
  for (const e of ents) {
    if (e.cool > 0) e.cool -= dt;
    if (e.kick > 0) e.kick -= dt;
    if (e.punchT > 0) e.punchT -= dt;
    if (e.reloadT > 0 && (e.reloadT -= dt) <= 0) { const g = gunOf(e); if (g) g.ammo = GUNS[g.type].mag; }
    if (!e.alive) { e.fallT = Math.min(1, e.fallT + dt * 3); continue; }
    if (W.lava != null && e.y < W.lava + 0.2) damage(e, 25 * dt, null);   // 溶岩
    for (const b of boxesNear(e.x, e.z)) if (b.kind === 'spike' && Math.abs(e.y - b.y1) < 0.05 && e.x > b.x0 - R_BODY && e.x < b.x1 + R_BODY && e.z > b.z0 - R_BODY && e.z < b.z1 + R_BODY) damage(e, 30 * dt, null);
    if (!e.isPlayer) bot(e, dt);
  }
  if (train) {   // 駅の電車
    if (!train.run && (train.timer -= dt) <= 0) { train.run = true; train.dir = Math.random() < 0.5 ? 1 : -1; train.x = train.dir > 0 ? -30 : W.N + 30; message('⚠ 電車が くるよ！', '#ffd24a'); SND().play('engineStart', 1); }
    if (train.run) {
      train.x += train.dir * 22 * dt;
      for (const e of ents) if (e.alive && Math.abs(e.z - train.z) < 2 && e.y < 3 && Math.abs(e.x - (train.x - train.dir * 9)) < 14) damage(e, 200, null);
      if (train.x < -40 || train.x > W.N + 40) { train.run = false; train.timer = 14 + Math.random() * 12; }
    }
  }
  if (W.mode === 'escape') {
    updateBact(dt);
    if (Math.hypot(P.x - W.exit.x, P.z - W.exit.z) < 9) W.exitSeen = true;
    if (P.alive && Math.hypot(P.x - W.exit.x, P.z - W.exit.z) < 1.2) finish(true);
  }
  for (const p of parts) {
    if (p.rest) continue;
    p.vy -= 12 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const g = heightAt(p.x, p.z);
    if (p.y < g + 0.02) { p.y = g + 0.02; p.rest = true; }
    if ((p.life -= dt) <= 0) p.dead = true;
  }
  parts = parts.filter((p) => !p.dead || p.rest);
  for (const t of tracers) t.life -= dt;
  tracers = tracers.filter((t) => t.life > 0);
  for (const fl of flashes) fl.life -= dt;
  flashes = flashes.filter((fl) => fl.life > 0);
  for (const fd of feed) fd.t -= dt;
  if (feed.length && feed[feed.length - 1].t <= 0) { feed.pop(); renderFeed(); }
  if (hitMarkT > 0) hitMarkT -= dt;
  if (dmgT > 0) dmgT -= dt;
  if (msgT > 0 && (msgT -= dt) <= 0) byId('v3msg').classList.add('hidden');
  if (!P.alive) finish(false);
  else if (W.mode === 'battle' && ents.every((e) => e.isPlayer || !e.alive)) finish(true);
}
function pickup() {
  for (const l of loot) {
    if (l.taken || Math.hypot(l.x - P.x, l.z - P.z) > 1.4 || Math.abs(l.y - P.y) > 1.5) continue;
    if (l.type === 'heal') { if (P.hp >= 100) continue; P.hp = Math.min(100, P.hp + 50); l.taken = true; SND().play('heal', 0.9); message('回復した！', '#7dff7a', 1.2); continue; }
    const free = P.slots.findIndex((s) => !s);
    if (free < 0 && !keys.has('e') && !touch.swap) continue;
    if (free < 0) { const old = gunOf(P); if (old) loot.push({ type: old.type, x: P.x, z: P.z, y: P.y }); touch.swap = false; }
    l.taken = true;
    const g = { type: l.type, ammo: GUNS[l.type].mag };
    if (free >= 0) { P.slots[free] = g; if (!gunOf(P)) P.cur = free; } else P.slots[P.cur] = g;
    SND().play('pop', 0.7);
    message(tr('{name}をひろった', { name: tr(GUNS[l.type].name) }), '#ffffff', 1.2);
  }
  loot = loot.filter((l) => !l.taken);
}
const turnTo = (e, want, k) => { e.yaw += Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw)) * k; };
// コンピューターのキャラ：武器が無ければ、近くの銃をひろいに行く。見える敵がいれば撃つ。いなければ歩きまわる
function bot(e, dt) {
  if (e.frozen) return;   // テスト用に止めたキャラ
  if ((e.think -= dt) <= 0) {
    e.think = 0.3 + Math.random() * 0.2;
    let best = null, bd = 45;
    for (const o of ents) {
      if (o === e || !o.alive) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (o.isPlayer && simTime < BOT.grace) continue;   // はじめは、プレイヤーをねらわない（銃をひろう時間）
      if (d < bd && (o === e.target || d < BOT.sight) && canSee(e, o)) { bd = d; best = o; }
    }
    if (best && !gunOf(e) && bd > 6 && loot.some((l) => l.type !== 'heal')) best = null;   // 武器が無いうちは、まず銃をひろいに行く（すぐ近くの敵だけは、パンチ）
    if (best && best !== e.enemy) e.readyT = rand(BOT.react[0], BOT.react[1]);   // あたらしい敵を見つけたら、すこし間をおいてから撃つ
    e.enemy = best;
    if (!best && !gunOf(e)) {
      let lb = null, ld = 50;
      for (const l of loot) { if (l.type === 'heal') continue; const d = Math.hypot(l.x - e.x, l.z - e.z); if (d < ld) { ld = d; lb = l; } }
      if (lb) e.goal = { x: lb.x, z: lb.z };
    }
    if (!e.goal || Math.hypot(e.goal.x - e.x, e.goal.z - e.z) < 0.8) e.goal = { x: 6 + Math.random() * (W.N - 12), z: 6 + Math.random() * (W.N - 12) };
    if (Math.random() < 0.15) e.strafe = -e.strafe;
  }
  let mx = 0, mz = 0;
  const o = e.enemy;
  if (o && o.alive) {
    const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz), want = Math.atan2(dx, -dz);
    turnTo(e, want, Math.min(1, dt * BOT.turn));
    if (e.readyT > 0) e.readyT -= dt;
    e.pitch = Math.atan2(o.y + 1.2 - (e.y + EYE), d);
    const g = gunOf(e), keep = g ? (g.type === 'shotgun' ? 6 : g.type === 'sniper' ? 30 : 14) : 1.5;
    mz = d > keep + 2 ? 1 : d < keep - 3 ? -0.6 : 0;
    mx = e.strafe * 0.6;
    e.aimErr = Math.max(BOT.aimMin, e.aimErr - dt * BOT.aimGain);
    const facing = Math.abs(Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw))) < 0.25;
    if (facing && e.readyT <= 0 && (g || d < 2) && Math.random() < dt * (g && GUNS[g.type].auto ? BOT.shots[0] : BOT.shots[1])) shoot(e);
  } else if (e.goal) {
    turnTo(e, Math.atan2(e.goal.x - e.x, -(e.goal.z - e.z)), Math.min(1, dt * 4));
    e.pitch = 0;
    mz = 1;
    e.aimErr = BOT.aim0;
  }
  for (const l of loot) {   // ひろう
    if (l.taken || Math.hypot(l.x - e.x, l.z - e.z) > 1.4) continue;
    if (l.type === 'heal') { if (e.hp < 70) { e.hp = Math.min(100, e.hp + 50); l.taken = true; } continue; }
    const i = e.slots.findIndex((s) => !s);
    if (i >= 0) { l.taken = true; e.slots[i] = { type: l.type, ammo: GUNS[l.type].mag }; e.cur = i; }
  }
  loot = loot.filter((l) => !l.taken);
  const f = fwd(e.yaw), rr = [Math.cos(e.yaw), 0, Math.sin(e.yaw)], sp = 4;
  const ax = e.x + (f[0] * mz + rr[0] * mx) * 1.2, az = e.z + (f[2] * mz + rr[2] * mx) * 1.2, ah = heightAt(ax, az);
  if ((W.lava != null && ah < W.lava + 0.3) || (W.water != null && ah < W.water - 0.6)) { mx = 0; mz = 0; e.goal = null; e.think = Math.min(e.think, 0.1); }   // 溶岩や深い水には、入らない
  e.vy -= W.gravity * dt;
  e.blocked = false;
  moveBody(e, (f[0] * mz + rr[0] * mx) * sp * dt, e.vy * dt, (f[2] * mz + rr[2] * mx) * sp * dt);
  if (e.blocked && e.onGround) e.vy = 7.5;   // つかえたら、ジャンプ
  if (e.blocked && Math.random() < dt) e.goal = null;
  e.walk += (mz || mx) && e.onGround ? dt * 9 : 0;
}
const bactScale = () => Math.min(1, ((W.ceiling || 4) - 0.15) / 3.15);   // 天井に頭がつかえないように、小さくする
// バクテリア：まっ黒で、ひょろ長い。通れる所をたどって、プレイヤーを追いかける。見えると、走ってくる。撃つと、すこし止まる。
// 近くにいると、カチカチ音がして、明かりがチカチカする
function updateBact(dt) {
  const B = bact, cfg = W.bactCfg;
  if (!B.on) {
    if ((B.timer -= dt) > 0) return;
    const d = occBfs(W, P.x, P.z), cand = [];
    d.forEach((v, i) => { if (v > 50 && v < 110) cand.push(i); });
    if (!cand.length) { B.timer = 3; return; }
    const i = cand[Math.floor(Math.random() * cand.length)];
    Object.assign(B, { x: (i % W.occW + 0.5) * OCC, z: (Math.floor(i / W.occW) + 0.5) * OCC, on: true, hp: 300, alive: true, stun: 0, field: d, repath: 0.5 });
    message('…なにかが、いる', '#bbbbbb');
    SND().play('bactGrowl', 0.9, 0.9);
    return;
  }
  if (!B.alive) { if ((B.timer -= dt) <= 0) { B.on = false; B.timer = 0; } return; }
  const dist = Math.hypot(P.x - B.x, P.z - B.z);
  if ((B.click -= dt) <= 0 && dist < 26) { B.click = rand(0.6, 1.6); SND().play('bactChitter', clamp(1 - dist / 26, 0.05, 0.9), rand(0.8, 1.2)); }   // キチキチ
  if ((B.growl -= dt) <= 0) { B.growl = rand(4, 8); if (dist < 40) SND().play('bactGrowl', clamp(1 - dist / 40, 0.1, 0.8), rand(0.85, 1.1)); }   // うなり声
  if ((B.beat -= dt) <= 0 && dist < 12) { B.beat = 0.3 + dist * 0.06; SND().play('thud', clamp(1.2 - dist / 12, 0.2, 1)); }                     // 心ぞうの音
  if (B.stun > 0) { B.stun -= dt; return; }
  if ((B.repath -= dt) <= 0) {
    B.repath = 0.4;
    B.field = occBfs(W, P.x, P.z);
    const o = [B.x, 2.4, B.z], dir = [P.x - B.x, P.y + 1.4 - 2.4, P.z - B.z], len = Math.hypot(dir[0], dir[1], dir[2]);
    const saw = B.sees;
    B.sees = len < 16 && raycast(o, [dir[0] / len, dir[1] / len, dir[2] / len], len, B).t >= len - 0.4;
    if (B.sees && !saw && simTime - (B.screamT || -99) > 6) { B.screamT = simTime; SND().play('bactScreech', 1, rand(0.9, 1.1)); }   // 見つけたら、さけぶ
  }
  let tx = P.x, tz = P.z;
  if (!B.sees) {   // 見えないときは、通れる所の地図を、プレイヤーの方へ1ますずつ進む
    const G = W.occW, ix = clamp(Math.floor(B.x / OCC), 0, G - 1), iz = clamp(Math.floor(B.z / OCC), 0, G - 1), here = B.field[iz * G + ix];
    let best = null, bv = here < 0 ? 1e9 : here;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = ix + dx, nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
      const v = B.field[nz * G + nx];
      if (v >= 0 && v < bv && !W.occ[iz * G + nx] && !W.occ[nz * G + ix]) { bv = v; best = [nx, nz]; }
    }
    if (best) { tx = (best[0] + 0.5) * OCC; tz = (best[1] + 0.5) * OCC; }
  }
  const dx = tx - B.x, dz = tz - B.z, d = Math.hypot(dx, dz), sp = B.sees ? cfg.sprint : cfg.speed;
  if (d > 0.01) {
    const step = Math.min(d, sp * dt);
    B.x += dx / d * step; B.z += dz / d * step;
    const want = Math.atan2(dx, -dz);
    B.yaw += Math.atan2(Math.sin(want - B.yaw), Math.cos(want - B.yaw)) * Math.min(1, dt * 8);
    B.walk += dt * (B.sees ? 14 : 9);
  }
  if (P.alive && dist < 0.8) { P.hp = 0; P.alive = false; bleed(P.x, 1.4, P.z, P.pal.blood, 30); finish(false); }
}

// ---- WebGL で描く ----
const VS = `attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
uniform mat4 uVP; uniform mat4 uM; uniform mat4 uLVP; uniform vec3 uTint;
varying vec3 vNor; varying vec3 vCol; varying vec3 vW; varying vec4 vL;
void main() { vec4 w = uM * vec4(aPos, 1.0); vW = w.xyz; vNor = (uM * vec4(aNor, 0.0)).xyz; vCol = aCol * uTint; vL = uLVP * w; gl_Position = uVP * w; }`;
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uFog; uniform float uFogD; uniform vec3 uEye;
uniform sampler2D uShadow; uniform float uUseShadow; uniform float uEmit; uniform float uAlpha; uniform float uMapSize;
uniform float uDark; uniform float uAmb; uniform vec3 uPL[8]; uniform vec3 uPLC[8]; uniform float uFlash; uniform vec3 uFlashP; uniform vec3 uFlashD;
varying vec3 vNor; varying vec3 vCol; varying vec3 vW; varying vec4 vL;
float unpack(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
float shadow() {
  vec3 p = vL.xyz / vL.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0, t = 1.0 / uMapSize;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += (p.z - 0.003 > unpack(texture2D(uShadow, p.xy + vec2(float(i), float(j)) * t))) ? 0.0 : 1.0;
  return s / 9.0;
}
void main() {
  vec3 n = normalize(vNor);
  float diff = max(dot(n, uSun), 0.0);
  float sh = uUseShadow > 0.5 ? shadow() : 1.0;
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * 0.55;
  vec3 c = vCol * (amb + uSunCol * diff * sh * 0.85);
  if (uDark > 0.5) {   // 暗い所：天井の明かり（近い8こ）と、懐中電灯だけで照らす
    vec3 lit = vec3(uAmb);
    for (int i = 0; i < 8; i++) {
      vec3 L = uPL[i] - vW; float d = length(L); float a = max(0.0, 1.0 - d / 9.0); a *= a;
      lit += uPLC[i] * a * (0.3 + 0.7 * max(dot(n, L / max(d, 0.001)), 0.0));
    }
    if (uFlash > 0.5) {
      vec3 L = uFlashP - vW; float d = length(L); vec3 l = L / max(d, 0.001);
      float spot = smoothstep(0.8, 0.94, dot(-l, uFlashD));
      lit += vec3(1.0, 0.95, 0.82) * spot * max(0.0, 1.0 - d / 18.0) * (0.35 + 0.65 * max(dot(n, l), 0.0)) * 1.5;
    }
    c = vCol * lit;
  }
  c = mix(c, vCol, uEmit);
  float d = length(vW - uEye);
  c = mix(c, uFog, clamp(1.0 - exp(-d * d / (uFogD * uFogD)), 0.0, 1.0) * (1.0 - uEmit * 0.7));
  gl_FragColor = vec4(c, uAlpha);
}`;
const SVS = `attribute vec3 aPos; uniform mat4 uLVP; uniform mat4 uM; void main() { gl_Position = uLVP * uM * vec4(aPos, 1.0); }`;
const SFS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
vec4 pack(float d) { vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * d); return e - e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0); }
void main() { gl_FragColor = pack(gl_FragCoord.z); }`;
let prog, sprog, cube, sky, stat, transp, glow, shadowFb, shadowTex, SM = 1024, cv, mapImg = null;
function compile(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = { p };
  for (const n of ['aPos', 'aNor', 'aCol']) loc[n] = gl.getAttribLocation(p, n);
  for (const n of ['uVP', 'uM', 'uLVP', 'uTint', 'uSun', 'uSunCol', 'uSky', 'uGround', 'uFog', 'uFogD', 'uEye', 'uShadow', 'uUseShadow', 'uEmit', 'uAlpha', 'uMapSize',
                   'uDark', 'uAmb', 'uPL', 'uPLC', 'uFlash', 'uFlashP', 'uFlashD']) loc[n] = gl.getUniformLocation(p, n);
  return loc;
}
function initGL() {
  cv = byId('v3canvas');
  try { gl = cv.getContext('webgl', { antialias: true }) || cv.getContext('experimental-webgl'); } catch (e) { gl = null; }
  if (!gl) return;
  try { prog = compile(VS, FS); sprog = compile(SVS, SFS); } catch (e) { console.warn(e); gl = null; return; }
  cube = mesh(boxGeo([], -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, [1, 1, 1]));
  SM = matchMedia('(pointer: coarse)').matches ? 1024 : 2048;   // 影の絵の大きさ
  shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SM, SM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SM, SM);
  shadowFb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
// 形（三角形の点・向き・色のならび。1つの点に 9 つの数）
function boxGeo(g, x0, y0, z0, x1, y1, z1, col) {
  const faces = [
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ];
  for (const [n, q] of faces) for (const i of [0, 1, 2, 0, 2, 3]) g.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2], col[0], col[1], col[2]);
  return g;
}
function mesh(g) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g), gl.STATIC_DRAW);
  return { buf, n: g.length / 9 };
}
function buildStatic() {
  const g = [], N = W.N, w = N + 1;
  // 地面：ます目ごとに 2 まいの三角。色は高さと場所で決める
  const col = (x, z) => { const h = W.h[z * w + x]; return hexRgb(W.ground(x, z, h, vnoise(x / 3, z / 3, 21))).map((v) => v * (0.97 + 0.06 * vnoise(x / 2, z / 2, 5))); };
  const nor = (x, z) => { const hl = W.h[z * w + Math.max(0, x - 1)], hr = W.h[z * w + Math.min(N, x + 1)], hd = W.h[Math.max(0, z - 1) * w + x], hu = W.h[Math.min(N, z + 1) * w + x]; return norm([hl - hr, 2, hd - hu]); };
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const c = col(x, z);
    for (const [vx, vz] of [[x, z], [x, z + 1], [x + 1, z + 1], [x, z], [x + 1, z + 1], [x + 1, z]]) { const n = nor(vx, vz); g.push(vx, W.h[vz * w + vx], vz, n[0], n[1], n[2], c[0], c[1], c[2]); }
  }
  for (const b of W.boxes) boxGeo(g, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.col);
  if (stat) gl.deleteBuffer(stat.buf);
  stat = mesh(g);
  // 空：上ほど こい色の、大きな玉の内がわ
  const sg = [], top = hexRgb(W.sky[0]), hor = hexRgb(W.sky[1]), low = hexRgb(W.skyLow);
  const sv = (a, b) => { const th = a / 24 * Math.PI * 2, ph = (b / 12 - 0.5) * Math.PI; return [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)]; };
  for (let i = 0; i < 24; i++) for (let j = 0; j < 12; j++) {
    for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]]) {
      const p = sv(a, b), t = clamp(p[1] * 1.6, 0, 1), c = p[1] < 0 ? low : hor.map((h, k) => h + (top[k] - h) * t);
      sg.push(p[0], p[1], p[2], 0, 1, 0, c[0], c[1], c[2]);
    }
  }
  if (W.stars) for (let k = 0; k < 260; k++) { const th = Math.random() * 6.28, ph = Math.random() * 1.4, d = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)], s = 0.004; boxGeo(sg, d[0] - s, d[1] - s, d[2] - s, d[0] + s, d[1] + s, d[2] + s, [1, 1, 0.9]); }
  if (W.mode !== 'escape') { const s = W.sun, r = W.planet ? 0.12 : 0.05; boxGeo(sg, s[0] * 0.9 - r, s[1] * 0.9 - r, s[2] * 0.9 - r, s[0] * 0.9 + r, s[1] * 0.9 + r, s[2] * 0.9 + r, W.planet ? [0.4, 0.6, 1] : [1, 0.98, 0.8]); }
  if (sky) gl.deleteBuffer(sky.buf);
  sky = mesh(sg);
  const tg = [];
  if (W.water != null) boxGeo(tg, -60, W.water - 0.05, -60, N + 60, W.water, N + 60, hexRgb('#3a8fc8'));
  if (transp) gl.deleteBuffer(transp.buf);
  transp = tg.length ? mesh(tg) : null;
  const lg = [];
  if (W.lava != null) boxGeo(lg, -60, W.lava - 0.05, -60, N + 60, W.lava, N + 60, hexRgb('#ff7a1a'));
  for (const b of W.extra) boxGeo(lg, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.col);
  if (glow) gl.deleteBuffer(glow.buf);
  glow = lg.length ? mesh(lg) : null;
}
function bindMesh(L, m, withCol) {
  gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
  gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 36, 0);
  if (L.aNor >= 0) { gl.enableVertexAttribArray(L.aNor); gl.vertexAttribPointer(L.aNor, 3, gl.FLOAT, false, 36, 12); }
  if (L.aCol >= 0) { if (withCol) { gl.enableVertexAttribArray(L.aCol); gl.vertexAttribPointer(L.aCol, 3, gl.FLOAT, false, 36, 24); } else { gl.disableVertexAttribArray(L.aCol); gl.vertexAttrib3f(L.aCol, 1, 1, 1); } }
}
// うごく物（キャラ・銃・弾・血）を、箱のならびにする：[行列, 色, 光るか]
function dynamicBoxes(forShadow) {
  const out = [], add = (m, col, emit = 0) => out.push([m, col, emit]);
  for (const e of ents) {
    if (e.isPlayer) continue;
    const swing = Math.sin(e.walk) * 0.6, fall = e.alive ? 0 : -e.fallT * Math.PI / 2;
    const root = M(T(e.x, e.y, e.z), RY(-e.yaw), RX(fall));
    const part = (m, x0, y0, z0, x1, y1, z1, col) => add(M(root, m, T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), S(x1 - x0, y1 - y0, z1 - z0)), col);
    const legL = M(T(0, 0.8, 0), RX(e.alive ? swing : 0), T(0, -0.8, 0)), legR = M(T(0, 0.8, 0), RX(e.alive ? -swing : 0), T(0, -0.8, 0));
    part(legL, -0.2, 0, -0.09, -0.02, 0.8, 0.09, e.pal.skin);
    part(legR, 0.02, 0, -0.09, 0.2, 0.8, 0.09, e.pal.skin);
    part(I4(), -0.22, 0.78, -0.13, 0.22, 1.36, 0.13, e.pal.shirt);
    const aimArm = e.alive && (gunOf(e) || e.enemy) ? -Math.PI / 2 + (e.punchT > 0 ? 0.4 : 0) : -swing * 0.8;
    const arm = M(T(0, 1.32, 0), RX(aimArm), T(0, -1.32, 0));
    part(arm, -0.36, 0.78, -0.07, -0.22, 1.36, 0.07, e.pal.skin);
    part(arm, 0.22, 0.78, -0.07, 0.36, 1.36, 0.07, e.pal.skin);
    part(I4(), -0.25, 1.36, -0.25, 0.25, 1.86, 0.25, e.pal.skin);
    part(I4(), -0.26, 1.35, -0.26, 0.26, 1.38, 0.26, e.pal.dark);
    part(I4(), -0.04, 1.86, -0.04, 0.04, 2.0, 0.04, e.pal.stem);
    if (!forShadow) {
      const eyeC = e.alive ? [0.05, 0.05, 0.05] : [0.6, 0.05, 0.1];
      part(I4(), -0.15, 1.64, -0.26, -0.07, 1.72, -0.24, eyeC); part(I4(), 0.07, 1.64, -0.26, 0.15, 1.72, -0.24, eyeC);
      part(I4(), -0.1, 1.5, -0.26, 0.1, 1.54, -0.24, eyeC);
    }
    const g = gunOf(e);
    if (g && e.alive) { const L = GUNS[g.type].len; add(M(root, arm, T(0.29, 0.8, -0.0), RX(Math.PI / 2), T(0, 0, -L / 2 + 0.1), S(0.08, 0.12, L)), [0.22, 0.24, 0.27]); }
  }
  if (bact && bact.on) {   // バクテリア：背が高くて、ひょろ長い手足と、長いつめ。ピクピクふるえる
    const B = bact, tw = () => (Math.random() - 0.5) * (B.alive ? 0.12 : 0), k = [0.02, 0.02, 0.025], sw = Math.sin(B.walk), lean = B.alive ? (B.sees ? -0.35 : -0.12) : 0;
    const sc = bactScale(), root = M(T(B.x, 0, B.z), RY(-B.yaw), RX(B.alive ? lean : -Math.PI / 2), S(sc, sc, sc));
    const seg = (base, len, w) => M(base, T(0, -len / 2, 0), S(w, len, w));
    for (const side of [-1, 1]) {   // 足（ひざから下が、うしろに曲がる）
      const hip = M(root, T(side * 0.12, 1.5, 0), RX(sw * side * 0.6 + tw()));
      add(seg(hip, 0.78, 0.09), k);
      const knee = M(hip, T(0, -0.78, 0), RX(0.25 + Math.max(0, sw * side) * 0.7));
      add(seg(knee, 0.74, 0.07), k);
      add(M(knee, T(0, -0.74, -0.08), S(0.1, 0.04, 0.24)), k);
    }
    const chest = M(root, T(tw() * 0.3, 1.5, 0), RZ(tw()));
    add(M(chest, T(0, 0.45, 0), S(0.2, 0.9, 0.12)), k);
    for (let r = 0; r < 4; r++) add(M(chest, T(0, 0.55 + r * 0.1, 0), S(0.27, 0.025, 0.15)), [0.07, 0.07, 0.08]);
    for (const side of [-1, 1]) {   // うで（ひざより下までのびる）と、つめ
      const reach = B.sees ? -1.1 + Math.sin(B.walk * 1.3 + side) * 0.5 : -sw * side * 0.5;
      const sh = M(chest, T(side * 0.17, 0.85, 0), RX(reach + tw()), RZ(side * 0.12));
      add(seg(sh, 0.85, 0.06), k);
      const el = M(sh, T(0, -0.85, 0), RX(-0.35 + tw()));
      add(seg(el, 0.85, 0.05), k);
      for (const f of [-1, 0, 1]) add(seg(M(el, T(f * 0.04, -0.85, 0), RZ(f * 0.25), RX(-0.3)), 0.32, 0.022), [0.05, 0.05, 0.06]);
    }
    const neck = M(chest, T(0, 0.9, 0), RX(tw() * 2 - (B.sees ? 0.3 : 0)), RZ(tw() * 3));
    add(seg(M(neck, T(0, 0.25, 0)), 0.25, 0.05), k);
    const head = M(neck, T(0, 0.48, 0), RZ(Math.sin(performance.now() / 300) * 0.15 + tw() * 2));
    add(M(head, S(0.22, 0.44, 0.26)), k);
    if (!forShadow) {
      for (let j = 0; j < 6; j++) add(M(head, T(-0.08 + j * 0.032, -0.09 + (j % 2) * 0.02, -0.135), S(0.018, 0.05, 0.01)), [0.95, 0.95, 0.9], 0.6);   // ギザギザの歯
      add(M(head, T(-0.06, 0.08, -0.135), S(0.025, 0.012, 0.01)), [0.9, 0.9, 0.9], 0.8);
      add(M(head, T(0.06, 0.08, -0.135), S(0.025, 0.012, 0.01)), [0.9, 0.9, 0.9], 0.8);
    }
  }
  if (W.mode === 'escape' && !forShadow) {   // 出口：ドアのわくと、みどりに光る EXIT
    const ex = W.exit, door = M(T(ex.x, 0, ex.z));
    add(M(door, T(-0.65, 1.1, 0), S(0.12, 2.2, 0.12)), [0.15, 0.12, 0.1]); add(M(door, T(0.65, 1.1, 0), S(0.12, 2.2, 0.12)), [0.15, 0.12, 0.1]);
    add(M(door, T(0, 2.2, 0), S(1.42, 0.12, 0.12)), [0.15, 0.12, 0.1]);
    add(M(door, T(0, 1.05, 0), S(1.2, 2.1, 0.05)), [0.32, 0.24, 0.16]);
    add(M(door, T(0, 2.45, 0), S(0.7, 0.25, 0.08)), [0.15, 1, 0.35], 1);
    add(M(door, T(0.4, 1.05, -0.04), S(0.08, 0.08, 0.04)), [0.85, 0.7, 0.2], 0.5);
  }
  if (W.mode === 'escape' && !forShadow) for (const l of W.lights) if (l.flicker && l.on > 0.05) add(M(T(l.x, l.y + 0.03, l.z), S(1.2, 0.06, 0.7)), l.col.map((v) => v * l.on), 1);
  const time = performance.now() / 1000;
  for (const l of loot) {   // 落ちている銃は、くるくる回る
    const root = M(T(l.x, l.y + 0.7 + Math.sin(time * 2 + l.x) * 0.1, l.z), RY(time * 1.5 + l.z));
    if (l.type === 'heal') { add(M(root, S(0.12, 0.12, 0.5)), [0.35, 0.85, 0.4], 0.5); add(M(root, T(0, 0, -0.32), S(0.03, 0.03, 0.15)), [0.85, 0.87, 0.9]); continue; }
    const L = GUNS[l.type].len;
    add(M(root, S(0.1, 0.14, L)), [0.25, 0.27, 0.3]);
    add(M(root, T(0, -0.12, 0.08), S(0.08, 0.16, 0.1)), [0.45, 0.3, 0.18]);
    if (!forShadow) add(M(T(l.x, l.y + 0.03, l.z), S(0.55, 0.02, 0.55)), [1, 0.9, 0.5], 0.5);
  }
  if (train && train.run) for (let k = 0; k < 3; k++) add(M(T(train.x - train.dir * k * 9, 2, train.z), S(8.6, 3.6, 3.2)), k ? [0.84, 0.86, 0.88] : [0.24, 0.44, 0.82]);
  if (!forShadow) {
    for (const p of parts) add(M(T(p.x, p.y, p.z), S(p.s, p.rest ? 0.02 : p.s, p.s)), p.col);
    for (const t of tracers) {
      const d = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]], len = Math.hypot(d[0], d[1], d[2]) || 0.01;
      add(M(T((t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, (t.a[2] + t.b[2]) / 2), RY(-Math.atan2(d[0], -d[2])), RX(Math.asin(clamp(d[1] / len, -1, 1))), S(0.025, 0.025, len)), [1, 0.9, 0.5], 1);
    }
    for (const fl of flashes) add(M(T(fl.p[0], fl.p[1], fl.p[2]), S(0.18, 0.18, 0.18)), [1, 0.95, 0.6], 1);
  }
  return out;
}
// カメラから見た場所（右, 上, 前）を、世界の場所にする
function camToWorld(v) {
  const C = M(T(P.x, P.y + EYE, P.z), RY(-P.yaw), RX(P.pitch));
  return [C[0] * v[0] + C[4] * v[1] + C[8] * v[2] + C[12], C[1] * v[0] + C[5] * v[1] + C[9] * v[2] + C[13], C[2] * v[0] + C[6] * v[1] + C[10] * v[2] + C[14]];
}
function render() {
  if (!gl) return;
  const w = cv.width, h = cv.height, eye = [P.x, P.y + EYE, P.z], f = fwd(P.yaw, P.pitch), g = gunOf(P);
  const zoom = aimZoom && g && GUNS[g.type].zoom;
  const vp = mul(persp((zoom ? 22 : 72) * Math.PI / 180, w / h, 0.05, 400), lookAt(eye, [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]], [0, 1, 0]));
  const sun = W.sun, cx = Math.round(P.x / 4) * 4, cz = Math.round(P.z / 4) * 4;
  const lvp = mul(ortho(-45, 45, -45, 45, 1, 220), lookAt([cx + sun[0] * 100, sun[1] * 100, cz + sun[2] * 100], [cx, 0, cz], [0, 1, 0]));
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  // 1. 影（太陽から見た、近さの絵）
  if (W.shadows) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
    gl.viewport(0, 0, SM, SM);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(sprog.p);
    gl.uniformMatrix4fv(sprog.uLVP, false, lvp);
    gl.uniformMatrix4fv(sprog.uM, false, I4());
    bindMesh(sprog, stat, false);
    gl.drawArrays(gl.TRIANGLES, 0, stat.n);
    bindMesh(sprog, cube, false);
    for (const [m] of dynamicBoxes(true)) { gl.uniformMatrix4fv(sprog.uM, false, m); gl.drawArrays(gl.TRIANGLES, 0, cube.n); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // 2. 画面
  gl.viewport(0, 0, w, h);
  const fog = hexRgb(W.fog);
  gl.clearColor(fog[0], fog[1], fog[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog.p);
  gl.uniformMatrix4fv(prog.uVP, false, vp);
  gl.uniformMatrix4fv(prog.uLVP, false, lvp);
  gl.uniform3fv(prog.uSun, sun); gl.uniform3fv(prog.uSunCol, W.sunCol);
  gl.uniform3fv(prog.uSky, hexRgb(W.sky[1])); gl.uniform3fv(prog.uGround, hexRgb(W.skyLow));
  gl.uniform3fv(prog.uFog, fog); gl.uniform1f(prog.uFogD, W.fogD); gl.uniform3fv(prog.uEye, eye);
  gl.uniform1f(prog.uMapSize, SM);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex); gl.uniform1i(prog.uShadow, 0);
  gl.uniform1f(prog.uDark, W.dark ? 1 : 0);
  if (W.dark) {   // いちばん近い8こ の明かり。チカチカする明かりと、バクテリアが近い明かりは、ついたり消えたりする
    const t = performance.now() / 1000, pl = new Float32Array(24), pc = new Float32Array(24);
    const near = W.lights.slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, 8);
    near.forEach((l, i) => {
      const scared = bact && bact.on && bact.alive && Math.hypot(l.x - bact.x, l.z - bact.z) < 10;
      const on = (l.flicker || scared) ? (Math.sin(t * 23 + l.phase) * Math.sin(t * 7.3 + l.phase * 2) > (scared ? 0.1 : -0.3) ? 1 : 0.08) : 1;
      l.on = on;
      pl.set([l.x, l.y, l.z], i * 3); pc.set(l.col.map((v) => v * on * 1.15), i * 3);
    });
    gl.uniform3fv(prog.uPL, pl); gl.uniform3fv(prog.uPLC, pc); gl.uniform1f(prog.uAmb, W.amb);
    gl.uniform1f(prog.uFlash, flash ? 1 : 0); gl.uniform3fv(prog.uFlashP, [eye[0] + f[1] * 0, eye[1] - 0.15, eye[2]]); gl.uniform3fv(prog.uFlashD, f);
  }
  const set = (m, tint, emit, alpha, shadow) => {
    gl.uniformMatrix4fv(prog.uM, false, m); gl.uniform3fv(prog.uTint, tint); gl.uniform1f(prog.uEmit, emit); gl.uniform1f(prog.uAlpha, alpha); gl.uniform1f(prog.uUseShadow, shadow ? 1 : 0);
  };
  // 空（いつもカメラのまわり。もやは、かけない）
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  bindMesh(prog, sky, true);
  set(M(T(eye[0], eye[1], eye[2]), S(300, 300, 300)), [1, 1, 1], 1, 1, false);
  gl.uniform1f(prog.uFogD, 1e6);
  gl.drawArrays(gl.TRIANGLES, 0, sky.n);
  gl.uniform1f(prog.uFogD, W.fogD);
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);
  bindMesh(prog, stat, true);
  set(I4(), [1, 1, 1], 0, 1, W.shadows);
  gl.drawArrays(gl.TRIANGLES, 0, stat.n);
  if (glow) { bindMesh(prog, glow, true); set(I4(), [1, 1, 1], 1, 1, false); gl.drawArrays(gl.TRIANGLES, 0, glow.n); }
  bindMesh(prog, cube, false);
  for (const [m, col, emit] of dynamicBoxes(false)) { set(m, col, emit, 1, W.shadows && !emit); gl.drawArrays(gl.TRIANGLES, 0, cube.n); }
  if (transp) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    bindMesh(prog, transp, true); set(I4(), [1, 1, 1], 0.2, 0.72, W.shadows); gl.drawArrays(gl.TRIANGLES, 0, transp.n);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  // 3. 自分の手と銃（いつもいちばん前。暗い所でも、すこし見えるように）
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(prog.uDark, 0);
  bindMesh(prog, cube, false);
  const C = M(T(eye[0], eye[1], eye[2]), RY(-P.yaw), RX(P.pitch)), kick = P.kick > 0 ? P.kick * 0.6 : 0;
  const bob = Math.sin(P.walk) * 0.015, rl = P.reloadT > 0 ? 0.25 : 0, skin = P.pal.skin;
  const vmEmit = W.dark ? 0.25 : 0, vmTint = W.dark ? 0.55 : 1;
  const vm = (x, y, z, sx, sy, sz, col) => { set(M(C, T(x, y + bob - rl, z + kick), S(sx, sy, sz)), col.map((v) => v * vmTint), vmEmit, 1, false); gl.drawArrays(gl.TRIANGLES, 0, cube.n); };
  if (P.alive && !zoom) {
    if (g) {
      const L = GUNS[g.type].len;
      const l = L * 0.45;
      vm(0.2, -0.19, -0.4 - l / 2, 0.03, 0.04, l, [0.22, 0.24, 0.27]);
      vm(0.2, -0.225, -0.41, 0.025, 0.05, 0.035, [0.4, 0.27, 0.16]);
      if (g.type === 'sniper') vm(0.2, -0.16, -0.52, 0.02, 0.02, 0.13, [0.1, 0.1, 0.12]);
      vm(0.215, -0.25, -0.37, 0.05, 0.05, 0.1, skin);
    } else {
      const p = P.punchT > 0 ? -0.25 : 0;
      vm(0.2, -0.22, -0.36 + p, 0.07, 0.07, 0.18, skin);
      vm(-0.2, -0.24, -0.38, 0.07, 0.07, 0.18, skin);
    }
  }
}

// ---- 画面の数字 ----
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function hud() {
  const alive = ents.filter((e) => e.alive).length;
  byId('v3alive').textContent = W.mode === 'battle' ? '👥 ' + alive : tr(BR_LEVELS[brLevel].name) + '　⏱ ' + fmt((performance.now() - startTime) / 1000);
  byId('v3kills').textContent = W.mode === 'battle' ? '💀 ' + P.kills : '';
  byId('v3hpbar').style.width = clamp(P.hp, 0, 100) + '%';
  byId('v3hpbar').style.background = P.hp > 50 ? '#6ccf5f' : P.hp > 25 ? '#f0c030' : '#e23b3b';
  byId('v3hptext').textContent = Math.max(0, Math.ceil(P.hp));
  const slots = byId('v3slots');
  if (slots.childElementCount !== 3) {
    slots.textContent = '';
    for (let i = 0; i < 3; i++) { const b = document.createElement('button'); b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); P.cur = i; }); slots.append(b); }
  }
  [...slots.children].forEach((b, i) => { const s = P.slots[i], t = (i + 1) + ' ' + (s ? tr(GUNS[s.type].name) : tr('パンチ')); if (b.textContent !== t) b.textContent = t; b.classList.toggle('on', i === P.cur); });
  const g = gunOf(P);
  byId('v3ammo').textContent = g ? (P.reloadT > 0 ? tr('こめなおし中…') : g.ammo + ' / ' + GUNS[g.type].mag) : '';
  byId('v3hit').classList.toggle('hidden', !(hitMarkT > 0));
  byId('v3dmg').style.opacity = dmgT > 0 ? Math.min(0.6, dmgT * 1.6) : 0;
  byId('v3scope').classList.toggle('hidden', !(aimZoom && g && GUNS[g.type].zoom));
  byId('v3swap').classList.toggle('hidden', !(P.slots.every(Boolean) && loot.some((l) => l.type !== 'heal' && Math.hypot(l.x - P.x, l.z - P.z) < 1.4)));
  drawMap();
}
function drawMap() {
  const c = byId('v3map'), x = c.getContext('2d'), n = c.width, k = n / W.N;
  if (!mapImg) {
    mapImg = document.createElement('canvas'); mapImg.width = mapImg.height = n;
    const m = mapImg.getContext('2d');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const gx = Math.floor(i / k), gz = Math.floor(j / k), hh = W.h[gz * (W.N + 1) + gx];
      m.fillStyle = W.dark ? '#141414' : W.water != null && hh < W.water ? '#3a8fc8' : W.lava != null && hh < W.lava ? '#ff7a1a' : W.ground(gx, gz, hh, 0.3);
      m.fillRect(i, j, 1, 1);
    }
    m.fillStyle = W.dark ? 'rgba(160, 150, 110, 0.9)' : 'rgba(30, 30, 40, 0.75)';
    for (const b of W.boxes) if (b.y1 - b.y0 > 0.5 && b.x1 - b.x0 < W.N / 2 + 1 && b.z1 - b.z0 < W.N / 2 + 1) m.fillRect(b.x0 * k, b.z0 * k, Math.max(1, (b.x1 - b.x0) * k), Math.max(1, (b.z1 - b.z0) * k));
  }
  x.drawImage(mapImg, 0, 0);
  if (W.mode === 'escape' && W.exitSeen) { x.fillStyle = '#2faa4a'; x.fillRect(W.exit.x * k - 3, W.exit.z * k - 3, 6, 6); }
  x.save(); x.translate(P.x * k, P.z * k); x.rotate(P.yaw);
  x.fillStyle = '#ffd24a'; x.strokeStyle = '#000'; x.beginPath(); x.moveTo(0, -6); x.lineTo(4, 4); x.lineTo(-4, 4); x.closePath(); x.fill(); x.stroke(); x.restore();
}
function resize() {
  if (!cv) cv = byId('v3canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
}
function frame(t) {
  if (!on) return;
  raf = requestAnimationFrame(frame);
  const raw = last ? (t - last) / 1000 : 0.016, dt = Math.min(0.05, raw);
  last = t;
  if (intro) updateIntro(Math.min(0.25, raw));   // 動画は、本当の時間どおりに進める
  else update(dt);
  render();
  hud();
}

// ---- そうさ ----
function setup() {
  cv = byId('v3canvas');
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  addEventListener('resize', () => { if (on) resize(); });
  addEventListener('keydown', (e) => {
    if (!on) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' && !document.pointerLockElement) { stop(); return; }
    if (k === 'r') reload(P);
    if (k === 'f') { flash = !flash; SND().play('click', 0.5); }
    if (k >= '1' && k <= '3') P.cur = Number(k) - 1;
    keys.add(k);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
  addEventListener('blur', () => { keys.clear(); mouseDown = false; });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cv; });
  cv.addEventListener('mousedown', (e) => {
    if (!on || ended || coarse()) return;
    if (!locked && cv.requestPointerLock) { try { cv.requestPointerLock(); } catch (err) { /* できないブラウザ */ } }
    if (e.button === 2) aimZoom = true; else mouseDown = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 2) aimZoom = false; else mouseDown = false; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => { if (on && locked && P) { const s = aimZoom ? 0.0008 : 0.0022; P.yaw += e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.4, 1.4); } });
  cv.addEventListener('wheel', (e) => { if (!on) return; P.cur = (P.cur + (e.deltaY > 0 ? 1 : 2)) % 3; e.preventDefault(); }, { passive: false });
  // タッチ：左がわはスティック（歩く）、右がわは、なぞって見回す
  cv.addEventListener('pointerdown', (e) => {
    if (!on || e.pointerType === 'mouse') return;
    if (e.clientX < innerWidth * 0.4 && !touch.stick) {
      touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const s = byId('v3stick');
      s.style.left = (e.clientX - 50) + 'px'; s.style.top = (e.clientY - 50) + 'px';
      s.classList.remove('hidden');
    } else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  cv.addEventListener('pointermove', (e) => {
    if (touch.stick && e.pointerId === touch.stick.id) {
      const dx = clamp((e.clientX - touch.stick.x) / 50, -1, 1), dy = clamp((e.clientY - touch.stick.y) / 50, -1, 1);
      touch.mx = dx; touch.mz = -dy;
      byId('v3knob').style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    } else if (touch.look && e.pointerId === touch.look.id) {
      const s = aimZoom ? 0.002 : 0.006;
      P.yaw += (e.clientX - touch.look.x) * s; P.pitch = clamp(P.pitch - (e.clientY - touch.look.y) * s, -1.4, 1.4);
      touch.look.x = e.clientX; touch.look.y = e.clientY;
    }
  });
  const up = (e) => {
    if (touch.stick && e.pointerId === touch.stick.id) { touch.stick = null; touch.mx = touch.mz = 0; byId('v3stick').classList.add('hidden'); byId('v3knob').style.transform = ''; }
    if (touch.look && e.pointerId === touch.look.id) touch.look = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  const btn = (id, down, upFn) => {
    const b = byId(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); down(); });
    if (upFn) for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, upFn);
  };
  btn('v3fire', () => { touch.fire = true; }, () => { touch.fire = false; });
  btn('v3jump', () => { touch.jump = true; });
  btn('v3reload', () => reload(P));
  btn('v3aim', () => { aimZoom = !aimZoom; });
  btn('v3swap', () => { touch.swap = true; });
  byId('v3exit').addEventListener('click', stop);
  byId('v3back').addEventListener('click', stop);
  byId('v3again').addEventListener('click', () => start(mapId, { level: brLevel, intro: false }));
  byId('v3next').addEventListener('click', () => start(mapId, { level: brLevel + 1 }));
  byId('v3skip').addEventListener('click', skipIntro);
  btn('v3flash', () => { flash = !flash; SND().play('click', 0.5); });
}
setup();
window.Grape3D = {
  start, stop,
  state: () => (on ? { on, map: mapId, mode: W.mode, gl: !!gl, x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(2), hp: P.hp,
                       alive: ents.filter((e) => e.alive).length, ended, kills: P.kills, loot: loot.length, gun: gunOf(P) ? gunOf(P).type : null,
                       bact: bact ? bact.on : null, level: W.mode === 'escape' ? brLevel : null, flash, intro: !!intro, world: W.id } : { on }),
  // テスト用
  teleport: (x, z, yaw, pitch) => { P.x = x; P.z = z; P.y = heightAt(x, z); P.vy = 0; if (yaw != null) P.yaw = yaw; if (pitch != null) P.pitch = pitch; },
  tick: (sec) => { for (let k = 0; k < sec * 60; k++) update(1 / 60); },
  giveGun: (type) => giveGun(P, type).type,
  fire: () => { P.cool = 0; P.reloadT = 0; return shoot(P); },
  bots: () => ents.filter((e) => !e.isPlayer).map((e) => ({ x: e.x, y: e.y, z: e.z, hp: e.hp, alive: e.alive, gun: gunOf(e) ? gunOf(e).type : null })),
  placeBot: (i, x, z) => { const e = ents.filter((q) => !q.isPlayer)[i]; e.x = x; e.z = z; e.y = heightAt(x, z); },
  freezeBots: () => { for (const e of ents) if (!e.isPlayer) { e.frozen = true; } },
  killBots: () => { for (const e of ents) if (!e.isPlayer && e.alive) damage(e, 999, null); },
  hurt: (n) => damage(P, n, null),
  exit: () => (W.exit ? { x: W.exit.x, z: W.exit.z } : null),
  bactPos: () => (bact && bact.on ? { x: bact.x, z: bact.z } : null),
  levels: () => BR_LEVELS.length,
  skip: skipIntro,
  next: () => byId('v3next').click(),
  endText: () => byId('v3endTitle').textContent,
  height: (x, z) => heightAt(x, z),
  clearBoxes: () => { W.boxes = []; buildGrid(); if (gl) buildStatic(); },
};
})();
