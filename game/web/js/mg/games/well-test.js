// Well test: flow the well at a rate, shut it in, and read the pressure buildup. The log-log plot of the pressure change
// and its derivative is the analyst's core view: a half slope on the derivative is linear flow from the fractures,
// a flat derivative is radial flow; the level and timing give the permeability.
// view {well{...}, tests[{rate_stb_d, flow_days, shut_days, rate_held, flowing_pressure_psi, hours[], pressure_psi[], dp_psi[],
//       derivative_psi[], derivative_superposed_psi[], flow{days[], pressure_psi[], rate_stb_d[]}, crew_usd, deferred_bbl, deferred_usd, cost_usd}],
//       tests_left, answers, spent_usd, costs{...}, record_from_hours}
import { h, num, usd } from '../ui.js';
import { plot } from '../plots.js';

const C = ['#c98322', '#3d8be0', '#b7678f', '#5fa85e'];

export function render(v, host) {
  host.replaceChildren();
  const W = v.well || {}, T = v.tests || [];
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `${v.tests_left} test${v.tests_left === 1 ? '' : 's'} left`), h('span', { class: 'tag' }, `Spent ${usd(v.spent_usd)}`),
    h('span', { class: 'tag' }, `Producing ${num(W.current_rate_stb_d)} stb/d`)));
  const grid = h('div', { class: 'views' }); host.append(grid);
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The well'), h('dl', { class: 'kv' },
    ...[['Stages', W.stages], ['Fracture half-length', `${num(W.half_length_ft)} ft`], ['Fracture area (both faces)', `${num(W.fracture_area_ft2)} ft²`], ['Net pay', `${num(W.net_pay_ft)} ft`],
      ['Porosity', `${num(W.phi * 100, 1)}%`], ['Oil viscosity', `${num(W.viscosity_cp, 2)} cp`], ['Total compressibility', `${(W.total_compressibility_per_psi || 0).toExponential(1)} /psi`],
      ['Bo', `${num(W.bo_rb_stb, 3)} rb/stb`], ['Initial pressure', `${num(W.initial_pressure_psi)} psi`]].flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, String(b))])),
    h('p', { class: 'hint' }, `A test costs ${usd(v.costs?.mobilisation_usd)} to mobilise, ${usd(v.costs?.crew_usd_day)} a day, and the oil you defer (${v.costs?.deferred}).`)));
  if (!T.length) { grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Design the test'), h('p', {}, 'Flow the well at a steady rate, then shut it in and record the buildup. A longer shut-in reaches later flow regimes, but every day shut in defers oil.'))); return; }
  // log-log diagnostic: Δp and its derivative, every test on one plot
  grid.append(plot({ title: 'Diagnostic plot: pressure change and derivative (log-log)', xl: 'hours shut in', yl: 'psi', logX: true, logY: true, W: 560, H: 320,
    series: T.flatMap((t, i) => [{ name: `Δp, test ${i + 1}`, x: t.hours, y: t.dp_psi, color: C[i % 4] },
      { name: `derivative, test ${i + 1}`, x: t.hours, y: t.derivative_superposed_psi || t.derivative_psi, color: C[i % 4], dash: true, points: true, line: false }]),
    note: 'A derivative rising at slope ½ is linear flow from the fracture faces; a flat derivative is radial flow. Where the derivative bends tells you when the pressure front reached something new.' }));
  for (const [i, t] of T.entries()) {
    const days = [...(t.flow?.days || []), ...t.hours.map(hh => t.flow_days + hh / 24)], p = [...(t.flow?.pressure_psi || []), ...t.pressure_psi];
    grid.append(plot({ title: `Test ${i + 1}: pressure history`, xl: 'days', yl: 'psi', W: 560, H: 230,
      series: [{ name: 'BHP', x: days, y: p, color: C[i % 4] }], vx: [{ x: t.flow_days, label: 'shut in' }],
      note: `${num(t.flow_days)} days at ${num(t.rate_stb_d)} stb/d${t.rate_held ? '' : ' (the rate could not be held)'}, flowing at ${num(t.flowing_pressure_psi)} psi, then ${num(t.shut_days)} days shut in. Cost ${usd(t.cost_usd)}, of which ${usd(t.deferred_usd)} is ${num(t.deferred_bbl)} bbl deferred.` }));
  }
}

// permeability spans decades in tight rock: a log slider (0.00001 to 10 md) beside the number
export function field(action, arg, spec) {
  if (action !== 'interpret' || arg !== 'k_md') return null;
  const lo = Math.log10(Math.max(1e-6, spec.min ?? 1e-5)), hi = Math.log10(spec.max ?? 10);
  const box = h('input', { type: 'number', min: spec.min ?? 0, max: spec.max ?? 10, step: 'any', 'aria-label': 'Permeability, md' }); box.value = 0.001;
  const r = h('input', { type: 'range', min: lo, max: hi, step: 0.01, 'aria-label': 'Permeability, log scale' }); r.value = -3;
  r.addEventListener('input', () => { box.value = Number((10 ** +r.value).toPrecision(2)); });
  box.addEventListener('input', () => { if (+box.value > 0) r.value = Math.log10(+box.value); });
  return { el: h('div', { class: 'field range' }, h('label', {}, 'Permeability ', h('span', { class: 'unit' }, '(md, log scale)')), h('div', { class: 'acq-bid' }, r, box),
    h('p', { class: 'hint' }, 'From the linear-flow derivative level and the fracture area (A√k), or from a radial-flow plateau if the test reached one.')), get: () => +box.value };
}
