// Log correlation for the geology desk: wells side by side (GR, resistivity, porosity, Sw tracks; only the curves a
// well actually has), draggable top and base picks with correlation lines between neighbours, net-pay cutoffs, and
// per-well summaries (gross, net, N/G, average porosity, average Sw, HCPV) that the map can grid.
// Well shape (GET /api/career/geology): {id, type: vertical|horizontal, status?, year_drilled?, vintage?, x_ft, y_ft,
//   log: {tvd_ft[], gr?[], rt?[], phi?[], sw?[], k_md?[]}, picks_auto?: {top_tvd, base_tvd}}
import { h, num, sv } from '../mg/ui.js';

export const DEFAULT_CUTOFFS = { gr: 75, phi: 0.06, sw: 0.5, sp: -25 };   // SP: sand reads more negative than the cutoff (old wells with no GR)

/** Per-well summary between the picks, with net pay flagged by the cutoffs (a curve that is missing does not cut). */
export function summarise(w, pick, cut = DEFAULT_CUTOFFS) {
  const L = w.log || {}, t = L.tvd_ft || [];
  if (!pick || !t.length) return null;
  const { top_tvd: top, base_tvd: base } = pick;
  let gross = 0, net = 0, sphi = 0, ssw = 0, nphi = 0, nsw = 0, hcpv = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < top || t[i] > base) continue;
    const dz = i + 1 < t.length ? Math.abs(t[i + 1] - t[i]) : Math.abs(t[i] - t[i - 1] || 0);
    gross += dz;
    const okGr = L.gr ? L.gr[i] <= cut.gr : L.sp ? L.sp[i] <= cut.sp : true, okPhi = L.phi ? L.phi[i] >= cut.phi : true, okSw = L.sw ? L.sw[i] <= cut.sw : true;
    if (!(okGr && okPhi && okSw)) continue;
    net += dz;
    if (L.phi) { sphi += L.phi[i] * dz; nphi += dz; }
    if (L.sw) { ssw += L.sw[i] * dz; nsw += dz; }
    if (L.phi) hcpv += L.phi[i] * (1 - (L.sw ? L.sw[i] : 0.3)) * dz;
  }
  return { gross_ft: gross, net_ft: net, ntg: gross ? net / gross : null, phi: nphi ? sphi / nphi : null, sw: nsw ? ssw / nsw : null,
    hcpv: L.phi ? hcpv : null };   // HCPV in ft (phi x (1 - Sw) x h); needs a porosity log
}

// ---------------------------------------------------------------- correlation panel
const TRACKS = [
  { key: 'sp', label: 'SP', unit: 'mV', lo: -120, hi: 20, color: '#a9b0b3' },   // the old wells' shale indicator
  { key: 'gr', label: 'GR', unit: 'API', lo: 0, hi: 150, color: '#5fa85e' },
  { key: 'rt', label: 'Resistivity', unit: 'ohm·m', lo: 0.2, hi: 2000, log: true, color: '#e8806f' },
  { key: 'phi', label: 'Porosity', unit: 'v/v', lo: 0.3, hi: 0, color: '#3d8be0' },
  { key: 'sw', label: 'Sw', unit: 'v/v', lo: 1, hi: 0, color: '#b7678f' },
];

/**
 * Draw wells side by side. opts: {picks: {id: {top_tvd, base_tvd}}, cut, flatten: bool, onPick(id, pick)}
 * Depth is TVD; with flatten, each well is hung on its own top pick (stratigraphic datum).
 */
export function correlationPanel(host, wells, opts) {
  host.replaceChildren();
  if (!wells.length) { host.append(h('p', { class: 'hint' }, 'Click wells on the map to line them up here, in the order you click.')); return; }
  const picks = opts.picks, cut = opts.cut;
  const datum = (w) => (opts.flatten && picks[w.id] ? picks[w.id].top_tvd : 0);
  // depth window across all wells, relative to each well's datum
  let zmin = Infinity, zmax = -Infinity;
  for (const w of wells) { const t = w.log?.tvd_ft || []; if (t.length) { zmin = Math.min(zmin, t[0] - datum(w)); zmax = Math.max(zmax, t[t.length - 1] - datum(w)); } }
  const trackW = 62, gap = 34, head = 80, Hp = 480;
  const wellW = (w) => TRACKS.filter(t => w.log?.[t.key]).length * trackW + 6 || trackW;
  const Wtot = wells.reduce((a, w) => a + wellW(w) + gap, 40);
  const Y = (z) => head + (z - zmin) / ((zmax - zmin) || 1) * (Hp - head - 10);
  const s = sv('svg', { viewBox: `0 0 ${Wtot} ${Hp}`, class: 'corr', width: Wtot, height: Hp, role: 'img', 'aria-label': `Log correlation across ${wells.map(w => w.id).join(', ')}` });
  // depth scale on the left
  const step = niceStep((zmax - zmin) / 8);
  for (let z = Math.ceil(zmin / step) * step; z <= zmax; z += step) {
    sv('line', { x1: 34, x2: Wtot, y1: Y(z), y2: Y(z), class: 'dgrid' }, s);
    sv('text', { x: 30, y: Y(z) + 3, 'text-anchor': 'end', class: 'dlab' }, s).textContent = opts.flatten ? `${z > 0 ? '+' : ''}${num(z)}` : num(z);
  }
  sv('text', { x: 4, y: head - 8, class: 'dlab' }, s).textContent = opts.flatten ? 'ft from top' : 'TVD ft';
  let x = 40;
  const anchors = [];   // per well: {xl, xr, w} for correlation lines
  for (const w of wells) {
    const L = w.log || {}, tracks = TRACKS.filter(t => L[t.key]), ww = wellW(w), d0 = datum(w);
    const g = sv('g', { transform: `translate(${x},0)` }, s);
    sv('text', { x: ww / 2, y: 14, 'text-anchor': 'middle', class: 'wname' }, g).textContent = w.id;
    sv('text', { x: ww / 2, y: 27, 'text-anchor': 'middle', class: 'wsub' }, g).textContent = [w.type === 'vertical' ? (w.status || 'vertical') : 'horizontal (MWD)', w.year_drilled].filter(Boolean).join(', ');
    if ((w.derived_curves || []).length) sv('text', { x: ww / 2, y: 39, 'text-anchor': 'middle', class: 'wsub' }, g).textContent = `* derived from ${(w.curves || []).filter(c => ['rhob', 'nphi', 'dt'].includes(c)).join('/').toUpperCase() || 'logs'}`;
    if (!tracks.length) sv('text', { x: ww / 2, y: Hp / 2, 'text-anchor': 'middle', class: 'wsub' }, g).textContent = 'no digital log';
    tracks.forEach((T, ti) => {
      const tx = ti * trackW, X = (v) => {
        const a = T.log ? Math.log10(T.lo) : T.lo, b = T.log ? Math.log10(T.hi) : T.hi, u = T.log ? Math.log10(Math.max(T.lo, v)) : v;
        return tx + 2 + Math.max(0, Math.min(1, (u - a) / (b - a))) * (trackW - 4);
      };
      sv('rect', { x: tx, y: head, width: trackW, height: Hp - head - 10, class: 'track' }, g);
      sv('text', { x: tx + trackW / 2, y: head - 18, 'text-anchor': 'middle', class: 'tlab' }, g).textContent = (w.derived_curves || []).includes(T.key) ? `${T.label}*` : T.label;
      sv('text', { x: tx + 2, y: head - 6, class: 'tscale' }, g).textContent = num(T.lo, T.lo < 1 ? 1 : 0);
      sv('text', { x: tx + trackW - 2, y: head - 6, 'text-anchor': 'end', class: 'tscale' }, g).textContent = num(T.hi, T.hi < 1 && T.hi > 0 ? 1 : 0);
      // GR: shade sand (left of the cutoff) like a lithology fill; others: the curve
      if (T.key === 'gr' || (T.key === 'sp' && !L.gr)) {
        const cx = X(T.key === 'gr' ? cut.gr : (cut.sp ?? -25));
        sv('line', { x1: cx, x2: cx, y1: head, y2: Hp - 10, class: 'cutline' }, g);
      }
      const pts = L.tvd_ft.map((z, i) => `${X(L[T.key][i])},${Y(z - d0)}`).join(' ');
      sv('polyline', { points: pts, fill: 'none', stroke: T.color, 'stroke-width': 1.2 }, g);
    });
    // net pay flag down the right edge
    const p = picks[w.id];
    if (p) {
      const t = L.tvd_ft || [];
      for (let i = 0; i < t.length - 1; i++) {
        if (t[i] < p.top_tvd || t[i] > p.base_tvd) continue;
        const ok = (L.gr ? L.gr[i] <= cut.gr : L.sp ? L.sp[i] <= (cut.sp ?? -25) : true) && (L.phi ? L.phi[i] >= cut.phi : true) && (L.sw ? L.sw[i] <= cut.sw : true);
        if (ok) sv('rect', { x: ww - 5, y: Y(t[i] - d0), width: 5, height: Math.max(0.5, Y(t[i + 1] - d0) - Y(t[i] - d0)), class: 'netflag' }, g);
      }
      for (const [k, cls] of [['top_tvd', 'pick top'], ['base_tvd', 'pick base']]) {
        const y = Y(p[k] - d0);
        const ln = sv('line', { x1: -4, x2: ww + 4, y1: y, y2: y, class: cls, tabindex: 0, role: 'slider', 'aria-label': `${w.id} ${k === 'top_tvd' ? 'top' : 'base'} pick`, 'aria-valuenow': Math.round(p[k]) }, g);
        drag(ln, (dy) => {
          const z = zmin + (y + dy - head) / (Hp - head - 10) * (zmax - zmin) + d0;
          const np = { ...p, [k]: Math.round(z) };
          if (np.base_tvd - np.top_tvd < 4) return;
          opts.onPick(w.id, np);
        });
        ln.addEventListener('keydown', (e) => {
          const dz = e.key === 'ArrowUp' ? -2 : e.key === 'ArrowDown' ? 2 : 0; if (!dz) return;
          e.preventDefault(); opts.onPick(w.id, { ...p, [k]: p[k] + (e.shiftKey ? dz * 5 : dz) });
        });
      }
    }
    anchors.push({ xl: x, xr: x + ww, w, p, d0 });
    x += ww + gap;
  }
  // correlation lines between neighbouring wells' picks
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (!a.p || !b.p) continue;
    for (const [k, cls] of [['top_tvd', 'corrline top'], ['base_tvd', 'corrline base']]) sv('line', { x1: a.xr + 4, x2: b.xl - 4, y1: Y(a.p[k] - a.d0), y2: Y(b.p[k] - b.d0), class: cls }, s);
  }
  host.append(h('div', { class: 'corr-scroll' }, s));
}

function drag(el, onEnd) {
  el.style.cursor = 'ns-resize';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, svg = el.ownerSVGElement, scale = svg.viewBox.baseVal.height / svg.getBoundingClientRect().height;
    const move = (ev) => el.setAttribute('transform', `translate(0,${(ev.clientY - y0) * scale})`);
    const up = (ev) => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onEnd((ev.clientY - y0) * scale); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }

// ---------------------------------------------------------------- a synthetic field for testing the desk before the server's logs exist
// (?mockgeo=1 only; never shown to players)
export function mockGeology(C) {
  let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cols = Math.max(...C.sections.map(s => s.col)) + 1, rows = Math.max(...C.sections.map(s => s.row)) + 1;
  const thick = (x, y) => 90 + 40 * Math.sin(x / 9000) + 25 * Math.cos(y / 6000), phiAt = (x, y) => 0.08 + 0.03 * Math.sin((x + y) / 11000);
  const wells = [];
  for (let k = 0; k < 24; k++) {
    const x = r() * cols * 5280, y = r() * rows * 5280, top = 9000 + 0.004 * x, H = thick(x, y), year = 1955 + Math.floor(r() * 60);
    const t = [], gr = [], rt = [], phi = [], sw = [];
    for (let z = top - 60; z <= top + H + 60; z += 2) {
      const streak = Math.sin(z / 7 + k) > 0.75, pay = z >= top && z <= top + H && !streak, inZone = z >= top && z <= top + H, noise = () => (r() - 0.5);
      t.push(z); gr.push(pay ? 45 + 20 * noise() : inZone ? 95 + 15 * noise() : 110 + 25 * noise());   // shale streaks inside the zone
      const ph = pay ? phiAt(x, y) + 0.02 * noise() : 0.03 + 0.01 * noise(); phi.push(Math.max(0, ph));
      const s = pay ? 0.35 + 0.15 * noise() : 0.9; sw.push(s); rt.push(pay ? 40 / (ph * ph * s * s) / 100 : 3 + noise());
    }
    const log = year < 1970 ? { tvd_ft: t, rt } : year < 1990 ? { tvd_ft: t, gr, rt, phi } : { tvd_ft: t, gr, rt, phi, sw };
    wells.push({ id: `V-${String(k + 1).padStart(2, '0')}`, type: 'vertical', status: ['p&a', 'deeper producer', 'dry hole', 'swd'][k % 4], year_drilled: year, x_ft: x, y_ft: y, log,
      picks_auto: { top_tvd: Math.round(top + 6 * (r() - 0.5)), base_tvd: Math.round(top + H + 8 * (r() - 0.5)) } });
  }
  return { wells, units: { top_name: 'Pay top', base_name: 'Pay base' }, faults_known: [], geomodels: {}, mock: true };
}
