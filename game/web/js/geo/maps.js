// The geology desk's mapping tool: pick an attribute measured at wells (or a section map), grid it by ordinary kriging
// or inverse distance, and read it as a filled contour map, a kriging standard-deviation map, a variogram, a
// leave-one-out cross-validation, and a cross-section along any line you draw.
// Frame: feet, x east from the field's west edge, y south from its north edge (section col/row x 5,280 ft).
import { h, num, sv } from '../mg/ui.js';
import { multiChart, COLORS } from '../career/charts2.js';
import * as K from './krige.js';
import { correlationPanel, summarise, mockGeology, DEFAULT_CUTOFFS } from './logs.js';

// geology data (logs from legacy vertical wells and MWD gamma from horizontals), loaded once per career
let GEO = null, GEOid = null;
async function loadGeo(C) {
  if (new URLSearchParams(location.search).get('mockgeo') === '1') return mockGeology(C);   // QA only
  let g = null;
  try { const r = await fetch(`/api/career/geology?id=${encodeURIComponent(C.id)}`); if (!r.ok) return null; const d = await r.json(); g = d.ok === false ? null : (d.geology || d); } catch { return null; }
  if (g) g.laterals = await loadLaterals(C);
  return g;
}
// drilled laterals as structure control: each finished steering session's lookback gives the true top along the well
async function loadLaterals(C) {
  const ids = (C.wells || []).map(w => [w.id, w.steer?.session]).filter(([, s]) => s);
  const out = [];
  await Promise.all(ids.map(async ([id, sid]) => {
    try {
      const r = await (await fetch(`/api/steer?id=${encodeURIComponent(sid)}`)).json(), lb = r.session?.lookback;
      if (!lb?.top_tvd_abs_ft?.length || !lb.x_ft) return;
      for (let i = 0; i < lb.md_ft.length; i += Math.max(1, Math.round(600 / ((lb.md_ft[1] - lb.md_ft[0]) || 30))))
        out.push({ id: `${id} @${Math.round(lb.md_ft[i])}`, well: id, x: lb.x_ft[i], y: lb.y_ft[i], top_tvd: lb.top_tvd_abs_ft[i] });
    } catch { /* a session that cannot be read adds no control */ }
  }));
  return out;
}
export async function geology(C, fresh = false) { if (fresh || GEOid !== C.id || !GEO) { GEOid = C.id; GEO = await loadGeo(C); } return GEO; }
// the player's interpretation: picks and cutoffs, kept per career in this browser until it is saved to the server as a geomodel
const store = (C) => `geo.${C.id}`;
function loadInterp(C) { try { return JSON.parse(localStorage.getItem(store(C))) || {}; } catch { return {}; } }
function saveInterp(C) { try { localStorage.setItem(store(C), JSON.stringify({ picks: st.picks, cut: st.cut })); } catch { /* storage blocked: picks last for this visit */ } }
const logWells = () => (GEO?.wells || []).filter(w => w.type !== 'horizontal' && ((w.log && w.log.tvd_ft?.length) || w.tops));
const topsOf = (w) => w.tops ? { top_tvd: w.tops['Pay top'] ?? w.tops.top ?? Object.values(w.tops)[0], base_tvd: w.tops['Pay base'] ?? w.tops.base ?? Object.values(w.tops)[1] } : null;
const PICK_ATTRS = [
  { key: 'p_top', label: 'Structure: top of pay (TVD)', unit: 'ft', d: 0, f: (m) => m.top_tvd },
  { key: 'p_base', label: 'Structure: base of pay (TVD)', unit: 'ft', d: 0, f: (m) => m.base_tvd },
  { key: 'p_gross', label: 'Gross thickness', unit: 'ft', d: 0, f: (m) => m.gross_ft },
  { key: 'p_net', label: 'Net pay', unit: 'ft', d: 0, f: (m) => m.net_ft },
  { key: 'p_ntg', label: 'Net to gross', unit: '%', d: 0, f: (m) => m.ntg == null ? null : m.ntg * 100 },
  { key: 'p_phi', label: 'Average porosity (net)', unit: '%', d: 1, f: (m) => m.phi == null ? null : m.phi * 100 },
  { key: 'p_sw', label: 'Average Sw (net)', unit: '%', d: 0, f: (m) => m.sw == null ? null : m.sw * 100 },
  { key: 'p_hcpv', label: 'HCPV (phi x So x h)', unit: 'ft', d: 2, f: (m) => m.hcpv },
];

const SEC = 5280;
const st = {   // the desk's settings survive tab switches (not reloads)
  mode: 'map', picks: null, cut: null, corr: [], flatten: false, interpFor: null,
  attr: 'oil12', method: 'kriging', model: null, modelType: 'spherical', power: 2, cell: 264,
  fill: true, lines: true, post: true, sticks: true, show: 'estimate', xs: null, picking: false, interval: null,
};

// ---------------------------------------------------------------- attributes
// Well attributes are posted at the middle of each lateral; section attributes at the section centre.
const sum = (a, n = a.length) => a.slice(0, n).reduce((s, v) => s + (v || 0), 0);
const ATTRS = [
  { key: 'oil12', group: 'Production', label: 'First-year oil per 1,000 ft', unit: 'bbl', d: 0, need: (w) => w.oil.length >= 12, f: (w) => sum(w.oil, 12) / w.lateral_ft * 1000 },
  { key: 'oil6', group: 'Production', label: 'First 6 months oil per 1,000 ft', unit: 'bbl', d: 0, need: (w) => w.oil.length >= 6, f: (w) => sum(w.oil, 6) / w.lateral_ft * 1000 },
  { key: 'cum', group: 'Production', label: 'Cumulative oil per 1,000 ft', unit: 'bbl', d: 0, f: (w) => sum(w.oil) / w.lateral_ft * 1000 },
  { key: 'peak', group: 'Production', label: 'Peak month oil per 1,000 ft', unit: 'bbl', d: 0, f: (w) => Math.max(...w.oil) / w.lateral_ft * 1000 },
  { key: 'gor', group: 'Production', label: 'Producing gas-oil ratio', unit: 'Mcf/bbl', d: 2, need: (w) => sum(w.oil) > 0, f: (w) => sum(w.gas) / sum(w.oil) },
  { key: 'wcut', group: 'Production', label: 'Water cut', unit: '%', d: 1, need: (w) => sum(w.oil) + sum(w.water) > 0, f: (w) => 100 * sum(w.water) / (sum(w.oil) + sum(w.water)) },
  { key: 'xf', group: 'Completion', label: 'Fracture half-length', unit: 'ft', d: 0, f: (w) => w.design.half_length_ft },
  { key: 'stage', group: 'Completion', label: 'Stage spacing', unit: 'ft', d: 0, f: (w) => w.design.stage_spacing_ft },
  { key: 'spacing', group: 'Completion', label: 'Well spacing', unit: 'ft', d: 0, f: (w) => w.well_spacing_ft },
];
const GEO_ATTRS = [   // the company's interim section map (view.geology), when the server has one
  { key: 'g_h', label: 'Thickness (company map)', unit: 'ft', d: 0, f: (s) => s.thickness_est_ft },
  { key: 'g_phi', label: 'Porosity (company map)', unit: '%', d: 1, f: (s) => s.porosity_est * 100 },
  { key: 'g_k', label: 'Permeability (company map)', unit: 'md', d: 3, f: (s) => s.perm_est_md },
  { key: 'g_kh', label: 'kh (company map)', unit: 'md·ft', d: 1, f: (s) => s.kh_est_md_ft },
];

const xy = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x_ft, y: p.y_ft });
/** The server's slot rule, for wells it has not described: laterals run south (azimuth 180) from 300 ft inside the
 *  north line, slot k of n across the section, toe at the lateral length or 300 ft short of the south line. */
export function slot(S, k, n, lateral) {
  const x = S.col * SEC + (k + 0.5) * SEC / n, hy = S.row * SEC + 300;
  return { heel: { x, y: hy }, toe: { x, y: Math.min(hy + lateral, S.row * SEC + SEC - 300) } };
}
/** Well positions in the field frame: posted at the middle of each lateral (heel and toe from /geology when known). */
export function wellPoints(C, analogs) {
  const secs = new Map(C.sections.map(s => [s.section, s])), bySec = {}, geo = new Map((GEO?.wells || []).filter(w => w.type === 'horizontal' && w.heel).map(w => [w.id, w]));
  for (const a of analogs) (bySec[a.section] ||= []).push(a);
  const out = [];
  for (const [sec, ws] of Object.entries(bySec)) {
    const s = secs.get(sec); if (!s) continue;
    ws.sort((a, b) => a.id.localeCompare(b.id));
    const per = Math.max(ws[0].wells_per_section || ws.length, ws.length);
    ws.forEach((w, k) => {
      const g = geo.get(w.id), sl = g ? { heel: xy(g.heel), toe: xy(g.toe) } : slot(s, k, per, w.lateral_ft);
      out.push({ w, id: w.id, section: sec, owner: w.owner, x: (sl.heel.x + sl.toe.x) / 2, y: (sl.heel.y + sl.toe.y) / 2, heel: sl.heel, toe: sl.toe });
    });
  }
  return out;
}

const CORE_ATTR = { key: 'core_k', label: 'Core permeability (measured)', unit: 'md', d: 4 };
const cored = () => (GEO?.wells || []).filter(w => w.type === 'vertical' && w.core?.k_md != null);
function pointsFor(attr, C, analogs) {
  if (attr === 'core_k') return cored().map(w => ({ id: w.id, x: w.x_ft, y: w.y_ft, z: w.core.k_md, kind: 'well', owner: 'vertical' }));
  const pa = PICK_ATTRS.find(a => a.key === attr);
  if (pa && pa.key === 'p_top' && GEO?.laterals?.length) {   // drilled laterals add top control along their length
    const vert = pointsFor('p_top_v', C, analogs);
    return [...vert, ...GEO.laterals.map(l => ({ id: l.id, x: l.x, y: l.y, z: l.top_tvd, kind: 'well', owner: 'lateral' }))];
  }
  const pv = pa || (attr === 'p_top_v' ? PICK_ATTRS[0] : null);
  if (pv) return logWells().map(w => { const pk = w.log ? st.picks?.[w.id] : topsOf(w), m0 = w.log ? summarise(w, pk, st.cut) : (pk && { gross_ft: pk.base_tvd - pk.top_tvd }), m = m0 && { ...m0, ...pk }; const z = m ? pv.f(m) : null;
    return { id: w.id, x: w.x_ft, y: w.y_ft, z, kind: 'well', owner: w.type === 'vertical' ? 'vertical' : w.owner }; }).filter(p => Number.isFinite(p.z));
  if (attr === 'p_top_v') return [];
  const g = GEO_ATTRS.find(a => a.key === attr);
  if (g) {
    const secs = new Map(C.sections.map(s => [s.section, s]));
    return (C.geology?.sections || []).filter(s => g.f(s) != null && secs.has(s.section)).map(s => {
      const S = secs.get(s.section); return { id: s.section, section: s.section, x: (S.col + 0.5) * SEC, y: (S.row + 0.5) * SEC, z: g.f(s), kind: 'section' };
    });
  }
  const A = ATTRS.find(a => a.key === attr);
  return wellPoints(C, analogs).filter(p => !A.need || A.need(p.w)).map(p => ({ ...p, z: A.f(p.w), kind: 'well' })).filter(p => Number.isFinite(p.z));
}
const attrInfo = (key) => ATTRS.find(a => a.key === key) || GEO_ATTRS.find(a => a.key === key) || PICK_ATTRS.find(a => a.key === key);

// ---------------------------------------------------------------- colour
// one hue, dark to light on the dark surface (magnitude); a second hue for uncertainty, a different measure
const RAMP_EST = ['#2a2418', '#5a3f17', '#8f5e1c', '#c98322', '#f0b25a', '#f8deb0'];
const RAMP_SD = ['#16202a', '#1d3a5c', '#28598f', '#3d8be0', '#86b8ee', '#d6e8fb'];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = parseInt(stops[i].slice(1), 16), b = parseInt(stops[i + 1].slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return [ch(16), ch(8), ch(0)];
}

// ---------------------------------------------------------------- render
export function renderMaps(host, { C, analogs }) {
  if (GEOid !== C.id) {   // fetch the career's logs once; draw now, and again when they arrive
    GEOid = C.id; GEO = null;
    loadGeo(C).then(g => { GEO = g; if (host.isConnected) renderMaps(host, { C, analogs }); });
  }
  if (st.interpFor !== C.id || (GEO && !st.cutFromGeo)) {
    const I = loadInterp(C); st.picks = I.picks || {}; st.cut = { ...DEFAULT_CUTOFFS, ...(GEO?.gr_cutoff ? { gr: GEO.gr_cutoff } : {}), ...(I.cut || {}) };
    if (st.interpFor !== C.id) st.corr = [];
    st.interpFor = C.id; st.cutFromGeo = !!GEO;
  }
  if (st.mode === 'correlate' && logWells().length) return renderCorrelate(host, { C, analogs });
  if (st.mode === 'prognosis' && logWells().length) return renderPrognosis(host, { C, analogs });
  const cols = Math.max(...C.sections.map(s => s.col)) + 1, rows = Math.max(...C.sections.map(s => s.row)) + 1;
  const W = cols * SEC, H = rows * SEC;
  const avail = [...ATTRS.map(a => a.key), ...(C.geology?.sections?.length ? GEO_ATTRS.map(a => a.key) : []), ...(logWells().length ? PICK_ATTRS.map(a => a.key) : [])];
  if (!avail.includes(st.attr)) st.attr = 'oil12';
  const pts = pointsFor(st.attr, C, analogs), A0 = attrInfo(st.attr);
  // enough decimals to tell contour levels apart, whatever the attribute's scale
  const spread = pts.length ? Math.max(...pts.map(p => p.z)) - Math.min(...pts.map(p => p.z)) : 0;
  const A = { ...A0, d: spread > 0 ? Math.max(A0.d, Math.min(4, Math.ceil(-Math.log10(spread / 20)))) : A0.d };
  host.replaceChildren();
  if (pts.length < 3) { host.append(h('p', { class: 'hint' }, `Only ${pts.length} wells carry this attribute yet. Pick another, or come back when more wells have produced.`)); controls(host, A, pts, null); return; }
  // de-duplicate coincident points (kriging needs distinct locations)
  const seen = new Set(), P = pts.filter(p => { const k = `${Math.round(p.x)},${Math.round(p.y)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const exp = K.experimental(P, { bins: 12, maxLag: Math.hypot(W, H) / 2 });
  if (!st.model || st.model.attr !== st.attr || st.model.type !== st.modelType) st.model = { ...K.fitModel(exp, st.modelType), attr: st.attr };
  const make = (p) => st.method === 'kriging' ? K.ordinaryKriging(p, st.model) : K.idw(p, st.power);
  let est;
  try { est = make(P); } catch (e) { host.append(h('p', { class: 'bad' }, String(e.message))); return; }
  const G = K.grid(est, { x0: 0, y0: 0, nx: Math.round(W / st.cell), ny: Math.round(H / st.cell), dx: st.cell, dy: st.cell });
  const showSd = st.show === 'sd' && G.v;
  const vals = showSd ? Array.from(G.v, v => Math.sqrt(v)) : Array.from(G.z);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const interval = st.interval || K.niceInterval(lo, hi, 9);
  const layout = h('div', { class: 'maps' });
  host.append(layout);
  layout.addEventListener('rerender', () => rerender());
  const side = h('div', { class: 'maps-side' }), main = h('div', { class: 'maps-main' });
  layout.append(side, main);
  controls(side, A, pts, interval);
  // the map
  const wrap = h('div', { class: 'maps-canvas' }), cv = h('canvas', { role: 'img', 'aria-label': `${showSd ? 'Kriging standard deviation of ' : ''}${A.label}, gridded from ${P.length} ${P[0].kind === 'section' ? 'sections' : 'wells'}` });
  const ov = sv('svg', { class: 'maps-ov', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  const tip = h('div', { class: 'chart-tip maps-tip' }); tip.hidden = true;
  wrap.append(cv, ov, tip);
  main.append(h('div', { class: 'maps-head' }, h('h2', {}, showSd ? `${A.label}: kriging uncertainty (1 standard deviation)` : A.label),
    h('span', { class: 'hint' }, `${st.method === 'kriging' ? `Ordinary kriging, ${st.model.type} variogram` : `Inverse distance, power ${st.power}`}; ${P.length} control points; contours every ${num(interval, A.d)} ${A.unit}`)), wrap, legendBar(lo, hi, showSd ? RAMP_SD : RAMP_EST, A, showSd));
  // draw: fill at grid resolution, scaled up smoothly
  const img = document.createElement('canvas'); img.width = G.nx; img.height = G.ny;
  const ix = img.getContext('2d'), id = ix.createImageData(G.nx, G.ny);
  vals.forEach((v, i) => { const [r, g, b] = ramp(showSd ? RAMP_SD : RAMP_EST, (v - lo) / ((hi - lo) || 1)); id.data.set([r, g, b, st.fill ? 255 : 0], i * 4); });
  ix.putImageData(id, 0, 0);
  const draw = () => {
    const w = wrap.clientWidth || 800, hgt = Math.round(w * H / W);
    cv.width = w * devicePixelRatio; cv.height = hgt * devicePixelRatio; cv.style.height = `${hgt}px`; ov.style.height = `${hgt}px`;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.fillStyle = '#16202a'; c.fillRect(0, 0, cv.width, cv.height);
    if (st.fill) c.drawImage(img, 0, 0, cv.width, cv.height);
  };
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(wrap);
  // overlay (SVG in feet): section grid and names, contours, wells, posted values, the cross-section line
  const g0 = sv('g', {}, ov);
  for (let c = 0; c <= cols; c++) sv('line', { x1: c * SEC, x2: c * SEC, y1: 0, y2: H, class: 'sec' }, g0);
  for (let r = 0; r <= rows; r++) sv('line', { y1: r * SEC, y2: r * SEC, x1: 0, x2: W, class: 'sec' }, g0);
  for (const s of C.sections) sv('text', { x: s.col * SEC + 180, y: s.row * SEC + 520, class: 'secname' }, g0).textContent = s.section;
  if (st.lines) {
    const field = showSd ? { ...G, z: Float64Array.from(vals) } : G;
    const levels = []; for (let L = Math.ceil(lo / interval) * interval; L <= hi; L += interval) levels.push(L);
    for (const { level, segs } of K.contours(field, levels)) {
      const idx = Math.round(level / interval) % 5 === 0;
      sv('path', { d: segs.map(([a, b, c2, d]) => `M${a},${b}L${c2},${d}`).join(''), class: idx ? 'ctr idx' : 'ctr' }, g0);
    }
  }
  if (st.sticks) for (const p of wellPoints(C, analogs)) sv('line', { x1: p.heel.x, x2: p.toe.x, y1: p.heel.y, y2: p.toe.y, class: `stick ${p.owner}` }, g0);
  drawFaults(g0);
  for (const w of (GEO?.wells || []).filter(w => w.type === 'vertical')) wellSymbol(g0, w);
  if (st.post) for (const p of P) {
    sv('circle', { cx: p.x, cy: p.y, r: 110, class: `post ${p.owner || 'section'}` }, g0);
    sv('text', { x: p.x + 160, y: p.y - 120, class: 'postval' }, g0).textContent = num(p.z, A.d);
  }
  if (st.xs) {
    const [a, b] = st.xs;
    sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'xsline' }, g0);
    sv('text', { x: a[0], y: a[1] - 200, class: 'xsend' }, g0).textContent = 'A';
    sv('text', { x: b[0], y: b[1] - 200, class: 'xsend' }, g0).textContent = "A'";
  }
  // hover readout and cross-section picking
  const toFt = (ev) => { const r = ov.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H]; };
  ov.addEventListener('pointermove', (ev) => {
    const [x, y] = toFt(ev), r = est(x, y), sec = C.sections.find(s => s.col === Math.floor(x / SEC) && s.row === Math.floor(y / SEC));
    const near = P.reduce((b, p) => { const d = Math.hypot(p.x - x, p.y - y); return d < b.d ? { d, p } : b; }, { d: Infinity }).p;
    tip.replaceChildren(h('b', {}, `${num(r.z, A.d)} ${A.unit}${r.v != null ? ` ± ${num(Math.sqrt(r.v), A.d)}` : ''}`),
      h('span', {}, `Section ${sec?.section ?? '–'}; nearest control ${near?.id} (${num(near?.z, A.d)}), ${num(Math.hypot(near.x - x, near.y - y))} ft away`),
      st.picking ? h('span', { class: 'muted' }, st.xsA ? "Click to place A'" : 'Click to place A') : null);
    const wr = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(wr.width - 280, ev.clientX - wr.left + 14)}px`; tip.style.top = `${ev.clientY - wr.top + 14}px`; tip.hidden = false;
  });
  ov.addEventListener('pointerleave', () => { tip.hidden = true; });
  ov.addEventListener('click', (ev) => {
    if (!st.picking) return;
    const p = toFt(ev);
    if (!st.xsA) { st.xsA = p; ov.classList.add('picking-b'); return; }
    st.xs = [st.xsA, p]; st.xsA = null; st.picking = false; renderMaps(host, { C, analogs });
  });
  if (st.picking) ov.classList.add('picking');
  // below the map: cross-section, variogram, cross-validation
  const below = h('div', { class: 'maps-below' }); main.append(below);
  if (st.xs) crossSection(below, est, P, A);
  if (st.method === 'kriging') variogramChart(below, exp, st.model, A);
  cvPanel(below, K.crossValidate(P, make), A);

  function controls(box, Ai, ptsAll, interval) {
    const sel = h('select', { 'aria-label': 'Attribute to map' },
      ...['Production', 'Completion'].map(gname => h('optgroup', { label: gname }, ...ATTRS.filter(a => a.group === gname).map(a => h('option', { value: a.key }, a.label)))),
      C.geology?.sections?.length ? h('optgroup', { label: 'Company geology map (per section)' }, ...GEO_ATTRS.map(a => h('option', { value: a.key }, a.label))) : null,
      logWells().length ? h('optgroup', { label: 'From your log picks' }, ...PICK_ATTRS.map(a => h('option', { value: a.key }, a.label))) : null,
      cored().length ? h('optgroup', { label: 'From your cores' }, h('option', { value: CORE_ATTR.key, disabled: cored().length < 3 }, `${CORE_ATTR.label}${cored().length < 3 ? ` (${cored().length} of 3 cores needed)` : ''}`)) : null);
    sel.value = st.attr; sel.addEventListener('change', () => { st.attr = sel.value; st.model = null; st.interval = null; st.xs = null; rerender(); });
    const meth = seg('Method', [['kriging', 'Kriging'], ['idw', 'Inverse distance']], st.method, (v) => { st.method = v; if (v === 'idw' && st.show === 'sd') st.show = 'estimate'; rerender(); });
    const show = seg('Show', [['estimate', 'Estimate'], ['sd', 'Uncertainty']], st.show, (v) => { st.show = v; st.interval = null; rerender(); }, st.method !== 'kriging');
    const kr = h('div', { class: 'ctl-group' });
    if (st.method === 'kriging' && st.model) {
      const mt = h('select', { 'aria-label': 'Variogram model' }, ...Object.keys(K.MODELS).map(m => h('option', { value: m }, m[0].toUpperCase() + m.slice(1))));
      mt.value = st.modelType; mt.addEventListener('change', () => { st.modelType = mt.value; st.model = null; rerender(); });
      const tot = st.model.nugget + st.model.sill || 1;
      kr.append(h('label', { class: 'mlbl' }, 'Variogram ', mt),
        slider('Range', 'ft', 500, 40000, 250, st.model.range, (v) => { st.model.range = v; }),
        slider('Nugget', '% of sill', 0, 90, 1, 100 * st.model.nugget / tot, (v) => { const t = st.model.nugget + st.model.sill; st.model.nugget = t * v / 100; st.model.sill = t * (1 - v / 100); }),
        h('button', { type: 'button', class: 'small-btn', onclick: () => { st.model = null; rerender(); } }, 'Fit to the data again'),
        h('p', { class: 'hint' }, 'Range: how far a well tells you about the rock. Nugget: noise that does not depend on distance. A larger nugget smooths the map.'));
    } else if (st.method === 'idw') kr.append(slider('Power', '', 1, 4, 0.5, st.power, (v) => { st.power = v; }));
    const chk = (k, label) => { const c = h('input', { type: 'checkbox' }); c.checked = st[k]; c.addEventListener('change', () => { st[k] = c.checked; rerender(); }); return h('label', { class: 'check' }, c, ' ', label); };
    const ci = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Contour interval' }); ci.value = interval ?? '';
    ci.addEventListener('change', () => { st.interval = +ci.value > 0 ? +ci.value : null; rerender(); });
    const cell = h('select', { 'aria-label': 'Grid cell size' }, ...[[132, '132 ft (fine)'], [264, '264 ft'], [528, '528 ft (coarse)']].map(([v, l]) => h('option', { value: v }, l)));
    cell.value = st.cell; cell.addEventListener('change', () => { st.cell = +cell.value; rerender(); });
    box.append(...[modeSwitch(), h('label', { class: 'mlbl' }, 'Attribute', sel),
      h('p', { class: 'hint' }, `${ptsAll.length} ${ptsAll[0]?.kind === 'section' ? 'sections' : 'wells'} carry it. ${ptsAll[0]?.kind === 'section' ? 'The company map is an estimate with noise; it is not the rock itself.' : PICK_ATTRS.some(a => a.key === st.attr) ? 'From your picks and cutoffs, posted at each well with a log.' : 'Posted at the middle of each lateral.'}`),
      meth, show, kr,
      h('div', { class: 'ctl-group' }, h('label', { class: 'mlbl' }, 'Contour interval ', ci, ` ${Ai.unit}`), h('label', { class: 'mlbl' }, 'Grid cell ', cell),
        chk('fill', 'Colour fill'), chk('lines', 'Contours'), chk('post', 'Posted values'), chk('sticks', 'Well sticks')),
      h('div', { class: 'ctl-group' }, h('button', { type: 'button', class: 'small-btn do', onclick: () => { st.picking = true; st.xsA = null; rerender(); } }, st.xs ? 'Draw a new cross-section' : 'Draw a cross-section'),
        st.picking ? h('p', { class: 'hint' }, 'Click two points on the map: A, then A′.') : null,
        st.xs ? h('button', { type: 'button', class: 'small-btn', onclick: () => { st.xs = null; rerender(); } }, 'Clear the cross-section') : null),
      logWells().length && !GEO?.mock ? saveBox() : null,
      (GEO?.wells || []).some(w => w.type === 'vertical') && !GEO?.mock ? coreBox() : null,
      h('p', { class: 'hint' }, (() => {
        const n = logWells().length, picked = Object.keys(st.picks || {}).length, saved = Object.keys(GEO?.geomodels || {}).length;
        if (!n) return 'Well logs are not available for this field yet.';
        const tail = GEO?.mock ? ' (Synthetic test logs.)' : '';
        if (saved) return `Interpretation saved. Next: use it in the type curve, so each pad is scaled to the rock under it.${tail}`;
        if (picked) return `${picked} of ${n} wells with logs picked. Map net pay or HCPV above, then save the interpretation.${tail}`;
        return `${n} wells have logs. Pick tops in Correlate, then map thickness, net pay and HCPV here.${tail}`;
      })()),
      Object.keys(GEO?.geomodels || {}).length ? h('button', { type: 'button', class: 'small-btn do', onclick: () => document.querySelector('[data-tab="typecurve"]')?.click() }, 'Use it in the type curve') : null].filter(Boolean));
  }
  // cut a core in a legacy vertical: a measured permeability (within about 15 %), $250k at month end, once per well.
  // Logs give porosity and saturation; only core gives permeability, the number the type curve and the DFIT can't pin down.
  function coreBox() {
    const V = (GEO?.wells || []).filter(w => w.type === 'vertical'), have = V.filter(w => w.core?.k_md != null), left = V.filter(w => w.core?.k_md == null);
    const pick = h('select', { 'aria-label': 'Vertical well to core' }, ...left.map(w => h('option', { value: w.id }, `${w.id}${w.year_drilled ? `, drilled ${w.year_drilled}` : ''}`)));
    const msg = h('p', { class: 'hint', role: 'status' });
    const go = h('button', { type: 'button', class: 'small-btn' }, 'Cut a core ($250k)');
    go.addEventListener('click', async () => {
      go.disabled = true; msg.textContent = 'Cutting the core…';
      const r = await fetch('/api/career/core', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: C.id, well: pick.value }) }).then(x => x.json()).catch(() => ({ ok: false, errors: ['The server did not answer.'] }));
      if (!r.ok) { go.disabled = false; msg.textContent = (r.errors || ['The core was not cut.']).join(' '); return; }
      GEO = await loadGeo(C); rerender();
    });
    return h('div', { class: 'ctl-group' }, h('span', { class: 'mlbl' }, 'Cores'),
      h('p', { class: 'hint' }, `Logs give porosity and saturation; only a core measures permeability (within about 15%). ${have.length ? `Cored: ${have.map(w => `${w.id} ${num(w.core.k_md, 4)} md`).join(', ')}.` : 'No cores yet.'}${have.length < 3 ? ' Three cores make permeability mappable.' : ''}`),
      left.length ? h('span', { class: 'core-row' }, pick, go) : null, msg);
  }
  function saveBox() {
    const name = h('input', { type: 'text', maxlength: 40, 'aria-label': 'Interpretation name', placeholder: `My map, month ${C.month}` });
    const msg = h('p', { class: 'hint' });
    const saved = Object.keys(GEO?.geomodels || {});
    return h('div', { class: 'ctl-group' }, h('span', { class: 'mlbl' }, 'Save your interpretation'),
      h('p', { class: 'hint' }, 'Krige gross, net, porosity, Sw and HCPV from your picks with this method, average them over every section, and send them to the type curve.'),
      name, h('button', { type: 'button', class: 'small-btn do', onclick: async (e) => {
        e.currentTarget.disabled = true; msg.textContent = 'Gridding and saving…';
        const r = await saveGeomodel(C, analogs, name.value.trim() || `My map, month ${C.month}`);
        msg.textContent = r.ok ? `Saved “${r.name}”: ${r.n} sections. Use it on the Type curve tab under “Adjust for geology”.` : (r.errors || ['Could not save.']).join(' ');
        if (r.ok) { await geology(C, true); setTimeout(rerender, 1200); } else e.currentTarget.disabled = false;
      } }, 'Save as an interpretation'), msg,
      saved.length ? h('p', { class: 'hint' }, `Saved: ${saved.join(', ')}.`) : null);
  }
  function modeSwitch() {
    return h('div', {}, h('h2', {}, 'Geology desk'), logWells().length ? seg('', [['map', 'Map'], ['correlate', 'Correlate logs'], ['prognosis', 'Plan a well']], st.mode, (v) => { st.mode = v; rerender(); }) : null);
  }
  function rerender() { renderMaps(host, { C, analogs }); }
}

async function saveGeomodel(C, analogs, name) {
  const cols = Math.max(...C.sections.map(s => s.col)) + 1, rows = Math.max(...C.sections.map(s => s.row)) + 1, cell = 528;
  const G0 = { x0: 0, y0: 0, nx: Math.round(cols * SEC / cell), ny: Math.round(rows * SEC / cell), dx: cell, dy: cell };
  const map = { p_gross: 'gross_ft', p_net: 'net_ft', p_phi: 'phi', p_sw: 'sw', p_hcpv: 'hcpv' };
  const scale = { p_phi: 0.01, p_sw: 0.01 };   // the desk shows percent; the server takes fractions
  const sections = {}, grids = {};
  for (const [key, attr] of Object.entries(map)) {
    const P = pointsFor(key, C, analogs);
    if (P.length < 3) continue;
    const est = st.method === 'kriging' ? K.ordinaryKriging(P, K.fitModel(K.experimental(P), st.modelType)) : K.idw(P, st.power);
    const G = K.grid(est, G0), f = scale[key] || 1;
    grids[attr] = { nx: G.nx, ny: G.ny, x0: 0, y0: 0, dx: cell, dy: cell, z: Array.from(G.z, v => +(v * f).toFixed(5)) };
    for (const s of C.sections) {   // the mean of the cells inside the section
      let sum = 0, n = 0;
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
        if (Math.floor(x / SEC) === s.col && Math.floor(y / SEC) === s.row) { sum += G.z[j * G.nx + i]; n++; }
      }
      if (n) (sections[s.section] ||= {})[attr] = +(sum / n * f).toFixed(5);
    }
  }
  const r = await fetch('/api/career/geomodel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: C.id, name, sections, picks: st.picks, grids, cutoffs: st.cut }) }).then(x => x.json()).catch(() => ({ ok: false }));
  return { ...r, name, n: Object.keys(sections).length };
}

// seismic faults: the trace (about ±250 ft), the throw, no down side
function drawFaults(g) {
  for (const f of GEO?.faults_known || []) {
    if (!f.trace?.length) continue;
    const pts = f.trace.map(p => (Array.isArray(p) ? p : [p.x_ft, p.y_ft]));
    sv('polyline', { points: pts.map(p => p.join(',')).join(' '), class: 'fault' }, g);
    const m = pts[Math.floor(pts.length / 2)];
    sv('text', { x: m[0] + 200, y: m[1] - 200, class: 'faultlab' }, g).textContent = `${f.id || 'Fault'}: ${num(f.throw_ft)} ft`;
    sv('title', {}, g.lastChild).textContent = f.note || 'Fault from legacy seismic: trace about ±250 ft, throw approximate, down side not resolved.';
  }
}
/** Where a planned lateral crosses a known fault trace: [{md, fault}] */
function faultCrossings(heel, toe) {
  const out = [], L = Math.hypot(toe.x - heel.x, toe.y - heel.y);
  for (const f of GEO?.faults_known || []) {
    const P = (f.trace || []).map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x_ft, y: p.y_ft }));
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], d = (toe.x - heel.x) * (b.y - a.y) - (toe.y - heel.y) * (b.x - a.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((a.x - heel.x) * (b.y - a.y) - (a.y - heel.y) * (b.x - a.x)) / d, u = ((a.x - heel.x) * (toe.y - heel.y) - (a.y - heel.y) * (toe.x - heel.x)) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ md: t * L, fault: f });
    }
  }
  return out.sort((p, q) => p.md - q.md);
}

// standard well symbols for the legacy verticals (in feet; drawn on the map overlay)
function wellSymbol(g, w, r = 150) {
  const x = w.x_ft, y = w.y_ft, cls = `vwell ${String(w.status || '').replace(/[^a-z]/gi, '')}`;
  const grp = sv('g', { class: cls }, g);
  sv('circle', { cx: x, cy: y, r }, grp);
  if (/p&a|dry/i.test(w.status || '')) for (const a of [45, 135, 225, 315]) {   // dry or plugged: rays
    const t = a * Math.PI / 180; sv('line', { x1: x + r * Math.cos(t), y1: y + r * Math.sin(t), x2: x + 2 * r * Math.cos(t), y2: y + 2 * r * Math.sin(t) }, grp);
  }
  if (/swd/i.test(w.status || '')) sv('line', { x1: x - r, y1: y + r, x2: x + r, y2: y - r }, grp);
  sv('title', {}, grp).textContent = `${w.id}: ${w.status || 'vertical'}${w.year_drilled ? `, drilled ${w.year_drilled}` : ''}; logs: ${Object.keys(w.log || {}).filter(k => k !== 'tvd_ft' && k !== 'md_ft').join(', ') || 'none'}`;
}

// ---------------------------------------------------------------- correlate: line wells up, pick tops, set cutoffs
function renderCorrelate(host, ctx) {
  const { C } = ctx, W = logWells(), rerender = () => renderMaps(host, ctx);
  const cols = Math.max(...C.sections.map(s => s.col)) + 1, rows = Math.max(...C.sections.map(s => s.row)) + 1, FW = cols * SEC, FH = rows * SEC;
  host.replaceChildren();
  const layout = h('div', { class: 'maps' }), side = h('div', { class: 'maps-side' }), main = h('div', { class: 'maps-main' });
  layout.append(side, main); host.append(layout);
  const cutCtl = (k, label, lo, hi, step, fmt) => {
    const out = h('output', {}, fmt(st.cut[k])), inp = h('input', { type: 'range', min: lo, max: hi, step, 'aria-label': label }); inp.value = st.cut[k];
    inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); });
    inp.addEventListener('change', () => { st.cut[k] = +inp.value; saveInterp(C); rerender(); });
    return h('div', { class: 'ctl' }, h('label', {}, h('span', {}, label), out), inp);
  };
  const flat = h('input', { type: 'checkbox' }); flat.checked = st.flatten; flat.addEventListener('change', () => { st.flatten = flat.checked; rerender(); });
  const nPicked = W.filter(w => st.picks[w.id]).length;
  side.append(h('div', {}, h('h2', {}, 'Geology desk'), seg('', [['map', 'Map'], ['correlate', 'Correlate logs'], ['prognosis', 'Plan a well']], 'correlate', (v) => { st.mode = v; rerender(); })),
    h('p', { class: 'hint' }, `Click wells on the base map to line them up. Drag the top (amber) and base (blue) lines, or focus one and use the arrow keys. ${nPicked} of ${W.length} wells picked.`),
    h('div', { class: 'ctl-group' },
      h('button', { type: 'button', class: 'small-btn', onclick: () => { for (const w of W) if (w.log && !st.picks[w.id] && w.picks_auto) st.picks[w.id] = { ...w.picks_auto }; saveInterp(C); rerender(); } }, 'Auto-pick the unpicked wells'),
      h('button', { type: 'button', class: 'small-btn', onclick: () => { st.corr = []; rerender(); } }, 'Clear the line-up'),
      h('label', { class: 'check' }, flat, ' Flatten on the top pick')),
    h('div', { class: 'ctl-group' }, h('span', { class: 'mlbl' }, 'Net pay cutoffs'),
      cutCtl('gr', 'GR below', 30, 120, 1, (v) => `${num(v)} API`), cutCtl('sp', 'SP below (wells with no GR)', -80, 0, 1, (v) => `${num(v)} mV`), cutCtl('phi', 'Porosity above', 0, 0.15, 0.005, (v) => `${num(v * 100, 1)}%`), cutCtl('sw', 'Sw below', 0.2, 1, 0.05, (v) => `${num(v * 100)}%`),
      h('p', { class: 'hint' }, 'A curve a well does not have cannot cut it: old wells with no porosity log count every foot of their gross that passes the shale cutoff (GR, or SP where there is no GR) as net.')),
    h('div', { class: 'ctl-group' }, h('button', { type: 'button', class: 'small-btn do', onclick: () => { st.mode = 'map'; st.attr = 'p_net'; st.model = null; rerender(); } }, 'Map net pay from these picks')));
  // base map: sections and every well with a log, clickable
  const bm = sv('svg', { viewBox: `-300 -300 ${FW + 600} ${FH + 600}`, class: 'basemap maps-ov', role: 'img', 'aria-label': 'Base map of wells with logs' });
  for (let c = 0; c <= cols; c++) sv('line', { x1: c * SEC, x2: c * SEC, y1: 0, y2: FH, class: 'sec' }, bm);
  for (let r = 0; r <= rows; r++) sv('line', { y1: r * SEC, y2: r * SEC, x1: 0, x2: FW, class: 'sec' }, bm);
  for (const s of C.sections) sv('text', { x: s.col * SEC + 180, y: s.row * SEC + 520, class: 'secname' }, bm).textContent = s.section;
  for (const w of (GEO?.wells || []).filter(w => w.type === 'horizontal' && w.heel)) { const a = xy(w.heel), b = xy(w.toe); sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `stick ${w.owner}` }, bm); }
  drawFaults(bm);
  for (const w of W) {
    const inLine = st.corr.indexOf(w.id);
    const g = sv('g', { class: `pickable${inLine >= 0 ? ' on' : ''}${st.picks[w.id] ? ' picked' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${w.id}${inLine >= 0 ? ', in the line-up' : ''}` }, bm);
    if (w.type === 'vertical') wellSymbol(g, w, 170); else sv('circle', { cx: w.x_ft, cy: w.y_ft, r: 120, class: 'hwell' }, g);
    sv('text', { x: w.x_ft + 240, y: w.y_ft + 90, class: 'wlab' }, g).textContent = inLine >= 0 ? `${inLine + 1}. ${w.id}` : w.log ? w.id : `${w.id} (tops only)`;
    const toggle = () => { if (!w.log) return; const i = st.corr.indexOf(w.id); if (i >= 0) st.corr.splice(i, 1); else { st.corr.push(w.id); if (!st.picks[w.id] && w.picks_auto) { st.picks[w.id] = { ...w.picks_auto }; saveInterp(C); } } rerender(); };
    g.addEventListener('click', toggle); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  if (st.corr.length > 1) {   // the section line through the chosen wells
    const pts = st.corr.map(id => W.find(w => w.id === id)).filter(Boolean);
    sv('polyline', { points: pts.map(w => `${w.x_ft},${w.y_ft}`).join(' '), class: 'xsline', fill: 'none' }, bm);
  }
  main.append(h('div', { class: 'maps-head' }, h('h2', {}, 'Correlate logs'), h('span', { class: 'hint' }, `${GEO?.units?.top_name || 'Top'} and ${GEO?.units?.base_name || 'base'} of the pay${GEO?.mock ? '; synthetic test logs' : ''}`)),
    h('div', { class: 'basemap-wrap' }, bm));
  const panel = h('div', { class: 'panel-card corr-card' }); main.append(panel);
  correlationPanel(panel, st.corr.map(id => W.find(w => w.id === id)).filter(Boolean), {
    picks: st.picks, cut: st.cut, flatten: st.flatten,
    onPick: (id, p) => { st.picks[id] = p; saveInterp(C); rerender(); },
  });
  // summaries for every picked well
  const rows2 = W.filter(w => w.log && st.picks[w.id]).map(w => ({ w, m: summarise(w, st.picks[w.id], st.cut) }));
  if (rows2.length) main.append(h('div', { class: 'panel-card' }, h('h3', {}, 'Your picks'), h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ...['Well', 'Type', 'Curves', 'Top', 'Base', 'Gross', 'Net', 'N/G', 'Porosity', 'Sw', 'HCPV'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...rows2.map(({ w, m }) => h('tr', st.corr.includes(w.id) ? { class: 'now' } : {}, h('td', {}, w.id), h('td', {}, w.type === 'vertical' ? `${w.status || 'vertical'}${w.year_drilled ? `, ${w.year_drilled}` : ''}` : 'horizontal'),
      h('td', {}, (w.curves || ['gr', 'rt', 'phi', 'sw'].filter(k => w.log[k])).map(k => k.toUpperCase()).join(' ') + (w.derived_curves?.length ? ` (+${w.derived_curves.join(', ').toUpperCase()} derived)` : '')),
      h('td', {}, num(st.picks[w.id].top_tvd)), h('td', {}, num(st.picks[w.id].base_tvd)), h('td', {}, `${num(m.gross_ft)} ft`), h('td', {}, `${num(m.net_ft)} ft`),
      h('td', {}, m.ntg == null ? '–' : `${num(m.ntg * 100)}%`), h('td', {}, m.phi == null ? '–' : `${num(m.phi * 100, 1)}%`), h('td', {}, m.sw == null ? '–' : `${num(m.sw * 100)}%`),
      h('td', {}, m.hcpv == null ? '–' : `${num(m.hcpv, 2)} ft`))))))));
}

function seg(label, opts, value, on, disabled = false) {
  return h('div', { class: 'ctl-group' }, h('span', { class: 'mlbl' }, label), h('span', { class: 'seg' }, ...opts.map(([v, l]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value) }, l);
    if (disabled && v !== value) b.disabled = true;
    b.addEventListener('click', () => on(v)); return b;
  })));
}
function slider(label, unit, lo, hi, step, value, on) {
  const out = h('output', {}, `${num(value)}${unit ? ' ' + unit : ''}`);
  const inp = h('input', { type: 'range', min: lo, max: hi, step, 'aria-label': label }); inp.value = value;
  inp.addEventListener('input', () => { out.textContent = `${num(+inp.value)}${unit ? ' ' + unit : ''}`; });
  inp.addEventListener('change', () => { on(+inp.value); inp.closest('.maps')?.dispatchEvent(new CustomEvent('rerender', { bubbles: true })); });
  return h('div', { class: 'ctl' }, h('label', {}, h('span', {}, label), out), inp);
}
function legendBar(lo, hi, stops, A, sd) {
  return h('div', { class: 'maps-legend' }, h('span', {}, num(lo, A.d)), h('i', { style: `background:linear-gradient(90deg,${stops.join(',')})` }), h('span', {}, `${num(hi, A.d)} ${A.unit}${sd ? ' (1 s.d.)' : ''}`));
}

const compact = (v) => (Math.abs(v) >= 1e9 ? `${num(v / 1e9, 1)}B` : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 1)}M` : Math.abs(v) >= 1e4 ? `${num(v / 1e3, 0)}k` : num(v, Math.abs(v) < 10 ? 2 : 0));
function variogramChart(box, exp, m, A) {
  const card = h('div', { class: 'panel-card' }); box.append(card);
  const L = exp.lags, xmax = Math.max(m.range * 1.2, ...L.map(l => l.h)), ymax = Math.max(m.nugget + m.sill, ...L.map(l => l.g)) * 1.1 || 1;
  const Wd = 420, Hd = 200, ml = 58, mb = 30, mt = 10, mr = 10;
  const X = (x) => ml + x / xmax * (Wd - ml - mr), Y = (y) => Hd - mb - y / ymax * (Hd - mb - mt);
  const s = sv('svg', { viewBox: `0 0 ${Wd} ${Hd}`, class: 'vario', role: 'img', 'aria-label': `Variogram: range ${num(m.range)} ft, nugget ${num(m.nugget, 2)}, sill ${num(m.nugget + m.sill, 2)}` });
  for (let k = 0; k <= 4; k++) { const y = ymax * k / 4; sv('line', { x1: ml, x2: Wd - mr, y1: Y(y), y2: Y(y), class: 'grid' }, s); sv('text', { x: ml - 6, y: Y(y) + 4, 'text-anchor': 'end' }, s).textContent = compact(y); }
  for (let k = 0; k <= 4; k++) { const x = xmax * k / 4; sv('text', { x: X(x), y: Hd - 10, 'text-anchor': 'middle' }, s).textContent = `${num(x / 1000, 1)}k`; }
  const pth = []; for (let k = 0; k <= 80; k++) { const x = xmax * k / 80; pth.push(`${k ? 'L' : 'M'}${X(x)},${Y(K.gamma(m, x))}`); }
  sv('path', { d: pth.join(''), class: 'model' }, s);
  const nmax = Math.max(...L.map(l => l.n));
  for (const l of L) sv('circle', { cx: X(l.h), cy: Y(l.g), r: 3 + 5 * Math.sqrt(l.n / nmax), class: 'lag' }, s).appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = `${num(l.h)} ft: ${num(l.g, 2)} from ${l.n} pairs`;
  sv('line', { x1: X(m.range), x2: X(m.range), y1: mt, y2: Hd - mb, class: 'rangeline' }, s);
  card.append(h('h3', {}, 'Variogram'), s,
    h('p', { class: 'hint' }, `How different two wells are, by the distance between them. Dots: pairs of your wells (bigger = more pairs). Line: the fitted ${m.type} model, range ${num(m.range)} ft (dashed), nugget ${num(100 * m.nugget / ((m.nugget + m.sill) || 1))}% of the sill. Distance in thousands of feet; values in (${A.unit})².`));
}

function cvPanel(box, cv, A) {
  const card = h('div', { class: 'panel-card' }); box.append(card);
  const R = cv.res, lo = Math.min(...R.map(r => Math.min(r.z, r.est))), hi = Math.max(...R.map(r => Math.max(r.z, r.est)));
  const Wd = 260, Hd = 220, m = 40, X = (v) => m + (v - lo) / ((hi - lo) || 1) * (Wd - m - 10), Y = (v) => Hd - m + 10 - (v - lo) / ((hi - lo) || 1) * (Hd - m - 10);
  const s = sv('svg', { viewBox: `0 0 ${Wd} ${Hd}`, class: 'cvplot', role: 'img', 'aria-label': `Cross-validation: RMSE ${num(cv.rmse, A.d)} ${A.unit}` });
  sv('line', { x1: X(lo), y1: Y(lo), x2: X(hi), y2: Y(hi), class: 'one' }, s);
  for (const r of R) sv('circle', { cx: X(r.z), cy: Y(r.est), r: 3.5, class: 'cvpt' }, s).appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = `${r.id}: actual ${num(r.z, A.d)}, estimated ${num(r.est, A.d)}`;
  sv('text', { x: Wd / 2 + 10, y: Hd - 6, 'text-anchor': 'middle' }, s).textContent = 'actual';
  sv('text', { x: 10, y: Hd / 2, transform: `rotate(-90 10 ${Hd / 2})`, 'text-anchor': 'middle' }, s).textContent = 'estimated';
  const row = (a, b) => h('li', {}, h('span', {}, a), h('strong', {}, b));
  card.append(h('h3', {}, 'Cross-validation'), s, h('ul', { class: 'plain cvstats' },
    row('Error (RMSE)', `${num(cv.rmse, A.d)} ${A.unit}`), row('Bias (mean error)', `${num(cv.me, A.d)} ${A.unit}`),
    row('Variance explained', cv.r2 == null ? '–' : `${num(cv.r2 * 100)}%`)),
    h('p', { class: 'hint' }, 'Each well hidden in turn and estimated from the others. Compare methods and variograms here: the lower the error, the better the map predicts a well you have not drilled.'));
}

function crossSection(box, est, P, A) {
  const [[ax, ay], [bx, by]] = st.xs, L = Math.hypot(bx - ax, by - ay);
  const pr = K.profile(est, ax, ay, bx, by, 160), hasV = pr[0].v != null;
  const card = h('div', { class: 'panel-card xs-card' }); box.append(card);
  const near = P.map(p => { const t = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (L * L); const d = Math.abs((p.x - ax) * (by - ay) - (p.y - ay) * (bx - ax)) / L; return { p, t, d }; })
    .filter(o => o.t >= 0 && o.t <= 1 && o.d <= 1320).sort((a, b) => a.t - b.t);
  const d = h('div'); card.append(h('h3', {}, `Cross-section A to A′, ${num(L / 5280, 2)} miles`), d);
  multiChart(d, { title: `${A.label} along the line`, note: hasV ? 'Dashed: one standard deviation either side of the kriged estimate.' : null, x: pr.map(q => q.d), xLabel: 'ft from A', H: 220, W: 900,
    fmtY: (v) => num(v, A.d), fmtX: (v) => num(v), fmtTipX: (v) => `${num(v)} ft from A`,
    series: [{ name: 'Estimate', y: pr.map(q => q.z), color: COLORS.dev },
      ...(hasV ? [{ name: '+1 s.d.', y: pr.map(q => q.z + Math.sqrt(q.v)), color: '#3d8be0', dash: true, legend: false, label: false },
        { name: '−1 s.d.', y: pr.map(q => q.z - Math.sqrt(q.v)), color: '#3d8be0', dash: true, label: false }] : [])] });
  card.append(near.length ? h('p', { class: 'hint' }, `Wells within a quarter mile of the line: ${near.map(o => `${o.p.id} at ${num(o.t * L)} ft (${num(o.p.z, A.d)} ${A.unit})`).join('; ')}.`)
    : h('p', { class: 'hint' }, 'No well lies within a quarter mile of this line: everything on it is interpolated. Watch the uncertainty band widen.'));
}


// ---------------------------------------------------------------- plan a well: the geosteering prognosis
// The planning product the steering desk executes: the expected top and base of the pay along a planned lateral
// (from your kriged structure and thickness), a landing target, and the offset vertical whose log is the type log.
const progKey = (C) => `geo.prog.${C.id}`;
export function loadPrognoses(careerId) { try { return JSON.parse(localStorage.getItem(`geo.prog.${careerId}`)) || {}; } catch { return {}; } }
function savePrognosis(C, id, p) { const all = loadPrognoses(C.id); all[id] = p; try { localStorage.setItem(progKey(C), JSON.stringify(all)); } catch { /* storage blocked */ } }

/** Planned wells (and wells drilled or being drilled) on the active plan, with their lateral in the field frame. */
function plannedWells(C) {
  // undrilled wells from the server (its slot rule); wells already drilled on the plan from /geology's horizontals
  const out = [], seen = new Set();
  const add = (id, section, heel, toe) => { if (seen.has(id)) return; seen.add(id); const L = Math.hypot(toe.x - heel.x, toe.y - heel.y); out.push({ id, section, heel, toe, L }); };
  for (const p of GEO?.planned || []) add(p.id, p.section, xy(p.heel), xy(p.toe));
  const planSecs = new Set((C.plan?.pads || []).map(p => p.section));
  for (const w of GEO?.wells || []) if (w.type === 'horizontal' && w.owner === 'you' && planSecs.has(w.section) && w.heel) add(w.id, w.section, xy(w.heel), xy(w.toe));
  if (!out.length) {   // no geology yet: the same rule, client side
    const secs = new Map(C.sections.map(s => [s.section, s]));
    for (const pad of C.plan?.pads || []) { const S = secs.get(pad.section); if (!S) continue;
      for (let k = 0; k < pad.wells; k++) { const sl = slot(S, k, pad.wells, C.lateral_ft || 4620); add(`${pad.section}-${String(k + 1).padStart(2, '0')}`, pad.section, sl.heel, sl.toe); } }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function renderPrognosis(host, ctx) {
  const { C } = ctx, rerender = () => renderMaps(host, ctx);
  const W = logWells(), pickOf = (w) => (w.log ? st.picks[w.id] : topsOf(w)), picked = W.filter(w => pickOf(w));
  host.replaceChildren();
  const layout = h('div', { class: 'maps' }), side = h('div', { class: 'maps-side' }), main = h('div', { class: 'maps-main' });
  layout.append(side, main); host.append(layout);
  side.append(h('div', {}, h('h2', {}, 'Geology desk'), seg('', [['map', 'Map'], ['correlate', 'Correlate logs'], ['prognosis', 'Plan a well']], 'prognosis', (v) => { st.mode = v; rerender(); })));
  const wells = plannedWells(C);
  if (!wells.length) { main.append(h('p', { class: 'hint' }, 'No wells on the plan yet. Add pads on the Development plan, then plan each well here.')); return; }
  if (picked.length < 3) { main.append(h('p', { class: 'hint' }, `Pick the top and base in at least 3 wells first (Correlate logs). ${picked.length} picked so far.`)); return; }
  if (!wells.some(w => w.id === st.progWell)) st.progWell = wells[0].id;
  const pw = wells.find(w => w.id === st.progWell);
  // the player's surfaces: kriged top and kriged gross thickness (each with its own fitted variogram)
  const ptsTop = [...picked.map(w => ({ x: w.x_ft, y: w.y_ft, z: pickOf(w).top_tvd })), ...(GEO?.laterals || []).map(l => ({ x: l.x, y: l.y, z: l.top_tvd }))];   // verticals plus drilled laterals
  const ptsGross = picked.map(w => ({ x: w.x_ft, y: w.y_ft, z: pickOf(w).base_tvd - pickOf(w).top_tvd }));
  const fit = (P) => K.ordinaryKriging(P, K.fitModel(K.experimental(P), 'spherical'));
  let eTop, eGross;
  try { eTop = fit(ptsTop); eGross = fit(ptsGross); } catch (e) { main.append(h('p', { class: 'bad' }, String(e.message))); return; }
  const n = 40, prof = [], ux = (pw.toe.x - pw.heel.x) / (pw.L || 1), uy = (pw.toe.y - pw.heel.y) / (pw.L || 1);
  for (let i = 0; i <= n; i++) {
    const md = pw.L * i / n, x = pw.heel.x + ux * md, y = pw.heel.y + uy * md, t = eTop(x, y), g = eGross(x, y);
    prof.push({ md, top: t.z, base: t.z + g.z, sd: Math.sqrt(t.v || 0) });
  }
  // type well: offset verticals with a gamma log, nearest to the heel first
  const offsets = W.filter(w => w.type === 'vertical' && w.log?.gr).map(w => ({ w, d: Math.hypot(w.x_ft - pw.heel.x, w.y_ft - pw.heel.y) })).sort((a, b) => a.d - b.d);
  const saved = loadPrognoses(C.id)[pw.id];
  if (!st.progType || !offsets.some(o => o.w.id === st.progType) || st.progFor !== pw.id) { st.progType = saved?.type_well || offsets[0]?.w.id; st.progTarget = saved?.target_ft ?? null; st.progFor = pw.id; }
  const gross0 = prof[0].base - prof[0].top;
  if (st.progTarget == null) st.progTarget = Math.round(gross0 / 2);
  // controls
  const wsel = h('select', { 'aria-label': 'Planned well' }, ...wells.map(w => h('option', { value: w.id }, `${w.id}${loadPrognoses(C.id)[w.id] ? ' (planned)' : ''}`)));
  wsel.value = pw.id; wsel.addEventListener('change', () => { st.progWell = wsel.value; rerender(); });
  const tsel = h('select', { 'aria-label': 'Type well' }, ...offsets.map(o => h('option', { value: o.w.id }, `${o.w.id}, ${num(o.d / 5280, 2)} mi, ${o.w.year_drilled || ''} ${['gr', 'rt', 'phi', 'sw'].filter(k => o.w.log[k]).join('/').toUpperCase()}`)));
  tsel.value = st.progType; tsel.addEventListener('change', () => { st.progType = tsel.value; rerender(); });
  const tgt = h('input', { type: 'range', min: 0, max: Math.max(10, Math.round(gross0)), step: 1, 'aria-label': 'Landing target, ft below the top' }); tgt.value = st.progTarget;
  const tout = h('output', {}, `${num(st.progTarget)} ft below the top`);
  tgt.addEventListener('input', () => { tout.textContent = `${num(+tgt.value)} ft below the top`; });
  tgt.addEventListener('change', () => { st.progTarget = +tgt.value; rerender(); });
  const dipDeg = Math.atan2(prof[n].top - prof[0].top, pw.L) * 180 / Math.PI;
  const crossings = faultCrossings(pw.heel, pw.toe);
  side.append(h('label', { class: 'mlbl' }, 'Planned well', wsel),
    h('label', { class: 'mlbl' }, 'Type log from offset well', tsel),
    h('div', { class: 'ctl' }, h('label', {}, h('span', {}, 'Landing target'), tout), tgt),
    h('ul', { class: 'plain' },
      h('li', {}, h('span', {}, 'Top at the heel'), h('strong', {}, `${num(prof[0].top)} ft ± ${num(prof[0].sd)}`)),
      h('li', {}, h('span', {}, 'Top at the toe'), h('strong', {}, `${num(prof[n].top)} ft ± ${num(prof[n].sd)}`)),
      h('li', {}, h('span', {}, 'Mean dip along the lateral'), h('strong', {}, `${num(dipDeg, 2)}° ${dipDeg > 0 ? 'down' : 'up'}`)),
      h('li', {}, h('span', {}, 'Gross at the heel'), h('strong', {}, `${num(gross0)} ft`))),
    crossings.length ? h('p', { class: 'bad' }, `This lateral crosses ${crossings.map(c => `${c.fault.id || 'a fault'} (about ${num(c.fault.throw_ft)} ft) near ${num(c.md)} ft md`).join(' and ')}. Seismic does not say which side is down, and kriging smooths the step: expect the pay to jump there.`) : null,
    h('button', { type: 'button', class: 'small-btn do', onclick: () => {
      savePrognosis(C, pw.id, { well: pw.id, type_well: st.progType, type_well_picks: st.picks[st.progType] || null, target_ft: st.progTarget, faults: crossings.map(c => ({ md: Math.round(c.md), id: c.fault.id, throw_ft: c.fault.throw_ft })), md: prof.map(q => q.md), top_tvd: prof.map(q => q.top), base_tvd: prof.map(q => q.base), sd_ft: prof.map(q => q.sd), month: C.month, picks_used: picked.length });
      rerender();
    } }, saved ? 'Update the prognosis' : 'Save the prognosis for steering'),
    h('p', { class: 'hint' }, saved ? `Saved in month ${saved.month} from ${saved.picks_used} picked wells. The geosteering screen for ${pw.id} shows it and can start from it.` : 'The geosteering screen for this well will show the prognosis and can start your interpretation from it.'));
  // the profile: top, base and target along the lateral, with the kriging uncertainty of the top
  const Wd = 900, Hd = 300, m = { l: 60, r: 14, t: 14, b: 28 };
  const tv = prof.flatMap(q => [q.top - q.sd, q.base + q.sd]), y0 = Math.min(...tv) - 10, y1 = Math.max(...tv) + 10;
  const X = (md) => m.l + md / pw.L * (Wd - m.l - m.r), Y = (z) => m.t + (z - y0) / (y1 - y0) * (Hd - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${Wd} ${Hd}`, class: 'progsvg', role: 'img', 'aria-label': `Prognosis for ${pw.id}: top ${num(prof[0].top)} to ${num(prof[n].top)} ft TVD` });
  for (let md = 0; md <= pw.L; md += 500) sv('text', { x: X(md), y: Hd - 8, 'text-anchor': 'middle' }, svg).textContent = `${num(md)} ft`;
  const step = K.niceInterval(y0, y1, 6);
  for (let z = Math.ceil(y0 / step) * step; z <= y1; z += step) { sv('line', { x1: m.l, x2: Wd - m.r, y1: Y(z), y2: Y(z), class: 'grid' }, svg); sv('text', { x: m.l - 6, y: Y(z) + 3, 'text-anchor': 'end' }, svg).textContent = num(z); }
  const line = (f) => prof.map((q, i) => `${i ? 'L' : 'M'}${X(q.md)},${Y(f(q))}`).join('');
  sv('path', { d: line(q => q.top - q.sd) + prof.slice().reverse().map(q => `L${X(q.md)},${Y(q.top + q.sd)}`).join('') + 'Z', class: 'band' }, svg);
  sv('path', { d: line(q => q.top) + prof.slice().reverse().map(q => `L${X(q.md)},${Y(q.base)}`).join('') + 'Z', class: 'payfill' }, svg);
  sv('path', { d: line(q => q.top), class: 'top' }, svg); sv('path', { d: line(q => q.base), class: 'base' }, svg);
  sv('path', { d: line(q => q.top + st.progTarget), class: 'target' }, svg);
  for (const c of crossings) { sv('line', { x1: X(c.md), x2: X(c.md), y1: m.t, y2: Hd - m.b, class: 'faultx' }, svg); sv('text', { x: X(c.md) + 4, y: m.t + 12, class: 'faultlab2' }, svg).textContent = `${c.fault.id || 'fault'} ~${num(c.fault.throw_ft)} ft`; }
  main.append(h('div', { class: 'maps-head' }, h('h2', {}, `Prognosis for ${pw.id}`), h('span', { class: 'hint' }, `From ${picked.length} picked wells${GEO?.laterals?.length ? ` and ${new Set(GEO.laterals.map(l => l.well)).size} drilled laterals` : ''}, kriged. TVD down; the band is one standard deviation on the top.`)),
    h('div', { class: 'panel-card' }, svg, h('p', { class: 'hint' }, 'Amber: the pay you expect (top and base). Dashed white: your landing target. Blue band: how unsure the map is about the top. Where it widens, the steerer should expect surprises.')));
  const tw = W.find(w => w.id === st.progType);
  if (tw) { const card = h('div', { class: 'panel-card' }); main.append(card); card.append(h('h3', {}, `Type log: ${tw.id}`)); const inner = h('div'); card.append(inner);
    correlationPanel(inner, [tw], { picks: st.picks, cut: st.cut, flatten: false, onPick: (id, p) => { st.picks[id] = p; saveInterp(C); rerender(); } }); }
}
