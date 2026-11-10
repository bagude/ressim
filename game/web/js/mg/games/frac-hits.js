// Frac hits (parent-child): plan what to do with each producing parent well before fracking the child pad.
// view {phase, step, steps, stages_total, stages_done, frac_days, step_days, child {wells, stages_per_well, planned_bbl_stage, job_bbl_stage, value_usd, value_at_planned_usd},
//       parents [{id, distance_ft, rate_bopd, remaining_pv_usd, monitoring_hint, typical_hit_chance, status, planned {shut_in, preload, gauge}, gauge, readings[], hit_seen, hit_seen_step, shut_in_cost_usd}],
//       costs_usd {...}, prices {...}}
// Hit chances and losses are game rules from public ranges, not simulated (the server's notes say so).
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const P = v.parents || [], C = v.child || {};
  const hits = P.filter(p => p.hit_seen);
  host.append(h('div', { class: 'alarms', role: 'status' },
    hits.length ? hits.map(p => h('span', { class: 'alarm-chip' }, `⚠ Frac hit on ${p.id}${p.hit_seen_step != null ? ` at step ${p.hit_seen_step}` : ''}`)) : h('span', { class: 'alarm-chip ok' }, v.phase === 'plan' ? 'Plan the parents before you frac' : 'No hits seen on gauged parents'),
    h('span', { class: 'tag' }, `Stages ${v.stages_done} of ${v.stages_total}`), h('span', { class: 'tag' }, `Step ${v.step} of ${v.steps}, ${num(v.step_days, 1)} days each`),
    h('span', { class: 'tag' }, `Child pad: ${C.wells} wells × ${C.stages_per_well} stages`), h('span', { class: 'tag' }, `Job ${num(C.job_bbl_stage)} bbl/stage`)));
  const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Parent', 'Distance', 'Rate', 'Remaining value', 'Rock looks', 'Typical hit chance', 'Plan', 'Status'].map(x => h('th', {}, x)))));
  const tb = h('tbody');
  for (const p of P) {
    const plan = [p.planned?.shut_in && 'shut in', p.planned?.preload && 'pre-load', (p.planned?.gauge || p.gauge) && 'gauge'].filter(Boolean).join(', ') || 'leave producing';
    tb.append(h('tr', p.hit_seen ? { class: 'now' } : {}, h('td', {}, p.id, p.career_well ? h('span', { class: 'tag' }, p.career_well) : null), h('td', {}, `${num(p.distance_ft)} ft`), h('td', {}, `${num(p.rate_bopd)} bbl/d`), h('td', {}, usd(p.remaining_pv_usd)),
      h('td', {}, p.monitoring_hint === 'strong' ? 'well connected' : p.monitoring_hint === 'weak' ? 'poorly connected' : String(p.monitoring_hint)),
      h('td', {}, `${num(p.typical_hit_chance * 100)}%`), h('td', {}, plan), h('td', {}, p.hit_seen ? 'hit' : String(p.status).replace(/_/g, ' '))));
  }
  t.append(tb);
  host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Parent wells near the child pad'), h('div', { style: 'overflow-x:auto' }, t),
    h('p', { class: 'hint' }, `Shutting a parent in costs its production for the job plus a ${num(v.prices?.ramp_days)}-day ramp back. Pre-load ${usd(v.prices?.preload_usd)}, gauge ${usd(v.prices?.gauge_usd)} a well. Only gauged parents show a hit as it happens.`)));
  // gauge readings, one chart per gauged parent that has readings
  const gauged = P.filter(p => Array.isArray(p.readings) && p.readings.length);
  if (gauged.length) {
    const grid = h('div', { class: 'views' }); host.append(grid);
    for (const p of gauged) {
      const r = p.readings, x = r.map((q, i) => (typeof q === 'object' ? q.step ?? q.day ?? i : i)), y = r.map(q => (typeof q === 'object' ? q.psi ?? q.pressure_psi ?? q.value : q));
      const d = h('div', { class: 'panel-card' }); grid.append(d);
      multiChart(d, { title: `${p.id}: gauge pressure, psi`, note: 'A sharp jump means fluid from the child job reached this parent.', x, xLabel: 'step', H: 180, W: 560, fmtY: (q) => num(q), series: [{ name: 'Pressure', y, color: COLORS.dev }] });
    }
  }
  const costs = v.costs_usd || {};
  host.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The child pad and your costs'), h('dl', { class: 'kv' },
    h('dt', {}, 'Child value at this job size'), h('dd', {}, usd(C.value_usd)), h('dt', {}, 'At the planned job size'), h('dd', {}, usd(C.value_at_planned_usd)),
    ...Object.entries(costs).flatMap(([k, x]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, usd(x))]))));
}

// per-parent checkboxes instead of typing [0, 1, 0]
export function field(action, arg, spec, S) {
  if (action !== 'plan' || !['shut_in', 'preload', 'gauges'].includes(arg)) return null;
  const P = S.view?.parents || [], vals = [...(spec.default || P.map(() => 0))];
  const key = arg === 'gauges' ? 'gauge' : arg;
  P.forEach((p, i) => { if (p.planned?.[key]) vals[i] = 1; });
  const lab = { shut_in: 'Shut in during the job', preload: 'Pre-load (shut-in parents only)', gauges: 'Install a pressure gauge' }[arg];
  const boxes = P.map((p, i) => { const cb = h('input', { type: 'checkbox', 'aria-label': `${lab}: ${p.id}${p.career_well ? ` (${p.career_well})` : ''}` }); cb.checked = !!vals[i]; return [p, cb]; });
  return { el: h('div', { class: 'field range' }, h('label', {}, lab), h('div', { class: 'list-in' }, ...boxes.map(([p, cb]) => h('label', { class: 'check' }, cb, ` ${p.id}${p.career_well ? ` (${p.career_well})` : ''}`)))),
    get: () => boxes.map(([, cb]) => (cb.checked ? 1 : 0)) };
}
