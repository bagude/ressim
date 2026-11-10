// Acquisition (A&D): a package for sale. The data room (each well's production), the seller's case, your own screen of
// it, rivals, and a sealed bid. The lookback reveals the true value and the rival bids (the winner's curse).
// view {phase, sections[{section, developed}], data_room[{id, section, lateral_ft, design, wells_per_section, months, oil_bbl[]}],
//       seller_case{pdp_npv10_usd, inventory_npv10_usd, asking_usd, price_usd_bbl, note}, rivals[], price_usd_bbl,
//       inventory_wells_per_section, outcome?}
// Your screen is your own arithmetic on the data room (decline fits), not the truth: labelled as such.
import { h, num, usd, sv } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

const bbl = (v) => (v == null ? '–' : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} MMbbl` : Math.abs(v) >= 1e3 ? `${num(v / 1e3)} kbbl` : `${num(v)} bbl`);

// Arps fit on monthly volumes from month 3 on (past the clean-up and peak): q = qi / (1 + b Di t)^(1/b)
function fit(oil, bMax) {
  const t0 = Math.min(2, oil.length - 1), pts = oil.slice(t0).map((q, i) => [i, q]).filter(([, q]) => q > 0);
  if (pts.length < 4) return null;
  let best = null;
  for (let b = 0; b <= bMax + 1e-9; b += 0.05) for (let lnDi = -5; lnDi <= 0.5; lnDi += 0.05) {
    const Di = Math.exp(lnDi), f = (t) => (b < 1e-3 ? Math.exp(-Di * t) : (1 + b * Di * t) ** (-1 / b));
    let sx = 0, n = 0; for (const [t, q] of pts) { sx += Math.log(q) - Math.log(f(t)); n++; }
    const lnqi = sx / n; let e = 0; for (const [t, q] of pts) e += (Math.log(q) - lnqi - Math.log(f(t))) ** 2;
    if (!best || e < best.e) best = { e, b, Di, qi: Math.exp(lnqi), t0, n: pts.length };
  }
  return best;
}
// remaining oil from today to 20 years of well life; the capped case switches to 10 %/yr terminal decline
function remaining(F, monthsDone, terminal) {
  if (!F) return null;
  const dmin = terminal ? 0.10 / 12 : 0;
  let q = null, sum = 0, switched = false;
  for (let m = monthsDone; m < 240; m++) {
    const t = m - F.t0;
    let qq = F.b < 1e-3 ? F.qi * Math.exp(-F.Di * t) : F.qi * (1 + F.b * F.Di * t) ** (-1 / F.b);
    const dNow = F.Di / (1 + F.b * F.Di * t);   // instantaneous nominal decline per month
    if (terminal && (switched || dNow < dmin)) { if (!switched) { switched = true; q = qq; } else q *= Math.exp(-dmin); qq = q; }
    sum += qq;
  }
  return sum;
}
function screen(v) {
  const W = (v.data_room || []).map(w => {
    const free = fit(w.oil_bbl, 2.0), capped = fit(w.oil_bbl, 0.6);
    return { w, free, capped, cum: w.oil_bbl.reduce((a, b) => a + b, 0), last: w.oil_bbl[w.oil_bbl.length - 1],
      remFree: remaining(free, w.months, false), remCap: remaining(capped, w.months, true) };
  });
  const sumFree = W.reduce((a, x) => a + (x.remFree || 0), 0), sumCap = W.reduce((a, x) => a + (x.remCap || 0), 0);
  // inventory: the seller values it at the best wells; a median well per 1,000 ft is the sober read
  const per = W.map(x => (x.cum + (x.remCap || 0)) / x.w.lateral_ft).sort((a, b) => a - b);
  const median = per[Math.floor(per.length / 2)], top = per.slice(-Math.max(1, Math.round(per.length / 3)));
  const best = top.reduce((a, b) => a + b, 0) / top.length;
  const S = v.seller_case || {};
  const pdp = sumFree > 0 ? S.pdp_npv10_usd * (sumCap / sumFree) : null, inv = best > 0 ? S.inventory_npv10_usd * (median / best) : null;
  return { W, sumFree, sumCap, pdp, inv, total: (pdp ?? 0) + (inv ?? 0), tailFactor: sumFree ? sumCap / sumFree : null, invFactor: best ? median / best : null };
}

export function render(v, host) {
  host.replaceChildren();
  const S = v.seller_case || {}, sc = screen(v);
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, v.phase === 'data room' ? 'Data room open' : String(v.phase)),
    h('span', { class: 'tag' }, `${(v.data_room || []).length} producing wells in ${(v.sections || []).length} sections`), h('span', { class: 'tag' }, `Oil at $${num(v.price_usd_bbl)}/bbl flat`),
    h('span', { class: 'tag' }, `Rivals: ${(v.rivals || []).join(', ')}`)));
  // the package and the two cases side by side
  const grid = h('div', { class: 'views' }); host.append(grid);
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The seller’s case'), h('dl', { class: 'kv' },
    h('dt', {}, 'Producing wells (PDP), NPV10'), h('dd', {}, usd(S.pdp_npv10_usd)), h('dt', {}, `Inventory (${v.inventory_wells_per_section} wells per open section)`), h('dd', {}, usd(S.inventory_npv10_usd)),
    h('dt', {}, h('strong', {}, 'Asking')), h('dd', {}, h('strong', {}, usd(S.asking_usd)))), S.note ? h('p', { class: 'hint' }, `How they built it: ${S.note}.`) : null),
    h('div', { class: 'panel-card' }, h('h2', {}, 'Your screen'), h('dl', { class: 'kv' },
      h('dt', {}, 'Remaining oil, uncapped tails (as the seller)'), h('dd', {}, bbl(sc.sumFree)),
      h('dt', {}, 'Remaining oil, b capped at 0.6, 10%/yr terminal'), h('dd', {}, bbl(sc.sumCap)),
      h('dt', {}, 'PDP, scaled by your tails'), h('dd', {}, usd(sc.pdp)),
      h('dt', {}, 'Inventory at a median well, not the best'), h('dd', {}, usd(sc.inv)),
      h('dt', {}, h('strong', {}, 'Your screen of the value')), h('dd', {}, h('strong', {}, usd(sc.total)))),
      h('p', { class: 'hint' }, `Your own arithmetic on the data room: it scales the seller’s numbers by how much their tails and best-well inventory lean on optimism (tails ×${num(sc.tailFactor, 2)}, inventory ×${num(sc.invFactor, 2)}). It is a screen, not the truth: the rock is hidden, and so are the rivals’ reads.`)));
  // the data room: every well's production, with both fits
  const room = h('div', { class: 'panel-card' }, h('h2', {}, 'Data room'), h('p', { class: 'hint' }, 'Each well’s monthly oil. Dashed: a decline fit with the tail free (how sellers fit); dotted: b capped at 0.6 (how a reserves auditor books).'));
  host.append(room);
  const small = h('div', { class: 'acq-grid' }); room.append(small);
  for (const x of sc.W) {
    const d = h('div'); small.append(d);
    const months = x.w.oil_bbl.map((_, i) => i + 1), horizon = Math.max(60, x.w.months + 24), mm = Array.from({ length: horizon }, (_, i) => i + 1);
    const curve = (F) => mm.map(m => { if (!F || m - 1 < F.t0) return null; const t = m - 1 - F.t0; return F.b < 1e-3 ? F.qi * Math.exp(-F.Di * t) : F.qi * (1 + F.b * F.Di * t) ** (-1 / F.b); });
    multiChart(d, { title: `${x.w.id}: ${x.w.months} months, ${bbl(x.cum)} so far`, x: mm, xLabel: 'month', H: 160, W: 360, logY: true, fmtY: (v2) => num(v2),
      series: [{ name: 'Oil', y: mm.map(m => (m <= months.length ? x.w.oil_bbl[m - 1] : null)), color: COLORS.dev, label: false },
        { name: `b ${num(x.free?.b, 2)}`, y: curve(x.free), color: COLORS.pdp, dash: true, label: false },
        { name: `b ${num(x.capped?.b, 2)}`, y: curve(x.capped), color: '#b7678f', dash: '2 3', label: false }] });
  }
  room.append(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Well', 'Section', 'Months', 'Cum oil', 'Last month', 'Fitted b', 'Remaining, uncapped', 'Remaining, capped'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...sc.W.map(x => h('tr', {}, h('td', {}, x.w.id), h('td', {}, x.w.section), h('td', {}, String(x.w.months)), h('td', {}, bbl(x.cum)), h('td', {}, `${num(x.last)} bbl`),
      h('td', {}, num(x.free?.b, 2)), h('td', {}, bbl(x.remFree)), h('td', {}, bbl(x.remCap))))))));
}

// the bid: a dollar figure with the asking price and your screen marked
export function field(action, arg, spec, S) {
  if (action !== 'bid' || arg !== 'bid_mm') return null;
  const v = S.view || {}, ask = (v.seller_case?.asking_usd || 0) / 1e6, mine = screen(v).total / 1e6;
  const cap = v.max_affordable_usd != null ? v.max_affordable_usd / 1e6 : null;   // career only: what the company can finance
  const max = cap != null ? Math.max(0, Math.floor(cap * 2) / 2) : Math.max(spec.max || 500, Math.ceil(ask * 1.2));
  const inp = h('input', { type: 'number', min: 0, max, step: spec.step || 0.5, 'aria-label': 'Your bid, $ MM' }); inp.value = Math.round(mine * 0.8 * 2) / 2;
  if (+inp.value > max) inp.value = max;
  const rng = h('input', { type: 'range', min: 0, max: cap != null ? max : Math.ceil(ask * 1.2), step: 0.5, 'aria-label': 'Your bid' }); rng.value = inp.value;
  inp.addEventListener('input', () => { rng.value = inp.value; }); rng.addEventListener('input', () => { inp.value = rng.value; });
  return { el: h('div', { class: 'field range' }, h('label', {}, 'Your sealed bid ', h('span', { class: 'unit' }, '($ MM)')), h('div', { class: 'acq-bid' }, rng, inp),
    h('p', { class: 'hint' }, `Asking ${num(ask, 1)}; your screen ${num(mine, 1)}.${cap != null ? ` The company can finance at most ${num(cap, 1)} (cash and credit, less what is already committed).` : ''} Bid at your value and you win only when you were too optimistic: shade it.`)),
    get: () => +inp.value };
}

export const ownBreakdown = true;   // the shell's generic breakdown list is replaced by the lookback below
export function result(R, box) {
  const b = R.breakdown || {};
  if (b.won == null) return;
  box.append(h('p', { class: b.won ? (b.value_created_usd >= 0 ? 'pos' : 'neg') : 'hint' }, b.won
    ? (b.value_created_usd >= 0 ? `You won and created ${usd(b.value_created_usd)}: you paid less than the package is worth.` : `You won, and overpaid by ${usd(-b.value_created_usd)}: the winner’s curse.`)
    : 'You did not win. Check what the winner paid against the true value.'),
    h('dl', { class: 'kv' }, h('dt', {}, 'True value'), h('dd', {}, usd(b.true_value_usd)), h('dt', {}, 'Your bid'), h('dd', {}, usd(b.bid_usd)),
      h('dt', {}, 'Seller asked'), h('dd', {}, usd(b.seller_asking_usd)), h('dt', {}, 'Best play'), h('dd', {}, b.benchmark_usd > 0 ? `${usd(b.benchmark_usd)}, just above the top rival` : 'walk away: no winning bid paid'),
      ...Object.entries(b.rival_bids_usd || {}).flatMap(([n, x]) => [h('dt', {}, n), h('dd', {}, usd(x))])));
}
