// グレープシミュレーターのコイン・ショップ・クエストと、モッドの売り買い。index.html で、lang.js の次、game.js より先に読みこむ。
// コインはゲームの中だけのお金で、本当のお金とは関係ない（本当のお金で買う物は、ない）。
// クエストをクリアしたり、キャラをたおしたりするとコインがもらえて、ショップでアイテムや、友だちが売っているモッドが買える。
// 保存するのは、このブラウザの中（localStorage）だけ。
//
// モッドの売り買い（インターネットのサーバーがないので、コードをわたしあう）：
// 1. 作った人が、モッドエディターでモッドに値段をつけて「売りに出す」。出てきたコードを友だちにわたす
// 2. 友だちがコードを読みこむと、ショップの「モッドショップ」にならぶ。コインで買うと「お礼コード」（GRAPEPAY1:）が出る
// 3. 友だちが、お礼コードを作った人にわたす。作った人がそれを読みこむと、コインが入る（同じお礼コードは1回しか使えない）
// だれがだれかは、ブラウザごとに作る「プレイヤー番号」（me.id）で見分ける。
(() => {
'use strict';
const tr = window.GrapeLang.t;
const SAVE_KEY = 'grape-simulator-save';
const START_COINS = 100;   // さいしょに持っているコイン
const KILL_COINS = 3;      // キャラを1体たおすと、もらえるコイン（1体につき1回だけ）
const SALE_PRICES = [10, 30, 50, 100, 200, 300, 500];   // モッドにつけられる値段
const PAY_PREFIX = 'GRAPEPAY1:';                         // お礼コードのはじまり
const SND = () => window.GrapeSound || { play() {} };
const MODS = () => window.GrapeMods;                     // mods.js（shop.js より後に読みこむ）

// ショップの品物。id はゲームの中の名前（キャラか物）。rainbow だけは、せっていで使う物
const GOODS = [
  { id: 'banana', price: 100, desc: 'あまいバナナの人' },
  { id: 'pineapple', price: 200, desc: 'かたい皮で、1.5倍丈夫' },
  { id: 'zombie', price: 400, desc: '死んでも、頭がついていれば起き上がる' },
  { id: 'goldrobot', price: 600, desc: 'ロボよりもっと丈夫な、金ぴかロボ' },
  { id: 'axe', price: 120, desc: '重くて、手足を切り落としやすい' },
  { id: 'spear', price: 150, desc: '長くて、深く刺さる' },
  { id: 'chainsaw', price: 350, desc: 'タップで動く。当てると切れつづける' },
  { id: 'grenade', price: 150, desc: 'タップでピンをぬくと、2秒で爆発' },
  { id: 'launcher', price: 500, desc: 'タップでロケットを発射。当たると爆発' },
  { id: 'tank', price: 800, desc: '乗って走れる。砲台をタップすると大砲' },
  { id: 'trampoline', price: 80, desc: '上に落ちると、ボヨーンとはねる' },
  { id: 'balloon', price: 100, desc: 'ひもでつなぐと、うく。5こでキャラもうく' },
  { id: 'rainbow', price: 250, name: 'にじ色の血', desc: 'せっていで、血をにじ色にできる' },
];
const PRICE = Object.fromEntries(GOODS.map((g) => [g.id, g.price]));

// クエスト。ev はゲームの中のできごと、n は何回か、coins はもらえるコイン。
// max は「いちばん大きい数」（進んだきょり）、set は「ちがう物の数」（遊んだマップ）。repeat は、クリアしても、またできる。
const QUESTS = [
  { id: 'spawn30', text: 'キャラを30回出す', ev: 'spawnChar', n: 30, coins: 40 },
  { id: 'bone20', text: '骨を20本おる', ev: 'bone', n: 20, coins: 80 },
  { id: 'stick15', text: 'ナイフや刀を15回刺す', ev: 'stick', n: 15, coins: 80 },
  { id: 'sever15', text: '手足を15本とる', ev: 'sever', n: 15, coins: 100 },
  { id: 'shoot300', text: '銃を300発うつ', ev: 'shoot', n: 300, coins: 80 },
  { id: 'explode40', text: '爆発を40回おこす', ev: 'explode', n: 40, coins: 120 },
  { id: 'kill50', text: '50体たおす', ev: 'kill', n: 50, coins: 100 },
  { id: 'ride10', text: 'キャラをのりものに10回乗せる', ev: 'ride', n: 10, coins: 60 },
  { id: 'runover20', text: 'のりもので20回ひく', ev: 'runover', n: 20, coins: 120 },
  { id: 'revive10', text: '注射で10回生き返らせる', ev: 'revive', n: 10, coins: 120 },
  { id: 'fall15', text: '高い所から落として15体たおす', ev: 'fallKill', n: 15, coins: 120 },
  { id: 'splash30', text: '水に30回とびこませる', ev: 'splash', n: 30, coins: 60 },
  { id: 'lava10', text: '溶岩に10回落とす', ev: 'lava', n: 10, coins: 120 },
  { id: 'dist500', text: 'エンドレスで500m進む', ev: 'distance', n: 500, max: true, coins: 150 },
  { id: 'dist2000', text: 'エンドレスで2000m進む', ev: 'distance', n: 2000, max: true, coins: 500 },
  { id: 'maps', text: 'ぜんぶのマップ（9つ）で遊ぶ', ev: 'map', n: 9, set: true, coins: 150 },
  { id: 'multi5', text: '1回の爆発で5体いっぺんにたおす', ev: 'multiKill', n: 1, coins: 200 },
  { id: 'limbs', text: '1体の手足を4本ぜんぶとる', ev: 'allLimbs', n: 1, coins: 150 },
  { id: 'kill500', text: '500体たおす', ev: 'kill', n: 500, coins: 800 },
  { id: 'buy3', text: 'ショップで3つ買う', ev: 'buy', n: 3, coins: 100 },
  { id: 'mod3', text: 'モッドを3つ作る', ev: 'mod', n: 3, coins: 120 },
  { id: 'tank20', text: '戦車の大砲を20回うつ', ev: 'tankShot', n: 20, coins: 100 },
  { id: 'sellMod', text: 'モッドを売りに出す', ev: 'sellMod', n: 1, coins: 30 },
  { id: 'modSold', text: '自分のモッドが売れる（お礼コードを読みこむ）', ev: 'modSold', n: 1, coins: 150 },
  { id: 'buyMod', text: '友だちのモッドを買う', ev: 'buyMod', n: 1, coins: 50 },
  { id: 'again100', text: '100体たおす', ev: 'kill', n: 100, coins: 100, repeat: true },
  { id: 'againBoom30', text: '爆発を30回おこす', ev: 'explode', n: 30, coins: 80, repeat: true },
  { id: 'againSever20', text: '手足を20本とる', ev: 'sever', n: 20, coins: 80, repeat: true },
];

// ---- 名前と番号 ----
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomId(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => ID_CHARS[x % ID_CHARS.length]).join('');
}
// 見える文字かどうか（改行などの見えない文字は、名前に入れない）
function visible(ch) {
  const c = ch.codePointAt(0);
  return c > 0x1f && (c < 0x7f || c > 0x9f) && c !== 0x2028 && c !== 0x2029;
}
// 人やモッドの名前：見えない文字をとって、12文字まで
function cleanName(v) {
  return [...[...String(v == null ? '' : v)].filter(visible).join('').trim()].slice(0, 12).join('');
}
const PLAYER_ID = /^[a-z0-9]{8}$/, MOD_ID = /^mod_[a-z0-9]{8}$/, RECEIPT_ID = /^[a-z0-9]{10}$/;
const SALE_KEY = /^[a-z0-9]{8}:mod_[a-z0-9]{8}$/;

// ---- 保存 ----
// q はクエストの進みぐあい（今のクエストの分だけ。0.7 までのクエストは消す）、me はこのブラウザのプレイヤー、
// bought は買ったモッド（作った人の番号:モッドの番号）、redeemed は使ったお礼コード、sales は自分のモッドが何こ売れたか、
// receipts は買ったモッドのお礼コード（あとで、もう一度見られるように）
const fresh = () => ({ v: 2, coins: START_COINS, owned: [], q: {}, me: { id: randomId(8), name: '' },
                       bought: [], redeemed: [], sales: {}, receipts: {} });
const strings = (v, re, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && re.test(x)).slice(-max) : []);
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* 保存できないブラウザや、こわれたデータのときは、はじめから */ }
  const f = fresh();
  if (!s || typeof s !== 'object') return f;
  const me = s.me && typeof s.me === 'object' ? s.me : {};
  const sales = {}, receipts = {};
  if (s.sales && typeof s.sales === 'object') {
    for (const [k, n] of Object.entries(s.sales)) if (MOD_ID.test(k) && Number(n) > 0) sales[k] = Math.floor(Number(n));
  }
  if (s.receipts && typeof s.receipts === 'object') {
    for (const [k, c] of Object.entries(s.receipts).slice(-100)) {
      if (SALE_KEY.test(k) && typeof c === 'string' && c.startsWith(PAY_PREFIX) && c.length < 2000) receipts[k] = c;
    }
  }
  return { v: 2, coins: Math.max(0, Math.floor(Number(s.coins) || 0)),
           owned: Array.isArray(s.owned) ? s.owned.filter((id) => PRICE[id]) : [],
           q: s.q && typeof s.q === 'object' ? Object.fromEntries(Object.entries(s.q).filter(([id]) => QUESTS.some((q) => q.id === id))) : {},
           me: { id: PLAYER_ID.test(me.id) ? me.id : f.me.id, name: cleanName(me.name) },
           bought: strings(s.bought, SALE_KEY, 500), redeemed: strings(s.redeemed, RECEIPT_ID, 1000), sales, receipts };
}
let save = load();
let saveTimer = 0;
function persist(now) {
  clearTimeout(saveTimer);
  const write = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できないブラウザでも動く */ } };
  if (now) write(); else saveTimer = setTimeout(write, 800);   // 銃を撃つたびに書かないように、少しまとめる
}
persist(true);   // プレイヤー番号を、すぐに決めておく
addEventListener('pagehide', () => persist(true));

function stateOf(q) {
  let st = save.q[q.id];
  if (!st || typeof st !== 'object') st = save.q[q.id] = {};
  st.n = Math.max(0, Number(st.n) || 0);
  st.times = Math.max(0, Number(st.times) || 0);
  st.done = !!st.done && !q.repeat;
  if (!Array.isArray(st.seen)) st.seen = [];
  return st;
}

// コインや持ち物が変わったら知らせる（what は 'coins' か 'owned'）
const listeners = [];
function notify(what) {
  const el = document.getElementById('shopCoins');
  if (el) el.textContent = save.coins;
  for (const fn of listeners) fn(what);
}

// ---- できごと（ゲームから呼ばれる） ----
function event(name, arg) {
  let changed = false;
  for (const q of QUESTS) {
    if (q.ev !== name) continue;
    const st = stateOf(q);
    if (st.done) continue;
    if (q.max) {
      const v = Math.floor(Number(arg) || 0);
      if (v <= st.n) continue;
      st.n = v;
    } else if (q.set) {
      const k = String(arg);
      if (st.seen.includes(k)) continue;
      st.seen.push(k);
      st.n = st.seen.length;
    } else st.n++;
    changed = true;
    if (st.n >= q.n) complete(q, st);
  }
  if (changed) persist();
}
function complete(q, st) {
  save.coins += q.coins;
  if (q.repeat) { st.n = 0; st.times++; } else st.done = true;
  persist(true);
  toast(tr('クエストクリア！「{quest}」 +🪙{coins}', { quest: tr(q.text), coins: q.coins }));
  SND().play('quest', 0.9);
  notify('coins');
}
function addCoins(n) {
  save.coins += Math.floor(n);
  persist();
  SND().play('coin', 0.5);
  notify('coins');
}
const nameOf = (id) => {
  const g = GOODS.find((x) => x.id === id);
  return g && g.name ? tr(g.name) : window.GRAPE ? window.GRAPE.itemName(id) : id;
};
function buy(id) {
  if (!PRICE[id] || save.owned.includes(id) || save.coins < PRICE[id]) return false;
  save.coins -= PRICE[id];
  save.owned.push(id);
  persist(true);
  SND().play('buy', 1);
  toast(tr('{name}を手に入れた！', { name: nameOf(id) }));
  notify('owned');
  event('buy');
  return true;
}

// ---- モッドの売り買い ----
const modOf = (id) => (typeof id === 'string' && id.startsWith('mod_') && MODS() ? MODS().get(id) : null);
const isMine = (m) => !!m && m.author === save.me.id;
const saleKey = (m) => m.author + ':' + m.sale.id;
// 買わないと使えないモッド：ほかの人が売りに出していて、まだ買っていない物
const modLocked = (m) => !!(m && m.sale && m.author && !isMine(m) && !save.bought.includes(saleKey(m)));
function locked(id) { return PRICE[id] ? !save.owned.includes(id) : modLocked(modOf(id)); }
function price(id) {
  const m = modOf(id);
  return PRICE[id] || (m && m.sale ? m.sale.price : 0);
}
// 文字を base64 にする（日本語も通るように UTF-8 で）
function toBase64(text) {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}
const fromBase64 = (s) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
// まちがい見つけ用の数（FNV-1a）。コードの一部が変わったり、切れたりしたら合わなくなる
function checksum(text) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(36);
}
const receiptSum = (r) => checksum([r.a, r.m, r.p, r.n, r.b, r.r, r.s].join('|'));
// お礼コード：だれの（a）どのモッド（m）を、いくらで（p）、だれが（b, r）買ったか。s は、このお礼コードの番号
function makeReceipt(m) {
  const r = { a: m.author, m: m.sale.id, p: m.sale.price, n: m.name, b: save.me.name, r: save.me.id, s: randomId(10) };
  r.c = receiptSum(r);
  return PAY_PREFIX + toBase64(JSON.stringify(r));
}
function buyMod(id) {
  const m = modOf(id);
  if (!modLocked(m) || save.coins < m.sale.price) return null;
  save.coins -= m.sale.price;
  const key = saleKey(m), code = makeReceipt(m);
  save.bought.push(key);
  save.receipts[key] = code;
  persist(true);
  SND().play('buy', 1);
  toast(tr('{name}を手に入れた！', { name: m.name }));
  notify('owned');
  event('buy');
  event('buyMod');
  return code;
}
function readReceipt(text) {
  const s = String(text || '').replace(/\s+/g, '');
  if (!s.startsWith(PAY_PREFIX)) throw new Error(tr('GRAPEPAY1: で始まるお礼コードをはってね'));
  if (s.length > 2000) throw new Error(tr('コードが長すぎます'));
  let r;
  try { r = JSON.parse(fromBase64(s.slice(PAY_PREFIX.length))); } catch (e) { throw new Error(tr('コードが読めません（とちゅうで切れているかも）')); }
  const ok = r && typeof r === 'object' && PLAYER_ID.test(r.a) && MOD_ID.test(r.m) && SALE_PRICES.includes(r.p) &&
             typeof r.n === 'string' && typeof r.b === 'string' && PLAYER_ID.test(r.r) && RECEIPT_ID.test(r.s) && r.c === receiptSum(r);
  if (!ok) throw new Error(tr('コードがまちがっています（どこかが変わっているかも）'));
  return { a: r.a, m: r.m, p: r.p, n: cleanName(r.n), b: cleanName(r.b), r: r.r, s: r.s };
}
// お礼コードを読みこむ：自分のモッドが売れた分のコインが入る
function redeem(text) {
  const r = readReceipt(text);
  if (r.a !== save.me.id) throw new Error(tr('これは、ほかの人のモッドのお礼コードだよ'));
  if (save.redeemed.includes(r.s)) throw new Error(tr('このお礼コードは、もう使ったよ'));
  save.redeemed.push(r.s);
  if (save.redeemed.length > 1000) save.redeemed.splice(0, save.redeemed.length - 1000);
  save.sales[r.m] = (save.sales[r.m] || 0) + 1;
  save.coins += r.p;
  persist(true);
  SND().play('quest', 0.9);
  toast(tr('{buyer}さんが「{name}」を買ってくれた！ +🪙{price}', { buyer: r.b || tr('だれか'), name: r.n, price: r.p }));
  notify('coins');
  event('modSold');
  return { price: r.p, buyer: r.b, name: r.n };
}
function setName(v) {
  save.me.name = cleanName(v);
  persist(true);
  const input = document.getElementById('playerName');
  if (input && input.value !== save.me.name && document.activeElement !== input) input.value = save.me.name;
}

// ---- 画面の上に少しだけ出るお知らせ ----
const toastQ = [];
let toastBusy = false;
function toast(text) {
  toastQ.push(text);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const el = document.getElementById('toast');
  const text = toastQ.shift();
  if (!el || text == null) { toastBusy = false; if (el) el.classList.add('hidden'); return; }
  toastBusy = true;
  el.textContent = text;
  el.classList.remove('hidden', 'pop');
  void el.offsetWidth;   // アニメーションを、はじめからやり直す
  el.classList.add('pop');
  setTimeout(nextToast, 2300);
}

// ---- ショップの画面 ----
const DROP = [   // にじ色の血のアイコン
  '....K....', '...KXK...', '...KXK...', '..KXXXK..', '..KXXXK..', '.KXXXXXK.', '.KXXXXXK.', 'KXXXXXXXK', 'KXXXXXXXK',
  '.KXXXXXK.', '..KKKKK..',
];
function rainbowIcon() {
  const c = document.createElement('canvas');
  c.width = 9; c.height = DROP.length;
  const x = c.getContext('2d');
  DROP.forEach((r, j) => [...r].forEach((ch, i) => {
    if (ch === '.') return;
    x.fillStyle = ch === 'K' ? '#111111' : `hsl(${(j * 40) % 360}, 90%, 58%)`;
    x.fillRect(i, j, 1, 1);
  }));
  return c;
}
function iconCanvas(id, maxW, maxH) {
  const src = id === 'rainbow' ? rainbowIcon() : window.GRAPE && window.GRAPE.icon(id);
  const c = document.createElement('canvas');
  if (!src) return c;
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const k = Math.min(maxH / src.height, maxW / src.width);
  c.style.width = src.width * k + 'px';
  c.style.height = src.height * k + 'px';
  return c;
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}
function smallButton(text, fn) {
  const b = el('button', { className: 'small', textContent: text });
  b.addEventListener('click', fn);
  return b;
}
const have = () => el('span', { className: 'have', textContent: tr('✓ もってる') });
// 買うボタン。まちがえて買わないように、2回おす。コインが足りないときは、あといくらか出す
function buyButton(cost, doBuy) {
  const b = el('button', { className: 'buy' });
  const reset = () => { b.classList.remove('short', 'sure'); b.textContent = '🪙 ' + cost; };
  reset();
  b.addEventListener('click', () => {
    clearTimeout(b.timer);
    if (save.coins < cost) {
      b.classList.add('short');
      b.textContent = tr('あと🪙{n}', { n: cost - save.coins });
      b.timer = setTimeout(reset, 1500);
      return;
    }
    if (!b.classList.contains('sure')) {
      b.classList.add('sure');
      b.textContent = tr('ほんとうに買う？');
      b.timer = setTimeout(reset, 2500);
      return;
    }
    doBuy();
  });
  return b;
}
function card(icon, name, desc, own, focus) {
  return el('div', { className: 'card' + (own ? ' owned' : '') + (focus ? ' focus' : '') },
            icon, el('b', { textContent: name }), el('small', { textContent: desc }));
}
function renderShop(list, focusId) {
  list.textContent = '';
  const goods = el('div', { className: 'cards' });
  for (const g of GOODS) {
    const own = save.owned.includes(g.id);
    const c = card(iconCanvas(g.id, 96, 52), nameOf(g.id), tr(g.desc), own, g.id === focusId);
    c.dataset.good = g.id;
    c.append(own ? have() : buyButton(g.price, () => { if (buy(g.id)) renderShop(list, g.id); }));
    goods.append(c);
  }
  list.append(goods);
  renderModShop(list, focusId);
  notify('coins');
  const f = focusId && list.querySelector('.focus');
  if (f) f.scrollIntoView({ block: 'center' });
}
// モッドショップ：ほかの人が売っているモッド（コードを読みこんだ物）
function renderModShop(list, focusId) {
  const M = MODS();
  const mods = M ? M.list().filter((m) => m.sale && m.author && !isMine(m)) : [];
  const cards = el('div', { className: 'cards', id: 'modShop' });
  for (const m of mods) {
    const own = !modLocked(m);
    const c = card(M.preview(m, 96, 52), m.name, tr('つくった人：{by}', { by: m.by || tr('だれか') }), own, m.id === focusId);
    c.dataset.mod = m.id;
    if (own) {
      c.append(have());
      const code = save.receipts[saleKey(m)];
      if (code) c.append(smallButton(tr('💌 お礼コード'), () => showReceipt(m, code)));
    } else {
      c.append(buyButton(m.sale.price, () => {
        const code = buyMod(m.id);
        if (!code) return;
        renderShop(list, m.id);
        showReceipt(m, code);
      }));
    }
    cards.append(c);
  }
  if (!mods.length) cards.append(el('p', { className: 'note', textContent: tr('まだ何もならんでいないよ。') }));
  list.append(el('h3', { textContent: tr('🛠 モッドショップ') }),
              el('p', { className: 'note', textContent: tr('友だちが売っているモッドを、コインで買えるよ。友だちから売り物のコードをもらって「コードを読みこむ」にはると、ここにならぶ。買ったら「お礼コード」を、作った人にわたしてね。') }),
              cards,
              el('div', { className: 'row' }, smallButton(tr('📋 コードを読みこむ'), () => M && M.importCode(() => renderShop(list)))));
}
function showReceipt(m, code) {
  MODS().codeBox(tr('💌 お礼コード'),
                 tr('「{name}」を買ったよ！ このお礼コードを、作った人（{by}）にわたしてね。作った人が読みこむと、🪙{price} がとどくよ。',
                    { name: m.name, by: m.by || tr('だれか'), price: m.sale.price }), code);
}

// ---- クエストの画面 ----
function renderQuests(list) {
  list.textContent = '';
  const rows = QUESTS.map((q) => ({ q, st: stateOf(q) }));
  const total = QUESTS.filter((q) => !q.repeat).length;
  list.append(el('p', { className: 'qsum' },
                 el('span', { textContent: tr('クリア {done} / {total}', { done: rows.filter((x) => x.st.done).length, total }) }),
                 el('span', { textContent: '🪙 ' + save.coins })));
  rows.sort((a, b) => a.st.done - b.st.done);   // まだのクエストを上に
  for (const { q, st } of rows) {
    const fill = el('i');
    fill.style.width = (st.done ? 100 : Math.min(100, st.n / q.n * 100)) + '%';
    const row = el('div', { className: 'quest' + (st.done ? ' done' : '') },
      el('span', { className: 'mark', textContent: st.done ? '✓' : q.repeat ? '🔁' : '○' }),
      el('span', { className: 'qtext', textContent: tr(q.text) + (q.repeat ? tr('（くりかえし・{n}回クリア）', { n: st.times }) : '') }),
      el('div', { className: 'bar' }, fill),
      el('small', { textContent: st.done ? tr('クリア') : `${Math.min(st.n, q.n)} / ${q.n}` }),
      el('b', { textContent: '🪙' + q.coins }));
    row.dataset.quest = q.id;
    list.append(row);
  }
}

// せっていの「あなたの名前」
const nameInput = document.getElementById('playerName');
if (nameInput) {
  nameInput.value = save.me.name;
  nameInput.addEventListener('input', () => setName(nameInput.value));
}

// テスト用：ホーム画面のコインを、3秒のうちに10回タップすると、1000コインふえる（ためすとき用）
let taps = [];
document.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('#coinPill')) return;
  const now = Date.now();
  taps = taps.filter((t) => now - t < 3000).concat(now);
  if (taps.length >= 10) { taps = []; addCoins(1000); toast(tr('テスト用：+🪙1000')); }
});

window.GrapeShop = {
  event, buy, buyMod, redeem, readReceipt, addCoins, toast, renderShop, renderQuests, setName, cleanName, locked, price,
  coins: () => save.coins,
  owns: (id) => !locked(id),
  isMine,
  me: () => ({ id: save.me.id, name: save.me.name }),
  sold: (m) => (m && m.sale ? save.sales[m.sale.id] || 0 : 0),
  receipt: (id) => { const m = modOf(id); return m && m.sale ? save.receipts[saleKey(m)] || null : null; },
  onChange: (fn) => { listeners.push(fn); },
  killCoins: KILL_COINS,
  salePrices: SALE_PRICES,
  payPrefix: PAY_PREFIX,
  goods: () => GOODS.map((g) => ({ id: g.id, price: g.price, owned: save.owned.includes(g.id) })),
  quests: () => QUESTS.map((q) => Object.assign({ id: q.id, text: q.text, goal: q.n, coins: q.coins, repeat: !!q.repeat }, stateOf(q))),
  reset: () => { save = fresh(); persist(true); notify('owned'); },   // テスト用：はじめからにする
};
})();
