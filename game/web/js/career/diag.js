// Portfolio diagnostics (#6): every well you drilled, actual oil against the forecast you planned it on.
// A unity plot (log-log, 1:1 line, ±30 % band), the portfolio split into "type curve against the rock" and
// "execution", outliers, a sortable well table, and each well's monthly actual against forecast.
// GET /api/career/diagnostics?id= (game/API.md "Planning and diagnostics additions").
import { h, num, sv } from '../mg/ui.js';
import { multiChart, COLORS } from './charts2.js';

const bbl = (v) => (v == null ? '–' : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} MMbbl` : Math.abs(v) >= 1e3 ? `${num(v / 1e3)} kbbl` : `${num(v)} bbl`);
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${bbl(Math.abs(v))}`);
let sortKey = 'ratio', sortDir = 1, openWell = null;

const usd = (v) => { if (v == null) return '–'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}$${num(a / 1e6, 2)} MM` : `${s}$${num(a / 1e3)}k`; };
let woDone = '';
export async function renderDiagnostics(host, ctx) {
  const { C, monthName } = ctx;
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
  row.append(unityPlot(W, (id) => { openWell = id; renderDiagnostics(host, ctx); }), splitBars(S));
  // well table
  const out = new Set(S.outliers || []);
  const cols = [['id', 'Well'], ['pad', 'Pad'], ['months', 'Months'], ['actual_oil_bbl', 'Actual'], ['forecast_oil_bbl', 'Forecast'], ['ratio', 'Ratio'],
    ['tc', 'Type curve vs rock'], ['ex', 'Execution'], ['in_zone_pct', 'In zone']];
  const val = (w, k) => k === 'tc' ? w.split?.type_curve_vs_rock_bbl : k === 'ex' ? w.split?.execution_bbl : w[k];
  const rows = [...W].sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey); return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e18) - (y ?? -1e18)) * sortDir; });
  const t = h('table', { class: 'data diag-table' }, h('thead', {}, h('tr', {}, ...cols.map(([k, l]) => {
    const th = h('th', { 'aria-sort': sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none' }, h('button', { type: 'button', class: 'th-sort' }, l + (sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '')));
    th.querySelector('button').addEventListener('click', () => { sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderDiagnostics(host, ctx); });
    return th;
  }))), h('tbody', {}, ...rows.map(w => {
    const tr = h('tr', { class: [out.has(w.id) ? 'outlier' : '', openWell === w.id ? 'now' : ''].join(' '), tabindex: 0 },
      h('td', {}, w.id, out.has(w.id) ? h('span', { class: 'tag' }, 'outlier') : null), h('td', {}, w.pad || w.section), h('td', {}, String(w.months)),
      h('td', {}, bbl(w.actual_oil_bbl)), h('td', {}, bbl(w.forecast_oil_bbl)), h('td', { class: w.ratio < 0.85 ? 'neg' : w.ratio > 1.15 ? 'pos' : '' }, `${num(w.ratio * 100)}%`),
      h('td', {}, signed(w.split?.type_curve_vs_rock_bbl)), h('td', {}, signed(w.split?.execution_bbl)), h('td', {}, w.in_zone_pct == null ? '–' : `${num(w.in_zone_pct)}%`));
    const open = () => { openWell = openWell === w.id ? null : w.id; renderDiagnostics(host, ctx); };
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
    const rta = h('div', { class: 'diag-rta' }); host.append(rta); renderRTA(rta, C, w);
    const eur = h('div', { class: 'panel-card' }); host.append(eur); renderEUR(eur, C, w, monthName);
  }
  notes(host, D);
  await workovers(host, ctx);
}

// workovers (#12): the decision card for each producing well that has an option open
async function workovers(host, ctx) {
  const { C } = ctx;
  let R; try { R = await (await fetch(`/api/career/workovers?id=${encodeURIComponent(C.id)}`)).json(); } catch { R = null; }
  if (!R?.ok) return;
  const wells = (R.wells || []).filter(w => w.options?.length);
  const box = h('div', { class: 'panel-card wo' }); host.append(box);
  box.append(h('h3', {}, 'Workovers'), h('p', { class: 'hint' }, `Re-fracture or clean out a producing well. The economics are your expectation at $${num(R.price_usd_bbl, 2)}/bbl on the well's own decline; the real uplift is hidden until it shows in production, and it fades.`));
  if (woDone) { box.append(h('p', { class: 'pos' }, woDone)); woDone = ''; }
  if (!wells.length) { box.append(h('p', { class: 'hint' }, 'No well has an option open yet: a cleanout once a well has 6 months of history, a refrac at 18 months, each once.')); }
  for (const w of wells) {
    box.append(h('div', { class: 'wo-well' }, h('div', { class: 'wo-head' }, h('strong', {}, w.well), h('span', { class: 'hint' }, `pad ${w.pad}, ${w.history_months} months, now ${num(w.current_rate_bbl_month)} bbl/month`)),
      h('div', { class: 'wo-opts' }, ...w.options.map(o => {
        const btn = h('button', { type: 'button', class: o.expected_npv10_usd > 0 ? 'small-btn do' : 'small-btn' }, `Approve the ${o.kind === 'refrac' ? 'refrac' : 'cleanout'} for ${usd(o.cost_usd)}`);
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = 'Approving…';
          const r = await fetch('/api/career/workover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: C.id, well: w.well, kind: o.kind }) }).then(x => x.json()).catch(() => ({ ok: false }));
          if (!r.ok) { btn.disabled = false; btn.textContent = (r.errors || ['Could not approve.']).join(' '); return; }
          woDone = `${o.label || o.kind} approved on ${w.well} for ${usd(o.cost_usd)}. Watch its production here: the uplift shows in the months ahead.`;
          ctx.onCareer?.(r.career);
          renderDiagnostics(host, ctx);
        });
        return h('div', { class: 'wo-opt' }, h('strong', {}, o.label || o.kind),
          h('ul', { class: 'plain' },
            h('li', {}, h('span', {}, 'Cost'), h('strong', {}, usd(o.cost_usd))),
            h('li', {}, h('span', {}, 'Expected uplift'), h('strong', {}, `+${num(o.uplift_mean * 100)}% ± ${num(o.uplift_sd * 100)}%, fading over ${o.fade_months} months`)),
            h('li', {}, h('span', {}, 'Extra oil, expected'), h('strong', {}, bbl(o.incremental_oil_bbl))),
            h('li', {}, h('span', {}, 'Expected NPV10'), h('strong', { class: o.expected_npv10_usd >= 0 ? 'pos' : 'neg' }, usd(o.expected_npv10_usd)))),
          o.note ? h('p', { class: 'hint' }, o.note) : null, btn);
      }))));
  }
  if (R.notes?.length) box.append(h('ul', { class: 'notes' }, ...R.notes.map(n => h('li', {}, n))));
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


// ---------------------------------------------------------------- rate-transient analysis (#10)
async function renderRTA(box, C, w) {
  box.replaceChildren(h('p', { class: 'hint' }, 'Loading the rate-transient analysis…'));
  let R; try { R = await (await fetch(`/api/career/rta?id=${encodeURIComponent(C.id)}&well=${encodeURIComponent(w.id)}`)).json(); } catch { R = null; }
  box.replaceChildren();
  if (!R?.ok) { box.append(h('p', { class: 'hint' }, (R?.errors || ['RTA needs 3 or more producing months.']).join(' '))); return; }
  const P = R.points || [], lf = R.linear_flow || {}, fmb = R.flowing_material_balance;
  const head = h('div', { class: 'panel-card' }, h('h3', {}, `${w.id}: rate-transient analysis`),
    h('ul', { class: 'plain' },
      lf.a_sqrt_k_ft2_sqrt_md != null ? h('li', {}, h('span', {}, 'Linear flow, A√k (apparent)'), h('strong', {}, `${num(lf.a_sqrt_k_ft2_sqrt_md)} ft²·√md`)) : null,
      lf.per_stage_ft2_sqrt_md != null ? h('li', {}, h('span', {}, 'A√k per stage'), h('strong', {}, `${num(lf.per_stage_ft2_sqrt_md, 1)} ft²·√md`)) : null,
      fmb?.contacted_oil_in_place_stb != null ? h('li', {}, h('span', {}, 'Contacted oil in place (FMB)'), h('strong', {}, bbl(fmb.contacted_oil_in_place_stb))) : null,
      fmb?.expansion_recovery_stb != null ? h('li', {}, h('span', {}, 'Recoverable by expansion'), h('strong', {}, bbl(fmb.expansion_recovery_stb))) : null,
      R.loglog_slope != null ? h('li', {}, h('span', {}, 'Log-log slope of rate'), h('strong', {}, `${num(R.loglog_slope, 2)} (−0.5 is linear flow)`)) : null),
    lf.area_convention ? h('p', { class: 'hint' }, lf.area_convention) : null, fmb?.note ? h('p', { class: 'hint' }, fmb.note) : null);
  box.append(head);
  const grid = h('div', { class: 'diag-row3' }); box.append(grid);
  const slope = lf.slope_psi_per_stbd_sqrt_day;
  grid.append(scatter({ title: 'Δp/q against √t', note: 'A straight line through the origin is linear flow from the fractures; its slope gives A√k.',
    x: P.map(p => p.sqrt_t), y: P.map(p => p.dp_over_q), xl: '√days', yl: 'psi / (stb/d)', line: slope ? (x) => slope * x : null }));
  grid.append(scatter({ title: 'Flowing material balance', note: 'Normalised rate against normalised cumulative; where the trend meets zero is the oil the well contacts.',
    x: P.map(p => p.np_over_dp), y: P.map(p => p.q_over_dp), xl: 'Np/Δp', yl: 'q/Δp', vline: fmb?.x_intercept }));
  grid.append(scatter({ title: 'Rate against time, log-log', note: 'A slope of −1/2 is linear flow; steepening means the drainage is reaching its boundaries.',
    x: P.map(p => p.t_days), y: P.map(p => p.q_stb_d), xl: 'days', yl: 'stb/d', logX: true, logY: true }));
  if (R.notes?.length) box.append(h('ul', { class: 'notes' }, ...R.notes.map(n => h('li', {}, n))));
}

function scatter(o) {
  const card = h('div', { class: 'panel-card' });
  const pts = o.x.map((x, i) => [x, o.y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.logX || x > 0) && (!o.logY || y > 0));
  if (!pts.length) { card.append(h('h3', {}, o.title), h('p', { class: 'hint' }, 'Not enough data yet.')); return card; }
  const tx = o.logX ? Math.log10 : (v) => v, ty = o.logY ? Math.log10 : (v) => v;
  let x0 = Math.min(...pts.map(p => tx(p[0]))), x1 = Math.max(...pts.map(p => tx(p[0]))), y0 = Math.min(...pts.map(p => ty(p[1]))), y1 = Math.max(...pts.map(p => ty(p[1])));
  if (!o.logX) x0 = Math.min(0, x0); if (!o.logY) y0 = Math.min(0, y0);
  if (o.vline != null && !o.logX) x1 = Math.max(x1, o.vline);
  const px = (x1 - x0) * 0.06 || 1, py = (y1 - y0) * 0.08 || 1; x1 += px; y1 += py; if (o.logX) x0 -= px; if (o.logY) y0 -= py;
  const W = 380, H = 250, m = { l: 58, r: 10, t: 10, b: 36 };
  const X = (v) => m.l + (tx(v) - x0) / (x1 - x0) * (W - m.l - m.r), Y = (v) => H - m.b - (ty(v) - y0) / (y1 - y0) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'scat', role: 'img', 'aria-label': o.title });
  const fmt = (v) => (Math.abs(v) >= 1000 ? `${num(v / 1000, 1)}k` : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : num(v, Math.abs(v) < 10 ? 2 : 0));
  const ticks = (a, b, log) => log ? Array.from({ length: Math.floor(b) - Math.ceil(a) + 1 }, (_, i) => 10 ** (Math.ceil(a) + i)) : Array.from({ length: 5 }, (_, i) => a + (b - a) * i / 4);
  for (const v of ticks(x0, x1, o.logX)) { sv('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: 'grid' }, s); sv('text', { x: X(v), y: H - m.b + 14, 'text-anchor': 'middle' }, s).textContent = fmt(v); }
  for (const v of ticks(y0, y1, o.logY)) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, s); sv('text', { x: m.l - 5, y: Y(v) + 3, 'text-anchor': 'end' }, s).textContent = fmt(v); }
  sv('text', { x: (W + m.l) / 2, y: H - 4, 'text-anchor': 'middle' }, s).textContent = o.xl;
  sv('text', { x: 10, y: (H - m.b) / 2, transform: `rotate(-90 10 ${(H - m.b) / 2})`, 'text-anchor': 'middle' }, s).textContent = o.yl;
  if (o.line) { const a = o.logX ? 10 ** x0 : Math.max(0, x0), b = o.logX ? 10 ** x1 : x1; sv('line', { x1: X(a), y1: Y(o.line(a)), x2: X(b), y2: Y(o.line(b)), class: 'fit' }, s); }
  if (o.vline != null) { sv('line', { x1: X(o.vline), x2: X(o.vline), y1: m.t, y2: H - m.b, class: 'fit' }, s); }
  for (const [x, y] of pts) sv('circle', { cx: X(x), cy: Y(y), r: 3.5, class: 'sp' }, s);
  card.append(h('h3', {}, o.title), s, h('p', { class: 'hint' }, o.note));
  return card;
}

// ---------------------------------------------------------------- probabilistic EUR (#2): a history-match fan
async function renderEUR(box, C, w, monthName) {
  const get = async () => { try { return await (await fetch(`/api/career/eur?id=${encodeURIComponent(C.id)}&well=${encodeURIComponent(w.id)}`)).json(); } catch { return null; } };
  const draw = (R) => {
    box.replaceChildren(h('h3', {}, `${w.id}: probabilistic EUR`));
    const st = R?.status || 'none';
    if (st === 'none' || st === 'failed') {
      const b = h('button', { type: 'button', class: 'small-btn do' }, st === 'failed' ? 'Try the history match again' : 'Run a probabilistic history match (30 to 90 s)');
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Starting…';
        await fetch('/api/career/eur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: C.id, well: w.id }) }).catch(() => null);
        poll();
      });
      box.append(h('p', { class: 'hint' }, 'Samples the rock and the design around your map, runs each on the simulator, keeps the matches to this well’s history, and gives a P90, P50 and P10 EUR with a forecast fan.'), b);
      return;
    }
    if (st === 'running') { box.append(h('p', { class: 'hint', role: 'status' }, 'History matching on the simulator… this takes 30 to 90 seconds.')); return; }
    const r = R.result, E = r.eur_oil_bbl, F = r.fan;
    box.append(h('div', { class: 'tiles diag-tiles' }, ...[['P90 (low)', E.p90], ['P50', E.p50], ['P10 (high)', E.p10]].map(([l, v]) => h('div', {}, h('span', {}, l), h('strong', {}, bbl(v))))),
      h('p', { class: 'hint' }, `${r.kept?.length ?? '–'} of ${r.samples ?? '–'} samples kept, matched on ${r.months_matched} months (${bbl(r.cum_oil_bbl)} so far).`));
    const d = h('div'); box.append(d);
    multiChart(d, { title: 'Forecast fan, oil per month', note: 'P50 solid; P10 (high) and P90 (low) dashed.', x: F.month, xLabel: 'month', fmtY: (v) => num(v), fmtTipX: monthName,
      series: [{ name: 'P10 (high)', y: F.p10, color: COLORS.pdp, dash: true }, { name: 'P50', y: F.p50, color: COLORS.dev }, { name: 'P90 (low)', y: F.p90, color: COLORS.pdp, dash: '2 3' }] });
    if (r.notes?.length) box.append(h('ul', { class: 'notes' }, ...r.notes.map(n => h('li', {}, n))));
  };
  let tries = 0;
  const poll = async () => { const R = await get(); draw(R); if (R?.status === 'running' && box.isConnected && tries++ < 60) setTimeout(poll, 3000); };
  draw(await get());
  const R0 = await get(); if (R0?.status === 'running') poll();
}
