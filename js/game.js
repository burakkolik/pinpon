// =====================================================================
//  Oyun mantığı: kurallar, sayı, servis, oyuncu kontrolü, yapay zeka, efektler
// =====================================================================
import * as P from './physics.js';
import * as S from './audio.js';

const { TABLE, HL, HW, BALL_R } = P;
const TY = TABLE.H;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const other = s => (s === 'P' ? 'A' : 'P');

// Zorluk ayarları
export const DIFFS = {
  easy: {
    name: 'Basit', bot: 'Robo-Çaylak', color: '#3dff8f', timeScale: 0.8,
    speed: [3.6, 5.0], top: [0, 45], side: 15, xr: 0.42, zr: [0.55, 1.05],
    err: 0.11, mistake: 0.1, reach: 0.19, maxV: 2.3, react: 0.28, predErr: 0.06,
    smash: 0.0, early: 1.0, spinRead: 0.3, marker: true,
  },
  medium: {
    name: 'Orta', bot: 'Robo-Usta', color: '#ffc53d', timeScale: 0.9,
    speed: [4.8, 7.6], top: [25, 120], side: 40, xr: 0.58, zr: [0.6, 1.18],
    err: 0.065, mistake: 0.05, reach: 0.2, maxV: 3.0, react: 0.2, predErr: 0.045,
    smash: 0.45, early: 0.85, spinRead: 0.65, marker: true,
  },
  hard: {
    name: 'Zor', bot: 'Robo-Şampiyon', color: '#ff3d5a', timeScale: 1.0,
    speed: [6.4, 10.5], top: [60, 210], side: 70, xr: 0.66, zr: [0.75, 1.26],
    err: 0.032, mistake: 0.02, reach: 0.235, maxV: 4.4, react: 0.1, predErr: 0.018,
    smash: 0.9, early: 0.65, spinRead: 0.92, marker: false,
  },
};

const PLAYER_REACH = 0.21;

export class Game {
  constructor(renderer, ui) {
    this.r = renderer;
    this.ui = ui;
    this.ball = P.makeBall();
    this.ballVisible = false;
    this.trail = [];
    this.spinVis = { axisAngle: 0, phase: 0 };
    this.pp = { x: 0, y: TY + 0.12, z: 1.85, side: 1, pitch: 0.2, roll: 0, tx: 0, tz: 1.85 };
    this.ap = { x: 0, y: TY + 0.12, z: -1.85, side: -1, pitch: 0.2, roll: 0, tx: 0, tz: -1.85 };
    this.robot = { x: 0, y: TY + 0.85, z: -2.5, mood: 'idle', moodT: 0, color: '#3dff8f' };
    this.fx = { particles: [], rings: [], popups: [], marks: [] };
    this.netWave = { a: 0, x: 0, t: 0, dir: 1 };
    this.marker = { x: 0, z: 0, a: 0, on: false };
    this.shake = 0;
    this.flash = { a: 0, color: 'rgba(255,255,255,A)' };
    this.slowmo = 1; this.slowmoT = 0;
    this.crowdExcite = 0;
    this.phase = 'idle';
    this.paused = false;
    this.acc = 0;
    this.samples = [];
    this.pvel = { x: 0, z: 0 };
    this.swing = 0; this.aswing = 0;
    this.traj = [];
    this.cfg = DIFFS.medium;
    this.pointer = { down: false, sx: 0, sy: 0, t: 0, type: 'mouse' };
    this.time = 0;
    this.idleDemo();
  }

  // Menüde arka planda dönen gösteri
  idleDemo() {
    this.phase = 'idle';
    this.ballVisible = true;
    Object.assign(this.ball, { x: 0, y: TY + 0.4, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
    this.demoT = 0;
  }

  // ------------------------------------------------------------------
  //  Maç başlat
  // ------------------------------------------------------------------
  start(opts) {
    this.cfg = DIFFS[opts.difficulty] || DIFFS.medium;
    this.diffKey = opts.difficulty;
    this.robot.color = this.cfg.color;
    this.pointsToWin = opts.mode === 'quick' ? 5 : 11;
    this.bestOf = opts.mode === 'bo3' ? 3 : 1;
    let first = opts.firstServer;
    if (first === 'coin') first = Math.random() < 0.5 ? 'P' : 'A';
    this.score = { p: 0, a: 0, setsP: 0, setsA: 0, set: 1 };
    this.setFirstServer = first;
    this.stats = { hits: 0, maxSpeed: 0, longest: 0, aces: 0, smashes: 0, points: 0 };
    this.fx.particles.length = 0; this.fx.popups.length = 0;
    this.paused = false;
    this.ui.score(this.scoreView());
    this.ui.message(first === 'P' ? 'İlk servis sende!' : `İlk servis ${this.cfg.bot}'da`, 'Hazır ol', 'info');
    this.newPoint(1.4);
  }

  scoreView() {
    return {
      p: this.score.p, a: this.score.a, setsP: this.score.setsP, setsA: this.score.setsA,
      set: this.score.set, bestOf: this.bestOf, server: this.currentServer(), bot: this.cfg.bot, diff: this.cfg.name,
    };
  }

  currentServer() {
    const total = this.score.p + this.score.a;
    const deuceAt = (this.pointsToWin - 1) * 2;
    let block;
    if (total < deuceAt) block = Math.floor(total / (this.pointsToWin === 5 ? 1 : 2));
    else block = Math.floor(deuceAt / (this.pointsToWin === 5 ? 1 : 2)) + (total - deuceAt);
    return block % 2 === 0 ? this.setFirstServer : other(this.setFirstServer);
  }

  newPoint(delay = 0) {
    this.phase = 'wait';
    this.waitT = delay;
    this.server = this.currentServer();
    this.trail.length = 0;
    this.marker.on = false;
  }

  beginServe() {
    this.phase = 'serve';
    this.ballVisible = true;
    this.rally = { lastHitter: null, isServe: true, server: this.server, serveOwn: false, netTouch: false, recvBounces: 0, hits: 0, lastNet: false };
    const b = this.ball;
    b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    this.robot.mood = 'focus';
    if (this.server === 'P') {
      this.ui.serveHint(true);
      this.aiTarget(0, -1.9);
    } else {
      this.ui.serveHint(false);
      this.aiServeT = rand(0.8, 1.4);
      this.ap.tx = rand(-0.4, 0.4); this.ap.tz = -1.75;
      this.aiServePlan = this.pickAiServe();
    }
    this.ui.score(this.scoreView());
  }

  // ------------------------------------------------------------------
  //  Girdi
  // ------------------------------------------------------------------
  pointerDown(sx, sy, type) {
    this.pointer.down = true;
    this.pointer.sx = sx; this.pointer.sy = sy; this.pointer.t = performance.now(); this.pointer.type = type;
    this.pointer.moved = 0;
    this.pointerMove(sx, sy, type);
  }
  pointerMove(sx, sy, type) {
    const off = type === 'touch' ? Math.min(70, this.r.h * 0.08) : 0;
    const w = this.r.screenToPlane(sx, sy - off, TY + 0.1);
    const x = clamp(w.x, -1.55, 1.55), z = clamp(w.z, 0.45, 2.75);
    this.pp.tx = x; this.pp.tz = z;
    const now = performance.now();
    this.samples.push({ t: now, x, z });
    while (this.samples.length > 2 && now - this.samples[0].t > 160) this.samples.shift();
    if (this.pointer.down) this.pointer.moved = Math.max(this.pointer.moved, Math.hypot(sx - this.pointer.sx, sy - this.pointer.sy));
  }
  pointerUp(sx, sy) {
    const p = this.pointer;
    if (!p.down) return;
    p.down = false;
    const dur = performance.now() - p.t;
    if (this.phase === 'serve' && this.server === 'P' && !this.paused) {
      const v = this.swipeVel();
      const tap = dur < 350 && p.moved < 14;
      const flickFwd = -v.z, lat = v.x;
      if (tap || flickFwd > 1.2 || flickFwd < -1.2 || Math.abs(lat) > 1.5) {
        this.playerToss({ fwd: tap ? 0 : flickFwd, lat: tap ? 0 : lat });
      }
    }
  }
  keyServe() {
    if (this.phase === 'serve' && this.server === 'P' && !this.paused) this.playerToss({ fwd: 0, lat: 0 });
  }
  // Parmağın/farenin son ~100 ms'deki dünya hızı (m/s)
  swipeVel() {
    const now = performance.now();
    const s = this.samples.filter(q => now - q.t < 110);
    if (s.length < 2) return { x: 0, z: 0 };
    const a = s[0], b = s[s.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    if (now - b.t > 60) return { x: 0, z: 0 };
    return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
  }

  // ------------------------------------------------------------------
  //  Ana güncelleme
  // ------------------------------------------------------------------
  update(dtReal) {
    dtReal = Math.min(dtReal, 0.05);
    this.time += dtReal;
    if (this.paused) return;
    // ağır çekim
    if (this.slowmoT > 0) { this.slowmoT -= dtReal; this.slowmo = lerp(this.slowmo, 0.3, 0.2); }
    else this.slowmo = lerp(this.slowmo, 1, 0.08);
    const ts = (this.phase === 'idle' ? 0.85 : this.cfg.timeScale) * this.slowmo;
    const dt = dtReal * ts;

    this.updatePaddles(dtReal, dt);
    if (this.phase === 'idle') this.updateDemo(dt);
    if (this.phase === 'wait') {
      this.waitT -= dtReal;
      this.ballVisible = false;
      if (this.waitT <= 0) this.beginServe();
    }
    if (this.phase === 'serve') this.updateServeHold(dt);

    // sabit adımlı fizik
    if (this.ballVisible && this.phase !== 'serve' && this.phase !== 'wait') {
      this.acc += dt;
      const n = Math.min(40, Math.floor(this.acc / P.SIM_DT));
      this.acc -= n * P.SIM_DT;
      const pz0 = this.ppPrevZ ?? this.pp.z, pz1 = this.pp.z;
      const az0 = this.apPrevZ ?? this.ap.z, az1 = this.ap.z;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        this.substep(lerp(pz0, pz1, (i) / n), lerp(pz0, pz1, k), lerp(az0, az1, i / n), lerp(az0, az1, k));
      }
    }
    this.ppPrevZ = this.pp.z; this.apPrevZ = this.ap.z;

    // iz
    if (this.ballVisible) {
      this.trail.push({ x: this.ball.x, y: this.ball.y, z: this.ball.z });
      if (this.trail.length > 16) this.trail.shift();
    } else this.trail.length = 0;
    // spin görselleştirme
    this.updateSpinVis(dt);
    this.updateFx(dtReal, dt);
  }

  substep(pz0, pz1, az0, az1) {
    const b = this.ball;
    const prevZ = b.z;
    const ev = P.stepBall(b, P.SIM_DT);
    if (ev) this.onEvent(ev);
    if (this.phase === 'toss') {
      if (b.vy < 0 && b.y <= TY + 0.27) this.strikeServe();
      return;
    }
    if (this.phase !== 'rally' && this.phase !== 'point') return;
    const R = this.rally;
    // Oyuncu vuruşu
    if (this.phase === 'rally' && R.lastHitter === 'A' && R.recvBounces === 1 && !R.pTried) {
      const crossed = prevZ - pz0 < 0 && b.z - pz1 >= 0 && b.vz > 0;
      // affedici yakınlık kontrolü (dokunmatik ekranda kaçan temasları yakalar)
      const near = b.vz > 0 && Math.abs(b.z - pz1) < 0.05 && Math.abs(b.x - this.pp.x) < PLAYER_REACH * 0.8 && Math.abs(b.y - this.pp.y) < 0.25;
      if (crossed || near) {
        R.pTried = true;
        const dx = b.x - this.pp.x;
        if (Math.abs(dx) < PLAYER_REACH && b.y > TY - 0.28 && b.y < TY + 1.0) this.playerHit(dx);
        else { this.whiff(this.pp); }
      }
    }
    // Yapay zeka vuruşu
    if (this.phase === 'rally' && R.lastHitter === 'P' && R.recvBounces === 1 && !R.aTried) {
      if (prevZ - az0 > 0 && b.z - az1 <= 0 && b.vz < 0) {
        R.aTried = true;
        const dx = b.x - this.ap.x;
        if (Math.abs(dx) < this.cfg.reach && b.y > TY - 0.25 && b.y < TY + 1.0) this.aiHit();
        else this.whiff(this.ap);
      }
    }
    // saha dışı
    if (this.phase === 'rally' && (Math.abs(b.x) > 5 || Math.abs(b.z) > 5.5)) this.onOut();
    // durmuş top
    if (this.phase === 'rally') {
      if (P.speedOf(b) < 0.25) { this.stillT = (this.stillT || 0) + P.SIM_DT; if (this.stillT > 0.8) this.onOut(); }
      else this.stillT = 0;
    }
  }

  // ------------------------------------------------------------------
  //  Olaylar ve kurallar
  // ------------------------------------------------------------------
  onEvent(ev) {
    const b = this.ball;
    const vimp = Math.abs(b.vy) + 0.2 * Math.hypot(b.vx, b.vz);
    if (ev === P.EV_TABLE) {
      S.sTable(clamp(vimp / 5, 0.1, 1));
      this.bounceFx(b.x, b.z, vimp);
      if (this.phase === 'rally') this.ruleTable(b.z > 0 ? 'P' : 'A');
      if (b.z > 0 && this.marker.on) this.marker.on = false;
    } else if (ev === P.EV_NET || ev === P.EV_CORD) {
      if (ev === P.EV_NET) S.sNet(); else S.sCord();
      this.netWave.a = ev === P.EV_NET ? 0.035 : 0.015; this.netWave.x = b.x; this.netWave.t = 0;
      this.netWave.dir = b.vz > 0 ? -1 : 1;
      this.burst(b.x, b.y, b.z, 10, ['#ffffff', '#9fd0ff'], 1.2, 0.006);
      if (this.phase === 'rally') {
        this.rally.lastNet = true;
        if (this.rally.isServe) this.rally.netTouch = true;
        if (ev === P.EV_CORD) this.popup('FİLE!', b.x, b.y + 0.12, b.z, '#9fd0ff', 22);
      }
    } else if (ev === P.EV_FLOOR) {
      S.sFloor(clamp(vimp / 5, 0.05, 1));
      if (this.phase === 'rally') this.onOut();
    } else if (ev === P.EV_EDGE) {
      S.sCord();
      if (this.phase === 'rally') this.onOut();
    }
  }

  ruleTable(side) {
    const R = this.rally;
    if (R.isServe) {
      if (!R.serveOwn) {
        if (side === R.server) R.serveOwn = true;
        else this.pointTo(other(R.server), 'SERVİS HATASI', 'Top önce kendi alanına sekmeli');
      } else if (side !== R.server) {
        R.isServe = false;
        if (R.netTouch) { this.letServe(); return; }
        R.recvBounces = 1;
      } else this.pointTo(other(R.server), 'SERVİS HATASI', 'Top fileyi geçemedi');
      return;
    }
    const recv = other(R.lastHitter);
    if (side === R.lastHitter) {
      if (R.recvBounces === 0) this.pointTo(recv, R.lastNet ? 'FİLE!' : 'HATA', R.lastNet ? 'Top fileye takıldı' : 'Top kendi alanına düştü');
      else this.pointTo(R.lastHitter, 'GERİ DÖNDÜ', 'Spin topu geri getirdi!');
    } else {
      R.recvBounces++;
      if (R.recvBounces >= 2) this.pointTo(R.lastHitter, 'ÇİFT SEKME', recv === 'P' ? 'Topa yetişemedin' : 'Robot yetişemedi');
    }
  }

  onOut() {
    if (this.phase !== 'rally') return;
    const R = this.rally;
    if (!R.lastHitter && !R.isServe) return;
    if (R.isServe) {
      this.pointTo(other(R.server), R.netTouch ? 'FİLE!' : 'SERVİS HATASI', R.netTouch ? 'Servis fileye takıldı' : 'Servis masaya düşmedi');
      return;
    }
    const recv = other(R.lastHitter);
    if (R.recvBounces >= 1) this.pointTo(R.lastHitter, recv === 'P' ? 'KAÇIRDIN!' : 'SAYI!', recv === 'P' ? 'Topu karşılayamadın' : 'Robot karşılayamadı');
    else this.pointTo(recv, R.lastNet ? 'FİLE!' : 'AUT!', R.lastNet ? 'Top fileyi geçemedi' : 'Top masanın dışına çıktı');
  }

  letServe() {
    this.phase = 'point';
    this.pointT = 1.4;
    this.pointWinner = null;
    this.ui.message('LET', 'Servis fileye değdi – tekrar', 'info');
    this.marker.on = false;
  }

  pointTo(winner, title, sub) {
    if (this.phase !== 'rally') return;
    this.phase = 'point';
    this.pointT = 1.9;
    this.pointWinner = winner;
    this.marker.on = false;
    const R = this.rally;
    this.stats.longest = Math.max(this.stats.longest, R.hits);
    this.stats.points++;
    if (winner === 'P') {
      this.score.p++;
      if (R.server === 'P' && R.hits <= 1) { this.stats.aces++; title = 'AS!'; sub = 'Karşılıksız servis'; }
    } else this.score.a++;
    const won = winner === 'P';
    S.sPoint(won);
    this.crowdExcite = won ? 1 : 0.5;
    this.robot.mood = won ? 'sad' : 'happy';
    if (won) {
      this.flash = { a: 0.25, color: 'rgba(120,255,190,A)' };
      this.confetti(60);
    } else {
      this.flash = { a: 0.3, color: 'rgba(255,40,70,A)' };
    }
    if (P.speedOf(this.ball) > 11 && R.hits > 0) this.slowmoT = 0.7;
    // set / maç kontrolü
    const s = this.score, ptw = this.pointsToWin;
    let setOver = null;
    if ((s.p >= ptw || s.a >= ptw) && Math.abs(s.p - s.a) >= 2) setOver = s.p > s.a ? 'P' : 'A';
    const rallyTxt = R.hits >= 4 ? ` · ${R.hits} vuruşluk ralli` : '';
    if (setOver) {
      if (setOver === 'P') s.setsP++; else s.setsA++;
      const need = Math.ceil(this.bestOf / 2);
      if (s.setsP >= need || s.setsA >= need) {
        this.matchOver = setOver;
        this.pointT = 2.6;
        this.ui.message(setOver === 'P' ? 'MAÇ SENİN!' : 'MAÇ BİTTİ', setOver === 'P' ? 'Muhteşem oyun!' : `${this.cfg.bot} kazandı`, setOver === 'P' ? 'win big' : 'lose big');
        if (setOver === 'P') { S.sFanfare(); this.fireworks(); } else S.sLose();
      } else {
        this.setEnded = setOver;
        this.pointT = 2.6;
        this.ui.message(`SET ${s.set} ${setOver === 'P' ? 'SENİN' : 'ROBOTUN'}`, `Setler ${s.setsP} - ${s.setsA}`, setOver === 'P' ? 'win' : 'lose');
      }
    } else {
      const s2 = this.score;
      let extra = '';
      if (s2.p === ptw - 1 && s2.p > s2.a) extra = ' · Set sayısı!';
      else if (s2.a === ptw - 1 && s2.a > s2.p) extra = ' · Robotun set sayısı';
      if (s2.p >= ptw - 1 && s2.a >= ptw - 1 && s2.p === s2.a) extra = ' · Düs!';
      this.ui.message(title, sub + rallyTxt + extra, won ? 'win' : 'lose');
    }
    this.ui.score(this.scoreView());
  }

  // ------------------------------------------------------------------
  //  Servis
  // ------------------------------------------------------------------
  updateServeHold(dt) {
    const b = this.ball;
    if (this.server === 'P') {
      b.x = clamp(this.pp.x + 0.13, -HW + 0.05, HW - 0.05);
      b.y = TY + 0.13 + Math.sin(this.time * 3) * 0.008;
      b.z = Math.max(this.pp.z - 0.04, HL + 0.14);
    } else {
      b.x = clamp(this.ap.x - 0.13, -HW + 0.05, HW - 0.05);
      b.y = TY + 0.13 + Math.sin(this.time * 3) * 0.008;
      b.z = Math.min(this.ap.z + 0.04, -HL - 0.14);
      this.aiServeT -= dt;
      if (this.aiServeT <= 0) this.toss(null);
    }
  }
  playerToss(intent) { this.toss(intent); }
  toss(intent) {
    this.serveIntent = intent;
    this.phase = 'toss';
    const b = this.ball;
    b.vx = 0; b.vz = 0; b.vy = 2.5; b.wx = b.wy = b.wz = 0;
    S.sToss();
    this.ui.serveHint(false);
  }
  pickAiServe() {
    const d = this.diffKey;
    const types = d === 'easy' ? ['basic', 'basic', 'top'] : d === 'medium' ? ['basic', 'top', 'back', 'side'] : ['top', 'back', 'side', 'fast', 'back'];
    return pick(types);
  }
  strikeServe() {
    const b = this.ball;
    const srv = this.server;
    const dir = srv === 'P' ? -1 : 1;    // rakip yöne z işareti
    let x1, z1, x2, z2, top, side;
    if (srv === 'P') {
      const it = this.serveIntent || { fwd: 0, lat: 0 };
      const pw = clamp((it.fwd - 1) / 6, 0, 1);
      const back = it.fwd < -1.2;
      const latN = clamp(it.lat / 5, -1, 1);
      x1 = null; z1 = 1.0;
      x2 = clamp(latN * 0.55 + b.x * 0.2, -0.6, 0.6);
      if (back) { z2 = -0.45; top = -170; }
      else { z2 = -(0.8 + pw * 0.42); top = 30 + pw * 140; }
      side = -latN * 60;
      x2 += gauss() * 0.04; z2 += gauss() * 0.04;
    } else {
      const t = this.aiServePlan;
      x1 = null; z1 = -1.0;
      x2 = rand(-0.55, 0.55);
      top = 20; side = 0; z2 = rand(0.7, 1.05);
      if (t === 'top') { top = rand(80, 150); z2 = rand(0.9, 1.15); }
      if (t === 'back') { top = -rand(120, 200); z2 = rand(0.35, 0.6); }
      if (t === 'side') { side = pick([-1, 1]) * rand(60, 120); top = rand(-40, 60); }
      if (t === 'fast') { top = rand(120, 180); z2 = rand(1.05, 1.22); x2 = pick([-1, 1]) * rand(0.45, 0.62); }
      if (Math.random() < this.cfg.mistake * 0.5) z2 = rand(1.45, 1.7); // servis hatası
    }
    const sol = P.solveServe(b.x, b.y, b.z, x1, z1, x2, z2, top, side);
    this.applyShot(sol);
    const R = this.rally;
    R.lastHitter = srv; R.isServe = true; R.serveOwn = false; R.netTouch = false; R.recvBounces = 0; R.hits = 1;
    R.pTried = false; R.aTried = false; R.lastNet = false;
    this.phase = 'rally';
    this.stillT = 0;
    const pw = clamp(P.speedOf(b) / 12, 0.2, 1);
    S.sHit(pw);
    const pad = srv === 'P' ? this.pp : this.ap;
    this.hitFx(pad, pw, srv === 'P' ? '#ff6b7a' : this.cfg.color);
    if (srv === 'P') { this.swing = 1; this.stats.hits++; this.planAI(); }
    else { this.aswing = 1; this.afterAiShot(); }
    this.robot.mood = 'focus';
  }

  applyShot(sol) {
    const b = this.ball;
    b.vx = sol.vx; b.vy = sol.vy; b.vz = sol.vz;
    b.wx = sol.wx; b.wy = sol.wy; b.wz = sol.wz;
  }

  // ------------------------------------------------------------------
  //  Oyuncu vuruşu
  // ------------------------------------------------------------------
  incomingTop(b) {
    const h = Math.hypot(b.vx, b.vz) || 1;
    const ux = b.vx / h, uz = b.vz / h;
    return b.wx * uz - b.wz * ux; // ω · (yukarı × v̂)
  }
  playerHit(dx) {
    const b = this.ball, R = this.rally;
    const v = this.swipeVel();
    const fwd = -v.z, lat = v.x;
    const p = clamp((fwd - 0.6) / 6.5, 0, 1);
    const chop = clamp((-fwd - 0.5) / 3, 0, 1);
    const sIn = P.speedOf(b);
    const topIn = this.incomingTop(b);
    const off = Math.abs(dx) / PLAYER_REACH;
    const high = b.y - TY;
    let smash = false;
    let h = lerp(3.6, 12.5, Math.pow(p, 1.1)) + sIn * 0.12 * (1 - p);
    let top = p * 170 - chop * 160 + (p < 0.15 && chop < 0.1 ? 15 : 0);
    if (high > 0.3 && p > 0.55) { smash = true; h += 3.5; top = 60; }
    const side = clamp(-lat * 14, -110, 110);
    let tx = clamp(lat * 0.11 + (dx) * 1.4 + b.x * 0.12, -0.7, 0.7);
    let tz = -(0.55 + 0.72 * p);
    if (chop > 0.2) tz = -rand(0.45, 0.85);
    const err = 0.022 + 0.09 * p * p + 0.11 * off * off + (smash ? 0.04 : 0);
    tx += gauss() * err; tz += gauss() * err * 0.8;
    const sol = P.solveShot(b.x, b.y, b.z, tx, tz, h, top, side);
    // gelen spinin rakete etkisi (blokta topspin yükseltir, backspin düşürür)
    sol.vy += topIn * 0.0042 * (1 - p) * (1 - chop * 0.6);
    // gelen spinin bir kısmı yansır
    sol.wx += -b.wx * 0.18 * (1 - p); sol.wz += -b.wz * 0.18 * (1 - p);
    this.applyShot(sol);
    this.afterHit('P', p, smash);
    this.planAI();
  }

  afterHit(who, p, smash) {
    const b = this.ball, R = this.rally;
    R.lastHitter = who; R.recvBounces = 0; R.isServe = false; R.netTouch = false; R.lastNet = false;
    R.pTried = false; R.aTried = false;
    R.hits++;
    this.stillT = 0;
    const sp = P.speedOf(b);
    const kmh = Math.round(sp * 3.6);
    const pad = who === 'P' ? this.pp : this.ap;
    S.sHit(clamp(sp / 14, 0.15, 1));
    if (sp > 8) S.sWhoosh(clamp(sp / 18, 0, 1));
    this.hitFx(pad, clamp(sp / 16, 0.1, 1), who === 'P' ? '#ff6b7a' : this.cfg.color);
    if (who === 'P') {
      this.swing = 1;
      this.stats.hits++;
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, kmh);
      if (navigator.vibrate) { try { navigator.vibrate(smash ? 30 : 12); } catch (e) { /* yok */ } }
    } else this.aswing = 1;
    if (smash) {
      this.shake = 0.55;
      this.flash = { a: 0.18, color: 'rgba(255,220,150,A)' };
      this.popup('SMAÇ!', b.x, b.y + 0.2, b.z, '#ffcf4a', 34);
      if (who === 'P') this.stats.smashes++;
    } else if (kmh >= 30) {
      this.popup(`${kmh} km/sa`, b.x, b.y + 0.15, b.z, who === 'P' ? '#ffffff' : this.cfg.color, 18);
    }
    if (R.hits >= 6 && R.hits % 4 === 2) this.popup(`${R.hits} vuruş!`, 0, TY + 0.5, 0, '#8be9ff', 20);
    this.ui.rally(R.hits, kmh);
  }

  whiff(pad) {
    // boşa sallama
    if (pad === this.pp) this.swing = 0.7; else this.aswing = 0.7;
    S.sWhoosh(0.3);
  }

  // ------------------------------------------------------------------
  //  Yapay zeka
  // ------------------------------------------------------------------
  aiTarget(x, z) { this.ap.tx = x; this.ap.tz = z; }

  planAI() {
    const d = this.cfg;
    const tr = P.predict(this.ball, 2.6, this.traj);
    let ib = -1;
    for (let i = 0; i < tr.length; i++) {
      if (tr[i].ev === P.EV_TABLE && tr[i].z < 0) { ib = i; break; }
      if (tr[i].ev === P.EV_FLOOR || tr[i].ev === P.EV_EDGE) break;
    }
    this.aiPlan = null;
    if (ib < 0) {
      // top masaya düşmeyecek: robot sadece izler
      this.aiReactT = d.react;
      this.aiPending = { x: clamp(this.ball.x * 0.5, -0.6, 0.6), z: -1.9 };
      return;
    }
    let ja = -1, jl = -1;
    for (let j = ib + 1; j < tr.length; j++) {
      const q = tr[j];
      if (q.ev === P.EV_TABLE || q.ev === P.EV_FLOOR) break;
      if (ja < 0 && q.vy <= 0) ja = j;
      if (q.z < -HL - 0.35 && jl < 0) jl = j;
      if (ja >= 0 && jl >= 0) break;
    }
    let j = ja >= 0 ? ja : jl;
    if (jl >= 0 && ja >= 0) j = Math.min(ja, jl);
    if (j < 0) j = Math.min(tr.length - 1, ib + 30);
    j = ib + Math.max(4, Math.round((j - ib) * d.early));
    // çok alçak noktalardan kaçın
    while (j < tr.length - 1 && tr[j].y < TY + 0.06 && tr[j].vy > 0) j++;
    const q = tr[j];
    this.aiPlan = { x: q.x, y: q.y, z: q.z };
    this.aiReactT = d.react;
    const errX = gauss() * d.predErr * (1 + Math.abs(this.incomingTop(this.ball)) / 400);
    this.aiPending = { x: q.x + errX, z: q.z };
    this.robot.mood = 'focus';
  }

  aiHit() {
    const b = this.ball, d = this.cfg;
    const high = b.y - TY;
    let h = rand(d.speed[0], d.speed[1]);
    let top = rand(d.top[0], d.top[1]);
    let side = gauss() * d.side;
    let tx, tz = rand(d.zr[0], d.zr[1]);
    if (this.diffKey === 'hard') tx = (this.pp.x > 0.05 ? -1 : this.pp.x < -0.05 ? 1 : pick([-1, 1])) * rand(0.3, d.xr);
    else if (this.diffKey === 'medium' && Math.random() < 0.5) tx = (this.pp.x > 0 ? -1 : 1) * rand(0.15, d.xr);
    else tx = rand(-d.xr, d.xr);
    let smash = false;
    const topIn = this.incomingTop(b);
    if (high > 0.28 && Math.random() < d.smash) {
      smash = true; h = rand(12, 15); top = 70; tz = rand(0.75, 1.2);
    } else if (topIn < -80 && Math.random() < 0.5) {
      // kesme topa kesme ile karşılık (push)
      h = rand(3.4, 4.6); top = -rand(80, 150); tz = rand(0.6, 1.05);
    } else if (this.diffKey !== 'easy' && Math.random() < 0.12) {
      // kısa top (drop shot)
      h = rand(3.0, 3.8); top = -rand(40, 100); tz = rand(0.3, 0.5);
    }
    // hata olasılığı: spin okuyamamak + şans
    const spinTrouble = (1 - d.spinRead) * Math.min(1, Math.abs(topIn) / 260) * 0.35;
    let mistake = Math.random() < d.mistake + spinTrouble;
    let netMistake = false;
    if (mistake) {
      const kind = pick(['long', 'wide', 'net']);
      if (kind === 'long') tz = rand(HL + 0.08, HL + 0.45);
      else if (kind === 'wide') tx = pick([-1, 1]) * rand(HW + 0.06, HW + 0.3);
      else netMistake = true;
    }
    tx += gauss() * d.err; tz += gauss() * d.err;
    const sol = P.solveShot(b.x, b.y, b.z, tx, tz, h, top, side);
    if (netMistake) sol.vy -= rand(0.8, 1.6);
    // spin etkisi (zorlukla telafi edilir)
    sol.vy += topIn * 0.0042 * (1 - d.spinRead) * 0.6;
    this.applyShot(sol);
    this.afterHit('A', 0.5, smash);
    this.afterAiShot();
  }

  afterAiShot() {
    // oyuncu için iniş işareti
    if (!this.cfg.marker) return;
    const tr = P.predict(this.ball, 2.5, this.traj);
    for (const q of tr) {
      if (q.ev === P.EV_TABLE && q.z > 0) { this.marker.x = q.x; this.marker.z = q.z; this.marker.on = true; return; }
      if (q.ev === P.EV_FLOOR) return;
    }
  }

  // ------------------------------------------------------------------
  //  Raket hareketleri
  // ------------------------------------------------------------------
  updatePaddles(dtReal, dt) {
    const pp = this.pp, ap = this.ap, b = this.ball;
    // oyuncu: parmağı yumuşak takip
    const k = 1 - Math.exp(-dtReal * 28);
    pp.x = lerp(pp.x, pp.tx, k); pp.z = lerp(pp.z, pp.tz, k);
    const v = this.swipeVel();
    this.pvel.x = lerp(this.pvel.x, v.x, 0.3); this.pvel.z = lerp(this.pvel.z, v.z, 0.3);
    const incoming = this.ballVisible && b.vz > 0 && b.z > -0.6 && (this.phase === 'rally');
    const ty = incoming ? clamp(b.y + (pp.z - b.z) * clamp(b.vy / Math.max(1, b.vz), -0.5, 0.5), TY - 0.12, TY + 0.7) : TY + 0.14;
    pp.y = lerp(pp.y, ty, 1 - Math.exp(-dtReal * 12));
    this.swing = Math.max(0, this.swing - dtReal * 3.2);
    const sw = Math.sin(this.swing * Math.PI);
    pp.pitch = -0.55 - sw * 0.45 + clamp(this.pvel.z * 0.03, -0.25, 0.25);
    const rollT = clamp((b.x - pp.x) * 2.5, -0.8, 0.8) + clamp(-this.pvel.x * 0.06, -0.5, 0.5);
    pp.roll = lerp(pp.roll, rollT, 1 - Math.exp(-dtReal * 10));

    // yapay zeka
    const d = this.cfg;
    if (this.aiPending) {
      this.aiReactT -= dt;
      if (this.aiReactT <= 0) { ap.tx = this.aiPending.x; ap.tz = clamp(this.aiPending.z, -2.6, -0.3); this.aiPending = null; }
    }
    if (this.phase === 'point' || this.phase === 'wait') { ap.tx = lerp(ap.tx, 0, 0.02); ap.tz = lerp(ap.tz, -1.85, 0.02); }
    if (this.phase === 'idle') { ap.tx = b.x; ap.tz = -1.7; pp.tx = b.x; pp.tz = 1.75; }
    const maxV = (this.phase === 'idle' ? 3 : d.maxV) * dt;
    const ddx = ap.tx - ap.x, ddz = ap.tz - ap.z;
    const dl = Math.hypot(ddx, ddz);
    if (dl > 1e-4) {
      const step = Math.min(dl, maxV);
      ap.x += ddx / dl * step; ap.z += ddz / dl * step;
    }
    const aIncoming = this.ballVisible && b.vz < 0 && b.z < 0.6 && this.phase === 'rally';
    const aty = aIncoming ? clamp(b.y + (b.z - ap.z) * clamp(b.vy / Math.max(1, -b.vz), -0.5, 0.5), TY - 0.12, TY + 0.7) : TY + 0.14;
    ap.y = lerp(ap.y, aty, 1 - Math.exp(-dtReal * 12));
    this.aswing = Math.max(0, this.aswing - dtReal * 3.2);
    const asw = Math.sin(this.aswing * Math.PI);
    ap.pitch = 0.5 - asw * 0.5;
    ap.roll = lerp(ap.roll, clamp((ap.x - b.x) * 2.5, -0.8, 0.8), 1 - Math.exp(-dtReal * 8));
    // robot
    const rb = this.robot;
    rb.x = lerp(rb.x, ap.x * 0.55, 1 - Math.exp(-dtReal * 4));
    rb.z = ap.z - 0.6;
    rb.y = TY + 0.82 + (ap.y - TY) * 0.3;
  }

  // ------------------------------------------------------------------
  //  Menü gösterisi: iki robot kendi kendine oynar gibi
  // ------------------------------------------------------------------
  updateDemo(dt) {
    const b = this.ball;
    this.demoT -= dt;
    if (this.demoT <= 0 && Math.abs(b.vz) < 0.1) {
      Object.assign(b, { x: rand(-0.3, 0.3), y: TY + 0.25, z: -1.6, wx: 0, wy: 0, wz: 0 });
      const s = P.solveShot(b.x, b.y, b.z, rand(-0.5, 0.5), rand(0.6, 1.1), rand(4.5, 6.5), rand(20, 90), 0);
      this.applyShot(s);
      this.demoT = 99;
    }
    this.acc += dt;
    const n = Math.min(40, Math.floor(this.acc / P.SIM_DT));
    this.acc -= n * P.SIM_DT;
    for (let i = 0; i < n; i++) {
      const pz = b.z;
      const ev = P.stepBall(b, P.SIM_DT);
      if (ev === P.EV_TABLE) this.bounceFx(b.x, b.z, Math.abs(b.vy));
      if (ev === P.EV_FLOOR || Math.abs(b.z) > 3) { this.demoT = 0.3; b.vz = 0; b.vx = 0; }
      // gösteri vuruşları
      if (pz < 1.7 && b.z >= 1.7 && b.vz > 0 && b.y > TY - 0.2) {
        const s = P.solveShot(b.x, b.y, b.z, rand(-0.5, 0.5), -rand(0.6, 1.1), rand(4.5, 7), rand(20, 120), 0);
        this.applyShot(s); this.hitFx(this.pp, 0.4, '#ff6b7a');
      } else if (pz > -1.7 && b.z <= -1.7 && b.vz < 0 && b.y > TY - 0.2) {
        const s = P.solveShot(b.x, b.y, b.z, rand(-0.5, 0.5), rand(0.6, 1.1), rand(4.5, 7), rand(20, 120), 0);
        this.applyShot(s); this.hitFx(this.ap, 0.4, '#4aa3ff');
      }
    }
  }

  // ------------------------------------------------------------------
  //  Efektler
  // ------------------------------------------------------------------
  updateSpinVis(dt) {
    const b = this.ball, sv = this.spinVis;
    const w = Math.hypot(b.wx, b.wy, b.wz);
    sv.phase += Math.min(w, 400) * dt * 0.12 + Math.hypot(b.vx, b.vz) * dt * 0.5;
    if (w > 1) {
      const p0 = this.r.proj(b.x, b.y, b.z), p1 = this.r.proj(b.x + b.wx / w * 0.05, b.y + b.wy / w * 0.05, b.z + b.wz / w * 0.05);
      sv.axisAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    }
  }

  updateFx(dtReal, dt) {
    const F = this.fx;
    for (let i = F.particles.length - 1; i >= 0; i--) {
      const p = F.particles[i];
      p.life -= dtReal;
      if (p.life <= 0) { F.particles.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      const drag = p.kind === 'confetti' ? 3.2 : 1.2;
      p.vx -= p.vx * drag * dtReal; p.vy -= p.vy * drag * dtReal; p.vz -= p.vz * drag * dtReal;
      p.vy -= (p.kind === 'confetti' ? 2.2 : p.g ?? 6) * dtReal;
      p.x += p.vx * dtReal; p.y += p.vy * dtReal; p.z += p.vz * dtReal;
      if (p.rot !== undefined) p.rot += p.vr * dtReal;
      if (p.y < 0.01 && p.kind !== 'confetti') { p.y = 0.01; p.vy *= -0.4; }
    }
    for (let i = F.rings.length - 1; i >= 0; i--) { const r = F.rings[i]; r.life -= dtReal; if (r.life <= 0) F.rings.splice(i, 1); }
    for (let i = F.popups.length - 1; i >= 0; i--) { const r = F.popups[i]; r.life -= dtReal; if (r.life <= 0) F.popups.splice(i, 1); }
    for (let i = F.marks.length - 1; i >= 0; i--) { const r = F.marks[i]; r.life -= dtReal; if (r.life <= 0) F.marks.splice(i, 1); }
    this.netWave.t += dtReal;
    this.netWave.a *= Math.exp(-dtReal * 4.5);
    this.shake *= Math.exp(-dtReal * 7);
    this.flash.a *= Math.exp(-dtReal * 4);
    this.crowdExcite = Math.max(0, this.crowdExcite - dtReal * 0.45);
    this.marker.a = lerp(this.marker.a, this.marker.on ? 1 : 0, 1 - Math.exp(-dtReal * 10));
    // sayı sonrası
    if (this.phase === 'point') {
      this.pointT -= dtReal;
      if (this.pointT <= 0) {
        if (this.matchOver) {
          this.phase = 'over';
          this.ballVisible = false;
          this.ui.matchEnd({ won: this.matchOver === 'P', score: this.score, stats: this.stats, bot: this.cfg.bot, diff: this.cfg.name, bestOf: this.bestOf });
          this.matchOver = null;
        } else if (this.setEnded) {
          const s = this.score;
          s.set++; s.p = 0; s.a = 0;
          this.setFirstServer = other(this.setFirstServer);
          this.setEnded = null;
          this.ui.score(this.scoreView());
          this.ui.message(`SET ${s.set}`, 'Yeni set başlıyor', 'info');
          this.newPoint(1.2);
        } else this.newPoint(0.25);
      }
    }
    if (this.phase === 'over' && Math.random() < dtReal * 2.5) this.fireworks(1);
  }

  bounceFx(x, z, v) {
    const k = clamp(v / 5, 0.15, 1);
    this.fx.rings.push({ x, y: TY + 0.002, z, r0: 0.02, r1: 0.12 * k + 0.04, life: 0.45, max: 0.45, color: 'rgba(160,220,255,A)' });
    this.fx.marks.push({ x, z, life: 1.6, max: 1.6 });
    this.burst(x, TY + 0.01, z, Math.round(4 + k * 8), ['#cfe8ff', '#ffffff'], 0.9 * k + 0.3, 0.004, 3);
  }
  hitFx(pad, p, color) {
    const b = this.ball;
    this.burst(b.x, b.y, b.z, Math.round(10 + p * 30), [color, '#ffffff', '#ffd27a'], 1.2 + p * 3.2, 0.005 + p * 0.003);
    this.fx.rings.push({ x: b.x, y: b.y, z: b.z, r0: 0.03, r1: 0.12 + p * 0.25, life: 0.3, max: 0.3, color: color.startsWith('#') ? hexA(color) : color });
    this.shake = Math.max(this.shake, p * 0.25);
  }
  burst(x, y, z, n, colors, spd, size, g = 6) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(-1, 1));
      const s = spd * rand(0.3, 1);
      this.fx.particles.push({
        x, y, z, vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.abs(Math.cos(ph)) * s * 0.9 + 0.3, vz: Math.sin(ph) * Math.sin(th) * s,
        life: rand(0.25, 0.6), max: 0.6, color: pick(colors), size: size * rand(0.6, 1.3), kind: 'spark', g,
      });
    }
    if (this.fx.particles.length > 600) this.fx.particles.splice(0, this.fx.particles.length - 600);
  }
  confetti(n) {
    const cols = ['#ff4d6d', '#ffd23f', '#3dff8f', '#4aa3ff', '#c77dff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      this.fx.particles.push({
        x: rand(-1.4, 1.4), y: rand(2.0, 2.6), z: rand(-1.2, 1.4), vx: rand(-0.6, 0.6), vy: rand(-0.3, 0.5), vz: rand(-0.4, 0.4),
        life: rand(1.8, 2.8), max: 2.8, color: pick(cols), size: rand(0.012, 0.02), kind: 'confetti', rot: rand(0, 6), vr: rand(-8, 8),
      });
    }
  }
  fireworks(count = 4) {
    const cols = ['#ff4d6d', '#ffd23f', '#3dff8f', '#4aa3ff', '#c77dff', '#ff9f1c'];
    for (let k = 0; k < count; k++) {
      const x = rand(-2.5, 2.5), y = rand(2.4, 3.6), z = rand(-5, -2.5);
      const c = pick(cols);
      for (let i = 0; i < 46; i++) {
        const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(-1, 1)), s = rand(1.5, 2.6);
        this.fx.particles.push({
          x, y, z, vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.cos(ph) * s, vz: Math.sin(ph) * Math.sin(th) * s,
          life: rand(0.9, 1.5), max: 1.5, color: i % 5 === 0 ? '#ffffff' : c, size: 0.025, kind: 'spark', g: 1.2,
        });
      }
    }
    if (count > 1) this.confetti(80);
    this.crowdExcite = 1;
  }
  popup(text, x, y, z, color, size) {
    this.fx.popups.push({ text, x, y, z, color, size, life: 1.1, max: 1.1 });
  }
}

function hexA(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},A)`;
}
