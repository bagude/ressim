// Artificial lift: study a few lift plans on the real simulator, then install one.
// actions study/install {method: none|gas_lift|pump, switch_month, injection_mcf_d, intake_psi}
// view {well, studies [{plan, npv10_usd, oil_bbl_5yr, series {month[], bhp_psi[], oil_bbl_d[], gas_mcf_d[], method[]}}], natural_bhp_psi[], costs}
import { h, num, usd, sv } from '../ui.js';
import { multiChart } from '../../career/charts2.js';

const METHOD = { none: ['Natural flow', '#6f7d87'], natural: ['Natural flow', '#6f7d87'], gas_lift: ['Gas lift', '#3d8be0'], pump: ['Pump', '#c98322'] };
const PLAN_COLORS = ['#c98322', '#3d8be0', '#b7678f', '#5fa85e'];   // one per study, each direct-labelled

export function render(v, host) {
  host.replaceChildren();
  const W = v.well || {};
  host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The well'), h('dl', { class: 'kv' },
    ...Object.entries(W).filter(([, x]) => typeof x !== 'object').flatMap(([k, x]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, typeof x === 'number' ? num(x, Math.abs(x) < 10 && !Number.isInteger(x) ? 2 : 0) : String(x))])),
    v.costs ? h('p', { class: 'hint' }, 'Costs: ', Object.entries(v.costs).map(([k, x]) => `${k.replace(/_/g, ' ')} ${typeof x === 'number' ? (/usd/.test(k) ? usd(x) : num(x)) : x}`).join('; '), '.') : null));
  const studies = v.studies || [];
  if (!studies.length) { host.append(h('p', { class: 'hint' }, 'Study a lift plan to see it on the simulator: when to switch, and to what. Then install the one you trust.')); return; }
  // compare the studies: oil rate per plan on one chart, then each plan's lift band and bottom-hole pressure
  const x = studies[0].series?.month || [];
  const grid = h('div', { class: 'views' }); host.append(grid);
  const d = h('div', { class: 'panel-card' }); grid.append(d);
  multiChart(d, { title: 'Oil rate by plan, bbl/d', x, xLabel: 'month', H: 230, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
    series: studies.slice(0, 4).map((s, i) => ({ name: label(s, i), y: s.series?.oil_bbl_d || [], color: PLAN_COLORS[i] })) });
  const d2 = h('div', { class: 'panel-card' }); grid.append(d2);
  multiChart(d2, { title: 'Bottom-hole pressure by plan, psi', note: v.natural_bhp_psi ? 'Dashed: what the well would do on natural flow.' : null, x, xLabel: 'month', H: 230, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
    series: [...studies.slice(0, 4).map((s, i) => ({ name: label(s, i), y: s.series?.bhp_psi || [], color: PLAN_COLORS[i] })),
      ...(v.natural_bhp_psi ? [{ name: 'Natural flow', y: v.natural_bhp_psi, color: '#a9b0b3', dash: true }] : [])] });
  const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Plan', 'Method over time', 'Oil in 5 years', 'NPV10'].map(x2 => h('th', {}, x2)))));
  const tb = h('tbody');
  const best = Math.max(...studies.map(s => s.npv10_usd ?? -Infinity));
  studies.forEach((s, i) => tb.append(h('tr', s.npv10_usd === best ? { class: 'now' } : {}, h('td', {}, label(s, i)), h('td', {}, band(s.series?.method || [])),
    h('td', {}, `${num(s.oil_bbl_5yr)} bbl`), h('td', {}, usd(s.npv10_usd)))));
  t.append(tb);
  host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Your studies'), t,
    h('p', { class: 'hint' }, 'Band: ', ...Object.entries({ none: 0, gas_lift: 0, pump: 0 }).map(([k]) => h('span', { style: 'margin-right:10px' }, h('i', { style: `display:inline-block;width:10px;height:10px;background:${METHOD[k][1]};margin-right:4px;vertical-align:-1px` }), METHOD[k][0])), ' Highlighted: the best NPV so far.')));
}
function label(s, i) {
  const p = s.plan || {};
  return `${i + 1}. ${METHOD[p.method]?.[0] || p.method || 'plan'}${p.method && p.method !== 'none' && p.switch_month != null ? ` from month ${p.switch_month}` : ''}`;
}
function band(methods) {
  const W = 160, H = 12, svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Lift method over time' });
  methods.forEach((m, i) => sv('rect', { x: i / methods.length * W, y: 0, width: W / methods.length + 0.5, height: H, fill: METHOD[m]?.[1] || '#555' }, svg));
  return svg;
}
