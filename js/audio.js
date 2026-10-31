// =====================================================================
//  Ses: tüm efektler Web Audio API ile gerçek zamanlı sentezlenir.
// =====================================================================
let ctx = null, master = null, noiseBuf = null, crowdGain = null;
let enabled = true;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? 0.9 : 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  // beyaz gürültü tamponu
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startCrowd();
}

export function setSound(on) {
  enabled = on;
  if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
}
export function soundOn() { return enabled; }

function noise(t, dur, freq, q, gain, type = 'bandpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
}
function tone(t, dur, f0, f1, gain, type = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
const ok = () => ctx && enabled;

// Raket vuruşu: tahta + kauçuk "tok"
export function sHit(power = 0.5, pan = 0) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const p = Math.min(1, Math.max(0.1, power));
  noise(t, 0.05 + p * 0.03, 2200 + p * 1600, 1.4, 0.35 + p * 0.5);
  tone(t, 0.06, 1100 + p * 500, 600, 0.25 + p * 0.25, 'triangle');
  tone(t, 0.09, 260, 140, 0.18 * p);
}
// Masa sekmesi
export function sTable(power = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const p = Math.min(1, Math.max(0.08, power));
  tone(t, 0.07, 720 + p * 300, 420, 0.32 * p + 0.06, 'sine');
  noise(t, 0.04, 3200, 2, 0.18 * p + 0.04);
  tone(t, 0.1, 190, 120, 0.12 * p);
}
export function sFloor(power = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const p = Math.min(1, Math.max(0.05, power));
  tone(t, 0.06, 520, 300, 0.18 * p + 0.03);
  noise(t, 0.03, 2600, 2, 0.08 * p + 0.02);
}
export function sNet() {
  if (!ok()) return;
  const t = ctx.currentTime;
  noise(t, 0.16, 600, 0.8, 0.35, 'lowpass');
  tone(t, 0.12, 160, 90, 0.2);
}
export function sCord() {
  if (!ok()) return;
  const t = ctx.currentTime;
  tone(t, 0.08, 420, 260, 0.2, 'triangle');
  noise(t, 0.08, 1200, 1, 0.2);
}
export function sWhoosh(power = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25 * power + 0.03, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + 0.25);
}
export function sToss() {
  if (!ok()) return;
  const t = ctx.currentTime;
  tone(t, 0.12, 300, 600, 0.08, 'sine');
}
export function sClick() {
  if (!ok()) return;
  const t = ctx.currentTime;
  tone(t, 0.05, 900, 1300, 0.12, 'square');
}
export function sPoint(win) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const notes = win ? [523, 659, 784, 1047] : [392, 330, 262];
  notes.forEach((n, i) => {
    tone(t + i * 0.09, 0.28, n, n * 0.999, 0.16, 'triangle');
    tone(t + i * 0.09, 0.28, n * 2, n * 2, 0.04, 'sine');
  });
  cheer(win ? 1 : 0.45);
}
export function sFanfare() {
  if (!ok()) return;
  const t = ctx.currentTime;
  const seq = [523, 659, 784, 1047, 784, 1047, 1319];
  seq.forEach((n, i) => {
    tone(t + i * 0.12, 0.4, n, n, 0.15, 'sawtooth');
    tone(t + i * 0.12, 0.4, n / 2, n / 2, 0.08, 'triangle');
  });
  cheer(1.4);
}
export function sLose() {
  if (!ok()) return;
  const t = ctx.currentTime;
  [392, 370, 349, 262].forEach((n, i) => tone(t + i * 0.22, 0.4, n, n * 0.97, 0.14, 'triangle'));
}

// Seyirci: alkış = yoğun, rastgele kısa gürültü patlamaları
export function cheer(intensity = 1) {
  if (!ok()) return;
  const t0 = ctx.currentTime;
  const n = Math.floor(70 * intensity);
  for (let i = 0; i < n; i++) {
    const t = t0 + Math.random() * 1.3 * intensity + Math.random() * 0.2;
    noise(t, 0.02 + Math.random() * 0.03, 1200 + Math.random() * 2600, 1.5, 0.05 + Math.random() * 0.07);
  }
  // uğultu
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.18 * intensity, t0 + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6 * intensity + 0.3);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + 2.2);
}

function startCrowd() {
  // Sürekli, çok hafif salon ambiyansı
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.025;
  src.connect(f); f.connect(crowdGain); crowdGain.connect(master);
  src.start();
}
