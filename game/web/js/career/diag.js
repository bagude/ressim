// Portfolio diagnostics (#6): every well you drilled, actual oil against the forecast you planned it on.
// A unity plot (log-log, 1:1 line, ±30 % band), the portfolio split into "type curve against the rock" and
// "execution", outliers, a sortable well table, and each well's monthly actual against forecast.
// GET /api/career/diagnostics?id= (game/API.md "Planning and diagnostics additions").
import { h, num, sv } from '../mg/ui.js';
import { multiChart, COLORS } from './charts2.js';

const bbl = (v) => (v == null ? '–' : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} MMbbl` : Math.abs(v) >= 1e3 ? `${num(v / 1e3)} kbbl` : `${num(v)} bbl`);
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${bbl(Math.abs(v))}`);
let sortKey = 'ratio', sortDir = 1, openWell = null;

export async function renderDiagnostics(host, { C, monthName }) {
  host.replaceChildren(h('p', { class: 'hint' }, 'Loading diagnostics…'));
  let D;
  try { D = await (await fetch(`/api/career/diagnostics?id=${encodeURIComponent(C.id)}`)).json(); } catch { D = null; }
  host.replaceChildren();
  if (!D?.ok) { host.append(h('p', { class: 'bad' }, (D?.errors || ['Diagnostics are not available.']).join(' '))); return; }
  const W = D.wells || [], S = D.summary || {};
  host.append(h('h2', {}, 'Diagnostics: your wells against your forecasts'));
  if (!W.length) { host.append(h('p', { class: 'hint' }, 'No well of yours has produced yet. Each one appears here from its first month, against the type curve its pad was locked on.')); notes(host, D); return; }
  // summary tiles
  const gap = String(S.bigger_gap || '').replace(/ /g, '_');
  const bigger = gap === 'type_curve' ? 'the type curve against the rock' : gap === 'execution' ? 'execution' : S.bigger_gap;
  host.append(h('div', { class: 'tiles diag-tiles' },
    tile('Wells', String(S.wells ?? W.length)),
    tile('Actual against forecast', S.ratio_p50 != null ? `${num(S.ratio_p50 * 100)}%` : '–', S.ratio_p10 != null ? `P10–P90 ${num(S.ratio_p10 * 100)}–${num(S.ratio_p90 * 100)}%` : ''),
    tile('Oil so far', bbl(S.actual_oil_bbl), `forecast ${bbl(S.forecast_oil_bbl)}`),
    tile('Bigger gap', bigger || '–', `type curve ${signed(S.type_curve_vs_rock_bbl)}, execution ${signed(S.execution_bbl)}`)));
  if (gap) host.append(h('p', { class: 'lesson diag-lesson' }, gap === 'type_curve'
    ? 'Most of the miss is the forecast itself: the rock under your pads differs from the wells you built the type curve on. Map the rock (Maps) and adjust the type curve for geology, or build it from nearer wells.'
    : 'Most of the miss is execution: landing, the frac, flowback, frac hits and lift. Play those jobs yourself, or check where your laterals left the target zone.'));
  // unity plot and the split
  const row = h('div', { class: 'diag-row' }); host.append(row);
  row.append(unityPlot(W, (id) => { openWell = id; renderDiagnostics(host, { C, monthName }); }), splitBars(S));
  // well table
  const out = new Set(S.outliers || []);
  const cols = [['id', 'Well'], ['pad', 'Pad'], ['months', 'Months'], ['actual_oil_bbl', 'Actual'], ['forecast_oil_bbl', 'Forecast'], ['ratio', 'Ratio'],
    ['tc', 'Type curve vs rock'], ['ex', 'Execution'], ['in_zone_pct', 'In zone']];
  const val = (w, k) => k === 'tc' ? w.split?.type_curve_vs_rock_bbl : k === 'ex' ? w.split?.execution_bbl : w[k];
  const rows = [...W].sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey); return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e18) - (y ?? -1e18)) * sortDir; });
  const t = h('table', { class: 'data diag-table' }, h('thead', {}, h('tr', {}, ...cols.map(([k, l]) => {
    const th = h('th', { 'aria-sort': sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none' }, h('button', { type: 'button', class: 'th-sort' }, l + (sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '')));
    th.querySelector('button').addEventListener('click', () => { sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderDiagnostics(host, { C, monthName }); });
    return th;
  }))), h('tbody', {}, ...rows.map(w => {
    const tr = h('tr', { class: [out.has(w.id) ? 'outlier' : '', openWell === w.id ? 'now' : ''].join(' '), tabindex: 0 },
      h('td', {}, w.id, out.has(w.id) ? h('span', { class: 'tag' }, 'outlier') : null), h('td', {}, w.pad || w.section), h('td', {}, String(w.months)),
      h('td', {}, bbl(w.actual_oil_bbl)), h('td', {}, bbl(w.forecast_oil_bbl)), h('td', { class: w.ratio < 0.85 ? 'neg' : w.ratio > 1.15 ? 'pos' : '' }, `${num(w.ratio * 100)}%`),
      h('td', {}, signed(w.split?.type_curve_vs_rock_bbl)), h('td', {}, signed(w.split?.execution_bbl)), h('td', {}, w.in_zone_pct == null ? '–' : `${num(w.in_zone_pct)}%`));
    const open = () => { openWell = openWell === w.id ? null : w.id; renderDiagnostics(host, { C, monthName }); };
    tr.addEventListener('click', open); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    return tr;
  })));
  host.append(h('div', { class: 'panel-card' }, h('h3', {}, 'Every well'), h('p', { class: 'hint' }, 'Click a column to sort, a well to see its months. Outliers: outside 70–130% of forecast, or far from the rest.'), h('div', { style: 'overflow-x:auto' }, t)));
  const w = W.find(x => x.id === openWell);
  if (w) {
    const d = h('div', { class: 'panel-card' }); host.append(d);
    const x = w.monthly.actual_oil_bbl.map((_, i) => w.from_month + i);
    multiChart(d, { title: `${w.id}: oil per month, actual against forecast`, x, xLabel: 'month', fmtY: (v) => num(v), fmtTipX: monthName,
      series: [{ name: 'Actual', y: w.monthly.actual_oil_bbl, color: COLORS.dev }, { name: 'Forecast', y: w.monthly.forecast_oil_bbl, color: COLORS.pdp, dash: true }] });
  }
  notes(host, D);
}

function tile(a, b, c = '') { return h('div', {}, h('span', {}, a), h('strong', {}, b), c ? h('small', {}, c) : null); }
function notes(host, D) { if (D.notes?.length) host.append(h('ul', { class: 'notes' }, ...D.notes.map(n => h('li', {}, n)))); }

// actual against forecast, log-log, with the 1:1 line and a ±30 % band
function unityPlot(W, onPick) {
  const card = h('div', { class: 'panel-card' });
  const pts = W.filter(w => w.actual_oil_bbl > 0 && w.forecast_oil_bbl > 0);
  const lo = Math.min(...pts.flatMap(w => [w.actual_oil_bbl, w.forecast_oil_bbl])) / 1.3, hi = Math.max(...pts.flatMap(w => [w.actual_oil_bbl, w.forecast_oil_bbl])) * 1.3;
  const L = (v) => Math.log10(v), Wd = 420, Hd = 360, m = 52;
  const X = (v) => m + (L(v) - L(lo)) / (L(hi) - L(lo)) * (Wd - m - 12), Y = (v) => Hd - m + 12 - (L(v) - L(lo)) / (L(hi) - L(lo)) * (Hd - m - 12);
  const s = sv('svg', { viewBox: `0 0 ${Wd} ${Hd}`, class: 'unity', role: 'img', 'aria-label': `Unity plot: ${pts.length} wells, actual against forecast` });
  sv('path', { d: `M${X(lo)},${Y(lo * 1.3)}L${X(hi / 1.3)},${Y(hi)}L${X(hi)},${Y(hi)}L${X(hi)},${Y(hi * 0.7)}L${X(lo / 0.7)},${Y(lo)}L${X(lo)},${Y(lo)}Z`, class: 'band' }, s);
  sv('line', { x1: X(lo), y1: Y(lo), x2: X(hi), y2: Y(hi), class: 'one' }, s);
  for (let e = Math.floor(L(lo)); e <= Math.ceil(L(hi)); e++) for (const k of (hi / lo < 12 ? [1, 1.5, 2, 3, 5, 7] : [1, 2, 5])) {
    const v = k * 10 ** e; if (v < lo || v > hi) continue;
    sv('text', { x: X(v), y: Hd - m + 30, 'text-anchor': 'middle' }, s).textContent = bbl(v);
    sv('text', { x: m - 6, y: Y(v) + 3, 'text-anchor': 'end' }, s).textContent = bbl(v);
    sv('line', { x1: X(v), x2: X(v), y1: 10, y2: Hd - m + 12, class: 'grid' }, s); sv('line', { x1: m, x2: Wd - 12, y1: Y(v), y2: Y(v), class: 'grid' }, s);
  }
  sv('text', { x: (Wd + m) / 2, y: Hd - 6, 'text-anchor': 'middle' }, s).textContent = 'forecast oil so far';
  sv('text', { x: 12, y: Hd / 2 - 20, transform: `rotate(-90 12 ${Hd / 2 - 20})`, 'text-anchor': 'middle' }, s).textContent = 'actual oil so far';
  for (const w of pts) {
    const c = sv('circle', { cx: X(w.forecast_oil_bbl), cy: Y(w.actual_oil_bbl), r: 6, class: `pt ${w.ratio < 0.7 || w.ratio > 1.3 ? 'out' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${w.id}: ${num(w.ratio * 100)}% of forecast` }, s);
    sv('title', {}, c).textContent = `${w.id}: actual ${bbl(w.actual_oil_bbl)}, forecast ${bbl(w.forecast_oil_bbl)} (${num(w.ratio * 100)}%)`;
    c.addEventListener('click', () => onPick(w.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(w.id); });
  }
  card.append(h('h3', {}, 'Unity plot'), s, h('p', { class: 'hint' }, 'Each dot is a well. On the dashed line it made exactly what you forecast; the band is ±30%. Below the line: it underdelivered. Click a dot for its months.'));
  return card;
}

// the portfolio gap, split into its two causes (one measure, signed bars from zero)
function splitBars(S) {
  const card = h('div', { class: 'panel-card' });
  const items = [['Type curve against the rock', S.type_curve_vs_rock_bbl, 'what your design in that rock should give, minus your forecast'],
    ['Execution', S.execution_bbl, 'landing, frac, flowback, frac hits, lift, luck']];
  const max = Math.max(1, ...items.map(([, v]) => Math.abs(v || 0)));
  card.append(h('h3', {}, 'Where the gap comes from'), ...items.map(([l, v, why]) => h('div', { class: 'split-row' },
    h('span', {}, l, h('small', {}, why)),
    h('span', { class: 'split-bar' }, h('i', { class: v >= 0 ? 'pos' : 'neg', style: `width:${50 * Math.abs(v || 0) / max}%;${v >= 0 ? 'left:50%' : `right:50%`}` })),
    h('strong', { class: v >= 0 ? 'pos' : 'neg' }, signed(v)))),
    h('p', { class: 'hint' }, 'Summed over every well. Left of centre: oil you forecast but did not get.'));
  return card;
}
