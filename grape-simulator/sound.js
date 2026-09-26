// グレープシミュレーターの音（効果音と音楽）。
// 音はぜんぶプログラムでその場で作っている。録音した音や、ほかのゲームの音・曲は使っていない（曲もオリジナル）。
(() => {
'use strict';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let ac = null, sfxBus = null, musicBus = null, noise = null;
const vol = { music: 2, sfx: 1 };                     // せっていの 0〜2
const MUSIC_VOL = [0, 0.3, 0.6], SFX_VOL = [0, 0.8, 1.3];

function ensure() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ac = new AC(); } catch (e) { return null; }
  const comp = ac.createDynamicsCompressor();       // 音が重なっても割れないように
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
  comp.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.connect(comp);
  musicBus = ac.createGain(); musicBus.connect(comp);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  return ac;
}
function applyVolumes() {
  if (!ac) return;
  sfxBus.gain.value = SFX_VOL[vol.sfx] != null ? SFX_VOL[vol.sfx] : 0.8;
  musicBus.gain.value = MUSIC_VOL[vol.music] != null ? MUSIC_VOL[vol.music] : 0.6;
}
const running = () => ac && ac.state === 'running';

// ---- 音のもと ----
function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function osc(type, f0, f1, t, dur, peak, dest, attack = 0.004) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  env(g, t, attack, peak, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + attack + dur + 0.05);
}
function hiss(t, dur, peak, type, f0, f1, q, dest, attack = 0.002) {
  const s = ac.createBufferSource();
  s.buffer = noise; s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type; f.Q.value = q || 1;
  f.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  const g = ac.createGain();
  env(g, t, attack, peak, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + attack + dur + 0.05);
}

// ---- 効果音 ----  v は大きさ（0〜1くらい）、p は音の高さ（1がふつう）
const SFX = {
  thud(t, v, p) { hiss(t, 0.1, 0.35 * v, 'lowpass', 500 * p, 150, 0.7, sfxBus); osc('sine', 90 * p, 45, t, 0.12, 0.3 * v, sfxBus); },
  hit(t, v, p) { hiss(t, 0.12, 0.5 * v, 'lowpass', 900 * p, 200, 0.7, sfxBus); osc('sine', 140 * p, 55, t, 0.14, 0.45 * v, sfxBus); },
  squish(t, v, p) { hiss(t, 0.16, 0.45 * v, 'bandpass', 1400 * p, 350, 2.5, sfxBus); osc('sine', 300 * p, 120, t, 0.08, 0.18 * v, sfxBus); },
  stab(t, v, p) { hiss(t, 0.07, 0.35 * v, 'highpass', 3000, 1500, 0.8, sfxBus); SFX.squish(t + 0.02, v * 0.8, p); },
  crack(t, v) {
    for (let i = 0; i < 3; i++) hiss(t + i * 0.018, 0.02, 0.5 * v, 'highpass', 1800 + i * 600, 1500, 1, sfxBus, 0.001);
    osc('square', 180, 90, t, 0.05, 0.12 * v, sfxBus);
  },
  rip(t, v) { hiss(t, 0.3, 0.5 * v, 'bandpass', 700, 2200, 1.5, sfxBus); SFX.crack(t + 0.05, v); SFX.squish(t + 0.1, v, 0.8); },
  metal(t, v, p) {
    [520, 1310, 2150].forEach((f, i) => osc('sine', f * p, f * p * 0.98, t, 0.35 - i * 0.08, (0.16 - i * 0.04) * v, sfxBus, 0.001));
    hiss(t, 0.03, 0.3 * v, 'highpass', 4000, 3000, 1, sfxBus, 0.001);
  },
  wood(t, v, p) { osc('triangle', 320 * p, 240 * p, t, 0.08, 0.35 * v, sfxBus, 0.001); hiss(t, 0.06, 0.25 * v, 'bandpass', 900 * p, 700, 3, sfxBus, 0.001); },
  boing(t, v, p) { osc('sine', 180 * p, 420 * p, t, 0.18, 0.35 * v, sfxBus); },
  bang(t, v) {
    hiss(t, 0.22, 0.9 * v, 'lowpass', 5000, 600, 0.7, sfxBus, 0.001);
    osc('sine', 160, 40, t, 0.18, 0.7 * v, sfxBus, 0.001);
    hiss(t, 0.03, 0.6 * v, 'highpass', 6000, 5000, 1, sfxBus, 0.001);
  },
  mg(t, v) { hiss(t, 0.1, 0.7 * v, 'lowpass', 4500, 700, 0.7, sfxBus, 0.001); osc('sine', 140, 50, t, 0.08, 0.5 * v, sfxBus, 0.001); },
  boom(t, v) {
    hiss(t, 1.4, 1.0 * v, 'lowpass', 1800, 90, 0.8, sfxBus, 0.003);
    osc('sine', 70, 28, t, 1.1, 0.9 * v, sfxBus, 0.005);
    hiss(t, 0.08, 0.8 * v, 'highpass', 3000, 2000, 1, sfxBus, 0.001);
  },
  fuse(t, v) { hiss(t, 0.09, 0.12 * v, 'highpass', 5000, 7000, 1, sfxBus); },
  splash(t, v) { hiss(t, 0.35, 0.45 * v, 'bandpass', 1100, 500, 1.2, sfxBus, 0.01); hiss(t + 0.05, 0.25, 0.2 * v, 'highpass', 3000, 2000, 1, sfxBus, 0.01); },
  pop(t, v) { osc('sine', 380, 900, t, 0.09, 0.3 * v, sfxBus); },
  ui(t, v) { osc('square', 700, 700, t, 0.04, 0.12 * v, sfxBus, 0.002); },
  click(t, v) { osc('square', 1200, 900, t, 0.02, 0.1 * v, sfxBus, 0.001); },
  engineStart(t, v) { hiss(t, 0.4, 0.3 * v, 'lowpass', 200, 900, 2, sfxBus, 0.02); osc('sawtooth', 50, 110, t, 0.4, 0.12 * v, sfxBus, 0.02); },
  death(t, v, p) { [660, 520, 390, 260].forEach((f, i) => osc('square', f * p, f * p, t + i * 0.09, 0.08, 0.1 * v, sfxBus, 0.003)); },
  heal(t, v) { [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, t + i * 0.07, 0.12, 0.2 * v, sfxBus, 0.003)); },
  spark(t, v) { hiss(t, 0.05, 0.2 * v, 'highpass', 6000, 8000, 1, sfxBus, 0.001); },
  ric(t, v) { osc('sine', 2400, 1200, t, 0.12, 0.08 * v, sfxBus, 0.001); hiss(t, 0.03, 0.15 * v, 'highpass', 5000, 4000, 1, sfxBus); },
  sizzle(t, v) { hiss(t, 0.35, 0.25 * v, 'highpass', 3000, 6000, 0.7, sfxBus, 0.01); hiss(t, 0.2, 0.15 * v, 'bandpass', 1200, 800, 2, sfxBus, 0.005); },
  coin(t, v) { osc('square', 988, 988, t, 0.06, 0.12 * v, sfxBus, 0.002); osc('square', 1319, 1319, t + 0.07, 0.18, 0.12 * v, sfxBus, 0.002); },
  quest(t, v) { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => osc('square', f, f, t + i * 0.08, 0.1, 0.1 * v, sfxBus, 0.003)); },
  buy(t, v) { [784, 988, 1175, 1568].forEach((f, i) => osc('triangle', f, f, t + i * 0.06, 0.1, 0.18 * v, sfxBus, 0.003)); },
  saw(t, v, p) { osc('sawtooth', 95 * p, 110 * p, t, 0.09, 0.14 * v, sfxBus, 0.005); hiss(t, 0.08, 0.18 * v, 'bandpass', 2200, 2600, 3, sfxBus, 0.005); },
  rocket(t, v) { hiss(t, 0.5, 0.5 * v, 'bandpass', 800, 3000, 1.2, sfxBus, 0.01); osc('sawtooth', 120, 60, t, 0.3, 0.12 * v, sfxBus, 0.01); },
  groan(t, v) { osc('sawtooth', 150, 85, t, 0.7, 0.13 * v, sfxBus, 0.08); hiss(t, 0.6, 0.12 * v, 'bandpass', 500, 300, 2, sfxBus, 0.08); },
  pin(t, v) { osc('square', 2200, 1800, t, 0.03, 0.1 * v, sfxBus, 0.001); osc('triangle', 900, 700, t + 0.04, 0.06, 0.12 * v, sfxBus, 0.002); },
};
const lastPlayed = {};
function play(name, v = 1, p = 1) {
  if (!running() || !vol.sfx) return;
  const fn = SFX[name];
  if (!fn) return;
  const t = ac.currentTime;
  if (lastPlayed[name] != null && t - lastPlayed[name] < 0.035) return;   // 同じ音が一度に鳴りすぎないように
  lastPlayed[name] = t;
  fn(t + 0.005, clamp(v, 0, 1.5), p);
}

// ---- 車のエンジンの音（鳴らしっぱなしで、大きさと高さを変える） ----
let eng = null;
function engine(level) {
  if (!running()) return;
  if (!eng) {
    if (level <= 0) return;
    const o = ac.createOscillator(), o2 = ac.createOscillator();
    o.type = 'sawtooth'; o2.type = 'square';
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 3;
    const g = ac.createGain();
    g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
    o.start(); o2.start();
    eng = { o, o2, g };
  }
  const t = ac.currentTime, lv = clamp(level, 0, 1);
  eng.g.gain.setTargetAtTime(lv > 0 ? 0.05 + 0.06 * lv : 0, t, 0.08);
  eng.o.frequency.setTargetAtTime(45 + 60 * lv, t, 0.1);
  eng.o2.frequency.setTargetAtTime((45 + 60 * lv) * 0.5, t, 0.1);
}

// ---- 音楽 ----
// 曲はオリジナル（タイトル、ゲーム中、火山、うちゅうの4曲）。1文字ずつではなく、スペースで区切った「コマ」ごとに音を書く（1コマは8分音符）。
// 音の名前（C4 など）＝その音を鳴らす、「-」＝前の音をのばす、「.」＝休み。ドラムは k バスドラ、s スネア、h ハイハット。
const TRACKS = {
  title: {
    bpm: 128, lead: 'square', leadVol: 0.07, harm: 'square', harmVol: 0.028,
    lead_: 'E5 - G5 E5 C5 - D5 E5  F5 - E5 D5 C5 - . .  E5 - G5 E5 C5 - D5 E5  D5 - - - . . G4 .' +
           ' E5 - G5 E5 C5 - D5 E5  F5 - A5 G5 F5 E5 D5 C5  D5 - E5 D5 B4 - G4 -  C5 - - - . . . .',
    harm_: '. E4 . G4 . E4 . G4  . F4 . A4 . F4 . A4  . E4 . G4 . E4 . G4  . D4 . G4 . D4 . B3' +
           ' . E4 . G4 . E4 . G4  . F4 . A4 . F4 . A4  . D4 . G4 . D4 . G4  . E4 . G4 . C4 . .',
    bass_: 'C3 . C3 . G2 . C3 .  F2 . F2 . C3 . F2 .  C3 . C3 . G2 . C3 .  G2 . G2 . D3 . G2 .' +
           ' C3 . C3 . G2 . C3 .  F2 . F2 . C3 . F2 .  G2 . G2 . D3 . G2 .  C3 . G2 . C3 . . .',
    drum_: 'k . h . s . h .  k . h k s . h .  k . h . s . h .  k . h k s . h h' +
           ' k . h . s . h .  k . h k s . h .  k . h . s . h .  k . s . s s s .',
  },
  play: {
    bpm: 104, lead: 'square', leadVol: 0.055, harm: 'square', harmVol: 0.024,
    lead_: 'A4 - C5 - E5 - D5 C5  . . A4 - G4 - E4 -  F4 - A4 - C5 - B4 A4  G4 - - - . . . .' +
           ' A4 - C5 - E5 - G5 E5  F5 - E5 - D5 - C5 -  D5 - C5 - B4 - G4 -  A4 - - - . . . .',
    harm_: '. C4 . E4 . C4 . E4  . A3 . C4 . A3 . C4  . E4 . G4 . E4 . G4  . D4 . G4 . B3 . D4' +
           ' . C4 . E4 . C4 . E4  . A3 . C4 . A3 . C4  . E4 . G4 . E4 . G4  . D4 . G4 . B3 . D4',
    bass_: 'A2 . A2 . E3 . A2 .  F2 . F2 . C3 . F2 .  C3 . C3 . G2 . C3 .  G2 . G2 . D3 . G2 .' +
           ' A2 . A2 . E3 . A2 .  F2 . F2 . C3 . F2 .  C3 . C3 . G2 . C3 .  G2 . G2 . D3 . G2 .',
    drum_: 'k . h . s . h h  k . h . s . h .  k . h . s . h h  k . h . s . h .' +
           ' k . h . s . h h  k . h . s . h .  k . h . s . h h  k . h k s . s .',
  },
  volcano: {
    bpm: 132, lead: 'square', leadVol: 0.05, harm: 'square', harmVol: 0.02,
    lead_: 'E5 - G5 - F#5 E5 D5 -  E5 - - - B4 - . .  C5 - D5 - E5 - G5 -  F#5 - - - . . . .' +
           ' E5 - G5 - B5 - A5 G5  F#5 - E5 - D5 - B4 -  C5 - B4 - A4 - G4 A4  B4 - - - . . . .',
    harm_: 'E4 G4 B4 G4 E4 G4 B4 G4  E4 G4 B4 G4 E4 G4 B4 G4  C4 E4 G4 E4 C4 E4 G4 E4  D4 F#4 A4 F#4 D4 F#4 A4 F#4' +
           ' E4 G4 B4 G4 E4 G4 B4 G4  D4 F#4 B4 F#4 D4 F#4 B4 F#4  C4 E4 A4 E4 C4 E4 G4 E4  D#4 F#4 B4 F#4 D#4 F#4 B4 F#4',
    bass_: 'E2 E2 E3 E2 E2 E2 E3 E2  E2 E2 E3 E2 E2 E2 E3 E2  C2 C2 C3 C2 C2 C2 C3 C2  D2 D2 D3 D2 D2 D2 D3 D2' +
           ' E2 E2 E3 E2 E2 E2 E3 E2  B1 B1 B2 B1 B1 B1 B2 B1  A1 A1 A2 A1 C2 C2 C3 C2  B1 B1 B2 B1 B1 B2 B1 B2',
    drum_: 'k h s h k k s h  k h s h k k s h  k h s h k k s h  k h s h k k s h' +
           ' k h s h k k s h  k h s h k k s h  k h s h k k s h  k s s s s s s s',
  },
  space: {
    bpm: 80, lead: 'triangle', leadVol: 0.08, harm: 'triangle', harmVol: 0.045,
    lead_: '. . . . F#5 - - -  E5 - - - . . . .  . . . . D5 - - -  C#5 - - - . . . .' +
           ' . . . . A5 - - -  F#5 - - - . . . .  . . . . E5 - D5 -  C#5 - - - - - - -',
    harm_: 'D4 F#4 A4 C#5 A4 F#4 D4 F#4  B3 D4 F#4 A4 F#4 D4 B3 D4  G3 B3 D4 F#4 D4 B3 G3 B3  A3 C#4 E4 G4 E4 C#4 A3 C#4' +
           ' D4 F#4 A4 C#5 A4 F#4 D4 F#4  B3 D4 F#4 A4 F#4 D4 B3 D4  G3 B3 D4 F#4 D4 B3 G3 B3  A3 C#4 E4 G4 E4 C#4 A3 C#4',
    bass_: 'D2 - - - - - - -  B1 - - - - - - -  G1 - - - - - - -  A1 - - - - - - -' +
           ' D2 - - - - - - -  B1 - - - - - - -  G1 - - - - - - -  A1 - - - - - - -',
    drum_: '. . . . h . . .  . . . . h . . h  . . . . h . . .  . . . . h . . h' +
           ' . . . . h . . .  . . . . h . . h  . . . . h . . .  . . . . h . h h',
  },
};
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freqOf(tok) {
  const m = /^([A-G]#?)(\d)$/.exec(tok);
  if (!m) return 0;
  const n = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}
for (const tr of Object.values(TRACKS)) {
  for (const ch of ['lead', 'harm', 'bass', 'drum']) tr[ch + 'T'] = tr[ch + '_'].trim().split(/\s+/);
  tr.len = tr.leadT.length;
}
// そのコマから何コマのびるか（「-」の数 + 1）
function holdOf(list, i) {
  let n = 1;
  while (list[(i + n) % list.length] === '-' && n < list.length) n++;
  return n;
}
function note(type, tok, t, len, peak, dest) {
  const f = freqOf(tok);
  if (!f) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.setValueAtTime(peak * 0.7, t + Math.max(0.02, len - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + len + 0.02);
}
function drum(k, t, dest) {
  if (k === 'k') osc('sine', 150, 42, t, 0.12, 0.45, dest, 0.002);
  else if (k === 's') { hiss(t, 0.12, 0.2, 'highpass', 1500, 1200, 0.8, dest); osc('triangle', 200, 150, t, 0.06, 0.1, dest); }
  else if (k === 'h') hiss(t, 0.03, 0.07, 'highpass', 7000, 7000, 1, dest, 0.001);
}
let cur = null, timer = null;
function playStep(tr, i, t, d, bus) {
  const L = tr.leadT[i], Hm = tr.harmT[i], B = tr.bassT[i], D = tr.drumT[i];
  if (L !== '-' && L !== '.') note(tr.lead, L, t, d * holdOf(tr.leadT, i) * 0.95, tr.leadVol, bus);
  if (Hm !== '-' && Hm !== '.') note(tr.harm, Hm, t, d * holdOf(tr.harmT, i) * 0.9, tr.harmVol, bus);
  if (B !== '-' && B !== '.') note('triangle', B, t, d * holdOf(tr.bassT, i) * 0.9, 0.13, bus);
  if (D !== '-' && D !== '.') drum(D, t, bus);
}
function tick() {
  timer = null;
  if (!cur || !running()) return;
  const tr = cur.tr, d = 60 / tr.bpm / 2;
  if (cur.next < ac.currentTime) cur.next = ac.currentTime + 0.05;
  while (cur.next < ac.currentTime + 0.25) {
    playStep(tr, cur.step, cur.next, d, cur.bus);
    cur.step = (cur.step + 1) % tr.len;
    cur.next += d;
  }
  timer = setTimeout(tick, 60);
}
function startSched() {
  if (!cur || timer || !running()) return;
  if (!cur.bus) { cur.bus = ac.createGain(); cur.bus.connect(musicBus); }
  cur.next = ac.currentTime + 0.08;
  tick();
}
function stopMusic() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (cur && cur.bus && ac) {
    const b = cur.bus;
    b.gain.setTargetAtTime(0.0001, ac.currentTime, 0.05);
    setTimeout(() => b.disconnect(), 500);
  }
  cur = null;
}
function music(name) {
  if (cur && cur.name === name) return;
  stopMusic();
  if (!TRACKS[name]) return;
  cur = { name, tr: TRACKS[name], step: 0, next: 0, bus: null };
  startSched();
}

window.GrapeSound = {
  // 最初にさわったとき（クリック・タップ）に呼ぶ。ブラウザは、さわるまで音を出させてくれない
  unlock() {
    const a = ensure();
    if (!a) return;
    if (a.state !== 'running') a.resume().then(startSched, () => {});
    else startSched();
  },
  play, engine, music,
  setVolumes(m, s) { vol.music = m; vol.sfx = s; applyVolumes(); },
  state: () => (ac ? ac.state : 'none'),
  current: () => (cur ? cur.name : null),
};
})();
