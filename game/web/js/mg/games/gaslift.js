// Gas lift: share a limited lift-gas supply across a pad's wells. Per well, the nodal plot (what the rock can deliver
// against what the tubing needs at each rate) and the lift response (oil against lift gas). The allocation sliders
// show the total oil live from those response curves, so the trade-off is visible before you commit.
// view {month, total_lift_gas_mscf_d, node_psi, wells[{id, half_length_ft, net_pay_ft, stages, tubing_id_in, depth_ft,
//       curve{bhp_psi[], oil_stb_d[], gas_mscf_d[], water_stb_d[]}, vlp_bhp_psi[], natural{...}|null, gaslift{gas_mscf_d[], oil_stb_d[]}}],
//       answers, oil_net_usd_bbl, lift_gas_usd_mcf, days_valued}
import { h, num, usd } from '../ui.js';
import { plot } from '../plots.js';

const interp = (xs, ys, x) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]); } return ys[ys.length - 1]; };
const oilAt = (w, g) => interp(w.gaslift.gas_mscf_d, w.gaslift.oil_stb_d, g);

export function render(v, host) {
  host.replaceChildren();
  const W = v.wells || [];
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `Lift gas available ${num(v.total_lift_gas_mscf_d)} Mscf/d`), h('span', { class: 'tag' }, `Separator at ${num(v.node_psi)} psi`),
    h('span', { class: 'tag' }, `Oil nets $${num(v.oil_net_usd_bbl)}/bbl; lift gas costs $${num(v.lift_gas_usd_mcf, 2)}/Mcf`), h('span', { class: 'tag' }, `Month ${v.month} of the pad’s life`)));
  const grid = h('div', { class: 'views' }); host.append(grid);
  for (const w of W) {
    const c = w.curve;
    grid.append(plot({ title: `${w.id}: nodal plot`, xl: 'oil, stb/d', yl: 'bottom-hole pressure, psi', W: 460, H: 250,
      series: [{ name: 'Inflow (the rock)', x: c.oil_stb_d, y: c.bhp_psi, color: '#c98322' }, { name: 'Outflow (the tubing)', x: c.oil_stb_d, y: w.vlp_bhp_psi, color: '#3d8be0', dash: true }],
      hy: w.natural ? [{ y: w.natural.bhp_psi, label: `flows naturally: ${num(w.natural.oil_stb_d)} stb/d` }] : [],
      note: w.natural ? `The curves cross: ${w.id} flows on its own at about ${num(w.natural.oil_stb_d)} stb/d.` : `The curves do not cross: ${w.id} cannot lift its own fluid and needs gas lift (or a pump).` }));
    grid.append(plot({ title: `${w.id}: oil against lift gas`, xl: 'lift gas, Mscf/d', yl: 'oil, stb/d', W: 460, H: 250,
      series: [{ name: 'Oil', x: w.gaslift.gas_mscf_d, y: w.gaslift.oil_stb_d, color: '#5fa85e', points: true }],
      note: `${num(w.half_length_ft)} ft half-length, ${num(w.net_pay_ft)} ft net pay, ${num(w.tubing_id_in, 2)} in tubing. Past the top of the curve more gas lifts less oil.` }));
  }
}

// one slider per well; the total and the oil it buys update live from the response curves
export function field(action, arg, spec, S) {
  if (action !== 'allocate' || arg !== 'gas_mscf_d') return null;
  const v = S.view || {}, W = v.wells || [], cap = v.total_lift_gas_mscf_d, step = spec.step || 50;
  const vals = (spec.default || W.map(() => Math.floor(cap / W.length / step) * step)).slice(0, W.length);
  const out = h('p', { class: 'hint gl-sum', role: 'status' });
  const upd = () => {
    const used = vals.reduce((a, b) => a + b, 0), oil = W.reduce((a, w, i) => a + oilAt(w, vals[i]), 0);
    const cost = used * (v.lift_gas_usd_mcf || 0), rev = oil * (v.oil_net_usd_bbl || 0);
    out.className = `hint gl-sum ${used > cap ? 'neg' : ''}`;
    out.textContent = `Using ${num(used)} of ${num(cap)} Mscf/d${used > cap ? ' (over the supply)' : ''}: about ${num(oil)} stb/d of oil, ${usd((rev - cost) * (v.days_valued || 365))} a year net of gas, on these curves.`;
  };
  const rows = W.map((w, i) => {
    const o = h('output', {}, `${num(vals[i])}`), r = h('input', { type: 'range', min: 0, max: spec.max || cap, step, 'aria-label': `Lift gas for ${w.id}` }); r.value = vals[i];
    r.addEventListener('input', () => { vals[i] = +r.value; o.textContent = num(vals[i]); upd(); });
    return h('div', { class: 'ctl' }, h('label', {}, h('span', {}, w.id), o), r);
  });
  upd();
  return { el: h('div', { class: 'field range' }, h('label', {}, 'Lift gas per well ', h('span', { class: 'unit' }, '(Mscf/d)')), ...rows, out), get: () => vals.slice() };
}
