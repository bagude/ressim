// The field as a map, painted into a canvas that becomes the ground texture of the 3D field view.
// Two looks, both from the same illustrative terrain:
//   aerial: soil, mesquite scrub, dry washes and hill shading, as a satellite image would show semi-arid ranch land;
//   topo:   a USGS-style topographic quadrangle: brown contours (10 ft, index every 50 ft), blue intermittent streams,
//           red section lines, double-line unimproved roads.
// On top of either: section-line roads, lease roads, pads, and every well as a well map draws it (surface location,
// path to the heel, lateral to the bottom-hole location).
// The terrain, washes and elevations are illustrative, generated from the career id; they are not a real place.
// World units: 1 = 100 ft. North is -z, drawn at the top of the canvas.

const TAU = Math.PI * 2;

export function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function noise2(r) {   // smooth value noise on a wrapped 256 lattice
  const N = 256, v = new Float32Array(N * N); for (let i = 0; i < v.length; i++) v[i] = r();
  const at = (i, j) => v[((j & 255) << 8) | (i & 255)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(n, x, y, oct = 5) { let s = 0, a = 0.5, f = 1, w = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); w += a; a *= 0.5; f *= 2.03; } return s / w; }

// dry washes: sinuous paths that wander roughly downhill (west to east here), with a tributary or two
function washes(r, n, gw, gd) {
  const out = [];
  const one = (x, z, heading, len, step = 1.6) => {
    const pts = [[x, z]];
    for (let i = 0; i < len; i++) {
      heading += (n(x * 0.02 + 31, z * 0.02 + 17) - 0.5) * 0.9 + (r() - 0.5) * 0.25;
      heading = Math.max(-1.1, Math.min(1.1, heading));
      x += Math.cos(heading) * step; z += Math.sin(heading) * step;
      pts.push([x, z]);
      if (Math.abs(x) > gw / 2 + 4 || Math.abs(z) > gd / 2 + 4) break;
    }
    return pts;
  };
  for (let k = 0; k < 2; k++) {
    const main = one(-gw / 2 - 2, (r() - 0.5) * gd * 0.7, (r() - 0.5) * 0.6, 600);
    out.push({ pts: main, w: 1 });
    for (let t = 0; t < 2; t++) {   // tributaries join from the side
      const j = main[Math.floor(main.length * (0.25 + 0.5 * r()))], side = r() < 0.5 ? -1 : 1;
      const trib = one(j[0] - 25 * r() - 10, j[1] + side * (14 + 10 * r()), -side * 0.7, 30, 1.4);
      trib.push(j); out.push({ pts: trib, w: 0.6 });
    }
  }
  return out;
}
function distToPolys(x, z, polys) {
  let best = Infinity;
  for (const p of polys) {
    const P = p.pts;
    for (let i = 1; i < P.length; i++) {
      const [ax, az] = P[i - 1], [bx, bz] = P[i];
      if (Math.abs(x - ax) > 12 && Math.abs(x - bx) > 12) continue;
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d < best) best = d;
    }
  }
  return best;
}

// The terrain and its base map (no roads, pads or wells). Expensive-ish (~0.3 s); the caller caches it per career and style.
export function buildBase({ seed, gw, gd, Wc, style }) {
  const Hc = Math.round(Wc * gd / gw), k = Wc / gw;
  const r = rng(seed), n = noise2(r), n2 = noise2(r);
  const W = washes(r, n, gw, gd);
  // height grid, one cell = 1.5 units (150 ft)
  const cell = 1.5, gx = Math.ceil(gw / cell) + 1, gz = Math.ceil(gd / cell) + 1;
  const H = new Float32Array(gx * gz), D = new Float32Array(gx * gz);
  const base = 2900 + Math.floor(r() * 300);
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
    const x = -gw / 2 + i * cell, z = -gd / 2 + j * cell;
    const d = distToPolys(x, z, W);
    D[j * gx + i] = d;
    H[j * gx + i] = base + 70 * (fbm(n2, x / 110 + 5, z / 110 + 9, 4) - 0.5) - 0.08 * x   // gentle regional dip to the east
      + 8 * (fbm(n2, x / 22, z / 22, 3) - 0.5) - 16 * Math.exp(-(((d / 5)) ** 2)) - 5 * Math.exp(-(((d / 14)) ** 2));
  }
  const hAt = (i, j) => H[Math.min(gz - 1, Math.max(0, j)) * gx + Math.min(gx - 1, Math.max(0, i))];
  const cv = document.createElement('canvas'); cv.width = Wc; cv.height = Hc;
  const c = cv.getContext('2d');
  const px = (x) => (x + gw / 2) * k, pz = (z) => (z + gd / 2) * k;
  const small = (fn) => {   // paint a per-cell image and scale it up smoothly
    const s = document.createElement('canvas'); s.width = gx; s.height = gz;
    const sc = s.getContext('2d'), im = sc.createImageData(gx, gz);
    for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) { const o = (j * gx + i) * 4, [R, G, B, A] = fn(i, j); im.data[o] = R; im.data[o + 1] = G; im.data[o + 2] = B; im.data[o + 3] = A; }
    sc.putImageData(im, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(s, -k * cell / 2, -k * cell / 2, gx * cell * k, gz * cell * k);
  };
  const strokePoly = (P) => { c.beginPath(); P.forEach(([x, z], i) => (i ? c.lineTo(px(x), pz(z)) : c.moveTo(px(x), pz(z)))); c.stroke(); };

  if (style === 'aerial') {
    // soil: caliche-pale to reddish loam, greener in the washes
    small((i, j) => {
      const x = -gw / 2 + i * cell, z = -gd / 2 + j * cell, t = fbm(n, x / 40, z / 40, 4), u = fbm(n2, x / 9 + 50, z / 9, 3);
      const wet = Math.exp(-(((D[j * gx + i] / 4)) ** 2));
      const R = 176 + 30 * (t - 0.5) * 2 + 10 * (u - 0.5) - 40 * wet, G = 158 + 22 * (t - 0.5) * 2 + 8 * (u - 0.5) - 22 * wet, B = 122 + 10 * (u - 0.5) - 30 * wet;
      return [R, G, B, 255];
    });
    // mesquite and creosote: dark dots, denser along the washes and in the moister patches
    const rr = rng(seed ^ 0x9e3779b9), N = Math.round(Wc * Hc / 70);
    for (const [col, frac, rmin, rmax] of [['rgba(74,78,52,0.75)', 0.55, 0.7, 1.7], ['rgba(98,98,66,0.6)', 0.45, 0.6, 1.3]]) {
      c.fillStyle = col; c.beginPath();
      for (let q = 0; q < N * frac; q++) {
        const X = rr() * Wc, Z = rr() * Hc, x = X / k - gw / 2, z = Z / k - gd / 2;
        const i = Math.round((x + gw / 2) / cell), j = Math.round((z + gd / 2) / cell);
        const d = D[Math.min(gz - 1, j) * gx + Math.min(gx - 1, i)];
        const p = 0.18 + 0.55 * Math.max(0, fbm(n, x / 14 + 3, z / 14 + 7, 3) - 0.38) + 0.75 * Math.exp(-(((d / 2.5)) ** 2));
        if (rr() > p) continue;
        const rad = (rmin + (rmax - rmin) * rr()) * Math.max(1, Wc / 4096);
        c.moveTo(X + rad, Z); c.arc(X, Z, rad, 0, TAU);
      }
      c.fill();
    }
    // the washes themselves: a sandy bed inside a band of denser brush
    c.lineCap = c.lineJoin = 'round';
    for (const w of W) { c.strokeStyle = 'rgba(70,72,48,0.35)'; c.lineWidth = 9 * w.w * k / 11; strokePoly(w.pts); }
    for (const w of W) { c.strokeStyle = 'rgba(214,198,164,0.95)'; c.lineWidth = 2.4 * w.w * k / 11; strokePoly(w.pts); }
    // ranch two-tracks
    const rt = rng(seed ^ 0x1234567);
    c.strokeStyle = 'rgba(214,202,176,0.65)'; c.lineWidth = 1.3 * k / 11;
    for (let t = 0; t < 5; t++) {
      let x = (rt() - 0.5) * gw, z = (rt() - 0.5) * gd, h = rt() * TAU; const P = [[x, z]];
      for (let s = 0; s < 70; s++) { h += (rt() - 0.5) * 0.35; x += Math.cos(h) * 1.5; z += Math.sin(h) * 1.5; P.push([x, z]); }
      strokePoly(P);
    }
    // hill shading, light from the north-west, relief exaggerated so a few tens of feet still read
    const ex = 6, Lx = -0.5, Ly = 0.7071, Lz = -0.5;
    const shade = document.createElement('canvas'); shade.width = gx; shade.height = gz;
    const sc = shade.getContext('2d'), im = sc.createImageData(gx, gz);
    for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
      const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cell * 100) * ex, dz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cell * 100) * ex;
      const nl = Math.hypot(dx, 1, dz), dot = (-dx * Lx + Ly - dz * Lz) / nl;
      const g = Math.max(0, Math.min(255, 128 + (dot - 0.7071) * 900)), o = (j * gx + i) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = g; im.data[o + 3] = 255;
    }
    sc.putImageData(im, 0, 0);
    c.globalCompositeOperation = 'soft-light';
    c.drawImage(shade, -k * cell / 2, -k * cell / 2, gx * cell * k, gz * cell * k);
    c.globalCompositeOperation = 'source-over';
  } else {
    // paper, with the faint green tint a quad gives brush-covered ground
    c.fillStyle = '#f4f0e4'; c.fillRect(0, 0, Wc, Hc);
    small((i, j) => {
      const x = -gw / 2 + i * cell, z = -gd / 2 + j * cell, t = fbm(n, x / 14 + 3, z / 14 + 7, 3) - 0.5 + 0.4 * Math.exp(-(((D[j * gx + i] / 3)) ** 2));
      return [196, 222, 170, t > 0.12 ? 150 : 0];
    });
    // contours by marching squares on the height grid
    const lo = Math.ceil(Math.min(...H) / 10) * 10, hi = Math.floor(Math.max(...H) / 10) * 10;
    const labels = [];
    for (let L = lo; L <= hi; L += 10) {
      const index = L % 50 === 0;
      c.strokeStyle = index ? 'rgba(160,98,40,0.95)' : 'rgba(176,118,60,0.7)';
      c.lineWidth = (index ? 4.6 : 2.2) * Math.max(1, Wc / 4096);
      c.beginPath();
      const segs = [];
      for (let j = 0; j < gz - 1; j++) for (let i = 0; i < gx - 1; i++) {
        const a = H[j * gx + i], b = H[j * gx + i + 1], d = H[(j + 1) * gx + i], e = H[(j + 1) * gx + i + 1];
        const pts = [];
        const edge = (h0, h1, x0, z0, x1, z1) => { if ((h0 < L) !== (h1 < L)) { const t = (L - h0) / (h1 - h0); pts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]); } };
        edge(a, b, i, j, i + 1, j); edge(b, e, i + 1, j, i + 1, j + 1); edge(e, d, i + 1, j + 1, i, j + 1); edge(d, a, i, j + 1, i, j);
        for (let q = 0; q + 1 < pts.length; q += 2) {
          const [x0, z0] = pts[q], [x1, z1] = pts[q + 1];
          const X0 = (x0 * cell) * k, Z0 = (z0 * cell) * k, X1 = (x1 * cell) * k, Z1 = (z1 * cell) * k;
          c.moveTo(X0, Z0); c.lineTo(X1, Z1);
          if (index) segs.push([X0, Z0, X1, Z1]);
        }
      }
      c.stroke();
      if (index && segs.length > 40) for (let q = 0; q < 3; q++) labels.push([L, segs[Math.floor(segs.length * (0.2 + 0.3 * q))]]);
    }
    // streams: intermittent blue (dash, dot, dot)
    c.setLineDash([30, 10, 6, 10, 6, 10].map(v => v * Math.max(1, Wc / 4096)));
    for (const w of W) { c.strokeStyle = '#3f78bf'; c.lineWidth = (w.w > 0.8 ? 5 : 3.6) * Math.max(1, Wc / 4096); strokePoly(w.pts); }
    c.setLineDash([]);
    // index contour elevations, upright, on a paper knockout
    const fs = Math.round(30 * Math.max(1, Wc / 4096));
    c.font = `600 ${fs}px Archivo, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [L, [x0, z0, x1, z1]] of labels) {
      let ang = Math.atan2(z1 - z0, x1 - x0); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const txt = String(L), w = c.measureText(txt).width + 6;
      c.save(); c.translate((x0 + x1) / 2, (z0 + z1) / 2); c.rotate(ang);
      c.fillStyle = '#f4f0e4'; c.fillRect(-w / 2, -fs * 0.6, w, fs * 1.2); c.fillStyle = 'rgb(150,90,36)'; c.fillText(txt, 0, 1);
      c.restore();
    }
  }
  return { canvas: cv, k, minH: Math.min(...H), maxH: Math.max(...H), base };
}

// Roads, pads, wells and section names on top of a base. d = {gw, gd, k, grid {x0, z0, SEC, cols, rows, sections[]}, pads[], wells[], focus}
export function drawOverlay(ctx, base, d, style) {
  const { gw, gd, k } = d, G = d.grid, s = 2.4 * Math.max(1, ctx.canvas.width / 4096);   // symbols drawn heavy, as maps do, so they read at whole-field zoom
  const px = (x) => (x + gw / 2) * k, pz = (z) => (z + gd / 2) * k;
  ctx.drawImage(base.canvas, 0, 0);
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const line = (x0, z0, x1, z1) => { ctx.beginPath(); ctx.moveTo(px(x0), pz(z0)); ctx.lineTo(px(x1), pz(z1)); ctx.stroke(); };
  const xs = [...Array(G.cols + 1)].map((_, c) => G.x0 + c * G.SEC), zs = [...Array(G.rows + 1)].map((_, r) => G.z0 + r * G.SEC);
  const X0 = G.x0, X1 = G.x0 + G.cols * G.SEC, Z0 = G.z0, Z1 = G.z0 + G.rows * G.SEC;
  // section-line county roads (they run on past the field) and, on the quad, the red survey lines
  const roads = () => { for (const x of xs) line(x, -gd / 2, x, gd / 2); for (const z of zs) line(-gw / 2, z, gw / 2, z); };
  if (style === 'aerial') {
    ctx.strokeStyle = 'rgba(120,108,84,0.6)'; ctx.lineWidth = 6.5 * s; roads();
    ctx.strokeStyle = '#ddd2ba'; ctx.lineWidth = 4.2 * s; roads();
  } else {
    ctx.strokeStyle = 'rgba(200,70,58,0.85)'; ctx.lineWidth = 1.6 * s;
    for (const x of xs) line(x, Z0, x, Z1); for (const z of zs) line(X0, z, X1, z);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 5.5 * s; roads();
    ctx.strokeStyle = '#f4f0e4'; ctx.lineWidth = 3.2 * s; roads();
  }
  // pads that exist: the gravel pad and its lease road to the section-line road on its west side
  for (const p of d.pads) {
    if (p.state === 'planned') {
      ctx.setLineDash([8 * s, 6 * s]); ctx.strokeStyle = style === 'aerial' ? 'rgba(240,165,58,0.95)' : '#7a4a12'; ctx.lineWidth = 2 * s;
      ctx.strokeRect(px(p.x - 2.3), pz(p.z - 1.8), 4.6 * k, 3.6 * k); ctx.setLineDash([]);
      continue;
    }
    const roadZ = p.roadZ ?? p.z + 5;   // the lease road runs south from the pad to the section-line road
    if (style === 'aerial') {
      ctx.strokeStyle = '#d8ccb2'; ctx.lineWidth = 3.2 * s; line(p.x, p.z + 1.8, p.x, roadZ);
      ctx.fillStyle = 'rgba(110,100,80,0.55)'; ctx.fillRect(px(p.x - 2.3) - 2 * s, pz(p.z - 1.8) - 2 * s, 4.6 * k + 4 * s, 3.6 * k + 4 * s);
      ctx.fillStyle = '#e4dccb'; ctx.fillRect(px(p.x - 2.3), pz(p.z - 1.8), 4.6 * k, 3.6 * k);
    } else {
      ctx.setLineDash([10 * s, 5 * s]); ctx.strokeStyle = '#222'; ctx.lineWidth = 1.6 * s; line(p.x - 0.25, p.z + 1.8, p.x - 0.25, roadZ); line(p.x + 0.25, p.z + 1.8, p.x + 0.25, roadZ); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(160,150,135,0.55)'; ctx.fillRect(px(p.x - 2.3), pz(p.z - 1.8), 4.6 * k, 3.6 * k);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2 * s; ctx.strokeRect(px(p.x - 2.3), pz(p.z - 1.8), 4.6 * k, 3.6 * k);
    }
  }
  // wells, as on a well map: surface location -> heel (thin) -> lateral to the bottom-hole location
  const COL = { you: '#c98322', pdp: '#3d8be0', planned: style === 'aerial' ? '#f2eee4' : '#4b4b4b' };
  for (const pass of ['halo', 'line']) for (const w of d.wells) {
    const col = COL[w.kind] || COL.pdp, planned = w.kind === 'planned';
    ctx.setLineDash(planned ? [9 * s, 6 * s] : []);
    if (pass === 'halo') { ctx.strokeStyle = style === 'aerial' ? 'rgba(18,22,26,0.75)' : 'rgba(244,240,228,0.9)'; ctx.lineWidth = 6 * s; }
    else { ctx.strokeStyle = col; ctx.lineWidth = (planned ? 2 : 2.8) * s; }
    ctx.beginPath(); ctx.moveTo(px(w.sx), pz(w.sz)); ctx.lineTo(px(w.hx), pz(w.hz)); ctx.lineTo(px(w.tx), pz(w.tz)); ctx.stroke();
    ctx.setLineDash([]);
    if (pass === 'line') {   // bottom-hole tick across the toe
      const dx = w.tx - w.hx, dz = w.tz - w.hz, dl = Math.hypot(dx, dz) || 1, nx = -dz / dl, nz = dx / dl;   // tick across the lateral
      ctx.lineWidth = 2.4 * s; ctx.beginPath(); ctx.moveTo(px(w.tx) - nx * 6 * s, pz(w.tz) - nz * 6 * s); ctx.lineTo(px(w.tx) + nx * 6 * s, pz(w.tz) + nz * 6 * s); ctx.stroke();
    }
  }
  for (const w of d.wells) {   // surface locations: filled = drilled, open = planned
    const planned = w.kind === 'planned', col = COL[w.kind] || COL.pdp;
    ctx.beginPath(); ctx.arc(px(w.sx), pz(w.sz), 3.4 * s, 0, TAU);
    ctx.fillStyle = planned ? (style === 'aerial' ? 'rgba(18,22,26,0.8)' : '#f4f0e4') : col; ctx.fill();
    ctx.lineWidth = 1.4 * s; ctx.strokeStyle = style === 'aerial' ? '#141a20' : '#222'; if (planned) ctx.strokeStyle = col; ctx.stroke();
  }
  // depletion: sections shaded by the oil already produced; planned pads in or next to a depleted section ringed
  if (d.layer === 'depletion') {
    const cum = d.secCum || {}, max = Math.max(1, ...Object.values(cum));
    for (const sc of G.sections) {
      const v = cum[sc.section] || 0; if (!v) continue;
      ctx.fillStyle = `rgba(232,128,111,${0.12 + 0.5 * v / max})`;
      ctx.fillRect(px(G.x0 + sc.col * G.SEC), pz(G.z0 + sc.row * G.SEC), G.SEC * k, G.SEC * k);
    }
    // the server's rule: a planned pad whose edge slot is within 1,500 ft of a producing well across the section line
    const secOf = (w) => w.id.split('-')[0], producing = d.wells.filter(w => w.kind !== 'planned');
    for (const p of d.pads.filter(p => p.state === 'planned' || p.state === 'construction')) {
      const sc = G.sections.find(s => s.section === p.section); if (!sc) continue;
      const own = d.wells.filter(w => secOf(w) === p.section); if (!own.length) continue;
      const edges = [own.reduce((a, w) => (w.hx < a.hx ? w : a)), own.reduce((a, w) => (w.hx > a.hx ? w : a))];
      let hit = null;
      for (const e of edges) for (const w of producing) {
        const ws = G.sections.find(s => s.section === secOf(w));
        if (!ws || ws.row !== sc.row || Math.abs(ws.col - sc.col) !== 1) continue;   // across a section line, same row
        const dft = Math.abs(w.hx - e.hx) * 100;
        if (dft <= 1500 && (!hit || dft < hit.d)) hit = { d: dft, e, w };
      }
      if (!hit) continue;
      ctx.strokeStyle = '#f0a53a'; ctx.lineWidth = 4 * s; ctx.setLineDash([12 * s, 8 * s]);
      ctx.strokeRect(px(G.x0 + sc.col * G.SEC) + 6 * s, pz(G.z0 + sc.row * G.SEC) + 6 * s, G.SEC * k - 12 * s, G.SEC * k - 12 * s); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px(hit.e.hx), pz((hit.e.hz + hit.e.tz) / 2)); ctx.lineTo(px(hit.w.hx), pz((hit.e.hz + hit.e.tz) / 2)); ctx.lineWidth = 3 * s; ctx.stroke();
      ctx.font = `700 ${Math.round(9 * s)}px Archivo, sans-serif`; ctx.fillStyle = '#f0a53a'; ctx.textAlign = 'center';
      const lab = `${Math.round(hit.d).toLocaleString('en-US')} ft`, lx = px((hit.e.hx + hit.w.hx) / 2), ly = pz((hit.e.hz + hit.e.tz) / 2) - 6 * s;
      ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(16,20,24,0.9)'; ctx.strokeText(lab, lx, ly); ctx.fillText(lab, lx, ly);
    }
  }
  // production bubble map: a circle at the middle of each lateral, area proportional to cumulative oil
  if (d.layer === 'production') {
    const maxCum = Math.max(1, ...d.wells.map(w => w.cum || 0)), rMax = G.SEC * k * 0.17;
    const bubbles = d.wells.filter(w => w.cum > 0).sort((a, b) => b.cum - a.cum);   // big first, so small ones stay visible
    for (const w of bubbles) {
      const cx = px((w.hx + w.tx) / 2), cz = pz((w.hz + w.tz) / 2), r = rMax * Math.sqrt(w.cum / maxCum);
      ctx.beginPath(); ctx.arc(cx, cz, r, 0, TAU);
      ctx.fillStyle = w.kind === 'you' ? 'rgba(201,131,34,0.62)' : 'rgba(61,139,224,0.55)'; ctx.fill();
      ctx.lineWidth = 1.2 * s; ctx.strokeStyle = style === 'aerial' ? 'rgba(14,18,22,0.9)' : '#222'; ctx.stroke();
    }
  }
  // section names, big and centred like a quad's section numbers
  const fs = Math.round(G.SEC * k * 0.15);
  ctx.font = `700 ${fs}px Archivo, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const sc of G.sections) {
    const cx = px(G.x0 + (sc.col + 0.5) * G.SEC), cz = pz(G.z0 + (sc.row + 0.5) * G.SEC) + G.SEC * k * 0.28;
    if (style === 'aerial') { ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(16,20,24,0.7)'; ctx.strokeText(sc.section, cx, cz); ctx.fillStyle = 'rgba(246,242,232,0.95)'; }
    else ctx.fillStyle = 'rgba(200,70,58,0.9)';
    ctx.fillText(sc.section, cx, cz);
  }
  // the focused section
  if (d.focus) {
    const sc = G.sections.find(q => q.section === d.focus);
    if (sc) { ctx.strokeStyle = '#f0a53a'; ctx.lineWidth = 5 * s; ctx.strokeRect(px(G.x0 + sc.col * G.SEC) + 3 * s, pz(G.z0 + sc.row * G.SEC) + 3 * s, G.SEC * k - 6 * s, G.SEC * k - 6 * s); }
  }
}
