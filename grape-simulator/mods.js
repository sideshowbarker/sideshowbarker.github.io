// グレープシミュレーターのモッド（自分で作るキャラや物）と、モッドエディター。index.html で、shop.js の次、game.js より先に読みこむ。
// 作ったモッドは、このブラウザに保存される。コード（GRAPEMOD1: で始まる文字）やファイルにして、友だちにわたせる。
// 値段をつけて「売りに出す」こともできる（しくみは shop.js の上に書いてある）。
// よそから来たモッドは、形と数字をきびしく確かめてから使う（おかしなデータは読みこまない）。
(() => {
'use strict';
const tr = window.GrapeLang.t;
const SHOP = window.GrapeShop;
const STORE_KEY = 'grape-simulator-mods';
const CODE_PREFIX = 'GRAPEMOD1:';
const IDX = '0123456789abcdefghijklmn';   // 色の番号（24色まで）を1文字で書く。「.」は透明
const MAX_COLORS = 24, MAX_MODS = 60, MAX_CODE = 20000;
const HEAD_W = 9, HEAD_H = 11;            // キャラの頭の絵（上の2行は、へたやかみの毛。その下の 9×9 が顔）
const PRESETS = ['#111111', '#ffffff', '#9aa6b1', '#5a5a5a', '#d23a2a', '#e8762a', '#f5d33a', '#5cb85c', '#2f7a2f',
                 '#3c7dd9', '#24508f', '#8a4bbf', '#ff7ab8', '#9c6b3f', '#6b4a2b', '#f0c8a0'];
// えらぶ物のリスト：[データに書く値, 画面に出す言葉]（言葉は tr() で英語にもなる）
const FACES = [['fruit', 'フルーツ'], ['robot', 'ロボ'], ['zombie', 'ゾンビ'], ['none', '顔なし']];
const FACE_DOTS = { fruit: [[3, 6], [5, 6], [5, 7]], robot: [[3, 6], [3, 7], [6, 5], [6, 6], [6, 7]],
                    zombie: [[3, 6], [3, 7], [6, 5], [6, 6], [6, 7]], none: [] };   // 顔が出る所（エディターにうすく出す）
const KINDS = [['plain', 'ふつう'], ['blade', '刃'], ['gun', '銃'], ['bomb', '爆弾'], ['ball', 'ボール'], ['heal', '回復の針']];
const WEIGHTS = [[0, 'かるい'], [1, 'ふつう'], [2, 'おもい']];
const TOUGH = [[0.5, 'もろい'], [1, 'ふつう'], [2, '丈夫'], [3, 'すごく丈夫']];
const OFF_ON = [[0, 'なし'], [1, 'あり']];
const labels = (list) => list.map(([v, text]) => [v, tr(text)]);
const toast = (text) => SHOP.toast(text);

// ---- データを確かめる ----
const HEX = /^#[0-9a-f]{6}$/;
const color = (v, def) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : def);
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const round = (v, k) => Math.round(v * k) / k;
const cleanName = (v) => SHOP.cleanName(v) || tr('ななしのモッド');
const isOneOf = (list, v) => list.some(([k]) => k === v);
const PLAYER_ID = /^[a-z0-9]{8}$/, MOD_ID = /^mod_[a-z0-9]{8}$/;
function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(tr('モッドのデータではありません'));
  const type = raw.type === 'char' || raw.type === 'thing' ? raw.type : null;
  if (!type) throw new Error(tr('キャラか物か、わかりません'));
  if (!Array.isArray(raw.colors) || raw.colors.length > MAX_COLORS) throw new Error(tr('色のデータがおかしいです'));
  if (!raw.colors.length) throw new Error(tr('絵が何もかいてありません'));
  const colors = raw.colors.map((c) => {
    const v = color(c, null);
    if (!v) throw new Error(tr('色のデータがおかしいです'));
    return v;
  });
  const w = type === 'char' ? HEAD_W : Math.round(num(raw.w, 4, 32, 12));
  const h = type === 'char' ? HEAD_H : Math.round(num(raw.h, 2, 16, 5));
  if (!Array.isArray(raw.px) || raw.px.length !== h) throw new Error(tr('絵のデータがおかしいです'));
  let painted = 0;
  const px = raw.px.map((r) => {
    if (typeof r !== 'string' || r.length !== w || !/^[.0-9a-n]*$/.test(r)) throw new Error(tr('絵のデータがおかしいです'));
    return [...r].map((ch) => {
      if (ch === '.' || IDX.indexOf(ch) >= colors.length) return '.';
      painted++;
      return ch;
    }).join('');
  });
  if (!painted) throw new Error(tr('絵が何もかいてありません'));
  const m = { v: 1, type, name: cleanName(raw.name), colors, px };
  if (type === 'char') {
    m.face = isOneOf(FACES, raw.face) ? raw.face : 'fruit';
    m.skin = color(raw.skin, '#8a4bbf');
    m.shirt = color(raw.shirt, '#5cb85c');
    m.outline = color(raw.outline, '#2e1442');
    m.blood = color(raw.blood, '#d0182e');
    m.tough = isOneOf(TOUGH, Number(raw.tough)) ? Number(raw.tough) : 1;
    m.weight = Math.round(num(raw.weight, 0, 2, 1));
    m.sparks = raw.sparks === true;
  } else {
    m.w = w; m.h = h;
    m.kind = isOneOf(KINDS, raw.kind) ? raw.kind : 'plain';
    m.weight = Math.round(num(raw.weight, 0, 2, 1));
    m.bounce = round(num(raw.bounce, 0, 0.9, 0.1), 100);
    m.bladeFrom = Math.round(num(raw.bladeFrom, 0, w - 1, Math.floor(w / 2)));
    m.gunPower = Math.round(num(raw.gunPower, 5, 60, 25));
    m.gunAuto = raw.gunAuto === true;
    m.fuse = round(num(raw.fuse, 1, 8, 3), 10);
    m.power = round(num(raw.power, 0.3, 2, 1), 10);
  }
  // 作った人（プレイヤー番号と名前）と、売っているときの値段。値段は、作った人がわかる物にだけつく
  m.author = typeof raw.author === 'string' && PLAYER_ID.test(raw.author) ? raw.author : '';
  m.by = SHOP.cleanName(raw.by);
  const sale = raw.sale;
  if (m.author && sale && typeof sale === 'object' && SHOP.salePrices.includes(sale.price) &&
      typeof sale.id === 'string' && MOD_ID.test(sale.id)) m.sale = { price: sale.price, id: sale.id };
  return m;
}

// ---- 保存 ----
const newId = () => {
  let id;
  do id = 'mod_' + Math.random().toString(36).slice(2, 10).padEnd(8, '0'); while (mods.some((m) => m.id === id));
  return id;
};
let mods = [];
function loadMods() {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { /* 保存できないブラウザや、こわれたデータ */ }
  if (!Array.isArray(arr)) return;
  let old = false;
  for (const raw of arr.slice(0, MAX_MODS)) {
    try {
      const m = validate(raw);
      if (raw.author === undefined) { m.author = SHOP.me().id; old = true; }   // 作った人を書くようになる前（0.7）のモッドは、このブラウザの人の物
      m.id = typeof raw.id === 'string' && MOD_ID.test(raw.id) && !mods.some((x) => x.id === raw.id) ? raw.id : newId();
      mods.push(m);
    } catch (e) { /* こわれたモッドは、とばす */ }
  }
  if (old) saveMods();
}
loadMods();
function saveMods() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(mods)); } catch (e) { toast(tr('保存できませんでした')); }
}
const listeners = [];
function changed() { for (const fn of listeners) fn(); }
const isMine = (m) => SHOP.isMine(m);
// よそから来たモッドを足す。売り物をもう一度読みこんだときは、前の物を新しくする（買ったかどうかは、そのまま）
function addMod(m) {
  const same = m.sale ? mods.find((x) => x.sale && x.author === m.author && x.sale.id === m.sale.id) : null;
  if (same) {
    m.id = same.id;
    mods[mods.indexOf(same)] = m;
  } else {
    if (mods.length >= MAX_MODS) throw new Error(tr('モッドは60こまでだよ'));
    m.id = newId();
    mods.push(m);
  }
  saveMods();
  changed();
  if (built) renderCards();
  if (SHOP.locked(m.id)) toast(tr('「{name}」がショップにならんだ！ 🪙{price}で買えるよ', { name: m.name, price: m.sale.price }));
  else toast(tr(same ? '「{name}」を新しくした！' : '「{name}」を読みこんだ！', { name: m.name }));
  return m.id;
}
function removeMod(id) {
  mods = mods.filter((m) => m.id !== id);
  saveMods();
  changed();
  if (built) renderCards();
}

// ---- コード（友だちにわたす文字）とファイル ----
// わたすデータ：自分のモッドには、いまの自分の名前を書く
function exportData(m) {
  const data = Object.assign({}, m);
  delete data.id;
  if (isMine(m)) data.by = SHOP.me().name;
  return data;
}
function encode(m) {
  let bin = '';
  for (const b of new TextEncoder().encode(JSON.stringify(exportData(m)))) bin += String.fromCharCode(b);
  return CODE_PREFIX + btoa(bin);
}
function decode(text) {
  const s = String(text || '').replace(/\s+/g, '');
  if (s.length > MAX_CODE) throw new Error(tr('コードが長すぎます'));
  if (!s.startsWith(CODE_PREFIX)) throw new Error(tr('モッドのコード（GRAPEMOD1:）か、お礼コード（GRAPEPAY1:）をはってね'));
  let raw;
  try {
    const bin = atob(s.slice(CODE_PREFIX.length));
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch (e) { throw new Error(tr('コードが読めません（とちゅうで切れているかも）')); }
  return validate(raw);
}
function fromText(text) {
  const t = String(text).trim();
  if (t.startsWith(CODE_PREFIX)) return decode(t);
  let raw;
  try { raw = JSON.parse(t); } catch (e) { throw new Error(tr('モッドのファイルではありません')); }
  return validate(raw);
}
// コードを読みこむ：モッドのコードなら足す。お礼コードなら、コインをもらう
function readCode(text) {
  if (String(text || '').trim().startsWith(SHOP.payPrefix)) return SHOP.redeem(text);
  return addMod(decode(text));
}
function download(m) {
  const blob = new Blob([JSON.stringify(exportData(m), null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: m.name.replace(/[\\/:*?"<>|]/g, '_') + '.grapemod.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- 画面の部品 ----
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}
function button(text, fn, cls = 'small') {
  const b = el('button', { className: cls, textContent: text });
  b.addEventListener('click', fn);
  return b;
}
// 2回おすと動くボタン（まちがえて消したり、やめたりしないように）
function sureButton(text, sureText, fn) {
  const b = button(text, () => {
    if (!b.classList.contains('sure')) {
      b.classList.add('sure');
      b.textContent = sureText;
      setTimeout(() => { b.classList.remove('sure'); b.textContent = text; }, 2500);
      return;
    }
    fn();
  });
  return b;
}
function previewCanvas(m, maxW, maxH) {
  const c = el('canvas', { className: 'pix' });
  let src = null;
  try { src = window.GRAPE && window.GRAPE.modPreview(m); } catch (e) { /* 絵が作れないときは、からっぽ */ }
  if (!src) return c;
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const k = Math.max(1, Math.floor(Math.min(maxW / src.width, maxH / src.height)));
  c.style.width = src.width * k + 'px';
  c.style.height = src.height * k + 'px';
  return c;
}
const kindText = (m) => (m.type === 'char' ? tr('キャラクター') : tr('物・{kind}', { kind: tr(KINDS.find(([k]) => k === m.kind)[1]) }));
const byText = (m) => tr('つくった人：{by}', { by: m.by || tr('だれか') });

// ---- モッドの一覧 ----
let built = false, root, listPanel, editPanel, fileInput, cardsEl;
const backBtn = () => document.getElementById('btnModsBack');
function build() {
  if (built) return;
  built = true;
  root = document.getElementById('modsRoot');
  cardsEl = el('div', { id: 'modCards' });
  fileInput = el('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', className: 'hidden' });
  fileInput.addEventListener('change', onFile);
  listPanel = el('div', { id: 'modListPanel', className: 'panel' },
    el('h2', { textContent: tr('🛠 モッドエディター') }),
    note(tr('自分でキャラや物を作れるよ。作ったモッドは、アイテムのひきだしの「モッド」に出てくる。コードをコピーして友だちにわたしたり、値段をつけて売ったりもできる。')),
    el('div', { className: 'row' },
      button(tr('＋ キャラを作る'), () => edit(newChar(), true)),
      button(tr('＋ 物を作る'), () => edit(newThing(), true)),
      button(tr('📋 コードを読みこむ'), () => importCode()),
      button(tr('📁 ファイルを読みこむ'), () => fileInput.click())),
    cardsEl, fileInput);
  editPanel = el('div', { id: 'modEditPanel', className: 'panel hidden' });
  root.append(listPanel, editPanel);
}
function renderCards() {
  cardsEl.textContent = '';
  if (!mods.length) {
    cardsEl.append(note(tr('まだモッドがないよ。上のボタンで作ってみよう！')));
    return;
  }
  for (const m of mods) {
    const mine = isMine(m), locked = SHOP.locked(m.id);
    const card = el('div', { className: 'modCard' + (locked ? ' locked' : '') },
      previewCanvas(m, 96, 80), el('b', { textContent: m.name }), el('small', { textContent: kindText(m) }));
    card.dataset.mod = m.id;
    if (!mine) card.append(el('small', { textContent: byText(m) }));
    if (m.sale) {
      card.append(el('small', { className: 'sale', textContent:
        mine ? tr('🪙{price}で売り中・{n}こ売れた', { price: m.sale.price, n: SHOP.sold(m) })
             : locked ? tr('🔒 🪙{price}（ショップで買える）', { price: m.sale.price }) : tr('✓ 買った') }));
    }
    const acts = el('div', { className: 'acts' });
    if (locked) acts.append(button(tr('🛒 ショップへ'), () => window.GRAPE.show('shop', { from: 'mods', focus: m.id })));
    else {
      if (mine || !m.sale) acts.append(button(tr('✏ なおす'), () => edit(JSON.parse(JSON.stringify(m)), false)));
      acts.append(button(tr('▶ ためす'), () => window.GRAPE.tryMod(m.id)));
    }
    acts.append(button(tr('📋 コード'), () => showCode(m)));
    if (!locked) acts.append(button(tr('💾 ファイル'), () => download(m)));
    if (mine) acts.append(button(tr('💰 売る'), () => sellDialog(m)));
    acts.append(sureButton(tr('🗑 けす'), tr('ほんとうに消す？'), () => removeMod(m.id)));
    card.append(acts);
    cardsEl.append(card);
  }
}
function open() {
  build();
  ed = null;
  editPanel.classList.add('hidden');
  listPanel.classList.remove('hidden');
  backBtn().classList.remove('hidden');
  renderCards();
}
// ことばが変わったら、作り直す（エディターで作っているとちゅうなら、そのまま続けられる）
function relang() {
  closeDialog();
  if (!built) return;
  root.textContent = '';
  built = false;
  build();
  if (ed) {
    listPanel.classList.add('hidden');
    editPanel.classList.remove('hidden');
    renderEditor();
  } else renderCards();
}

// ---- ダイアログ（コードを見せる・はりつける・売る） ----
// ショップの画面からも使うので、画面の外（index.html の #dialog）に出す
const dialogEl = () => document.getElementById('dialog');
function showDialog(title, fill) {
  const d = dialogEl();
  d.textContent = '';
  const box = el('div', { className: 'box' }, el('b', { textContent: title }));
  fill(box);
  d.append(box);
  d.classList.remove('hidden');
}
const closeDialog = () => { const d = dialogEl(); if (d) d.classList.add('hidden'); };
function codeBox(title, text, code) {
  showDialog(title, (box) => {
    const ta = el('textarea', { readOnly: true, value: code });
    const copy = button(tr('📋 コピー'), () => {
      const fail = () => { ta.focus(); ta.select(); toast(tr('コピーできなかったので、文字をえらんでコピーしてね')); };
      if (!navigator.clipboard) { fail(); return; }
      navigator.clipboard.writeText(code).then(() => toast(tr('コピーした！ 友だちにわたしてね')), fail);
    });
    box.append(note(text), ta, el('div', { className: 'row' }, copy, button(tr('とじる'), closeDialog)));
  });
}
function showCode(m) {
  const text = !m.sale ? tr('このコードを友だちにわたすと、同じモッドを読みこめるよ。')
    : isMine(m) ? tr('売り物のコードだよ（🪙{price}）。友だちが読みこむと、ショップにならぶ。友だちが買ってくれたら、もらったお礼コードを「コードを読みこむ」にはってね。', { price: m.sale.price })
    : tr('売り物のモッドなので、このコードを読みこんだ人は、ショップで買うと使えるよ。');
  codeBox(tr('「{name}」のコード', { name: m.name }), text, encode(m));
}
function importCode(onDone) {
  showDialog(tr('コードを読みこむ'), (box) => {
    const ta = el('textarea', { placeholder: tr('モッドのコード（GRAPEMOD1:）か、お礼コード（GRAPEPAY1:）を、ここにはりつけてね') });
    const err = el('p', { className: 'err' });
    const ok = button(tr('読みこむ'), () => {
      try {
        readCode(ta.value);
        closeDialog();
        if (onDone) onDone();
      } catch (e) { err.textContent = e.message; }
    });
    box.append(ta, err, el('div', { className: 'row' }, ok, button(tr('やめる'), closeDialog)));
    ta.focus();
  });
}
// 売りに出す：値段と、自分の名前（買う人に見える）を決めると、売り物のコードが出る
function putOnSale(m, price) {
  const first = !m.sale;
  m.sale = { price, id: m.sale ? m.sale.id : m.id };   // 売り物の番号は、はじめに売りに出したときのモッドの番号のまま
  m.by = SHOP.me().name;
  saveMods();
  changed();
  if (built) renderCards();
  if (first) SHOP.event('sellMod');
}
function sellDialog(m) {
  showDialog(tr('💰「{name}」を売る', { name: m.name }), (box) => {
    let price = m.sale ? m.sale.price : 50;
    const nameIn = el('input', { type: 'text', maxLength: 12, value: SHOP.me().name, className: 'nameIn', placeholder: tr('なまえ') });
    const prices = el('div', { className: 'seg' });
    for (const p of SHOP.salePrices) {
      const b = button('🪙' + p, () => { price = p; for (const x of prices.children) x.classList.toggle('on', x === b); }, '');
      b.classList.toggle('on', p === price);
      b.dataset.price = p;
      prices.append(b);
    }
    const go = button(m.sale ? tr('値段を変える') : tr('売りに出す'), () => {
      SHOP.setName(nameIn.value);
      putOnSale(m, price);
      showCode(m);
    }, 'small go');
    const acts = el('div', { className: 'row' }, go);
    if (m.sale) {
      acts.append(sureButton(tr('売るのをやめる'), tr('ほんとうに？'), () => {
        delete m.sale;
        saveMods();
        changed();
        renderCards();
        closeDialog();
        toast(tr('「{name}」を売るのをやめた', { name: m.name }));
      }));
    }
    acts.append(button(tr('とじる'), closeDialog));
    box.append(note(tr('値段をえらんで「売りに出す」をおすと、売り物のコードが出るよ。それを友だちにわたしてね。友だちがショップで買うと「お礼コード」をくれるので、それを「コードを読みこむ」にはると、コインがもらえる。')),
               field(tr('あなたの名前（買う人に見える）'), nameIn), field(tr('値段'), prices), acts);
  });
}
function onFile() {
  const f = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  if (f.size > 200000) { toast(tr('ファイルが大きすぎます')); return; }
  f.text().then((text) => { try { addMod(fromText(text)); } catch (e) { toast(e.message); } });
}

// ---- エディター ----
// 新しいキャラは、ブドウの頭から始める（色の番号 0 りんかく、1 肌、2 つや、3 と 4 へた）
function newChar() {
  return { v: 1, type: 'char', name: tr('わたしのキャラ'), colors: ['#2e1442', '#8a4bbf', '#b98be0', '#5cb85c', '#2f7a2f'],
           px: ['....4....', '....33...', '.0000000.', '011111110', '012111110'].concat(Array(5).fill('011111110'), ['.0000000.']),
           face: 'fruit', skin: '#8a4bbf', shirt: '#5cb85c', outline: '#2e1442', blood: '#d0182e', tough: 1, weight: 1, sparks: false };
}
function newThing() {
  return { v: 1, type: 'thing', name: tr('わたしの物'), colors: [], w: 12, h: 5, px: Array(5).fill('.'.repeat(12)),
           kind: 'plain', weight: 1, bounce: 0.1, bladeFrom: 6, gunPower: 25, gunAuto: false, fuse: 3, power: 1 };
}
let ed = null;   // 作っているモッド：{ m, isNew, undo, tool, color, custom }
let gridCanvas, paletteEl, toolsEl, settingsEl, previewEl, stroke = null;
const gw = () => (ed.m.type === 'char' ? HEAD_W : ed.m.w);
const gh = () => (ed.m.type === 'char' ? HEAD_H : ed.m.h);
function edit(m, isNew) {
  build();
  const first = m.colors[1] || m.colors[0] || PRESETS[0];
  ed = { m, isNew, undo: [], tool: 'pen', color: first, custom: '#ff0000' };
  listPanel.classList.add('hidden');
  editPanel.classList.remove('hidden');
  backBtn().classList.add('hidden');
  renderEditor();
}
function closeEditor() {
  ed = null;
  stroke = null;
  editPanel.classList.add('hidden');
  listPanel.classList.remove('hidden');
  backBtn().classList.remove('hidden');
  renderCards();
}
// 使っていない色を消して、番号をつめる
function compact(m) {
  const used = new Set();
  for (const r of m.px) for (const ch of r) if (ch !== '.') used.add(IDX.indexOf(ch));
  const keep = m.colors.map((c, i) => i).filter((i) => used.has(i));
  const to = new Map(keep.map((old, i) => [old, i]));
  m.colors = keep.map((i) => m.colors[i]);
  m.px = m.px.map((r) => [...r].map((ch) => (ch === '.' ? '.' : IDX[to.get(IDX.indexOf(ch))])).join(''));
}
// 保存する。できたらモッドの id を返す。新しく作ったモッドは、自分が作った物になる
function commit() {
  const m = ed.m;
  compact(m);
  if (ed.isNew) m.author = SHOP.me().id;
  let clean;
  try { clean = validate(m); } catch (e) { toast(e.message); return null; }
  if (ed.isNew) {
    if (mods.length >= MAX_MODS) { toast(tr('モッドは60こまでだよ')); return null; }
    clean.id = m.id = newId();
    mods.push(clean);
    ed.isNew = false;
    SHOP.event('mod');
  } else {
    clean.id = m.id;
    const i = mods.findIndex((x) => x.id === m.id);
    if (i >= 0) mods[i] = clean; else mods.push(clean);
  }
  saveMods();
  changed();
  toast(tr('「{name}」を保存した！', { name: clean.name }));
  return clean.id;
}
function renderEditor() {
  const m = ed.m;
  editPanel.textContent = '';
  const nameIn = el('input', { type: 'text', maxLength: 12, value: m.name, className: 'nameIn', placeholder: tr('なまえ') });
  nameIn.addEventListener('input', () => { m.name = nameIn.value; });
  gridCanvas = el('canvas', { id: 'edGrid' });
  gridCanvas.addEventListener('pointerdown', onGridDown);
  gridCanvas.addEventListener('pointermove', onGridMove);
  gridCanvas.addEventListener('pointerup', onGridUp);
  gridCanvas.addEventListener('pointercancel', onGridUp);
  toolsEl = el('div', { className: 'tools' });
  paletteEl = el('div', { className: 'palette' });
  settingsEl = el('div', { className: 'edRight' });
  editPanel.append(
    el('div', { className: 'edTop' },
      el('span', { className: 'tag', textContent: m.type === 'char' ? tr('キャラクター') : tr('物') }), nameIn,
      button(tr('💾 ほぞん'), () => { if (commit()) closeEditor(); }, 'small go'),
      button(tr('▶ ためす'), () => { const id = commit(); if (id) { closeEditor(); window.GRAPE.tryMod(id); } }),
      sureButton(tr('✕ やめる'), tr('ほんとうにやめる？'), closeEditor)),
    el('div', { className: 'edMain' }, el('div', { className: 'edLeft' }, gridCanvas, toolsEl, paletteEl), settingsEl));
  renderTools();
  renderPalette();
  renderSettings();
  drawGrid();
}
function renderTools() {
  toolsEl.textContent = '';
  for (const [id, text] of [['pen', '✏ ペン'], ['eraser', '🧽 けしゴム'], ['fill', '🪣 ぬりつぶし']]) {
    const b = button(tr(text), () => { ed.tool = id; renderTools(); renderPalette(); });
    b.classList.toggle('on', ed.tool === id);
    b.dataset.tool = id;
    toolsEl.append(b);
  }
  toolsEl.append(button(tr('↩ もどす'), undo), sureButton(tr('🗑 ぜんぶけす'), tr('ほんとうに？'), () => {
    pushUndo();
    ed.m.px = ed.m.px.map((r) => '.'.repeat(r.length));
    drawGrid();
  }));
}
function renderPalette() {
  paletteEl.textContent = '';
  const seen = new Set();
  for (const c of [...ed.m.colors, ...PRESETS]) {
    if (seen.has(c)) continue;
    seen.add(c);
    const s = el('button', { className: 'swatch' + (ed.tool !== 'eraser' && ed.color === c ? ' on' : ''), title: c });
    s.style.background = c;
    s.addEventListener('click', () => { ed.color = c; if (ed.tool === 'eraser') ed.tool = 'pen'; renderTools(); renderPalette(); });
    paletteEl.append(s);
  }
  const pick = el('input', { type: 'color', value: ed.custom });
  pick.addEventListener('input', () => { ed.custom = ed.color = pick.value; if (ed.tool === 'eraser') { ed.tool = 'pen'; renderTools(); } });
  pick.addEventListener('change', renderPalette);
  paletteEl.append(el('label', { className: 'pick', textContent: tr('ほかの色') + ' ' }, pick));
}
function field(label, ...kids) { return el('div', { className: 'field' }, el('span', { textContent: label }), ...kids); }
// key はテストで見分けるための名前
function seg(key, label, options, current, pick) {
  const box = el('div', { className: 'seg' });
  for (const [v, text] of options) {
    const b = button(text, () => {
      for (const x of box.children) x.classList.remove('on');
      b.classList.add('on');
      pick(v);
      updatePreview();
    }, '');
    b.classList.toggle('on', String(v) === String(current));
    b.dataset.v = v;
    box.append(b);
  }
  const f = field(label, box);
  f.dataset.field = key;
  return f;
}
function colorField(label, key) {
  const input = el('input', { type: 'color', value: ed.m[key] });
  input.addEventListener('input', () => { ed.m[key] = input.value; updatePreview(); });
  return field(label, input);
}
function rangeField(label, min, max, step, value, pick) {
  const out = el('b', { textContent: value });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { out.textContent = input.value; pick(Number(input.value)); });
  return field(label, el('div', { className: 'range' }, input, out));
}
function sizeField(label, key, lo, hi) {
  const out = el('b', { textContent: ed.m[key] });
  const change = (d) => {
    const v = Math.min(hi, Math.max(lo, ed.m[key] + d));
    if (v === ed.m[key]) return;
    pushUndo();
    resize(key === 'w' ? v : ed.m.w, key === 'h' ? v : ed.m.h);
    renderSettings();
    drawGrid();
  };
  return field(label, el('div', { className: 'range' }, button('−', () => change(-1), ''), out, button('＋', () => change(1), '')));
}
function note(text) { return el('p', { className: 'note', textContent: text }); }
function renderSettings() {
  const m = ed.m;
  settingsEl.textContent = '';
  previewEl = el('canvas', { className: 'pix preview' });
  settingsEl.append(previewEl);
  if (m.type === 'char') {
    settingsEl.append(
      seg('face', tr('顔'), labels(FACES), m.face, (v) => { m.face = v; drawGrid(); }),
      el('div', { className: 'colors' }, colorField(tr('肌'), 'skin'), colorField(tr('服'), 'shirt'), colorField(tr('りんかく'), 'outline'),
         colorField(tr('血'), 'blood')),
      seg('tough', tr('丈夫さ'), labels(TOUGH), m.tough, (v) => { m.tough = v; }),
      seg('weight', tr('重さ'), labels(WEIGHTS), m.weight, (v) => { m.weight = v; }),
      seg('sparks', tr('ロボみたいに、オイルと火花'), labels(OFF_ON), m.sparks ? 1 : 0, (v) => { m.sparks = v === 1; }),
      note(tr('赤い四角の中が顔。うすい黒い点の所に、目と口が出る。')));
  } else {
    settingsEl.append(
      el('div', { className: 'colors' }, sizeField(tr('はば'), 'w', 4, 32), sizeField(tr('たかさ'), 'h', 2, 16)),
      seg('kind', tr('しゅるい'), labels(KINDS), m.kind, (v) => { m.kind = v; renderSettings(); drawGrid(); }),
      seg('weight', tr('重さ'), labels(WEIGHTS), m.weight, (v) => { m.weight = v; }),
      rangeField(tr('はねる強さ'), 0, 0.9, 0.1, m.bounce, (v) => { m.bounce = v; }));
    if (m.kind === 'blade') {
      settingsEl.append(rangeField(tr('刃のはじまり（赤い線から右が刃）'), 0, m.w - 1, 1, m.bladeFrom, (v) => { m.bladeFrom = v; drawGrid(); }),
                        note(tr('右が刃先。刃先からまっすぐ当てると刺さる。')));
    }
    if (m.kind === 'gun') {
      settingsEl.append(rangeField(tr('いりょく'), 5, 60, 1, m.gunPower, (v) => { m.gunPower = v; }),
                        seg('auto', tr('れんしゃ'), labels(OFF_ON), m.gunAuto ? 1 : 0, (v) => { m.gunAuto = v === 1; }),
                        note(tr('いちばん右はしから弾が出る。出した銃をタップすると撃つ。')));
    }
    if (m.kind === 'bomb') {
      settingsEl.append(rangeField(tr('爆発までの時間（びょう）'), 1, 8, 0.5, m.fuse, (v) => { m.fuse = v; }),
                        rangeField(tr('いりょく'), 0.3, 2, 0.1, m.power, (v) => { m.power = v; }),
                        note(tr('出した爆弾をタップすると、火がつく。')));
    }
    if (m.kind === 'ball') settingsEl.append(note(tr('まるい物として、ころがる。')));
    if (m.kind === 'heal') settingsEl.append(note(tr('いちばん右の3列が針。針をキャラに刺すと、ケガが治る。')));
  }
  updatePreview();
}
function updatePreview() {
  if (!previewEl || !ed || !window.GRAPE) return;
  let src;
  try { src = window.GRAPE.modPreview(ed.m); } catch (e) { return; }
  const k = Math.max(1, Math.floor(Math.min(160 / src.width, 120 / src.height)));
  previewEl.width = src.width; previewEl.height = src.height;
  previewEl.getContext('2d').drawImage(src, 0, 0);
  previewEl.style.width = src.width * k + 'px';
  previewEl.style.height = src.height * k + 'px';
}
function resize(w, h) {
  const m = ed.m;
  m.px = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (m.px[y] && m.px[y][x]) || '.').join(''));
  m.w = w; m.h = h;
  m.bladeFrom = Math.min(m.bladeFrom, w - 1);
}
function pushUndo() {
  ed.undo.push(JSON.stringify({ px: ed.m.px, colors: ed.m.colors, w: ed.m.w, h: ed.m.h }));
  if (ed.undo.length > 40) ed.undo.shift();
}
function undo() {
  const s = ed.undo.pop();
  if (!s) return;
  Object.assign(ed.m, JSON.parse(s));
  if (ed.m.type === 'thing') renderSettings();
  renderPalette();
  drawGrid();
}
function cellSize() {
  const phone = innerHeight <= 500;   // 横向きのスマホ：右に設定をならべるので、グリッドは左半分に
  const availW = Math.min(560, innerWidth * (phone ? 0.48 : innerWidth > 700 ? 0.55 : 0.9));
  const availH = Math.max(150, innerHeight - (phone ? 150 : 190));
  return Math.max(6, Math.min(32, Math.floor(availW / gw()), Math.floor(availH / gh())));
}
function drawGrid() {
  const m = ed.m, w = gw(), h = gh(), cs = cellSize(), dpr = window.devicePixelRatio || 1;
  gridCanvas.width = w * cs * dpr; gridCanvas.height = h * cs * dpr;
  gridCanvas.style.width = w * cs + 'px'; gridCanvas.style.height = h * cs + 'px';
  const x = gridCanvas.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = m.px[j][i];
      x.fillStyle = ch === '.' ? ((i + j) % 2 ? '#e2e2e2' : '#f6f6f6') : m.colors[IDX.indexOf(ch)];
      x.fillRect(i * cs, j * cs, cs, cs);
    }
  }
  x.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  x.lineWidth = 1;
  x.beginPath();
  for (let i = 1; i < w; i++) { x.moveTo(i * cs + 0.5, 0); x.lineTo(i * cs + 0.5, h * cs); }
  for (let j = 1; j < h; j++) { x.moveTo(0, j * cs + 0.5); x.lineTo(w * cs, j * cs + 0.5); }
  x.stroke();
  if (m.type === 'char') {   // 顔の四角と、目と口の場所
    x.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (const [r, c] of FACE_DOTS[m.face]) x.fillRect(c * cs + cs * 0.25, (r + 2) * cs + cs * 0.25, cs * 0.5, cs * 0.5);
    x.strokeStyle = 'rgba(220, 40, 40, 0.8)';
    x.lineWidth = 2;
    x.strokeRect(1, 2 * cs + 1, w * cs - 2, 9 * cs - 2);
  } else if (m.kind === 'blade') {
    x.fillStyle = 'rgba(220, 40, 40, 0.85)';
    x.fillRect(m.bladeFrom * cs - 1.5, 0, 3, h * cs);
  }
  updatePreview();
}
function cellAt(e) {
  const r = gridCanvas.getBoundingClientRect();
  return { i: Math.floor((e.clientX - r.left) / (r.width / gw())), j: Math.floor((e.clientY - r.top) / (r.height / gh())) };
}
const inGrid = (i, j) => i >= 0 && j >= 0 && i < gw() && j < gh();
// 今の色の番号（新しい色なら、色のリストに足す）。けしゴムなら「.」
function paintValue() {
  if (ed.tool === 'eraser') return '.';
  const m = ed.m;
  let i = m.colors.indexOf(ed.color);
  if (i < 0) {
    if (m.colors.length >= MAX_COLORS) compact(m);
    if (m.colors.length >= MAX_COLORS) { toast(tr('色は24色までだよ')); return null; }
    m.colors.push(ed.color);
    i = m.colors.length - 1;
    renderPalette();
  }
  return IDX[i];
}
function setCell(i, j, v) {
  if (!inGrid(i, j) || v == null) return;
  const r = ed.m.px[j];
  ed.m.px[j] = r.slice(0, i) + v + r.slice(i + 1);
}
function fill(i, j, v) {
  if (v == null) return;
  const from = ed.m.px[j][i];
  if (from === v) return;
  const todo = [[i, j]];
  while (todo.length) {
    const [x, y] = todo.pop();
    if (!inGrid(x, y) || ed.m.px[y][x] !== from) continue;
    setCell(x, y, v);
    todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}
function onGridDown(e) {
  e.preventDefault();
  const { i, j } = cellAt(e);
  if (!inGrid(i, j)) return;
  try { gridCanvas.setPointerCapture(e.pointerId); } catch (err) { /* もうはなれた指 */ }
  pushUndo();
  const v = paintValue();
  if (ed.tool === 'fill') { fill(i, j, v); drawGrid(); return; }
  stroke = { id: e.pointerId, i, j, v };
  setCell(i, j, v);
  drawGrid();
}
function onGridMove(e) {
  if (!stroke || e.pointerId !== stroke.id) return;
  const { i, j } = cellAt(e);
  const n = Math.max(Math.abs(i - stroke.i), Math.abs(j - stroke.j));   // すばやく動かしても、とぎれないように線でつなぐ
  for (let k = 1; k <= n; k++) {
    setCell(Math.round(stroke.i + (i - stroke.i) * k / n), Math.round(stroke.j + (j - stroke.j) * k / n), stroke.v);
  }
  stroke.i = i; stroke.j = j;
  if (n) drawGrid();
}
function onGridUp(e) { if (stroke && e.pointerId === stroke.id) stroke = null; }
addEventListener('resize', () => { if (ed) drawGrid(); });

window.GrapeMods = {
  IDX, validate, encode, decode, open, relang, importCode, codeBox, readCode,
  list: () => mods.slice(),
  get: (id) => mods.find((m) => m.id === id) || null,
  preview: previewCanvas,
  onChange: (fn) => { listeners.push(fn); },
  add: (raw) => addMod(validate(raw)),   // テスト用
  remove: removeMod,
  sell: (id, price) => {   // テスト用：ダイアログを使わずに売りに出す
    const m = mods.find((x) => x.id === id);
    if (!m || !isMine(m) || !SHOP.salePrices.includes(price)) return false;
    putOnSale(m, price);
    return true;
  },
  editing: () => (ed ? JSON.parse(JSON.stringify(ed.m)) : null),
};
})();
