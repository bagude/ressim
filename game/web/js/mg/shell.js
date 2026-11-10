// Minigame hub and the generic session shell over ressim-83's /api/mg (game/API.md, "Minigames").
// session = {id, kind, title, status, turn, notes[], actions[{name, label, args{arg: {type, min, max, step, options, unit}}}],
//            view{...game specific}, result?{score, stars, headline, breakdown, lookback?}}
// Every game uses this shell; a game only adds a renderer for its `view` (js/mg/games/<kind>.js). Without one,
// the view is shown generically. ?mock=1 serves a local mock in the same shape until a game's endpoint is live.
import { h, num, usd } from './ui.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const MOCK = q.get('mock') === '1';
let mock = null;

async function call(path, body) {
  if (MOCK) { mock ||= await import('./mock.js'); return mock.handle(path, body); }
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return j || { ok: false, errors: [`${path}: HTTP ${r.status}`] };
}
const withMock = (u) => MOCK ? `${u}${u.includes('?') ? '&' : '?'}mock=1` : u;

// ------------------------------------------------------------------ hub
async function hub() {
  $('hub').hidden = false;
  let list = await call('/api/mg');
  if (!Array.isArray(list)) { $('hub-list').replaceChildren(h('li', { class: 'hint' }, `Minigames are not available on this server yet (${list?.errors?.join(' ') || 'no list'}). Try `, h('a', { href: '?mock=1' }, 'the preview with sample data'), '.')); return; }
  $('hub-list').replaceChildren(...list.map(g => {
    const best = bestStars()[g.kind];
    const tags = h('span', { class: 'meta' }, g.sim ? h('span', { class: 'tag' }, 'simulator') : h('span', { class: 'tag' }, 'light model'), g.status !== 'live' ? h('span', { class: 'tag' }, 'coming') : null,
      best != null ? h('span', { class: 'best', 'aria-label': `Your best: ${best} of 3 stars` }, '★'.repeat(best) + '☆'.repeat(3 - best)) : null);
    const inner = [h('strong', {}, g.title), h('span', { class: 'blurb' }, g.blurb), tags];
    return h('li', { class: (g.sim ? 'is-sim ' : '') + (g.status === 'live' ? '' : 'coming') },
      g.status === 'live' ? h('a', { href: withMock(`?game=${encodeURIComponent(g.kind)}`) }, ...inner) : h('div', {}, ...inner));
  }));
}

// best stars per game, kept in this browser
function bestStars() { try { return JSON.parse(localStorage.getItem('mg.best')) || {}; } catch { return {}; } }
function recordStars(kind, stars) {
  const b = bestStars(); if (stars == null || (b[kind] ?? -1) >= stars) return;
  b[kind] = stars; try { localStorage.setItem('mg.best', JSON.stringify(b)); } catch { /* private mode */ }
}

// ------------------------------------------------------------------ session shell
let S = null, renderer = null, busy = false;
const logKey = () => `mg.log.${S.kind}.${S.id}`;
function log(lines, cls = '') {
  const all = (() => { try { return JSON.parse(sessionStorage.getItem(logKey())) || []; } catch { return []; } })();
  for (const l of lines) all.push({ t: S.turn, text: l, cls: cls || (/runaway|pack-?off|screen-?out|alarm|kick|loss/i.test(l) ? 'alarm' : '') });
  try { sessionStorage.setItem(logKey(), JSON.stringify(all.slice(-200))); } catch { /* full */ }
  renderLog(all);
}
function renderLog(all) {
  if (!all) { try { all = JSON.parse(sessionStorage.getItem(logKey())) || []; } catch { all = []; } }
  $('mg-log').replaceChildren(...(all.length ? [...all].reverse().map(e => h('li', { class: e.cls }, h('span', { class: 'when' }, `Turn ${e.t} `), e.text)) : [h('li', { class: 'hint' }, 'Nothing yet.')]));
}

// one form per legal action, built from its args
function field(name, spec, value) {
  const id = `a-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const lab = h('label', { for: id }, spec.label || (name.charAt(0).toUpperCase() + name.slice(1)).replace(/_/g, ' '), spec.unit ? h('span', { class: 'unit' }, ` (${spec.unit})`) : null);
  if (spec.type === 'enum') {
    const sel = h('select', { id, name }, ...spec.options.map(o => h('option', { value: typeof o === 'object' ? o.value : o }, typeof o === 'object' ? o.label : String(o).replace(/_/g, ' '))));
    if (value != null) sel.value = value;
    return { el: h('div', { class: 'field' }, lab, sel), get: () => sel.value };
  }
  if (spec.type === 'bool') {
    const cb = h('input', { id, type: 'checkbox', name }); cb.checked = !!(value ?? spec.default);
    return { el: h('div', { class: 'field' }, lab, cb), get: () => cb.checked };
  }
  if (spec.type === 'list') {
    const n = spec.length || (Array.isArray(value) ? value.length : 4);
    const vals = Array.isArray(value) ? value : Array(n).fill(spec.default ?? spec.min ?? 0);
    const ins = vals.map((v, i) => { const x = h('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step ?? 'any', 'aria-label': `${name} ${i + 1}` }); x.value = v; return x; });
    return { el: h('div', { class: 'field range' }, lab, h('div', { class: 'list-in' }, ...ins)), get: () => ins.map(x => +x.value) };
  }
  // number / int: a slider when both bounds are known, always with an exact box
  const step = spec.step ?? (spec.type === 'int' ? 1 : 'any');
  const box = h('input', { id, type: 'number', name, min: spec.min, max: spec.max, step });
  box.value = value ?? spec.default ?? spec.min ?? 0;
  if (spec.min != null && spec.max != null) {
    const sl = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step ?? (spec.type === 'int' ? 1 : (spec.max - spec.min) / 200), 'aria-label': `${name} slider` });
    sl.value = box.value;
    sl.addEventListener('input', () => { box.value = sl.value; });
    box.addEventListener('input', () => { sl.value = box.value; });
    return { el: h('div', { class: 'field range' }, h('div', { class: 'field' }, lab, box), sl), get: () => spec.type === 'int' ? Math.round(+box.value) : +box.value };
  }
  return { el: h('div', { class: 'field' }, lab, box), get: () => spec.type === 'int' ? Math.round(+box.value) : +box.value };
}
function renderActions() {
  const box = $('mg-actions'); box.replaceChildren();
  if (S.status !== 'active' || !S.actions?.length) { $('mg-actions-card').hidden = S.status !== 'active'; return; }
  $('mg-actions-card').hidden = false;
  const prefill = renderer?.prefill?.(S) || {};
  for (const a of S.actions) {
    const fields = Object.entries(a.args || {}).map(([k, spec]) => [k, renderer?.field?.(a.name, k, spec, S) || field(k, spec, prefill[a.name]?.[k])]);   // a game can supply its own editor for an arg
    const go = h('button', { type: 'submit', class: 'board-go' }, a.label || a.name);
    const form = h('form', { class: 'act' }, h('div', { class: 'act-head' }, fields.length ? h('strong', {}, a.label || a.name) : null, fields.length ? null : go),
      ...fields.map(([, f]) => f.el), fields.length ? go : null);
    form.addEventListener('submit', (e) => { e.preventDefault(); act(a.name, Object.fromEntries(fields.map(([k, f]) => [k, f.get()]))); });
    box.append(form);
  }
}
async function act(action, args) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('#mg-actions button').forEach(b => { b.disabled = true; });
  $('mg-view').classList.add('busy-veil');
  $('mg-busy').textContent = S.sim ? 'Running the simulator: this can take 2 to 30 seconds.' : 'Working…';
  const r = await call(`/api/mg/${S.kind}/act`, { id: S.id, action, ...args });
  busy = false;
  $('mg-view').classList.remove('busy-veil');
  $('mg-busy').textContent = r.ok ? '' : (r.errors || ['Something went wrong.']).join(' ');
  if (r.ok) { S = r.session; if (r.events?.length) log(r.events); }
  render();
}
function renderResult() {
  const box = $('mg-result'), R = S.result;
  if (!R) { box.hidden = true; return; }
  box.hidden = false;
  recordStars(S.kind, R.stars);
  box.className = 'panel-card result';
  const bd = R.breakdown ? h('dl', { class: 'kv' }, ...Object.entries(R.breakdown).flatMap(([k, v]) => [h('dt', {}, pretty(k)), h('dd', {}, fmtVal(k, v))])) : null;
  const cid = S.link?.career;
  box.replaceChildren(...[h('h2', {}, R.headline || 'Result'),
    h('span', { class: 'stars-big', 'aria-label': `${R.stars} of 3 stars` }, '★'.repeat(R.stars || 0) + '☆'.repeat(3 - (R.stars || 0))),
    R.score != null && !R.breakdown ? h('p', {}, `Score ${fmtVal('score', R.score)}`) : null, bd,
    // a career task goes back to the career; a standalone game offers another round
    h('div', { class: 'strip-actions' }, cid ? h('a', { class: 'board-go', href: `career.html?id=${encodeURIComponent(cid)}&tab=home` }, 'Back to the career')
      : h('button', { type: 'button', class: 'board-go', onclick: () => newSession(S.kind) }, 'Play again'), h('a', { class: 'small-btn', href: withMock('minigames.html') }, 'All minigames'))].filter(Boolean));
  renderer?.result?.(R, box, S);
}
const LABELS = { npv10: 'NPV10', irr: 'IRR', eur: 'EUR', gor: 'GOR', bhp: 'BHP', ppa: 'lb/gal' };
export function pretty(k) {
  const base = k.replace(/_(usd|psi|ft|bbl|bbl_d|mcf|mcf_d|pct|min|in|mdft|lb|ppg)$/, '');
  const words = base.split('_').map(w => LABELS[w] || w).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function fmtVal(k, v) {
  if (v == null) return '–';
  if (typeof v === 'number' && /(^|_)ratio($|_)/.test(k)) return `${num(v, 2)}×`;   // relative score: 1 = matches the reference
  if (typeof v === 'number' && /(^|_)(share|efficiency)($|_)/.test(k)) return `${num(v * 100)}%`;
  if (typeof v === 'number') {
    if (/usd|cash|cost|capex|pnl|value|price/i.test(k)) return usd(v);
    if (/_ft$/.test(k)) return `${num(v)} ft`;
    if (/_psi$/.test(k)) return `${num(v)} psi`;
    if (/_bbl$/.test(k)) return `${num(v)} bbl`;
    if (/pct|percent/i.test(k)) return `${num(v, 1)}%`;
    return num(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 2 : 0);
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(x => fmtVal(k, x)).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([a, b]) => `${a.replace(/_/g, ' ')} ${fmtVal(a, b)}`).join('; ');
  return String(v);
}
// fallback view: scalars as a list, arrays of numbers as small charts
async function genericView(view, host) {
  const { multiChart, COLORS } = await import('../career/charts2.js');
  const scalars = Object.entries(view).filter(([, v]) => v == null || typeof v !== 'object');
  const blocks = [];
  if (scalars.length) blocks.push(h('div', { class: 'panel-card' }, h('dl', { class: 'kv' }, ...scalars.flatMap(([k, v]) => [h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, fmtVal(k, v))]))));
  host.replaceChildren(...blocks);
  for (const [k, v] of Object.entries(view)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const arrays = Object.entries(v).filter(([, a]) => Array.isArray(a) && a.length > 1 && a.every(x => x == null || typeof x === 'number'));
    if (arrays.length < 2) continue;
    const [xk, xs] = arrays[0];
    for (const [yk, ys] of arrays.slice(1)) {
      const d = h('div', { class: 'panel-card' }); host.append(d);
      multiChart(d, { title: `${yk.replace(/_/g, ' ')}`, x: xs, xLabel: xk.replace(/_/g, ' '), fmtY: (y) => fmtVal(yk, y), H: 200, series: [{ name: yk, y: ys, color: COLORS.dev }] });
    }
  }
}
async function render() {
  $('mg-title').textContent = S.title;
  $('mg-turn-k').hidden = $('mg-status-k').hidden = false;
  $('mg-turn').textContent = S.turn; $('mg-status').textContent = S.status;
  document.title = `${S.title}: Frac Challenge`;
  // a session that is a career task links back, and says its result will count in the career
  const link = S.link || S.career || null, cid = link?.career || link?.id;
  if (cid) {
    let back = document.getElementById('mg-back');
    if (!back) { back = h('a', { id: 'mg-back', class: 'workshop-link' }); document.querySelector('.cbar').insertBefore(back, document.querySelector('.cbar .workshop-link')); }
    back.href = `career.html?id=${encodeURIComponent(cid)}&tab=home`;
    back.textContent = `Back to career${link.pad ? `, pad ${link.pad}` : ''}${link.well ? `, well ${link.well}` : ''}`;
  }
  $('mg-notes').replaceChildren(...(cid ? [h('li', {}, h('strong', {}, 'Career task: '), 'the result of this game is applied to your career when you finish.')] : []), ...(S.notes || []).map(n => h('li', {}, n)));
  $('mg-notes').hidden = !(S.notes || []).length;
  if (renderer?.render) await renderer.render(S.view, $('mg-view'), S);
  else await genericView(S.view || {}, $('mg-view'));
  renderActions(); renderResult(); renderLog();
  window.__ready = true;
}
async function newSession(kind) {
  const r = await call(`/api/mg/${kind}/new`, {});
  if (!r.ok) { $('mg-busy').textContent = r.errors.join(' '); return; }
  location.href = withMock(`?game=${encodeURIComponent(kind)}&id=${r.session.id}`);
}

(async function boot() {
  const kind = q.get('game'), id = q.get('id');
  if (!kind) return hub();
  try { renderer = await import(`./games/${kind}.js`); } catch { renderer = null; }   // no renderer yet: generic view
  if (!id) return newSession(kind);
  const r = await call(`/api/mg/${kind}?id=${encodeURIComponent(id)}`);
  if (!r.ok) { $('hub').hidden = false; $('hub-list').replaceChildren(h('li', { class: 'hint' }, r.errors.join(' '))); return; }
  S = r.session;
  $('game').hidden = false;
  render();
})();
