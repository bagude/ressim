// Pump the Job: the frac van. Draws the session `view`; the shell does actions, notes, log and result.
// Real shape (game/API.md "Minigames", pump-job):
//   phase design|done; series {t_min[], net_psi[], surface_psi: null (not modelled), rate_bpm[], ppa[], half_length_ft[], height_at_well_ft[]}
//   limits {max_surface_psi: null, note}; fracture {half_length_ft, height_up_ft, height_down_ft, propped_half_length_ft, width_in}
//   pay {top_ft, base_ft} (+ down, relative to the perforations); barriers [{top_ft, base_ft, stress_psi}]; alarms [screen_out | height_runaway]
//   schedule [{ppa, bbl}]; proppant_placed_lb; rock {...}; growth {profile {x_ft[], height_ft[]}, propped {...}, share_in_pay, efficiency, notes[]}
//   production {months, well {oil[], gas[], water[]}}; economics {npv10_usd, irr, payout_month, stage_cost_usd, completion_usd}
import { h, num, usd, sv } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

const ALARM = { height_runaway: 'Height runaway: the fracture grew through a barrier', screen_out: 'Screen-out: proppant packed off and the job stopped early' };

export function render(v, host, S0 = {}) {
  host.replaceChildren();
  const alarms = v.alarms || [];
  host.append(h('div', { class: 'alarms', role: 'status' }, alarms.length
    ? alarms.map(a => h('span', { class: 'alarm-chip' }, `⚠ ${ALARM[a] || String(a).replace(/_/g, ' ')}`))
    : h('span', { class: 'alarm-chip ok' }, v.phase === 'done' ? 'Stage placed without alarms' : 'Design the job, then pump it'),
    h('span', { class: 'tag' }, v.phase === 'done' || S0.status === 'finished' ? 'Pumped' : 'Designing')));
  const top = h('div', { class: 'views' }); host.append(top);
  const sk = h('div', { class: 'panel-card sketch' }, h('h2', {}, 'Fracture, side view')); top.append(sk);
  drawSketch(sk, v);
  if (v.clusters?.length) top.append(clusterCard(v));
  top.append(rockCard(v));
  const S = v.series || {}, t = S.t_min || [];
  if (t.length) {
    const charts = [
      ['net_psi', 'Net pressure in the fracture, psi', COLORS.dev, 'Surface treating pressure is not modelled (no wellbore friction or hydrostatics); this is the pressure above closure inside the fracture.'],
      ['half_length_ft', 'Half-length growth, ft', COLORS.dev], ['height_at_well_ft', 'Height at the wellbore, ft', COLORS.dev],
      ['rate_bpm', v.clusters?.length ? 'Stage slurry rate (all clusters), bbl/min' : 'Slurry rate per fracture, bbl/min', COLORS.pdp], ['ppa', 'Proppant concentration, lb/gal', COLORS.pdp],
    ];
    for (const [k, title, color, note] of charts) {
      if (!Array.isArray(S[k])) continue;
      const d = h('div', { class: 'panel-card' }); top.append(d);
      multiChart(d, { title, note, x: t, xLabel: 'min', H: 190, W: 560, fmtY: (y) => num(y, k === 'ppa' ? 1 : 0), fmtTipX: (x) => `${num(x, 1)} min`, series: [{ name: title.split(',')[0], y: S[k], color }] });
    }
  }
  if (Array.isArray(v.schedule) && v.schedule.length) {
    const tb = h('tbody', {}, ...v.schedule.map((s, i) => h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, s.ppa === 0 ? 'pad (no sand)' : `${num(s.ppa, 2)} lb/gal`), h('td', {}, num(s.bbl)))));
    top.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Pumped schedule'), h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Step'), h('th', {}, 'Proppant'), h('th', {}, 'Slurry bbl'))), tb),
      v.proppant_placed_lb != null ? h('p', { class: 'hint' }, `${num(v.proppant_placed_lb)} lb of proppant placed.`) : null));
  }
  if (v.growth?.notes?.length) host.append(h('ul', { class: 'notes' }, ...v.growth.notes.map(n => h('li', {}, n))));
}

// the stage from above: one fracture per perforation cluster, at its position along the lateral, sized by its own growth.
// Fluid splits by perforation friction and stress shadow; a big perf drop (limited entry) evens the split.
function clusterCard(v) {
  const C = v.clusters, n = C.length;
  const shares = C.map(c => c.fluid_share), spread = (Math.max(...shares) - Math.min(...shares)) * 100;
  const pos = C.map((c, i) => c.position_ft ?? i * 50), x0 = Math.min(...pos), x1 = Math.max(...pos);
  const span = Math.max(60, x1 - x0), xfMax = Math.max(100, ...C.map(c => c.half_length_ft || 0));
  const maxDrop = Math.max(500, ...C.map(c => c.perf_drop_psi || 0));
  const W = 560, H = 316, m = { l: 112, r: 40, t: 24, b: 100 }, mid = m.t + (H - m.t - m.b) / 2, half = (H - m.t - m.b) / 2;
  const X = (x) => m.l + (span ? (x - x0) / span : 0.5) * (W - m.l - m.r), Yh = (f) => f / xfMax * half;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${n} clusters; fluid shares ${shares.map(s2 => `${num(s2 * 100)}%`).join(', ')}` });
  sv('line', { x1: 8, x2: W - 8, y1: mid, y2: mid, stroke: '#e7e2d6', 'stroke-width': 3 }, svg);
  sv('text', { x: 6, y: mid - 6 }, svg).textContent = 'wellbore';
  sv('text', { x: 6, y: H - m.b + 50 }, svg).textContent = 'perf';
  sv('text', { x: 6, y: H - m.b + 64 }, svg).textContent = 'friction, psi';
  C.forEach((c, i) => {
    const x = X(pos[i]), hl = Yh(c.half_length_ft || 0), hp = Yh(Math.min(c.propped_half_length_ft || 0, c.half_length_ft || 0));
    const w = Math.max(4, 22 * c.fluid_share * n / 2);
    sv('rect', { x: x - w / 2, y: mid - hl, width: w, height: 2 * hl, rx: w / 2, fill: 'rgba(240,165,58,0.25)', stroke: '#f0a53a', 'stroke-width': 1.2 }, svg);
    if (hp > 0) sv('rect', { x: x - w / 2 + 1, y: mid - hp, width: w - 2, height: 2 * hp, rx: (w - 2) / 2, fill: 'rgba(201,131,34,0.75)' }, svg);
    sv('text', { x, y: mid - hl - 5, 'text-anchor': 'middle', 'font-weight': 700 }, svg).textContent = `${num(c.fluid_share * 100)}%`;
    // perforation friction bar below
    const by = H - m.b + 22, bh = 46 * (c.perf_drop_psi || 0) / maxDrop;
    sv('rect', { x: x - 9, y: by + 46 - bh, width: 18, height: Math.max(1, bh), fill: '#3d8be0', rx: 2 }, svg);
    sv('text', { x, y: by + 60, 'text-anchor': 'middle' }, svg).textContent = `${num(c.perf_drop_psi || 0)}`;
  });
  const sum = h('dl', { class: 'kv' },
    h('dt', {}, 'Clusters'), h('dd', {}, `${n}, ${C.map(c => `${num(c.half_length_ft)} ft`).join(' / ')} half-length`),
    h('dt', {}, 'Fluid split'), h('dd', {}, `${shares.map(s2 => `${num(s2 * 100)}`).join(' / ')}%, spread ${num(spread, 1)} points`),
    v.perf_friction_psi != null ? h('dt', {}, 'Perforation friction') : null, v.perf_friction_psi != null ? h('dd', {}, `${num(v.perf_friction_psi)} psi, paid for as horsepower`) : null,
    h('dt', {}, 'Stress shadow'), h('dd', {}, C.map(c => `${num(c.shadow_psi || 0)}`).join(' / ') + ' psi'));
  return h('div', { class: 'panel-card' }, h('h2', {}, 'Clusters along the stage, from above'), svg, sum,
    h('p', { class: 'hint' }, spread > 3
      ? 'The split is uneven: the outer clusters take more fluid because the inner ones sit in their neighbours’ stress shadow, and large perforations do little to resist it. Fewer, smaller holes (limited entry) add friction that evens the split, at the cost of horsepower.'
      : 'The split is even: perforation friction is high enough to dominate the stress shadow (limited entry). That friction is paid for as horsepower.'),
    h('p', { class: 'hint' }, 'Width shows each cluster’s share of the fluid; length is to scale with half-length; dark is propped.'));
}

function rockCard(v) {
  const r = v.rock || {}, mf = r.minifrac;
  return h('div', { class: 'panel-card' }, h('h2', {}, 'The rock'), h('dl', { class: 'kv' },
    h('dt', {}, 'Pay thickness'), h('dd', {}, r.pay_ft != null ? `${num(r.pay_ft)} ft` : '–'),
    h('dt', {}, 'Barrier stress contrast (above pay closure)'), h('dd', {}, mf ? `${num(mf.barrier_psi)} psi (minifrac)` : r.barrier_psi_estimate != null ? `about ${num(r.barrier_psi_estimate)} psi${typeof r.barrier_uncertainty === 'string' ? ` ${r.barrier_uncertainty.replace(/\s+%/, '%')}` : Number.isFinite(r.barrier_uncertainty) ? ` ± ${num(r.barrier_uncertainty)}` : ''}` : '–'),
    h('dt', {}, 'Closure stress'), h('dd', {}, r.closure_psi != null ? `${num(r.closure_psi)} psi` : '–'),
    h('dt', {}, 'Leak-off'), h('dd', {}, mf ? `${num(mf.leakoff_ft_sqrtmin, 4)} ft/√min (minifrac)` : r.leakoff_ft_sqrtmin_estimate != null ? `about ${num(r.leakoff_ft_sqrtmin_estimate, 4)} ft/√min` : '–'),
    h('dt', {}, "Young's modulus"), h('dd', {}, r.youngs_psi != null ? `${num(r.youngs_psi / 1e6, 2)} MM psi` : '–')),
    h('p', { class: 'hint' }, mf ? 'Measured by your minifrac.' : 'Estimates. A minifrac measures the barrier stress and leak-off before you commit the main job.'));
}

function drawSketch(host, v) {
  const f = v.fracture || {}, pay = v.pay || { top_ft: -50, base_ft: 50 }, bars = v.barriers || [], g = v.growth || {};
  const prof = g.profile?.x_ft?.length ? g.profile : null;
  const xf = f.half_length_ft || 0, up = f.height_up_ft || 0, dn = f.height_down_ft || 0;
  const xp = f.propped_half_length_ft ?? g.propped?.half_length_ft ?? 0;
  const maxH = prof ? Math.max(...prof.height_ft) / 2 : Math.max(up, dn);
  const depthMin = Math.min(pay.top_ft, ...bars.map(b => b.top_ft), -maxH) - 15, depthMax = Math.max(pay.base_ft, ...bars.map(b => b.base_ft), maxH) + 15;
  const xMax = Math.max(300, xf * 1.12);
  const W = 560, H = 300, m = { l: 54, r: 14, t: 14, b: 26 };
  const X = (x) => m.l + x / xMax * (W - m.l - m.r), Y = (d) => m.t + (d - depthMin) / (depthMax - depthMin) * (H - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Fracture ${num(xf)} ft long, about ${num(2 * maxH)} ft tall at the wellbore` });
  for (const b of bars) {
    sv('rect', { x: m.l, y: Y(b.top_ft), width: W - m.l - m.r, height: Math.max(0, Y(b.base_ft) - Y(b.top_ft)), fill: 'rgba(120,132,140,0.22)' }, svg);
    if (b.stress_psi) sv('text', { x: W - m.r - 4, y: Y(b.top_ft) + 13, 'text-anchor': 'end' }, svg).textContent = `barrier, +${num(b.stress_psi)} psi over pay closure`;
  }
  sv('rect', { x: m.l, y: Y(pay.top_ft), width: W - m.l - m.r, height: Y(pay.base_ft) - Y(pay.top_ft), fill: 'rgba(201,131,34,0.18)' }, svg);
  sv('text', { x: W - m.r - 4, y: Y(pay.top_ft) + 13, 'text-anchor': 'end' }, svg).textContent = 'pay';
  // fracture outline: the simulated height profile along the wing (symmetric about the perforations), else an ellipse
  const outline = (len) => {
    const top = [], bot = [];
    if (prof) prof.x_ft.forEach((x, i) => { if (x <= len + 1e-6) { top.push([X(x), Y(-prof.height_ft[i] / 2)]); bot.push([X(x), Y(prof.height_ft[i] / 2)]); } });
    else for (let k = 0; k <= 40; k++) { const s = k / 40, e = Math.sqrt(Math.max(0, 1 - s * s)); top.push([X(len * s), Y(-up * e)]); bot.push([X(len * s), Y(dn * e)]); }
    return top.length ? 'M' + [...top, ...bot.reverse()].map(p => p.join(',')).join('L') + 'Z' : '';
  };
  if (xf > 0) sv('path', { d: outline(xf), fill: 'rgba(240,165,58,0.25)', stroke: '#f0a53a', 'stroke-width': 1.5 }, svg);
  if (xp > 0) sv('path', { d: outline(Math.min(xp, xf)), fill: 'rgba(201,131,34,0.6)', stroke: 'none' }, svg);
  sv('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, stroke: '#e7e2d6', 'stroke-width': 3 }, svg);
  for (let d = Math.ceil(depthMin / 50) * 50; d <= depthMax; d += 50) sv('text', { x: m.l - 6, y: Y(d) + 4, 'text-anchor': 'end' }, svg).textContent = `${d > 0 ? '+' : ''}${d} ft`;
  for (let x = 0; x <= xMax; x += 100) sv('text', { x: X(x), y: H - 8, 'text-anchor': 'middle' }, svg).textContent = `${x} ft`;
  host.append(svg, h('dl', { class: 'kv' },
    h('dt', {}, 'Half-length'), h('dd', {}, `${num(xf)} ft`), h('dt', {}, 'Propped half-length'), h('dd', {}, `${num(xp)} ft`),
    h('dt', {}, 'Height at the wellbore'), h('dd', {}, `${num(up + dn)} ft`),
    g.share_in_pay != null ? h('dt', {}, 'Share of the fracture in the pay') : null, g.share_in_pay != null ? h('dd', {}, `${num(g.share_in_pay * 100)}%`) : null,
    g.efficiency != null ? h('dt', {}, 'Fluid efficiency') : null, g.efficiency != null ? h('dd', {}, `${num(g.efficiency * 100)}%`) : null),
    h('p', { class: 'hint' }, 'Depth relative to the perforations, positive down. Dark: the propped part of the wing. Height is symmetric about the perforations in this model.'));
}

// the proppant schedule: up to six steps of [start fraction of pump time, lb/gal], edited as a small table
export function field(action, arg, spec, S) {
  if (action !== 'pump' || arg !== 'schedule') return null;
  let rows = (S.view?.design_schedule || [[0, 0], [0.2, 0.5], [0.45, 1], [0.7, 2]]).map(r => [...r]);
  const max = spec.max_steps || 6;
  const wrap = h('div', { class: 'field range sched' });
  const draw = () => {
    wrap.replaceChildren(h('label', {}, 'Proppant schedule ', h('span', { class: 'unit' }, '(start at % of pump time, lb/gal)')),
      ...rows.map((r, i) => {
        const at = h('input', { type: 'number', min: 0, max: 95, step: 5, 'aria-label': `Step ${i + 1} starts at percent of pump time` }); at.value = Math.round(r[0] * 100);
        const ppa = h('input', { type: 'number', min: 0, max: 8, step: 0.25, 'aria-label': `Step ${i + 1} lb/gal` }); ppa.value = r[1];
        at.addEventListener('change', () => { r[0] = Math.min(0.95, Math.max(0, +at.value / 100)); });
        ppa.addEventListener('change', () => { r[1] = Math.max(0, +ppa.value); });
        if (i === 0) { at.disabled = true; }
        return h('div', { class: 'sched-row' }, h('span', {}, `Step ${i + 1}`), at, h('span', { class: 'unit' }, '%'), ppa, h('span', { class: 'unit' }, 'lb/gal'),
          i ? h('button', { type: 'button', class: 'small-btn', 'aria-label': `Remove step ${i + 1}`, onclick: () => { rows.splice(i, 1); draw(); } }, '×') : null);
      }),
      rows.length < max ? h('button', { type: 'button', class: 'small-btn', onclick: () => { const last = rows[rows.length - 1]; rows.push([Math.min(0.95, last[0] + 0.15), last[1] + 0.5]); draw(); } }, 'Add a step') : null,
      h('p', { class: 'hint' }, 'Step 1 is the pad (usually no sand). Ramp up: too much sand too early risks a screen-out.'));
  };
  draw();
  return { el: wrap, get: () => rows.map(r => [r[0], r[1]]).sort((a, b) => a[0] - b[0]) };
}

export function result(R, box, S) {
  const v = S.view || {}, P = v.production, E = v.economics;
  if (P?.well?.oil?.length) {
    const d = h('div'); box.append(d);
    multiChart(d, { title: 'Oil from this design, bbl per month', x: P.well.oil.map((_, i) => i + 1), xLabel: 'month', H: 170, W: 420, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Oil', y: P.well.oil, color: COLORS.dev }] });
  }
  if (E) box.append(h('dl', { class: 'kv' }, h('dt', {}, 'NPV10'), h('dd', {}, usd(E.npv10_usd)), h('dt', {}, 'IRR'), h('dd', {}, E.irr == null ? '–' : `${num(E.irr * 100)}%`),
    h('dt', {}, 'Payout'), h('dd', {}, E.payout_month == null ? 'never' : `${E.payout_month} months`), h('dt', {}, 'Stage cost'), h('dd', {}, usd(E.stage_cost_usd))),
    h('p', { class: 'hint' }, 'Stars compare your NPV with the company’s standard slickwater design in the same rock. Relative score = 1 + (yours − standard) ÷ the larger of |standard| and $2 MM, so it works even when the standard loses money.'));
}
