// Reserves (#3): the proved reserves you booked (PDP, PDNP, PUD), how they rolled forward over the year, and what the
// independent auditor found. view.reserves (game/API.md "Reserves (#3)").
import { h, num, sv } from '../mg/ui.js';

const bbl = (v) => (v == null ? '–' : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} MMbbl` : Math.abs(v) >= 1e3 ? `${num(v / 1e3)} kbbl` : `${num(v)} bbl`);
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${bbl(Math.abs(v))}`);
const CAT = [['pdp_bbl', 'Proved developed producing', '#c98322'], ['pdnp_bbl', 'Proved developed non-producing', '#3d8be0'], ['pud_bbl', 'Proved undeveloped', '#5fa85e']];
export const RESERVE_PARTS = { reserve_replacement: 'Reserve replacement', reserve_revisions: 'Reserve revisions', reserves_audit: 'Reserves audit' };

export function renderReserves(host, { C, monthName }) {
  host.replaceChildren(h('h2', {}, 'Reserves'));
  const R = C.reserves;
  if (!R?.latest) { host.append(h('p', { class: 'hint' }, 'Your first booking is made at the first budget meeting: proved reserves from your producing wells, the wells you have drilled, and the plan pads you will start within five years.')); return; }
  const L = R.latest;
  // the booking: stacked categories, one bar
  const tot = L.proved_bbl || CAT.reduce((a, [k]) => a + (L[k] || 0), 0);
  host.append(h('div', { class: 'panel-card' },
    h('h3', {}, `Proved reserves at ${monthName(L.month)}: ${bbl(tot)}`),
    h('div', { class: 'res-bar', role: 'img', 'aria-label': CAT.map(([k, l]) => `${l} ${bbl(L[k])}`).join(', ') },
      ...CAT.map(([k, l, c]) => h('i', { style: `flex:${Math.max(0, L[k] || 0)};background:${c}`, title: `${l}: ${bbl(L[k])}` }))),
    h('ul', { class: 'res-legend' }, ...CAT.map(([k, l, c]) => h('li', {}, h('i', { style: `background:${c}` }), h('span', {}, l), h('strong', {}, bbl(L[k]))))),
    h('p', { class: 'hint' }, `Booked at $${num(L.price_usd_bbl, 2)}/bbl, the trailing 12-month average oil price.`)));
  // audit and replacement
  const over = L.audit_over_pct;
  host.append(h('div', { class: 'tiles diag-tiles' },
    tile('Reserve replacement', L.reserve_replacement == null ? '–' : `${num(L.reserve_replacement * 100)}%`, 'reserves added for each barrel produced; the board wants at least 100%'),
    tile('Independent audit, developed', bbl(L.audit_developed_bbl), over == null ? '' : over > 15 ? `you booked ${num(over)}% more: the board marks you down` : over > 0 ? `you booked ${num(over)}% more (within 15%)` : `you booked ${num(-over)}% less: conservative`),
    tile('Undeveloped share', tot ? `${num(100 * (L.pud_bbl || 0) / tot)}%` : '–', 'PUDs must start within 5 years of booking or they are removed')));
  if (L.roll_forward) host.append(waterfall(L.roll_forward));
  // history
  const Hs = R.history || [];
  if (Hs.length) host.append(h('div', { class: 'panel-card' }, h('h3', {}, 'Bookings'), h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ...['Booked', 'Price', 'PDP', 'PDNP', 'PUD', 'Proved', 'Replacement', 'Audit (developed)', 'Over audit'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...Hs.map(r => h('tr', {}, h('td', {}, r.year ? `Year ${r.year} review` : `Opening, ${monthName(r.month)}`), h('td', {}, `$${num(r.price_usd_bbl, 2)}`),
      h('td', {}, bbl(r.pdp_bbl)), h('td', {}, bbl(r.pdnp_bbl)), h('td', {}, bbl(r.pud_bbl)), h('td', {}, h('strong', {}, bbl(r.proved_bbl))),
      h('td', {}, r.reserve_replacement == null ? '–' : `${num(r.reserve_replacement * 100)}%`), h('td', {}, bbl(r.audit_developed_bbl)),
      h('td', { class: r.audit_over_pct > 15 ? 'neg' : '' }, r.audit_over_pct == null ? '–' : `${num(r.audit_over_pct)}%`))))))));
  if (R.notes?.length) host.append(h('ul', { class: 'notes' }, ...R.notes.map(n => h('li', {}, n))));
}

function tile(a, b, c = '') { return h('div', {}, h('span', {}, a), h('strong', {}, b), c ? h('small', {}, c) : null); }

// the year's roll-forward: opening, each change, closing (floating bars from the running total)
function waterfall(rf) {
  // conversions move undeveloped to developed inside the total (net zero), so they are not a step of the total
  const steps = [['Opening', rf.opening_bbl, 'total'], ['Production', rf.production_bbl], ['Extensions', rf.extensions_bbl],
    ['PUD removals', rf.pud_removals_bbl], ['Revisions', rf.revisions_bbl], ['Closing', rf.closing_bbl, 'total']].filter(([, v, t]) => t || Math.abs(v || 0) > 0.5);
  let run = 0; const bars = steps.map(([l, v, t]) => { if (t) { run = v; return { l, a: 0, b: v, v, t }; } const a = run; run += v; return { l, a, b: run, v }; });
  const hi = Math.max(...bars.map(b => Math.max(b.a, b.b))) * 1.08 || 1, lo = Math.min(0, ...bars.map(b => Math.min(b.a, b.b)));
  const W = 760, H = 260, m = { l: 74, r: 12, t: 16, b: 46 }, bw = (W - m.l - m.r) / bars.length;
  const Y = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wfall', role: 'img', 'aria-label': `Reserves roll-forward: opening ${bbl(rf.opening_bbl)}, closing ${bbl(rf.closing_bbl)}` });
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, s); sv('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, s).textContent = bbl(v); }
  bars.forEach((b, i) => {
    const x = m.l + i * bw + bw * 0.15, w = bw * 0.7, y0 = Y(Math.max(b.a, b.b)), y1 = Y(Math.min(b.a, b.b));
    sv('rect', { x, y: y0, width: w, height: Math.max(1, y1 - y0), rx: 2, class: b.t ? 'tot' : b.v >= 0 ? 'up' : 'down' }, s);
    if (i + 1 < bars.length) sv('line', { x1: x + w, x2: x + bw * 1.15, y1: Y(b.b), y2: Y(b.b), class: 'link' }, s);
    sv('text', { x: x + w / 2, y: y0 - 4, 'text-anchor': 'middle', class: 'val' }, s).textContent = b.t ? bbl(b.v) : signed(b.v);
    sv('text', { x: x + w / 2, y: H - m.b + 16, 'text-anchor': 'middle' }, s).textContent = b.l;
  });
  return h('div', { class: 'panel-card' }, h('h3', {}, 'Roll-forward: how the year changed your reserves'), s,
    rf.pud_conversions_bbl ? h('p', {}, `PUD conversions: ${bbl(rf.pud_conversions_bbl)} moved from undeveloped to developed as you drilled them. That changes the category, not the total.`) : null,
    h('p', { class: 'hint' }, 'Production takes reserves out; new PUDs (extensions) put them in; removals are PUDs not started within five years of booking; revisions are everything else, including how your wells performed against what you booked and the price.'));
}
