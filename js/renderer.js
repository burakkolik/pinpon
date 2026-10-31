// =====================================================================
//  3B yazılım çizici (Canvas 2D üzerinde perspektif projeksiyon)
//  Hiçbir hazır grafik kütüphanesi kullanılmaz; tüm sahne kodla üretilir.
// =====================================================================
import { TABLE, HL, HW, BALL_R } from './physics.js';

const TY = TABLE.H;
const NEAR = 0.08;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Tekrarlanabilir rastgele sayı üreteci (statik sahne için)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.tableLayer = document.createElement('canvas');
    this.vignette = document.createElement('canvas');
    this.eye = { x: 0, y: 2, z: 3 };
    this.f = 500; this.cx = 0; this.cy = 0;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.flashes = [];
    this.heads = [];
    this.motes = [];
    this.time = 0;
    this.hudTop = 70;
  }

  // ------------------------------------------------------------------
  //  Kamera
  // ------------------------------------------------------------------
  setCamera(eye, target) {
    this.eye = eye;
    let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    // sağ = ileri × yukarı
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
    // yukarı = sağ × ileri
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    this.F = [fx, fy, fz]; this.R = [rx, ry, rz]; this.U = [ux, uy, uz];
  }
  cam(x, y, z, o) {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    const R = this.R, U = this.U, F = this.F;
    o[0] = dx * R[0] + dy * R[1] + dz * R[2];
    o[1] = dx * U[0] + dy * U[1] + dz * U[2];
    o[2] = dx * F[0] + dy * F[1] + dz * F[2];
    return o;
  }
  // Ekran koordinatı; o = {x, y, s (ölçek px/m), z (derinlik)}
  proj(x, y, z, o = {}) {
    const c = this.cam(x, y, z, this._t || (this._t = [0, 0, 0]));
    const Z = Math.max(c[2], NEAR);
    o.x = this.cx + this.f * c[0] / Z;
    o.y = this.cy - this.f * c[1] / Z;
    o.s = this.f / Z;
    o.z = c[2];
    return o;
  }
  depth(x, y, z) {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    return dx * this.F[0] + dy * this.F[1] + dz * this.F[2];
  }
  // 3B çokgeni yakın düzleme göre kırpıp yol oluşturur
  path(ctx, pts) {
    const cs = pts.map(p => this.cam(p[0], p[1], p[2], [0, 0, 0]));
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    if (out.length < 3) return false;
    ctx.beginPath();
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      const sx = this.cx + this.f * c[0] / c[2], sy = this.cy - this.f * c[1] / c[2];
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    return true;
  }
  line(ctx, a, b) {
    const ca = this.cam(a[0], a[1], a[2], [0, 0, 0]), cb = this.cam(b[0], b[1], b[2], [0, 0, 0]);
    if (ca[2] < NEAR && cb[2] < NEAR) return;
    if (ca[2] < NEAR || cb[2] < NEAR) {
      const t = (NEAR - ca[2]) / (cb[2] - ca[2]);
      const m = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR];
      if (ca[2] < NEAR) ca.splice(0, 3, ...m); else cb.splice(0, 3, ...m);
    }
    ctx.moveTo(this.cx + this.f * ca[0] / ca[2], this.cy - this.f * ca[1] / ca[2]);
    ctx.lineTo(this.cx + this.f * cb[0] / cb[2], this.cy - this.f * cb[1] / cb[2]);
  }
  // Ekran noktasından y = planeY düzlemine ışın
  screenToPlane(sx, sy, planeY) {
    const X = (sx - this.cx) / this.f, Y = -(sy - this.cy) / this.f;
    const R = this.R, U = this.U, F = this.F;
    const dx = F[0] + X * R[0] + Y * U[0];
    let dy = F[1] + X * R[1] + Y * U[1];
    const dz = F[2] + X * R[2] + Y * U[2];
    if (dy > -0.02) dy = -0.02;
    const t = (planeY - this.eye.y) / dy;
    return { x: this.eye.x + dx * t, z: this.eye.z + dz * t };
  }

  // ------------------------------------------------------------------
  //  Yeniden boyutlandırma: kamerayı ekrana sığdır, statik katmanları üret
  // ------------------------------------------------------------------
  resize(w, h, dpr, hudTop = 64) {
    this.w = w; this.h = h; this.dpr = dpr; this.hudTop = hudTop;
    for (const c of [this.canvas, this.bg, this.tableLayer, this.vignette]) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    const a = w / h;
    const t = clamp((a - 0.55) / (1.5 - 0.55), 0, 1);
    const eye = { x: 0, y: lerp(3.15, 2.25, t), z: lerp(2.75, 3.3, t) };
    const target = { x: 0, y: lerp(0.3, 0.5, t), z: lerp(-0.3, -0.45, t) };
    this.setCamera(eye, target);
    // f = 1 ile kritik noktaların sınır kutusu
    const pts = [
      [-HW, TY, -HL], [HW, TY, -HL], [-HW, TY, HL], [HW, TY, HL],
      [-0.85, TY + 0.6, -2.2], [0.85, TY + 0.6, -2.2], [0, TY + 1.12, -2.5],
      [-0.9, TY + 0.1, 1.75], [0.9, TY + 0.1, 1.75],
    ];
    if (t < 0.5) pts.push([0, TY - 0.2, 2.1]);
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    const c = [0, 0, 0];
    for (const p of pts) {
      this.cam(p[0], p[1], p[2], c);
      const X = c[0] / c[2], Y = -c[1] / c[2];
      minx = Math.min(minx, X); maxx = Math.max(maxx, X);
      miny = Math.min(miny, Y); maxy = Math.max(maxy, Y);
    }
    const availH = h - hudTop - Math.max(10, h * 0.02);
    this.f = Math.min((w * 0.97) / (maxx - minx), availH / (maxy - miny));
    this.cx = w / 2 - this.f * (minx + maxx) / 2;
    // boş dikey alanın çoğu üstte (salon), bir kısmı altta (parmak alanı) kalsın
    const free = availH - this.f * (maxy - miny);
    this.cy = hudTop + free * 0.58 - this.f * miny;
    this.buildBackground();
    this.buildTable();
    this.buildVignette();
    this.motes = [];
    const r = rng(77);
    for (let i = 0; i < 60; i++) {
      this.motes.push({ x: (r() - 0.5) * 6, y: r() * 3.2 + 0.3, z: -r() * 5 + 1, p: r() * 6.28, s: 0.5 + r() });
    }
  }

  // ------------------------------------------------------------------
  //  Statik arka plan: salon, tribün, seyirci, zemin, bariyerler, ışık
  // ------------------------------------------------------------------
  buildBackground() {
    const c = this.bg.getContext('2d');
    const { w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#04060e'); g.addColorStop(0.4, '#0a1028'); g.addColorStop(1, '#0b0d1a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);

    // Arka duvar
    if (this.path(c, [[-14, 0, -11], [14, 0, -11], [14, 8, -11], [-14, 8, -11]])) {
      const p0 = this.proj(0, 8, -11), p1 = this.proj(0, 0, -11);
      const gw = c.createLinearGradient(0, p0.y, 0, p1.y);
      gw.addColorStop(0, '#070a18'); gw.addColorStop(1, '#141b3d');
      c.fillStyle = gw; c.fill();
    }
    // Dev ekran (skorbord) arka duvarda
    if (this.path(c, [[-2.4, 3.6, -10.9], [2.4, 3.6, -10.9], [2.4, 5.6, -10.9], [-2.4, 5.6, -10.9]])) {
      c.fillStyle = '#0d1430'; c.fill();
      c.strokeStyle = 'rgba(80,160,255,0.5)'; c.lineWidth = 2; c.stroke();
      const p = this.proj(0, 4.6, -10.9);
      c.save();
      c.fillStyle = 'rgba(110,190,255,0.85)';
      c.shadowColor = '#3af'; c.shadowBlur = 12;
      c.font = `800 ${Math.max(8, p.s * 0.55)}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('PİNPON ARENA', p.x, p.y);
      c.restore();
    }
    // Tribünler ve seyirci
    const r = rng(1234);
    this.heads = [];
    const rows = 9;
    for (let i = rows - 1; i >= 0; i--) {
      const z = -5.6 - i * 0.62, y = 0.35 + i * 0.42;
      if (this.path(c, [[-12, y - 0.42, z + 0.3], [12, y - 0.42, z + 0.3], [12, y, z], [-12, y, z]])) {
        c.fillStyle = i % 2 ? '#0d1226' : '#10162d'; c.fill();
      }
      const fog = 0.35 + 0.65 * (1 - i / rows);
      for (let x = -11.5; x < 11.5; x += 0.42 + r() * 0.2) {
        if (r() < 0.12) continue;
        const hx = x + (r() - 0.5) * 0.1, hy = y + 0.36 + r() * 0.05, hz = z - 0.05;
        const p = this.proj(hx, hy, hz);
        if (p.z < NEAR || p.y < -20 || p.y > h + 20) continue;
        const hue = Math.floor(r() * 360), sat = 30 + r() * 40, li = (12 + r() * 22) * fog;
        // omuzlar
        c.fillStyle = `hsl(${hue},${sat}%,${li}%)`;
        c.beginPath();
        c.ellipse(p.x, p.y + p.s * 0.2, p.s * 0.2, p.s * 0.13, 0, Math.PI, 0);
        c.fill();
        // baş
        c.fillStyle = `hsl(${20 + r() * 20},${25 + r() * 20}%,${(18 + r() * 25) * fog}%)`;
        c.beginPath(); c.arc(p.x, p.y, p.s * 0.1, 0, Math.PI * 2); c.fill();
        this.heads.push({ x: p.x, y: p.y, s: p.s });
      }
    }
    // Zemin
    if (this.path(c, [[-16, 0, -5.4], [16, 0, -5.4], [16, 0, 6], [-16, 0, 6]])) {
      const p0 = this.proj(0, 0, -5.4);
      const gf = c.createLinearGradient(0, p0.y, 0, h);
      gf.addColorStop(0, '#11142a'); gf.addColorStop(1, '#1d2140');
      c.fillStyle = gf; c.fill();
    }
    // Kort zemini (kauçuk)
    if (this.path(c, [[-3.6, 0, -4.6], [3.6, 0, -4.6], [3.6, 0, 5], [-3.6, 0, 5]])) {
      const p0 = this.proj(0, 0, -4.6);
      const gc = c.createLinearGradient(0, p0.y, 0, h);
      gc.addColorStop(0, '#3a1420'); gc.addColorStop(0.6, '#5b1d2c'); gc.addColorStop(1, '#6e2434');
      c.fillStyle = gc; c.fill();
    }
    // Zemin ışık havuzu
    {
      const p = this.proj(0, 0, 0), q = this.proj(3.2, 0, 0), q2 = this.proj(0, 0, 2.4);
      const rx = Math.abs(q.x - p.x), ry = Math.abs(q2.y - p.y) + 1;
      c.save();
      c.translate(p.x, p.y); c.scale(1, ry / rx);
      const gl = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      gl.addColorStop(0, 'rgba(255,240,220,0.22)'); gl.addColorStop(1, 'rgba(255,240,220,0)');
      c.fillStyle = gl; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // Bariyerler (arka + yanlar)
    const bh = 0.72;
    const barrier = (pts, col) => {
      if (this.path(c, pts)) {
        c.fillStyle = col; c.fill();
        c.strokeStyle = 'rgba(120,180,255,0.35)'; c.lineWidth = 1; c.stroke();
      }
    };
    for (const sx of [-1, 1]) {
      for (let z = -4.6; z < 4.5; z += 1.4) {
        barrier([[sx * 3.6, 0, z], [sx * 3.6, 0, z + 1.4], [sx * 3.6, bh, z + 1.4], [sx * 3.6, bh, z]], sx < 0 ? '#122a5c' : '#10275a');
      }
    }
    for (let x = -3.6; x < 3.6; x += 1.44) {
      const pts = [[x, 0, -4.6], [x + 1.44, 0, -4.6], [x + 1.44, bh, -4.6], [x, bh, -4.6]];
      if (this.path(c, pts)) {
        const pa = this.proj(x, bh, -4.6), pb = this.proj(x, 0, -4.6);
        const gb = c.createLinearGradient(0, pa.y, 0, pb.y);
        gb.addColorStop(0, '#1e4fb0'); gb.addColorStop(1, '#0f2a66');
        c.fillStyle = gb; c.fill();
        c.strokeStyle = 'rgba(160,210,255,0.45)'; c.lineWidth = 1; c.stroke();
        const pc = this.proj(x + 0.72, bh * 0.5, -4.6);
        c.save();
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.font = `900 ${Math.max(6, pc.s * 0.28)}px system-ui, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('PİNPON', pc.x, pc.y);
        c.restore();
      }
    }
    // Masanın zemindeki gölgesi
    {
      const p = this.proj(0, 0, 0), q = this.proj(HW + 0.25, 0, 0), q2 = this.proj(0, 0, HL + 0.3);
      const rx = Math.abs(q.x - p.x), ry = Math.abs(q2.y - p.y) + 1;
      c.save();
      c.translate(p.x, p.y); c.scale(1, ry / rx);
      const gs = c.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
      gs.addColorStop(0, 'rgba(0,0,0,0.55)'); gs.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gs; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // Hacimsel spot ışık huzmeleri
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const lx of [-1.6, 1.6]) {
      const top = this.proj(lx * 0.8, 7, -0.8);
      const bl = this.proj(lx - 1.3, 0, 0), br = this.proj(lx + 1.3, 0, 0);
      const gr = c.createLinearGradient(0, top.y, 0, bl.y);
      gr.addColorStop(0, 'rgba(180,210,255,0.10)'); gr.addColorStop(1, 'rgba(180,210,255,0)');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(top.x - 10, top.y); c.lineTo(top.x + 10, top.y); c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y); c.closePath(); c.fill();
    }
    c.restore();
  }

  // ------------------------------------------------------------------
  //  Masa katmanı
  // ------------------------------------------------------------------
  buildTable() {
    const c = this.tableLayer.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const legX = HW - 0.14, legZ = HL - 0.3, legW = 0.04;
    // Bacaklar (uzaktakiler önce)
    const legs = [[-legX, -legZ], [legX, -legZ], [-legX, legZ], [legX, legZ]];
    for (const [lx, lz] of legs) {
      for (const [ox, oz, col] of [[0, legW, '#20242e'], [legW, 0, '#2c313d']]) {
        const pts = [[lx - ox, 0, lz + oz], [lx + ox, 0, lz - oz], [lx + ox, TY - 0.04, lz - oz], [lx - ox, TY - 0.04, lz + oz]];
        if (this.path(c, pts)) { c.fillStyle = col; c.fill(); }
      }
      // ayak tekerleği
      const p = this.proj(lx, 0.02, lz);
      c.fillStyle = '#0b0c10'; c.beginPath(); c.ellipse(p.x, p.y, p.s * 0.05, p.s * 0.025, 0, 0, Math.PI * 2); c.fill();
    }
    // Alt çerçeve
    for (const sz of [-1, 1]) {
      const pts = [[-legX, 0.22, sz * legZ], [legX, 0.22, sz * legZ], [legX, 0.26, sz * legZ], [-legX, 0.26, sz * legZ]];
      if (this.path(c, pts)) { c.fillStyle = '#272b36'; c.fill(); }
    }
    const pts = [[-0.03, 0.24, -legZ], [0.03, 0.24, -legZ], [0.03, 0.24, legZ], [-0.03, 0.24, legZ]];
    if (this.path(c, pts)) { c.fillStyle = '#1d2029'; c.fill(); }
    // Masa altı etek (apron)
    const ay = TY - 0.1, ins = 0.06;
    for (const face of [
      [[-HW + ins, ay, HL - ins], [HW - ins, ay, HL - ins], [HW - ins, TY - 0.025, HL - ins], [-HW + ins, TY - 0.025, HL - ins]],
    ]) { if (this.path(c, face)) { c.fillStyle = '#0a1c3a'; c.fill(); } }
    // Masa plakasının yan yüzleri (kameraya bakanlar)
    const t0 = TY - 0.028;
    const faces = [
      { n: [0, 0, 1], p: [[-HW, t0, HL], [HW, t0, HL], [HW, TY, HL], [-HW, TY, HL]] },
      { n: [1, 0, 0], p: [[HW, t0, HL], [HW, t0, -HL], [HW, TY, -HL], [HW, TY, HL]] },
      { n: [-1, 0, 0], p: [[-HW, t0, -HL], [-HW, t0, HL], [-HW, TY, HL], [-HW, TY, -HL]] },
    ];
    for (const fc of faces) {
      const p0 = fc.p[0];
      const vx = this.eye.x - p0[0], vy = this.eye.y - p0[1], vz = this.eye.z - p0[2];
      if (vx * fc.n[0] + vy * fc.n[1] + vz * fc.n[2] <= 0) continue;
      if (this.path(c, fc.p)) { c.fillStyle = '#0c2b57'; c.fill(); }
    }
    // Üst yüzey
    if (this.path(c, [[-HW, TY, -HL], [HW, TY, -HL], [HW, TY, HL], [-HW, TY, HL]])) {
      const pf = this.proj(0, TY, -HL), pn = this.proj(0, TY, HL);
      const gt = c.createLinearGradient(0, pf.y, 0, pn.y);
      gt.addColorStop(0, '#0f3a78'); gt.addColorStop(0.55, '#1752a3'); gt.addColorStop(1, '#1a5cb6');
      c.fillStyle = gt; c.fill();
      // spot ışığı yansıması
      c.save(); c.clip();
      const pc = this.proj(0, TY, -0.2), pr = this.proj(HW * 1.3, TY, -0.2);
      const rr = Math.abs(pr.x - pc.x);
      c.translate(pc.x, pc.y); c.scale(1, 0.55);
      const gs = c.createRadialGradient(0, 0, 0, 0, 0, rr);
      gs.addColorStop(0, 'rgba(200,230,255,0.28)'); gs.addColorStop(0.5, 'rgba(160,200,255,0.10)'); gs.addColorStop(1, 'rgba(160,200,255,0)');
      c.fillStyle = gs; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // Beyaz çizgiler (gerçek perspektif genişlikli şeritler)
    const lw = 0.02;
    c.fillStyle = '#f4f7ff';
    const strips = [
      [[-HW, -HL], [HW, -HL + lw]], [[-HW, HL - lw], [HW, HL]],
      [[-HW, -HL], [-HW + lw, HL]], [[HW - lw, -HL], [HW, HL]],
      [[-0.0015, -HL], [0.0015, HL]],
    ];
    for (const [[x0, z0], [x1, z1]] of strips) {
      if (this.path(c, [[x0, TY + 0.0005, z0], [x1, TY + 0.0005, z0], [x1, TY + 0.0005, z1], [x0, TY + 0.0005, z1]])) c.fill();
    }
    // orta çizgi en az 1 px görünsün
    c.strokeStyle = 'rgba(240,245,255,0.75)'; c.lineWidth = 1;
    c.beginPath(); this.line(c, [0, TY, -HL], [0, TY, HL]); c.stroke();
    // ön kenar parlaması
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.2;
    c.beginPath(); this.line(c, [-HW, TY, HL], [HW, TY, HL]); c.stroke();
    // logo ön yüzde
    const pl = this.proj(0, TY - 0.014, HL);
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = `700 ${Math.max(5, pl.s * 0.018)}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('PİNPON PRO', pl.x, pl.y);
    c.restore();
  }

  buildVignette() {
    const c = this.vignette.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { w, h } = this;
    c.clearRect(0, 0, w, h);
    const g = c.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------
  //  Düzlem üzerinde 3B daire (halka / gölge / işaret)
  // ------------------------------------------------------------------
  planeCircle(ctx, x, y, z, r, n = 22) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    }
    return this.path(ctx, pts);
  }

  // ------------------------------------------------------------------
  //  Raket
  // ------------------------------------------------------------------
  paddleBasis(P) {
    const s = P.side, cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
    const n = [0, sp, -s * cp];
    let u = [0, cp, s * sp];
    // sağ = u × n
    let rv = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
    const cr = Math.cos(P.roll), sr = Math.sin(P.roll);
    const u2 = [u[0] * cr + rv[0] * sr, u[1] * cr + rv[1] * sr, u[2] * cr + rv[2] * sr];
    const r2 = [rv[0] * cr - u[0] * sr, rv[1] * cr - u[1] * sr, rv[2] * cr - u[2] * sr];
    return { n, u: u2, r: r2 };
  }
  drawPaddle(ctx, P, frontCol, backCol, alpha = 1) {
    const { n, u, r } = this.paddleBasis(P);
    const vx = this.eye.x - P.x, vy = this.eye.y - P.y, vz = this.eye.z - P.z;
    const front = vx * n[0] + vy * n[1] + vz * n[2] > 0;
    const sg = front ? -1 : 1;
    const th = 0.011;
    const A = 0.076, B = 0.081;
    const disc = (ox, oy, oz, scale = 1) => {
      const pts = [];
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const ca = Math.cos(a) * A * scale, sa = Math.sin(a) * B * scale;
        pts.push([P.x + ox + r[0] * ca + u[0] * sa, P.y + oy + r[1] * ca + u[1] * sa, P.z + oz + r[2] * ca + u[2] * sa]);
      }
      return pts;
    };
    ctx.save();
    ctx.globalAlpha = alpha;
    // sap
    const hb = [P.x - u[0] * 0.07, P.y - u[1] * 0.07, P.z - u[2] * 0.07];
    const he = [P.x - u[0] * 0.175, P.y - u[1] * 0.175, P.z - u[2] * 0.175];
    const hw = 0.016;
    const hp = [
      [hb[0] - r[0] * hw, hb[1] - r[1] * hw, hb[2] - r[2] * hw],
      [hb[0] + r[0] * hw, hb[1] + r[1] * hw, hb[2] + r[2] * hw],
      [he[0] + r[0] * hw * 1.1, he[1] + r[1] * hw * 1.1, he[2] + r[2] * hw * 1.1],
      [he[0] - r[0] * hw * 1.1, he[1] - r[1] * hw * 1.1, he[2] - r[2] * hw * 1.1],
    ];
    if (this.path(ctx, hp)) {
      const a = this.proj(...hp[0]), b = this.proj(...hp[1]);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, '#7a4a22'); g.addColorStop(0.5, '#d9a066'); g.addColorStop(1, '#6b3d1a');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // kenar (ahşap)
    if (this.path(ctx, disc(n[0] * th * sg, n[1] * th * sg, n[2] * th * sg, 1.0))) {
      ctx.fillStyle = '#c08a52'; ctx.fill();
    }
    if (this.path(ctx, disc(n[0] * th * sg * 0.5, n[1] * th * sg * 0.5, n[2] * th * sg * 0.5, 1.0))) {
      ctx.fillStyle = '#8a5a2c'; ctx.fill();
    }
    // yüz
    if (this.path(ctx, disc(0, 0, 0, 1))) {
      const c = this.proj(P.x, P.y, P.z);
      const rad = c.s * 0.09;
      const g = ctx.createRadialGradient(c.x - rad * 0.4, c.y - rad * 0.5, rad * 0.1, c.x, c.y, rad * 1.3);
      const col = front ? frontCol : backCol;
      g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      // parlama
      ctx.save(); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const g2 = ctx.createLinearGradient(c.x - rad, c.y - rad, c.x + rad, c.y + rad);
      g2.addColorStop(0, 'rgba(255,255,255,0.16)'); g2.addColorStop(0.45, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = g2; ctx.fillRect(c.x - rad * 2, c.y - rad * 2, rad * 4, rad * 4);
      ctx.restore();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  //  Yapay zeka robotu
  // ------------------------------------------------------------------
  drawRobot(ctx, G) {
    const rb = G.robot, ap = G.ap;
    const t = this.time;
    const x = rb.x, y = rb.y + Math.sin(t * 2.2) * 0.03, z = rb.z;
    const p = this.proj(x, y, z);
    const R = p.s * 0.17;
    const col = rb.color;
    // enerji kolu (robot -> raket)
    const hp = this.proj(ap.x, ap.y - 0.12, ap.z);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1.5, R * 0.12);
    ctx.beginPath();
    ctx.moveTo(p.x + R * 0.7 * Math.sign(hp.x - p.x || 1), p.y + R * 0.4);
    ctx.quadraticCurveTo((p.x + hp.x) / 2, p.y + R * 2.2, hp.x, hp.y);
    ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(0.8, R * 0.04); ctx.strokeStyle = '#fff';
    ctx.setLineDash([R * 0.15, R * 0.25]); ctx.lineDashOffset = -t * 40;
    ctx.stroke();
    ctx.setLineDash([]);
    // itici alev
    const gth = ctx.createRadialGradient(p.x, p.y + R * 1.1, 0, p.x, p.y + R * 1.1, R * 1.2);
    gth.addColorStop(0, col); gth.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5 + Math.sin(t * 30) * 0.12;
    ctx.fillStyle = gth;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + R * 1.2, R * 0.5, R * 1.0, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // gölge hale
    ctx.save();
    // kulaklar
    ctx.fillStyle = '#3a4357';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(p.x + s * R * 1.0, p.y, R * 0.2, R * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(p.x + s * R * 1.05, p.y, R * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#3a4357';
    }
    // anten
    ctx.strokeStyle = '#8a93a8'; ctx.lineWidth = Math.max(1, R * 0.06);
    ctx.beginPath(); ctx.moveTo(p.x, p.y - R * 0.9); ctx.lineTo(p.x + R * 0.15, p.y - R * 1.45); ctx.stroke();
    const blink = (Math.sin(t * 5) > 0) ? 1 : 0.35;
    ctx.fillStyle = col; ctx.globalAlpha = blink; ctx.shadowColor = col; ctx.shadowBlur = R * 0.6;
    ctx.beginPath(); ctx.arc(p.x + R * 0.15, p.y - R * 1.5, R * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    // kafa (metalik küre)
    const gh = ctx.createRadialGradient(p.x - R * 0.35, p.y - R * 0.45, R * 0.1, p.x, p.y, R * 1.05);
    gh.addColorStop(0, '#f2f5fb'); gh.addColorStop(0.35, '#aab3c6'); gh.addColorStop(0.8, '#4b546a'); gh.addColorStop(1, '#262b38');
    ctx.fillStyle = gh;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
    // vizör
    const vw = R * 1.5, vh = R * 0.72;
    ctx.fillStyle = '#05070d';
    roundRect(ctx, p.x - vw / 2, p.y - vh / 2 + R * 0.05, vw, vh, vh * 0.45); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
    // gözler topu takip eder
    const bp = this.proj(G.ball.x, G.ball.y, G.ball.z);
    let lx = bp.x - p.x, ly = bp.y - p.y; const ll = Math.hypot(lx, ly) || 1;
    lx = lx / ll * R * 0.12; ly = ly / ll * R * 0.08;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = R * 0.5;
    ctx.lineWidth = Math.max(1.2, R * 0.1); ctx.lineCap = 'round';
    const ey = p.y + R * 0.05;
    for (const s of [-1, 1]) {
      const ex = p.x + s * R * 0.33 + lx, eyy = ey + ly;
      ctx.beginPath();
      if (rb.mood === 'happy') {
        ctx.arc(ex, eyy + R * 0.06, R * 0.14, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      } else if (rb.mood === 'sad') {
        ctx.moveTo(ex - R * 0.14, eyy - s * R * 0.06); ctx.lineTo(ex + R * 0.14, eyy + s * R * 0.06); ctx.stroke();
      } else if (rb.mood === 'focus') {
        roundRect(ctx, ex - R * 0.15, eyy - R * 0.04, R * 0.3, R * 0.08, R * 0.04); ctx.fill();
      } else {
        const blinkE = (t % 3.7) < 0.12 ? 0.15 : 1;
        ctx.ellipse(ex, eyy, R * 0.12, R * 0.15 * blinkE, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    // parlama
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x - R * 0.4, p.y - R * 0.55, R * 0.25, R * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------
  //  File (dalgalanma animasyonlu)
  // ------------------------------------------------------------------
  drawNet(ctx, G) {
    const nw = G.netWave;
    const NH = TABLE.NET_H, X = TABLE.NET_HALF;
    const disp = (x, y) => {
      if (nw.a <= 0.0002) return 0;
      const fy = Math.sin(Math.PI * clamp((y - TY) / NH, 0, 1) * 0.9 + 0.15);
      return nw.a * Math.exp(-Math.abs(x - nw.x) * 3.2) * Math.sin(nw.t * 38) * fy * nw.dir;
    };
    // gölge zarı
    if (this.path(ctx, [[-X, TY, 0], [X, TY, 0], [X, TY + NH, 0], [-X, TY + NH, 0]])) {
      ctx.fillStyle = 'rgba(10,14,25,0.28)'; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(25,30,45,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 0.03;
    for (let x = -X; x <= X + 1e-6; x += step) {
      let prev = null;
      for (let k = 0; k <= 4; k++) {
        const y = TY + (k / 4) * NH;
        const pt = [x, y, disp(x, y)];
        if (prev) this.line(ctx, prev, pt);
        prev = pt;
      }
    }
    for (let k = 1; k < 8; k++) {
      const y = TY + (k / 8) * NH;
      let prev = null;
      for (let x = -X; x <= X + 1e-6; x += 0.12) {
        const pt = [x, y, disp(x, y)];
        if (prev) this.line(ctx, prev, pt);
        prev = pt;
      }
    }
    ctx.stroke();
    // üst beyaz bant
    const bandPts = [];
    for (let x = -X; x <= X + 1e-6; x += 0.1) bandPts.push([x, TY + NH, disp(x, TY + NH)]);
    const bandPts2 = [];
    for (let x = X; x >= -X - 1e-6; x -= 0.1) bandPts2.push([x, TY + NH - 0.016, disp(x, TY + NH - 0.016)]);
    if (this.path(ctx, bandPts.concat(bandPts2))) { ctx.fillStyle = '#f5f7ff'; ctx.fill(); }
    // direkler
    for (const s of [-1, 1]) {
      const a = this.proj(s * X, TY, 0), b = this.proj(s * X, TY + NH + 0.01, 0);
      ctx.strokeStyle = '#1a1d26'; ctx.lineWidth = Math.max(2, a.s * 0.02); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = Math.max(1, a.s * 0.006);
      ctx.beginPath(); ctx.moveTo(a.x - a.s * 0.004, a.y); ctx.lineTo(b.x - a.s * 0.004, b.y); ctx.stroke();
      // kıskaç
      const c = this.proj(s * (X - 0.02), TY - 0.01, 0);
      ctx.fillStyle = '#20232c';
      ctx.fillRect(c.x - c.s * 0.04, c.y - c.s * 0.012, c.s * 0.08, c.s * 0.03);
    }
  }

  // ------------------------------------------------------------------
  //  Top
  // ------------------------------------------------------------------
  drawBall(ctx, G) {
    const b = G.ball;
    const p = this.proj(b.x, b.y, b.z);
    if (p.z < NEAR) return;
    const r = Math.max(2.2, p.s * BALL_R);
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    // iz (trail)
    const tr = G.trail;
    if (tr.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const hot = clamp((sp - 9) / 10, 0, 1);
      let prev = this.proj(tr[0].x, tr[0].y, tr[0].z);
      for (let i = 1; i < tr.length; i++) {
        const q = this.proj(tr[i].x, tr[i].y, tr[i].z);
        const k = i / tr.length;
        const rr = Math.round(lerp(140, 255, hot)), gg = Math.round(lerp(220, 150, hot)), bb = Math.round(lerp(255, 40, hot));
        ctx.strokeStyle = `rgba(${rr},${gg},${bb},${0.5 * k * k})`;
        ctx.lineWidth = Math.max(1, r * 1.9 * k);
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        prev = q;
      }
      ctx.restore();
    }
    // parıltı
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3.2);
    gg.addColorStop(0, 'rgba(255,240,210,0.45)'); gg.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // küre
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fff6e8'); g.addColorStop(1, '#d9c7a6');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    // spin dikişi (dönme ekseni ve hızına göre)
    if (r > 3.5) {
      ctx.save();
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();
      const w = G.spinVis;
      ctx.strokeStyle = 'rgba(220,120,40,0.75)'; ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.translate(p.x, p.y); ctx.rotate(w.axisAngle);
      const ph = Math.cos(w.phase);
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(ph) * r * 0.85 + 0.5, r * 0.95, 0, -Math.PI / 2, Math.PI / 2, ph < 0); ctx.stroke();
      ctx.restore();
    }
  }

  drawBallShadow(ctx, G, onTable) {
    const b = G.ball;
    const over = Math.abs(b.x) <= HW && Math.abs(b.z) <= HL && b.y >= TY;
    if (over !== onTable) return;
    const sy = over ? TY + 0.001 : 0.001;
    const hgt = Math.max(0, b.y - sy - BALL_R);
    const rr = BALL_R * (1 + hgt * 1.6);
    const a = 0.55 / (1 + hgt * 5);
    if (this.planeCircle(ctx, b.x + hgt * 0.05, sy, b.z + hgt * 0.08, rr, 14)) {
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fill();
    }
  }

  // ------------------------------------------------------------------
  //  Kare çizimi
  // ------------------------------------------------------------------
  render(G, dt) {
    this.time += dt;
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sarsıntı
    let shx = 0, shy = 0;
    if (G.shake > 0.001) {
      shx = (Math.random() - 0.5) * G.shake * 18;
      shy = (Math.random() - 0.5) * G.shake * 18;
    }
    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, w, h);
    ctx.translate(shx, shy);
    ctx.drawImage(this.bg, 0, 0, w, h);

    // seyirci flaşları
    if (G.crowdExcite > 0 && this.heads.length) {
      const n = Math.random() < G.crowdExcite * 0.9 ? 2 : 0;
      for (let i = 0; i < n; i++) {
        const hd = this.heads[(Math.random() * this.heads.length) | 0];
        this.flashes.push({ x: hd.x, y: hd.y, s: hd.s, life: 0.18 });
      }
    }
    if (this.flashes.length) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = this.flashes.length - 1; i >= 0; i--) {
        const f = this.flashes[i];
        f.life -= dt;
        if (f.life <= 0) { this.flashes.splice(i, 1); continue; }
        const rr = Math.max(3, f.s * 0.5) * (f.life / 0.18 + 0.3);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(200,220,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    const b = G.ball;
    const ballVisible = G.ballVisible;
    if (ballVisible) this.drawBallShadow(ctx, G, false);
    const ballUnder = ballVisible && b.y < TY && (Math.abs(b.z) < HL + 0.05 && Math.abs(b.x) < HW + 0.05 || b.z < -HL);
    if (ballUnder) this.drawBall(ctx, G);
    ctx.drawImage(this.tableLayer, 0, 0, w, h);

    // masa üstü efektler: izler, halkalar, iniş işareti
    for (const m of G.fx.marks) {
      if (this.planeCircle(ctx, m.x, TY + 0.001, m.z, 0.018 + (1 - m.life / m.max) * 0.01, 12)) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (m.life / m.max)})`; ctx.fill();
      }
    }
    if (G.marker && G.marker.a > 0.01) {
      const mk = G.marker;
      const pulse = 0.05 + Math.sin(this.time * 10) * 0.008;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (this.planeCircle(ctx, mk.x, TY + 0.002, mk.z, pulse, 24)) {
        ctx.strokeStyle = `rgba(90,255,200,${0.7 * mk.a})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = `rgba(90,255,200,${0.12 * mk.a})`; ctx.fill();
      }
      ctx.restore();
    }
    if (ballVisible) this.drawBallShadow(ctx, G, true);
    // halkalar (masa düzleminde)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const rg of G.fx.rings) {
      const k = rg.life / rg.max;
      if (this.planeCircle(ctx, rg.x, rg.y, rg.z, rg.r0 + (1 - k) * rg.r1, 26)) {
        ctx.strokeStyle = rg.color.replace('A', (k * 0.9).toFixed(3));
        ctx.lineWidth = 1 + 3 * k; ctx.stroke();
      }
    }
    ctx.restore();

    // derinliğe göre sıralanan nesneler
    const items = [];
    items.push({ d: this.depth(G.robot.x, G.robot.y, G.robot.z), f: () => this.drawRobot(ctx, G) });
    items.push({ d: this.depth(G.ap.x, G.ap.y, G.ap.z), f: () => this.drawPaddle(ctx, G.ap, ['#4aa3ff', '#0b3d91'], ['#3a3f4c', '#0b0d12'], 1) });
    const nb = ballVisible ? b : { x: 0, y: TY + 0.05 };
    items.push({ d: this.depth(clamp(nb.x, -0.9, 0.9), TY + 0.07, 0), f: () => this.drawNet(ctx, G) });
    if (ballVisible && !ballUnder) items.push({ d: this.depth(b.x, b.y, b.z), f: () => this.drawBall(ctx, G) });
    items.push({ d: this.depth(G.pp.x, G.pp.y, G.pp.z) - 0.02, f: () => this.drawPaddle(ctx, G.pp, ['#3b3b3b', '#0a0a0a'], ['#ff4d5e', '#9c0f1f'], 0.93) });
    items.sort((a, c) => c.d - a.d);
    for (const it of items) it.f();

    // parçacıklar
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tmp = {};
    for (const pt of G.fx.particles) {
      this.proj(pt.x, pt.y, pt.z, tmp);
      if (tmp.z < NEAR) continue;
      const k = pt.life / pt.max;
      const rr = Math.max(0.8, tmp.s * pt.size * (0.4 + 0.6 * k));
      if (pt.kind === 'confetti') {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.translate(tmp.x, tmp.y); ctx.rotate(pt.rot);
        ctx.fillStyle = pt.color;
        ctx.fillRect(-rr, -rr * 0.5 * Math.abs(Math.cos(pt.rot * 3)), rr * 2, rr * Math.abs(Math.cos(pt.rot * 3)) + 0.5);
        ctx.restore();
      } else {
        ctx.globalAlpha = k;
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(tmp.x, tmp.y, rr, 0, Math.PI * 2); ctx.fill();
        if (pt.kind === 'spark' && pt.px !== undefined) {
          const q = this.proj(pt.px, pt.py, pt.pz);
          ctx.strokeStyle = pt.color; ctx.lineWidth = rr; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(tmp.x, tmp.y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    // havadaki toz zerreleri (ışık huzmesinde)
    for (const m of this.motes) {
      const mx = m.x + Math.sin(this.time * 0.2 * m.s + m.p) * 0.3;
      const my = m.y + Math.sin(this.time * 0.13 + m.p) * 0.2;
      this.proj(mx, my, m.z, tmp);
      if (tmp.z < NEAR) continue;
      ctx.globalAlpha = 0.15 + 0.12 * Math.sin(this.time * m.s + m.p);
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath(); ctx.arc(tmp.x, tmp.y, Math.max(0.6, tmp.s * 0.006), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // açılan yazılar
    for (const pu of G.fx.popups) {
      this.proj(pu.x, pu.y, pu.z, tmp);
      const k = pu.life / pu.max;
      const sc = 1 + (1 - k) * 0.25 + (k > 0.85 ? (k - 0.85) * 3 : 0);
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 2.5);
      const half = ctx.measureText ? pu.size * pu.text.length * 0.3 : 0;
      ctx.translate(clamp(tmp.x, half + 8, this.w - half - 8), clamp(tmp.y - (1 - k) * 40, this.hudTop + 10, this.h - 30));
      ctx.scale(sc, sc);
      ctx.font = `900 ${pu.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(pu.text, 0, 0);
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, 0, 0);
      ctx.restore();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.vignette, 0, 0, w, h);
    // flaş (sayı / smaç)
    if (G.flash.a > 0.003) {
      ctx.fillStyle = G.flash.color.replace('A', G.flash.a.toFixed(3));
      ctx.fillRect(0, 0, w, h);
    }
    // ağır çekim çerçevesi
    if (G.slowmo < 0.95) {
      const k = 1 - G.slowmo;
      ctx.fillStyle = `rgba(0,0,0,${0.5 * k})`;
      const bh = h * 0.06 * k;
      ctx.fillRect(0, 0, w, bh); ctx.fillRect(0, h - bh, w, bh);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
