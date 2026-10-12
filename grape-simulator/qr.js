// QR コードを作る（モッドのコードを、スマホのカメラで読めるようにする）。index.html で、mods.js より先に読みこむ。
// window.GrapeQR.make(text) が、ます目（true が黒）の2次元の配列を返す。window.GrapeQR.canvas(text, size) は絵にする。
// 文字は UTF-8 のバイトで入れる（バイトモード）。誤り訂正はレベル M（15% くらい、よごれても読める）。
// 作り方は QR コードの決まり（ISO/IEC 18004）どおり：データを入れて、誤り訂正の数（リード・ソロモン）を足して、
// 8 つのもようの中から、いちばん読みやすいもの（ペナルティがいちばん少ないもの）をえらぶ。
(() => {
'use strict';
// バージョン（大きさ）ごとの、誤り訂正の数（1ブロックあたり）と、ブロックの数。レベル M のぶんだけ
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28,
                       28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
                    33, 35, 37, 38, 40, 43, 45, 47, 49];
const ECL_BITS = 0;   // レベル M の印（フォーマット情報で使う 2 ビット）

// データを入れられるマスの数（ビット）
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

// リード・ソロモン（GF(256)、多項式 0x11D）
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function make(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  let ver = 1;
  for (; ver <= 40; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new Error('too long');
  // データのビット列：モード（バイト）、文字数、データ、終わりの印、うめくさ
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // ブロックに分けて、それぞれに誤り訂正をつけて、まぜる
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);   // 短いブロックは、あとで飛ばす場所をあけておく
    blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) all.push(b[i]); });
  }

  // もようを置く
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { mod[y][x] = v; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // タイミングパターン
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver >= 2) {   // 位置合わせのもよう
    const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((y, i) => pos.forEach((x, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const drawFormat = (mask) => {
    const d = (ECL_BITS << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);   // 場所をとっておく（あとで本当の値を入れる）
  if (ver >= 7) {   // バージョン情報
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const v = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
      set(a, c, v); set(c, a, v);
    }
  }
  // データを、右下から、2列ずつジグザグに入れる
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < all.length * 8) { mod[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
  }
  // 8つのもようをためして、いちばんよいものにする
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
                 (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
                 (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m);
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}
// 読みにくさ（同じ色がたくさんならぶ、2×2のかたまり、見つけるもようににた形、白と黒のかたより）
function penalty(mod, size) {
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      const seq = [];
      for (let b = 0; b < size; b++) seq.push(get(a, b));
      for (let b = 1; b <= size; b++) {
        if (b < size && seq[b] === seq[b - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      const s = seq.map((v) => (v ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) for (let k = s.indexOf(pat); k >= 0; k = s.indexOf(pat, k + 1)) score += 40;
    }
  };
  lines((a, b) => mod[a][b]);
  lines((a, b) => mod[b][a]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (mod[y][x]) dark++;
    if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) score += 3;
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}
// 絵にする（まわりに 4 マスの白いふちをつける）
function canvas(text, px) {
  const mod = make(text), n = mod.length + 8, k = Math.max(1, Math.floor(px / n));
  const c = document.createElement('canvas');
  c.width = c.height = n * k;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#000000';
  mod.forEach((row, y) => row.forEach((v, i) => { if (v) x.fillRect((i + 4) * k, (y + 4) * k, k, k); }));
  return c;
}
window.GrapeQR = { make, canvas };
})();
