// Kick!: drill, notice the kick, shut in, fill the kill sheet, pump kill mud on the drill-pipe schedule.
// Textbook hydrostatics (the server's notes say so). Phases: drilling -> shut_in -> kill_sheet -> pumping -> finished.
// view {phase, depth_ft, well {...capacities, scr_psi, mw_ppg, shoe_tvd_ft, shoe_fracture_emw_ppg...},
//       readings [{turn, depth_ft, rop_ft_hr, flow_out_pct, pit_gain_bbl}], shut_in {pit_gain_bbl, sidpp_psi, sicp_psi, tvd_ft},
//       answers, schedule [{strokes, dpp_psi}], pump [{step, strokes, dpp_psi, casing_psi, pit_gain_bbl}], next_strokes}
import { h, num } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

const PHASES = [['drilling', 'Drilling'], ['shut_in', 'Shut in'], ['kill_sheet', 'Kill sheet'], ['pumping', 'Pumping kill mud'], ['finished', 'Finished']];

export function render(v, host) {
  host.replaceChildren();
  const at = PHASES.findIndex(([k]) => k === v.phase);
  host.append(h('ol', { class: 'phases', 'aria-label': 'Where you are in the kill' }, ...PHASES.map(([k, lab], i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '' }, lab))));
  const grid = h('div', { class: 'views' }); host.append(grid);
  const R = v.readings || [];
  if (R.length) {
    const x = R.map(r => r.turn);
    for (const [k, title, c] of [['flow_out_pct', 'Flow out, % of flow in', COLORS.dev], ['pit_gain_bbl', 'Pit gain, bbl', COLORS.dev], ['rop_ft_hr', 'Rate of penetration, ft/hr', COLORS.pdp]]) {
      const d = h('div', { class: 'panel-card' }); grid.append(d);
      multiChart(d, { title, x, xLabel: 'turn', H: 180, W: 560, fmtY: (y) => num(y, k === 'pit_gain_bbl' ? 1 : 0), fmtTipX: (t) => `Turn ${t}`, series: [{ name: title.split(',')[0], y: R.map(r => r[k]), color: c }] });
    }
  }
  const W = v.well || {};
  const wellKV = Object.entries(W).filter(([, x]) => typeof x === 'number');
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, `The well, ${num(v.depth_ft)} ft drilled`), h('dl', { class: 'kv' }, ...wellKV.flatMap(([k, x]) => [h('dt', {}, label(k)), h('dd', {}, fmt(k, x))]))));
  const S = v.shut_in;
  if (S) grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Shut in: what the gauges say'), h('dl', { class: 'kv' },
    h('dt', {}, 'Pit gain'), h('dd', {}, `${num(S.pit_gain_bbl, 1)} bbl`), h('dt', {}, 'Shut-in drill-pipe pressure (SIDPP)'), h('dd', {}, `${num(S.sidpp_psi)} psi`),
    h('dt', {}, 'Shut-in casing pressure (SICP)'), h('dd', {}, `${num(S.sicp_psi)} psi`), h('dt', {}, 'True vertical depth'), h('dd', {}, `${num(S.tvd_ft)} ft`)),
    h('p', { class: 'hint' }, 'Kill mud weight = mud weight + SIDPP ÷ (0.052 × TVD). Initial circulating pressure = SIDPP + slow circulating rate pressure; final = SCR × kill weight ÷ mud weight.')));
  const sched = v.schedule || [], pump = v.pump || [];
  if (sched.length) {
    const d = h('div', { class: 'panel-card' }); grid.append(d);
    const xs = [...new Set([...sched.map(s => s.strokes), ...pump.map(p => p.strokes)])].sort((a, b) => a - b);
    multiChart(d, { title: 'Drill-pipe pressure: the schedule against what you held', x: xs, xLabel: 'strokes', H: 220, W: 560, fmtY: (y) => num(y), fmtTipX: (s) => `${num(s)} strokes`,
      series: [{ name: 'Schedule', y: xs.map(s => sched.find(q => q.strokes === s)?.dpp_psi ?? null), color: COLORS.pdp, dash: true },
        { name: 'You held', y: xs.map(s => pump.find(q => q.strokes === s)?.dpp_psi ?? null), color: COLORS.dev }] });
    if (pump.length) { const d2 = h('div', { class: 'panel-card' }); grid.append(d2);
      multiChart(d2, { title: 'Casing pressure while pumping, psi', note: W.maasp_psi ? `Keep it under the MAASP of ${num(W.maasp_psi)} psi or the shoe may break down.` : null, x: pump.map(p => p.strokes), xLabel: 'strokes', H: 200, W: 560, fmtY: (y) => num(y), fmtTipX: (s) => `${num(s)} strokes`,
        series: [{ name: 'Casing', y: pump.map(p => p.casing_psi), color: COLORS.dev }] }); }
    if (v.next_strokes != null) grid.append(h('p', { class: 'hint' }, `Next reading at ${num(v.next_strokes)} strokes.`));
  }
}
const label = (k) => k.replace(/_(ppg|psi|ft|bbl|bbl_ft|in)$/, (m) => ` (${m.slice(1).replace('_', '/')})`).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bmw\b/i, 'Mud weight').replace(/\bscr\b/i, 'Slow circulating rate pressure').replace(/\bemw\b/i, 'EMW').replace(/\btvd\b/i, 'TVD');
const fmt = (k, x) => num(x, Math.abs(x) < 1 && x !== 0 ? 4 : /ppg/.test(k) ? 2 : 0);   // small capacities (bbl/ft, bbl/stroke) keep their digits
