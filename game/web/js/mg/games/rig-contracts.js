// Rig contracts: drill a target number of wells; contract rigs on term or hire on spot against a moving market.
// view {month, months, target_wells, wells_drilled, wells_per_rig_month, rigs_needed_per_month,
//       market {month[], spot_usd_day[], spot_now_usd_day, term_offers [{months, usd_day}], broker_outlook [{month, usd_day}], long_run_usd_day},
//       fleet [{id, type, until_month, usd_day, release_fee_usd}], utilisation {month[], used[], contracted[]}, costs_usd, terms}
// result.lookback {spot path, regime[], hindsight_plan}
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const M = v.market || {};
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `Month ${v.month} of ${v.months}`),
    h('span', { class: 'tag' }, `Wells drilled ${v.wells_drilled} of ${v.target_wells}`), h('span', { class: 'tag' }, `${num(v.wells_per_rig_month, 1)} wells per rig-month`),
    h('span', { class: 'tag' }, `About ${num(v.rigs_needed_per_month, 1)} rigs needed`), h('span', { class: 'tag' }, `Spot now ${usd(M.spot_now_usd_day)}/day`),
    v.costs_usd != null ? h('span', { class: 'tag' }, `Spent ${usd(typeof v.costs_usd === 'object' ? Object.values(v.costs_usd).reduce((a, b) => a + (+b || 0), 0) : v.costs_usd)}`) : null));
  const grid = h('div', { class: 'views' }); host.append(grid);
  if (M.spot_usd_day?.length) {
    const d = h('div', { class: 'panel-card' }); grid.append(d);
    // history plus the broker's outlook (a forecast, drawn dashed and named as such)
    const out = M.broker_outlook || [];
    const xs = [...M.month, ...out.map(o => o.month).filter(m => m > M.month[M.month.length - 1])];
    const hist = xs.map(m => { const i = M.month.indexOf(m); return i >= 0 ? M.spot_usd_day[i] : null; });
    const fc = xs.map(m => { const o = out.find(q => q.month === m); return o ? o.usd_day : (m === M.month[M.month.length - 1] ? M.spot_now_usd_day : null); });
    multiChart(d, { title: 'Spot rig rate, $/day', note: 'Solid: what happened. Dashed: the broker’s outlook, which is a guess.', x: xs, xLabel: 'month', H: 210, W: 560, fmtY: usd, fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Spot', y: hist, color: COLORS.dev }, ...(out.length ? [{ name: 'Broker outlook', y: fc, color: COLORS.dev, dash: true }] : []),
        ...(M.long_run_usd_day ? [{ name: 'Long-run average', y: xs.map(() => M.long_run_usd_day), color: COLORS.pdp, dash: '2 3', tip: false }] : [])] });
  }
  const U = v.utilisation || {};
  if (U.used?.length) { const d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Rigs working against rigs under contract', x: U.month, xLabel: 'month', H: 210, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Working', y: U.used, color: COLORS.dev }, { name: 'Contracted', y: U.contracted, color: COLORS.pdp, dash: true }] }); }
  const fleet = v.fleet || [];
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Your rigs'), fleet.length ? h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ...['Rig', 'Contract', 'Until', 'Rate', 'Early release fee'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...fleet.map(r => h('tr', {}, h('td', {}, r.id), h('td', {}, r.type), h('td', {}, r.type === 'spot' ? 'month to month' : `month ${r.until_month}`), h('td', {}, `${usd(r.usd_day)}/day`), h('td', {}, r.release_fee_usd ? usd(r.release_fee_usd) : '–'))))) : h('p', { class: 'hint' }, 'No rigs yet: contract one on term or hire one on spot.'),
    (M.term_offers || []).length ? h('div', {}, h('h2', {}, 'Term offers now'), h('ul', { class: 'plain' }, ...M.term_offers.map(o => h('li', {}, h('span', {}, `${o.months} months`), h('strong', {}, `${usd(o.usd_day)}/day`))))) : null,
    v.terms ? h('p', { class: 'hint' }, typeof v.terms === 'string' ? v.terms : Object.entries(v.terms).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${typeof x === 'number' ? num(x, 2) : x}`).join('; ')) : null));
}
export function result(R, box) {
  const lb = R.lookback; if (!lb) return;
  const spot = lb.spot_usd_day || lb.spot || lb.spot_path;
  if (Array.isArray(spot) && spot.length) {
    const d = h('div'); box.append(d);
    multiChart(d, { title: 'The whole rate path, revealed', x: (lb.month || spot.map((_, i) => i)), xLabel: 'month', H: 170, W: 420, fmtY: usd, fmtTipX: (m) => `Month ${m}`, series: [{ name: 'Spot', y: spot, color: COLORS.dev }] });
  }
  if (lb.hindsight_plan) box.append(h('p', { class: 'hint' }, 'With hindsight: ', typeof lb.hindsight_plan === 'string' ? lb.hindsight_plan : JSON.stringify(lb.hindsight_plan)));
}
