// PVT lab: take a fluid sample (how you take it decides whether it represents the reservoir), run the lab tests, and
// report the bubble point and formation volume factor the rest of the field work uses.
// view {reservoir_pressure_psia, samples[{id, method, label, cost_usd, sampling_pressure_psia, tests{cce{bubble_point_psia, rows[{pressure_psia,
//       relative_volume, y_function, oil_density_lb_ft3}]}, dl{bubble_point_psia, residual_oil_rb_stb, gas_gravity, rows[{pressure_psia,
//       rsd_scf_bbl, bod, btd, bg_rb_mscf}]}, separator{gor_scf_stb, oil_gravity_api, bo_rb_stb, bubble_point_psia, gas_gravity}}}],
//       samples_left, spent_usd, answers, costs{samples, tests}, methods{}}
import { h, num, usd } from '../ui.js';
import { plot } from '../plots.js';

const C = ['#c98322', '#3d8be0', '#b7678f'];

export function render(v, host) {
  host.replaceChildren();
  const Sm = v.samples || [];
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `Reservoir at ${num(v.reservoir_pressure_psia)} psia`), h('span', { class: 'tag' }, `${v.samples_left} sample${v.samples_left === 1 ? '' : 's'} left`),
    h('span', { class: 'tag' }, `Spent ${usd(v.spent_usd)}`)));
  const grid = h('div', { class: 'views' }); host.append(grid);
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Sampling'), h('dl', { class: 'kv' },
    ...Object.entries(v.methods || {}).flatMap(([k, l]) => [h('dt', {}, l), h('dd', {}, usd(v.costs?.samples?.[k]))])),
    h('p', { class: 'hint' }, `Lab tests: constant composition expansion ${usd(v.costs?.tests?.cce)}, differential liberation ${usd(v.costs?.tests?.dl)}, separator test ${usd(v.costs?.tests?.separator)}. A sample taken below the bubble point has lost gas: its bubble point reads low.`)));
  if (!Sm.length) return;
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Your samples'), h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ...['Sample', 'Method', 'Taken at', 'Bubble point (CCE)', 'Bubble point (DL)', 'Separator Bo', 'Separator GOR'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...Sm.map(s => h('tr', {}, h('td', {}, `#${s.id}`), h('td', {}, s.label || s.method), h('td', {}, `${num(s.sampling_pressure_psia)} psia`),
      h('td', {}, s.tests?.cce ? `${num(s.tests.cce.bubble_point_psia)} psia` : '–'), h('td', {}, s.tests?.dl ? `${num(s.tests.dl.bubble_point_psia)} psia` : '–'),
      h('td', {}, s.tests?.separator ? `${num(s.tests.separator.bo_rb_stb, 3)} rb/stb` : '–'), h('td', {}, s.tests?.separator ? `${num(s.tests.separator.gor_scf_stb)} scf/stb` : '–'))))))));
  const withCce = Sm.filter(s => s.tests?.cce), withDl = Sm.filter(s => s.tests?.dl);
  if (withCce.length) grid.append(plot({ title: 'Constant composition expansion: relative volume', xl: 'pressure, psia', yl: 'V / V at bubble point', W: 520, H: 260,
    series: withCce.map((s, i) => ({ name: `#${s.id}`, x: s.tests.cce.rows.map(r => r.pressure_psia), y: s.tests.cce.rows.map(r => r.relative_volume), color: C[i % 3], points: true })),
    vx: withCce.map(s => ({ x: s.tests.cce.bubble_point_psia, label: `Pb #${s.id}` })),
    note: 'Above the bubble point the oil only compresses (a gentle slope); below it gas comes out and the volume climbs fast. The break is the bubble point.' }));
  if (withDl.length) {
    grid.append(plot({ title: 'Differential liberation: solution gas-oil ratio', xl: 'pressure, psia', yl: 'Rs, scf/bbl', W: 520, H: 240,
      series: withDl.map((s, i) => ({ name: `#${s.id}`, x: s.tests.dl.rows.map(r => r.pressure_psia), y: s.tests.dl.rows.map(r => r.rsd_scf_bbl), color: C[i % 3], points: true })),
      note: 'Gas left in solution as the pressure falls below the bubble point.' }));
    grid.append(plot({ title: 'Differential liberation: oil formation volume factor', xl: 'pressure, psia', yl: 'Bo, rb/bbl', W: 520, H: 240,
      series: withDl.map((s, i) => ({ name: `#${s.id}`, x: s.tests.dl.rows.map(r => r.pressure_psia), y: s.tests.dl.rows.map(r => r.bod), color: C[i % 3], points: true })),
      note: `Residual oil ${withDl.map(s => `#${s.id} ${num(s.tests.dl.residual_oil_rb_stb, 3)}`).join(', ')} rb/stb. Report Bo from the separator test: that is the path the oil really takes to the stock tank.` }));
  }
}
