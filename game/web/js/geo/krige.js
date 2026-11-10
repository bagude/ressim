// Spatial estimation for the geology desk: experimental variograms, model fitting, ordinary kriging (with its variance),
// inverse-distance weighting, leave-one-out cross-validation, and contour tracing. Pure functions, no DOM.
// Points are {x, y, z} in feet; grids are {nx, ny, x0, y0, dx, dy, z: Float64Array (row-major, y down), v?: variance}.

// ---------------------------------------------------------------- variogram
export const MODELS = {
  spherical: (h, a) => (h >= a ? 1 : 1.5 * h / a - 0.5 * (h / a) ** 3),
  exponential: (h, a) => 1 - Math.exp(-3 * h / a),     // practical range a
  gaussian: (h, a) => 1 - Math.exp(-3 * (h / a) ** 2),
};
/** gamma(h) for a model {type, nugget, sill (partial sill), range} */
export function gamma(m, h) { return h <= 1e-9 ? 0 : m.nugget + m.sill * MODELS[m.type](h, m.range); }

/** Experimental semivariogram: half the mean squared difference of pairs, binned by separation. */
export function experimental(pts, { bins = 12, maxLag = null } = {}) {
  let dmax = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) dmax = Math.max(dmax, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  const L = maxLag || dmax / 2, w = L / bins;
  const sum = new Float64Array(bins), n = new Int32Array(bins), hs = new Float64Array(bins);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const h = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (h > L) continue;
    const b = Math.min(bins - 1, Math.floor(h / w));
    sum[b] += 0.5 * (pts[i].z - pts[j].z) ** 2; n[b]++; hs[b] += h;
  }
  const out = [];
  for (let b = 0; b < bins; b++) if (n[b]) out.push({ h: hs[b] / n[b], g: sum[b] / n[b], n: n[b] });
  return { lags: out, maxLag: L };
}

/** Fit nugget, partial sill and range to the experimental variogram (pair-weighted least squares, grid over range and nugget share). */
export function fitModel(exp, type = 'spherical', variance = null) {
  const L = exp.lags;
  if (!L.length) return { type, nugget: 0, sill: variance || 1, range: 1000 };
  const hmax = Math.max(...L.map(l => l.h));
  let best = null;
  for (let ri = 1; ri <= 40; ri++) {
    const range = hmax * 1.5 * ri / 40;
    for (let ni = 0; ni <= 10; ni++) {
      const share = ni / 20;   // nugget up to half the total sill
      // gamma = c * (share + (1-share) f(h)); c by weighted least squares
      let num = 0, den = 0;
      for (const l of L) { const f = share + (1 - share) * MODELS[type](l.h, range); num += l.n * f * l.g; den += l.n * f * f; }
      const c = den > 0 ? num / den : 0;
      let err = 0;
      for (const l of L) { const f = share + (1 - share) * MODELS[type](l.h, range); err += l.n * (c * f - l.g) ** 2; }
      if (!best || err < best.err) best = { err, type, nugget: c * share, sill: c * (1 - share), range };
    }
  }
  delete best.err;
  return best;
}

// ---------------------------------------------------------------- linear algebra
function invert(A) {   // Gauss-Jordan with partial pivoting; A is an array of rows
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('singular kriging matrix (duplicate wells?)');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map(r => r.slice(n));
}

// ---------------------------------------------------------------- ordinary kriging
/** Returns an estimator (x, y) -> {z, v} for the given points and variogram model. */
export function ordinaryKriging(pts, model) {
  const n = pts.length, A = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 0 : gamma(model, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)));
    row.push(1); A.push(row);
  }
  A.push([...Array(n).fill(1), 0]);
  const Ai = invert(A), b = new Float64Array(n + 1);
  return (x, y) => {
    for (let i = 0; i < n; i++) b[i] = gamma(model, Math.hypot(pts[i].x - x, pts[i].y - y));
    b[n] = 1;
    let z = 0, v = 0;
    for (let i = 0; i <= n; i++) {
      let w = 0; const r = Ai[i];
      for (let j = 0; j <= n; j++) w += r[j] * b[j];
      if (i < n) z += w * pts[i].z;
      v += w * b[i];   // sum w_i gamma_i0 + mu
    }
    return { z, v: Math.max(0, v) };
  };
}

/** Inverse-distance weighting (power p). Variance is not defined; returns null. */
export function idw(pts, p = 2) {
  return (x, y) => {
    let s = 0, w = 0;
    for (const q of pts) {
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < 1) return { z: q.z, v: null };
      const k = 1 / d ** p; s += k * q.z; w += k;
    }
    return { z: s / w, v: null };
  };
}

/** Evaluate an estimator on a grid. */
export function grid(est, { x0, y0, nx, ny, dx, dy }) {
  const z = new Float64Array(nx * ny), v = new Float64Array(nx * ny);
  let hasV = false;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const r = est(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy);
    z[j * nx + i] = r.z; if (r.v != null) { v[j * nx + i] = r.v; hasV = true; }
  }
  return { x0, y0, nx, ny, dx, dy, z, v: hasV ? v : null };
}

/** Leave-one-out cross-validation: each well estimated from all the others. */
export function crossValidate(pts, make) {
  const res = [];
  for (let k = 0; k < pts.length; k++) {
    const rest = pts.filter((_, i) => i !== k);
    try { const r = make(rest)(pts[k].x, pts[k].y); res.push({ ...pts[k], est: r.z, sd: r.v != null ? Math.sqrt(r.v) : null }); } catch { /* skip */ }
  }
  const err = res.map(r => r.est - r.z);
  const rmse = Math.sqrt(err.reduce((a, e) => a + e * e, 0) / Math.max(1, err.length));
  const me = err.reduce((a, e) => a + e, 0) / Math.max(1, err.length);
  const zs = res.map(r => r.z), mean = zs.reduce((a, b) => a + b, 0) / Math.max(1, zs.length);
  const sst = zs.reduce((a, z) => a + (z - mean) ** 2, 0), sse = err.reduce((a, e) => a + e * e, 0);
  return { res, rmse, me, r2: sst > 0 ? 1 - sse / sst : null };
}

// ---------------------------------------------------------------- contours
/** Marching squares on cell centres; returns [{level, segs: [[x1,y1,x2,y2], ...]}] in world feet. */
export function contours(G, levels) {
  const { nx, ny, x0, y0, dx, dy, z } = G, out = [];
  const X = (i) => x0 + (i + 0.5) * dx, Y = (j) => y0 + (j + 0.5) * dy;
  for (const L of levels) {
    const segs = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = z[j * nx + i], b = z[j * nx + i + 1], c = z[(j + 1) * nx + i + 1], d = z[(j + 1) * nx + i];
      const p = [];
      const e = (z1, z2, x1, y1, x2, y2) => { if ((z1 < L) !== (z2 < L)) { const t = (L - z1) / (z2 - z1); p.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } };
      e(a, b, X(i), Y(j), X(i + 1), Y(j)); e(b, c, X(i + 1), Y(j), X(i + 1), Y(j + 1)); e(c, d, X(i + 1), Y(j + 1), X(i), Y(j + 1)); e(d, a, X(i), Y(j + 1), X(i), Y(j));
      for (let q = 0; q + 1 < p.length; q += 2) segs.push([p[q][0], p[q][1], p[q + 1][0], p[q + 1][1]]);
    }
    out.push({ level: L, segs });
  }
  return out;
}

/** A round contour interval giving about `n` lines across [lo, hi]. */
export function niceInterval(lo, hi, n = 10) {
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Sample a grid along a line from (ax, ay) to (bx, by): [{d, z, v}] */
export function profile(est, ax, ay, bx, by, n = 120) {
  const L = Math.hypot(bx - ax, by - ay), out = [];
  for (let k = 0; k <= n; k++) { const t = k / n, r = est(ax + (bx - ax) * t, ay + (by - ay) * t); out.push({ d: L * t, z: r.z, v: r.v }); }
  return out;
}
