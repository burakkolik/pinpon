// =====================================================================
//  Giriş noktası: arayüz, döngü, girdi bağlantıları
// =====================================================================
import { Renderer } from './renderer.js';
import { Game, DIFFS } from './game.js';
import * as S from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);

const els = {
  hud: $('hud'), ptsP: $('ptsP'), ptsA: $('ptsA'), setsP: $('setsP'), setsA: $('setsA'),
  srvP: $('srvP'), srvA: $('srvA'), setLbl: $('setLbl'), diffLbl: $('diffLbl'), botName: $('botName'),
  msg: $('msg'), hint: $('serveHint'), rallyBox: $('rallyBox'), rallyN: $('rallyN'), speedN: $('speedN'),
  menu: $('menu'), pause: $('pauseMenu'), end: $('endMenu'),
};

let lastScore = { p: 0, a: 0 };
let msgTimer = 0;

const ui = {
  score(s) {
    if (s.p !== lastScore.p) bump(els.ptsP);
    if (s.a !== lastScore.a) bump(els.ptsA);
    lastScore = { p: s.p, a: s.a };
    els.ptsP.textContent = s.p; els.ptsA.textContent = s.a;
    els.setsP.innerHTML = '<i></i>'.repeat(s.setsP);
    els.setsA.innerHTML = '<i></i>'.repeat(s.setsA);
    els.srvP.classList.toggle('on', s.server === 'P');
    els.srvA.classList.toggle('on', s.server === 'A');
    els.setLbl.textContent = s.bestOf > 1 ? `SET ${s.set}` : 'MAÇ';
    els.botName.firstChild.textContent = s.bot.toUpperCase();
  },
  message(t, sub, cls) {
    const m = els.msg;
    m.querySelector('.t').textContent = t;
    m.querySelector('.s').textContent = sub || '';
    m.className = '';
    void m.offsetWidth; // animasyonu yeniden başlat
    m.className = 'show ' + (cls || '') + (cls && cls.includes('big') ? ' long' : '');
    clearTimeout(msgTimer);
  },
  serveHint(on) { els.hint.classList.toggle('hidden', !on); },
  rally(n, kmh) { els.rallyN.textContent = n; els.speedN.textContent = kmh; },
  matchEnd(r) {
    els.hud.classList.add('hidden');
    els.rallyBox.classList.add('hidden');
    const t = $('endTitle');
    t.textContent = r.won ? 'KAZANDIN! 🏆' : 'KAYBETTİN';
    t.className = 'end-title ' + (r.won ? 'win' : 'lose');
    $('endScore').textContent = r.bestOf > 1 ? `Setler ${r.score.setsP} - ${r.score.setsA}` : `${r.score.p} - ${r.score.a}`;
    const st = r.stats;
    $('endStats').innerHTML = `
      <div><b>${st.maxSpeed}</b><span>En hızlı vuruş (km/sa)</span></div>
      <div><b>${st.longest}</b><span>En uzun ralli</span></div>
      <div><b>${st.smashes}</b><span>Smaç</span></div>
      <div><b>${st.aces}</b><span>As servis</span></div>`;
    els.end.classList.remove('hidden');
  },
};
function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

const game = new Game(renderer, ui);

// ------------------------------------------------------------------
//  Boyutlandırma
// ------------------------------------------------------------------
function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, w * h > 900000 ? 1.5 : 2);
  const hudH = (els.hud.querySelector('.scoreboard').offsetHeight || 54) + 14;
  renderer.resize(w, h, dpr, hudH);
}
window.addEventListener('resize', resize);
window.visualViewport && window.visualViewport.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ------------------------------------------------------------------
//  Girdi
// ------------------------------------------------------------------
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  S.initAudio();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* yok */ }
  game.pointerDown(e.clientX, e.clientY, e.pointerType);
});
canvas.addEventListener('pointermove', e => {
  e.preventDefault();
  // birleştirilmiş olaylarla daha hassas hız ölçümü
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ce of (evs.length ? evs : [e])) game.pointerMove(ce.clientX, ce.clientY, e.pointerType);
});
canvas.addEventListener('pointerup', e => { game.pointerUp(e.clientX, e.clientY); });
canvas.addEventListener('pointercancel', e => { game.pointerUp(e.clientX, e.clientY); });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') { if (!els.menu.classList.contains('hidden')) return; game.keyServe(); }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});

// ------------------------------------------------------------------
//  Menü
// ------------------------------------------------------------------
const choice = { difficulty: localStorage.getItem('pp_diff') || 'medium', mode: localStorage.getItem('pp_mode') || 'standard', firstServer: 'P' };
function segSetup(id, key) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach(b => {
    b.classList.toggle('sel', b.dataset.v === choice[key]);
    b.addEventListener('click', () => {
      S.initAudio(); S.sClick();
      choice[key] = b.dataset.v;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    });
  });
}
segSetup('modeSeg', 'mode');
segSetup('serveSeg', 'firstServer');
document.querySelectorAll('#diffCards .card').forEach(c => {
  c.classList.toggle('sel', c.dataset.diff === choice.difficulty);
  c.addEventListener('click', () => {
    S.initAudio(); S.sClick();
    choice.difficulty = c.dataset.diff;
    document.querySelectorAll('#diffCards .card').forEach(x => x.classList.toggle('sel', x === c));
  });
});

function startGame() {
  S.initAudio(); S.sClick();
  localStorage.setItem('pp_diff', choice.difficulty);
  localStorage.setItem('pp_mode', choice.mode);
  els.menu.classList.add('hidden');
  els.end.classList.add('hidden');
  els.pause.classList.add('hidden');
  els.hud.classList.remove('hidden');
  els.rallyBox.classList.remove('hidden');
  const d = DIFFS[choice.difficulty];
  els.diffLbl.textContent = d.name.toUpperCase();
  els.diffLbl.style.background = d.color;
  // mobilde tam ekran dene
  if (matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  lastScore = { p: 0, a: 0 };
  game.start({ ...choice });
  ui.rally(0, 0);
  setTimeout(resize, 350);
}
$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', toMenu);
$('quitBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', togglePause);
$('resumeBtn').addEventListener('click', togglePause);

function toMenu() {
  S.sClick();
  els.end.classList.add('hidden');
  els.pause.classList.add('hidden');
  els.hud.classList.add('hidden');
  els.rallyBox.classList.add('hidden');
  ui.serveHint(false);
  game.paused = false;
  game.idleDemo();
  els.menu.classList.remove('hidden');
}
function togglePause() {
  if (game.phase === 'idle' || game.phase === 'over') return;
  S.sClick();
  game.paused = !game.paused;
  els.pause.classList.toggle('hidden', !game.paused);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.paused && game.phase !== 'idle' && game.phase !== 'over') togglePause();
});

function syncSoundBtns() {
  const t = S.soundOn() ? '🔊 Ses: Açık' : '🔇 Ses: Kapalı';
  $('soundBtn').textContent = t; $('soundBtn2').textContent = t;
}
for (const id of ['soundBtn', 'soundBtn2']) {
  $(id).addEventListener('click', () => {
    S.initAudio();
    S.setSound(!S.soundOn());
    localStorage.setItem('pp_sound', S.soundOn() ? '1' : '0');
    syncSoundBtns(); S.sClick();
  });
}
if (localStorage.getItem('pp_sound') === '0') S.setSound(false);
syncSoundBtns();

// ------------------------------------------------------------------
//  Döngü
// ------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  renderer.render(game, game.paused ? 0 : dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// test / hata ayıklama erişimi
window.__pinpon = { game, renderer };
