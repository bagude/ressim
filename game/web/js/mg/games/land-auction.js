// Land auction: sealed bids, one round per tract slot; rivals' bids revealed when a round opens; winner's-curse lookback.
// view {round, rounds, budget_usd, start_budget_usd, paid_usd, appraisal_usd, appraisal_cost_usd, rivals[], won[],
//       tracts [{id, round, slot, acres, wells, open, appraised, estimate {eur_p90_boe, eur_p50_boe, eur_p10_boe, source,
//                value_p90_usd, value_p50_usd, value_p10_usd}, your_bid_usd?, winner?, winning_bid_usd?, bids {name: usd}}]}
import { h, num, usd, sv } from '../ui.js';

export function render(v, host) {
  host.replaceChildren();
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `Round ${Math.min(v.round, v.rounds)} of ${v.rounds}`),
    h('span', { class: 'tag' }, `Budget left ${usd(v.budget_usd)} of ${usd(v.start_budget_usd)}`), h('span', { class: 'tag' }, `Paid so far ${usd(v.paid_usd)}`),
    h('span', { class: 'tag' }, `Appraisal ${usd(v.appraisal_cost_usd)} a tract`), h('span', { class: 'tag' }, `Rivals: ${(v.rivals || []).join(', ')}`)));
  // a common value scale so tracts compare at a glance
  const ts = v.tracts || [];
  const lo = Math.min(0, ...ts.map(t => t.estimate?.value_p90_usd ?? 0)), hi = Math.max(1, ...ts.map(t => Math.max(t.estimate?.value_p10_usd ?? 0, ...Object.values(t.bids || {}))));
  const grid = h('div', { class: 'views' }); host.append(grid);
  for (const t of ts) {
    const e = t.estimate || {}, mine = (v.won || []).includes(t.id);
    const card = h('div', { class: 'panel-card' }, h('h2', {}, `Tract ${t.id}`, mine ? h('span', { class: 'tag' }, 'yours') : null, t.open ? h('span', { class: 'tag' }, 'bidding now') : null),
      h('p', { class: 'hint' }, `${num(t.acres)} acres, ${t.wells} wells. Round ${t.round}. Estimate from ${t.appraised ? 'your appraisal' : e.source || 'analogs'}.`),
      h('dl', { class: 'kv' }, h('dt', {}, 'EUR per well (BOE), P90 / P50 / P10'), h('dd', {}, `${num(e.eur_p90_boe / 1e3)} / ${num(e.eur_p50_boe / 1e3)} / ${num(e.eur_p10_boe / 1e3)} kBOE`),
        h('dt', {}, 'Value, P90 / P50 / P10'), h('dd', {}, `${usd(e.value_p90_usd)} / ${usd(e.value_p50_usd)} / ${usd(e.value_p10_usd)}`)));
    // value range against the bids: the band is the estimate, the ticks are the bids once revealed
    // each tract on its own scale (its estimate and the bids), so small tracts stay readable
    const tlo = Math.min(0, e.value_p90_usd ?? 0), thi = Math.max(1, e.value_p10_usd ?? 0, ...Object.values(t.bids || {}));
    const W = 520, H = 52, m = 12, X = (x) => m + (x - tlo) / (thi - tlo || 1) * (W - 2 * m);
    void lo; void hi;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Tract ${t.id} value range and bids` });
    sv('rect', { x: X(e.value_p90_usd ?? 0), y: 14, width: Math.max(2, X(e.value_p10_usd ?? 0) - X(e.value_p90_usd ?? 0)), height: 14, fill: 'rgba(201,131,34,0.35)', rx: 3 }, svg);
    sv('line', { x1: X(e.value_p50_usd ?? 0), x2: X(e.value_p50_usd ?? 0), y1: 10, y2: 32, stroke: '#c98322', 'stroke-width': 2 }, svg);
    sv('line', { x1: X(0), x2: X(0), y1: 6, y2: 36, stroke: 'rgba(169,176,179,0.5)' }, svg);
    sv('text', { x: X(0), y: 48, 'text-anchor': 'middle' }, svg).textContent = '$0';
    const bids = Object.entries(t.bids || {}).filter(([, b]) => b > 0);
    bids.forEach(([who, b]) => {
      const you = who === 'You', win = who === t.winner || (you && mine);
      sv('path', { d: `M${X(b)},34l-5,9h10Z`, fill: win ? '#f0a53a' : you ? '#e7e2d6' : '#7b8a94' }, svg);
    });
    const list = bids.length ? h('ul', { class: 'plain bids' }, ...[...bids].sort((a, b) => b[1] - a[1]).map(([who, b]) =>
      h('li', {}, h('span', {}, who === t.winner ? `▲ ${who}, winner` : `△ ${who}`), h('strong', {}, usd(b))))) : null;
    card.append(...[svg, list].filter(Boolean), h('p', { class: 'hint' }, t.winner ? `Won by ${t.winner === 'You' || mine ? 'you' : t.winner} at ${usd(t.winning_bid_usd)}.` : t.open ? 'Sealed bids: rivals’ bids appear when the round opens.' : 'Comes up in a later round.'));
    grid.append(card);
  }
  host.append(h('p', { class: 'hint' }, 'Band: the estimate’s P90 to P10 value, with P50 marked. Triangles: bids, the winning one in amber.'));
}
// lookback, keyed by tract: {round, wells, winner, paid_usd (what the winner paid; 0 if unleased), your_bid_usd, true_value_usd,
// true_eur_boe, analog_eur_boe, appraised_eur_boe, bids_usd, rival_estimates_eur_boe, benchmark_won}
export function result(R, box) {
  const lb = R.lookback; if (!lb || typeof lb !== 'object') return;
  const rows = Object.entries(lb).filter(([, x]) => x && typeof x === 'object' && 'true_value_usd' in x).map(([id, x]) => {
    const you = x.winner === 'You';
    const gain = x.winner ? x.true_value_usd - (x.paid_usd ?? 0) : null;   // the winner's gain, whoever won
    return h('tr', you ? { class: 'now' } : {}, h('td', {}, id), h('td', {}, x.winner ? (you ? 'You' : x.winner) : 'unleased'), h('td', {}, usd(x.paid_usd)),
      h('td', {}, usd(x.true_value_usd)), h('td', gain != null && gain < 0 ? { class: 'bad' } : {}, gain == null ? '–' : usd(gain)),
      h('td', {}, `${num((x.true_eur_boe ?? 0) / 1e3)} kBOE`), h('td', {}, `${num((x.analog_eur_boe ?? 0) / 1e3)}${x.appraised_eur_boe ? ` / ${num(x.appraised_eur_boe / 1e3)}` : ''} kBOE`),
      h('td', {}, x.your_bid_usd ? usd(x.your_bid_usd) : '–'));
  });
  if (rows.length) box.append(h('h2', {}, 'Lookback: what the tracts were really worth'),
    h('p', { class: 'hint' }, 'Gain is the winner’s: true value minus what they paid. The winner of a sealed auction is often whoever overestimated most, the winner’s curse.'),
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Tract', 'Winner', 'Paid', 'True value', 'Winner’s gain', 'True EUR/well', 'Estimate (analog / appraised)', 'Your bid'].map(x => h('th', {}, x)))), h('tbody', {}, ...rows))));
}
