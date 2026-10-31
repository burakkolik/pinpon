// =====================================================================
//  Pinpon fizik motoru
//  - Yerçekimi, kuadratik hava direnci, Magnus kuvveti (spin)
//  - Masa / zemin sekmesinde normal restitüsyon + Coulomb sürtünmesi
//    (içi boş küre eylemsizlik momenti I = 2/3 m r^2) ile spin <-> hız aktarımı
//  - File gövdesi ve file ipi (üst kenar) çarpışmaları
//  - Atış çözücü: hedef noktaya inen başlangıç hızını sayısal simülasyonla bulur
//  Koordinatlar (metre): x = masa genişliği, y = yukarı, z = masa boyu
//  Oyuncu z > 0 tarafında, yapay zeka z < 0 tarafında.
// =====================================================================

export const TABLE = {
  L: 2.74,          // boy
  W: 1.525,         // en
  H: 0.76,          // yükseklik
  NET_H: 0.1525,    // file yüksekliği
  NET_HALF: 0.915,  // file yarı genişliği (masadan 15.25 cm taşar)
  THICK: 0.03,
};
export const HL = TABLE.L / 2;
export const HW = TABLE.W / 2;
export const BALL_R = 0.02;
export const G = 9.81;

const RHO = 1.2;                         // hava yoğunluğu kg/m3
const MASS = 0.0027;                     // 2.7 g
const AREA = Math.PI * BALL_R * BALL_R;
const CD = 0.47;
const KQ = 0.5 * RHO * AREA / MASS;      // dinamik basınç katsayısı / kütle
const KD = KQ * CD;                      // sürüklenme
const KM = KQ * BALL_R * 0.75;           // Magnus (ω × v) katsayısı
const CL_MAX = 0.38;                     // kaldırma katsayısı doygunluğu
const SPIN_DECAY = 0.11;                 // 1/s – hava sürtünmesiyle spin kaybı

const E_TABLE = 0.89, MU_TABLE = 0.24;
const E_FLOOR = 0.70, MU_FLOOR = 0.45;
const E_NET = 0.12, E_CORD = 0.35;

export const EV_NONE = 0, EV_TABLE = 1, EV_NET = 2, EV_FLOOR = 3, EV_EDGE = 4, EV_CORD = 5;

export function makeBall() {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 };
}
export function copyBall(dst, s) {
  dst.x = s.x; dst.y = s.y; dst.z = s.z;
  dst.vx = s.vx; dst.vy = s.vy; dst.vz = s.vz;
  dst.wx = s.wx; dst.wy = s.wy; dst.wz = s.wz;
  return dst;
}
export function speedOf(b) { return Math.hypot(b.vx, b.vy, b.vz); }

// Sekme: normal y yönünde (masa / zemin). Sürtünme, temas noktasının kayma
// hızını sıfırlamaya çalışır; sınırlanırsa Coulomb kayması olur.
function bounceSurface(b, e, mu) {
  const vn = -b.vy;                         // > 0 (aşağı doğru hız)
  // temas noktası hızı u = v + ω × r, r = (0,-R,0)
  const ux = b.vx + b.wz * BALL_R;
  const uz = b.vz - b.wx * BALL_R;
  // tutunma için gereken impuls (kütle başına): j = -0.4 u  (1/m + R²/I = 2.5/m)
  let jx = -0.4 * ux, jz = -0.4 * uz;
  const jmax = mu * (1 + e) * vn;
  const jm = Math.hypot(jx, jz);
  if (jm > jmax && jm > 0) { const s = jmax / jm; jx *= s; jz *= s; }
  b.vx += jx; b.vz += jz;
  // Δω = (r × j) / I  ->  (-R jz, 0, R jx) * 3/(2R²)
  b.wx += -1.5 * jz / BALL_R;
  b.wz += 1.5 * jx / BALL_R;
  b.vy = e * vn;
}

// Tek zaman adımı. Olay kodunu döndürür.
export function stepBall(b, dt) {
  const v = Math.hypot(b.vx, b.vy, b.vz);
  // Sürüklenme
  let ax = -KD * v * b.vx, ay = -KD * v * b.vy - G, az = -KD * v * b.vz;
  // Magnus: KM (ω × v), kaldırma katsayısı doygunluğu ile sınırlı
  let mx = KM * (b.wy * b.vz - b.wz * b.vy);
  let my = KM * (b.wz * b.vx - b.wx * b.vz);
  let mz = KM * (b.wx * b.vy - b.wy * b.vx);
  const mm = Math.hypot(mx, my, mz), mlim = KQ * CL_MAX * v * v;
  if (mm > mlim && mm > 0) { const s = mlim / mm; mx *= s; my *= s; mz *= s; }
  ax += mx; ay += my; az += mz;

  const px = b.x, py = b.y, pz = b.z;
  // yarı-örtük Euler
  b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const dec = 1 - SPIN_DECAY * dt;
  b.wx *= dec; b.wy *= dec; b.wz *= dec;

  const top = TABLE.H + BALL_R;
  const inFoot = Math.abs(b.x) <= HW && Math.abs(b.z) <= HL;
  // --- Masa üst yüzeyi
  if (inFoot && b.vy < 0 && b.y < top && py >= top - 0.02) {
    b.y = top + (top - b.y) * 0.1;
    if (b.vy > -0.12) { b.vy = 0; b.y = top; b.vx *= 0.995; b.vz *= 0.995; return EV_NONE; } // yuvarlanma
    bounceSurface(b, E_TABLE, MU_TABLE);
    return EV_TABLE;
  }
  // --- Masa kenarı / yan yüzü (masanın altına girmesin)
  if (inFoot && b.y < top - 0.005 && b.y > TABLE.H - 0.1) {
    const wasIn = Math.abs(px) <= HW && Math.abs(pz) <= HL;
    if (!wasIn) {
      if (Math.abs(pz) > HL) { b.z = Math.sign(pz) * (HL + BALL_R * 0.5); b.vz = -b.vz * 0.4; }
      else { b.x = Math.sign(px) * (HW + BALL_R * 0.5); b.vx = -b.vx * 0.4; }
      b.vy *= 0.6; b.wx *= 0.3; b.wy *= 0.3; b.wz *= 0.3;
      return EV_EDGE;
    }
  }
  // --- File
  if (Math.abs(b.x) < TABLE.NET_HALF && b.y > TABLE.H - 0.01) {
    const netTop = TABLE.H + TABLE.NET_H;
    const dy = b.y - netTop, dz = b.z;
    if (dy > 0) {
      const d = Math.hypot(dy, dz);
      if (d < BALL_R + 0.002) {        // file ipi (üst bant)
        const nx = 0, ny = dy / d, nz = dz / d;
        const vn = b.vy * ny + b.vz * nz;
        if (vn < 0) {
          b.vy -= (1 + E_CORD) * vn * ny;
          b.vz -= (1 + E_CORD) * vn * nz;
          b.vx *= 0.9;
          b.wx *= 0.5; b.wy *= 0.6; b.wz *= 0.5;
          const push = BALL_R + 0.002 - d;
          b.y += ny * push; b.z += nz * push;
          return EV_CORD;
        }
      }
    } else if ((pz > 0) !== (b.z > 0) || Math.abs(b.z) < BALL_R) {
      // file gövdesi
      const s = pz >= 0 ? 1 : -1;
      if (b.vz * s < 0) {
        b.z = s * (BALL_R + 0.001);
        b.vz = -b.vz * E_NET;
        b.vx *= 0.35; b.vy *= 0.35;
        b.wx *= 0.2; b.wy *= 0.2; b.wz *= 0.2;
        return EV_NET;
      }
    }
  }
  // --- Zemin
  if (b.y < BALL_R && b.vy < 0) {
    b.y = BALL_R;
    if (b.vy > -0.12) { b.vy = 0; b.vx *= 0.99; b.vz *= 0.99; return EV_NONE; }
    bounceSurface(b, E_FLOOR, MU_FLOOR);
    return EV_FLOOR;
  }
  return EV_NONE;
}

// ----------------------------------------------------------------------
//  Atış çözücü
// ----------------------------------------------------------------------
export const SIM_DT = 1 / 240;
const _s = makeBall();

// Spin vektörü: top (+ topspin / − backspin) ve side (yan falso) rad/s
export function spinVector(dx, dz, top, side) {
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  // topspin ekseni = yukarı × yön = (uz, 0, -ux)
  return { wx: top * uz, wy: side, wz: -top * ux };
}

// İlk masa temasına kadar simüle eder; yön boyunca alınan mesafe ve iniş noktası.
function landing(b0, ux, uz, out) {
  copyBall(_s, b0);
  const sx = b0.x, sz = b0.z;
  let netHit = false;
  for (let t = 0; t < 2.5; t += SIM_DT) {
    const ev = stepBall(_s, SIM_DT);
    if (ev === EV_TABLE) {
      out.x = _s.x; out.z = _s.z; out.t = t; out.net = netHit;
      out.d = (_s.x - sx) * ux + (_s.z - sz) * uz;
      out.vy = _s.vy;
      return out;
    }
    if (ev === EV_NET || ev === EV_EDGE) {
      out.x = _s.x; out.z = _s.z; out.t = t; out.net = true;
      out.d = (_s.x - sx) * ux + (_s.z - sz) * uz - 0.5;
      return out;
    }
    if (ev === EV_CORD) netHit = true;
    if (ev === EV_FLOOR) break;
    // masa seviyesinin altına indi: masaya ulaşamadı (kısa) ya da masayı aştı (uzun)
    if (_s.y < TABLE.H) break;
  }
  out.x = _s.x; out.z = _s.z; out.t = 9; out.net = netHit;
  out.d = (_s.x - sx) * ux + (_s.z - sz) * uz;
  if (out.d < 0) out.d = 0;
  return out;
}

const _b = makeBall();
const _land = { x: 0, z: 0, d: 0, t: 0, net: false, vy: 0 };

// Belirli yatay hızla (h) (tx,tz)'ye inmek için gereken dikey hızı bulur.
function solveFixedH(px, py, pz, tx, tz, h, top, side, iters) {
  let aimx = tx, aimz = tz, vy = 0, res = null;
  for (let k = 0; k < iters; k++) {
    const dx = aimx - px, dz = aimz - pz;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    const w = spinVector(dx, dz, top, side);
    const want = (tx - px) * ux + (tz - pz) * uz;
    let lo = -9, hi = 9;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      _b.x = px; _b.y = py; _b.z = pz;
      _b.vx = ux * h; _b.vz = uz * h; _b.vy = mid;
      _b.wx = w.wx; _b.wy = w.wy; _b.wz = w.wz;
      landing(_b, ux, uz, _land);
      if (_land.d < want) lo = mid; else hi = mid;
    }
    vy = (lo + hi) / 2;
    _b.x = px; _b.y = py; _b.z = pz;
    _b.vx = ux * h; _b.vz = uz * h; _b.vy = vy;
    _b.wx = w.wx; _b.wy = w.wy; _b.wz = w.wz;
    landing(_b, ux, uz, _land);
    res = {
      vx: ux * h, vy, vz: uz * h, wx: w.wx, wy: w.wy, wz: w.wz,
      lx: _land.x, lz: _land.z, net: _land.net,
      err: Math.hypot(_land.x - tx, _land.z - tz),
    };
    aimx -= (_land.x - tx);
    aimz -= (_land.z - tz) * 0.5;
  }
  return res;
}

/**
 * Hedefe giden atışı çözer. h: istenen yatay hız (m/s). File geçilemezse hız düşürülür.
 * Dönüş: {vx,vy,vz,wx,wy,wz, ok, err}
 */
export function solveShot(px, py, pz, tx, tz, h, top = 0, side = 0) {
  let best = null;
  let hh = h;
  for (let tries = 0; tries < 7; tries++) {
    const r = solveFixedH(px, py, pz, tx, tz, hh, top, side, 3);
    if (!best || r.err < best.err) best = r;
    if (r.err < 0.05 && !r.net) { best = r; break; }
    hh *= 0.86;
    top *= 0.85;
  }
  best.ok = best.err < 0.12;
  return best;
}

/**
 * Servis: önce kendi yarı alanında (x1,z1)'e, sonra rakip alanında z2 derinliğine sekecek atış.
 */
export function solveServe(px, py, pz, x1, z1, x2, z2, top = 0, side = 0) {
  const autoX = x1 === null;
  const zs = [z1, z1 * 0.8, z1 * 1.15, z1 * 0.6];
  let best = null;
  const trial = (h, zz) => {
    // ilk sekme, vuruş noktası ile hedef arasındaki doğru üzerinde olsun
    const xx = autoX ? px + (x2 - px) * (zz - pz) / (z2 - pz) : x1;
    const r = solveFixedH(px, py, pz, xx, zz, h, top, side, 2);
    if (r.err > 0.1) return null;
    _b.x = px; _b.y = py; _b.z = pz;
    _b.vx = r.vx; _b.vy = r.vy; _b.vz = r.vz; _b.wx = r.wx; _b.wy = r.wy; _b.wz = r.wz;
    let bounces = 0;
    for (let t = 0; t < 3; t += SIM_DT) {
      const ev = stepBall(_b, SIM_DT);
      if (ev === EV_TABLE) {
        bounces++;
        if (bounces === 2) break;
      } else if (ev === EV_NET || ev === EV_EDGE || ev === EV_CORD || ev === EV_FLOOR) return null;
    }
    if (bounces !== 2 || Math.sign(_b.z) === Math.sign(pz)) return null;
    const e = Math.hypot(_b.z - z2, (_b.x - x2) * 0.5);
    const res = Object.assign({}, r, { e2: e, sx: _b.x, sz: _b.z, h });
    if (!best || e < best.e2) best = res;
    return res;
  };
  for (const zz of zs) {
    for (let h = 2; h <= 11; h += 0.6) trial(h, zz);
    if (best) {
      // en iyi hız etrafında ince ayar
      let step = 0.3;
      for (let k = 0; k < 6; k++) {
        const h0 = best.h;
        trial(h0 - step, zz); trial(h0 + step, zz);
        step *= 0.5;
      }
      if (best.e2 < 0.1) break;
    }
  }
  if (!best) {
    // geri dönüş: basit, yavaş servis
    const r = solveFixedH(px, py, pz, px * 0.5, z1, 3.2, 0, 0, 2);
    best = Object.assign({}, r, { e2: 1 });
  }
  return best;
}

/** Topun ileriki yörüngesini kaydeder (yapay zeka tahmini ve kılavuz için). */
export function predict(b0, maxT, out) {
  copyBall(_s, b0);
  out.length = 0;
  for (let t = 0; t < maxT; t += SIM_DT) {
    const ev = stepBall(_s, SIM_DT);
    out.push({ t, x: _s.x, y: _s.y, z: _s.z, vx: _s.vx, vy: _s.vy, vz: _s.vz, ev });
    if (ev === EV_FLOOR) break;
  }
  return out;
}
