// Debottleneck: 2-4 wells into one separator. You get a few engineering studies (each a real ressim field run),
// then build one design. view {wells [{id, perm_md, thickness_ft, half_length_ft}], tubing_options {label: {id_in, usd_per_well}},
// facility_usd_per_bbl_d, months, studies [...], studies_left, built}
// Study and build results are drawn defensively: scalars as a list, per-well and total series as charts with the cap line.
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

const WELL_COLORS = ['#c98322', '#3d8be0', '#b7678f', '#5fa85e'];   // up to four wells; also direct-labelled
const pretty = (k) => k.replace(/_(usd|psi|bbl_d|in|ft|md)$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function render(v, host) {
  host.replaceChildren();
  host.append(h('div', { class: 'alarms' }, h('span', { class: 'tag' }, `${v.studies_left} studies left`), h('span', { class: 'tag' }, `Decision covers ${v.months} months`),
    h('span', { class: 'tag' }, `Facility capacity ${usd(v.facility_usd_per_bbl_d)} per bbl/d`), v.built ? h('span', { class: 'alarm-chip ok' }, 'Built') : null));
  const grid = h('div', { class: 'views' }); host.append(grid);
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'The wells'), h('table', { class: 'data' },
    // career-linked sessions hide the rock (no permeability): show only the columns the server sends
    ...(() => { const ws = v.wells || [], cols = [['id', 'Well', x => x], ['perm_md', 'Permeability', x => `${num(x * 1000, 1)} microdarcy`], ['thickness_ft', 'Thickness', x => `${num(x)} ft`],
        ['half_length_ft', 'Half-length', x => `${num(x)} ft`], ['lateral_ft', 'Lateral', x => `${num(x)} ft`]].filter(([k]) => ws.some(w => w[k] != null));
      return [h('thead', {}, h('tr', {}, ...cols.map(([, lab]) => h('th', {}, lab)))), h('tbody', {}, ...ws.map(w => h('tr', {}, ...cols.map(([k, , f]) => h('td', {}, w[k] != null ? f(w[k]) : '–')))))]; })()),
    h('h2', {}, 'Tubing'), h('ul', { class: 'plain' }, ...Object.entries(v.tubing_options || {}).map(([k, t]) => h('li', {}, h('span', {}, `${k}`), h('strong', {}, `${usd(t.usd_per_well)} a well`))))));
  const all = [...(v.studies || []).map((s, i) => [`Study ${i + 1}`, s]), ...(v.built ? [['Built design', v.built]] : [])];
  if (!all.length) host.append(h('p', { class: 'hint' }, 'Run an engineering study to see how a design performs before you build it. Each study is a real simulation of all the wells on one flowline.'));
  for (const [title, s] of all) host.append(studyCard(title, s));
}

function studyCard(title, s) {
  const card = h('div', { class: 'panel-card' }, h('h2', {}, title));
  const inp = s.design || s.inputs || {};
  const scal = Object.entries({ ...inp, ...s }).filter(([k, x]) => x != null && typeof x !== 'object' && !['design', 'inputs'].includes(k));
  if (scal.length) card.append(h('dl', { class: 'kv' }, ...scal.flatMap(([k, x]) => [h('dt', {}, pretty(k)), h('dd', {}, typeof x === 'number' ? (/usd|npv|cost|capex|cash/.test(k) ? usd(x) : num(x, Math.abs(x) < 10 && !Number.isInteger(x) ? 2 : 0)) : String(x).replace(/_/g, ' '))])));
  const ser = s.series || s;
  const x = ser.month || ser.months_axis;
  if (Array.isArray(x)) {
    const grid = h('div', { class: 'views' }); card.append(grid);
    const cap = ser.cap_bbl_d || (s.oil_cap_bbl_d != null ? x.map(() => s.oil_cap_bbl_d) : null);
    if (ser.total_oil_bbl_d) { const d = h('div'); grid.append(d);
      multiChart(d, { title: 'Total oil into the separator, bbl/d', x, xLabel: 'month', H: 200, W: 520, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
        series: [{ name: 'Total', y: ser.total_oil_bbl_d, color: COLORS.dev }, ...(cap ? [{ name: 'Cap', y: cap, color: '#c8463a', dash: '4 3' }] : [])] }); }
    const pw = ser.per_well || ser.oil_bbl_d_by_well;
    if (pw && typeof pw === 'object') { const d = h('div'); grid.append(d);
      multiChart(d, { title: 'Oil by well, bbl/d', x, xLabel: 'month', H: 200, W: 520, fmtY: (y) => num(y), fmtTipX: (m) => `Month ${m}`,
        series: Object.entries(pw).slice(0, 4).map(([id, y], i) => ({ name: id, y: Array.isArray(y) ? y : y.oil_bbl_d, color: WELL_COLORS[i] })) }); }
  }
  return card;
}

// sensible starting values instead of each range's minimum, and a real editor for the priority order
export function prefill(S) {
  const t = Object.keys(S.view?.tubing_options || {});
  const d = { separator_psi: 100, tubing: t[1] || t[0], oil_cap_bbl_d: 1500, allocation: 'pro_rata' };
  return { study: d, build: d };
}
export function field(action, arg, spec, S) {
  if (arg !== 'priority') return null;
  const ids = (S.view?.wells || []).map((w, i) => i + 1);
  let order = [...ids];
  const wrap = h('div', { class: 'field range' });
  const draw = () => wrap.replaceChildren(h('label', {}, 'Priority order ', h('span', { class: 'unit' }, '(used only with priority allocation; first gets oil first)')),
    h('div', { class: 'list-in' }, ...order.map((w, i) => h('span', { class: 'tag' }, `${i + 1}. W${w}`,
      i ? h('button', { type: 'button', class: 'small-btn', 'aria-label': `Move W${w} up`, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '↑') : null))));
  draw();
  return { el: wrap, get: () => [...order] };
}
