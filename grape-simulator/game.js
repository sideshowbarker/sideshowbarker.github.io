// グレープシミュレーター（ブラウザ版）のゲーム本体。index.html から読みこむ。
// 物理は Matter.js、音は sound.js。絵はぜんぶ、下にある文字のドット絵から作る。
(() => {
'use strict';
const { Engine, Composite, Bodies, Body, Constraint, Events, Vector, Vertices, Bounds } = Matter;
const byId = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));   // -π〜π にそろえる
const rand = (a, b) => a + Math.random() * (b - a);
const isTouch = matchMedia('(pointer: coarse)').matches;
const SND = window.GrapeSound ||
  { unlock() {}, play() {}, music() {}, engine() {}, setVolumes() {}, state: () => 'none', current: () => null };
// ショップとクエスト（shop.js）。無いときは、ぜんぶ買ってあることにして動く
const SHOP = window.GrapeShop ||
  { event() {}, owns: () => true, locked: () => false, price: () => 0, coins: () => 0, addCoins() {}, onChange() {}, killCoins: 0,
    renderShop() {}, renderQuests() {} };
const MODS = window.GrapeMods || null;   // モッド（mods.js）
// ことば（lang.js）。画面に出す言葉は tr() を通すと、英語のときは英語になる
const LANG = window.GrapeLang || { t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s), lang: () => 'ja',
                                   set() {}, apply() {}, onChange() {} };
const tr = LANG.t;

// ---- せってい（ブラウザに保存される） ----
const SETTINGS_KEY = 'grape-simulator-settings';
// 血の量、ケガのしやすさ、キャラの大きさ（はじめのズーム）、出てくる向き（0はランダム）、音楽、効果音、にじ色の血（ショップで買う）
const settings = { blood: 1, damage: 1, size: 1, facing: 0, music: 2, sfx: 1, rainbow: 0, tutorialSeen: 0, newsSeen: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* 保存できないブラウザでも動く */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 同上 */ } }
SND.setVolumes(settings.music, settings.sfx);

// ---- 設定（この数字をいじると遊びごこちが変わる） ----
const PX = 5;               // ドット1個の大きさ（世界の中の長さ）。画面にどう見えるかはカメラのズームで決まる
const STEP = 1000 / 60;     // 物理の1コマ（ミリ秒）
const SIZE_FACTOR = [0.26, 0.34, 0.44];   // はじめのズーム：キャラの背が、画面のたての何わりに見えるか
const ZOOM_MAX = 3;         // アップは、はじめのズームの何倍まで
const HURT = 8;             // ぶつかる速さがこれより遅いとノーダメージ（1コマに進む長さ）
const HURT_K = 0.25;        // ぶつかったときのダメージ =（速さ×速さ − HURT×HURT）× HURT_K
const SHOCK = 11, SHOCK_K = 0.35;   // 体全体がこれより速く地面に落ちると、胴体にもダメージ（高い所から落ちたとき）
const CUT = 2;              // 刃はこれより速く当たれば切れる
const CUT_K = 3.5;          // 刃のダメージ =（速さ − CUT）× CUT_K × 刃のするどさ
const PART_HP = { head: 70, torso: 100, arm: 40, leg: 55 };        // 部品ごとの体力
const PART_FACTOR = { head: 1, torso: 1, arm: 0.8, leg: 0.8 };     // ぶつかったときの痛さ
const SEVER = { head: 160, arm: 90, leg: 110 };                    // 関節がこれだけ傷つくと、とれる
const MUSCLE = { head: 0.6, torso: 1, arm: 0.35, leg: 0.9 };       // 立つ力（部品ごと）
const MAX_SPIN = 0.12;      // 立つ力だけで回せる速さの上限
// 関節の曲がる向きと大きさ（ラジアン）。右向きのキャラで、+ は時計回り（手足の先はうしろへ、頭はおじぎのほうへ）。
// 首は少しだけ、ひじは前にだけ、ひざはうしろにだけ曲がる。だから、なぐられても顔が一回転したり、ひざが逆に曲がったりしない
const JOINT_LIMITS = {
  neck: [-0.6, 0.8], shoulder: [-2.9, 1.1], elbow: [-2.6, 0.05], hip: [-2.1, 0.55], knee: [-0.05, 2.5],
};
const BLOOD_WEAK = 45, BLOOD_DEAD = 15;   // 血がこれより少ないとフラフラ、これより少ないと死ぬ
const WATER_DENSITY = 0.0024;             // 水の重さ。これより軽い物は浮く
const LAVA_DENSITY = 0.0032;              // 溶岩の重さ
const LAVA_DAMAGE = 0.7;                  // 溶岩の中で、1コマに部品が受けるダメージ
const VEHICLE_HIT = 1.8;                  // のりものにひかれたときは、この倍の速さでぶつかったことにする
const LINE_COLOR = '#1b1e23';

// ---- ドット絵 ----
// 1文字が1ドット。「.」は透明。
// キャラの色はキャラごとの pal で決める：D 輪郭、P 肌、p 肌のかげ、L つや、S シャツ、G/g へた（ロボはアンテナ）、
// E/e ロボの目、W ゾンビの白目、y つぶやもよう。どのキャラでも K は目と口、R はあざ。
const FRUIT_HEAD = [   // 頭（横顔。右向き。上の2行はへた、その下が 9×9 の四角）
  '....g....',
  '....GG...',
  '.DDDDDDD.',
  'DPPPPPPPD',
  'DPLPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  '.DDDDDDD.',
];
const STRAW_HEAD = [
  '..gGgGg..',
  '...GGG...',
  '.DDDDDDD.',
  'DPPyPPPPD',
  'DPLPPPyPD',
  'DPPPPPPPD',
  'DPyPPPPPD',
  'DPPPPPPPD',
  'DPPPyPPyD',
  '.DPPPPPD.',
  '..DDDDD..',
];
const ROBOT_HEAD = [
  '....g....',
  '....G....',
  'DDDDDDDDD',
  'DLLPPPPPD',
  'DLPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DpppppppD',
  'DDDDDDDDD',
];
const BANANA_HEAD = [   // 上の2行は、じく
  '......gG.',
  '.....GG..',
  '.DDDDDDD.',
  'DPPPPPPPD',
  'DPLLPPPPD',
  'DPLPPPyPD',
  'DPPPPPPPD',
  'DPyPPPPPD',
  'DPPPPPPPD',
  'DpPPPyPpD',
  '.DDDDDDD.',
];
const PINE_HEAD = [   // 上の2行は葉っぱ
  '.g.gGg.g.',
  '..gGGGg..',
  '.DDDDDDD.',
  'DPyPPPyPD',
  'DLPyPyPPD',
  'DPPPyPPyD',
  'DPPyPyPPD',
  'DPyPPPyPD',
  'DyPPPPPyD',
  'DPyPPPyPD',
  '.DDDDDDD.',
];
const ZOMBIE_HEAD = [   // 上の2行はかみの毛。y はぬいあと
  '..g.g.g..',
  '.gGgGgGg.',
  '.DDDDDDD.',
  'DPPPPPPPD',
  'DPLPPPPPD',
  'DPPPPPPPD',
  'DPyPPPPPD',
  'DPPyPPPPD',
  'DPyPPPPPD',
  'DPPPPPPPD',
  '.DDDDDDD.',
];
// 顔のドット [四角の中の行, 列, 色]。元気・ケガ・気絶・死んだ、の4種類。
const FRUIT_FACES = {
  ok:   [[3, 6, 'K'], [5, 6, 'K'], [5, 7, 'K']],
  hurt: [[3, 6, 'K'], [6, 6, 'K'], [6, 7, 'K'], [2, 5, 'R'], [1, 5, 'R']],
  ko:   [[3, 5, 'K'], [3, 6, 'K'], [3, 7, 'K'], [6, 6, 'K']],
  dead: [[2, 5, 'K'], [2, 7, 'K'], [3, 6, 'K'], [4, 5, 'K'], [4, 7, 'K'], [5, 6, 'K'], [5, 7, 'K'], [6, 6, 'K'], [6, 7, 'K']],
};
const ROBOT_FACES = {
  ok:   [[3, 6, 'E'], [3, 7, 'E'], [6, 5, 'K'], [6, 6, 'K'], [6, 7, 'K']],
  hurt: [[3, 6, 'e'], [3, 7, 'e'], [6, 5, 'K'], [6, 7, 'K'], [1, 3, 'K'], [2, 4, 'K'], [3, 4, 'K']],
  ko:   [[3, 6, 'K'], [3, 7, 'K'], [6, 5, 'K'], [6, 6, 'K'], [6, 7, 'K']],
  dead: [[2, 5, 'K'], [2, 7, 'K'], [3, 6, 'K'], [4, 5, 'K'], [4, 7, 'K'], [6, 5, 'K'], [6, 6, 'K'], [6, 7, 'K']],
};
const ZOMBIE_FACES = {
  ok:   [[3, 6, 'W'], [3, 7, 'K'], [6, 5, 'K'], [6, 6, 'W'], [6, 7, 'K']],
  hurt: [[3, 6, 'W'], [3, 7, 'K'], [2, 5, 'R'], [6, 5, 'K'], [6, 7, 'K']],
  ko:   [[3, 5, 'K'], [3, 6, 'K'], [3, 7, 'K'], [6, 6, 'K']],
  dead: [[2, 5, 'K'], [2, 7, 'K'], [3, 6, 'K'], [4, 5, 'K'], [4, 7, 'K'], [5, 6, 'K'], [5, 7, 'K'], [6, 6, 'K'], [6, 7, 'K']],
};
const NO_FACES = { ok: [], hurt: [], ko: [], dead: [] };
const TORSO = ['.DD.'].concat(Array(6).fill('DSSD'), Array(3).fill('DPPD'), ['.DD.']);
const ARM = Array(7).fill('PP');
const LEG_UPPER = Array(8).fill('PP');
const LEG_LOWER = Array(7).fill('PP.').concat(['PPP']);   // 最後の行が足（前に出っぱる）
const SUMO_HEAD = [   // 力士の頭（ちょんまげ）
  '....g....',
  '...gGg...',
  '.DGGGGGD.',
  'DPPPPPPPD',
  'DPLPPPPPD',
  'DPPPPPPPD',
  'DppPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DpPPPPPpD',
  '.DDDDDDD.',
];
const ROBOSUMO_HEAD = [   // ロボ力士の頭
  '...gGg...',
  '....G....',
  'DDDDDDDDD',
  'DLLPPPPPD',
  'DLPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DPPPPPPPD',
  'DpppppppD',
  'DDDDDDDDD',
];
const TORSO_SUMO = [   // 力士の胴体（12ドットはば。下の3行がまわし）
  '.DDDDDDDDDD.',
  'DPLPPPPPPPpD',
  'DPPPPPPPPPpD',
  'DPPPPPPPPPpD',
  'DPPPPPPPpppD',
  'DPPPPPPPPPpD',
  'DPPPPPPPPPpD',
  'DSSSSSSSSSSD',
  'DSSyySSSSSSD',
  'DSSSSSSSSSSD',
  '.DDDDDDDDDD.',
];
const ARM_SUMO = Array(7).fill('PPP');
const LEG3_UPPER = Array(8).fill('PPPP');
const LEG3_LOWER = Array(7).fill('PPPP.').concat(['PPPPP']);
const BUILD_SUMO = { torso: TORSO_SUMO, arm: ARM_SUMO, legU: LEG3_UPPER, legL: LEG3_LOWER };   // 力士の体のドット絵
const CHAR_COMMON = { K: '#111111', R: '#c0324a' };

// 物のドット絵。色は OBJ_PAL。どれも右向きにかいてある（左向きのときは左右反転する）
const OBJ_PAL = {
  K: '#111111',                                  // 黒い輪郭
  h: '#9c6b3f', H: '#6b4a2b',                    // 木の柄
  W: '#e8eef2', w: '#9aa6b1',                    // 刃
  k: '#4a4a66', j: '#23232f',                    // 刀の柄
  y: '#e0b030',                                  // 金色
  O: '#c98b4a', o: '#8b5a2b', d: '#3b2412',      // 木箱
  g: '#3a3f47', G: '#6b737e', s: '#a9b2bd',      // 鉄（こい・ふつう・うすい）
  r: '#d23a2a', R: '#8e1f16',                    // 赤
  b: '#262626', B: '#5a5a5a',                    // 爆弾
  f: '#e8dcb0',                                  // 導火線
  c: '#9fd6f0',                                  // 窓ガラス
  u: '#3c7dd9', U: '#24508f',                    // 青いペンキ
  m: '#8c96a3', M: '#5f6873',                    // ドラム缶
  e: '#58c26a',                                  // 注射の薬
  n: '#d0d6dc',                                  // 注射の針
  l: '#ffe070',                                  // ライト
  q: '#ff5040',                                  // うしろのライト
  v: '#6b7a3a', V: '#4a5628', x: '#8e9e52',      // 戦車の緑
  a: '#e8762a', A: '#b0521a',                    // オレンジ（チェーンソー）
  p: '#a04ad0', t: '#4aa8ff', z: '#3d5c14', i: '#8e0b22',   // 注射の薬：どく、ますい、ゾンビ、ちをぬく
};
const KNIFE = [   // 右が刃先。左の4ドットが柄、右の8ドットが刃
  'hhhhWWWWWWW.',
  'HHHHWWWWWWWW',
  'hhhhwwwwwww.',
];
const KATANA = [   // 左の5ドットが柄、つば、右の16ドットが刃
  'kjkjkyWWWWWWWWWWWWWWW.',
  'jkjkjyWWWWWWWWWWWWWWWW',
  'kjkjkywwwwwwwwwwwwwww.',
];
const HAMMER = [   // 右の4ドットが重い頭
  '..........GGGG',
  '..........GsGG',
  'hhhhhhhhhhGGGG',
  'HHHHHHHHHHGGGG',
  '..........GGgG',
  '..........gggg',
];
const PISTOL = [
  '.ggggggggg.',
  'gGGGGGGGGGs',
  'ggggggggggg',
  '..ggg.g....',
  '..ggg......',
  '..hhh......',
];
const MGUN = [
  '.....gggggg.........',
  'ggggGGGGGGGGGGGGGGGs',
  'gGGGGGGGGGGGGGGGGGGs',
  'hhhhgggggggggggg....',
  'hhh..gggg...........',
  '......gg............',
];
const BOMB = [
  '......f..',
  '.....f...',
  '....BB...',
  '..bbbbb..',
  '.bbBbbbb.',
  'bbBBbbbbb',
  'bbBbbbbbb',
  'bbbbbbbbb',
  'bbbbbbbbb',
  '.bbbbbbb.',
  '..bbbbb..',
];
const TNT = [
  '.KKKKKK.',
  'KrrrrrrK',
  'KrRrrrrK',
  'KyKyyKyK',
  'KyyKKyyK',
  'KyKyyKyK',
  'KrRrrrrK',
  'KrRrrrrK',
  'KrrrrrrK',
  '.KKKKKK.',
];
const BARREL = [
  '.KKKKKK.',
  'KmmmmmsK',
  'KMmmmmmK',
  'KKKKKKKK',
  'KMmmmmsK',
  'KMmmmmsK',
  'KMmmmmsK',
  'KKKKKKKK',
  'KMmmmmsK',
  'KMmmmmmK',
  '.KKKKKK.',
];
const BAT = [
  '.........hhhhhhhhhhhhh',
  'hhhhhhhhhhhhhhhhhhhhhh',
  'HHHHHHHHHHHHHHHHHHHHHH',
  '.........HHHHHHHHHHHHH',
];
const CLEAVER = [
  '....wWWWWWW.',
  '....WWWWWWWW',
  'hhhhWWWWWWWW',
  'HHHHWWWWWWWW',
  '....WWWWWWWW',
  '....wwwwwww.',
];
const PAN = [
  '.........ggGGGGgg.',
  '........gGGGGGGGGg',
  'hhhhhhhhgGGGsGGGGg',
  'HHHHHHHHgGGGGGGGGg',
  '........gGGGGGGGGg',
  '.........ggGGGGgg.',
];
const SHOTGUN = [
  '.......gggggggggggggggg.',
  'hhhhhhGGGGGGGGGGGGGGGGGs',
  'hhhhhhggggggggHHHHHHgggg',
  '..hhhhgggg..............',
  '...hh...................',
];
const DYNAMITE = [
  '...f.',
  '..f..',
  '.KKK.',
  'KrrrK',
  'KrRrK',
  'KyyyK',
  'KyKyK',
  'KyyyK',
  'KrRrK',
  'KrrrK',
  '.KKK.',
];
const MOLOTOV = [
  '..qy..',
  '..fq..',
  '..KK..',
  '.KccK.',
  '.KccK.',
  'KccccK',
  'KcaaaK',
  'KaaaaK',
  'KaaaaK',
  'KaaaaK',
  '.KKKK.',
];
const STONE = [
  '.KKKKKKKKKK.',
  'KsssGGGGGGgK',
  'KsGGGGGGGGgK',
  'KGGGgGGGGGgK',
  'KGGGGGGGGggK',
  'KGGGGGGgGGgK',
  'KGGGGGGGGggK',
  'KGgGGGGGGgGK',
  '.KKKKKKKKKK.',
];
const ANVIL = [
  'KKKKKKKKKKKKKKKK',
  'KsssGGGGGGGGGGGK',
  'KGGGGGGGGGGGGGGK',
  '...KGGGGGGGGK...',
  '...KgGGGGGGgK...',
  '...KgGGGGGGgK...',
  '..KGGGGGGGGGGK..',
  '.KGGGGGGGGGGGGK.',
  '.KKKKKKKKKKKKKK.',
];
const CLUB = [
  '...........HHHHHHHHHH.',
  '..........hhhhhhhhhhhh',
  'hhhhhhhhhhhhhhhhhhhhhh',
  'HHHHHHHHHHHHHHHHHHHHHH',
  '..........hhhhhhhhhhhh',
  '...........HHHHHHHHHH.',
];
const SWORD = [
  '.....y........................',
  'kjkjkyWWWWWWWWWWWWWWWWWWWWWWWW',
  'jkjkjyWWWWWWWWWWWWWWWWWWWWWWWW',
  'kjkjkywwwwwwwwwwwwwwwwwwwwwww.',
  '.....y........................',
];
const SLEDGE = [
  '....................GGGGGGGG',
  '....................GsGGGGGG',
  '....................GGGGGGGg',
  'hhhhhhhhhhhhhhhhhhhhGGGGGGgg',
  'hhhhhhhhhhhhhhhhhhhhGGGGGGgg',
  'HHHHHHHHHHHHHHHHHHHHGGGGGGGg',
  'HHHHHHHHHHHHHHHHHHHHGGGGGGGg',
  '....................GGGGGGGG',
  '....................GGGGGGgg',
  '....................gggggggg',
];
const SNIPER = [
  '.........gGGGg....................',
  'gggggggggggggggggggggggggggggggggs',
  'hhhhhhhGGGGGGGGGGGGGGGGGGGGGGGGGG.',
  'hhhhgggggggg......................',
  '...hh.............................',
];
const FLAME = [
  '.rrrrrrr..............',
  'rrRrrrrr..............',
  'rrRrrrrrgggggggggg....',
  'rrRrrrrrGGGGGGGGGGGGGG',
  'rrRrrrrrgggggggggggggy',
  'rrRrrrrr..............',
  'rrrrrrrr..............',
  '.rrrrrr...............',
];
const MINE = [
  '...KKKKKK...',
  '..KgGGGGgK..',
  '.KGGGrGGGGK.',
  'KKKKKKKKKKKK',
];
const TV = [
  '..K......K....',
  '...K....K.....',
  'KKKKKKKKKKKKKK',
  'KGGGGGGGGGGGGK',
  'KGKcWccccccKGK',
  'KGKccccccccKGK',
  'KGKccccccccKGK',
  'KGKccccccccKGK',
  'KGKccccccccKGK',
  'KGGGGGGGGGGGGK',
  '.KK........KK.',
];
const DUMBBELL = [
  '.GGGG............GGGG.',
  'GgGGGG..........GGGGgG',
  'GgGGGG..........GGGGgG',
  'GgGGGGssssssssssGGGGgG',
  'GgGGGGssssssssssGGGGgG',
  'GgGGGG..........GGGGgG',
  'GgGGGG..........GGGGgG',
  '.GGGG............GGGG.',
];
const SYRINGE = [   // 右が針
  'K..KKKKKKKK...',
  'KKKKeeeeeeKnnn',
  'K..KKKKKKKK...',
];
const AXE = [   // 右はしが、おのの頭（上が刃）
  '.........wwww.',
  '........wWWWWw',
  '........WWWWW.',
  '.........WWWG.',
  'hhhhhhhhhGGGGG',
  'HHHHHHHHHGGGGG',
  '..........ggg.',
];
const SPEAR = [   // 右の6ドットが、とがった先
  '....................GWW...',
  'hhhhhhhhhhhhhhhhhhhhGWWWWW',
  '....................Gww...',
];
const CHAINSAW = [   // 左がエンジン、右が刃（チェーンが回る）
  '..KKKKKK..................',
  '.K......K.................',
  'KaaaaaaaaK................',
  'KaaaaaaaaKsgsgsgsgsgsgsgs.',
  'KaAaaaaaaKGGGGGGGGGGGGGGGs',
  'KaaaaaaaaKgsgsgsgsgsgsgsg.',
  'KAAAAAAAAK................',
  '.KKKKKKKK.................',
];
const CHAINSAW_2 = [   // チェーンが1ドット進んだ絵（交互に出して、回って見せる）
  '..KKKKKK..................',
  '.K......K.................',
  'KaaaaaaaaK................',
  'KaaaaaaaaKgsgsgsgsgsgsgsg.',
  'KaAaaaaaaKGGGGGGGGGGGGGGGs',
  'KaaaaaaaaKsgsgsgsgsgsgsgs.',
  'KAAAAAAAAK................',
  '.KKKKKKKK.................',
];
const GRENADE = [   // 左上の輪がピン
  '.ss....',
  's..sgg.',
  '.ssgGGg',
  '..vvvv.',
  '.vxvvvV',
  '.vvvvvV',
  '.vxvvvV',
  '.vvvvvV',
  '..VVVV.',
];
const GRENADE_LIT = [   // ピンをぬいた後
  '.......',
  '....gg.',
  '...gGGg',
  '..vvvv.',
  '.vxvvvV',
  '.vvvvvV',
  '.vxvvvV',
  '.vvvvvV',
  '..VVVV.',
];
const LAUNCHER = [   // ロケットランチャー（右が前）
  '.....gGg................',
  'gvvvvvvvvvvvvvvvvvvvvvvg',
  'gvxvvvvvvvvvvvvvvvvvvvvg',
  'gVVVVVVVVVVVVVVVVVVVVVVg',
  '.......gg..gg...........',
  '.......gg...............',
];
const ROCKET = [   // 飛んでいくロケット（右が前）
  'gg..........',
  'gGsssssssrrr',
  'gg..........',
];
const TRAMPOLINE = [   // 上の2行がマット
  'GGuuuuuuuuuuuuuuuuuuuuGG',
  'gGUUUUUUUUUUUUUUUUUUUUGg',
  '.gG..................Gg.',
  '.gG..................Gg.',
  '.gG..................Gg.',
  'gggg................gggg',
];
const BALLOON = [   // 下が、ひもの結び目。r と R の色を変えて5色作る
  '..KKK..',
  '.KrrrK.',
  'KrWrrrK',
  'KrrrrrK',
  'KrrrrrK',
  'KrrrrrK',
  '.KrrrK.',
  '..KRK..',
  '...K...',
];
const CAR = [   // 車（右が前。タイヤは別にかく。窓は CAR_GLASS で、すけて見える）
  '......................................................................',
  '...............KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK.....................',
  '..............KrrKKKKKKKKKKKKKKKKrrrKKKKKKKKKKKKrK....................',
  '..............KrK................KrK............KrK...................',
  '.............KrrK................KrK.............KrK..................',
  '............KrrK.................KrK.............KrrK.................',
  '............KrK..................KrK..............KrrK................',
  '...........KrrK..................KrK...............KrrK...............',
  '...........KrK...................KrK................KrrK..............',
  '..........KrK....................KrK.................KrrK.............',
  '.........KrrK....................KrK..................KrK.............',
  '.........KrK.....................KrK...................KrK............',
  '........KrrK.....................KrK....................KrK...........',
  '........KrK......................KrK....................KrrK..........',
  '....KKKKrrrKKKKKKKKKKKKKKKKKKKKKKrrrKKKKKKKKKKKKKKKKKKKKrrrrKKK.......',
  '.KKKrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrrrrrrrrrrrrKK.....',
  '.KrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrKKK..',
  '.KqqrrrrrrrrrrrrrrrrrrrrrrKKKKrrrrRrrrrrrrrrrrKKKKrrrrrrrrrrrrrrrrrrK.',
  '.KqqrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrllK.',
  '.KqqrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrllK.',
  '.KrrrrrrrrrrrKKKrrrrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrrrrKKKrrrrrrrrllK.',
  '.KrrrrrrrrKKK...KKKrrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrrKKK...KKKrrrrrrrK.',
  '.KrrrrrrrK.........KrrrrrrrrrrrrrrRrrrrrrrrrrrrrrrrK.........KrrrrrrK.',
  '.KrrrrrrK...........KrrrrrrrrrrrrrRrrrrrrrrrrrrrrrK...........KrrrrrK.',
  '.KrrrrrK.............KrrrrrrrrrrrrRrrrrrrrrrrrrrrK.............KrrrrK.',
  '.KrrrrK...............KrrrrrrrrrrrRrrrrrrrrrrrrrK...............KrrrK.',
  '.KRRRRK...............KRRRRRRRRRRRRRRRRRRRRRRRRRK...............KRRRK.',
  '.KRRRRK...............KRRRRRRRRRRRRRRRRRRRRRRRRRK...............KRRRK.',
  '.KKKKK.................KKKKKKKKKKKKKKKKKKKKKKKKK.................KKKK.',
  '......................................................................',
];
const CAR_GLASS = [   // 車の窓ガラス
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '.................cccccccccccccccc...cccccccccccc......................',
  '.................cccccccccccccccc...ccccccccccccc.....................',
  '................ccccccccccccccccc...ccccccccccccc.....................',
  '...............cccccccccccccccccc...cccccccccccccc....................',
  '...............cccccccccccccccccc...ccccccccccccccc...................',
  '..............ccccccccccccccccccc...cccccccccccccccc..................',
  '.............cccccccccccccccccccc...ccccccccccccccccc.................',
  '.............cccccccccccccccccccc...cccccccccccccccccc................',
  '............ccccccccccccccccccccc...ccccccccccccccccccc...............',
  '............ccccccccccccccccccccc...cccccccccccccccccccc..............',
  '...........cccccccccccccccccccccc...cccccccccccccccccccc..............',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
  '......................................................................',
];
const TRUCK = [   // トラック（うしろが荷台、前が運転席）
  '................................................................................................',
  '................................................................................................',
  '................................................................KKKKKKKKKKKKKKKKKKKKKK..........',
  '................................................................KuuuuKKKKKKKKKKKKKKKuuK.........',
  '................................................................KuuuK...............KuuK........',
  '................................................................KuuuK................KuK........',
  '................................................................KuuuK.................KuK.......',
  '................................................................KuuuK.................KuuK......',
  '................................................................KuuuK..................KuK......',
  '................................................................KuuuK..................KuuK.....',
  '................................................................KuuuK...................KuuK....',
  '................................................................KuuuK....................KuuK...',
  '................................................................KuuuK....................KuuK...',
  '................................................................KuuuK.....................KuuK..',
  '.KKK........................................................KKKKuuuuK......................KuuK.',
  '.KMK........................................................KMMMuuuuuKKKKKKKKKKKKKKKKKKKKKKuuuK.',
  '.KMK........................................................KMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuK.',
  '.KMK........................................................KMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuK.',
  '.KMK........................................................KMMMuuuuuuuuuuuuuuuKKKKuuuuuuuuuuuK.',
  '.KMK........................................................KMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuK.',
  '.KMK........................................................KMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuullK.',
  '.KMMKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKMMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuullK.',
  '.KqqmMMMMMMmMMMMMMmMMMMMMmMMMMMMmMMMMMMmMMMMMMmMMMMMMmMMMMMMMMMMuuuuuuuuuuuuuuuuuuuuuuuuuuuullK.',
  '.KqqmMMMMMMmKKKKKKmKMMMMMmMMMMMMmMMMMKKmKKKKKKmMMMMMMmMMMMMMMMMMuuuuuuuuuuuuuuuKKKKKKKKKuuuuuuK.',
  '.KqqmMMMMKKm......m.KKMMMmMMMMMMmMMKK..m......mKMMMMMmMMMMMMMMMMuuuuuuuuuuuuuKK.........KKuuuuK.',
  '.KMMmMMMK..m......m...KMMmMMMMMMmMK....m......m.KMMMMmMMMMMMMMMMuuuuuuuuuuuuK.............KuuuK.',
  '.KMMmMMMK..m......m...KMMmMMMMMMmMK....m......m.KMMMMmMMMMMMMMMMuuuuuuuuuuuuK.............KuuuK.',
  '.KKKMMMK...............KMMMMMMMMMK...............KMMMMMMMMMMMMMMuuuuuuuuuuuK...............KuuK.',
  '....KgK.................KgggggggK.................KggggggggggggguUUUUUUUUUK.................KUK.',
  '....KKK.................KKKKKKKKK.................KKKKKKKKKKKKKKuUUUUUUUUUK.................KUK.',
  '................................................................KKKKKKKKKKK.................KKK.',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
];
const TRUCK_GLASS = [   // トラックの窓ガラス
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '.....................................................................ccccccccccccccc............',
  '.....................................................................cccccccccccccccc...........',
  '.....................................................................ccccccccccccccccc..........',
  '.....................................................................ccccccccccccccccc..........',
  '.....................................................................cccccccccccccccccc.........',
  '.....................................................................cccccccccccccccccc.........',
  '.....................................................................ccccccccccccccccccc........',
  '.....................................................................cccccccccccccccccccc.......',
  '.....................................................................cccccccccccccccccccc.......',
  '.....................................................................ccccccccccccccccccccc......',
  '.....................................................................cccccccccccccccccccccc.....',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
  '................................................................................................',
];
const BIKE = [   // バイク
  '............................................',
  '.............................KKKKKK.........',
  '.............................KKKbbK.........',
  '................................KK..........',
  '......KKKKKKKKKKKKKKK............KKKKK......',
  '....KKqKbbbbbbbbbbbbbKKKKKKKKK...KlllK......',
  '....KKK.KKKKbbKKKKKbbrqqqqqqrrK..KlllK......',
  '............KK.....KrrrrrrrrrrK...KlKK......',
  '...........KGK......KrrrrrKKrrKK..KK........',
  '...........KK.......KrrrrK..KK....KK........',
  '..........KGK..KKKKKggggggKK.KKK..KsK.......',
  '..........KK...KgGGGGGGGGGgK..KKK..KK.......',
  '.........KGK...KgGGGGGGGGGgK....KKKsK.......',
  '..KKKK...KK....KgGGGGGGGGGgK.....KGssK......',
  '..KKKKKKKssKKKKssGGGGGGGGGgK......KKsK......',
  '........KGGKK..KKKKKKKKKKKKK........KsK.....',
  '........KKK.........................KKKK....',
  '............................................',
  '............................................',
  '............................................',
  '............................................',
  '............................................',
];
const TANK = [   // 戦車（右の長いのが大砲。上のでっぱりがハッチ）
  '........................................................................................',
  '........................................................................................',
  '...................................KKKKKKKKKKK..........................................',
  '...................................KVVVVVVVVVK..........................................',
  '...........................KKKKKKKKVVVVVVVVVVVKKKKKKKKK.................................',
  '..........................KvxxxxxxxxxxxxxxxxxxxxxxxxxxxK................................',
  '..........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvK............................KKKK',
  '..........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvK..KKKKKKKKKKKKKKKKKKKKKKKKKKVVVK',
  '.........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK.KVVVVVVVVVVVVVVVVVVVVVVVVVVVVK',
  '.........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK.KKKKKKKKKKKKKKKKKKKKKKKKKKVVVK',
  '.........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK...........................KKKK',
  '........................KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK..............................',
  '..........KKKKKKKKKKKKKKvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvKKKKKKKKKKKKKKKKKK............',
  '.........KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK...........',
  '........KvvvxxvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvxxvvvvvK..........',
  '.......KvvvvxxvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvxxvvvvvvK.........',
  '......KvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvK........',
  '.....KVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVKKK.....',
  '....KVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVK.....',
  '.....KVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVKK.....',
  '....KbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbK.......',
  '...KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK......',
  '..KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK.....',
  '..KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK....',
  '...KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK.....',
  '....KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK......',
  '....KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK......',
  '.....KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbK.......',
  '......KKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBKKKBK........',
  '........................................................................................',
  '........................................................................................',
];

function makeSprite(rows, pal) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = rows[j][i];
      if (ch === '.') continue;
      x.fillStyle = pal[ch];
      x.fillRect(i, j, 1, 1);
    }
  }
  return c;
}
// まるい物の絵を、ドットごとに色を決めて作る（ボール・鉄球・タイヤ）
function circleSprite(d, colorAt) {
  const c = document.createElement('canvas');
  c.width = d; c.height = d;
  const x = c.getContext('2d');
  const r = d / 2;
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < d; i++) {
      const dx = i + 0.5 - r, dy = j + 0.5 - r, dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      const col = colorAt(dx, dy, dist, r);
      if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); }
    }
  }
  return c;
}
const wheelSprite = (d) => circleSprite(d, (dx, dy, dist, r) => {
  if (dist > r - 0.8) return '#0c0c0c';
  if (dist > r * 0.55) return '#262626';
  if (Math.abs(dx) < 0.6 && dy < 0) return '#d8dde2';   // 回っているのが見えるように、1本だけ明るい線
  return '#8a8f96';
});
function withFace(rows, pixels) {
  const a = rows.map((r) => r.split(''));
  for (const [r, c, ch] of pixels) a[r + 2][c] = ch;   // +2 はへた（アンテナ）の分
  return a.map((r) => r.join(''));
}
const shade = (rows) => rows.map((r) => r.replace(/P/g, 'p'));
function makeCharSprites(ch) {
  const p = Object.assign({}, CHAR_COMMON, ch.pal), bd = ch.build || {};
  return {
    head_ok: makeSprite(withFace(ch.head, ch.faces.ok), p),
    head_hurt: makeSprite(withFace(ch.head, ch.faces.hurt), p),
    head_ko: makeSprite(withFace(ch.head, ch.faces.ko), p),
    head_dead: makeSprite(withFace(ch.head, ch.faces.dead), p),
    torso: makeSprite(bd.torso || TORSO, p),
    armF: makeSprite(bd.arm || ARM, p), armB: makeSprite(shade(bd.arm || ARM), p),
    legUF: makeSprite(bd.legU || LEG_UPPER, p), legUB: makeSprite(shade(bd.legU || LEG_UPPER), p),
    legLF: makeSprite(bd.legL || LEG_LOWER, p), legLB: makeSprite(shade(bd.legL || LEG_LOWER), p),
  };
}

// ---- キャラクター ----
// 体はみんな同じ形で、頭と色がちがう。tough は丈夫さ（体力が何倍か）、density は重さ、blood/stain は血と床のシミの色。
// undead は、死んでも頭がついていれば起き上がる（ゾンビ）。ショップで買うキャラは、shop.js に値段が書いてある。
const CHARS = {
  grape: { name: 'ブドウ', head: FRUIT_HEAD, faces: FRUIT_FACES, density: 0.002,
           blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
           pal: { D: '#2e1442', P: '#8a4bbf', p: '#5e2f86', L: '#b98be0', S: '#5cb85c', G: '#5cb85c', g: '#2f7a2f' } },
  muscat: { name: 'マスカット', head: FRUIT_HEAD, faces: FRUIT_FACES, density: 0.002,
            blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
            pal: { D: '#2f5a1a', P: '#a9d95f', p: '#7cae3c', L: '#dff7b0', S: '#4a90d9', G: '#5cb85c', g: '#2f7a2f' } },
  strawberry: { name: 'イチゴ', head: STRAW_HEAD, faces: FRUIT_FACES, density: 0.002,
                blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
                pal: { D: '#6b0f1a', P: '#e8364a', p: '#b52436', L: '#ff8a96', S: '#f0a030', G: '#5cb85c', g: '#2f7a2f',
                       y: '#ffe070' } },
  robot: { name: 'ロボ', head: ROBOT_HEAD, faces: ROBOT_FACES, tough: 2, density: 0.004, sparks: true, bleedRate: 0.5,
           blood: '#2a2a2a', stain: '#161616', hurtTint: '20, 20, 20',   // 血のかわりにオイル
           pal: { D: '#1f2328', P: '#9aa3ad', p: '#6f7780', L: '#d5dbe1', S: '#3c7dd9', G: '#c9ced4', g: '#e23b3b',
                  E: '#39e6ff', e: '#ff8a1f' } },
  banana: { name: 'バナナ', head: BANANA_HEAD, faces: FRUIT_FACES, density: 0.002,
            blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
            pal: { D: '#5c4a0c', P: '#f5d33a', p: '#c9a21e', L: '#fff6b0', S: '#e8762a', G: '#6b4a2b', g: '#3b2412', y: '#8b5a2b' } },
  pineapple: { name: 'パイナップル', head: PINE_HEAD, faces: FRUIT_FACES, tough: 1.5, density: 0.0025,
               blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
               pal: { D: '#6b3f10', P: '#e8a820', p: '#b07a10', L: '#ffe070', S: '#2f7a8f', G: '#5cb85c', g: '#2f7a2f', y: '#9a5f10' } },
  zombie: { name: 'ゾンビ', head: ZOMBIE_HEAD, faces: ZOMBIE_FACES, undead: true, behavior: 'attack', speed: 1.5, power: 1, density: 0.002, bleedRate: 0.4,
            blood: '#6a9a2a', stain: '#3d5c14', hurtTint: '70, 120, 30',   // 血は緑
            pal: { D: '#23361a', P: '#8fb870', p: '#6a8f52', L: '#b8d8a0', S: '#6b5a8a', G: '#3a2a1a', g: '#1f160c', y: '#3d2f24',
                   W: '#f0f0d0' } },
  sumo: { name: '力士', zombieOf: 'zombiesumo', head: SUMO_HEAD, faces: FRUIT_FACES, tough: 2.5, density: 0.004, build: BUILD_SUMO, noClothes: true,
          body: { torso: [12, 11], arm: [3, 7], leg: [4, 8], armX: 1.5, legX: 2.2 },
          anchor: { torso: [6, 5.5], armF: [1.5, 3.5], armB: [1.5, 3.5], legUF: [2, 4], legUB: [2, 4], legLF: [2, 4], legLB: [2, 4] },
          fig: { w: 15, head: [3, 0], torso: [1, 11], armB: [4, 12], armF: [7, 12], legUB: [3, 21], legUF: [7, 21] },
          note: 'おもくて、とてもじょうぶ。なかなか たおれない',
          blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
          pal: { D: '#5a3320', P: '#f0c08e', p: '#d09868', L: '#ffe0bc', S: '#2a3f8f', G: '#141414', g: '#000000', y: '#e0b030' } },
  robosumo: { name: 'ロボ力士', head: ROBOSUMO_HEAD, faces: ROBOT_FACES, tough: 4, density: 0.007, sparks: true, bleedRate: 0.3, build: BUILD_SUMO,
              noClothes: true, body: { torso: [12, 11], arm: [3, 7], leg: [4, 8], armX: 1.5, legX: 2.2 },
              anchor: { torso: [6, 5.5], armF: [1.5, 3.5], armB: [1.5, 3.5], legUF: [2, 4], legUB: [2, 4], legLF: [2, 4], legLB: [2, 4] },
              fig: { w: 15, head: [3, 0], torso: [1, 11], armB: [4, 12], armF: [7, 12], legUB: [3, 21], legUF: [7, 21] },
              note: 'ものすごく重くて、じょうぶな ロボ。注射も刃もきかない',
              blood: '#2a2a2a', stain: '#161616', hurtTint: '20, 20, 20',
              pal: { D: '#1f2328', P: '#9aa3ad', p: '#6f7780', L: '#d5dbe1', S: '#c23a2a', G: '#c9ced4', g: '#e23b3b', y: '#e0b030', E: '#39e6ff', e: '#ff8a1f' } },
  watermelon: { name: 'すいか', head: STRAW_HEAD, faces: FRUIT_FACES, tough: 1.3, density: 0.0025, note: 'すこし丈夫で、ちょっと重い',
                blood: '#e23b5a', stain: '#a8203a', hurtTint: '226, 59, 90',
                pal: { D: '#1f4a1a', P: '#4fae4a', p: '#2e7a2c', L: '#a8e0a0', S: '#e23b5a', G: '#2f7a2f', g: '#1b5a1b', y: '#1f5a1c' } },
  peach: { name: 'もも', head: FRUIT_HEAD, faces: FRUIT_FACES, density: 0.0018, note: 'かるくて、やわらかい',
           blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
           pal: { D: '#7a2e48', P: '#ffb0c0', p: '#e08098', L: '#ffe0e8', S: '#7ac36a', G: '#5cb85c', g: '#2f7a2f' } },
  lemon: { name: 'レモン', head: BANANA_HEAD, faces: FRUIT_FACES, density: 0.002, note: 'すっぱい顔のふつうの人',
           blood: '#d0182e', stain: '#8e0b22', hurtTint: '200, 20, 40',
           pal: { D: '#6b5a0a', P: '#fff04a', p: '#d4c020', L: '#fffbb0', S: '#f0f0f0', G: '#6b4a2b', g: '#3b2412', y: '#c8a810' } },
  blueberry: { name: 'ブルーベリー', head: FRUIT_HEAD, faces: FRUIT_FACES, density: 0.0016, note: 'とても軽い。すぐ飛んでいく',
               blood: '#4a5fd0', stain: '#2f3fa0', hurtTint: '74, 95, 208',
               pal: { D: '#141a4a', P: '#4a5fd0', p: '#2f3fa0', L: '#9fb0ff', S: '#e8e8e8', G: '#5cb85c', g: '#2f7a2f' } },
  zombiesumo: { name: 'ゾンビ力士', head: SUMO_HEAD, faces: ZOMBIE_FACES, undead: true, behavior: 'attack', speed: 1, power: 2.5, tough: 2.5, density: 0.004, bleedRate: 0.4, build: BUILD_SUMO, noClothes: true, hidden: true,
                body: { torso: [12, 11], arm: [3, 7], leg: [4, 8], armX: 1.5, legX: 2.2 },
                anchor: { torso: [6, 5.5], armF: [1.5, 3.5], armB: [1.5, 3.5], legUF: [2, 4], legUB: [2, 4], legLF: [2, 4], legLB: [2, 4] },
                fig: { w: 15, head: [3, 0], torso: [1, 11], armB: [4, 12], armF: [7, 12], legUB: [3, 21], legUF: [7, 21] },
                note: 'ゾンビになった力士。死んでも起き上がる',
                blood: '#6a9a2a', stain: '#3d5c14', hurtTint: '70, 120, 30',
                pal: { D: '#23361a', P: '#8fb870', p: '#6a8f52', L: '#b8d8a0', S: '#6b5a8a', G: '#1f160c', g: '#000000', y: '#3d2f24', W: '#f0f0d0' } },
  goldrobot: { name: 'ゴールドロボ', head: ROBOT_HEAD, faces: ROBOT_FACES, tough: 3, density: 0.005, sparks: true, bleedRate: 0.3,
               blood: '#2a2a2a', stain: '#161616', hurtTint: '20, 20, 20',
               pal: { D: '#5a4210', P: '#f0c030', p: '#b8901e', L: '#fff3a8', S: '#d23a2a', G: '#fff3a8', g: '#e23b3b',
                      E: '#39e6ff', e: '#ff8a1f' } },
};

// 体のつくり（ドット）。ドット絵の大きさと合わせてある
const GLOBAL_BODY = { head: 9, neck: 0.5, torso: [4, 11], arm: [2, 7], leg: [2, 8], shoulder: 1.2, hip: 0.8, armX: 0.6, legX: 1 };
const BODY = GLOBAL_BODY;
const FOOT_BELOW_HEAD = BODY.head / 2 + BODY.neck + BODY.torso[1] - BODY.hip + 2 * BODY.leg[1];   // 頭の中心から足の裏まで
const FIGURE_DOTS = FOOT_BELOW_HEAD + BODY.head / 2 + 2;                                         // へたまで入れた背の高さ
const FIG_CENTER = (FOOT_BELOW_HEAD - BODY.head / 2 - 2) / 2;                                    // 頭の中心から体のまん中まで
// 絵のどこを体の中心に合わせるか（ドット）
const ANCHOR = {
  head: [4.5, 6.5], torso: [2, 5.5], armF: [1, 3.5], armB: [1, 3.5],
  legUF: [1, 4], legUB: [1, 4], legLF: [1, 4], legLB: [1, 4],
};

const SPRITES = {};
for (const [id, ch] of Object.entries(CHARS)) SPRITES[id] = makeCharSprites(ch);
const OBJ_SPRITES = {
  knife: makeSprite(KNIFE, OBJ_PAL), katana: makeSprite(KATANA, OBJ_PAL), hammer: makeSprite(HAMMER, OBJ_PAL),
  pistol: makeSprite(PISTOL, OBJ_PAL), mgun: makeSprite(MGUN, OBJ_PAL), bomb: makeSprite(BOMB, OBJ_PAL),
  tnt: makeSprite(TNT, OBJ_PAL), barrel: makeSprite(BARREL, OBJ_PAL), syringe: makeSprite(SYRINGE, OBJ_PAL),
  car: makeSprite(CAR, OBJ_PAL), carGlass: makeSprite(CAR_GLASS, OBJ_PAL),
  truck: makeSprite(TRUCK, OBJ_PAL), truckGlass: makeSprite(TRUCK_GLASS, OBJ_PAL),
  bike: makeSprite(BIKE, OBJ_PAL), tank: makeSprite(TANK, OBJ_PAL),
  axe: makeSprite(AXE, OBJ_PAL), spear: makeSprite(SPEAR, OBJ_PAL),
  bat: makeSprite(BAT, OBJ_PAL), cleaver: makeSprite(CLEAVER, OBJ_PAL), pan: makeSprite(PAN, OBJ_PAL),
  shotgun: makeSprite(SHOTGUN, OBJ_PAL), dynamite: makeSprite(DYNAMITE, OBJ_PAL), molotov: makeSprite(MOLOTOV, OBJ_PAL),
  stone: makeSprite(STONE, OBJ_PAL), anvil: makeSprite(ANVIL, OBJ_PAL),
  club: makeSprite(CLUB, OBJ_PAL), sword: makeSprite(SWORD, OBJ_PAL), sledge: makeSprite(SLEDGE, OBJ_PAL), sniper: makeSprite(SNIPER, OBJ_PAL),
  flame: makeSprite(FLAME, OBJ_PAL), mine: makeSprite(MINE, OBJ_PAL), tv: makeSprite(TV, OBJ_PAL), dumbbell: makeSprite(DUMBBELL, OBJ_PAL),
  bowling: circleSprite(9, (dx, dy, dist, r) => {
    if (dist > r - 0.8) return '#0c0c14';
    if ((Math.abs(dx - 0.6) < 0.7 && Math.abs(dy + 1.2) < 0.7) || (Math.abs(dx + 0.9) < 0.7 && Math.abs(dy + 1.2) < 0.7) || (Math.abs(dx - 0.1) < 0.7 && Math.abs(dy) < 0.7)) return '#0c0c14';
    return dx < -1 && dy < -1 && dist < r * 0.6 ? '#7a8fe0' : '#24387a';
  }),
  tire: circleSprite(12, (dx, dy, dist, r) => {
    if (dist > r - 0.8) return '#0c0c0c';
    if (dist > r - 3.2) return dx + dy < -2 ? '#3a3a3a' : '#1c1c1c';
    if (dist > 1.6) return null;
    return '#a9b2bd';
  }),
  syringePoison: makeSprite(SYRINGE.map((r) => r.replace(/e/g, 'p')), OBJ_PAL),
  syringeSleep: makeSprite(SYRINGE.map((r) => r.replace(/e/g, 't')), OBJ_PAL),
  syringeZombie: makeSprite(SYRINGE.map((r) => r.replace(/e/g, 'z')), OBJ_PAL),
  syringeDraw: makeSprite(SYRINGE.map((r) => r.replace(/e/g, 'i')), OBJ_PAL),
  chainsaw: makeSprite(CHAINSAW, OBJ_PAL), chainsaw2: makeSprite(CHAINSAW_2, OBJ_PAL),
  grenade: makeSprite(GRENADE, OBJ_PAL), grenadeLit: makeSprite(GRENADE_LIT, OBJ_PAL),
  launcher: makeSprite(LAUNCHER, OBJ_PAL), rocket: makeSprite(ROCKET, OBJ_PAL), trampoline: makeSprite(TRAMPOLINE, OBJ_PAL),
  wheel14: wheelSprite(14), wheel15: wheelSprite(15),
  bikeWheel: circleSprite(11, (dx, dy, dist, r) => {   // バイクのタイヤ（細くて、スポークのあいだはすけている）
    if (dist > r - 1.4) return '#161616';
    if (dist < 1.2) return '#a9b2bd';
    return Math.min(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy) * 0.7, Math.abs(dx + dy) * 0.7) < 0.45 ? '#b8bec6' : null;
  }),
  tankWheel: circleSprite(8, (dx, dy, dist, r) => {    // 戦車の小さいタイヤ
    if (dist > r - 0.8) return '#161616';
    if (Math.abs(dx) < 0.6 && dy < 0) return '#c9d28f';
    return dist > r * 0.5 ? '#4a5628' : '#8e9e52';
  }),
  ball: circleSprite(10, (dx, dy, dist, r) => {
    if (dist > r - 0.8) return '#111111';
    if (dx < -1 && dy < -1 && dist < r * 0.45) return '#ffffff';
    const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
    return ['#e23b3b', '#f5f5f5', '#3c7dd9', '#f5f5f5', '#f0c030', '#f5f5f5'][Math.floor(a * 6) % 6];
  }),
  ironball: circleSprite(12, (dx, dy, dist, r) => {
    if (dist > r - 0.8) return '#111111';
    if (dx < -1 && dy < -1 && dist < r * 0.5) return '#8c96a3';
    return dx + dy > 3 ? '#353a41' : '#4a4f57';
  }),
};

// 風船は5色（balloon0〜balloon4）
const BALLOON_COLORS = [['#d23a2a', '#8e1f16'], ['#3c7dd9', '#24508f'], ['#f0c030', '#b8901e'], ['#58c26a', '#2f7a3a'],
                        ['#ff7ab8', '#c04a86']];
BALLOON_COLORS.forEach(([r, R], i) => { OBJ_SPRITES['balloon' + i] = makeSprite(BALLOON, Object.assign({}, OBJ_PAL, { r, R })); });

// 木箱の絵（大きさごとに作る）
const crateCache = new Map();
function crateSprite(n) {
  let c = crateCache.get(n);
  if (!c) {
    const rows = [];
    for (let j = 0; j < n; j++) {
      let r = '';
      for (let i = 0; i < n; i++) {
        const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
        r += edge ? 'd' : (i === j || i + j === n - 1) ? 'o' : 'O';
      }
      rows.push(r);
    }
    c = makeSprite(rows, OBJ_PAL);
    crateCache.set(n, c);
  }
  return c;
}

// キャラの全身の絵（アイテムのひきだしと、スワイプ中の影に使う）
function makeFigure(kind, s = SPRITES[kind]) {
  const F = (CHARS[kind] && CHARS[kind].fig) || { w: 9, head: [0, 0], torso: [3, 11], armB: [3, 12], armF: [4, 12], legUB: [3, 21], legUF: [5, 21] };
  const c = document.createElement('canvas');
  c.width = F.w; c.height = 37;
  const x = c.getContext('2d');
  const put = (name, [px, py], dy = 0) => x.drawImage(s[name], px, py + dy);
  put('armB', F.armB); put('armB', F.armB, 7);
  put('legUB', F.legUB); put('legLB', F.legUB, 8);
  put('torso', F.torso);
  put('legUF', F.legUF); put('legLF', F.legUF, 8);
  put('head_ok', F.head);
  put('armF', F.armF); put('armF', F.armF, 7);
  return c;
}
const FIGURES = {};
for (const id of Object.keys(CHARS)) FIGURES[id] = makeFigure(id);

// ---- 服 ----
// 服は、キャラの部品の絵の上に重ねて描く絵。key はどの部品か（head, torso, armF/armB は手前・うしろのうで、legUF/legUB/legLF/legLB は足）、
// seg でうでの上・下（armU, armL）をえらぶ。ox, oy は部品の絵の左上から数えた場所（ドット）。under なら、部品の下に描く。
// slot は着る場所（head, body, back, legs。同じ場所には1つだけ）。guard はダメージを半分にする部品（ヘルメット、よろい）
const CLOTH_PAL = { K: '#111111', r: '#d23a2a', R: '#8e1f16', y: '#f0c030', Y: '#b8901e', u: '#3c7dd9', U: '#24508f', g: '#6b737e', G: '#a9b2bd',
                    s: '#e0e6ec', b: '#9c6b3f', B: '#5a3a1e', n: '#5f8f3a', N: '#3f6626', w: '#f5f5f5' };
const CLOTHES = {
  cap: { slot: 'head', name: 'ぼうし', layers: [
    { key: 'head', ox: -1, oy: 0, rows: ['...KKKKK...', '..KrrrrrK..', '.KrrrrrrrKK'] },
  ] },
  helmet: { slot: 'head', name: 'ヘルメット', guard: 'head', layers: [
    { key: 'head', ox: -1, oy: 0, rows: ['...KKKKK...', '..KyYyyyK..', '.KyyyyyyyK.', '.K.......K.', '.K.......K.'] },
  ] },
  crown: { slot: 'head', name: 'おうかん', layers: [
    { key: 'head', ox: 1, oy: 0, rows: ['y.y.y.y', 'yyyyyyy', 'yryyyry'] },
  ] },
  shades: { slot: 'head', name: 'サングラス', layers: [
    { key: 'head', ox: 4, oy: 3, rows: ['KKKKK'] },
  ] },
  shirt: { slot: 'body', name: 'あかいシャツ', layers: [
    { key: 'torso', ox: 0, oy: 1, rows: ['RrrR', 'RrrR', 'RrrR', 'RrrR', 'RrrR', 'RrrR', 'RrrR'] },
    { key: 'armF', seg: 'armU', ox: 0, oy: 0, rows: ['rr', 'rr', 'rR'] },
    { key: 'armB', seg: 'armU', ox: 0, oy: 0, rows: ['rr', 'rr', 'rR'] },
  ] },
  jacket: { slot: 'body', name: 'あおいジャケット', layers: [
    { key: 'torso', ox: 0, oy: 1, rows: ['UwwU', 'UuwU', 'UuwU', 'UuwU', 'UuwU', 'UuwU', 'UuwU', 'UuwU'] },
    { key: 'armF', seg: 'armU', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
    { key: 'armB', seg: 'armU', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
    { key: 'armF', seg: 'armL', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
    { key: 'armB', seg: 'armL', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
  ] },
  armor: { slot: 'body', name: 'よろい', guard: 'torso', layers: [
    { key: 'torso', ox: 0, oy: 0, rows: ['.KK.', 'KGGK', 'KGsK', 'KGGK', 'KgGK', 'KGGK', 'KGsK', 'KGGK', 'KgGK', 'KGGK', '.KK.'] },
    { key: 'armF', seg: 'armU', ox: 0, oy: 0, rows: ['Gs', 'GG', 'gG'] },
    { key: 'armB', seg: 'armU', ox: 0, oy: 0, rows: ['Gs', 'GG', 'gG'] },
  ] },
  cape: { slot: 'back', name: 'マント', layers: [
    { key: 'torso', under: true, ox: -3, oy: 1, rows: ['.RR', 'RrR', 'RrR', 'RrR', 'RrR', 'RrR', 'RrR', 'RrR', 'RrR', 'rRR', '..R'] },
  ] },
  jeans: { slot: 'legs', name: 'ジーンズ', layers: [
    { key: 'legUF', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
    { key: 'legUB', ox: 0, oy: 0, rows: ['uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu', 'uu'] },
    { key: 'legLF', ox: 0, oy: 0, rows: ['uu.', 'uu.', 'uu.', 'uu.', 'uu.', 'uu.', 'bb.', 'bbb'] },
    { key: 'legLB', ox: 0, oy: 0, rows: ['uu.', 'uu.', 'uu.', 'uu.', 'uu.', 'uu.', 'bb.', 'bbb'] },
  ] },
  camo: { slot: 'legs', name: 'みどりのズボン', layers: [
    { key: 'legUF', ox: 0, oy: 0, rows: ['nn', 'nN', 'nn', 'Nn', 'nn', 'nN', 'nn', 'Nn'] },
    { key: 'legUB', ox: 0, oy: 0, rows: ['nn', 'nN', 'nn', 'Nn', 'nn', 'nN', 'nn', 'Nn'] },
    { key: 'legLF', ox: 0, oy: 0, rows: ['nn.', 'Nn.', 'nn.', 'nN.', 'nn.', 'Nn.', 'BB.', 'BBB'] },
    { key: 'legLB', ox: 0, oy: 0, rows: ['nn.', 'Nn.', 'nn.', 'nN.', 'nn.', 'Nn.', 'BB.', 'BBB'] },
  ] },
};
for (const C of Object.values(CLOTHES)) {
  for (const L of C.layers) {
    L.img = makeSprite(L.rows, CLOTH_PAL);
    if (/B$/.test(L.key)) {   // うしろがわのうでや足は、暗くする
      const x = L.img.getContext('2d');
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = 'rgba(0, 0, 0, 0.25)';
      x.fillRect(0, 0, L.img.width, L.img.height);
    }
  }
}
// ひきだしの絵：ブドウが着た姿の、その服の場所だけを切りとる
const CLOTH_CROP = { head: [0, 0, 13, 15], body: [0, 12, 13, 22], back: [0, 12, 13, 22], legs: [0, 22, 13, 19] };
function clothIcon(id) {
  const C = CLOTHES[id], full = document.createElement('canvas');
  full.width = 13; full.height = 41;
  const x = full.getContext('2d');
  x.drawImage(FIGURES.grape, 2, 2);
  const at = { head: [0, 0], torso: [3, 11], armFarmU: [4, 12], armFarmL: [4, 19], armBarmU: [3, 12], armBarmL: [3, 19],
               legUF: [5, 21], legLF: [5, 29], legUB: [3, 21], legLB: [3, 29] };
  for (const L of C.layers) {
    const p = at[L.key + (L.seg || '')] || at[L.key];
    x.drawImage(L.img, 2 + p[0] + L.ox, 2 + p[1] + L.oy);
  }
  const [cx, cy, cw, ch] = CLOTH_CROP[C.slot];
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
  return c;
}

// ケガ（赤）とこげ（黒）の度合いぶん色を変えた絵。一度作ったら使い回す。
const tintCache = new Map();
function getSprite(kind, name, level, burn) {
  if (!level && !burn) return SPRITES[kind][name];
  const key = kind + ':' + name + ':' + level + ':' + burn;
  let c = tintCache.get(key);
  if (!c) {
    const base = SPRITES[kind][name];
    c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    const x = c.getContext('2d');
    x.drawImage(base, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    if (level) { x.fillStyle = `rgba(${CHARS[kind].hurtTint}, ${0.16 * level})`; x.fillRect(0, 0, c.width, c.height); }
    if (burn) { x.fillStyle = `rgba(20, 14, 10, ${0.22 * burn})`; x.fillRect(0, 0, c.width, c.height); }
    tintCache.set(key, c);
  }
  return c;
}

// ---- マップ ----
// 大きさ（w, h）も場所も、ぜんぶドットで書く。blocks は動かない地面や建物（x, y が左上）。いちばん最初の block が地面。
// look は見た目：ground 地面、road 道路、grass 草地、sand 砂、moon 月の地面、metal 鉄、wood 木、platform 足場、building ビル、
// rock 岩、bridge 橋
// polys は坂（角がへこんでいない形の、点のならび）、spikes はトゲ、water は水。
// start は最初のブドウが立つ場所（横）、gravity は重力の強さ（ふつうは 1）、music は流れる曲。
// lava は溶岩（入ると燃える）、vent は噴火する所。polyTop, polyFill は坂の色。endless はどこまでも続くマップ（地面は自動で作る）。
const MAPS = [
  { id: 'ground', name: 'グラウンド', desc: 'ひろい平地', w: 1200, h: 240, theme: 'field', music: 'play',
    sky: '#a9cfe8', floor: '#4b515b', edge: '#8a919c', gravity: 1, start: 600,
    blocks: [{ x: 0, y: 214, w: 1200, h: 26, look: 'ground' }] },
  { id: 'city', name: 'まち', desc: 'ビルの上から落とせる。坂で屋上へ', w: 1600, h: 340, theme: 'city', music: 'play',
    sky: '#9ec3e6', floor: '#3d4046', edge: '#6f747c', polyTop: '#8a8f96', polyFill: '#55595f', gravity: 1, start: 120,
    blocks: [
      { x: 0, y: 316, w: 1600, h: 24, look: 'road' },
      { x: 440, y: 236, w: 120, h: 80, look: 'building', color: '#c46a4a' },
      { x: 700, y: 166, w: 60, h: 150, look: 'building', color: '#7a8fb0' },
      { x: 880, y: 256, w: 100, h: 60, look: 'building', color: '#d9b36a' },
      { x: 1080, y: 136, w: 70, h: 180, look: 'building', color: '#8a7ab8' },
      { x: 1300, y: 216, w: 120, h: 100, look: 'building', color: '#6aa88a' },
    ],
    polys: [[[290, 316], [440, 236], [440, 316]]] },
  { id: 'hills', name: 'さか道', desc: 'のりもので ジャンプ', w: 1700, h: 320, theme: 'hills', music: 'play',
    sky: '#bfe3f2', floor: '#7a5230', edge: '#4f9a3a', gravity: 1, start: 80,
    blocks: [{ x: 0, y: 296, w: 1700, h: 24, look: 'grass' }],
    polys: [   // どちら向きに走っても登れる山（かたがわだけの坂は、反対から来るとかべになる）
      [[180, 296], [300, 262], [330, 262], [450, 296]],
      [[560, 296], [640, 270], [720, 296]],
      [[840, 296], [1000, 232], [1040, 232], [1200, 296]],
      [[1310, 296], [1370, 280], [1430, 296]],
      [[1490, 296], [1570, 268], [1590, 268], [1670, 296]],
    ] },
  { id: 'endless', name: 'エンドレス', desc: 'どこまでも続く。のりもので遠くへ', endless: true, w: 800, h: 320, theme: 'hills',
    music: 'play', sky: '#b8def0', floor: '#7a5230', edge: '#4f9a3a', gravity: 1, start: 0, blocks: [] },
  { id: 'tower', name: 'タワー', desc: '高い所から落とせる', w: 440, h: 460, theme: 'sunset', music: 'play',
    sky: '#f0b060', floor: '#3e3a4a', edge: '#7a7390', gravity: 1, start: 60,
    blocks: [
      { x: 0, y: 436, w: 440, h: 24, look: 'ground' },
      { x: 150, y: 350, w: 140, h: 7, look: 'platform' },
      { x: 170, y: 262, w: 100, h: 7, look: 'platform' },
      { x: 190, y: 174, w: 60, h: 7, look: 'platform' },
      { x: 205, y: 90, w: 30, h: 7, look: 'platform' },
    ] },
  { id: 'sea', name: 'うみ', desc: '水にうかぶ・しずむ', w: 1000, h: 280, theme: 'sea', music: 'play',
    sky: '#8fd0f0', floor: '#d9c08a', edge: '#efe0b0', gravity: 1, start: 140,
    blocks: [
      { x: 0, y: 214, w: 330, h: 66, look: 'sand' },
      { x: 330, y: 266, w: 670, h: 14, look: 'sand' },
      { x: 310, y: 210, w: 100, h: 4, look: 'wood' },
    ],
    water: { x: 330, y: 222, w: 670, h: 44 } },
  { id: 'volcano', name: '火山', desc: '溶岩に落とすと燃える。ときどき噴火', w: 1300, h: 420, theme: 'volcano', music: 'volcano',
    sky: '#3b1e22', floor: '#2b2327', edge: '#5a4248', polyTop: '#5a4248', polyFill: '#2b2327', gravity: 1, start: 150,
    blocks: [
      { x: 0, y: 396, w: 960, h: 24, look: 'rock' },
      { x: 960, y: 412, w: 220, h: 8, look: 'rock' },
      { x: 1180, y: 396, w: 120, h: 24, look: 'rock' },
      { x: 600, y: 246, w: 60, h: 150, look: 'rock' },
      { x: 930, y: 372, w: 100, h: 6, look: 'bridge' },   // こわれた橋（まん中から溶岩に落ちる）
      { x: 1110, y: 372, w: 100, h: 6, look: 'bridge' },
    ],
    polys: [
      [[380, 396], [570, 196], [600, 196], [600, 396]],
      [[660, 396], [660, 196], [690, 196], [880, 396]],
      [[890, 396], [930, 372], [930, 396]],
      [[1210, 372], [1250, 396], [1210, 396]],
    ],
    lava: [{ x: 600, y: 212, w: 60, h: 34 }, { x: 960, y: 399, w: 220, h: 13 }],
    vent: { x: 630, y: 212 } },
  { id: 'lab', name: 'じっけん室', desc: 'トゲと、かべと天井', w: 440, h: 220, theme: 'lab', music: 'play',
    sky: '#cfd6dc', floor: '#5b646e', edge: '#9aa5b0', gravity: 1, start: 80,
    blocks: [
      { x: 0, y: 200, w: 440, h: 20, look: 'metal' },
      { x: 0, y: 0, w: 440, h: 10, look: 'metal', kind: 'ceiling' },
      { x: 190, y: 130, w: 70, h: 6, look: 'metal' },
    ],
    spikes: [{ x: 300, y: 200, w: 80 }] },
  { id: 'space', name: 'うちゅう', desc: '重力が弱い', w: 1400, h: 420, theme: 'space', music: 'space',
    sky: '#0b0f2a', floor: '#6b6f7a', edge: '#a3a7b3', polyTop: '#a3a7b3', polyFill: '#6b6f7a', gravity: 0.25, start: 700,
    blocks: [
      { x: 0, y: 396, w: 1400, h: 24, look: 'moon' },
      { x: 250, y: 300, w: 60, h: 8, look: 'moon' },
      { x: 900, y: 250, w: 80, h: 8, look: 'moon' },
    ],
    polys: [[[480, 396], [580, 366], [620, 366], [620, 396]]] },
  // 公園：池・すべり台・ジャングルジム・ベンチ。池のふちはゆるやかな坂で、あがれる
  { id: 'park', name: '公園', desc: 'すべり台・ジャングルジム・池', w: 1500, h: 300, theme: 'park', music: 'play',
    sky: '#a9dcf5', floor: '#7a5230', edge: '#4f9a3a', gravity: 1, start: 200,
    blocks: [
      { x: 0, y: 240, w: 560, h: 60, look: 'grass' },
      { x: 560, y: 282, w: 320, h: 18, look: 'sand' },
      { x: 880, y: 240, w: 620, h: 60, look: 'grass' },
      { x: 236, y: 188, w: 18, h: 3, look: 'metal' },
      { x: 420, y: 196, w: 4, h: 44, look: 'metal' }, { x: 520, y: 196, w: 4, h: 44, look: 'metal' }, { x: 410, y: 196, w: 124, h: 4, look: 'metal' },
      { x: 450, y: 160, w: 4, h: 36, look: 'metal' }, { x: 490, y: 160, w: 4, h: 36, look: 'metal' }, { x: 440, y: 160, w: 64, h: 4, look: 'metal' },
      { x: 1000, y: 226, w: 44, h: 4, look: 'wood' }, { x: 1003, y: 230, w: 4, h: 10, look: 'wood' }, { x: 1037, y: 230, w: 4, h: 10, look: 'wood' },
      { x: 1000, y: 212, w: 3, h: 14, look: 'wood' },
    ],
    polys: [
      Object.assign([[560, 240], [640, 282], [560, 282]]),
      Object.assign([[880, 240], [800, 282], [880, 282]]),
      Object.assign([[250, 190], [250, 240], [330, 240]], { style: { top: '#e23b3b', fill: '#b02a2a' } }),   // すべり台
      [[1120, 240], [1190, 214], [1250, 214], [1320, 240]],
    ],
    water: { x: 560, y: 248, w: 320, h: 34 } },
  // 駅：線路は、ホームより低い。ときどき電車がやってきて、ぶつかった物をはねとばす（ホームに突っ込んでくることもある）
  { id: 'station', name: '駅', desc: 'ときどき電車が突っ込んでくる！', w: 1600, h: 300, theme: 'station', music: 'play',
    sky: '#b9d3ea', floor: '#8c887e', edge: '#d9d4c7', gravity: 1, start: 505,
    blocks: [
      { x: 0, y: 220, w: 560, h: 80, look: 'platform2' },
      { x: 560, y: 270, w: 480, h: 30, look: 'track' },
      { x: 1040, y: 220, w: 560, h: 80, look: 'platform2' },
      { x: 60, y: 130, w: 400, h: 5, look: 'metal' }, { x: 70, y: 135, w: 4, h: 85, look: 'metal' }, { x: 446, y: 135, w: 4, h: 85, look: 'metal' },
      { x: 1140, y: 130, w: 400, h: 5, look: 'metal' }, { x: 1150, y: 135, w: 4, h: 85, look: 'metal' }, { x: 1526, y: 135, w: 4, h: 85, look: 'metal' },
    ],
    polys: [[[560, 220], [700, 270], [560, 270]], [[1040, 220], [900, 270], [1040, 270]]],
    train: { y: 270, platY: 220 } },
];

// マップの物は、キャラより大きく見えるように、ぜんぶ MAP_SCALE 倍にする（エンドレスは地面を自動で作るので、そのまま）

// バックルーム：黄色い壁紙と、じゅうたんと、蛍光灯の、はてしなく続く めいろ。部屋のかべには、ところどころ出入り口があって、
// ゆかには、下の階へ落ちる穴がある。めいろは、ぜんぶの部屋がつながるように作る（同じ形が毎回できる）
function makeBackroomsMap() {
  const C = 16, R = 4, CW = 90, CH = 70, FT = 6, WT = 6, HOLE = 40;
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const east = Array.from({ length: R }, () => Array(C).fill(false));    // 右のとなりとつながっているか
  const south = Array.from({ length: R }, () => Array(C).fill(false));   // 下のとなりとつながっているか
  const seen = Array.from({ length: R }, () => Array(C).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {   // 深さ優先で、かべをこわしながら進む（どの部屋にも行ける）
    const [c, r] = stack[stack.length - 1];
    const next = [[c + 1, r, 'e'], [c - 1, r, 'w'], [c, r + 1, 's'], [c, r - 1, 'n']].filter(([x, y]) => x >= 0 && x < C && y >= 0 && y < R && !seen[y][x]);
    if (!next.length) { stack.pop(); continue; }
    const [x, y, d] = next[Math.floor(rnd() * next.length)];
    if (d === 'e') east[r][c] = true; else if (d === 'w') east[y][x] = true; else if (d === 's') south[r][c] = true; else south[y][x] = true;
    seen[y][x] = true;
    stack.push([x, y]);
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {   // ぬけ道をふやす
    if (c < C - 1 && rnd() < 0.18) east[r][c] = true;
    if (r < R - 1 && rnd() < 0.12) south[r][c] = true;
  }
  const w = C * CW, h = R * CH, blocks = [{ x: 0, y: h - 8, w, h: 8, look: 'bfloor' }];
  blocks.push({ x: 0, y: 0, w, h: FT, look: 'bfloor', kind: 'ceiling' });
  for (let r = 0; r < R - 1; r++) {   // ゆか（穴のある所は、あける）。つづくゆかは、ひとつにまとめる
    let x0 = null;
    const close = (x1) => { if (x0 != null && x1 > x0) blocks.push({ x: x0, y: (r + 1) * CH - FT, w: x1 - x0, h: FT, look: 'bfloor' }); x0 = null; };
    for (let c = 0; c < C; c++) {
      if (south[r][c]) {
        const hx = c * CW + Math.floor((CW - HOLE) / 2);
        if (x0 == null) x0 = c * CW;
        close(hx);
        x0 = hx + HOLE;
      } else if (x0 == null) x0 = c * CW;
    }
    close(w);
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C - 1; c++) {   // かべ（出入り口のある所は、ない）
    if (!east[r][c]) blocks.push({ x: (c + 1) * CW - WT / 2, y: r * CH + FT, w: WT, h: CH - FT - (r === R - 1 ? 8 : FT), look: 'bwall' });
  }
  let start = CW / 2;
  for (let c = 0; c < C; c++) if (!south[0][c]) { start = c * CW + CW / 2; break; }   // ゆかのある部屋から、はじめる
  return { id: 'backrooms', name: 'バックルーム', desc: 'はてしない黄色い部屋の、めいろ', w, h, theme: 'backrooms', music: 'play', cell: [CW, CH],
           sky: '#d8c766', floor: '#7a6a2e', edge: '#b8a850', gravity: 1, start, blocks };
}
MAPS.push(makeBackroomsMap());
const MAP_SCALE = 1.5;
function scaleMap(m) {
  const k = MAP_SCALE, r = (v) => Math.round(v * k);
  const box = (o) => { const x1 = r(o.x + o.w), y1 = r(o.y + o.h); o.x = r(o.x); o.y = r(o.y); o.w = x1 - o.x; o.h = y1 - o.y; };
  m.w = r(m.w); m.h = r(m.h); m.start = r(m.start);
  for (const b of m.blocks) box(b);
  for (const p of m.polys || []) for (const pt of p) { pt[0] = r(pt[0]); pt[1] = r(pt[1]); }   // (色を持つ坂は、点のならびに style がついている)
  for (const sp of m.spikes || []) { const x1 = r(sp.x + sp.w); sp.x = r(sp.x); sp.y = r(sp.y); sp.w = x1 - sp.x; }
  if (m.water) box(m.water);
  for (const L of m.lava || []) box(L);
  if (m.vent) { m.vent.x = r(m.vent.x); m.vent.y = r(m.vent.y); }
  if (m.train) { m.train.y = r(m.train.y); m.train.platY = r(m.train.platY); }
  if (m.cell) m.cell = [r(m.cell[0]), r(m.cell[1])];
}
for (const m of MAPS) if (!m.endless) scaleMap(m);

const makeRng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => clamp(((n >> s) & 255) + amt, 0, 255);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

// マップの絵をドットの大きさで描く。mask があれば、地面のドットに 1 を入れる。マップ選択の小さい絵にも使う。
function paintMap(c, m, mask) {
  const rnd = makeRng(11);
  c.fillStyle = m.sky;
  c.fillRect(0, 0, m.w, m.h);
  paintSky(c, m, rnd, m.blocks.length ? m.blocks[0].y : m.h);
  if (m.water) {
    const wa = m.water;
    c.fillStyle = '#3a8fc8'; c.fillRect(wa.x, wa.y, wa.w, wa.h);
    c.fillStyle = '#2f79ad'; c.fillRect(wa.x, wa.y + Math.floor(wa.h / 2), wa.w, Math.ceil(wa.h / 2));
  }
  for (const L of m.lava || []) {
    c.fillStyle = '#e8501a'; c.fillRect(L.x, L.y, L.w, L.h);
    c.fillStyle = '#ff8a1f'; c.fillRect(L.x, L.y, L.w, Math.min(3, L.h));
    c.fillStyle = '#ffd23a'; c.fillRect(L.x, L.y, L.w, 1);
    for (let i = 0; i < L.w * L.h / 12; i++) {
      c.fillStyle = rnd() < 0.5 ? '#ffe070' : '#a8340e';
      c.fillRect(L.x + Math.floor(rnd() * L.w), L.y + 2 + Math.floor(rnd() * (L.h - 2)), 1, 1);
    }
  }
  for (const b of m.blocks) paintBlock(c, m, b, rnd, mask);
  for (const poly of m.polys || []) paintPoly(c, m, poly, mask);
  for (const s of m.spikes || []) paintSpikes(c, s);
}

function cloud(c, x, y, w) {
  c.fillStyle = '#ffffff';
  c.fillRect(x, y + 2, w, 3);
  c.fillRect(x + 2, y, w - 6, 3);
  c.fillRect(x + 5, y - 1, Math.max(2, w - 12), 2);
  c.fillStyle = 'rgba(150, 180, 210, 0.55)';
  c.fillRect(x + 1, y + 5, w - 2, 1);
}
function disc(c, cx, cy, r, colorAt) {
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i, j);
      if (d > r) continue;
      c.fillStyle = colorAt(i, j, d);
      c.fillRect(cx + i, cy + j, 1, 1);
    }
  }
}
function paintSky(c, m, rnd, top) {
  const w = m.w;
  if (m.theme === 'space') {
    for (let i = 0; i < w * top / 60; i++) {
      c.fillStyle = rnd() < 0.2 ? '#ffe9a0' : '#ffffff';
      c.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * (top - 2)), 1, 1);
    }
    disc(c, Math.floor(w * 0.72), Math.floor(top * 0.28), 22, (i, j, d) =>
      d > 20.8 ? '#2a3f7a' : i + j < -11 ? '#9fb7ff' : Math.floor((j + 22) / 6) % 2 ? '#6d86d9' : '#5a72c4');
    return;
  }
  if (m.theme === 'volcano') {
    const bands = ['#2a1418', '#351a1e', '#432024', '#522826', '#62302a'];
    for (let i = 0; i < bands.length; i++) {
      const y0 = Math.floor(top * i / bands.length);
      c.fillStyle = bands[i];
      c.fillRect(0, y0, w, top - y0);
    }
    c.fillStyle = '#3a1c20';   // 遠くの山
    for (let x = 0; x < w; x++) {
      const yy = Math.floor(top - 40 - Math.abs(Math.sin(x / 83)) * 50 - Math.sin(x / 23) * 6);
      c.fillRect(x, yy, 1, top - yy);
    }
    for (let i = 0; i < w * top / 1500; i++) {   // 火の粉
      c.fillStyle = rnd() < 0.3 ? '#ffd060' : '#ff8a3a';
      c.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * top * 0.8), 1, 1);
    }
    return;
  }
  if (m.theme === 'backrooms') {   // 黄色い壁紙（たてじま）と、部屋ごとの蛍光灯
    for (let x = 0; x < w; x++) {
      c.fillStyle = Math.floor(x / 3) % 2 ? '#d1bf5e' : '#dccb70';
      c.fillRect(x, 0, 1, top + 8);
    }
    const [cw, ch] = m.cell;
    for (let cy = 0; cy < m.h; cy += ch) for (let cx = 0; cx < w; cx += cw) {
      c.fillStyle = 'rgba(255, 251, 210, 0.16)'; c.fillRect(cx + cw / 2 - 22, cy + 6, 44, 24);
      c.fillStyle = LINE_COLOR; c.fillRect(cx + cw / 2 - 15, cy + 5, 30, 5);
      c.fillStyle = '#fffbe0'; c.fillRect(cx + cw / 2 - 14, cy + 6, 28, 3);
      c.fillStyle = '#b8a850'; c.fillRect(cx, cy + ch - 13, cw, 2);   // 壁のはば木
    }
    return;
  }
  if (m.theme === 'lab') {
    c.fillStyle = '#c3cbd2';
    for (let y = 0; y < top; y += 12) {
      c.fillRect(0, y, w, 1);
      for (let x = (y / 12) % 2 ? 6 : 0; x < w; x += 12) c.fillRect(x, y, 1, 12);
    }
    for (let r = 0; r < 3; r++) {
      for (let x = 0; x < w; x++) {
        c.fillStyle = Math.floor((x + r) / 4) % 2 ? '#1b1e23' : '#e8c547';
        c.fillRect(x, top - 6 + r, 1, 1);
      }
    }
    return;
  }
  if (m.theme === 'sunset') {
    const bands = ['#f4b86a', '#f0a95c', '#eb9a52', '#e48a4a'];
    for (let i = 0; i < bands.length; i++) {
      const y0 = Math.floor(top * (0.5 + i * 0.12));
      c.fillStyle = bands[i];
      c.fillRect(0, y0, w, top - y0);
    }
    disc(c, Math.floor(w * 0.78), Math.floor(top * 0.72), 14, () => '#ffe9a8');
  }
  if (m.theme === 'hills') {
    for (let k = 0; k < 2; k++) {
      c.fillStyle = k ? '#8fc1d6' : '#a8d3e4';
      for (let x = 0; x < w; x++) {
        const yy = Math.floor(top - (k ? 34 : 62) - Math.sin(x / (k ? 37 : 61) + k) * (k ? 12 : 22) - Math.sin(x / 17 + k * 3) * 4);
        c.fillRect(x, yy, 1, top - yy);
      }
    }
  }
  if (m.theme === 'sea') disc(c, Math.floor(w * 0.12), Math.floor(top * 0.25), 10, () => '#fff3b0');
  const n = Math.max(2, Math.floor(w / 90));
  for (let i = 0; i < n; i++) cloud(c, Math.floor(rnd() * (w - 30)), Math.floor(8 + rnd() * top * 0.3), 16 + Math.floor(rnd() * 18));
  if (m.theme === 'park') {   // 木
    for (const tx of [60, 130, 350, 960, 1180, 1400]) bigTree(c, Math.round(tx * MAP_SCALE), top);
  }
  if (m.theme === 'city' || m.theme === 'station') {
    let x = 0;
    while (x < w) {
      const bw = 14 + Math.floor(rnd() * 26), bh = 30 + Math.floor(rnd() * 90);
      c.fillStyle = rnd() < 0.5 ? '#b4cbe0' : '#a9c1d8';
      c.fillRect(x, top - bh, bw, bh);
      c.fillStyle = '#c4d6e8';
      for (let yy = top - bh + 4; yy < top - 4; yy += 6) for (let xx = x + 3; xx < x + bw - 3; xx += 5) c.fillRect(xx, yy, 2, 3);
      x += bw + Math.floor(rnd() * 6);
    }
  }
}

function paintBlock(c, m, b, rnd, mask) {
  const { x, y, w, h } = b;
  const fill = (col, xx, yy, ww, hh) => { c.fillStyle = col; c.fillRect(xx, yy, ww, hh); };
  if (mask) {
    for (let j = Math.max(0, y); j < Math.min(m.h, y + h); j++) mask.fill(1, j * m.w + Math.max(0, x), j * m.w + Math.min(m.w, x + w));
  }
  const specks = (col, n) => { for (let i = 0; i < n; i++) fill(col, x + Math.floor(rnd() * w), y + 3 + Math.floor(rnd() * Math.max(1, h - 3)), 1, 1); };
  switch (b.look) {
    case 'building': {
      const col = b.color || '#8a8f98';
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 1);
      fill(col, x, y, w, h);
      fill(shadeColor(col, -40), x, y, w, 2);
      for (let yy = y + 6; yy < y + h - 12; yy += 9) {
        for (let xx = x + 5; xx < x + w - 8; xx += 8) fill(rnd() < 0.35 ? '#ffe39a' : '#2d3a4f', xx, yy, 4, 5);
      }
      fill('#3b2412', x + Math.floor(w / 2) - 3, y + h - 9, 6, 9);
      break;
    }
    case 'road':
      fill(LINE_COLOR, x, y - 1, w, 1); fill(m.edge, x, y, w, 2); fill(m.floor, x, y + 2, w, h - 2);
      for (let xx = x + 4; xx < x + w; xx += 16) fill('#e8c547', xx, y + 8, 8, 1);
      break;
    case 'grass':
      fill(LINE_COLOR, x, y - 1, w, 1); fill('#5cb85c', x, y, w, 3); fill(m.floor, x, y + 3, w, h - 3);
      specks('#5e3d21', Math.floor(w * h / 40));
      break;
    case 'sand':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, 1); fill(m.edge, x, y, w, 2); fill(m.floor, x, y + 2, w, h - 2);
      specks('#c2a268', Math.floor(w * h / 30));
      break;
    case 'platform2':   // 駅のホーム
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill('#8c887e', x, y, w, h); fill('#d9d4c7', x, y, w, 3); fill('#e8c547', x, y + 1, w, 1);
      for (let xx = x + 6; xx < x + w; xx += 12) fill('#77736a', xx, y + 3, 1, h - 3);
      break;
    case 'track':   // 線路：バラスト、まくらぎ、レール
      fill(LINE_COLOR, x, y - 1, w, 1); fill('#6f6a63', x, y, w, h); fill('#c9d0d6', x, y, w, 1); fill('#8a939c', x, y + 1, w, 1);
      for (let xx = x + 2; xx < x + w; xx += 7) fill('#5a3a1e', xx, y + 4, 4, 4);
      specks('#4a4640', Math.floor(w * h / 20));
      break;
    case 'bfloor':   // じゅうたん
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill('#8f7f38', x, y, w, h); fill('#a89846', x, y, w, 1);
      for (let xx = x + 2; xx < x + w; xx += 5) fill('#77672c', xx, y + Math.floor(h / 2), 1, 1);
      break;
    case 'bwall':   // 壁紙のかべ
      fill(LINE_COLOR, x - 1, y, w + 2, h); fill('#c2b155', x, y, w, h); fill('#a99a44', x, y, 1, h); fill('#d8c766', x + w - 1, y, 1, h);
      break;
    case 'moon':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill(m.edge, x, y, w, 2); fill(m.floor, x, y + 2, w, h - 2);
      specks('#575b66', Math.floor(w * h / 25));
      break;
    case 'metal':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill('#5b646e', x, y, w, h); fill('#9aa5b0', x, y + (b.kind === 'ceiling' ? h - 1 : 0), w, 1);
      for (let xx = x + 3; xx < x + w; xx += 8) fill('#c9d0d6', xx, y + (b.kind === 'ceiling' ? h - 3 : 2), 1, 1);
      break;
    case 'wood':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill('#9c6b3f', x, y, w, h);
      for (let xx = x + 9; xx < x + w; xx += 10) fill('#6b4a2b', xx, y, 1, h);
      break;
    case 'rock':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 1); fill(m.edge, x, y, w, Math.min(2, h)); fill(m.floor, x, y + 2, w, h - 2);
      specks('#3d3236', Math.floor(w * h / 18));
      specks('#6a2e24', Math.floor(w * h / 60));
      break;
    case 'bridge':
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill('#8a5a33', x, y, w, h); fill('#b07a48', x, y, w, 1);
      for (let xx = x + 3; xx < x + w; xx += 6) fill('#5e3d21', xx, y + 1, 1, h - 1);
      break;
    default:   // ground と platform
      fill(LINE_COLOR, x - 1, y - 1, w + 2, h + 2); fill(m.edge, x, y, w, Math.min(2, h)); fill(m.floor, x, y + 2, w, h - 2);
  }
}

// 坂：たての1列ずつ、上のはしを計算してぬる
function paintPoly(c, m, poly, mask) {
  const xs = poly.map((p) => p[0]);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  for (let x = x0; x < x1; x++) {
    const cx = x + 0.5;
    let top = Infinity, bottom = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (a[0] === b[0] || cx < Math.min(a[0], b[0]) || cx > Math.max(a[0], b[0])) continue;
      const yy = a[1] + (b[1] - a[1]) * (cx - a[0]) / (b[0] - a[0]);
      top = Math.min(top, yy); bottom = Math.max(bottom, yy);
    }
    if (top === Infinity) continue;
    const t = Math.round(top), btm = Math.round(bottom);
    c.fillStyle = LINE_COLOR; c.fillRect(x, t - 1, 1, 1);
    c.fillStyle = (poly.style && poly.style.top) || m.polyTop || '#5cb85c'; c.fillRect(x, t, 1, 3);
    c.fillStyle = (poly.style && poly.style.fill) || m.polyFill || m.floor; c.fillRect(x, t + 3, 1, Math.max(0, btm - t - 3));
    if (mask) for (let j = Math.max(0, t); j < Math.min(m.h, btm); j++) mask[j * m.w + x] = 1;
  }
}

function paintSpikes(c, s) {
  for (let x = s.x; x + 4 <= s.x + s.w; x += 4) {
    c.fillStyle = LINE_COLOR; c.fillRect(x + 1, s.y - 5, 2, 1);
    c.fillStyle = '#d6dce2'; c.fillRect(x + 1, s.y - 4, 1, 2); c.fillRect(x, s.y - 2, 2, 2);
    c.fillStyle = '#8a939c'; c.fillRect(x + 2, s.y - 4, 1, 2); c.fillRect(x + 2, s.y - 2, 2, 2);
  }
}

// ---- エンドレスのマップ ----
// 地面は、ここにある式で決まる（何回作っても同じ形）。カメラやキャラが近づいたら、その所の地面を作る。
const CHUNK = 160;    // このはば（ドット）ずつ作る
const SEG = 10;       // 地面の当たり判定の1まいのはば（ドット）
const METER = 25;     // 1メートルは何ドットか（キャラの背が1.5メートルくらい）
function endlessTop(x) {
  const d = Math.abs(x);
  const k = clamp((d - 150) / 150, 0, 1);   // はじめの所（まん中から150ドット）は平ら
  let y = 280 - k * (22 * Math.sin(x / 113) + 8 * Math.sin(x / 61 + 1.3) + 2 * Math.sin(x / 23 + 0.4) + 22);
  const r = d % 600;                        // 600ドットごとに、ジャンプ台（坂を上がって、とぎれる）
  if (d > 400 && r > 480 && r < 560) y -= (r - 480) * 0.35;
  return Math.round(clamp(y, 150, 300));
}
// 地面の高さ（当たり判定の四角と同じように、SEG ごとの点を直線でつなぐ）
function endlessGround(x) {
  const s = Math.floor(x / SEG) * SEG, t0 = endlessTop(s), t1 = endlessTop(s + SEG);
  return t0 + (t1 - t0) * (x - s) / SEG;
}
// 数字の小さいドット文字（看板用）。1 がドット
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], m: ['00000', '11010', '10101', '10101', '10101'],
};
function pixelText(c, text, x, y, color) {
  c.fillStyle = color;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) { x += 2; continue; }
    for (let j = 0; j < g.length; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '1') c.fillRect(x + i, y + j, 1, 1);
    x += g[0].length + 1;
  }
}
const textWidth = (text) => [...text].reduce((s, ch) => s + (GLYPHS[ch] ? GLYPHS[ch][0].length + 1 : 2), -1);
function bigTree(c, x, ground) {   // 公園の木（キャラより大きい）
  c.fillStyle = LINE_COLOR; c.fillRect(x - 4, ground - 34, 8, 34);
  c.fillStyle = '#7a5230'; c.fillRect(x - 3, ground - 34, 6, 34); c.fillStyle = '#5e3d21'; c.fillRect(x + 1, ground - 34, 2, 34);
  disc(c, x, ground - 48, 22, (i, j, d) => (d > 20.6 ? LINE_COLOR : i + j < -12 ? '#7fd06a' : d > 15 && j > 4 ? '#3f8a3a' : '#4f9a3a'));
}
function tree(c, x, ground) {
  c.fillStyle = LINE_COLOR; c.fillRect(x - 2, ground - 10, 4, 10);
  c.fillStyle = '#7a5230'; c.fillRect(x - 1, ground - 10, 2, 10);
  disc(c, x, ground - 16, 7, (i, j, d) => (d > 6.3 ? LINE_COLOR : i + j < -4 ? '#7fd06a' : '#4f9a3a'));
}
// エンドレスのマップの、i 番目の所の絵を描く。mask には、地面のドットに 1 を入れる
function paintChunk(c, m, i, mask) {
  const x0 = i * CHUNK, H = m.h;
  c.fillStyle = m.sky;
  c.fillRect(0, 0, CHUNK, H);
  for (let k = 0; k < 2; k++) {   // 遠くの山
    c.fillStyle = k ? '#8fc1d6' : '#a8d3e4';
    for (let x = 0; x < CHUNK; x++) {
      const gx = x0 + x;
      const yy = Math.floor(230 - (k ? 20 : 50) - Math.sin(gx / (k ? 37 : 61) + k) * (k ? 12 : 22) - Math.sin(gx / 17 + k * 3) * 4);
      c.fillRect(x, yy, 1, H - yy);
    }
  }
  // 雲と木は、となりの所のものも描く（さかい目で切れないように）
  for (let j = i - 1; j <= i + 1; j++) {
    const rnd = makeRng(((j * 7919) % 1000000 + 1000000) % 1000000 + 7);
    const ox = (j - i) * CHUNK;
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) cloud(c, ox + Math.floor(rnd() * (CHUNK - 30)), Math.floor(10 + rnd() * 70), 16 + Math.floor(rnd() * 18));
    if (rnd() < 0.6) {
      const tx = Math.floor(20 + rnd() * (CHUNK - 40)), gx = j * CHUNK + tx;
      const r = Math.abs(gx) % 600;
      if (!(Math.abs(gx) > 380 && r > 460 && r < 580)) tree(c, ox + tx, Math.round(endlessGround(gx + 0.5)));
    }
  }
  const rnd = makeRng(((i * 104729) % 1000000 + 1000000) % 1000000 + 3);
  for (let x = 0; x < CHUNK; x++) {   // 地面
    const t = Math.round(endlessGround(x0 + x + 0.5));
    c.fillStyle = LINE_COLOR; c.fillRect(x, t - 1, 1, 1);
    c.fillStyle = '#5cb85c'; c.fillRect(x, t, 1, 3);
    c.fillStyle = m.floor; c.fillRect(x, t + 3, 1, H - t - 3);
    if (mask) for (let y = Math.max(0, t); y < H; y++) mask[y * CHUNK + x] = 1;
    if (rnd() < 0.5) { c.fillStyle = '#5e3d21'; c.fillRect(x, t + 5 + Math.floor(rnd() * (H - t - 6)), 1, 1); }
  }
  const every = 100 * METER;   // 100メートルごとの看板
  for (let gx = Math.ceil((x0 - 20) / every) * every; gx < x0 + CHUNK + 20; gx += every) {
    const text = Math.abs(gx / METER) + 'm', tw = textWidth(text), lx = gx - x0, g = Math.round(endlessGround(gx + 0.5));
    c.fillStyle = LINE_COLOR; c.fillRect(lx - 1, g - 16, 3, 16);
    c.fillStyle = '#9c6b3f'; c.fillRect(lx, g - 16, 1, 16);
    c.fillStyle = LINE_COLOR; c.fillRect(lx - tw / 2 - 3, g - 26, tw + 6, 11);
    c.fillStyle = '#f5f0e0'; c.fillRect(lx - tw / 2 - 2, g - 25, tw + 4, 9);
    pixelText(c, text, Math.round(lx - tw / 2), g - 23, '#2a2a2a');
  }
}
// マップ選択の小さい絵に使う（まん中あたりを描く）
function endlessPreview(m) {
  const c = document.createElement('canvas');
  c.width = CHUNK * 5; c.height = m.h;
  const x = c.getContext('2d');
  for (let i = -2; i <= 2; i++) {
    const t = document.createElement('canvas');
    t.width = CHUNK; t.height = m.h;
    paintChunk(t.getContext('2d'), m, i, null);
    x.drawImage(t, (i + 2) * CHUNK, 0);
  }
  return c;
}

// ---- 世界とカメラ ----
// 当たり判定のグループ分け。キャラの部品どうしは当たらない。血はキャラに当たらない。のりものに乗っているキャラは、のりものに当たらない。
const CAT_WORLD = 0x0001, CAT_BODY = 0x0002, CAT_BLOOD = 0x0004, CAT_VEH = 0x0008;

const canvas = byId('game');
const ctx = canvas.getContext('2d');
const bg = document.createElement('canvas');      // マップの絵（ドットの大きさ。マップを始めたら一度だけ描く）
const bctx = bg.getContext('2d');
const stain = document.createElement('canvas');   // 血のシミやこげあと（ドットの大きさ）
const sctx = stain.getContext('2d');
const ghost = byId('ghost');
const drawer = byId('drawer');

const engine = Engine.create();
engine.positionIterations = 8;
engine.velocityIterations = 6;
engine.constraintIterations = 4;
const world = engine.world;

let W = 0, H = 0, dpr = 1;
let worldW = 1000, worldH = 1000;
let worldX0 = 0, worldX1 = 1000;   // 世界の左はしと右はし（エンドレスのマップでは、どこまでも）
const chunks = new Map();          // エンドレスのマップで作った所：番号 → { i, bodies, bg, stain, sctx, solid }
let liquids = [];                  // 水と溶岩（世界の中の長さ）
let solid = null;              // マップのどのドットが地面か（こげあとを地面にだけつけるため）
const cam = { x: 0, y: 0, z: 1 };   // 画面の左上が世界のどこか、ズーム（世界の長さ1が画面の何ピクセルか）
let zBase = 1;                 // はじめのズーム（キャラの大きさの設定で決まる）
let view = 'home';             // 'home'、'maps'、'settings'、'shop'、'quests'、'mods'、'play' のどれか
let mapStarted = false;        // 一度でもマップを始めたか
let currentMap = MAPS[0];
let statics = [];              // 地面・壁・建物・坂・トゲ
const chars = [];              // キャラ（生きてるのも死んでるのも）
const objects = [];            // 物（武器・銃・爆弾・のりもの・箱など）
const bloods = [];             // 飛んでる血のつぶ
const fx = [];                 // 火花・火・けむり・水しぶきなど（物理なし）
const tracers = [];            // 弾のあと
const floaters = [];           // 「死んだ…」などの文字
let deadCount = 0;
let slow = false, paused = false, rotateShown = false;
let nextGroup = -1;            // キャラ1体・のりもの1台ごとの当たり判定グループ番号
let stepCount = 0;
let shake = 0;                 // 爆発で画面がゆれる強さ

// 画面の大きさをはかって、キャンバスを合わせる
function measure() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  zBase = Math.min(W, H) * SIZE_FACTOR[settings.size] / (FIGURE_DOTS * PX);
}
// ルーズはマップの横はばが全部見えるまで、アップははじめの ZOOM_MAX 倍まで
const zMin = () => Math.min(zBase, Math.max(W / worldW, zBase * 0.2));
const zMax = () => zBase * ZOOM_MAX;
function clampCam() {
  cam.z = clamp(cam.z, zMin(), zMax());
  const vw = W / cam.z, vh = H / cam.z;
  cam.x = vw >= worldX1 - worldX0 ? (worldX0 + worldX1 - vw) / 2 : clamp(cam.x, worldX0, worldX1 - vw);
  cam.y = vh >= worldH ? worldH - vh : clamp(cam.y, 0, worldH - vh);   // 世界より画面が高いときは、地面を下にそろえる
}
const screenToWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });
const worldToScreen = (x, y) => ({ x: (x - cam.x) * cam.z, y: (y - cam.y) * cam.z });
// 画面の (sx, sy) の所を動かさずに、k 倍ズームする
function zoomAt(sx, sy, k) {
  const p = screenToWorld(sx, sy);
  cam.z = clamp(cam.z * k, zMin(), zMax());
  cam.x = p.x - sx / cam.z;
  cam.y = p.y - sy / cam.z;
  clampCam();
  syncGrabs();
}
// アップ・ルーズのボタンは、なめらかにズームする
let zoomTarget = 0;
function zoomSmooth(k) { zoomTarget = clamp((zoomTarget || cam.z) * k, zMin(), zMax()); }
function updateZoomAnim() {
  if (!zoomTarget) return;
  const r = zoomTarget / cam.z;
  if (Math.abs(r - 1) < 0.004) { zoomAt(W / 2, H / 2, r); zoomTarget = 0; }
  else zoomAt(W / 2, H / 2, Math.pow(r, 0.3));
}
// 走りだしたのりものに、カメラがついていく（画面を指で動かすと、ついていくのをやめる）
let follow = null;
function updateFollow() {
  if (!follow) return;
  if (!follow.on || !objects.includes(follow)) { follow = null; return; }
  const b = follow.body, v = Body.getVelocity(b);
  const tx = b.position.x + v.x * 25 - W / cam.z / 2, ty = b.position.y - H / cam.z * 0.62;
  cam.x += (tx - cam.x) * 0.08;
  cam.y += (ty - cam.y) * 0.05;
  clampCam();
  syncGrabs();
}
function centerCamOn(x, y) {
  cam.x = x - W / cam.z / 2;
  cam.y = y - H / cam.z / 2;
  clampCam();
}

// 地面・壁・建物を作り直して、マップの絵を描く
function buildMap(m) {
  Composite.remove(world, statics);
  chunks.clear();
  worldH = m.h * PX;
  worldX0 = m.endless ? -Infinity : 0;
  worldX1 = m.endless ? Infinity : m.w * PX;
  worldW = worldX1 - worldX0;
  liquids = [];
  if (m.water) liquids.push({ kind: 'water', x: m.water.x * PX, y: m.water.y * PX, w: m.water.w * PX, h: m.water.h * PX,
                              density: WATER_DENSITY, damp: 0.96 });
  for (const L of m.lava || []) liquids.push({ kind: 'lava', x: L.x * PX, y: L.y * PX, w: L.w * PX, h: L.h * PX, density: LAVA_DENSITY, damp: 0.9 });
  eruptTimer = 240;
  resetTrain();
  endlessBest = 0;
  const T = 2000;   // 壁や地面の、見えない所までの厚さ（速い物がすりぬけないように）
  const opt = (plugin) => ({ isStatic: true, friction: 0.9, plugin });
  statics = m.endless ? [] : [
    Bodies.rectangle(-T / 2, -worldH + T / 2, T, 4 * worldH + T, opt({ kind: 'wall' })),
    Bodies.rectangle(worldW + T / 2, -worldH + T / 2, T, 4 * worldH + T, opt({ kind: 'wall' })),
  ];
  for (const b of m.blocks) {
    const x0 = b.x <= 0 ? -T : b.x * PX, x1 = b.x + b.w >= m.w ? worldW + T : (b.x + b.w) * PX;
    const y0 = b.y * PX, y1 = b.y + b.h >= m.h ? worldH + T : (b.y + b.h) * PX;
    statics.push(Bodies.rectangle((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, opt({ kind: b.kind || 'ground' })));
  }
  for (const poly of m.polys || []) {
    const verts = poly.map(([px, py]) => ({ x: px * PX, y: py * PX }));
    const c = Vertices.centre(verts);
    statics.push(Bodies.fromVertices(c.x, c.y, [verts], opt({ kind: 'ground' })));
  }
  for (const s of m.spikes || []) {
    statics.push(Bodies.rectangle((s.x + s.w / 2) * PX, (s.y - 1.5) * PX, s.w * PX, 3 * PX,
      opt({ kind: 'spike', blade: { all: true, sharp: 1.3 } })));
  }
  Composite.add(world, statics);
  engine.gravity.y = m.gravity;
  engine.gravity.scale = 0.001;
  if (m.endless) {   // 絵は、所ごとに描く
    bg.width = bg.height = stain.width = stain.height = 1;
    solid = null;
    for (let i = -2; i <= 2; i++) ensureChunk(i);
    return;
  }
  bg.width = m.w; bg.height = m.h;
  stain.width = m.w; stain.height = m.h;
  solid = new Uint8Array(m.w * m.h);
  paintMap(bctx, m, solid);
}

// エンドレスのマップ：i 番目の所の地面を作る
function ensureChunk(i) {
  let ch = chunks.get(i);
  if (ch) return ch;
  const bodies = [], bottom = (currentMap.h + 400) * PX;
  for (let s = i * CHUNK; s < (i + 1) * CHUNK; s += SEG) {
    const verts = [{ x: s * PX, y: endlessTop(s) * PX }, { x: (s + SEG) * PX, y: endlessTop(s + SEG) * PX },
                   { x: (s + SEG) * PX, y: bottom }, { x: s * PX, y: bottom }];
    const c = Vertices.centre(verts);
    bodies.push(Bodies.fromVertices(c.x, c.y, [verts], { isStatic: true, friction: 0.9, plugin: { kind: 'ground' } }));
  }
  Composite.add(world, bodies);
  statics.push(...bodies);
  ch = { i, bodies, bg: null, stain: null, sctx: null, solid: null };
  chunks.set(i, ch);
  return ch;
}
// 絵は、見えるときに描く（遠くの所の絵は消して、メモリを軽くする。血のあとも消える）
function chunkArt(ch) {
  if (!ch.bg) {
    const m = currentMap;
    ch.bg = document.createElement('canvas');
    ch.bg.width = CHUNK; ch.bg.height = m.h;
    ch.solid = new Uint8Array(CHUNK * m.h);
    paintChunk(ch.bg.getContext('2d'), m, ch.i, ch.solid);
    ch.stain = document.createElement('canvas');
    ch.stain.width = CHUNK; ch.stain.height = m.h;
    ch.sctx = ch.stain.getContext('2d');
  }
  return ch;
}
// カメラと、キャラや物のまわりの地面を作っておく
function updateChunks() {
  if (!currentMap.endless) return;
  const span = CHUNK * PX, need = (x) => { const i = Math.floor(x / span); ensureChunk(i - 1); ensureChunk(i); ensureChunk(i + 1); };
  for (let x = cam.x; x < cam.x + W / cam.z + span; x += span) need(x);
  for (const g of chars) need(g.torso.position.x);
  for (const o of objects) need(o.body.position.x);
  const ci = Math.floor((cam.x + W / cam.z / 2) / span);
  for (const ch of chunks.values()) if (ch.bg && Math.abs(ch.i - ci) > 10) ch.bg = ch.stain = ch.sctx = ch.solid = null;
}
// 血のシミやこげあとを描く所（ドットの場所 x, y）。地面でなければ null
function stainAt(x, y) {
  if (!currentMap.endless) {
    const w = stain.width;
    return solid && x >= 0 && y >= 0 && x < w && y < stain.height ? { c: sctx, x, y, solid, w } : null;
  }
  const i = Math.floor(x / CHUNK), ch = chunks.get(i);
  if (!ch || !ch.sctx || y < 0 || y >= currentMap.h) return null;
  return { c: ch.sctx, x: x - i * CHUNK, y, solid: ch.solid, w: CHUNK };
}

// (x, y) の下にある地面の高さ。(x, y) が地面や建物の中なら、近いほう（上か下）の外に出てからさがす。
function insideStatic(x, y) {
  const pt = { x, y };
  for (const b of statics) if (Bounds.contains(b.bounds, pt) && Vertices.contains(b.vertices, pt)) return true;
  return false;
}
function surfaceAt(x, y) {
  if (currentMap.endless) { const i = Math.floor(x / (CHUNK * PX)); ensureChunk(i - 1); ensureChunk(i); ensureChunk(i + 1); }
  let yy = y;
  if (insideStatic(x, yy)) {
    let up = yy, down = yy;
    while (up > 0 && insideStatic(x, up)) up -= PX;
    while (down < worldH && insideStatic(x, down)) down += PX;
    yy = (up > 0 && (yy - up <= down - yy || down >= worldH)) ? up : down;
    if (yy >= worldH) yy = up;
  }
  while (yy < worldH + PX && !insideStatic(x, yy + PX)) yy += PX;
  let lo = yy, hi = yy + PX;   // lo は外、hi は中。あいだを半分ずつにして、地面の高さをくわしく決める
  for (let i = 0; i < 5; i++) { const mid = (lo + hi) / 2; if (insideStatic(x, mid)) hi = mid; else lo = mid; }
  return lo;
}

// ---- キャラ（ラグドール）を作る ----
// x, y は頭の中心。opts.angle を入れると、その角度にかたむけて出す。opts.facing は 1 で右向き、-1 で左向き。
// opts.guard は、出てきてからしばらく（コマ数）空中でも立つ力を入れておく時間（着地で足から降りるように）。
function makeChar(kind, x, y, opts = {}) {
  const ch = CHARS[kind];
  const BODY = ch.body ? Object.assign({}, GLOBAL_BODY, ch.body) : GLOBAL_BODY;   // 力士は、胴体や手足が太い
  const tough = ch.tough || 1;
  const g = { kind, dead: false, cause: '', rise: 0, stun: 0, muscle: 1, guard: opts.guard || 0, touchStep: -99, held: 0, blood: 100,
              healCool: 0, wear: {}, facing: opts.facing || settings.facing || (Math.random() < 0.5 ? 1 : -1),
              parts: [], joints: [], legs: [], comp: Composite.create(), head: null, torso: null };
  const u = PX, f = g.facing;
  const group = nextGroup--;
  g.group = group;
  const phys = {
    collisionFilter: { group, category: CAT_BODY, mask: CAT_WORLD | CAT_BODY | CAT_VEH },
    friction: 0.8, frictionStatic: 1, restitution: 0.05, density: ch.density,
  };
  // 部品は四角（角が4つだけなので計算が軽い）
  const part = (pkind, sprite, cx, cy, wd, hd, seg = pkind) => {
    const b = Bodies.rectangle(cx, cy, wd * u, hd * u, phys);
    const hp = PART_HP[pkind] * tough;
    b.plugin = { grape: g, kind: pkind, sprite, seg, hp, maxHp: hp, hurt: 0, burn: 0, bleed: 0, drip: 0,
                 broken: false, detached: false, joint: null, parent: null, jointDmg: 0 };
    return b;
  };
  const [tw, th] = BODY.torso, [aw, ah] = BODY.arm, [lw, lh] = BODY.leg;
  const torsoTop = y + (BODY.head / 2 + BODY.neck) * u;
  const ty = torsoTop + th / 2 * u;                 // 胴体の中心
  const sy = torsoTop + BODY.shoulder * u;          // 肩の高さ
  const hy = torsoTop + (th - BODY.hip) * u;        // 腰の高さ
  const ax = BODY.armX * u * f, lx = BODY.legX * u * f;
  const head = part('head', 'head', x, y, BODY.head, BODY.head);
  const torso = part('torso', 'torso', x, ty, tw, th);
  // 横向きなので、手足は「うしろ側（B）」と「手前側（F）」。うしろ側は暗い色で、体のうしろに描く。
  const uaB = part('arm', 'armB', x - ax, sy + ah / 2 * u, aw, ah, 'armU');
  const laB = part('arm', 'armB', x - ax, sy + ah * 1.5 * u, aw, ah, 'armL');
  const uaF = part('arm', 'armF', x + ax, sy + ah / 2 * u, aw, ah, 'armU');
  const laF = part('arm', 'armF', x + ax, sy + ah * 1.5 * u, aw, ah, 'armL');
  const ulB = part('leg', 'legUB', x - lx, hy + lh / 2 * u, lw, lh, 'legU');
  const llB = part('leg', 'legLB', x - lx, hy + lh * 1.5 * u, lw, lh, 'legL');
  const ulF = part('leg', 'legUF', x + lx, hy + lh / 2 * u, lw, lh, 'legU');
  const llF = part('leg', 'legLF', x + lx, hy + lh * 1.5 * u, lw, lh, 'legL');
  g.parts.push(uaB, laB, ulB, llB, torso, ulF, llF, head, uaF, laF);   // 描く順番（うしろ→まえ）
  g.head = head; g.torso = torso;
  g.legs = [[ulB, llB], [ulF, llF]];

  // 関節。a が体に近いほう（親）、b が先のほう（子）。pointA/pointB はそれぞれの部品の中心から見た位置。
  const half = (d) => d / 2 * u;
  const pin = (a, pa, b, pb, kind) => {
    const c = Constraint.create({ bodyA: a, pointA: pa, bodyB: b, pointB: pb, length: 0, stiffness: 0.9, damping: 0.1 });
    c.limit = JOINT_LIMITS[kind];
    g.joints.push(c);
    b.plugin.joint = c;
    b.plugin.parent = a;
  };
  pin(torso, { x: 0, y: -half(th) - half(BODY.neck) }, head, { x: 0, y: half(BODY.head) + half(BODY.neck) }, 'neck');
  pin(torso, { x: -ax, y: -half(th) + BODY.shoulder * u }, uaB, { x: 0, y: -half(ah) }, 'shoulder');
  pin(torso, { x: ax, y: -half(th) + BODY.shoulder * u }, uaF, { x: 0, y: -half(ah) }, 'shoulder');
  pin(uaB, { x: 0, y: half(ah) }, laB, { x: 0, y: -half(ah) }, 'elbow');
  pin(uaF, { x: 0, y: half(ah) }, laF, { x: 0, y: -half(ah) }, 'elbow');
  pin(torso, { x: -lx, y: half(th) - BODY.hip * u }, ulB, { x: 0, y: -half(lh) }, 'hip');
  pin(torso, { x: lx, y: half(th) - BODY.hip * u }, ulF, { x: 0, y: -half(lh) }, 'hip');
  pin(ulB, { x: 0, y: half(lh) }, llB, { x: 0, y: -half(lh) }, 'knee');
  pin(ulF, { x: 0, y: half(lh) }, llF, { x: 0, y: -half(lh) }, 'knee');

  Composite.add(g.comp, g.parts);
  Composite.add(g.comp, g.joints);
  if (opts.angle) Composite.rotate(g.comp, opts.angle, { x, y: ty });
  Composite.add(world, g.comp);
  chars.push(g);
  return g;
}

// ---- 立つ力 ----
// 生きているキャラは、部品を1つずつまっすぐ（角度0）にもどそうとする。これで立っていられる。
// 空中・つかまれている・気絶・死んでいるときは力がぬける。力はゆっくりもどるので、倒れたあと起き上がる。
// 足が1本でもおれたり、とれたりしていると、体を支えられないので立てない（注射で治すと、また立つ）。
function legSupport(g) {
  let n = 0;
  for (const [up, low] of g.legs) {
    if (!up.plugin.detached && !up.plugin.broken && !low.plugin.detached && !low.plugin.broken) n++;
  }
  return n === 2 ? 1 : 0;
}
function updateMuscles(ts) {
  for (const g of chars) {
    if (g.stun > 0) g.stun -= ts;
    if (g.guard > 0) g.guard -= ts;
    if (g.seat) continue;   // のりものに乗っているあいだは holdPose で座った形をたもつ
    const touching = stepCount - g.touchStep <= 3;
    let target;
    if (g.dead || g.stun > 0) target = 0;
    else if (g.held > 0) { target = 0.12; g.guard = 0; }
    else if (!touching && g.guard <= 0) target = 0;
    else target = g.blood < BLOOD_WEAK ? 0.45 : 1;
    const rate = target > g.muscle ? 0.02 : 0.2;
    g.muscle += (target - g.muscle) * Math.min(1, rate * ts);
    if (g.muscle < 0.01) continue;
    const support = legSupport(g);
    for (const p of g.parts) {
      const pl = p.plugin;
      if (pl.detached || pl.broken) continue;
      const s = MUSCLE[pl.kind] * (pl.kind === 'arm' ? 1 : support) * g.muscle * ts;
      if (s <= 0) continue;
      const av = Body.getAngularVelocity(p);
      const reach = (g.grip && pl.sprite === 'armF') || ((g.chasing || g.swing > 0) && (pl.sprite === 'armF' || pl.sprite === 'armB'));
      const goal = reach ? -1.4 * g.facing : 0;   // 武器を持っている手や、おそうときの手は、前にのばす
      let next = av * (1 - 0.25 * s) - wrapAngle(p.angle - goal) * 0.2 * s;
      // 立つ力だけでは、MAX_SPIN より速くは回せない
      if (Math.abs(next) > MAX_SPIN && Math.abs(next) > Math.abs(av)) next = Math.sign(next) * Math.max(MAX_SPIN, Math.abs(av));
      Body.setAngularVelocity(p, next);
    }
  }
}

// ---- 関節の曲がる向き ----
// 親（A）と子（B）の角度の差が JOINT_LIMITS の外に出たら、中にもどす。もどす勢いは A と B で分け合う（回りにくいほうは少しだけ）。
// 大きくはみ出したとき（ハンマーでなぐられたときなど）は、関節の所を中心に B を回して、すぐにもどす。
function limitJoint(A, B, [lo, hi], f, pivot) {
  const rel = f * wrapAngle(B.angle - A.angle);
  let over = 0;   // + なら hi をこえている、- なら lo をこえている
  if (rel > hi) over = lo + Math.PI * 2 - rel < rel - hi ? rel - lo - Math.PI * 2 : rel - hi;
  else if (rel < lo) over = rel + Math.PI * 2 - hi < lo - rel ? rel + Math.PI * 2 - hi : rel - lo;
  if (!over) return;
  const extra = Math.abs(over) - 0.2;
  if (extra > 0) Body.rotate(B, -f * Math.sign(over) * extra, pivot, false);
  const iA = A.isStatic ? 0 : A.inverseInertia, iB = B.inverseInertia, sum = iA + iB;
  if (!(sum > 0)) return;
  const wA = Body.getAngularVelocity(A), wB = Body.getAngularVelocity(B);
  const relW = f * (wB - wA), back = -over * 0.3;
  const target = over > 0 ? Math.min(relW, back) : Math.max(relW, back);
  const d = (target - relW) * f / sum;
  if (!A.isStatic) Body.setAngularVelocity(A, wA - d * iA);
  Body.setAngularVelocity(B, wB + d * iB);
}
// 関節の場所（世界の中）。Matter は関節の点を、次に計算するときまで回さないので、ここで回しておく
function jointPivot(c) {
  const p = Vector.rotate(c.pointB, c.bodyB.angle - c.angleB);
  return { x: c.bodyB.position.x + p.x, y: c.bodyB.position.y + p.y };
}
function updateJoints() {
  for (const g of chars) {
    for (const c of g.joints) if (c.limit && c.bodyB.plugin.joint === c) limitJoint(c.bodyA, c.bodyB, c.limit, g.facing, jointPivot(c));
    if (g.seat) limitJoint(g.seat.ent.body, g.torso, SEAT_LIMIT, g.facing, hipOf(g));   // 座席の上で、うしろにはたおれない
  }
}

// ---- ケガ ----
// 刃（や注射の針）なら「切る」、それ以外は「ぶつかる」。
function contact(g, part, other, speed, at) {
  const op = other.plugin || {};
  if (op.owner && op.owner.train && stepCount - (g.trainStep || -999) > 120) { g.trainStep = stepCount; SHOP.event('trainHit'); }
  if (op.needle && onEdge(other, at, op.needle)) { inject(g, at, op.needle.kind); return; }
  if (op.blade && (op.blade.all || onEdge(other, at, op.blade))) { cut(g, part, speed, at, op.blade); return; }
  if (op.owner && op.owner.T.bouncy) return;   // トランポリンはやわらかいので、ぶつかってもケガしない
  if (g.guard > 0 && other.isStatic) return;   // 出てきたばかりのキャラは、最初の着地ではケガしない
  const vv = op.owner && (op.owner.V || op.owner.train) ? Body.getVelocity(op.owner.body) : null;
  if (vv && Math.hypot(vv.x, vv.y) > 2 && speed > 3) {   // 走っているのりものにひかれると、倒れる
    speed *= VEHICLE_HIT;
    if (!g.dead) g.stun = Math.max(g.stun, 40 + speed * 6);
    if (speed > 10 && stepCount - (g.runStep || -99) > 60) { g.runStep = stepCount; SHOP.event('runover'); }
  }
  if (speed > HURT) hit(g, part, speed, at, other);
}

// 当たった場所が、刃（または針）のほうか。edge.from は絵のまん中から見て、刃が始まる所（ドット、右向きのとき）
function onEdge(body, at, edge) {
  const ent = body.plugin.owner;
  const dx = at.x - body.position.x, dy = at.y - body.position.y;
  const lx = dx * Math.cos(body.angle) + dy * Math.sin(body.angle) - (ent ? ent.off.x : 0);
  return lx * edge.facing > edge.from * PX;
}

// ぶつかる：ダメージは速さの2乗で増えるので、ちょっとさわったり転んだりしたくらいでは、ほとんど何ともない。
// 相手が重いほど痛い。
function hit(g, part, speed, at, other) {
  const pl = part.plugin;
  const massK = other.isStatic ? 1 : clamp(Math.sqrt(other.mass / (part.mass * 2)), 0.3, 2);
  const dmg = (speed * speed - HURT * HURT) * HURT_K * PART_FACTOR[pl.kind] * massK * settings.damage * (CHARS[g.kind].sparks ? 0.5 : 1);   // ロボは丈夫
  if (dmg < 1) return;
  if (dmg > 70) pl.jointDmg += dmg - 70;   // ものすごい衝撃は関節もこわす
  if (other.isStatic) g.fallStep = stepCount;   // このまま死んだら「落ちて死んだ」（クエスト）
  hurtPart(g, part, dmg, at, Math.min(30, Math.round(dmg / 3)));
  if (other.isStatic) shock(g);
}
// 高い所から落ちると、足や頭が先に地面に当たっても、体全体の勢いで胴体もケガする（1回の着地で1回だけ）
function shock(g) {
  if (stepCount - (g.shockStep || -99) < 20) return;
  const v = Body.getVelocity(g.torso), vb = Math.hypot(v.x, v.y);
  if (vb <= SHOCK) return;
  g.shockStep = g.fallStep = stepCount;
  hurtPart(g, g.torso, (vb * vb - SHOCK * SHOCK) * SHOCK_K * settings.damage, g.torso.position, 6);
}

// 切る：ゆっくりでも切れて、血が出続ける。刺されるほど関節がやられて、おれたり、とれたりする
function cut(g, part, speed, at, blade) {
  if (speed <= CUT) return;
  const pl = part.plugin;
  const dmg = (speed - CUT) * CUT_K * blade.sharp * PART_FACTOR[pl.kind] * settings.damage;
  if (CHARS[g.kind].sparks) {   // ロボは、刃ではほとんど切れない（血も出ないし、関節もこわれない）
    spawnSparks(at.x, at.y, 4);
    SND.play('metal', 0.6);
    hurtPart(g, part, dmg * 0.1, at, 0, 'cut');
    return;
  }
  pl.jointDmg += dmg * (blade.chop || 1);
  pl.bleed += 0.35 + dmg * 0.012;
  SND.play('stab', clamp(dmg / 25, 0.3, 1));
  hurtPart(g, part, dmg, at, Math.min(40, Math.round(dmg / 2) + 4), 'cut');
}

// 弾が当たった
function shot(g, part, at, dir, power) {
  const pl = part.plugin;
  const dmg = power * (pl.kind === 'head' ? 1.5 : PART_FACTOR[pl.kind]) * settings.damage * (CHARS[g.kind].sparks ? 0.6 : 1);
  pl.jointDmg += dmg * 0.7;
  pl.bleed += 0.5;
  const v = Body.getVelocity(part);
  Body.setVelocity(part, { x: v.x + dir.x * power * 0.1, y: v.y + dir.y * power * 0.1 });
  spawnBlood(at.x, at.y, 8, CHARS[g.kind], 8, dir);
  SND.play(CHARS[g.kind].sparks ? 'metal' : 'squish', 0.8);
  hurtPart(g, part, dmg, at, 6, 'shot');
}

// 爆発にまきこまれた（f は近さ。1 がいちばん近い）
function blast(g, part, f) {
  const pl = part.plugin;
  const dmg = Math.pow(f, 1.5) * 220 * PART_FACTOR[pl.kind] * settings.damage;
  pl.jointDmg += dmg * 1.2;
  pl.burn = Math.min(1, pl.burn + f * 1.2);
  if (dmg > 20) pl.bleed += dmg * 0.01;
  hurtPart(g, part, dmg, part.position, Math.min(20, Math.round(dmg / 5)), 'blast');
}

// how は何でケガしたか（なし＝ぶつかった、'cut' 刃、'shot' 弾、'blast' 爆発、'pull' 刺さった物が抜けた）。
// 刃で切られたり刺されたりしても、それだけでは倒れない（手足がおれたり、とれたりすると倒れる）。
function hurtPart(g, part, dmg, at, nBlood, how) {
  const pl = part.plugin;
  dmg *= guard(g, part);
  pl.hp -= dmg;
  pl.hurt = Math.min(1, pl.hurt + dmg / 60);
  if (!g.dead && how !== 'cut' && how !== 'pull') {
    if (pl.kind === 'head' && dmg > 8) g.stun = Math.min(360, g.stun + dmg * 3);   // 頭を強く打つと気絶する
    else if (dmg > 25) g.stun = Math.min(150, g.stun + dmg);
  }
  if (!how) {
    if (dmg > 25) pl.bleed += dmg * 0.004;   // 強く打つと少し血が出る
    SND.play(CHARS[g.kind].sparks ? 'metal' : 'hit', clamp(dmg / 40, 0.25, 1));
  }
  if (nBlood > 0) bleed(g, at.x, at.y, nBlood);
  checkPart(g, part);
}

// 骨がおれた？ 関節がとれた？ 死んだ？
function checkPart(g, part) {
  const pl = part.plugin;
  const tough = CHARS[g.kind].tough || 1;
  if (pl.joint && SEVER[pl.kind] && pl.jointDmg >= SEVER[pl.kind] * tough) sever(g, part);
  if (pl.hp <= 0 && !pl.broken && (pl.kind === 'arm' || pl.kind === 'leg')) {
    pl.broken = true;   // もう力が入らない
    SHOP.event('bone');
    SND.play('crack', 0.9);
    sayFor(g, CHARS[g.kind].sparks ? 'ガキッ' : 'ボキッ', part.position.x, part.position.y - 20);
  }
  if (pl.hp <= 0 && (pl.kind === 'head' || pl.kind === 'torso')) kill(g, pl.kind);
}

// 関節がとれる。とれた部品（ひじやひざから先も一緒）は、体とは別の物になって、体にもぶつかるようになる
function sever(g, part) {
  const pl = part.plugin, j = pl.joint;
  if (!j) return;
  const at = { x: pl.parent.position.x + j.pointA.x, y: pl.parent.position.y + j.pointA.y };
  Composite.remove(g.comp, j);
  pl.joint = null;
  const group = nextGroup--;
  for (const q of g.parts) {
    if (q !== part && !isBelow(q, part)) continue;
    q.plugin.detached = true;
    q.collisionFilter = { group, category: CAT_BODY, mask: CAT_WORLD | CAT_BODY | (g.seat || g.noVeh > 0 ? 0 : CAT_VEH) };
  }
  pl.bleed += 1.2;
  pl.parent.plugin.bleed += 2;   // 体のほうの傷口から、血がふき出す
  bleed(g, at.x, at.y, 26, 18);
  SND.play('rip', 1);
  SHOP.event('sever');
  if (!g.allLimbs && g.parts.filter((q) => q.plugin.joint === null && (q.plugin.kind === 'arm' || q.plugin.kind === 'leg') &&
                                        q.plugin.parent && q.plugin.parent.plugin.kind === 'torso').length === 4) {
    g.allLimbs = true;   // 手足が4本ぜんぶとれた
    SHOP.event('allLimbs');
  }
  sayFor(g, CHARS[g.kind].sparks ? 'バキン' : 'ブチッ', at.x, at.y - 20);
  if (pl.kind === 'head') kill(g, 'head');
}
function isBelow(q, part) {
  for (let p = q.plugin.parent; p; p = p.plugin.parent) if (p === part) return true;
  return false;
}

// 爆発のあと少しの間（BOOM_WINDOW コマ）に死んだキャラは、その爆発でたおしたことにする（つづけて爆発したら、ひとつの大爆発）
const BOOM_WINDOW = 90;
let boom = null;
function kill(g, cause) {
  if (g.dead) return;
  g.dead = true;
  g.cause = cause;
  deadCount++;
  if (boom && stepCount - boom.step <= BOOM_WINDOW && ++boom.kills === 5) SHOP.event('multiKill');
  const robot = CHARS[g.kind].sparks;
  say(robot ? 'こわれた…' : '死んだ…', g.torso.position.x, g.torso.position.y - 80, '#ff4444');
  SND.play('death', 0.8, robot ? 0.6 : 1);
  g.rise = 0;
  if (!g.counted) { g.counted = true; SHOP.event('kill'); }   // 生き返ってまたたおしても、1体は1回だけ
  if (stepCount - (g.fallStep || -99) <= 2) SHOP.event('fallKill');
  if (SHOP.killCoins && !g.paid) {   // たおすとコインがもらえる（1体につき1回だけ。生き返らせても、もうもらえない）
    g.paid = true;
    SHOP.addCoins(SHOP.killCoins);
    say('+' + SHOP.killCoins + '🪙', g.torso.position.x, g.torso.position.y - 45, '#ffd24a', true);
  }
}

// ゾンビは、死んでも頭がついていれば、しばらくすると起き上がる（とれた手足はもどらない）
const RISE_TIME = 300;
function rise(g) {
  for (const p of g.parts) {
    const pl = p.plugin;
    if (pl.detached) continue;
    pl.hp = Math.max(pl.hp, pl.maxHp * 0.5); pl.broken = false; pl.jointDmg = 0; pl.bleed = 0; pl.hurt = Math.min(pl.hurt, 0.5);
  }
  g.blood = Math.max(g.blood, 60);
  g.dead = false; g.cause = ''; g.stun = 0; g.guard = 60; g.rise = 0;
  say('ゾンビ復活！', g.head.position.x, g.head.position.y - 50, '#9dff8a');
  SND.play('groan', 0.9);
}

// 回復の注射：ケガとおれた骨を治して、血をもどす。死んでいても、頭がついていれば生き返る（とれた手足はもどらない）
function heal(g, at) {
  if (g.healCool > 0) return;
  g.healCool = 40;
  for (const p of g.parts) {
    const pl = p.plugin;
    if (pl.detached) continue;
    pl.hp = pl.maxHp; pl.broken = false; pl.hurt = 0; pl.burn = 0; pl.bleed = 0; pl.jointDmg = 0;
  }
  g.blood = 100;
  g.stun = 0;
  g.fire = 0;
  g.poison = 0;
  const revived = g.dead && !g.head.plugin.detached;
  if (revived) { g.dead = false; g.cause = ''; g.guard = 60; SHOP.event('revive'); }
  for (let i = 0; i < 14; i++) {
    addFx({ x: at.x + rand(-20, 20), y: at.y + rand(-20, 20), vx: rand(-1, 1), vy: rand(-3, -1), g: 0, drag: 0.96,
            life: 40, size: PX, colors: ['#e8ffe0', '#9dff8a', '#58c26a'] });
  }
  SND.play('heal', 0.9);
  say(revived ? '生き返った！' : '元気になった！', g.head.position.x, g.head.position.y - 50, '#7dff7a');
}

// 注射の針が刺さった：kind は heal（回復）、poison（どく）、sleep（ねむらせる）、zombie（ゾンビにする）、draw（ちをぬく）
function inject(g, at, kind = 'heal') {
  if (g.injCool > 0) return;
  if (CHARS[g.kind].sparks) {   // ロボには、注射の針が入らない
    g.injCool = 40;
    SND.play('metal', 0.5);
    say('ロボには きかない！', g.head.position.x, g.head.position.y - 50, '#dddddd');
    return;
  }
  if (kind === 'heal') { heal(g, at); return; }
  g.injCool = 40;
  SND.play('click', 0.7);
  const hx = g.head.position.x, hy = g.head.position.y - 50;
  if (kind === 'poison' && !g.dead) { SHOP.event('poison'); g.poison = 900; say('どく…', hx, hy, '#c07aff'); }
  else if (kind === 'sleep' && !g.dead) { g.stun = 900; say('ぐー…', hx, hy, '#7ab8ff'); }
  else if (kind === 'draw' && !g.dead) { g.blood = Math.max(0, g.blood - 60); bleed(g, at.x, at.y, 14); say('ちがぬけた…', hx, hy, '#ff6060'); }
  else if (kind === 'zombie' && !CHARS[g.kind].undead) {
    if (!SHOP.owns('zombie')) { say('ゾンビを ショップで買うと、使えるよ', hx, hy, '#ffffff'); return; }   // ゾンビの注射で、ショップのゾンビを、ただで手に入れられないようにする
    g.kind = CHARS[g.kind].zombieOf || 'zombie';
    if (g.dead && !g.head.plugin.detached) rise(g); else say('ゾンビになった！', hx, hy, '#9dff8a');
  }
}

// 火：もえている間、体の部品がこげて、ケガをする（水に入ると消える）。しかばねも、こげる
const FIRE_TIME = 420, FIRE_DAMAGE = 0.3;
function ignite(g) {
  const already = g.fire > 0;
  g.fire = FIRE_TIME;
  if (already) return;
  SHOP.event('burn');
  SND.play('sizzle', 0.8);
  if (!g.dead) sayFor(g, CHARS[g.kind].sparks ? 'ジュッ' : 'あちっ！', g.head.position.x, g.head.position.y - 40);
}
function updateFire(g, ts) {
  g.fire -= ts;
  const L = liquidAt(g.torso.position.x, g.torso.position.y);
  if (L && L.kind === 'water') { g.fire = 0; sizzle(g.torso.position.x, L.y); return; }
  if (stepCount % 10 === 0) SND.play('sizzle', 0.25);
  for (const p of g.parts) {
    const pl = p.plugin;
    if (pl.detached) continue;
    pl.burn = Math.min(1, pl.burn + 0.004 * ts);
    if (Math.random() < 0.15 * ts) {
      addFx({ x: p.position.x + rand(-8, 8), y: p.position.y + rand(-8, 8), vx: rand(-0.5, 0.5), vy: rand(-2.5, -1), g: -0.02, drag: 0.97,
              life: rand(15, 35), size: PX * rand(1, 2), colors: ['#fff3b0', '#ffd24a', '#ff8a1f', '#e8501a', '#5a4a44'] });
    }
    if (g.dead) continue;
    pl.hp -= FIRE_DAMAGE * ts * settings.damage;
    pl.hurt = Math.min(1, pl.hurt + 0.002 * ts);
    checkPart(g, p);
    if (g.dead) break;
  }
}
// 火炎びんが割れた：まわりのキャラに火がつく
function firebomb(x, y, power) {
  const R = 40 * PX * power;
  for (const g of chars) if (g.parts.some((p) => Math.hypot(p.position.x - x, p.position.y - y) < R)) ignite(g);
  for (let i = 0; i < 34; i++) {
    const a = rand(Math.PI, Math.PI * 2), sp = rand(1, 7) * power;
    addFx({ x: x + rand(-10, 10), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.05, drag: 0.94, life: rand(25, 55), size: PX * rand(1.5, 3),
            colors: ['#fff3b0', '#ffd24a', '#ff8a1f', '#e8501a', '#5a4a44'] });
  }
  scorch(x, y, Math.round(R / PX * 0.3));
  SND.play('boom', 0.4);
  SND.play('sizzle', 0.9);
}


// ---- キャラの行動：うろうろあるく、ほかのキャラをおそう ----
// CHARS の behavior が 'wander' なら、ときどき向きを変えて、うろうろあるく。'attack' なら、ちかくのほかのキャラを見つけて、おいかけて、
// 手のとどく所まで来たら、こうげきする（かみつく・なぐる）。speed はあるくはやさ、power はこうげきの強さ。
// 立っているときだけ、うごく（ころんだら、たおれたまま）。ゾンビ（undead）どうしは、おそいあわない。ゾンビにころされたキャラは、ゾンビになる
const SIGHT = 140 * PX, REACH = 24 * PX, ATTACK_COOL = 55;
const isFriend = (a, b) => a.kind === b.kind || (CHARS[a.kind].undead && CHARS[b.kind].undead);
// 体ごと、左右をひっくりかえす（うしろ向きに歩かないように）。部品の場所・かたむき・関節の位置を、胴体をとおるたての線で、鏡うつしにする
function turnAround(g) {
  if (g.grip || g.seat || g.held > 0 || stepCount - (g.turnStep || -999) < 45) return;
  g.turnStep = stepCount;
  const cx = g.torso.position.x;
  for (const p of g.parts) {
    const v = Body.getVelocity(p), w = Body.getAngularVelocity(p);
    Body.setPosition(p, { x: 2 * cx - p.position.x, y: p.position.y }, false);
    Body.setAngle(p, -p.angle, false);
    Body.setVelocity(p, { x: -v.x, y: v.y });
    Body.setAngularVelocity(p, -w);
  }
  for (const c of g.joints) { c.pointA.x = -c.pointA.x; c.pointB.x = -c.pointB.x; }
  g.facing = -g.facing;
}
function nearestTarget(g) {
  let best = null, bestD = SIGHT;
  for (const o of chars) {
    if (o === g || o.dead || isFriend(g, o) || o.seat) continue;
    const dx = o.torso.position.x - g.torso.position.x, dy = o.torso.position.y - g.torso.position.y;
    if (Math.abs(dy) > 70 * PX) continue;
    const d = Math.abs(dx);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}
function attackChar(g, t, only) {   // only はテスト用：この種類の部品をねらう
  const ch = CHARS[g.kind], at = handPoint(g);
  let part = null, bd = Infinity;
  for (const p of t.parts) {
    if (p.plugin.detached || (only && p.plugin.kind !== only)) continue;
    const d = Math.hypot(p.position.x - at.x, p.position.y - at.y);
    if (d < bd) { bd = d; part = p; }
  }
  if (!part) return;
  g.swing = 22;
  g.atkCool = ATTACK_COOL;
  const dir = Math.sign(t.torso.position.x - g.torso.position.x) || g.facing;
  const dmg = 16 * (ch.power || 1) * settings.damage;
  part.plugin.bleed += 0.4;
  Body.setVelocity(t.torso, { x: dir * (3 + (ch.power || 1) * 1.5), y: -2 });
  SND.play(CHARS[t.kind].sparks ? 'metal' : 'squish', 0.8);
  const before = t.dead;
  hurtPart(t, part, dmg, part.position, 5, 'cut');
  if (!before && t.dead && ch.undead && !CHARS[t.kind].sparks && !CHARS[t.kind].undead) {   // ゾンビにころされたキャラは、しばらくすると、ゾンビになって起き上がる
    t.kind = CHARS[t.kind].zombieOf || 'zombie';
    t.rise = RISE_TIME - 150;
    say('ゾンビに なる…', t.head.position.x, t.head.position.y - 50, '#9dff8a');
  }
}
function updateAI(ts) {
  for (const g of chars) {
    if (g.swing > 0) g.swing -= ts;
    if (g.atkCool > 0) g.atkCool -= ts;
    g.chasing = false;
    const ch = CHARS[g.kind], mode = ch.behavior;
    if (!mode || mode === 'still' || g.dead || g.stun > 0 || g.seat || g.held > 0) continue;
    if (stepCount - g.touchStep > 3 || g.muscle < 0.5) continue;   // 地面に立っているときだけ
    const speed = 0.4 + (ch.speed || 2) * 0.5;
    let dir = 0, face = 0;
    if (mode === 'attack') {
      const t = nearestTarget(g);
      if (t) {
        const dx = t.torso.position.x - g.torso.position.x;
        face = Math.sign(dx) || g.facing;
        g.chasing = true;
        if (Math.abs(dx) > REACH * 0.7) dir = face;
        else if (!(g.atkCool > 0)) attackChar(g, t);
      }
    } else {   // wander
      if (!g.wander || g.wander.until <= stepCount) g.wander = { dir: [-1, 0, 1, 1, -1][Math.floor(Math.random() * 5)], until: stepCount + 90 + Math.floor(Math.random() * 150) };
      dir = face = g.wander.dir;
    }
    if (face && face !== g.facing) turnAround(g);
    if (dir && dir === g.facing) {
      for (const p of g.parts) {
        if (p.plugin.detached) continue;
        const v = Body.getVelocity(p);
        Body.setVelocity(p, { x: v.x + (dir * speed - v.x) * 0.25, y: v.y });
      }
    }
  }
}

// 出血・ケガの回復・出血で死ぬ
function updateChars(ts) {
  for (const g of chars) {
    if (g.healCool > 0) g.healCool -= ts;
    if (g.injCool > 0) g.injCool -= ts;
    if (g.grip && g.grip.hand.plugin.detached) unequip(g);
    let bleeding = 0;
    for (const p of g.parts) {
      const pl = p.plugin;
      if (pl.bleed > 0) {
        bleeding += pl.bleed;
        pl.drip += pl.bleed * ts;
        if (pl.drip >= 5) { pl.drip -= 5; spawnBlood(p.position.x, p.position.y, 1, CHARS[g.kind], 3); }
        pl.bleed = Math.max(0, pl.bleed * (1 - 0.0015 * ts) - 0.0003 * ts);   // 血はじわじわ止まる
      }
      if (!g.dead && !pl.detached) {
        if (!pl.broken && pl.hp < pl.maxHp) pl.hp = Math.min(pl.maxHp, pl.hp + 0.03 * ts);   // ケガは少しずつ治る
        if (pl.hurt > 0) pl.hurt = Math.max(0, pl.hurt - 0.0005 * ts);
      }
    }
    if (g.fire > 0) updateFire(g, ts);
    if (g.dead) {
      g.poison = 0;
      if (CHARS[g.kind].undead && !g.head.plugin.detached && (g.rise += ts) > RISE_TIME) rise(g);
      continue;
    }
    if (g.poison > 0) {   // どく：血がへって、顔色がわるくなる
      g.poison -= ts;
      g.blood -= 0.12 * ts;
      g.head.plugin.hurt = Math.max(g.head.plugin.hurt, 0.5);
      if (Math.random() < 0.05 * ts) {
        addFx({ x: g.head.position.x + rand(-10, 10), y: g.head.position.y - 10, vx: rand(-0.3, 0.3), vy: rand(-1.5, -0.5), g: 0, drag: 0.98,
                life: rand(25, 45), size: PX * rand(0.8, 1.4), colors: ['#c07aff', '#a04ad0', '#6a2a90'] });
      }
      if (g.blood <= BLOOD_DEAD) kill(g, 'poison');
      if (g.dead) continue;
    }
    g.blood -= bleeding * 0.03 * (CHARS[g.kind].bleedRate || 1) * ts;
    if (bleeding < 0.05) g.blood = Math.min(100, g.blood + 0.004 * ts);
    if (g.blood <= BLOOD_DEAD) kill(g, 'blood');
  }
}

// ---- 血・オイル ----
function bleed(g, x, y, n, spread = 14) {
  const ch = CHARS[g.kind];
  if (ch.sparks) spawnSparks(x, y, Math.min(12, 2 + n));
  spawnBlood(x, y, n, ch, spread);
}
function spawnBlood(x, y, n, ch, spread, dir) {
  n = Math.round(n * settings.blood);
  const rainbow = settings.rainbow && SHOP.owns('rainbow');   // にじ色の血（ショップで買って、せっていでえらぶ）
  for (let i = 0; i < n; i++) {
    if (bloods.length > 260) { const old = bloods.shift(); stamp(old); }
    const s = PX * (0.5 + Math.random() * 0.5), hue = Math.floor(Math.random() * 360);
    const b = Bodies.rectangle(x, y, s, s, {
      collisionFilter: { category: CAT_BLOOD, mask: CAT_WORLD | CAT_VEH },
      friction: 0.9, frictionAir: 0.01, restitution: 0, density: 0.0005,
      plugin: { kind: 'blood', age: 0, still: 0, size: s,
                color: rainbow ? `hsl(${hue}, 90%, 58%)` : ch.blood, stain: rainbow ? `hsl(${hue}, 70%, 34%)` : ch.stain },
    });
    Body.setVelocity(b, {
      x: (Math.random() - 0.5) * spread + (dir ? dir.x * spread * 0.8 : 0),
      y: -Math.random() * spread * 0.7 - 2 + (dir ? dir.y * spread * 0.8 : 0),
    });
    bloods.push(b);
    Composite.add(world, b);
  }
}
// 止まった血のつぶは、地面の上ならシミとして焼きつけて、物理からは消す（軽くするため）
function stamp(b) {
  const s = stainAt(Math.floor(b.position.x / PX), Math.floor(b.position.y / PX));
  if (s && s.y + 2 < s.solid.length / s.w && (s.solid[s.y * s.w + s.x] || s.solid[(s.y + 1) * s.w + s.x] || s.solid[(s.y + 2) * s.w + s.x])) {
    s.c.fillStyle = b.plugin.stain;
    s.c.fillRect(s.x, s.y, 1, 1);
  }
  Composite.remove(world, b);
}
function updateBlood(ts) {
  for (let i = bloods.length - 1; i >= 0; i--) {
    const b = bloods[i], p = b.plugin;
    const v = Body.getVelocity(b);
    p.age += ts;
    p.still = Math.hypot(v.x, v.y) < 0.2 ? p.still + ts : 0;
    if (liquidAt(b.position.x, b.position.y)) { Composite.remove(world, b); bloods.splice(i, 1); continue; }   // 水や溶岩に入った血は消える
    if (p.still > 15 || p.age > 240 || b.position.y > worldH + 50) { stamp(b); bloods.splice(i, 1); }
  }
}

// ---- 物（武器・銃・爆弾・のりもの・箱など） ----
// rects は当たり判定の四角 [絵の中の x, y, はば, 高さ, 重さ]（ドット）。circle は丸の半径（ドット）。
// blade は刃（from は絵のまん中から見て刃が始まる所）、sharp はするどさ。stick は刺さったときに入る深さの最大（ドット）。
// needle は回復の注射の針。chop は、関節を何倍こわしやすいか（おの）。saw はチェーンソー（タップで動いて、当てると切れつづける）。
// litSprite は火がついた後の絵。bouncy はトランポリン。balloon は風船（variants の絵からどれか1つ）。airDrag は空気のていこう。
// gun は銃（muzzle は絵の中の銃口の場所、power は威力）。bomb は爆弾（fuse は火がついてから爆発までのコマ数）。
// layer は描く順番（0 キャラのうしろ、1 キャラのまえ、2 いちばんまえ）。mat はぶつかったときの音。
const THINGS = {
  knife:    { tab: 'weapons', name: 'ナイフ', sprite: 'knife', rects: [[0, 0, 12, 3]], density: 0.002, layer: 2, mat: 'metal',
              blade: { from: -2, sharp: 1 }, stick: 6 },
  katana:   { tab: 'weapons', name: '刀', sprite: 'katana', rects: [[0, 0, 22, 3]], density: 0.0015, layer: 2, mat: 'metal',
              blade: { from: -5, sharp: 1.7 }, stick: 13 },
  hammer:   { tab: 'weapons', name: 'ハンマー', sprite: 'hammer', rects: [[0, 2, 10, 2, 0.002], [10, 0, 4, 6, 0.012]], layer: 2,
              mat: 'metal' },
  axe:      { tab: 'weapons', name: 'おの', sprite: 'axe', rects: [[0, 4, 9, 2, 0.002], [8, 0, 6, 7, 0.01]], layer: 2, mat: 'metal',
              blade: { from: 1, sharp: 1.3, chop: 2 }, stick: 4 },
  spear:    { tab: 'weapons', name: 'やり', sprite: 'spear', rects: [[0, 0, 26, 3]], density: 0.0012, layer: 2, mat: 'wood',
              blade: { from: 7, sharp: 1.2 }, stick: 12 },
  chainsaw: { tab: 'weapons', name: 'チェーンソー', sprite: 'chainsaw', rects: [[0, 2, 10, 6, 0.004], [10, 3, 16, 3, 0.002]], layer: 2,
              mat: 'metal', saw: { from: -3, sharp: 1.2 } },
  bat:      { tab: 'weapons', name: 'バット', sprite: 'bat', rects: [[0, 1, 9, 2, 0.001], [9, 0, 13, 4, 0.004]], layer: 2, mat: 'wood' },
  cleaver:  { tab: 'weapons', name: 'ほうちょう', sprite: 'cleaver', rects: [[0, 2, 4, 2, 0.001], [4, 0, 8, 6, 0.003]], layer: 2, mat: 'metal',
              blade: { from: -2, sharp: 1.3, chop: 1.5 } },
  pan:      { tab: 'weapons', name: 'フライパン', sprite: 'pan', rects: [[0, 2, 8, 2, 0.001], [8, 0, 10, 6, 0.006]], layer: 2, mat: 'metal' },
  shotgun:  { tab: 'guns', name: 'ショットガン', sprite: 'shotgun', rects: [[0, 0, 24, 3], [0, 3, 7, 2]], density: 0.003, layer: 2, mat: 'metal',
              gun: { muzzle: [24, 1.5], power: 14, pellets: 7, spread: 0.16, recoil: 6, sound: 'bang' } },
  pistol:   { tab: 'guns', name: 'ピストル', sprite: 'pistol', rects: [[0, 0, 11, 3], [1, 3, 5, 3]], density: 0.003, layer: 2, mat: 'metal',
              gun: { muzzle: [11, 1], power: 30, recoil: 4, sound: 'bang' } },
  mgun:     { tab: 'guns', name: 'マシンガン', sprite: 'mgun', rects: [[0, 1, 20, 3], [0, 4, 9, 2, 0.008]], density: 0.003, layer: 2, mat: 'metal',
              gun: { muzzle: [20, 1.5], power: 16, recoil: 0.8, sound: 'mg', auto: true, every: 5, spread: 0.05 } },
  launcher: { tab: 'guns', name: 'ロケットランチャー', sprite: 'launcher', rects: [[0, 1, 24, 3], [7, 4, 2, 2]], density: 0.003, layer: 2,
              mat: 'metal', gun: { rocket: true, muzzle: [24, 2.5], speed: 18, power: 1.1, recoil: 3 } },
  bomb:     { tab: 'bombs', name: '爆弾', sprite: 'bomb', circle: 4.5, circleAt: [4.5, 6.5], density: 0.004, layer: 1, mat: 'metal',
              bomb: { fuse: 180, power: 1, tip: [6.5, 0.5] } },
  tnt:      { tab: 'bombs', name: 'ばくはつ樽', sprite: 'tnt', rects: [[0, 0, 8, 10]], density: 0.003, layer: 1, mat: 'wood',
              bomb: { fuse: 20, power: 1.3, impact: 12 } },
  grenade:  { tab: 'bombs', name: '手りゅう弾', sprite: 'grenade', litSprite: 'grenadeLit', rects: [[1, 3, 6, 6]], density: 0.004,
              layer: 1, mat: 'metal', bomb: { fuse: 120, power: 0.9, pin: true } },
  dynamite: { tab: 'bombs', name: 'ダイナマイト', sprite: 'dynamite', rects: [[0, 2, 5, 9]], density: 0.003, layer: 1, mat: 'wood',
              bomb: { fuse: 150, power: 1.2, tip: [3.5, 0.5] } },
  molotov:  { tab: 'bombs', name: '火炎びん', sprite: 'molotov', rects: [[0, 2, 6, 9]], density: 0.002, layer: 1, mat: 'metal',
              bomb: { fuse: 120, power: 1, fire: true, impact: 7, tip: [2.5, 0.5] } },
  car:      { tab: 'vehicles', name: '車', vehicle: 'car' },
  truck:    { tab: 'vehicles', name: 'トラック', vehicle: 'truck' },
  bike:     { tab: 'vehicles', name: 'バイク', vehicle: 'bike' },
  tank:     { tab: 'vehicles', name: '戦車', vehicle: 'tank' },
  box:      { tab: 'things', name: '木箱', crate: true, layer: 0, mat: 'wood' },
  barrel:   { tab: 'things', name: 'ドラム缶', sprite: 'barrel', rects: [[0, 0, 8, 11]], density: 0.006, layer: 0, mat: 'metal' },
  ball:     { tab: 'things', name: 'ボール', sprite: 'ball', circle: 5, density: 0.0006, restitution: 0.85, layer: 0, mat: 'rubber' },
  ironball: { tab: 'things', name: '鉄球', sprite: 'ironball', circle: 6, density: 0.02, layer: 0, mat: 'metal' },
  stone:    { tab: 'things', name: 'いし', sprite: 'stone', rects: [[0, 0, 12, 9]], density: 0.012, layer: 0, mat: 'metal' },
  anvil:    { tab: 'things', name: 'かなとこ', sprite: 'anvil', rects: [[0, 0, 16, 3], [3, 3, 10, 3], [1, 6, 14, 3]], density: 0.03, layer: 0, mat: 'metal' },
  club:     { tab: 'weapons', name: 'こんぼう', sprite: 'club', rects: [[0, 2, 10, 2, 0.001], [10, 0, 12, 6, 0.006]], layer: 2, mat: 'wood' },
  sword:    { tab: 'weapons', name: 'ロングソード', sprite: 'sword', rects: [[0, 1, 30, 3]], density: 0.0016, layer: 2, mat: 'metal',
              blade: { from: -9, sharp: 1.8 }, stick: 16 },
  sledge:   { tab: 'weapons', name: '大ハンマー', sprite: 'sledge', rects: [[0, 4, 20, 2, 0.002], [20, 0, 8, 10, 0.022]], layer: 2, mat: 'metal' },
  sniper:   { tab: 'guns', name: 'スナイパー', sprite: 'sniper', rects: [[0, 1, 34, 2], [0, 3, 12, 2]], density: 0.003, layer: 2, mat: 'metal',
              gun: { muzzle: [34, 2], power: 70, recoil: 9, sound: 'bang' } },
  flame:    { tab: 'guns', name: 'かえんほうしゃき', sprite: 'flame', rects: [[0, 0, 8, 8], [8, 2, 14, 3]], density: 0.003, layer: 2, mat: 'metal',
              gun: { muzzle: [22, 3.5], power: 0, ignite: true, range: 55 * PX, recoil: 0.3, sound: 'sizzle', auto: true, every: 4, spread: 0.12 } },
  landmine: { tab: 'bombs', name: 'じらい', sprite: 'mine', rects: [[0, 0, 12, 4]], density: 0.004, layer: 0, mat: 'metal',
              bomb: { fuse: 25, power: 1.1, prox: 26 } },
  bowling:  { tab: 'things', name: 'ボーリングのたま', sprite: 'bowling', circle: 4.5, density: 0.02, layer: 0, mat: 'metal' },
  tire:     { tab: 'things', name: 'タイヤ', sprite: 'tire', circle: 6, density: 0.001, restitution: 0.7, layer: 0, mat: 'rubber' },
  tv:       { tab: 'things', name: 'テレビ', sprite: 'tv', rects: [[0, 2, 14, 9]], density: 0.003, layer: 0, mat: 'metal' },
  dumbbell: { tab: 'things', name: 'ダンベル', sprite: 'dumbbell', rects: [[0, 0, 6, 8], [6, 3, 10, 2], [16, 0, 6, 8]], density: 0.02, layer: 0, mat: 'metal' },
  syringe:  { tab: 'syringes', name: '回復の注射', sprite: 'syringe', rects: [[0, 0, 14, 3]], density: 0.002, layer: 2, mat: 'metal',
              needle: 4 },
  syringePoison: { tab: 'syringes', name: 'どくの注射', sprite: 'syringePoison', rects: [[0, 0, 14, 3]], density: 0.002, layer: 2, mat: 'metal',
                   needle: 4, inject: 'poison' },
  syringeSleep:  { tab: 'syringes', name: 'ますいの注射', sprite: 'syringeSleep', rects: [[0, 0, 14, 3]], density: 0.002, layer: 2, mat: 'metal',
                   needle: 4, inject: 'sleep' },
  syringeZombie: { tab: 'syringes', name: 'ゾンビの注射', sprite: 'syringeZombie', rects: [[0, 0, 14, 3]], density: 0.002, layer: 2, mat: 'metal',
                   needle: 4, inject: 'zombie' },
  syringeDraw:   { tab: 'syringes', name: 'ちをぬく注射', sprite: 'syringeDraw', rects: [[0, 0, 14, 3]], density: 0.002, layer: 2, mat: 'metal',
                   needle: 4, inject: 'draw' },
  trampoline: { tab: 'things', name: 'トランポリン', sprite: 'trampoline', rects: [[0, 0, 24, 2], [1, 2, 2, 4, 0.02], [21, 2, 2, 4, 0.02]],
                density: 0.006, layer: 0, mat: 'rubber', bouncy: true },
  balloon:  { tab: 'things', name: '風船', sprite: 'balloon0', variants: BALLOON_COLORS.map((c, i) => 'balloon' + i), circle: 3.5,
              circleAt: [3.5, 3.5], density: 0.0006, airDrag: 0.03, layer: 1, mat: 'rubber', balloon: true },
};
// のりもの：ax, ay は絵のどこを出す場所に合わせるか、rects は当たり判定 [x, y, はば, 高さ, 重さ]、wheels はタイヤの場所、
// r はタイヤの半径、top はいちばん速い速さ、accel は1コマでどれだけ速くなるか（タイヤが地面についているときだけ）、
// exhaust は排気ガスの出る所。seats は座る所（x, y は腰の場所、pose は座り方）。
// cover なら、乗っている人を車体のうしろに描いて、clip [x, y, はば, 高さ] の中だけ見せる（窓から頭が見えて、足は車体にかくれる）。
// gun は大砲（絵の turret より上をタップすると撃つ）。ぜんぶ絵の中の場所（ドット、右向き）
const VEHICLES = {
  car:   { sprite: 'car', glass: 'carGlass', ax: 35, ay: 16, density: 0.004, top: 7, accel: 0.2, exhaust: [1, 26],
           rects: [[1, 14, 68, 15], [15, 0, 35, 3]], wheels: [[14.5, 29.5], [56.5, 29.5]], r: 7, wheel: 'wheel14',
           seats: [{ x: 43, y: 23, pose: 'sit' }, { x: 23, y: 23, pose: 'sit' }], cover: true, clip: [6, -30, 58, 50] },
  truck: { sprite: 'truck', glass: 'truckGlass', ax: 48, ay: 18, density: 0.004, top: 6, accel: 0.18, exhaust: [4, 29],
           rects: [[1, 21, 63, 7], [1, 14, 3, 7], [60, 14, 4, 7], [64, 15, 32, 16], [64, 2, 22, 3], [64, 5, 3, 10]],
           wheels: [[15.5, 31.5], [41.5, 31.5], [83.5, 31.5]], r: 7.5, wheel: 'wheel15',
           seats: [{ x: 77, y: 25, pose: 'sit' }], cover: true, clip: [67, -30, 26, 50] },
  bike:  { sprite: 'bike', ax: 22, ay: 11, density: 0.004, top: 9, accel: 0.22, exhaust: [2, 14],
           rects: [[8, 4, 25, 11]], wheels: [[7.5, 16.5], [36.5, 16.5]], r: 5.5, wheel: 'bikeWheel',
           seats: [{ x: 15, y: 4, pose: 'ride' }] },
  tank:  { sprite: 'tank', ax: 44, ay: 16, density: 0.006, top: 3.5, accel: 0.22, exhaust: [2, 20],
           rects: [[3, 12, 81, 8], [9, 20, 69, 4], [25, 4, 32, 8], [58, 7, 30, 3, 0.002]],
           wheels: [[13.5, 25], [28.5, 25], [43.5, 25], [58.5, 25], [73.5, 25]], r: 4, wheel: 'tankWheel',
           seats: [{ x: 40, y: 13, pose: 'hatch' }], cover: true, clip: [30, -30, 20, 35],
           gun: { turret: 12, muzzle: [88, 8], speed: 26, power: 0.9, recoil: 5 } },
};

// (x, y) は絵のまん中（のりものは ax, ay の所）
function makeThing(id, x, y, facing = 1) {
  const T = THINGS[id];
  if (T.vehicle) return makeVehicle(id, x, y, facing);
  const f = facing;
  let spr, body, ax, ay, variant = 0;
  if (T.crate) {
    const n = [8, 10, 12][Math.floor(Math.random() * 3)];   // 何ドット四方か
    spr = crateSprite(n); ax = ay = n / 2;
    body = Bodies.rectangle(x, y, n * PX, n * PX, { density: 0.0018, friction: 0.6, restitution: 0.1 });
  } else if (T.circle) {
    variant = T.variants ? Math.floor(Math.random() * T.variants.length) : 0;
    spr = OBJ_SPRITES[T.variants ? T.variants[variant] : T.sprite];
    [ax, ay] = T.circleAt || [spr.width / 2, spr.height / 2];
    body = Bodies.circle(x, y, T.circle * PX, { density: T.density, friction: 0.6, frictionAir: T.airDrag || 0.005,
                                                restitution: T.restitution || 0.1 });
  } else {
    spr = OBJ_SPRITES[T.sprite];
    ax = spr.width / 2; ay = spr.height / 2;
    const parts = T.rects.map(([rx, ry, rw, rh, d]) =>
      Bodies.rectangle(x + f * (rx + rw / 2 - ax) * PX, y + (ry + rh / 2 - ay) * PX, rw * PX, rh * PX, { density: d || T.density }));
    body = parts.length === 1 ? parts[0] : Body.create({ parts });
    body.friction = 0.5;
    body.restitution = T.restitution || 0.05;
  }
  const ent = { id, T, body, bodies: [body], comp: Composite.create(), facing: f, sprite: spr, ax, ay,
                off: { x: x - body.position.x, y: y - body.position.y }, layer: T.layer || 0,
                lit: false, fuse: 0, firing: false, cool: 0, variant, age: 0, string: null };
  body.plugin = { kind: id, owner: ent, mat: T.mat || 'wood',
                  blade: T.blade ? { from: T.blade.from, sharp: T.blade.sharp, facing: f } : null,
                  needle: T.needle != null ? { from: T.needle, facing: f, kind: T.inject || 'heal' } : null };
  Composite.add(ent.comp, body);
  Composite.add(world, ent.comp);
  objects.push(ent);
  return ent;
}

function makeVehicle(id, x, y, facing = 1) {
  const T = THINGS[id], V = VEHICLES[T.vehicle], f = facing;
  const filter = { group: nextGroup--, category: CAT_VEH, mask: CAT_WORLD | CAT_BODY | CAT_BLOOD | CAT_VEH };
  const parts = V.rects.map(([rx, ry, rw, rh, d]) =>
    Bodies.rectangle(x + f * (rx + rw / 2 - V.ax) * PX, y + (ry + rh / 2 - V.ay) * PX, rw * PX, rh * PX, { density: d || V.density }));
  const body = Body.create({ parts, collisionFilter: filter, friction: 0.4, restitution: 0.05 });
  const ent = { id, T, V, body, bodies: [body], wheels: [], comp: Composite.create(), facing: f,
                sprite: OBJ_SPRITES[V.sprite], glass: V.glass ? OBJ_SPRITES[V.glass] : null, wheelSprite: OBJ_SPRITES[V.wheel],
                ax: V.ax, ay: V.ay, off: { x: x - body.position.x, y: y - body.position.y }, layer: 0, on: false, puff: 0,
                cool: 0, riders: V.seats.map(() => null) };
  body.plugin = { kind: id, owner: ent, mat: 'metal' };
  Composite.add(ent.comp, body);
  for (const [wx, wy] of V.wheels) {
    const w = Bodies.circle(x + f * (wx - V.ax) * PX, y + (wy - V.ay) * PX, V.r * PX,
      { collisionFilter: filter, density: 0.004, friction: 1, frictionStatic: 2, restitution: 0.1 });
    w.plugin = { kind: 'wheel', owner: ent, mat: 'rubber' };
    const c = Constraint.create({ bodyA: body, pointA: { x: w.position.x - body.position.x, y: w.position.y - body.position.y },
                                  bodyB: w, length: 0, stiffness: 0.6, damping: 0.2 });
    ent.wheels.push(w);
    ent.bodies.push(w);
    Composite.add(ent.comp, [w, c]);
  }
  Composite.add(world, ent.comp);
  objects.push(ent);
  return ent;
}

// 服を着せる（同じ場所の服は、着がえる）
function wear(g, id) {
  const C = CLOTHES[id];
  if (!C) return false;
  if (CHARS[g.kind].noClothes) { say('ふとっていて 着られない', g.head.position.x, g.head.position.y - 50, '#ffffff', true); return false; }
  g.wear[C.slot] = id;
  SHOP.event('wear');
  SND.play('click', 0.7);
  return true;
}
// ヘルメットとよろいを着ていると、その部品へのダメージが半分になる
function guard(g, part) {
  let k = 1;
  for (const id of Object.values(g.wear)) if (CLOTHES[id].guard === part.plugin.kind) k *= 0.5;
  return k;
}

// キャラに武器を持たせる：手（前がわの下うで）のさきに、武器のにぎる所をつなぐ。持っている間、武器は持ち主の体とぶつからない。
// 武器をつかんでドラッグすると、手からはなれる。手がとれたときも、はなれる
const canEquip = (id) => {
  const T = THINGS[id];
  return !!T && !T.vehicle && !T.hidden && (T.tab === 'weapons' || T.tab === 'guns' || !!T.gun || !!T.blade) && !SHOP.locked(id);
};
// 手に持っている武器は、手にがっちり固定して、向きも変えない（手の角度から、いつも同じだけ前にかたむける）
function updateGrips() {
  for (const g of chars) {
    const gr = g.grip;
    if (!gr) continue;
    const b = gr.ent.body, h = gr.hand;
    const ang = h.angle + gr.rel;
    const at = Vector.add(h.position, Vector.rotate({ x: 0, y: BODY.arm[1] / 2 * PX }, h.angle));
    Body.setAngle(b, ang);
    Body.setPosition(b, Vector.sub(at, Vector.rotate(gr.local, ang)));
    Body.setVelocity(b, Body.getVelocity(h));
    Body.setAngularVelocity(b, Body.getAngularVelocity(h));
  }
}
function unequip(g) {
  const gr = g.grip;
  if (!gr) return;
  g.grip = null;
  gr.ent.gripped = null;
  gr.ent.body.parts.forEach((q, i) => { q.collisionFilter = gr.filters[i]; });
}
// 武器のさがしかた：手の先から、この長さ（世界の長さ）いないにある、ころがっている武器のうち、いちばん近いもの
const GRIP_REACH = 30 * PX;
function handPoint(g) {
  const hand = g.parts.find((p) => p.plugin.seg === 'armL' && p.plugin.sprite === 'armF');
  return hand ? Vector.add(hand.position, Vector.rotate({ x: 0, y: BODY.arm[1] / 2 * PX }, hand.angle)) : g.torso.position;
}
function nearestWeapon(g) {
  const at = handPoint(g);
  let best = null, bestD = GRIP_REACH;
  for (const o of objects) {
    if (o.gripped || o.stuck || !canEquip(o.id)) continue;
    const d = Math.hypot(o.body.position.x - at.x, o.body.position.y - at.y);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}
function equip(g, id) {
  unequip(g);
  const hand = g.parts.find((p) => p.plugin.seg === 'armL' && p.plugin.sprite === 'armF');
  if (!hand || hand.plugin.detached || g.dead || !canEquip(id)) return null;
  const at = Vector.add(hand.position, Vector.rotate({ x: 0, y: BODY.arm[1] / 2 * PX }, hand.angle));
  const ent = makeThing(id, at.x, at.y, g.facing);
  const [gx, gy] = ent.T.grip || [Math.min(3, ent.sprite.width / 2), ent.sprite.height / 2];
  Body.translate(ent.body, Vector.sub(at, thingPoint(ent, gx, gy)));
  // 手に持っている武器は、updateGrips が毎コマ、手の先へ動かす（つなぐバネは使わない。地面にめりこんだ武器が手を引っぱって、暴れるため）。
  // 地面や、ころがっている物とは、ぶつからない。キャラ（と、のりもの）には当たるが、持ち主の体には当たらない
  const filters = ent.body.parts.map((q) => q.collisionFilter);
  ent.body.parts.forEach((q) => { q.collisionFilter = { group: g.group, category: CAT_VEH, mask: CAT_BODY | CAT_VEH }; });
  g.grip = { ent, hand, filters, local: Vector.rotate(Vector.sub(at, ent.body.position), -ent.body.angle), rel: 1.4 * g.facing };
  ent.gripped = g;
  return ent;
}


// ---- 電車（駅のマップ） ----
// ときどき電車が来る：はじめに「電車がくるよ！」と知らせて、すこしあとに走ってくる（どちらの向きから来るかは、ランダム）。
// 電車は、地面や壁をすりぬけて走り、キャラや物にぶつかると、はねとばす。2回に1回は、ホームの高さを走って、ホームに突っ込んでくる。
const TRAIN_W = 240, TRAIN_H = 78, TRAIN_SPEED = 26;
let trainTimer = 700, trainState = 0, trainEnt = null, trainDir = 1, trainMode = 0;   // state: 0 まっている、1 知らせている、2 走っている
function trainSprite() {
  const c = document.createElement('canvas');
  c.width = TRAIN_W; c.height = TRAIN_H;
  const x = c.getContext('2d');
  const f = (col, xx, yy, ww, hh) => { x.fillStyle = col; x.fillRect(xx, yy, ww, hh); };
  f(LINE_COLOR, 0, 2, TRAIN_W, 68);                 // ふち
  f('#d5dbe1', 1, 3, TRAIN_W - 2, 66);              // 車体
  f('#9aa5b0', 1, 3, TRAIN_W - 2, 5);               // 屋根
  f('#2a6fd0', 1, 46, TRAIN_W - 2, 6);              // 青い線
  f('#1a4a96', 1, 52, TRAIN_W - 2, 2);
  for (let i = 0; i < 9; i++) {                     // まど（3つごとに、とびら）
    const wx = 8 + i * 25;
    f(LINE_COLOR, wx - 1, 13, 20, 26);
    f('#2d3a4f', wx, 14, 18, 24);
    f('#5f7aa0', wx + 1, 15, 6, 10);
    if (i % 3 === 1) { f('#b0bac4', wx - 4, 10, 2, 44); f('#b0bac4', wx + 20, 10, 2, 44); }
  }
  f('#ffe070', TRAIN_W - 7, 40, 5, 7);              // ライト
  f('#e23b3b', 2, 40, 3, 7);
  f(LINE_COLOR, 0, 70, TRAIN_W, 8);                 // 台車と車輪
  for (const wx of [20, 34, 200, 214]) { f('#3a3f47', wx, 70, 10, 8); f('#c9d0d6', wx + 4, 73, 2, 2); }
  return c;
}
OBJ_SPRITES.train = trainSprite();
THINGS.train = { tab: 'hidden', hidden: true, name: '電車', sprite: 'train', rects: [[0, 0, TRAIN_W, TRAIN_H]], density: 0.01, layer: 0, mat: 'metal', train: true };
function resetTrain() { trainTimer = rand(600, 1100); trainState = 0; trainEnt = null; }
function callTrain(mode, dir) {
  const m = currentMap;
  if (!m.train || trainEnt) return null;
  trainDir = dir || (Math.random() < 0.5 ? 1 : -1);
  trainMode = mode == null ? (Math.random() < 0.5 ? 0 : 1) : mode;
  const y = ((trainMode ? m.train.platY : m.train.y) - TRAIN_H / 2) * PX;
  const x = trainDir > 0 ? -TRAIN_W * PX : worldX1 + TRAIN_W * PX;
  const ent = makeThing('train', x, y, trainDir);
  ent.train = true;
  ent.trainY = y;
  ent.body.collisionFilter = { group: 0, category: CAT_VEH, mask: CAT_BODY | CAT_VEH };   // 地面や壁とは、ぶつからない（すりぬける）。キャラとのりものには、ぶつかる
  Body.setMass(ent.body, 6000);
  Body.setInertia(ent.body, Infinity);
  trainEnt = ent;
  trainState = 2;
  SND.play('engineStart', 1);
  if (trainMode) say('暴走電車！', cam.x + W / cam.z / 2, cam.y + H / cam.z * 0.25, '#ff4444');
  return ent;
}
function updateTrain(ts) {
  if (!currentMap.train) return;
  if (trainEnt && !objects.includes(trainEnt)) { trainEnt = null; trainState = 0; trainTimer = rand(900, 1800); }
  if (trainState === 0) {
    if ((trainTimer -= ts) <= 0) {
      trainState = 1;
      trainTimer = 150;
      trainDir = Math.random() < 0.5 ? 1 : -1;
      trainMode = Math.random() < 0.5 ? 0 : 1;
      say('⚠ 電車が くるよ！', cam.x + W / cam.z / 2, cam.y + H / cam.z * 0.25, '#ffd24a');
    }
  } else if (trainState === 1) {
    if (stepCount % 25 === 0) SND.play('click', 0.6);
    if ((trainTimer -= ts) <= 0) callTrain(trainMode, trainDir);
  } else if (trainEnt) shake = Math.max(shake, 3);
}
// 物理の計算のあと：電車は、まっすぐ、同じ速さで走らせる（重力や、ぶつかった反動で、かたむいたり、おそくなったりしない）
function holdTrain() {
  if (!trainEnt) return;
  const b = trainEnt.body;
  Body.setAngle(b, 0);
  Body.setAngularVelocity(b, 0);
  Body.setPosition(b, { x: b.position.x, y: trainEnt.trainY });
  Body.setVelocity(b, { x: trainDir * TRAIN_SPEED, y: 0 });
  for (const o of objects) {   // 電車の通り道にある物（のりもの以外）は、はねとばす
    if (o === trainEnt || o.riders || Math.abs(o.body.position.x - b.position.x) > TRAIN_W / 2 * PX + 40 || Math.abs(o.body.position.y - b.position.y) > TRAIN_H / 2 * PX + 40) continue;
    Body.setVelocity(o.body, { x: trainDir * TRAIN_SPEED * 1.1, y: -8 });
    Body.setAngularVelocity(o.body, rand(-0.3, 0.3));
  }
  if ((trainDir > 0 && b.position.x > worldX1 + TRAIN_W * PX) || (trainDir < 0 && b.position.x < -TRAIN_W * PX)) {
    removeThing(trainEnt);
    trainEnt = null;
    trainState = 0;
    trainTimer = rand(900, 1800);
  }
}
function removeThing(ent) {
  if (ent.gripped) { ent.gripped.grip = null; ent.gripped = null; }
  if (ent.riders) for (const g of ent.riders) if (g) unboard(g);
  cutStrings(ent.bodies);
  releaseGrabsOn(ent.bodies);
  Composite.remove(world, ent.comp, true);
  const i = objects.indexOf(ent);
  if (i >= 0) objects.splice(i, 1);
}
function removeChar(g) {
  if (infoChar === g) closeInfo();
  unequip(g);
  closePetMenu();
  unboard(g);
  cutStrings(g.parts);
  releaseGrabsOn(g.parts);
  Composite.remove(world, g.comp, true);
  const i = chars.indexOf(g);
  if (i >= 0) chars.splice(i, 1);
}

// タップしたとき：銃は撃つ（マシンガンは撃ちはじめる・止める。ロケットランチャーはロケットを発射）、爆弾は火をつける
// （手りゅう弾はピンをぬく）、チェーンソーは動く・止まる、風船はわれる、のりものはエンジンをかける・止める
// （戦車は、砲台より上をタップすると大砲を撃つ）。pt はタップした場所（世界の中）
function activate(ent, pt) {
  const T = ent.T;
  if (T.gun) {
    if (T.gun.rocket) fireRocket(ent);
    else if (T.gun.auto) { ent.firing = !ent.firing; ent.cool = 0; SND.play('click', 0.7); }
    else fire(ent);
  } else if (T.bomb) {
    if (!ent.lit) { light(ent, T.bomb.fuse); SND.play(T.bomb.pin ? 'pin' : 'click', 0.7); if (T.bomb.pin) pullPin(ent); }
  } else if (T.saw) {
    toggleSaw(ent);
  } else if (T.balloon) {
    pop(ent);
  } else if (T.vehicle) {
    const G = ent.V.gun;
    if (G && pt && spritePoint(ent, pt).y < G.turret) { fireCannon(ent); return true; }
    ent.on = !ent.on;
    if (ent.on) follow = ent;
    else if (follow === ent) follow = null;
    SND.play(ent.on ? 'engineStart' : 'click', 0.8);
  } else return false;
  return true;
}
function light(ent, fuse) {
  if (ent.lit && ent.fuse <= fuse) return;
  ent.lit = true;
  ent.fuse = fuse;
}

// 絵の中の点（ドット）が、今、世界のどこにあるか
function thingPoint(ent, px, py) {
  const local = { x: (px - ent.ax) * PX * ent.facing + ent.off.x, y: (py - ent.ay) * PX + ent.off.y };
  return Vector.add(ent.body.position, Vector.rotate(local, ent.body.angle));
}
// 世界の中の点が、絵の中のどこか（thingPoint の反対）
function spritePoint(ent, pt) {
  const l = Vector.rotate(Vector.sub(pt, ent.body.position), -ent.body.angle);
  return { x: (l.x - ent.off.x) / (PX * ent.facing) + ent.ax, y: (l.y - ent.off.y) / PX + ent.ay };
}

// 弾を撃つ。弾は見えないくらい速いので、銃口からまっすぐ線をのばして、最初に当たった物に当てる
function fire(ent, spread = 0) {
  const b = ent.body, G = ent.T.gun, f = ent.facing;
  const a = b.angle + spread;
  const dir = { x: Math.cos(a) * f, y: Math.sin(a) * f };
  const mz = thingPoint(ent, G.muzzle[0], G.muzzle[1]);
  addFx({ x: mz.x + dir.x * PX, y: mz.y + dir.y * PX, vx: 0, vy: 0, g: 0, drag: 1, life: 3, size: PX * 2.5, colors: ['#fffbe0', '#ffd24a'] });
  addFx({ x: b.position.x, y: b.position.y, vx: -dir.x * 2 + rand(-1, 1), vy: rand(-5, -3), g: 0.3, drag: 0.99, life: 40,
          size: PX * 0.6, colors: ['#e0b030', '#b08820'] });   // 薬きょう
  const v = Body.getVelocity(b);
  Body.setVelocity(b, { x: v.x - dir.x * G.recoil, y: v.y - dir.y * G.recoil });
  Body.setAngularVelocity(b, Body.getAngularVelocity(b) - f * G.recoil * 0.004);
  SND.play(G.sound, 0.9);
  SHOP.event('shoot');
  for (let k = 0; k < (G.pellets || 1); k++) {   // ショットガンは、1回でたくさんの弾がちらばって飛ぶ
    const pa = a + (G.pellets ? rand(-G.spread, G.spread) : 0);
    const pd = { x: Math.cos(pa) * f, y: Math.sin(pa) * f };
    if (G.ignite) {   // 火炎放射：短いきょりの火。当たったキャラに火がつく
      const hit = raycast(mz, pd, G.range, ent);
      for (let i = 0; i < 5; i++) {
        const sp = rand(5, 12);
        addFx({ x: mz.x + pd.x * rand(0, 40), y: mz.y + pd.y * rand(0, 40), vx: pd.x * sp + rand(-1, 1), vy: pd.y * sp + rand(-1.5, 0.5), g: -0.03, drag: 0.93,
                life: rand(12, 26), size: PX * rand(1.5, 3), colors: ['#fff3b0', '#ffd24a', '#ff8a1f', '#e8501a'] });
      }
      const hg = hit && hit.body.plugin && hit.body.plugin.grape;
      if (hg) ignite(hg);
      continue;
    }
    const hitInfo = raycast(mz, pd, 5000, ent);
    const end = hitInfo ? hitInfo.point : Vector.add(mz, Vector.mult(pd, 5000));
    tracers.push({ x1: mz.x, y1: mz.y, x2: end.x, y2: end.y, life: 5 });
    if (hitInfo) bulletHit(hitInfo.body, hitInfo.point, pd, G.power);
  }
}

function raycast(start, dir, maxLen, ignore) {
  const end = { x: start.x + dir.x * maxLen, y: start.y + dir.y * maxLen };
  const box = { min: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
                max: { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) } };
  const cands = [];
  const consider = (b) => { if (Bounds.overlaps(b.bounds, box)) cands.push(b); };
  for (const g of chars) for (const p of g.parts) consider(p);
  for (const o of objects) if (o !== ignore) for (const b of o.bodies) consider(b);
  for (const s of statics) consider(s);
  for (let d = 0; d <= maxLen; d += 3) {
    const pt = { x: start.x + dir.x * d, y: start.y + dir.y * d };
    if (pt.x < worldX0 - 50 || pt.x > worldX1 + 50 || pt.y > worldH + 50) break;
    for (const b of cands) {
      if (!Bounds.contains(b.bounds, pt)) continue;
      const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
      for (const q of parts) if (Bounds.contains(q.bounds, pt) && Vertices.contains(q.vertices, pt)) return { body: b, point: pt };
    }
  }
  return null;
}

function bulletHit(body, pt, dir, power) {
  const pl = body.plugin || {};
  if (pl.grape) { shot(pl.grape, body, pt, dir, power); return; }
  if (pl.owner && pl.owner.T && pl.owner.T.balloon) { pop(pl.owner); return; }
  if (body.isStatic) {
    for (let i = 0; i < 5; i++) {
      addFx({ x: pt.x, y: pt.y, vx: -dir.x * rand(1, 4) + rand(-1, 1), vy: -dir.y * rand(1, 4) - rand(0, 2), g: 0.15, drag: 0.95,
              life: rand(10, 25), size: PX * 0.6, colors: ['#d8d0c0', '#8a8478'] });
    }
    SND.play('ric', 0.6);
    return;
  }
  const v = Body.getVelocity(body);
  const k = power * 0.6 / Math.max(1, Math.sqrt(body.mass));
  Body.setVelocity(body, { x: v.x + dir.x * k, y: v.y + dir.y * k });
  spawnSparks(pt.x, pt.y, 4);
  SND.play(pl.mat === 'metal' ? 'metal' : 'wood', 0.6);
  if (pl.owner && pl.owner.T && pl.owner.T.bomb) light(pl.owner, 2);
}

// ---- 飛んでいく砲弾・ロケット ----
// 速いので、1コマごとに、進むぶんだけ線をのばして当たりをさがす（うすい物をすりぬけない）。当たったら爆発する
const shells = [];
function launch(x, y, dir, speed, power, owner, kind) {
  shells.push({ x, y, vx: dir.x * speed, vy: dir.y * speed, power, owner, kind, life: 400 });
}
function updateShells(ts) {
  const gy = engine.gravity.y * engine.gravity.scale * STEP * STEP;   // 重力で、1コマにふえる落ちる速さ
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.vy += gy * (s.kind === 'rocket' ? 0.15 : s.kind === 'lava' ? 1 : 0.5) * ts;
    const dx = s.vx * ts, dy = s.vy * ts, len = Math.hypot(dx, dy);
    const hitInfo = len > 0 ? raycast({ x: s.x, y: s.y }, { x: dx / len, y: dy / len }, len, s.owner) : null;
    if (hitInfo) { shells.splice(i, 1); explode(hitInfo.point.x, hitInfo.point.y, s.power, s.kind === 'lava'); continue; }
    s.x += dx; s.y += dy;
    s.life -= ts;
    addFx({ x: s.x - dx * 0.5, y: s.y - dy * 0.5, vx: rand(-0.3, 0.3), vy: rand(-0.6, 0), g: -0.01, drag: 0.97,
            life: rand(20, 40), size: PX * rand(0.8, 1.6),
            colors: s.kind === 'shell' ? ['#d0ccc8', '#8a8480', '#5d5854'] : ['#fff3b0', '#ff8a1f', '#8a8480', '#5d5854'] });
    if (s.life <= 0 || s.y > worldH + 400) shells.splice(i, 1);
  }
}
function drawShells() {
  for (const s of shells) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(s.vy, s.vx));
    if (s.kind === 'rocket' && OBJ_SPRITES.rocket) { ctx.scale(PX, PX); ctx.drawImage(OBJ_SPRITES.rocket, -6, -1.5); }
    else if (s.kind === 'lava') { ctx.fillStyle = '#ff8a1f'; ctx.fillRect(-PX * 1.5, -PX * 1.5, PX * 3, PX * 3); ctx.fillStyle = '#ffe070'; ctx.fillRect(-PX * 0.5, -PX * 0.5, PX, PX); }
    else { ctx.fillStyle = LINE_COLOR; ctx.fillRect(-PX * 2, -PX * 0.8, PX * 4, PX * 1.6); ctx.fillStyle = '#6b737e'; ctx.fillRect(-PX * 1.5, -PX * 0.4, PX * 3, PX * 0.8); }
    ctx.restore();
  }
}
// 戦車の大砲
function fireCannon(ent) {
  if (ent.cool > 0) return;
  const G = ent.V.gun, b = ent.body, f = ent.facing;
  ent.cool = 45;
  const dir = { x: Math.cos(b.angle) * f, y: Math.sin(b.angle) * f };
  const mz = thingPoint(ent, G.muzzle[0], G.muzzle[1]);
  launch(mz.x, mz.y, dir, G.speed, G.power, ent, 'shell');
  for (let i = 0; i < 14; i++) {
    addFx({ x: mz.x, y: mz.y, vx: dir.x * rand(2, 7) + rand(-1.5, 1.5), vy: dir.y * rand(2, 7) + rand(-1.5, 1.5), g: -0.02, drag: 0.9,
            life: rand(10, 30), size: PX * rand(1.5, 3), colors: ['#fffbe0', '#ffd24a', '#ff8a1f', '#7a7470', '#5d5854'] });
  }
  const v = Body.getVelocity(b);
  Body.setVelocity(b, { x: v.x - dir.x * G.recoil, y: v.y - dir.y * G.recoil });
  shake = Math.max(shake, 6);
  SND.play('boom', 0.5);
  SND.play('bang', 1);
  SHOP.event('tankShot');
}

// ロケットランチャー：ロケットを発射する（うしろからも火が出る）
function fireRocket(ent) {
  if (ent.cool > 0) return;
  const G = ent.T.gun, b = ent.body, f = ent.facing;
  ent.cool = 60;
  const dir = { x: Math.cos(b.angle) * f, y: Math.sin(b.angle) * f };
  const mz = thingPoint(ent, G.muzzle[0], G.muzzle[1]), back = thingPoint(ent, 0, G.muzzle[1]);
  launch(mz.x + dir.x * PX * 3, mz.y + dir.y * PX * 3, dir, G.speed, G.power, ent, 'rocket');
  for (let i = 0; i < 12; i++) {
    addFx({ x: back.x, y: back.y, vx: -dir.x * rand(2, 6) + rand(-1, 1), vy: -dir.y * rand(2, 6) + rand(-1, 1), g: -0.02, drag: 0.92,
            life: rand(15, 35), size: PX * rand(1, 2.5), colors: ['#fff3b0', '#ffd24a', '#8a8480', '#5d5854'] });
  }
  const v = Body.getVelocity(b);
  Body.setVelocity(b, { x: v.x - dir.x * G.recoil, y: v.y - dir.y * G.recoil });
  SND.play('rocket', 1);
  SHOP.event('shoot');
}

// ---- 爆発 ----
// natural は火山の溶岩のかたまり（クエストの「爆発」には数えない）
function explode(x, y, power = 1, natural = false) {
  const R = 70 * PX * power;
  if (!natural) {
    SHOP.event('explode');
    if (boom && stepCount - boom.step <= BOOM_WINDOW) boom.step = stepCount; else boom = { step: stepCount, kills: 0 };
  }
  const push = (b, onHit) => {
    const dx = b.position.x - x, dy = b.position.y - y, d = Math.hypot(dx, dy);
    if (d > R) return;
    const f = 1 - d / R;
    const nx = d > 1 ? dx / d : 0, ny = d > 1 ? dy / d : -1;
    const k = f * 26 * power * clamp(Math.sqrt(4 / b.mass), 0.2, 1.4);
    const v = Body.getVelocity(b);
    Body.setVelocity(b, { x: v.x + nx * k, y: v.y + ny * k - f * 4 });
    Body.setAngularVelocity(b, Body.getAngularVelocity(b) + rand(-0.3, 0.3) * f);
    if (onHit) onHit(f);
  };
  for (const g of chars) for (const p of g.parts) push(p, (f) => blast(g, p, f));
  for (const o of objects.slice()) {
    if (o.T.balloon) { if (Math.hypot(o.body.position.x - x, o.body.position.y - y) < R) pop(o); continue; }
    for (const b of o.bodies) push(b, () => { if (o.T.bomb) light(o, Math.round(rand(6, 14))); });
  }
  for (const b of bloods) push(b);
  for (let i = 0; i < 46; i++) {   // 火の玉
    const a = rand(0, Math.PI * 2), s = rand(2, 13) * power;
    addFx({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: -0.03, drag: 0.9, life: rand(18, 40), size: PX * rand(1.5, 3.5),
            colors: ['#ffffff', '#fff3b0', '#ffd24a', '#ff8a1f', '#d23a1a', '#5a4a44', '#3a3434'] });
  }
  for (let i = 0; i < 18; i++) {   // けむり
    addFx({ x: x + rand(-30, 30), y: y + rand(-30, 10), vx: rand(-1, 1), vy: rand(-2, -0.5), g: -0.01, drag: 0.98,
            life: rand(60, 110), size: PX * rand(2, 4), colors: ['#7a7470', '#5d5854', '#46423f'] });
  }
  for (let i = 0; i < 16; i++) {   // はへん
    const a = rand(Math.PI * 1.05, Math.PI * 1.95), s = rand(5, 14);
    addFx({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.35, drag: 0.99, life: rand(30, 60), size: PX * 0.8,
            colors: ['#3b2f2a', '#241c18'] });
  }
  scorch(x, y, Math.round(R / PX * 0.35));
  shake = Math.max(shake, 16 * power);
  SND.play('boom', 1);
}
// 地面にこげあとをつける
function scorch(x, y, r) {
  const cx = Math.floor(x / PX), cy = Math.floor(y / PX);
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const s = stainAt(cx + i, cy + j);
      if (!s || !s.solid[s.y * s.w + s.x]) continue;
      const d = Math.hypot(i, j) / r;
      if (d > 1 || Math.random() > 0.9 - d * 0.7) continue;
      s.c.fillStyle = Math.random() < 0.5 ? 'rgba(18, 14, 12, 0.6)' : 'rgba(40, 32, 28, 0.5)';
      s.c.fillRect(s.x, s.y, 1, 1);
    }
  }
}
function detonate(ent) {
  const p = { x: ent.body.position.x, y: ent.body.position.y };
  removeThing(ent);
  if (ent.T.bomb.fire) firebomb(p.x, p.y, ent.T.bomb.power);
  else explode(p.x, p.y, ent.T.bomb.power);
}

// 銃の連射・導火線・のりもののエンジン
function updateThings(ts) {
  let engineLevel = 0;
  for (const ent of objects.slice()) {
    const T = ent.T;
    if (T.gun && T.gun.auto && ent.firing) {
      ent.cool -= ts;
      if (ent.cool <= 0) { ent.cool += T.gun.every; fire(ent, rand(-T.gun.spread, T.gun.spread)); }
    }
    if (T.bomb && T.bomb.prox && !ent.lit) {   // じらい：キャラが近づくと、火がつく
      const R = T.bomb.prox * PX;
      if (chars.some((g) => g.parts.some((p) => Math.hypot(p.position.x - ent.body.position.x, p.position.y - ent.body.position.y) < R))) light(ent, T.bomb.fuse);
    }
    if (ent.lit) {
      ent.fuse -= ts;
      if (T.bomb.tip && Math.random() < 0.6 * ts) {
        const p = thingPoint(ent, T.bomb.tip[0], T.bomb.tip[1]);
        addFx({ x: p.x, y: p.y, vx: rand(-1.5, 1.5), vy: rand(-2.5, -0.5), g: 0.1, drag: 0.95, life: rand(6, 14), size: PX * 0.6,
                colors: ['#ffffff', '#ffe070', '#ff8a1f'] });
      }
      if (stepCount % 6 === 0) SND.play('fuse', 0.5);
      if (ent.fuse <= 0) { detonate(ent); continue; }
    }
    if (T.saw && ent.on) {   // チェーンソー：チェーンが回って、ブルブルふるえる
      if (ent.sawCool > 0) ent.sawCool -= ts;
      ent.sprite = OBJ_SPRITES[Math.floor(stepCount / 3) % 2 ? 'chainsaw2' : 'chainsaw'];
      Body.setAngularVelocity(ent.body, Body.getAngularVelocity(ent.body) + rand(-0.015, 0.015) * ts);
      if (stepCount % 5 === 0) SND.play('saw', 0.4);
    }
    if (ent.cool > 0 && (T.vehicle || (T.gun && T.gun.rocket))) ent.cool -= ts;
    if (T.vehicle && ent.on) {
      drive(ent, ts);
      const v = Body.getVelocity(ent.body);
      engineLevel = Math.max(engineLevel, 0.4 + Math.min(0.6, Math.hypot(v.x, v.y) / 8));
      ent.puff += ts;
      if (ent.puff > 8) {   // 排気ガス
        ent.puff = 0;
        const p = thingPoint(ent, ent.V.exhaust[0], ent.V.exhaust[1]);
        addFx({ x: p.x, y: p.y, vx: -ent.facing * rand(0.5, 1.5), vy: rand(-1, -0.3), g: -0.01, drag: 0.97, life: rand(30, 50),
                size: PX * rand(1, 2), colors: ['#d0d0d0', '#a0a0a0', '#7a7a7a'] });
      }
    }
  }
  SND.engine(engineLevel);
}

// のりものを走らせる。タイヤが地面や物についていたら、車体ごと前へおして、top の速さまで速くする。
// タイヤは、進む速さに合わせて回す（タイヤの回る力だけで動かすと、重い戦車やトラックは坂を登れない）
function drive(ent, ts) {
  const V = ent.V, b = ent.body, f = ent.facing;
  const grip = ent.wheels.filter((w) => stepCount - (w.plugin.touchStep ?? -9) <= 1).length / ent.wheels.length;
  const fwd = { x: Math.cos(b.angle) * f, y: Math.sin(b.angle) * f };
  let along = Vector.dot(Body.getVelocity(b), fwd);
  if (grip > 0 && along < V.top) {
    const push = Math.min(V.accel * Math.min(1, grip * 2) * ts, V.top - along);
    for (const p of ent.bodies) Body.setVelocity(p, Vector.add(Body.getVelocity(p), Vector.mult(fwd, push)));
    along += push;
  }
  // タイヤは地面の上をすべらずに転がる速さで回す（おそく回すと、ブレーキになってしまう）
  for (const w of ent.wheels) Body.setAngularVelocity(w, Math.max(along, 1) * f / (V.r * PX));
}

// ---- 水と溶岩 ----
function liquidAt(x, y) {
  for (const L of liquids) if (x > L.x && x < L.x + L.w && y > L.y && y < L.y + L.h) return L;
  return null;
}
// 水や溶岩の中の物は、それより軽ければ浮く。中では動きがにぶくなる。溶岩の中では燃える
function updateLiquids(ts) {
  if (!liquids.length) return;
  const gy = engine.gravity.y * engine.gravity.scale;
  const each = (b, g) => {
    const p = b.position, pl = b.plugin, L = liquidAt(p.x, p.y);
    if (!L) { pl.wet = null; return; }
    const v = Body.getVelocity(b);
    if (pl.wet !== L) {
      pl.wet = L;
      if (L.kind === 'lava') { if (v.y > 1) sizzle(p.x, L.y); }
      else if (v.y > 3) splash(p.x, L.y, v.y, g);
    }
    const damp = Math.pow(L.damp, ts);
    b.force.y -= L.density * b.area * gy;
    Body.setVelocity(b, { x: v.x * damp, y: v.y * damp });
    Body.setAngularVelocity(b, Body.getAngularVelocity(b) * damp);
    if (L.kind === 'lava') burnIn(b, g, ts);
  };
  for (const g of chars) for (const p of g.parts) each(p, g);
  for (const o of objects.slice()) for (const b of o.bodies) each(b, null);
  for (const L of liquids) {   // 溶岩の泡
    if (L.kind !== 'lava' || Math.random() > L.w / (PX * 300) * ts) continue;
    addFx({ x: L.x + Math.random() * L.w, y: L.y + PX, vx: rand(-0.3, 0.3), vy: rand(-2.5, -1), g: 0.08, drag: 0.98, life: rand(15, 30),
            size: PX * rand(0.8, 1.6), colors: ['#ffe070', '#ff8a1f', '#e8501a'] });
  }
}
// 溶岩の中：キャラは燃えてケガをする。爆弾は火がつく。木の物は燃えてなくなる
function burnIn(b, g, ts) {
  const pl = b.plugin;
  if (Math.random() < 0.25 * ts) {
    addFx({ x: b.position.x + rand(-8, 8), y: b.position.y + rand(-8, 8), vx: rand(-0.5, 0.5), vy: rand(-2.5, -1), g: -0.02, drag: 0.97,
            life: rand(15, 35), size: PX * rand(1, 2), colors: ['#fff3b0', '#ffd24a', '#ff8a1f', '#5a4a44', '#3a3434'] });
  }
  if (stepCount % 8 === 0) SND.play('sizzle', 0.4);
  if (g) {
    pl.burn = Math.min(1, pl.burn + 0.012 * ts);
    pl.hurt = Math.min(1, pl.hurt + 0.004 * ts);
    pl.hp -= LAVA_DAMAGE * ts * settings.damage;
    if (!g.lavaHit) {
      g.lavaHit = true;
      SHOP.event('lava');
      if (!g.dead) sayFor(g, CHARS[g.kind].sparks ? 'ジュッ' : 'あちっ！', b.position.x, b.position.y - 30);
    }
    checkPart(g, b);
    return;
  }
  const ent = pl.owner;
  if (!ent || !ent.T) return;
  if (ent.T.balloon) { pop(ent); return; }
  if (ent.T.bomb) light(ent, 2);
  ent.heat = (ent.heat || 0) + ts;
  if (ent.heat > 90 && (ent.T.crate || ent.T.mat === 'wood')) {   // 木は浮くので、まん中が溶岩に入っているのは半分くらいの時間
    const at = { x: b.position.x, y: b.position.y };
    removeThing(ent);
    for (let i = 0; i < 12; i++) {
      addFx({ x: at.x + rand(-15, 15), y: at.y + rand(-15, 15), vx: rand(-1, 1), vy: rand(-3, -1), g: -0.02, drag: 0.97, life: rand(30, 60),
              size: PX * rand(1.5, 3), colors: ['#ffd24a', '#ff8a1f', '#7a7470', '#5d5854'] });
    }
  }
}
function sizzle(x, y) {
  for (let i = 0; i < 10; i++) {
    addFx({ x: x + rand(-12, 12), y, vx: rand(-2, 2), vy: -rand(2, 5), g: 0.2, drag: 0.98, life: rand(15, 30),
            size: PX * rand(0.6, 1.2), colors: ['#fff3b0', '#ffd24a', '#ff8a1f'] });
  }
  SND.play('sizzle', 0.9);
}
// 火山の噴火：ときどき、火口から溶岩のかたまりが飛び出す
let eruptTimer = 240, erupting = 0;
function updateVolcano(ts) {
  const vent = currentMap.vent;
  if (!vent) return;
  const vx = vent.x * PX, vy = vent.y * PX;
  if (erupting > 0) {
    erupting -= ts;
    if (Math.random() < 0.5 * ts) {
      addFx({ x: vx + rand(-40, 40), y: vy, vx: rand(-1.5, 1.5), vy: rand(-9, -4), g: 0.12, drag: 0.99, life: rand(30, 60),
              size: PX * rand(1.5, 3), colors: ['#fff3b0', '#ffd24a', '#ff8a1f', '#e8501a', '#5a4a44'] });
    }
    if (Math.random() < 0.12 * ts) {
      const a = -Math.PI / 2 + rand(-0.55, 0.55);
      launch(vx + rand(-30, 30), vy - PX * 4, { x: Math.cos(a), y: Math.sin(a) }, rand(10, 17), 0.3, null, 'lava');
    }
    return;
  }
  eruptTimer -= ts;
  if (eruptTimer <= 0) {
    eruptTimer = rand(420, 720);
    erupting = 70;
    shake = Math.max(shake, 8);
    SND.play('boom', 0.6, 0.6);
    say('噴火！', vx, vy - 120, '#ffb020');
  }
}
function splash(x, y, speed, g) {
  if (g && stepCount - (g.splashStep || -999) > 120) { g.splashStep = stepCount; SHOP.event('splash'); }   // 1回とびこむと、体の部品ごとに水にふれる。だから、キャラ1体につき、1回だけ数える
  const n = Math.min(24, Math.round(speed * 2));
  for (let i = 0; i < n; i++) {
    addFx({ x: x + rand(-12, 12), y, vx: rand(-3, 3), vy: -rand(2, 4 + speed * 0.5), g: 0.3, drag: 0.99, life: rand(20, 40),
            size: PX * rand(0.6, 1.2), colors: ['#e6f6ff', '#9fd6f0', '#5aa7cf'] });
  }
  SND.play('splash', clamp(speed / 12, 0.3, 1));
}

// ---- 火花・火・けむり・水しぶき（物理なし） ----
function addFx(p) {
  p.max = p.life;
  fx.push(p);
  if (fx.length > 900) fx.splice(0, fx.length - 900);
}
function spawnSparks(x, y, n) {
  for (let i = 0; i < n; i++) {
    addFx({ x, y, vx: rand(-5, 5), vy: rand(-8, -1), g: 0.4, drag: 1, life: rand(12, 26), size: PX / 2, colors: ['#fff3b0', '#ffb020'] });
  }
}
function updateFx(ts) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const p = fx[i];
    p.vy += p.g * ts;
    if (p.drag !== 1) { const k = Math.pow(p.drag, ts); p.vx *= k; p.vy *= k; }
    p.x += p.vx * ts;
    p.y += p.vy * ts;
    p.life -= ts;
    if (p.life <= 0) fx.splice(i, 1);
  }
  for (let i = tracers.length - 1; i >= 0; i--) if (--tracers[i].life <= 0) tracers.splice(i, 1);
}
function say(text, x, y, color, small) { floaters.push({ text: tr(text), x, y, t: 0, color, small }); }
// 「ボキッ」「ブチッ」は、同じキャラから一度にたくさん出ないようにする（爆発のときなど）
function sayFor(g, text, x, y) {
  if (stepCount - (g.sayStep || -99) < 30) return;
  g.sayStep = stepCount;
  say(text, x, y, '#ffffff', true);
}

// ---- ナイフや刀が刺さる ----
// 刃先から速く当たると、体に刺さって抜けなくなる（刺さっている間は血が出続ける）。つかんで強く引っぱると抜ける。
// 速いほど深く刺さって、刀は体をつらぬく。刺さっている物は体のうしろに描くので、体に入っている所は見えない。
const STICK = 3;   // これより速く刃先から当たると刺さる
function tryStick(ent, part, speed) {
  if (ent.stuck || !ent.T.stick || speed < STICK || CHARS[part.plugin.grape.kind].sparks) return false;   // ロボには刺さらない
  const b = ent.body, f = ent.facing;
  const tip = { x: Math.cos(b.angle) * f, y: Math.sin(b.angle) * f };   // 刃先の向き
  const rel = Vector.sub(Body.getVelocity(b), Body.getVelocity(part));
  const rs = Math.hypot(rel.x, rel.y);
  if (rs < STICK || Vector.dot(rel, tip) < 0.5 * rs) return false;     // 刃先から、まっすぐに近い向きで刺したときだけ
  const depth = clamp(rs * 0.9, 2, ent.T.stick);
  Body.translate(b, Vector.mult(tip, depth * PX));                      // めりこませる
  const w = ent.sprite.width;
  const cons = [w - 1, w - 5].map((px) => {
    const at = thingPoint(ent, px, ent.ay);
    return Constraint.create({ bodyA: b, pointA: Vector.sub(at, b.position), bodyB: part, pointB: Vector.sub(at, part.position),
                               length: 0, stiffness: 0.8, damping: 0.1 });
  });
  Composite.add(ent.comp, cons);
  ent.stuck = { part, cons, depth };
  ent.noHit = 0;
  b.collisionFilter.group = part.collisionFilter.group;   // 刺さっている体とは、ぶつからないようにする
  SHOP.event('stick');
  return true;
}
function unstick(ent, pulled) {
  const s = ent.stuck;
  if (!s) return;
  Composite.remove(ent.comp, s.cons);
  ent.stuck = null;
  ent.noHit = 30;   // 抜けてすぐは、まだ体の中にあるので、しばらくぶつからないままにする
  const g = s.part.plugin.grape;
  if (pulled && g) {
    s.part.plugin.bleed += 0.4;
    SND.play('squish', 0.8);
    hurtPart(g, s.part, 6, thingPoint(ent, ent.sprite.width - 3, ent.ay), 8, 'pull');
  }
}
function updateStuck(ts) {
  for (const ent of objects) {
    const b = ent.body;
    if (ent.stuck) {
      const { part, cons } = ent.stuck;
      b.collisionFilter.group = part.collisionFilter.group;   // 手足がとれたら、グループが変わるので合わせる
      part.plugin.bleed = Math.max(part.plugin.bleed, 0.3);
      const c = cons[0];
      const pa = Vector.add(c.bodyA.position, c.pointA), pb = Vector.add(c.bodyB.position, c.pointB);
      if (Vector.magnitude(Vector.sub(pa, pb)) > 2.5 * PX) unstick(ent, true);
    } else if (ent.noHit > 0) {
      ent.noHit -= ts;
      if (ent.noHit <= 0) b.collisionFilter.group = 0;
    }
  }
}

// ---- のりものに乗る ----
// キャラをつかんで、のりものの座席の近くではなすと座る（体を座った形にならべて、腰を座席にとめる）。
// 乗っているキャラをつかむと降りる。のりものが急に止まる（ぶつかる）と、乗っている人は前にとびだす。
const POSES = {   // 座り方。のりものから見た、部品ごとの角度（右向きのとき。+ は時計回り）
  sit:   { torso: -0.05, head: 0.05, armU: -0.8, armL: -1.6, legU: -1.7, legL: -0.25 },   // 車のいす
  ride:  { torso: 0.35, head: -0.2, armU: -1.2, armL: -1.5, legU: -1.0, legL: 0.3 },      // バイクにまたがる
  hatch: { torso: 0, head: 0, armU: -0.5, armL: -1.3, legU: 0, legL: 0 },                // 戦車のハッチから顔を出す
};
const POSE_POWER = { torso: 1, head: 0.7, armU: 0.5, armL: 0.5, legU: 0.8, legL: 0.8 };
const SEAT_LIMIT = [-0.4, 1.1];   // 座席の上で、胴体がどこまでたおれるか（死んでいると前にぐったりする）
const BOARD_RANGE = 16;           // 座席からこれだけ（ドット）の所ではなすと乗る
const CRASH = 6;                  // 車体（タイヤいがい）が、これより速く地面や重い物にぶつかると、乗っている人がとびだす
const LAND_CRASH = 9;             // ただし車体の下からの着地は、これより速いときだけ（坂のジャンプくらいでは、とびださない）
const HIP_Y = BODY.torso[1] / 2 - BODY.hip;   // 胴体の中心から腰まで（ドット）

const seatPoint = (ent, i) => thingPoint(ent, ent.V.seats[i].x, ent.V.seats[i].y);
const hipOf = (g) => Vector.add(g.torso.position, Vector.rotate({ x: 0, y: HIP_Y * PX }, g.torso.angle));
function nearestSeat(g, range) {
  const h = hipOf(g);
  let best = null, bd = range * PX;
  for (const ent of objects) {
    if (!ent.riders) continue;
    for (let i = 0; i < ent.riders.length; i++) {
      if (ent.riders[i]) continue;
      const d = Vector.magnitude(Vector.sub(seatPoint(ent, i), h));
      if (d < bd) { bd = d; best = { ent, i }; }
    }
  }
  return best;
}
function setVehicleCollide(g, on) {
  for (const p of g.parts) p.collisionFilter.mask = CAT_WORLD | CAT_BODY | (on ? CAT_VEH : 0);
}
// 体を、座った形にならべなおす（胴体から順に、関節でつながるように置いていく）
function placePose(g, ent, i) {
  const P = POSES[ent.V.seats[i].pose], va = ent.body.angle, f = g.facing, v = Body.getVelocity(ent.body);
  const put = (b, pos, angle) => {
    Body.setAngle(b, angle, false);
    Body.setPosition(b, pos, false);
    Body.setVelocity(b, v);
    Body.setAngularVelocity(b, 0);
  };
  const ta = va + f * P.torso;
  put(g.torso, Vector.sub(seatPoint(ent, i), Vector.rotate({ x: 0, y: HIP_Y * PX }, ta)), ta);
  for (const c of g.joints) {
    const b = c.bodyB;
    if (b.plugin.joint !== c) continue;   // とれた部品は、そのまま
    const la = Vector.rotate(c.pointA, -c.angleA), lb = Vector.rotate(c.pointB, -c.angleB);   // 部品から見た関節の場所
    const a = va + f * P[b.plugin.seg];
    const at = Vector.add(c.bodyA.position, Vector.rotate(la, c.bodyA.angle));
    put(b, Vector.sub(at, Vector.rotate(lb, a)), a);
  }
}
function board(g, ent, i) {
  unboard(g);
  g.facing = ent.facing;   // のりものと同じ向きに座る
  placePose(g, ent, i);
  const hip = seatPoint(ent, i);
  const con = Constraint.create({ bodyA: ent.body, pointA: Vector.sub(hip, ent.body.position),
                                  bodyB: g.torso, pointB: Vector.sub(hip, g.torso.position), length: 0, stiffness: 0.7, damping: 0.1 });
  Composite.add(ent.comp, con);
  g.seat = { ent, i, con };
  ent.riders[i] = g;
  g.noVeh = 0;
  setVehicleCollide(g, false);
  SND.play('thud', 0.6);
  SHOP.event('ride');
}
function unboard(g) {
  const s = g.seat;
  if (!s) return;
  Composite.remove(s.ent.comp, s.con);
  s.ent.riders[s.i] = null;
  g.seat = null;
  g.noVeh = 1;   // 車体の中から出るまで、のりものとぶつからない（updateRiders で見る）
}
// はなしたキャラが座席の近くなら、座らせる
function tryBoard(g) {
  if (g.held || g.seat) return false;
  const s = nearestSeat(g, BOARD_RANGE);
  if (s) board(g, s.ent, s.i);
  return !!s;
}
function eject(g, v) {
  unboard(g);
  for (const p of g.parts) Body.setVelocity(p, { x: v.x * 1.1, y: v.y * 1.1 - 2 });
  if (!g.dead) g.stun = Math.max(g.stun, 90);
  sayFor(g, 'うわっ', g.head.position.x, g.head.position.y - 30);
}
// 座った形をたもつ力。のりものが回ると、いっしょに回る。死んでいると上半身はぐったりする（足は車の中にはさまったまま）
function holdPose(g, ent, ts) {
  const P = POSES[ent.V.seats[g.seat.i].pose], va = ent.body.angle, f = g.facing;
  const vw = Body.getAngularVelocity(ent.body);
  for (const p of g.parts) {
    const pl = p.plugin;
    if (pl.detached || pl.broken || (g.dead && pl.kind !== 'leg')) continue;
    const k = POSE_POWER[pl.seg] * ts;
    const av = Body.getAngularVelocity(p), err = wrapAngle(p.angle - (va + f * P[pl.seg]));
    Body.setAngularVelocity(p, vw + (av - vw) * (1 - 0.3 * k) - err * 0.25 * k);
  }
}
// 車体のぶつかり方で、乗っている人がとびだすかを決める。前やうしろ（かべ）や屋根は CRASH、下からの着地は LAND_CRASH
function isCrash(ent, normal, at, speed) {
  const a = ent.body.angle, down = { x: -Math.sin(a), y: Math.cos(a) };   // のりものから見た下の向き
  const landing = Math.abs(Vector.dot(normal, down)) >= 0.5 && Vector.dot(Vector.sub(at, ent.body.position), down) > 0;
  return speed > (landing ? LAND_CRASH : CRASH);
}
// のりものの車体のぶつかった（collisionStart から呼ぶ。v はぶつかる前の速さ）
function crashVehicle(ent) {
  const v = Body.getVelocity(ent.body);
  for (const g of ent.riders) if (g) eject(g, v);
}
// キャラが、どれかのりものに重なっているか（大まかに）
function overlapsVehicle(g) {
  for (const ent of objects) {
    if (!ent.riders) continue;
    for (const b of ent.bodies) for (const p of g.parts) if (Bounds.overlaps(p.bounds, b.bounds)) return true;
  }
  return false;
}
function updateRiders(ts) {
  // 降りたキャラや、持っていたキャラは、のりものから出てはなれるまで、のりものとぶつからない
  for (const g of chars) {
    if (!(g.noVeh > 0) || g.held) continue;
    g.noVeh -= ts;
    if (g.noVeh <= 0) { if (overlapsVehicle(g)) g.noVeh = 5; else setVehicleCollide(g, true); }
  }
  for (const ent of objects) if (ent.riders) for (const g of ent.riders) if (g) holdPose(g, ent, ts);
}

// ---- ぶつかった時 ----
// 何かにさわっているか（立つ力を入れるか）を記録して、ぶつかった速さでケガや音を決める。
// 組み合わせの物（ハンマーやのりもの）は、当たった部品ではなく、全体（parent）で考える。
function markTouch(A, B) {
  const pa = A.plugin || {}, pb = B.plugin || {};
  const ga = pa.grape, gb = pb.grape;
  if (ga && ga !== gb) ga.touchStep = stepCount;
  if (gb && gb !== ga) gb.touchStep = stepCount;
  if (pa.kind === 'wheel' && pb.kind !== 'blood' && pb.owner !== pa.owner) pa.touchStep = stepCount;   // タイヤが地面や物についている
  if (pb.kind === 'wheel' && pa.kind !== 'blood' && pa.owner !== pb.owner) pb.touchStep = stepCount;
}
Events.on(engine, 'collisionActive', (e) => {
  for (const pair of e.pairs) {
    const A = pair.bodyA.parent, B = pair.bodyB.parent;
    markTouch(A, B);
    const pa = A.plugin || {}, pb = B.plugin || {};
    if (pa.grape && pb.owner && pb.owner.T.saw) sawCut(pb.owner, B, pa.grape, A, pair.collision);
    else if (pb.grape && pa.owner && pa.owner.T.saw) sawCut(pa.owner, A, pb.grape, B, pair.collision);
  }
});
Events.on(engine, 'collisionStart', (e) => {
  for (const pair of e.pairs) {
    const A = pair.bodyA.parent, B = pair.bodyB.parent;
    markTouch(A, B);
    const pa = A.plugin || {}, pb = B.plugin || {};
    if (pa.kind === 'blood' || pb.kind === 'blood') continue;
    const { collision } = pair;
    const rel = Vector.sub(Body.getVelocity(A), Body.getVelocity(B));
    const speed = Math.abs(Vector.dot(rel, collision.normal));
    const n = collision.supportCount != null ? collision.supportCount : (collision.supports ? collision.supports.length : 0);
    const at = n > 0 ? { x: collision.supports[0].x, y: collision.supports[0].y } : (pa.grape ? A : B).position;
    if (pa.grape) contact(pa.grape, A, B, speed, at);
    if (pb.grape && pb.grape !== pa.grape) contact(pb.grape, B, A, speed, at);
    if (pa.grape && pb.owner && pb.blade && onEdge(B, at, pb.blade) && tryStick(pb.owner, A, speed)) pair.isActive = false;
    else if (pb.grape && pa.owner && pa.blade && onEdge(A, at, pa.blade) && tryStick(pa.owner, B, speed)) pair.isActive = false;
    if (pa.grape || pb.grape) { if (speed > 3 && speed <= HURT) SND.play('thud', speed / HURT * 0.5); }
    else impactSound(A, B, speed, at);
    if (pa.owner) onImpact(pa.owner, speed);
    if (pb.owner) onImpact(pb.owner, speed);
    if (pa.owner && pa.owner.T.bouncy) queueBounce(pa.owner, B, speed);
    if (pb.owner && pb.owner.T.bouncy) queueBounce(pb.owner, A, speed);
    if (pa.owner && pa.owner.T.balloon) touchBalloon(pa.owner, B, at);
    if (pb.owner && pb.owner.T.balloon) touchBalloon(pb.owner, A, at);
    if (speed > CRASH) {
      if (pa.owner && pa.owner.riders && pa.kind !== 'wheel' && (B.isStatic || B.mass > A.mass * 0.3) &&
          isCrash(pa.owner, collision.normal, at, speed)) crashVehicle(pa.owner);
      if (pb.owner && pb.owner.riders && pb.kind !== 'wheel' && (A.isStatic || A.mass > B.mass * 0.3) &&
          isCrash(pb.owner, collision.normal, at, speed)) crashVehicle(pb.owner);
    }
  }
});
function impactSound(A, B, speed, at) {
  if (speed < 3) return;
  const mat = (b) => (b.isStatic ? 'ground' : (b.plugin && b.plugin.mat) || 'wood');
  const m = [mat(A), mat(B)];
  const name = m.includes('metal') ? 'metal' : m.includes('rubber') ? 'boing' : m.includes('wood') ? 'wood' : 'thud';
  SND.play(name, clamp((speed - 3) / 12, 0.15, 1), rand(0.9, 1.1));
  if (name === 'metal' && speed > 10) spawnSparks(at.x, at.y, 5);
}
// ばくはつ樽は、強くぶつかると爆発する
function onImpact(ent, speed) {
  const B = ent.T.bomb;
  if (B && B.impact && speed > B.impact) light(ent, 1);
}

// ---- トランポリン ----
// 上から落ちてきた物をはね返す。生きているキャラは体ごと、落ちてきたときより高くはねる（ずっとピョンピョンはねる）。
// 物や死んだキャラは、はねるたびに低くなる。ぶつかった後に速さを変えたいので、Engine.update の後でまとめてやる。
const bounces = [];
function queueBounce(tramp, other, speed) {
  if (other.isStatic || speed < 2 || spritePoint(tramp, other.position).y > 1) return;   // マットの上から来たときだけ
  bounces.push({ tramp, body: other, speed });
}
function applyBounces() {
  const done = new Set();
  for (const { tramp, body, speed } of bounces) {
    const pl = body.plugin || {};
    const g = pl.grape && !pl.detached ? pl.grape : null;
    const key = g || pl.owner || body;
    if (done.has(key) || !objects.includes(tramp)) continue;
    done.add(key);
    const n = Vector.rotate({ x: 0, y: -1 }, tramp.body.angle);   // マットの上向き
    const B = g && !g.dead ? clamp(speed * 1.25, 10, 20) : Math.min(20, speed * 0.9);
    const list = g ? g.parts.filter((p) => !p.plugin.detached) : pl.owner ? pl.owner.bodies : [body];
    for (const b of list) {
      const v = Body.getVelocity(b), vn = Vector.dot(v, n);
      if (vn < B) Body.setVelocity(b, Vector.add(v, Vector.mult(n, B - vn)));
    }
    SND.play('boing', clamp(B / 14, 0.3, 1), 0.8);
  }
  bounces.length = 0;
}

// ---- 風船 ----
// 上にうく。つかんで物やキャラにさわらせると、ひもでつながる（5こくらいつけると、キャラもうく）。
// 刃・針・トゲ・弾・爆発・溶岩でわれる。タップしてもわれる。
const LIFT = 3.8;        // 風船1こが持ち上げる重さ（キャラはだいたい14）
const RISE_MAX = 2;      // 上にいく速さの上限（1コマに進む長さ。うく力で、1コマのうちに、もう少し速くなる）
function updateBalloons(ts) {
  const gy = engine.gravity.y * engine.gravity.scale;
  for (const ent of objects.slice()) {
    if (!ent.T.balloon) continue;
    const b = ent.body;
    ent.age += ts;
    if (b.position.y < -worldH) { removeThing(ent); continue; }   // 見えないくらい高く行ったら消す
    b.force.y -= LIFT * gy;
    const v = Body.getVelocity(b);
    if (v.y < -RISE_MAX) Body.setVelocity(b, { x: v.x, y: -RISE_MAX });
    const c = ent.string;
    if (c) {   // ひもは、ぴんとはったときだけ引っぱる（ゆるんでいるときは、おさない）
      const d = Vector.magnitude(Vector.sub(Vector.add(b.position, c.pointA), Vector.add(c.bodyB.position, c.pointB)));
      c.stiffness = d > c.length ? 0.3 : 0.00001;
    }
  }
}
function touchBalloon(ent, other, at) {
  if (!objects.includes(ent)) return;
  const op = other.plugin || {};
  if ((op.blade && (op.blade.all || onEdge(other, at, op.blade))) || (op.needle && onEdge(other, at, op.needle))) { pop(ent); return; }
  if (ent.string || other.isStatic || (op.owner && op.owner.T.balloon)) return;
  const held = [...pointers.values()].some((p) => p.grab && p.grab.bodyB === ent.body);
  if (!held && ent.age > 10) return;   // つかんでさわらせたとき（か、さわる所に出したとき）だけ、ひもでつなぐ
  const knot = thingPoint(ent, 3.5, 8.5);
  const len = Math.max(6 * PX, Vector.magnitude(Vector.sub(knot, at)));
  ent.string = Constraint.create({ bodyA: ent.body, pointA: Vector.sub(knot, ent.body.position), bodyB: other,
                                   pointB: Vector.sub(at, other.position), length: len, stiffness: 0.3, damping: 0.05 });
  Composite.add(ent.comp, ent.string);
  SND.play('click', 0.6);
}
function pop(ent) {
  if (!objects.includes(ent)) return;
  const p = { x: ent.body.position.x, y: ent.body.position.y };
  removeThing(ent);
  for (let i = 0; i < 10; i++) {
    const a = rand(0, Math.PI * 2), s = rand(2, 6);
    addFx({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.2, drag: 0.95, life: rand(20, 40), size: PX * 0.8,
            colors: BALLOON_COLORS[ent.variant] });
  }
  SND.play('pop', 1);
}
// 消える物やキャラにつないであった風船のひもを切る
function cutStrings(bodies) {
  for (const o of objects) if (o.string && bodies.includes(o.string.bodyB)) { Composite.remove(o.comp, o.string); o.string = null; }
}
function drawStrings() {
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = PX * 0.35;
  for (const o of objects) {
    if (!o.T.balloon) continue;
    const k = thingPoint(o, 3.5, 8.5), c = o.string;
    ctx.beginPath();
    ctx.moveTo(k.x, k.y);
    if (c) ctx.lineTo(c.bodyB.position.x + c.pointB.x, c.bodyB.position.y + c.pointB.y);
    else { const v = Body.getVelocity(o.body); ctx.lineTo(k.x - v.x * 3, k.y + PX * 6); }
    ctx.stroke();
  }
}

// ---- チェーンソー・手りゅう弾 ----
// チェーンソーは、動いている間だけ刃になる。当たっている間、何コマかごとに切りつづける
function toggleSaw(ent) {
  ent.on = !ent.on;
  const S = ent.T.saw;
  ent.body.plugin.blade = ent.on ? { from: S.from, sharp: S.sharp, facing: ent.facing } : null;
  if (!ent.on) ent.sprite = OBJ_SPRITES.chainsaw;
  SND.play(ent.on ? 'engineStart' : 'click', 0.7);
}
function sawCut(ent, sawBody, g, part, collision) {
  const blade = sawBody.plugin.blade;
  if (!ent.on || !blade || ent.sawCool > 0) return;
  const n = collision.supportCount != null ? collision.supportCount : (collision.supports ? collision.supports.length : 0);
  const at = n > 0 ? { x: collision.supports[0].x, y: collision.supports[0].y } : part.position;
  if (!onEdge(sawBody, at, blade)) return;
  ent.sawCool = 5;
  cut(g, part, CUT + 2.5, at, blade);
  SND.play('saw', 0.9, 1.3);
}
function pullPin(ent) {   // ぬいたピンが飛んでいく
  const p = thingPoint(ent, 1, 1);
  addFx({ x: p.x, y: p.y, vx: -ent.facing * rand(1, 3), vy: rand(-5, -3), g: 0.3, drag: 0.99, life: 45, size: PX, colors: ['#a9b2bd'] });
}

// ---- 描く ----
// 絵は画面のこまかさのまま、回転させて描く。だからドット1個1個の形がくずれない（動いてもドットがちらつかない）。
// off は、物の中心（重さの中心）から絵の基準点までのずれ。
function drawSprite(b, sprite, ax, ay, flip = 1, off = null) {
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  if (off) ctx.translate(off.x, off.y);
  ctx.scale(PX * flip, PX);
  ctx.drawImage(sprite, -ax, -ay);
  ctx.restore();
}
function charFace(g) {
  if (g.dead) return 'dead';
  if (g.stun > 0) return 'ko';
  const hurt = g.blood < BLOOD_WEAK ||
    g.parts.some((p) => p.plugin.broken || p.plugin.detached || p.plugin.hp < p.plugin.maxHp * 0.5);
  return hurt ? 'hurt' : 'ok';
}
function drawChar(g) {
  const face = charFace(g);
  const worn = Object.values(g.wear).flatMap((id) => CLOTHES[id].layers);
  for (const p of g.parts) {
    const pl = p.plugin;
    const level = Math.min(4, Math.round(pl.hurt * 4));
    const burn = Math.min(3, Math.round(pl.burn * 3));
    const name = pl.kind === 'head' ? 'head_' + face : pl.sprite;
    const key = pl.kind === 'head' ? 'head' : pl.sprite;
    const [ax, ay] = (CHARS[g.kind].anchor && CHARS[g.kind].anchor[key]) || ANCHOR[key];
    const layers = worn.filter((L) => L.key === key && (!L.seg || L.seg === pl.seg));
    for (const L of layers) if (L.under) drawSprite(p, L.img, ax - L.ox, ay - L.oy, g.facing);
    drawSprite(p, getSprite(g.kind, name, level, burn), ax, ay, g.facing);
    for (const L of layers) if (!L.under) drawSprite(p, L.img, ax - L.ox, ay - L.oy, g.facing);
  }
}
function drawThing(ent) {
  drawSprite(ent.body, ent.lit && ent.T.litSprite ? OBJ_SPRITES[ent.T.litSprite] : ent.sprite, ent.ax, ent.ay, ent.facing, ent.off);
}
// のりもの。乗っている人を先に描いて（clip の中だけ）、その上に車体・窓ガラス・タイヤを描く
function drawVehicle(ent, drawRider) {
  const V = ent.V, b = ent.body;
  if (V.cover && ent.riders.some(Boolean)) {
    const m = ctx.getTransform();
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.translate(ent.off.x, ent.off.y);
    ctx.scale(PX * ent.facing, PX);
    ctx.beginPath();
    ctx.rect(V.clip[0] - ent.ax, V.clip[1] - ent.ay, V.clip[2], V.clip[3]);
    ctx.clip();
    ctx.setTransform(m);
    for (const g of ent.riders) if (g) drawRider(g);
    ctx.restore();
  }
  drawSprite(b, ent.sprite, ent.ax, ent.ay, ent.facing, ent.off);
  if (ent.glass) {
    ctx.globalAlpha = 0.25;
    drawSprite(b, ent.glass, ent.ax, ent.ay, ent.facing, ent.off);
    ctx.globalAlpha = 1;
  }
  const s = ent.wheelSprite;
  for (const w of ent.wheels) drawSprite(w, s, s.width / 2, s.height / 2);
}
// キャラを持っている間は、空いている座席に丸を出す（はなすと乗れる所は緑に光る）
function drawSeatMarks() {
  const held = new Set();
  for (const p of pointers.values()) if (p.grab && p.grab.bodyB.plugin.grape) held.add(p.grab.bodyB.plugin.grape);
  if (!held.size) return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  for (const g of held) {
    const near = nearestSeat(g, BOARD_RANGE), h = hipOf(g);
    for (const ent of objects) {
      if (!ent.riders) continue;
      for (let i = 0; i < ent.riders.length; i++) {
        if (ent.riders[i]) continue;
        const sp = seatPoint(ent, i);
        if (Vector.magnitude(Vector.sub(sp, h)) > 70 * PX) continue;
        const on = near && near.ent === ent && near.i === i;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, PX * (on ? 4 + pulse : 3), 0, Math.PI * 2);
        ctx.fillStyle = on ? 'rgba(108, 207, 95, 0.6)' : 'rgba(255, 255, 255, 0.25)';
        ctx.fill();
        ctx.lineWidth = PX * 0.6;
        ctx.strokeStyle = on ? '#ffffff' : 'rgba(255, 255, 255, 0.8)';
        ctx.stroke();
      }
    }
  }
}
function drawFloaters() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t++;
    if (f.t > 90) { floaters.splice(i, 1); continue; }
    const s = worldToScreen(f.x, f.y), y = s.y - f.t * 0.7;
    ctx.globalAlpha = clamp(1 - (f.t - 50) / 40, 0, 1);
    ctx.font = `bold ${f.small ? 18 : 26}px 'DotGothic16', sans-serif`;
    ctx.strokeText(f.text, s.x, y);
    ctx.fillStyle = f.color || '#ff4444';
    ctx.fillText(f.text, s.x, y);
  }
  ctx.globalAlpha = 1;
}

function render() {
  let ox = 0, oy = 0;   // 爆発で画面がゆれる
  if (shake > 0.5) { ox = rand(-shake, shake); oy = rand(-shake, shake); shake *= 0.9; } else shake = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = currentMap.sky;   // マップより上の空
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const k = cam.z * dpr;
  ctx.setTransform(k, 0, 0, k, (ox - cam.x * cam.z) * dpr, (oy - cam.y * cam.z) * dpr);
  ctx.imageSmoothingEnabled = false;
  if (currentMap.endless) {   // エンドレスのマップは、見えている所の絵をならべる
    const span = CHUNK * PX;
    for (let i = Math.floor(cam.x / span); i <= Math.floor((cam.x + W / cam.z) / span); i++) {
      const ch = chunkArt(ensureChunk(i));
      ctx.drawImage(ch.bg, i * span, 0, span + 1, worldH);
      ctx.drawImage(ch.stain, i * span, 0, span + 1, worldH);
    }
  } else {
    ctx.drawImage(bg, 0, 0, worldW, worldH);
    ctx.drawImage(stain, 0, 0, worldW, worldH);
  }
  const stuckIn = new Map();   // 刺さっている物は、刺さっているキャラのすぐうしろに描く
  for (const o of objects) {
    if (!o.stuck) continue;
    const g = o.stuck.part.plugin.grape;
    if (!stuckIn.has(g)) stuckIn.set(g, []);
    stuckIn.get(g).push(o);
  }
  const drawCharAndStuck = (g) => { for (const o of stuckIn.get(g) || []) drawThing(o); drawChar(g); };
  for (const o of objects) if (o.layer === 0 && !o.stuck) { if (o.V) drawVehicle(o, drawCharAndStuck); else drawThing(o); }
  for (const g of chars) if (!(g.seat && g.seat.ent.V.cover)) drawCharAndStuck(g);   // のりものの中の人は、のりものといっしょに描いた
  drawStrings();
  for (const o of objects) if (o.layer === 1 && !o.stuck) drawThing(o);
  for (const o of objects) if (o.layer === 2 && !o.stuck) drawThing(o);
  drawShells();
  drawSeatMarks();
  for (const b of bloods) {
    const s = b.plugin.size;
    ctx.fillStyle = b.plugin.color;
    ctx.fillRect(b.position.x - s / 2, b.position.y - s / 2, s, s);
  }
  for (const p of fx) {
    const t = 1 - p.life / p.max;
    ctx.globalAlpha = p.life < 10 ? p.life / 10 : 1;
    ctx.fillStyle = p.colors[Math.min(p.colors.length - 1, Math.floor(t * p.colors.length))];
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (const L of liquids) {   // 水の中の物は水ごしに、溶岩の中の物は赤くかくれて見える
    if (L.kind === 'water') {
      ctx.fillStyle = 'rgba(40, 130, 200, 0.38)';
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.fillStyle = 'rgba(225, 245, 255, 0.75)';
      ctx.fillRect(L.x, L.y, L.w, PX * 0.6);
    } else {
      ctx.fillStyle = 'rgba(232, 80, 26, 0.78)';
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.fillStyle = `rgba(255, 210, 58, ${0.65 + 0.3 * Math.sin(stepCount / 9)})`;
      ctx.fillRect(L.x, L.y, L.w, PX * 0.8);
    }
  }
  ctx.lineWidth = PX * 0.5;
  for (const t of tracers) {
    ctx.strokeStyle = `rgba(255, 236, 150, ${t.life / 5})`;
    ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
  }
  // つかんでいる線
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 2 / cam.z;
  for (const p of pointers.values()) {
    if (!p.grab) continue;
    const b = p.grab.bodyB, a = p.grab.pointA;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.position.x + p.grab.pointB.x, b.position.y + p.grab.pointB.y); ctx.stroke();
  }
  drawFloaters();
}

let statsText = '';
function updateStats() {
  let alive = 0;
  for (const g of chars) if (!g.dead) alive++;
  const t = `🍇 ${alive}　💀 ${deadCount}　🪙 ${SHOP.coins()}` + (currentMap.endless ? `　📏 ${endlessBest}m` : '');
  if (t !== statsText) { statsText = t; byId('stats').textContent = t; }
}

// ---- 時間を進める ----
function step() {
  const ts = slow ? 0.25 : 1;
  engine.timing.timeScale = ts;
  updateMuscles(ts);
  updateRiders(ts);
  updateHeld();
  updateGrips();
  updateAI(ts);
  updateThings(ts);
  updateTrain(ts);
  updateShells(ts);
  updateStuck(ts);
  updateLiquids(ts);
  updateVolcano(ts);
  updateBalloons(ts);
  updateChunks();
  Engine.update(engine, STEP);
  holdTrain();
  updateJoints();
  applyBounces();
  stepCount++;
  updateChars(ts);
  updateBlood(ts);
  updateFx(ts);
  if (stepCount % 10 === 0) updateDistance();
}
// エンドレスのマップで、どこまで遠くへ行ったか（メートル）
let endlessBest = 0;
function updateDistance() {
  if (!currentMap.endless) return;
  let far = 0;
  for (const g of chars) far = Math.max(far, Math.abs(g.torso.position.x));
  for (const o of objects) far = Math.max(far, Math.abs(o.body.position.x));
  const m = Math.floor(far / (METER * PX));
  if (m > endlessBest) { endlessBest = m; SHOP.event('distance', m); }
}

let lastT = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(100, t - lastT) : STEP;
  lastT = t;
  if (view !== 'play') return;
  updateZoomAnim();
  updateKeys(dt);
  updateFollow();
  if (!paused && !rotateShown) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 3) { step(); acc -= STEP; n++; }
    if (n === 3) acc = 0;   // 重くて追いつかないときは、あきらめて先に進む
  } else SND.engine(0);
  render();
  updateGripUI();
  updateStats();
}

// ---- さわって動かす ----
// 物やキャラの上をさわると、つかんで動かせる（すばやくはなすと投げられる）。つかまずにタップすると、銃は撃つ・爆弾は火がつく・
// のりものはエンジンがかかる。何もない所をドラッグすると画面が動く。2本指でひろげる・ちぢめるとアップ・ルーズ。
const pointers = new Map();   // さわっている指（マウス）ごとの情報
let camGesture = null;        // 画面を動かしているとき：指の下にある世界の点と、2本指のあいだの長さ

function bodyContains(b, pt) {
  if (!Bounds.contains(b.bounds, pt)) return false;
  const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
  for (const q of parts) if (Vertices.contains(q.vertices, pt)) return true;
  return false;
}
// 指の下にある物。前に描かれている物ほど先にさがす。指は太いので、少しはずれていてもつかめるようにする
function pickAt(pt, slop) {
  const order = [];
  for (const L of [2, 1]) for (let i = objects.length - 1; i >= 0; i--) if (objects[i].layer === L) order.push(...objects[i].bodies);
  const hidden = [];   // のりものの中にかくれている部品（頭いがい）は、のりものより後にさがす
  for (let i = chars.length - 1; i >= 0; i--) {
    const g = chars[i];
    for (let j = g.parts.length - 1; j >= 0; j--) (g.seat && g.seat.ent.V.cover && g.parts[j] !== g.head ? hidden : order).push(g.parts[j]);
  }
  for (let i = objects.length - 1; i >= 0; i--) if (objects[i].layer === 0) order.push(...objects[i].bodies);
  order.push(...hidden);
  const find = (q) => order.find((b) => !(b.plugin.owner && b.plugin.owner.train) && bodyContains(b, q)) || null;
  let found = find(pt);
  for (const r of [slop / 2, slop]) {
    for (let k = 0; k < 8 && !found; k++) {
      const a = k * Math.PI / 4;
      found = find({ x: pt.x + Math.cos(a) * r, y: pt.y + Math.sin(a) * r });
    }
  }
  return found;
}

function grab(p, b, pt) {
  const hand = isHand(b);   // 手をつかむだけでは、体を持ち上げない（足でバランスをとったまま、手だけが動く）
  const c = Constraint.create({ pointA: { x: pt.x, y: pt.y }, bodyB: b, pointB: { x: pt.x - b.position.x, y: pt.y - b.position.y },
                                length: 0, stiffness: hand ? 0.06 : 0.2, damping: 0.1 });
  c.handOnly = hand;
  Composite.add(world, c);
  p.grab = c;
  const g = b.plugin && b.plugin.grape;
  if (g && !hand) { unboard(g); g.held++; setVehicleCollide(g, false); g.noVeh = 1; }   // 持っている間は、のりものをすりぬける
}
function dropGrab(p) {
  if (!p.grab) return;
  Composite.remove(world, p.grab);
  const g = p.grab.bodyB.plugin && p.grab.bodyB.plugin.grape;
  if (g && !p.grab.handOnly) g.held = Math.max(0, g.held - 1);
  p.grab = null;
}
function releaseGrabsOn(bodies) {
  for (const p of pointers.values()) if (p.grab && bodies.includes(p.grab.bodyB)) dropGrab(p);
}
function releaseAllPointers() {
  for (const p of pointers.values()) dropGrab(p);
  pointers.clear();
  camGesture = null;
}
// 持っている物（キャラ以外）は、指でつかんだ所からぶら下がって、重力で下を向く。2本の指でつかむと、向きを決められる
function heldThings() { return [...pointers.values()].filter((p) => p.grab && p.grab.bodyB.plugin && p.grab.bodyB.plugin.owner); }
function updateHeld() {
  for (const p of heldThings()) {   // ぶらぶらゆれつづけないように、回る勢いを少しずつ弱める
    const b = p.grab.bodyB;
    Body.setAngularVelocity(b, Body.getAngularVelocity(b) * 0.85);
  }
  // 持っている物が速すぎると、うすい物をすりぬけてしまうので、速さに上限をつける
  for (const p of pointers.values()) {
    if (!p.grab) continue;
    const b = p.grab.bodyB, v = Body.getVelocity(b), sp = Math.hypot(v.x, v.y), max = b.plugin.grape ? 26 : 22;
    if (sp > max) Body.setVelocity(b, { x: v.x * max / sp, y: v.y * max / sp });
  }
}

// 画面が動いたら、つかんでいる点を指の下にもどす
function syncGrabs() {
  for (const p of pointers.values()) {
    if (!p.grab) continue;
    const w = screenToWorld(p.sx, p.sy);
    p.grab.pointA.x = w.x;
    p.grab.pointA.y = w.y;
  }
}

// 何もつかんでいない指で、画面を動かす（1本なら動かすだけ、2本ならアップ・ルーズも）
function freePointers() { return [...pointers.values()].filter((p) => !p.grab).slice(0, 2); }
function midOf(fp) { return { x: fp.reduce((s, p) => s + p.sx, 0) / fp.length, y: fp.reduce((s, p) => s + p.sy, 0) / fp.length }; }
const pinchSpan = (fp) => (fp.length === 2 ? Math.hypot(fp[0].sx - fp[1].sx, fp[0].sy - fp[1].sy) : 0);
function resetCamGesture() {
  const fp = freePointers();
  if (!fp.length) { camGesture = null; return; }
  const m = midOf(fp);
  camGesture = { ids: fp.map((p) => p.id).join(), anchor: screenToWorld(m.x, m.y), d: pinchSpan(fp) };
}
function applyCamGesture() {
  const fp = freePointers();
  if (!camGesture || fp.map((p) => p.id).join() !== camGesture.ids) { resetCamGesture(); return; }
  const m = midOf(fp);
  if (fp.length === 2) {
    const d = pinchSpan(fp);
    if (camGesture.d > 10 && d > 10) cam.z = clamp(cam.z * d / camGesture.d, zMin(), zMax());
    camGesture.d = d;
  }
  cam.x = camGesture.anchor.x - m.x / cam.z;
  cam.y = camGesture.anchor.y - m.y / cam.z;
  clampCam();
  follow = null;
  camGesture.anchor = screenToWorld(m.x, m.y);   // はしで止まったときも、指の下の点から続ける
  zoomTarget = 0;
  syncGrabs();
}

let lastTap = null;   // 1回目のタップ（ダブルタップの見きわめ）
function onPointerDown(e) {
  if (view !== 'play' || rotateShown) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* もうはなれた指 */ }
  const p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(),
              moved: false, grab: null };
  pointers.set(e.pointerId, p);
  const pt = screenToWorld(e.clientX, e.clientY);
  let b = pickAt(pt, (e.pointerType === 'mouse' ? 6 : 16) / cam.z);
  if (!b) {   // 持っている物の近くに2本目の指を置いたら、同じ物をもう1か所でつかむ（向きを決められる）
    const near = 60 / cam.z;
    for (const h of heldThings()) {
      const bb = h.grab.bodyB.bounds;
      if (pt.x > bb.min.x - near && pt.x < bb.max.x + near && pt.y > bb.min.y - near && pt.y < bb.max.y + near) { b = h.grab.bodyB; break; }
    }
  }
  if (b && b.plugin.owner && b.plugin.owner.gripped) {   // 手に持っている武器の、にぎっている所をつかんだら、武器ではなく手をつかむ
    const g = b.plugin.owner.gripped, at = handPoint(g);
    if (Math.hypot(pt.x - at.x, pt.y - at.y) < 8 * PX) b = g.grip.hand;
  }
  if (b) grab(p, b, pt);
  closePetMenu();
  if (isHand(b)) showGripUI(b.plugin.grape);
  else if (gripUI && gripUI.until && b) gripUI = null;
  resetCamGesture();
}
function onPointerMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.sx = e.clientX;
  p.sy = e.clientY;
  if (!p.moved && Math.hypot(p.sx - p.x0, p.sy - p.y0) > 8) {
    p.moved = true;
    const held = p.grab && p.grab.bodyB.plugin.owner;
    if (held && held.gripped) unequip(held.gripped);
  }
  if (p.grab) {
    const w = screenToWorld(p.sx, p.sy);
    p.grab.pointA.x = w.x;
    p.grab.pointA.y = w.y;
    } else applyCamGesture();
}
function onPointerUp(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (p.grab) {
    const b = p.grab.bodyB;
    const tap = !p.moved && performance.now() - p.t0 < 350;
    dropGrab(p);
    if (gripUI && isHand(b)) gripUI.until = performance.now() + 4000;
    if (tap && b.plugin.owner) activate(b.plugin.owner, screenToWorld(e.clientX, e.clientY));
    else if (b.plugin.grape) {
      const g = b.plugin.grape, now = performance.now();
      if (tap && lastTap && lastTap.g === g && now - lastTap.t < 450) { lastTap = null; openPetMenu(g, e.clientX, e.clientY); }
      else { lastTap = tap ? { g, t: now } : null; tryBoard(g); }
    }
  }
  resetCamGesture();
}
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// マウスのホイール・トラックパッドの2本指でアップ・ルーズ（トラックパッドで横にすべらせると横に動く）
canvas.addEventListener('wheel', (e) => {
  if (view !== 'play') return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  zoomTarget = 0;
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)));
  if (e.deltaX && !e.ctrlKey) {
    follow = null;
    cam.x += e.deltaX * unit / cam.z;
    clampCam();
    syncGrabs();
  }
}, { passive: false });

// キーボード：＋ − でアップ・ルーズ、矢印キーで画面を動かす
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (view !== 'play') return;
  if (e.key === '+' || e.key === '=' || e.key === ';') zoomSmooth(1.25);
  else if (e.key === '-' || e.key === '_') zoomSmooth(0.8);
  else if (e.key.startsWith('Arrow')) { keys.add(e.key); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { keys.delete(e.key); });
window.addEventListener('blur', () => { keys.clear(); });
function updateKeys(dt) {
  if (!keys.size) return;
  const s = dt * 0.9 / cam.z;
  follow = null;
  if (keys.has('ArrowLeft')) cam.x -= s;
  if (keys.has('ArrowRight')) cam.x += s;
  if (keys.has('ArrowUp')) cam.y -= s;
  if (keys.has('ArrowDown')) cam.y += s;
  clampCam();
  syncGrabs();
}

// ---- あそびかた（いつでも ❓ で見られる） ----
// [絵文字, 見出し, 説明]。文字は tr() を通すので、英語は lang.js に書く
const TUTORIAL = [
  ['🍇', 'ようこそ！', 'グレープたちで あそぶ、ぶつりシミュレーターだよ。つかんだり、なげたり、ぶきや ばくだんで、いろいろ ためしてみよう。'],
  ['➕', 'キャラやアイテムを出す', '左上の ＋ を押すと、ひきだしが開くよ。上のタブ（キャラ・ぶき・じゅう…）は、横にすべらせて えらぼう。出したいものを右にスワイプすると、はなした所に出るよ。タップすると、あいている所に出るよ。ひきだしは ✕ で閉じるよ。'],
  ['✋', 'つかむ・なげる', 'キャラやものをさわって、ドラッグ。すばやくはなすと、なげられるよ。持った物は、下を向いてぶら下がるよ。2本の指で持つと、向きを決められるよ。'],
  ['👆', 'タップして つかう', '出した物を、タップしてみよう。じゅうは うつ、ばくだんは 火がつく、チェーンソーは 動く、ふうせんは われるよ。のりものは、タップで 走る・止まる。'],
  ['👆👆', 'ダブルタップ', 'キャラをすばやく2回タップすると、小さいメニューが出るよ。ころす、生き返らせる、もやす、ふくをきせる、ステータス（体力や血などが見られる）が えらべるよ。'],
  ['✊', 'ぶきを持たせる', 'キャラの手（下のうで）をつかむと、「もつ」ボタンが出るよ。手のちかくにころがっている武器で、ボタンを押すと、手に固定されるよ。もう一度、手をつかんで「はなす」を押すと、はなれるよ。'],
  ['🚗', 'のりもの', 'キャラをつかんで、のりものの席の近くではなすと、乗るよ。のりものを タップすると、走りだすよ。乗っている人を つかんで引っぱると、おりるよ。'],
  ['💉', 'ちゅうしゃ', '「ちゅうしゃ」タブの針を、キャラに さしてみよう。みどりは 治す（頭があれば、死んでいても生き返る）、むらさきは どく、青は ねむる、こい緑は ゾンビになる、赤は ちが ぬけるよ。'],
  ['🔍', '画面を動かす', '何もない所を ドラッグすると、画面が動くよ。2本の指（マウスなら ホイール）で、アップ・ルーズ。右下の ルーズ・アップ ボタンでも できるよ。'],
  ['🧹', 'そうじ', '右上の 🧹 か「そうじ」タブで、ぜんぶ・いきもの・しかばね・もの・よごれを、べつべつに消せるよ。'],
  ['🪙', 'コイン・クエスト・ショップ', 'キャラをたおしたり、クエストをクリアしたりすると、コインがもらえるよ。ホームの ショップで、新しいものが買えるよ。モッドでは、自分のキャラやものが作れるよ。'],
  ['❓', 'ほかのボタン', '右上：スロー、一時停止、そうじ、全画面、マップえらび、あそびかた。この説明は、いつでも ❓ で見られるよ。'],
];
const tutEl = byId('tutorial');
let tutPage = 0, tutWasPaused = false;
function renderTutorial() {
  const [icon, title, text] = TUTORIAL[tutPage];
  byId('tutIcon').textContent = icon;
  byId('tutTitle').textContent = tr(title);
  byId('tutText').textContent = tr(text);
  const dots = byId('tutDots');
  dots.textContent = '';
  TUTORIAL.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = i === tutPage ? 'on' : '';
    d.addEventListener('click', () => { tutPage = i; renderTutorial(); });
    dots.append(d);
  });
  byId('tutPrev').disabled = tutPage === 0;
  byId('tutNext').textContent = tr(tutPage === TUTORIAL.length - 1 ? '閉じる' : '次へ ▶');
}
function openTutorial() {
  if (!tutEl.classList.contains('hidden')) return;
  tutPage = 0;
  if (view === 'play') { tutWasPaused = paused; paused = true; releaseAllPointers(); closePetMenu(); }
  renderTutorial();
  tutEl.classList.remove('hidden');
}
function closeTutorial() {
  if (tutEl.classList.contains('hidden')) return;
  tutEl.classList.add('hidden');
  if (view === 'play') paused = tutWasPaused;
}
byId('tutClose').addEventListener('click', closeTutorial);
byId('tutPrev').addEventListener('click', () => { if (tutPage > 0) { tutPage--; renderTutorial(); } });
byId('tutNext').addEventListener('click', () => { if (tutPage < TUTORIAL.length - 1) { tutPage++; renderTutorial(); } else closeTutorial(); });
byId('btnHelp').addEventListener('click', openTutorial);
byId('btnHelpPlay').addEventListener('click', openTutorial);
window.addEventListener('keydown', (e) => {   // 説明が開いているあいだは、ゲームのキーは効かない
  if (tutEl.classList.contains('hidden')) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') closeTutorial();
  else if (e.key === 'ArrowRight') byId('tutNext').click();
  else if (e.key === 'ArrowLeft') byId('tutPrev').click();
}, true);

// ---- ニュース（news.js）。まだ見ていないニュースがあれば、ゲームを開いたときに自動で開く ----
const NEWS = window.GrapeNews || [];
const newsEl = byId('news');
const newsUnseen = () => NEWS.length > 0 && settings.newsSeen !== NEWS[0].id;
function updateNewsBadge() { byId('newsBadge').classList.toggle('hidden', !newsUnseen()); }
function renderNews() {
  const list = byId('newsList');
  list.textContent = '';
  const seen = NEWS.findIndex((n) => n.id === settings.newsSeen);
  const fresh = seen < 0 ? NEWS.length : seen;   // これより前（新しいほう）のニュースは、まだ見ていない
  NEWS.forEach((n, i) => {
    const sec = document.createElement('section');
    sec.className = 'newsItem';
    const head = document.createElement('div');
    head.className = 'newsHead';
    head.textContent = tr('バージョン') + ' ' + n.id + ' · ' + n.date;
    if (i < fresh) {
      const tag = document.createElement('span');
      tag.className = 'newsNew';
      tag.textContent = 'NEW';
      head.append(tag);
    }
    const title = document.createElement('div');
    title.className = 'newsTitle';
    title.textContent = tr(n.title);
    const ul = document.createElement('ul');
    for (const t of n.items) {
      const li = document.createElement('li');
      li.textContent = tr(t);
      ul.append(li);
    }
    sec.append(head, title, ul);
    list.append(sec);
  });
  list.scrollTop = 0;
}
function openNews() {
  renderNews();
  newsEl.classList.remove('hidden');
}
function closeNews() {
  if (newsEl.classList.contains('hidden')) return;
  newsEl.classList.add('hidden');
  if (NEWS.length) { settings.newsSeen = NEWS[0].id; saveSettings(); }
  updateNewsBadge();
}
function checkNews() { if (newsUnseen()) openNews(); }
byId('btnNews').addEventListener('click', openNews);
byId('newsClose').addEventListener('click', closeNews);
byId('newsOk').addEventListener('click', closeNews);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNews(); });


// ---- キャラのステータス（ダブルタップのメニューの 📊）。画面の右がわに出して、そのキャラを見ながら、数字が変わるのも見られる ----
const infoEl = byId('info');
let infoChar = null, infoTimer = 0;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
function charBase(kind) {
  const ch = CHARS[kind];
  return { tough: clamp(Math.ceil((ch.tough || 1) * 1.5), 1, 5), heavy: clamp(Math.round(ch.density / 0.001), 1, 5),
           bleed: clamp(Math.round((ch.bleedRate == null ? 1 : ch.bleedRate) * 3), 1, 5) };
}
function renderInfo() {
  const g = infoChar;
  if (!g || !chars.includes(g)) { closeInfo(); return; }
  const ch = CHARS[g.kind], base = charBase(g.kind);
  byId('infoName').textContent = nameOf(g.kind);
  const box = byId('infoBody');
  box.textContent = '';
  const row = (label, value, frac) => {
    const r = document.createElement('div');
    r.className = 'infoRow';
    const l = document.createElement('span');
    l.textContent = tr(label);
    const v = document.createElement('b');
    v.textContent = value;
    r.append(l, v);
    if (frac != null) {
      const bar = document.createElement('i');
      const f = document.createElement('u');
      f.style.width = clamp(frac, 0, 1) * 100 + '%';
      bar.append(f);
      r.append(bar);
    }
    box.append(r);
  };
  const head = g.head.plugin, torso = g.torso.plugin;
  const limbs = g.parts.filter((p) => (p.plugin.kind === 'arm' && p.plugin.seg === 'armU') || (p.plugin.kind === 'leg' && p.plugin.seg === 'legU'));
  const limbsOn = limbs.filter((p) => !p.plugin.detached).length;
  let cond = g.dead ? 'しんでいる' : g.stun > 0 ? 'きぜつ' : g.blood < BLOOD_WEAK || g.parts.some((p) => p.plugin.broken) ? 'けが' : 'げんき';
  const flags = [];
  if (g.fire > 0) flags.push('もえている');
  if (g.poison > 0) flags.push('どく');
  row('じょうたい', tr(cond) + (flags.length ? ' / ' + flags.map((f) => tr(f)).join(' ') : ''));
  row('からだ', Math.max(0, Math.round(torso.hp)) + ' / ' + Math.round(torso.maxHp), torso.hp / torso.maxHp);
  row('あたま', Math.max(0, Math.round(head.hp)) + ' / ' + Math.round(head.maxHp), head.hp / head.maxHp);
  row(ch.sparks ? 'オイル' : 'ち', Math.max(0, Math.round(g.blood)) + '%', g.blood / 100);
  row('手足', limbsOn + ' / 4');
  row('ぶき', g.grip ? nameOf(g.grip.ent.id) : '−');
  row('ふく', Object.keys(g.wear).length ? Object.values(g.wear).map((id) => nameOf(id)).join('、') : '−');
  const sep = document.createElement('hr');
  box.append(sep);
  row('丈夫さ', stars(base.tough));
  row('おもさ', stars(base.heavy));
  row(ch.sparks ? 'オイルもれ' : 'ちの出やすさ', stars(base.bleed));
  if (ch.undead) row('とくちょう', tr('死んでも起き上がる'));
  if (ch.behavior && ch.behavior !== 'still') row('こうどう', tr(ch.behavior === 'attack' ? 'ほかのキャラをおそう' : 'うろうろあるく'));
  if (ch.behavior === 'attack') row('こうげきの強さ', stars(clamp(Math.round((ch.power || 1) * 1.5), 1, 5)));
  if (ch.note) { const n = document.createElement('p'); n.textContent = tr(ch.note); box.append(n); }
}
function openInfo(g) {
  infoChar = g;
  renderInfo();
  infoEl.classList.remove('hidden');
  clearInterval(infoTimer);
  infoTimer = setInterval(renderInfo, 250);
}
function closeInfo() {
  infoChar = null;
  clearInterval(infoTimer);
  infoEl.classList.add('hidden');
}
byId('infoClose').addEventListener('click', closeInfo);


// ---- 手をつかむと出る「もつ／はなす」ボタン ----
// キャラの手（下のうで）をつかむと、画面の下（まん中）にボタンが出る（はなしても、4秒のあいだ出ている）。
// 「もつ」を押すと、手の近くにころがっている武器が、手に固定される。持っているときは「はなす」になって、押すと手からはなれる。
const gripBtn = byId('gripBtn');
let gripUI = null;   // { g, until }（until が 0 なら、まだ手をつかんでいる）
const isHand = (b) => b && b.plugin && b.plugin.grape && b.plugin.kind === 'arm' && b.plugin.seg === 'armL';
function showGripUI(g) { gripUI = { g, until: 0 }; }
function updateGripUI() {
  const now = performance.now();
  if (gripUI && gripUI.until && now > gripUI.until) gripUI = null;
  if (gripUI && (!chars.includes(gripUI.g) || view !== 'play')) gripUI = null;
  gripBtn.classList.toggle('hidden', !gripUI);
  if (!gripUI) return;
  const g = gripUI.g;
  const on = !!g.grip;
  gripBtn.classList.toggle('on', on);
  const label = tr(on ? '🖐 はなす' : '✊ もつ');
  if (gripBtn.textContent !== label) gripBtn.textContent = label;
}
function pressGrip() {
  if (!gripUI) return;
  const g = gripUI.g;
  if (g.dead) { say('しんでいるので もてない', g.head.position.x, g.head.position.y - 50, '#ffffff', true); return; }
  if (g.grip) { unequip(g); SND.play('click', 0.7); }
  else {
    const o = nearestWeapon(g);
    if (!o) { say('ちかくに ぶきがないよ', g.head.position.x, g.head.position.y - 50, '#ffffff', true); return; }
    const id = o.id;
    removeThing(o);
    equip(g, id);
    SND.play('click', 0.7);
  }
  if (gripUI) gripUI.until = performance.now() + 4000;
}
gripBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pressGrip(); });

// ---- ダブルタップで出る小さいメニュー（ころす・生き返らせる・もやす） ----
const petMenu = byId('petMenu');
let petPos = { x: 0, y: 0 };
function closePetMenu() { petMenu.classList.add('hidden'); petMenu.textContent = ''; }
function placePetMenu() {
  const r = petMenu.getBoundingClientRect();
  petMenu.style.left = clamp(petPos.x - r.width / 2, 6, W - r.width - 6) + 'px';
  petMenu.style.top = clamp(petPos.y - r.height - 30, 6, H - r.height - 6) + 'px';
}
function openPetMenu(g, sx, sy) {
  petPos = { x: sx, y: sy };
  const add = (label, act, fn, keep) => {
    const b = document.createElement('button');
    b.textContent = tr(label);
    b.dataset.act = act;
    b.addEventListener('click', () => { if (!keep) closePetMenu(); fn(); });
    petMenu.append(b);
    return b;
  };
  const at = () => ({ x: g.head.position.x, y: g.head.position.y });
  const main = () => {
    petMenu.textContent = '';
    petMenu.classList.remove('give');
    if (!g.dead) add('💀 ころす', 'kill', () => { g.stun = 0; kill(g, 'menu'); });
    else add('❤ 生き返らせる', 'revive', () => { g.healCool = 0; heal(g, at()); });
    add('🔥 もやす', 'burn', () => ignite(g));
    if (!CHARS[g.kind].noClothes) add('👕 ふくをきせる', 'dress', dress, true);
    add('📊 ステータス', 'stats', () => openInfo(g));
    if (Object.keys(g.wear).length) add('👕 ふくをぬぐ', 'undress', () => { g.wear = {}; });
    petMenu.classList.remove('hidden');
    placePetMenu();
  };
  const dress = () => {
    petMenu.textContent = '';
    petMenu.classList.add('give');
    add('← もどる', 'back', main, true);
    for (const id of Object.keys(CLOTHES)) {
      const b = add(nameOf(id), 'item', () => wear(g, id));
      b.textContent = nameOf(id);
      b.dataset.wear = id;
    }
    placePetMenu();
  };
  main();
}

// ---- アイテムのひきだし ----
const TABS = [
  { id: 'chars', name: 'キャラ', hint: 'スワイプして画面に出す。タップすると空いている所に出る。キャラの手をつかむと出る「もつ」ボタンで、ちかくの武器を持たせられる。' },
  { id: 'weapons', name: 'ぶき', hint: '刃のほうが当たると切れる。刃先からまっすぐ刺すと、刺さる（引っぱると抜ける）。持った物は下を向くので、2本の指で持って向きを決める。' },
  { id: 'guns', name: 'じゅう', hint: '出した銃をタップすると撃つ。マシンガンはもう一度タップすると止まる。ショットガンは、たくさんの弾が広がって飛ぶ。' },
  { id: 'bombs', name: 'ばくだん', hint: '出した爆弾をタップすると火がつく。ばくはつ樽は強くぶつけても爆発する。火炎びんは、割れると、まわりのキャラに火がつく。' },
  { id: 'vehicles', name: 'のりもの', hint: 'キャラをつかんで座席の近くではなすと乗る。のりものをタップすると走る・止まる。戦車は砲台をタップすると撃つ。' },
  { id: 'things', name: 'もの', hint: '風船は、つかんでさわらせると、ひもでつながる。持った物は、下を向いてぶら下がる。2本の指で持つと、向きを決められる。' },
  { id: 'syringes', name: 'ちゅうしゃ', hint: '針を刺すと、いろいろなことが起きる。緑は治す、むらさきはどく、青はねむらせる、黒ずんだ緑はゾンビにする、赤はちをぬく。' },
  { id: 'clothes', name: 'ふく', hint: 'ふくを、キャラの上にスワイプして、はなすと着る。ダブルタップのメニューからも着せられる。ヘルメットとよろいは、ダメージが半分になる。' },
  { id: 'clean', name: 'そうじ', hint: 'ボタンを押すと、消える。' },
  { id: 'mods', name: 'モッド', hint: 'モッドエディターで作ったキャラや物。「＋ 作る」で新しく作れる。' },
];
// ひきだしに出すもの。🔒 のついたものは、ショップで買うと使える
let ITEMS = [];
function buildItems() {
  ITEMS = Object.keys(CHARS).filter((id) => !CHARS[id].hidden).map((id) => ({ id, tab: CHARS[id].mod ? 'mods' : 'chars' }))
    .concat(Object.entries(THINGS).filter(([, T]) => !T.hidden).map(([id, T]) => ({ id, tab: T.tab })))
    .concat(Object.keys(CLOTHES).map((id) => ({ id, tab: 'clothes' })));
}
buildItems();
// キャラや物の名前（モッドの名前は、作った人がつけた名前のまま）
const nameOf = (id) => { const d = CHARS[id] || THINGS[id] || CLOTHES[id]; return !d ? id : d.mod ? d.name : tr(d.name); };
const iconCache = new Map();
function itemIcon(id) {
  let c = iconCache.get(id);
  if (c) return c;
  if (CHARS[id]) c = FIGURES[id];
  else if (CLOTHES[id]) c = clothIcon(id);
  else if (THINGS[id].crate) c = crateSprite(10);
  else if (THINGS[id].vehicle) {   // のりものは、タイヤもつけた絵
    const V = VEHICLES[THINGS[id].vehicle], s = OBJ_SPRITES[V.sprite], w = OBJ_SPRITES[V.wheel];
    c = document.createElement('canvas');
    c.width = s.width;
    c.height = Math.max(s.height, Math.ceil(V.wheels[0][1] + V.r));
    const x = c.getContext('2d');
    x.drawImage(s, 0, 0);
    if (V.glass) { x.globalAlpha = 0.4; x.drawImage(OBJ_SPRITES[V.glass], 0, 0); x.globalAlpha = 1; }
    for (const [wx, wy] of V.wheels) x.drawImage(w, Math.round(wx - w.width / 2), Math.round(wy - w.height / 2));
  } else c = OBJ_SPRITES[THINGS[id].sprite];
  iconCache.set(id, c);
  return c;
}
let tab = 'chars';

function renderDrawer() {
  const tabsEl = byId('tabs');
  tabsEl.textContent = '';
  for (const tb of TABS) {
    const b = document.createElement('button');
    b.textContent = tr(tb.name);
    b.dataset.tab = tb.id;
    b.classList.toggle('on', tb.id === tab);
    b.addEventListener('click', () => { tab = tb.id; renderDrawer(); });
    tabsEl.append(b);
  }
  const itemsEl = byId('items');
  itemsEl.textContent = '';
  if (tab === 'clean') {
    for (const [icon, label, fn] of CLEANERS) {
      const el = document.createElement('button');
      el.className = 'item make';
      el.dataset.clean = label;
      el.textContent = icon;
      const span = document.createElement('span');
      span.textContent = tr(label);
      el.append(span);
      el.addEventListener('click', () => { fn(); SND.play('pop', 0.8); });
      itemsEl.append(el);
    }
    byId('drawerHint').textContent = tr(TABS.find((tb) => tb.id === tab).hint);
    return;
  }
  for (const it of ITEMS.filter((i) => i.tab === tab)) {
    const locked = SHOP.locked(it.id);
    const el = document.createElement('div');
    el.className = 'item' + (locked ? ' locked' : '');
    el.dataset.item = it.id;
    const icon = itemIcon(it.id);
    const c = document.createElement('canvas');
    c.width = icon.width; c.height = icon.height;
    c.getContext('2d').drawImage(icon, 0, 0);
    const k = Math.min((locked ? 42 : 60) / icon.height, 76 / icon.width);
    c.style.width = icon.width * k + 'px';
    c.style.height = icon.height * k + 'px';
    const label = document.createElement('span');
    label.textContent = nameOf(it.id);
    el.append(c, label);
    if (locked) {   // まだ買っていない：タップするとショップを開く
      const price = document.createElement('small');
      price.className = 'price';
      price.textContent = '🔒 🪙' + SHOP.price(it.id);
      el.append(price);
      el.addEventListener('click', () => showView('shop', { from: 'play', focus: it.id }));
    } else {
      el.addEventListener('pointerdown', onItemDown);
      el.addEventListener('pointermove', onItemMove);
      el.addEventListener('pointerup', onItemUp);
      el.addEventListener('pointercancel', onItemCancel);
    }
    itemsEl.append(el);
  }
  if (tab === 'mods') {   // モッドエディターを開くボタン
    const el = document.createElement('button');
    el.className = 'item make';
    el.textContent = '🛠';
    const label = document.createElement('span');
    label.textContent = tr('＋ 作る');
    el.append(label);
    el.addEventListener('click', () => showView('mods', { from: 'play' }));
    itemsEl.append(el);
  }
  byId('drawerHint').textContent = tr(TABS.find((tb) => tb.id === tab).hint);
}
const openDrawer = () => drawer.classList.add('open');
const closeDrawer = () => drawer.classList.remove('open');

// アイテムを指でつかんで、ひきだしの外まで持っていって、はなした所に出す
let drag = null;
function onItemDown(e) {
  const it = ITEMS.find((i) => i.id === e.currentTarget.dataset.item);
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  const facing = settings.facing || (Math.random() < 0.5 ? 1 : -1);
  drag = { it, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, facing };
  const icon = itemIcon(it.id);
  ghost.width = icon.width; ghost.height = icon.height;
  const gx = ghost.getContext('2d');
  gx.clearRect(0, 0, icon.width, icon.height);
  gx.drawImage(icon, 0, 0);
  ghost.style.width = icon.width * PX * cam.z + 'px';
  ghost.style.height = icon.height * PX * cam.z + 'px';
  ghost.dataset.flip = facing;
}
function placeGhost(x, y) {
  ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scaleX(${ghost.dataset.flip})`;
}
function onItemMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) {
    drag.moved = true;
    ghost.classList.remove('hidden');
  }
  if (!drag.moved) return;
  placeGhost(e.clientX, e.clientY);
}
function onItemUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  ghost.classList.add('hidden');
  if (d.moved && e.clientX > drawer.getBoundingClientRect().right) spawnItem(d.it.id, e.clientX, e.clientY, d.facing);
  else if (!d.moved) spawnItem(d.it.id, null, null, d.facing);
  // ひきだしの中ではなしたら、なにもしない。ひきだしは、✕ か ＋ で閉じるまで開いたまま
}
function onItemCancel() { drag = null; ghost.classList.add('hidden'); }

// タップで出すときの場所：今見えている所のうち、ほかのキャラや物からいちばん遠い所
function freeSpotX() {
  const vw = W / cam.z, x0 = Math.max(cam.x, worldX0), x1 = Math.min(cam.x + vw, worldX1);
  let best = (x0 + x1) / 2, bestD = -1;
  for (let i = 0; i <= 12; i++) {
    const x = x0 + (x1 - x0) * (0.15 + 0.7 * i / 12);
    let d = Infinity;
    for (const g of chars) d = Math.min(d, Math.abs(g.torso.position.x - x));
    for (const o of objects) d = Math.min(d, Math.abs(o.body.position.x - x));
    if (d > bestD) { bestD = d; best = x; }
  }
  return best;
}
// 出す物の、絵の基準点から下のはしまで（ドット）
function bottomOf(id) {
  const T = THINGS[id];
  if (T.vehicle) { const V = VEHICLES[T.vehicle]; return V.wheels[0][1] + V.r - V.ay; }
  if (T.crate) return 6;
  if (T.circle) return T.circle;
  return OBJ_SPRITES[T.sprite].height / 2;
}

// sx, sy は指をはなした画面の場所（null ならタップ）。キャラは体のまん中がそこに来るように出す
function spawnItem(id, sx, sy, facing) {
  const tap = sx == null;
  const p = tap ? null : screenToWorld(sx, sy);
  const top = cam.y + 1;   // 見えている所のいちばん上
  if (CHARS[id]) {
    SHOP.event('spawnChar');
    const x = clamp(tap ? freeSpotX() : p.x, worldX0 + 6 * PX, worldX1 - 6 * PX);
    const hy = tap ? top : p.y - FIG_CENTER * PX;                    // 頭の中心
    const stand = surfaceAt(x, hy) - FOOT_BELOW_HEAD * PX - 1;       // 足が地面にとどく高さ
    return makeChar(id, x, Math.max(tap ? stand : Math.min(hy, stand), -worldH), { facing, guard: 90 });
  }
  if (CLOTHES[id]) {   // 服は、キャラの上ではなしたときだけ着る
    const b = tap ? null : pickAt(p, 12 / cam.z), g = b && b.plugin.grape;
    if (g) wear(g, id);
    else say('キャラの上ではなしてね', tap ? cam.x + W / cam.z / 2 : p.x, tap ? cam.y + H / cam.z / 2 : p.y - 40, '#ffffff', true);
    return null;
  }
  if (!tap && canEquip(id)) {   // キャラの上ではなすと、そのキャラが持つ
    const b = pickAt(p, 12 / cam.z), g = b && b.plugin.grape;
    if (g && !g.dead) { const ent = equip(g, id); if (ent) return ent; }
  }
  const x = clamp(tap ? freeSpotX() : p.x, worldX0 + 12 * PX, worldX1 - 12 * PX);
  const want = tap ? cam.y + H / cam.z * 0.3 : p.y;
  const rest = surfaceAt(x, tap ? top : want) - bottomOf(id) * PX - 1;   // 地面に置いたときの高さ
  return makeThing(id, x, tap && THINGS[id].vehicle ? rest : Math.min(want, rest), facing);
}

// そうじのタブのボタン。ぜんぶ、生きもの・しかばね・物・よごれ（血やこげあと）の一部だけを消せる
function clearLiving() { for (const g of chars.slice()) if (!g.dead) removeChar(g); }
function clearCorpses() { for (const g of chars.slice()) if (g.dead) removeChar(g); }
function clearThings() { for (const o of objects.slice()) removeThing(o); SND.engine(0); }
function clearDecals() {
  Composite.remove(world, bloods);
  bloods.length = 0;
  sctx.clearRect(0, 0, stain.width, stain.height);
  for (const ch of chunks.values()) if (ch.sctx) ch.sctx.clearRect(0, 0, CHUNK, currentMap.h);
}
const CLEANERS = [
  ['🧹', 'ぜんぶ消す', () => clearAll()],
  ['🧍', 'いきものを消す', clearLiving],
  ['💀', 'しかばねを消す', clearCorpses],
  ['📦', 'ものを消す', clearThings],
  ['🩸', 'よごれを消す', clearDecals],
];
function clearAll() {
  closePetMenu();
  releaseAllPointers();
  follow = null;
  for (const g of chars) Composite.remove(world, g.comp, true);
  chars.length = 0;
  for (const o of objects) Composite.remove(world, o.comp, true);
  objects.length = 0;
  Composite.remove(world, bloods);
  bloods.length = 0;
  fx.length = 0;
  shells.length = 0;
  bounces.length = 0;
  tracers.length = 0;
  floaters.length = 0;
  sctx.clearRect(0, 0, stain.width, stain.height);
  for (const ch of chunks.values()) if (ch.sctx) ch.sctx.clearRect(0, 0, CHUNK, currentMap.h);
  SND.engine(0);
}

// ---- 画面の切りかえ（ホーム → マップ選択 → ゲーム。ホームから、せってい・クエスト・ショップ・モッド） ----
// ショップ・クエスト・モッドの「もどる」は、開いた所（ホーム・ゲーム・せってい）にもどる。opts.from でえらべる
let backView = 'home';
function showView(name, opts = {}) {
  if (name === 'shop' || name === 'quests' || name === 'mods') backView = opts.from || (view === 'play' ? 'play' : 'home');
  view = name;
  byId('dialog').classList.add('hidden');
  for (const id of ['home', 'maps', 'settings', 'shop', 'quests', 'mods']) byId(id).classList.toggle('hidden', name !== id);
  for (const id of ['btnItems', 'stats', 'hudRight', 'zoomBtns']) byId(id).classList.toggle('hidden', name !== 'play');
  byId('btnFull').classList.toggle('hidden', !document.fullscreenEnabled);
  if (name !== 'play') {
    closeTutorial();
    closePetMenu();
    closeDrawer();
    releaseAllPointers();
    SND.engine(0);
    byId('hint').classList.add('hidden');
  }
  if (name === 'shop') SHOP.renderShop(byId('shopList'), opts.focus);
  if (name === 'quests') SHOP.renderQuests(byId('questList'));
  if (name === 'mods' && MODS) MODS.open(opts);
  updateCoins();
  refreshRainbow();
  SND.music(name === 'play' ? currentMap.music : 'title');
  updateRotate();
}
// ホーム画面のコイン
function updateCoins() { byId('coinHome').textContent = SHOP.coins(); }
// せっていの「にじ色」は、買うまでカギがかかっている
function refreshRainbow() {
  const b = document.querySelector('.seg[data-key="rainbow"] button[data-v="1"]');
  if (b) b.textContent = SHOP.locked('rainbow') ? tr('🔒 にじ色') : tr('🌈 にじ色');
}

// スマホがたて向きのときは「横にしてね」を出して、時間を止める
function updateRotate() {
  rotateShown = view === 'play' && isTouch && H > W;
  byId('rotate').classList.toggle('hidden', !rotateShown);
  if (rotateShown) releaseAllPointers();
}

// 全画面にして、スマホでは横向きに固定する（できる機種だけ）。Mac や PC でも全画面になる
function goLandscape() {
  if (!document.fullscreenEnabled) return;
  const lock = () => (isTouch && screen.orientation && screen.orientation.lock ? screen.orientation.lock('landscape') : Promise.resolve());
  const p = document.fullscreenElement ? lock() : document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock);
  p.catch(() => {});
}

// はじめてマップを始めたときだけ、画面の動かし方を少しのあいだ出す
let hintShown = false, hintTimer = 0;
function showHint() {
  const el = byId('hint');
  el.textContent = isTouch ? tr('何もない所をドラッグすると画面が動く。2本指でアップ・ルーズ')
                           : tr('何もない所をドラッグすると画面が動く。ホイールでアップ・ルーズ');
  el.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add('hidden'), 6000);
}

function startMap(m) {
  currentMap = m;
  mapStarted = true;
  SHOP.event('map', m.id);
  clearAll();
  buildMap(m);
  measure();
  cam.z = zBase;
  zoomTarget = 0;
  const sx = m.start * PX, ground = surfaceAt(sx, 0);
  cam.x = sx - W / cam.z / 2;
  cam.y = ground - H / cam.z * 0.78;   // 地面が画面の下のほうに来るように
  clampCam();
  paused = false; slow = false;
  byId('btnSlow').classList.remove('on');
  byId('btnPause').textContent = '⏸';
  showView('play');
  makeChar('grape', sx, ground - FOOT_BELOW_HEAD * PX - 1, { facing: 1, guard: 30 });   // 最初の一体は地面に立っている
  if (!settings.tutorialSeen && !navigator.webdriver) { settings.tutorialSeen = 1; saveSettings(); openTutorial(); hintShown = true; }   // はじめてのときだけ、自動で開く
  else if (!hintShown) { hintShown = true; showHint(); }
}

// 画面の大きさが変わったとき（スマホを回したときなど）。見ていた所をまん中にしたまま、キャラの見える大きさをそろえる
function onResize() {
  const oldW = W, oldH = H, oldBase = zBase;
  const c = screenToWorld(W / 2, H / 2);
  measure();
  updateRotate();
  if (view !== 'play' || (W === oldW && H === oldH)) return;
  cam.z *= zBase / oldBase;
  zoomTarget = 0;
  centerCamOn(c.x, c.y);
  syncGrabs();
}
window.addEventListener('resize', onResize);

byId('btnPlay').addEventListener('click', () => { goLandscape(); showView('maps'); });
byId('btnSettings').addEventListener('click', () => showView('settings'));
byId('btnSettingsBack').addEventListener('click', () => showView('home'));
byId('btnShop').addEventListener('click', () => showView('shop'));
byId('btnQuests').addEventListener('click', () => showView('quests'));
byId('btnMods').addEventListener('click', () => showView('mods'));
for (const id of ['btnShopBack', 'btnQuestsBack', 'btnModsBack']) byId(id).addEventListener('click', () => showView(backView));
// コインがふえたり、何かを買ったりしたら、表示とひきだしを作り直す
SHOP.onChange((what) => { updateCoins(); refreshRainbow(); statsText = ''; if (what !== 'coins') renderDrawer(); });
byId('btnHome').addEventListener('click', () => showView('home'));
byId('btnMap').addEventListener('click', () => showView('maps'));
byId('btnItems').addEventListener('click', () => (drawer.classList.contains('open') ? closeDrawer() : openDrawer()));
byId('btnDrawerClose').addEventListener('click', closeDrawer);
byId('btnSlow').addEventListener('click', (e) => { slow = !slow; e.currentTarget.classList.toggle('on', slow); });
byId('btnPause').addEventListener('click', (e) => { paused = !paused; e.currentTarget.textContent = paused ? '▶' : '⏸'; });
byId('btnClear').addEventListener('click', () => { tab = 'clean'; renderDrawer(); openDrawer(); });
byId('btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : goLandscape()));
byId('btnUp').addEventListener('click', () => zoomSmooth(1.5));
byId('btnLoose').addEventListener('click', () => zoomSmooth(1 / 1.5));
document.addEventListener('click', (e) => { if (e.target.closest('button')) SND.play('ui', 0.6); });

// ブラウザは、画面をさわるまで音を出させてくれない。さわったら音をオンにする
for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(type, () => SND.unlock(), true);

// せっていのボタン（押した物が緑になる）
for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.dataset.key;
  if (key === 'lang') continue;
  const refresh = () => { for (const b of seg.children) b.classList.toggle('on', Number(b.dataset.v) === Number(settings[key])); };
  for (const b of seg.children) {
    b.addEventListener('click', () => {
      if (key === 'rainbow' && b.dataset.v === '1' && SHOP.locked('rainbow')) { showView('shop', { from: 'settings', focus: 'rainbow' }); return; }
      settings[key] = Number(b.dataset.v);
      saveSettings();
      refresh();
      if (key === 'music' || key === 'sfx') SND.setVolumes(settings.music, settings.sfx);
      if (key === 'size') measure();
    });
  }
  refresh();
}

// ことば（日本語・英語）。かえたら、画面の言葉をぜんぶ書きかえる
const langSeg = document.querySelector('.seg[data-key="lang"]');
function refreshLang() { for (const b of langSeg.children) b.classList.toggle('on', b.dataset.v === LANG.lang()); }
for (const b of langSeg.children) b.addEventListener('click', () => LANG.set(b.dataset.v));
refreshLang();
LANG.onChange(() => {
  refreshLang();
  renderDrawer();
  renderMapNames();
  refreshRainbow();
  if (view === 'shop') SHOP.renderShop(byId('shopList'));
  if (view === 'quests') SHOP.renderQuests(byId('questList'));
  if (MODS) MODS.relang();
  if (!byId('hint').classList.contains('hidden')) showHint();
});

// ホーム画面のマスコット
byId('mascot').getContext('2d').drawImage(SPRITES.grape.head_ok, 0, 0);

// マップ選択のカード（マップ全体を小さくした絵つき）
const mapList = byId('mapList');
for (const m of MAPS) {
  const btn = document.createElement('button');
  btn.className = 'map';
  btn.dataset.map = m.id;
  let full = document.createElement('canvas');
  full.width = m.w; full.height = m.h;
  if (m.endless) full = endlessPreview(m);
  else paintMap(full.getContext('2d'), m, null);
  const thumb = document.createElement('canvas');
  thumb.className = 'thumb';
  const TW = 288, TH = 192;
  thumb.width = TW; thumb.height = TH;
  const tx = thumb.getContext('2d');
  tx.fillStyle = m.sky;
  tx.fillRect(0, 0, TW, TH);
  const k = Math.max(Math.min(TW / m.w, TH / m.h), TH * 0.6 / m.h);   // 横長のマップは、最初のブドウのあたりを切りとる
  const ox = clamp(TW / 2 - (m.endless ? m.w / 2 : m.start) * k, TW - m.w * k, Math.max(0, (TW - m.w * k) / 2));
  tx.imageSmoothingQuality = 'high';
  tx.drawImage(full, ox, TH - m.h * k, m.w * k, m.h * k);
  btn.append(thumb, document.createElement('b'), document.createElement('small'));
  btn.addEventListener('click', () => startMap(m));
  mapList.append(btn);
}
// マップの名前と説明（ことばをかえたときも書きかえる）
function renderMapNames() {
  for (const btn of mapList.children) {
    const m = MAPS.find((x) => x.id === btn.dataset.map);
    btn.querySelector('b').textContent = tr(m.name);
    btn.querySelector('small').textContent = tr(m.desc);
  }
}
renderMapNames();

// ---- モッド ----
// mods.js で作ったキャラや物を、キャラ（CHARS）と物（THINGS）に足す。消したモッドは、ひきだしから消すだけにする
// （もう出ているキャラや物が、こまらないように）。
const MOD_KEYS = '0123456789abcdfhijklmnoqrstuvwxz';   // モッドの色の番号を絵の文字にする（顔や体の文字とかぶらない文字だけ）
const MOD_FACES = { fruit: FRUIT_FACES, robot: ROBOT_FACES, zombie: ZOMBIE_FACES, none: NO_FACES };
const modPartRows = (px) => px.map((r) => [...r].map((ch) => (ch === '.' ? '.' : MOD_KEYS[MODS.IDX.indexOf(ch)])).join(''));
const modRows = (m) => modPartRows(m.px);
const hasPart = (px) => Array.isArray(px) && px.some((r) => /[^.]/.test(r));
function modPal(m) {
  const pal = {};
  m.colors.forEach((c, i) => { pal[MOD_KEYS[i]] = c; });
  return pal;
}
function modChar(m) {
  const rgb = [1, 3, 5].map((i) => parseInt(m.blood.slice(i, i + 2), 16)).join(', ');
  // どう・うで・あしを描いていれば、それを使う（あしの絵は、ふとももと すね の りょうほうに使う）。かいていなければ、ふつうの形のまま
  const hasTorso = hasPart(m.torsoPx), hasArm = hasPart(m.armPx), hasLeg = hasPart(m.legPx);
  const build = (hasTorso || hasArm || hasLeg) ? {
    torso: hasTorso ? modPartRows(m.torsoPx) : undefined, arm: hasArm ? modPartRows(m.armPx) : undefined,
    legU: hasLeg ? modPartRows(m.legPx) : undefined, legL: hasLeg ? modPartRows(m.legPx) : undefined,
  } : undefined;
  return { name: m.name, mod: true, head: modRows(m), faces: MOD_FACES[m.face] || FRUIT_FACES, tough: m.tough,
           undead: m.undead, behavior: m.behavior, speed: m.speed, power: m.power, build,
           density: [0.0014, 0.002, 0.004][m.weight], sparks: m.sparks, bleedRate: m.sparks ? 0.5 : 1,
           blood: m.blood, stain: shadeColor(m.blood, -70), hurtTint: rgb,
           pal: Object.assign(modPal(m), CHAR_COMMON, { D: m.outline, P: m.skin, p: shadeColor(m.skin, -40), S: m.shirt,
                                                        E: '#39e6ff', e: '#ff8a1f', W: '#f0f0d0' }) };
}
function modThing(m) {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;   // かいてある所をかこむ四角
  m.px.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const T = { tab: 'mods', name: m.name, mod: true, sprite: m.id, density: [0.001, 0.003, 0.012][m.weight], layer: 2,
              mat: m.kind === 'ball' ? 'rubber' : m.weight === 2 ? 'metal' : 'wood', restitution: m.bounce };
  if (m.kind === 'ball') { T.circle = Math.max(1, Math.min(bw, bh) / 2); T.circleAt = [x0 + bw / 2, y0 + bh / 2]; }
  else T.rects = [[x0, y0, bw, bh]];
  if (m.kind === 'plain' || m.kind === 'ball') T.layer = 0;
  if (m.kind === 'blade') { T.blade = { from: m.bladeFrom - m.w / 2, sharp: 1.2 }; T.stick = 6; }
  if (m.kind === 'gun') {   // 銃口は、いちばん右の列のまん中
    const ys = m.px.map((r, y) => (r[x1] !== '.' ? y : -1)).filter((y) => y >= 0);
    const my = (ys[0] + ys[ys.length - 1] + 1) / 2;
    T.gun = { muzzle: [x1 + 1, my], power: m.gunPower, recoil: m.gunPower / 8, sound: m.gunAuto ? 'mg' : 'bang',
              auto: m.gunAuto, every: 5, spread: 0.05 };
  }
  if (m.kind === 'bomb') { T.bomb = { fuse: Math.round(m.fuse * 60), power: m.power }; T.layer = 1; }
  if (m.kind === 'heal') T.needle = x1 - 2 - m.w / 2;   // いちばん右の3列が針
  return T;
}
function registerMod(m) {
  if (m.type === 'char') {
    CHARS[m.id] = modChar(m);
    SPRITES[m.id] = makeCharSprites(CHARS[m.id]);
    FIGURES[m.id] = makeFigure(m.id);
    for (const k of [...tintCache.keys()]) if (k.startsWith(m.id + ':')) tintCache.delete(k);
  } else {
    OBJ_SPRITES[m.id] = makeSprite(modRows(m), modPal(m));
    THINGS[m.id] = modThing(m);
  }
  iconCache.delete(m.id);
}
function syncMods() {
  if (!MODS) return;
  const live = new Set();
  for (const m of MODS.list()) {
    try { registerMod(m); live.add(m.id); } catch (e) { console.warn('モッドを読みこめなかった', m.id, e); }
  }
  for (const [id, def] of [...Object.entries(CHARS), ...Object.entries(THINGS)]) if (def.mod) def.hidden = !live.has(id);
  buildItems();
  renderDrawer();
}
// モッドエディターで作っている物の絵（ゲームと同じ作り方）
function modPreview(m) {
  return m.type === 'char' ? makeFigure(null, makeCharSprites(modChar(m))) : makeSprite(modRows(m), modPal(m));
}
if (MODS) MODS.onChange(syncMods);

// テストや実験のために外から触れるようにしておく。場所は世界の中の長さ（x, y）か、画面の場所（sx, sy）
const partInfo = (p) => ({ kind: p.plugin.kind, sprite: p.plugin.sprite, a: +p.angle.toFixed(2), hp: Math.round(p.plugin.hp), broken: p.plugin.broken,
                           detached: p.plugin.detached, bleed: +p.plugin.bleed.toFixed(2), jointDmg: Math.round(p.plugin.jointDmg),
                           x: Math.round(p.position.x), y: Math.round(p.position.y) });
window.GRAPE = {
  spawnChar: (kind, x, y, angle, facing) => chars.indexOf(makeChar(kind, x, y, { angle, facing })),
  spawnStanding: (kind, x, facing = 1) =>
    chars.indexOf(makeChar(kind, x, surfaceAt(x, 0) - FOOT_BELOW_HEAD * PX - 1, { facing, guard: 30 })),
  kill: (i) => kill(chars[i], 'test'),
  spawn: (id, x, y, facing = 1, angle = 0, vx = 0, vy = 0) => {
    const e = makeThing(id, x, y, facing);
    if (angle) Composite.rotate(e.comp, angle, { x, y });
    for (const b of e.bodies) Body.setVelocity(b, { x: vx, y: vy });
    return objects.indexOf(e);
  },
  spawnItem: (id, sx, sy, facing) => { spawnItem(id, sx, sy, facing); return true; },
  spawnOnGround: (id, x, facing = 1) => objects.indexOf(makeThing(id, x, surfaceAt(x, 0) - bottomOf(id) * PX - 1, facing)),
  icon: (id) => itemIcon(id),
  itemName: nameOf,
  show: (name, opts) => showView(name, opts),
  modPreview,
  // モッドエディターの「ためす」：ゲームにもどって（まだならグラウンドを始めて）、そのモッドを出す。まだ買っていないモッドなら、ショップを開く
  tryMod: (id) => {
    if (SHOP.locked(id)) { showView('shop', { from: 'mods', focus: id }); return false; }
    if (mapStarted) showView('play'); else startMap(MAPS[0]);
    spawnItem(id, null, null, 1);
    return true;
  },
  activate: (i, x, y) => activate(objects[i], x == null ? null : { x, y }),
  board: (ci, oi, seat = 0) => { board(chars[ci], objects[oi], seat); return true; },
  tryBoard: (ci) => tryBoard(chars[ci]),
  seatPoint: (oi, seat = 0) => seatPoint(objects[oi], seat),
  removeObject: (i) => removeThing(objects[i]),
  explode: (x, y, power) => explode(x, y, power),
  clearAll, clearLiving, clearCorpses, clearThings, clearDecals,
  petMenu: (i) => { const g = chars[i]; const s = worldToScreen(g.torso.position.x, g.torso.position.y); openPetMenu(g, s.x, s.y); },
  ignite: (i) => ignite(chars[i]),
  bite: (i, j, only) => attackChar(chars[i], chars[j], only),
  ai: (i) => ({ facing: chars[i].facing, chasing: !!chars[i].chasing, kind: chars[i].kind }),
  callTrain: (mode, dir) => { const e = callTrain(mode, dir); return e ? objects.indexOf(e) : -1; },
  trainState: () => ({ state: trainState, running: !!trainEnt, x: trainEnt ? Math.round(trainEnt.body.position.x) : null }),
  news: () => ({ open: !newsEl.classList.contains('hidden'), badge: !byId('newsBadge').classList.contains('hidden'), seen: settings.newsSeen,
                 entries: byId('newsList').querySelectorAll('.newsItem').length, fresh: byId('newsList').querySelectorAll('.newsNew').length }),
  checkNews,
  wear: (i, id) => wear(chars[i], id),
  handScreen: (i) => { const h = handPoint(chars[i]); const p = worldToScreen(h.x, h.y); return { x: Math.round(p.x), y: Math.round(p.y - 12) }; },
  gripUI: () => ({ shown: !gripBtn.classList.contains('hidden'), text: gripBtn.textContent }),
  worn: (i) => ({ ...chars[i].wear }),
  info: () => ({ open: !infoEl.classList.contains('hidden'), name: byId('infoName').textContent, rows: byId('infoBody').querySelectorAll('.infoRow').length }),
  openInfo: (i) => openInfo(chars[i]),
  tutorial: () => ({ open: !tutEl.classList.contains('hidden'), page: tutPage, pages: TUTORIAL.length }),
  equip: (i, id) => { const e = equip(chars[i], id); return e ? objects.indexOf(e) : -1; },
  unequip: (i) => unequip(chars[i]),
  gripOf: (i) => { const gr = chars[i].grip; return gr ? { obj: objects.indexOf(gr.ent), handX: Math.round(gr.hand.position.x), handY: Math.round(gr.hand.position.y), rel: +(gr.ent.body.angle - gr.hand.angle).toFixed(2) } : null; },
  inject: (i, kind) => inject(chars[i], chars[i].head.position, kind),
  startMap: (i) => startMap(typeof i === 'string' ? MAPS.find((m) => m.id === i) : MAPS[i]),
  maps: () => MAPS.map((m) => ({ id: m.id, name: m.name, w: m.w * PX, h: m.h * PX, start: m.start * PX })),
  view: () => view,
  settings,
  cam: () => ({ x: cam.x, y: cam.y, z: cam.z, zBase, zMin: zMin(), zMax: zMax(), W, H }),
  setCam: (x, y, z) => { if (z) cam.z = z; zoomTarget = 0; centerCamOn(x, y); syncGrabs(); },
  toScreen: (x, y) => worldToScreen(x, y),
  toWorld: (sx, sy) => screenToWorld(sx, sy),
  surface: (x, y) => surfaceAt(x, y),
  stats: () => ({ view, map: currentMap.id, grapes: chars.length, alive: chars.filter((g) => !g.dead).length,
                  kinds: chars.map((g) => g.kind), dead: deadCount, objects: objects.map((o) => o.id), blood: bloods.length,
                  coins: SHOP.coins(), distance: endlessBest, fx: fx.length, grabs: [...pointers.values()].filter((p) => p.grab).length, W, H, paused, slow }),
  poseOf: (i) => {
    const g = chars[i];
    if (!g) return null;
    const { head, torso } = g;
    const feet = g.parts.filter((p) => p.plugin.sprite === 'legLF' || p.plugin.sprite === 'legLB');
    const hs = worldToScreen(head.position.x, head.position.y), ts = worldToScreen(torso.position.x, torso.position.y);
    return { kind: g.kind, dead: g.dead, cause: g.cause, stun: Math.round(g.stun), muscle: +g.muscle.toFixed(2),
             seat: g.seat ? { obj: objects.indexOf(g.seat.ent), i: g.seat.i } : null, facing: g.facing,
             blood: Math.round(g.blood), held: g.held, hp: { head: Math.round(head.plugin.hp), torso: Math.round(torso.plugin.hp) },
             torsoAngle: +wrapAngle(torso.angle).toFixed(2), headX: Math.round(head.position.x), headY: Math.round(head.position.y),
             torsoX: Math.round(torso.position.x), torsoY: Math.round(torso.position.y),
             footY: Math.round(Math.max(...feet.map((f) => f.position.y))),
             headSX: Math.round(hs.x), headSY: Math.round(hs.y), torsoSX: Math.round(ts.x), torsoSY: Math.round(ts.y),
             parts: g.parts.map(partInfo) };
  },
  objectOf: (i) => {
    const o = objects[i];
    if (!o) return null;
    const b = o.body, s = worldToScreen(b.position.x, b.position.y), v = Body.getVelocity(b);
    return { id: o.id, x: Math.round(b.position.x), y: Math.round(b.position.y), sx: Math.round(s.x), sy: Math.round(s.y),
             angle: +b.angle.toFixed(2), vx: +v.x.toFixed(2), vy: +v.y.toFixed(2), lit: !!o.lit, on: !!o.on, firing: !!o.firing,
             stuckIn: o.stuck ? { char: chars.indexOf(o.stuck.part.plugin.grape), part: o.stuck.part.plugin.sprite, depth: +o.stuck.depth.toFixed(1) } : null,
             riders: o.riders ? o.riders.map((g) => chars.indexOf(g)) : null };
  },
  sound: () => ({ state: SND.state(), music: SND.current() }),
  // 時間を止めて、1コマずつ進める（テスト用）
  setPaused: (b) => { paused = b; byId('btnPause').textContent = paused ? '▶' : '⏸'; },
  step: (n = 1) => { for (let i = 0; i < n; i++) step(); render(); },
  _debug: { chars, objects, engine, cam, tracers, shells },
};

// スマホの「ホーム画面に追加」とオフライン用。https（か localhost）で開いたときだけ動く
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- スタート ----
// Mac や PC のアプリ画面がたて長で開いたら、横長にする（ふつうのタブでは、ブラウザが何もしない）
if (!isTouch && innerHeight > innerWidth) {
  const w = Math.min(screen.availWidth, 1280), h = Math.min(screen.availHeight, 800);
  try { resizeTo(w, h); moveTo((screen.availWidth - w) / 2, (screen.availHeight - h) / 2); } catch (e) { /* できないブラウザもある */ }
}
measure();
syncMods();
renderDrawer();
// ニュースの前は、まだ何も見ていない人（はじめて遊ぶ人）なら、最新まで見たことにする。前のバージョンから遊んでいる人は、0.8 まで見たことにする
if (!settings.newsSeen && NEWS.length) { settings.newsSeen = window.__returning ? '0.8' : NEWS[0].id; saveSettings(); }
showView('home');
updateNewsBadge();
if (!navigator.webdriver) checkNews();
requestAnimationFrame(frame);
})();
