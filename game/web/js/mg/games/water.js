// Water: each month, buy fresh water, rent recycling capacity, and split produced water between your own disposal
// wells and commercial disposal, without starving the frac crew or tripping the regulator.
// view {month, months, volume, schedule [{month, wells, demand_bbl}], produced_water_forecast_bbl[], storage_bbl, storage_cap_bbl,
//       fresh_permit_bbl_month, swd {capacity_bbl_month, permitted_bbl_month, cut}, pipeline {...}, prices {...},
//       history [{month, demand_bbl, fresh_bbl, recycled_bbl, used_bbl, short_bbl, produced_bbl, swd_injected_bbl, commercial_disposal_bbl, storage_end_bbl, regulator_cut, total_usd, cost_usd {...}}],
//       costs_usd {...}, total_cost_usd}
// Volumes and costs are illustrative logistics, not simulator output (the notes say so).
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const H = v.history || [], last = H[H.length - 1];
  host.append(h('div', { class: 'alarms', role: 'status' },
    v.swd?.cut ? h('span', { class: 'alarm-chip' }, '⚠ The regulator cut your disposal capacity (seismicity rule)') : h('span', { class: 'alarm-chip ok' }, 'Disposal at full capacity'),
    last?.short_bbl > 0 ? h('span', { class: 'alarm-chip' }, `⚠ ${num(last.short_bbl)} bbl short last month: the crew waited`) : null,
    h('span', { class: 'tag' }, `Month ${Math.min(v.month, v.months)} of ${v.months}`), h('span', { class: 'tag' }, `Volume: ${v.volume}`),
    h('span', { class: 'tag' }, `Spent ${usd(v.total_cost_usd)}`)));
  // the pit
  const fill = v.storage_cap_bbl ? v.storage_bbl / v.storage_cap_bbl : 0;
  const grid = h('div', { class: 'views' }); host.append(grid);
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'This month and next'),
    h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Month', 'Wells fracked', 'Frac water needed', 'Produced water forecast'].map(x => h('th', {}, x)))),
      h('tbody', {}, ...(v.schedule || []).map((s, i) => h('tr', s.month === v.month ? { class: 'now' } : {}, h('td', {}, String(s.month)), h('td', {}, String(s.wells)), h('td', {}, `${num(s.demand_bbl)} bbl`),
        h('td', {}, v.produced_water_forecast_bbl?.[i] != null ? `${num(v.produced_water_forecast_bbl[i])} bbl` : '–'))))),
    h('h2', {}, 'Pit storage'), h('div', { class: 'bar' }, h('span', { style: `width:${Math.min(100, fill * 100)}%` })),
    h('p', { class: 'hint' }, `${num(v.storage_bbl)} of ${num(v.storage_cap_bbl)} bbl. Overflow is wasted.`),
    h('dl', { class: 'kv' }, h('dt', {}, 'Fresh water permit'), h('dd', {}, `${num(v.fresh_permit_bbl_month)} bbl/month`),
      h('dt', {}, 'Your disposal wells'), h('dd', {}, `${num(v.swd?.capacity_bbl_month)} bbl/month${v.swd?.cut ? ' (cut)' : ''}`),
      h('dt', {}, 'Pipeline'), h('dd', {}, v.pipeline?.installed ? 'installed' : `not installed (${usd(v.pipeline?.capex_usd)} to build)`))));
  const P = v.prices || {};
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Prices'), h('dl', { class: 'kv' },
    ...Object.entries(P).flatMap(([k, x]) => [h('dt', {}, k.replace(/_usd_bbl$/, ' ($/bbl)').replace(/_usd$/, '').replace(/_/g, ' ')), h('dd', {}, /usd_bbl/.test(k) ? `$${num(x, 2)}` : usd(x))]))));
  if (H.length) {
    const x = H.map(r => r.month);
    let d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Frac water: needed against supplied, bbl', x, xLabel: 'month', H: 200, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Needed', y: H.map(r => r.demand_bbl), color: COLORS.pdp, dash: true }, { name: 'Used', y: H.map(r => r.used_bbl), color: COLORS.dev }] });
    d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Produced water disposal, bbl', x, xLabel: 'month', H: 200, W: 560, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Your disposal wells', y: H.map(r => r.swd_injected_bbl), color: COLORS.dev }, { name: 'Commercial disposal', y: H.map(r => r.commercial_disposal_bbl), color: COLORS.pdp }, { name: 'Recycled', y: H.map(r => r.recycled_bbl), color: '#5fa85e' }] });
  }
  const c = v.costs_usd || {};
  host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Costs so far'), h('dl', { class: 'kv' }, ...Object.entries(c).flatMap(([k, x]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, usd(x))]),
    h('dt', {}, h('strong', {}, 'Total')), h('dd', {}, h('strong', {}, usd(v.total_cost_usd))))));
}
