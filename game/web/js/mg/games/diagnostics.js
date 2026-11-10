// Read the Well: a noisy monthly production history. Find the downtime months, the frac hit, the flow regime, and
// estimate 10-year EUR. The answer form comes from the session's actions; this draws the evidence.
// view {history {month[], oil_bbl[], oil_bbl_d[]}, well, questions[]}
import { h, num } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const H = v.history || {}, x = H.month || [];
  const grid = h('div', { class: 'views' }); host.append(grid);
  if (H.oil_bbl_d) {
    let d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Oil rate, bbl/d (log scale)', note: 'On a log scale, steady decline looks like a gentle curve; a sudden dip and recovery is downtime; a step down that stays is often a frac hit from a neighbour.',
      x, xLabel: 'month', logY: true, H: 260, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`, series: [{ name: 'Oil rate', y: H.oil_bbl_d, color: COLORS.dev }] });
    // rate against cumulative: a straight line here suggests boundary-dominated exponential decline
    if (H.oil_bbl) {
      let cum = 0; const cumx = H.oil_bbl.map(q => (cum += q || 0));
      d = h('div', { class: 'panel-card' }); grid.append(d);
      multiChart(d, { title: 'Rate against cumulative oil', note: 'A straight line here points to exponential (boundary-dominated) decline; still curving means the well is in transient flow.',
        x: cumx, xLabel: 'cum bbl', H: 260, W: 560, fmtY: (y) => num(y), fmtX: (c) => `${num(c / 1e3)}k`, fmtTipX: (c) => `${num(c)} bbl cumulative`, series: [{ name: 'Oil rate', y: H.oil_bbl_d, color: COLORS.pdp }] });
    }
  }
  if (v.well && typeof v.well === 'object') host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The well'), h('dl', { class: 'kv' },
    ...Object.entries(v.well).filter(([, x2]) => typeof x2 !== 'object').flatMap(([k, x2]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, typeof x2 === 'number' ? num(x2, Math.abs(x2) < 10 && !Number.isInteger(x2) ? 2 : 0) : String(x2))]))));
  if ((v.questions || []).length) host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'What you are asked'), h('ol', {}, ...v.questions.map(q => h('li', {}, typeof q === 'string' ? q : q.prompt || q.label || q.id)))));
}
