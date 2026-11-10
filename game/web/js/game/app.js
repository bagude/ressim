// Frac Challenge: levels -> design -> run -> results, over one 3D view of the lease.
// URL: ?fixture=1|sandbox (saved responses, no simulator)  &level=<id>  &screen=design|results  &month=<index>
import * as THREE from 'three';
import { Stage } from '../engine/stage.js';
import { api, capex, per, fmt } from './api.js';
import { Reservoir, RAMP } from './reservoir.js';
import { lineChart, barChart } from './charts.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const stage = new Stage($('view'));
stage.scene.background = new THREE.Color('#16202a');
stage.gtao.enabled = false;   // AO darkened the flat pressure map about 4x; measured pixels match the legend only without it
stage.bloom.enabled = false;  // bloom lifted the brightest ramp step; with both off, read-back pixels equal the legend colours
const res = new Reservoir(stage);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('frac.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('frac.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let LEVELS = [], level = null, design = null, result = null, simState = 'warming';

// ------------------------------------------------------------------ simulator status pill
async function pollStatus() {
  simState = await api.status();
  const s = $('sim');
  s.dataset.state = simState;
  s.textContent = { ready: 'Simulator ready', warming: 'Simulator starting', error: 'Simulator error', off: 'Simulator off' }[simState] || simState;
  updateRunButton();
  if (simState === 'warming') setTimeout(pollStatus, 2000);
}

// ------------------------------------------------------------------ screens
function show(name) {
  for (const id of ['screen-levels', 'screen-design', 'screen-results']) $(id).hidden = id !== `screen-${name}`;
  if (name === 'results') $('screen-design').hidden = false;   // design stays visible, read-only summary
  $('timeline').hidden = name !== 'results' || !res.heat;
  document.body.dataset.screen = name;
}

function levelIndex(id) { return LEVELS.findIndex(l => l.id === id); }

function renderLevels() {
  const ol = $('level-list'); ol.replaceChildren();
  const best = store.get('best', {});
  LEVELS.forEach((l, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button';
    const t = document.createElement('span'); t.className = 'lv-name'; t.textContent = l.title;
    const d = document.createElement('span'); d.className = 'lv-brief'; d.textContent = l.brief;
    const s = document.createElement('span'); s.className = 'lv-stars'; s.setAttribute('aria-label', `${best[l.id] || 0} of 3 stars`);
    starsInto(s, best[l.id] || 0);
    b.append(t, d, s);
    b.addEventListener('click', () => openLevel(l.id));
    li.appendChild(b); ol.appendChild(li);
  });
  $('crumb').textContent = '';
}

// earned stars in amber, unearned ones as dim outlines
function starsInto(el, n) {
  el.replaceChildren();
  for (let i = 0; i < 3; i++) { const sp = document.createElement('span'); sp.textContent = i < n ? '★' : '☆'; if (i >= n) sp.className = 'star-off'; el.appendChild(sp); }
}

// ------------------------------------------------------------------ design
const CONTROL = {
  stages: { label: 'Stages', unit: '', step: 1, hint: 'Fractures placed evenly along the lateral' },
  half_length_ft: { label: 'Fracture half-length', unit: 'ft', step: 10, hint: 'How far each fracture reaches either side of the well' },
  conductivity_mdft: { label: 'Fracture conductivity', unit: 'md-ft', step: 1, hint: 'How easily oil flows along the propped fracture' },
  bhp_psi: { label: 'Bottom-hole pressure', unit: 'psi', step: 50, hint: 'Lower draws harder but needs artificial lift' },
};

function defaultDesign(l) {
  const c = l.controls, mid = (k) => {
    const [a, b] = c[k], st = CONTROL[k].step;
    return Math.min(b, Math.max(a, Math.round((a + (b - a) * 0.4) / st) * st));
  };
  const d = { stages: mid('stages'), half_length_ft: mid('half_length_ft'), conductivity_mdft: mid('conductivity_mdft'), bhp_psi: c.bhp_psi[0] === c.bhp_psi[1] ? c.bhp_psi[0] : 1500 };
  d.bhp_psi = Math.min(c.bhp_psi[1], Math.max(c.bhp_psi[0], d.bhp_psi));
  if (c.per_stage) { d.half_length_ft = Array(d.stages).fill(d.half_length_ft); d.conductivity_mdft = Array(d.stages).fill(d.conductivity_mdft); }
  return d;
}

function slider(key, value, onInput, { idx = null, compact = false } = {}) {
  const [lo, hi] = level.controls[key], C = CONTROL[key];
  const wrap = document.createElement('div'); wrap.className = 'ctl' + (compact ? ' compact' : '');
  const id = `c-${key}-${idx ?? 'all'}`;
  const lab = document.createElement('label'); lab.htmlFor = id;
  const name = document.createElement('span'); name.textContent = idx == null ? C.label : `Stage ${idx + 1}`;
  const val = document.createElement('output'); val.htmlFor = id;
  const setVal = (v) => { val.textContent = `${fmt.int(v)}${C.unit ? ' ' + C.unit : ''}`; };
  lab.append(name, val);
  const inp = document.createElement('input'); inp.type = 'range'; inp.id = id;
  inp.min = lo; inp.max = hi; inp.step = C.step; inp.value = value; inp.autocomplete = 'off';
  inp.addEventListener('input', () => { setVal(+inp.value); onInput(+inp.value); });
  setVal(value);
  wrap.append(lab, inp);
  if (!compact) { const h = document.createElement('p'); h.className = 'hint'; h.textContent = C.hint; wrap.appendChild(h); }
  return wrap;
}

function renderControls() {
  const box = $('controls'); box.replaceChildren();
  const c = level.controls;
  const fixed = (k) => c[k][0] === c[k][1];
  if (!fixed('stages')) box.appendChild(slider('stages', design.stages, (v) => {
    if (c.per_stage) {
      for (const k of ['half_length_ft', 'conductivity_mdft']) {
        const a = design[k]; while (a.length < v) a.push(a[a.length - 1]); a.length = v;
      }
      design.stages = v; renderControls();
    } else design.stages = v;
    changed();
  }));
  for (const k of ['half_length_ft', 'conductivity_mdft']) {
    if (fixed(k)) continue;
    if (c.per_stage) {
      const grp = document.createElement('fieldset'); grp.className = 'per-stage';
      const lg = document.createElement('legend'); lg.textContent = `${CONTROL[k].label}, stage by stage (toe first)`; grp.appendChild(lg);
      design[k].forEach((v, i) => grp.appendChild(slider(k, v, (nv) => { design[k][i] = nv; changed(); }, { idx: i, compact: true })));
      box.appendChild(grp);
    } else box.appendChild(slider(k, design[k], (v) => { design[k] = v; changed(); }));
  }
  if (!fixed('bhp_psi')) box.appendChild(slider('bhp_psi', design.bhp_psi, (v) => { design.bhp_psi = v; changed(); }));
}

function renderCapex() {
  const cx = capex(level, design), b = level.budget_usd;
  const rows = [['Well and lateral', cx.well], ['Stages', cx.stages], ['Fracture size', cx.size], ['Proppant (conductivity)', cx.prop], ['Artificial lift', cx.lift]];
  const el = $('capex'); el.replaceChildren();
  const h = document.createElement('div'); h.className = 'capex-total';
  const a = document.createElement('span'); a.textContent = 'Well cost';
  const v = document.createElement('strong'); v.textContent = fmt.usd(cx.total);
  h.append(a, v); el.appendChild(h);
  if (b) {
    const bar = document.createElement('div'); bar.className = 'budget' + (cx.total > b ? ' over' : '');
    const fill = document.createElement('span'); fill.style.width = `${Math.min(100, cx.total / b * 100)}%`; bar.appendChild(fill);
    const t = document.createElement('p'); t.className = 'budget-text';
    t.textContent = cx.total > b ? `Over the ${fmt.usd(b)} budget by ${fmt.usd(cx.total - b)}. Trim the design to run it.` : `${fmt.usd(b - cx.total)} left of the ${fmt.usd(b)} budget`;
    el.append(bar, t);
  }
  const dl = document.createElement('dl');
  for (const [k, val] of rows) { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = fmt.usd(val); d.append(dt, dd); dl.appendChild(d); }
  el.appendChild(dl);
  return cx;
}

function updateRunButton() {
  if (!level) return;
  const cx = capex(level, design), over = level.budget_usd && cx.total > level.budget_usd;
  const btn = $('run'), note = $('run-note');
  btn.disabled = !!over || simState !== 'ready' || running;
  note.textContent = over ? 'This design is over budget.' : simState === 'warming' ? 'The simulator is starting; this takes 10 to 60 seconds.'
    : simState !== 'ready' ? 'The simulator is not available. Start the server without --no-sim.' : 'A run takes 4 to 15 seconds.';
}

function changed() {
  renderCapex(); updateRunButton();
  res.clearField(); $('timeline').hidden = true;
  if (document.body.dataset.screen === 'results') show('design');
  res.setDesign(design);
}

function openLevel(id, { keepDesign = false } = {}) {
  level = LEVELS.find(l => l.id === id);
  if (!level) return renderLevels(), show('levels');
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(q), level: id })}`);
  if (!keepDesign) design = store.get('design.' + id, null) || defaultDesign(level);
  $('crumb').textContent = `Lease ${levelIndex(id) + 1} of ${LEVELS.length}: ${level.title}`;
  $('lv-title').textContent = level.title;
  $('lv-brief').textContent = level.brief;
  $('lv-lesson').textContent = level.lesson;
  const facts = [['Lateral', `${fmt.int(level.lateral_ft)} ft`], ['Lease width', `${fmt.int(level.lease_width_ft)} ft`],
    ['Rock permeability', perm(level.perm_md)],
    ['Production period', `${level.months} months`]];
  if (level.facility_cap_stb_d) facts.push(['Facility oil limit', `${fmt.int(level.facility_cap_stb_d)} stb/d`]);
  const dl = $('lv-facts'); dl.replaceChildren();
  for (const [k, v] of facts) { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; d.append(dt, dd); dl.appendChild(d); }
  res.setLevel(level);
  res.setDesign(design);
  renderControls(); renderCapex(); updateRunButton();
  frameCamera();
  show('design');
}

// permeability in the unit a petroleum engineer would say out loud
function perm(md) {
  if (md >= 1) return `${+md.toFixed(2)} md`;
  if (md >= 1e-3) return `${+(md * 1e3).toFixed(1)} microdarcy`;
  return `${Math.round(md * 1e6)} nanodarcy`;
}

function frameCamera() {
  const span = Math.max(level.lateral_ft, level.lease_width_ft) * 0.01;
  // the left panel covers part of the view: aim slightly right of centre
  stage.flyTo([span * 0.2, span * 0.95, span * 1.35], [-span * 0.14, -0.6, 0], 1.0);
}

// ------------------------------------------------------------------ run
let running = false;
async function run() {
  if (running) return;
  running = true; updateRunButton();
  const player = ($('player').value || store.get('player', '') || 'anonymous').slice(0, 32);
  const body = {
    stages: design.stages,
    half_length_ft: level.controls.per_stage ? per(design.half_length_ft, design.stages) : design.half_length_ft,
    conductivity_mdft: level.controls.per_stage ? per(design.conductivity_mdft, design.stages) : design.conductivity_mdft,
    bhp_psi: design.bhp_psi,
  };
  store.set('design.' + level.id, design);
  res.clearField();
  const t0 = performance.now();
  $('runbar').hidden = false;
  $('run-text').textContent = 'Placing your fractures (your design, not simulated growth)';
  const placing = res.place(design, 2.0);
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    if (s > 2.0) $('run-text').textContent = `Simulating ${level.months} months of production: ${s.toFixed(0)} s`;
  }, 250);
  let r;
  try { r = await api.run(level.id, body, player, { record: q.get('record') !== '0' }); }
  catch (e) { r = { ok: false, errors: [String(e.message || e)] }; }
  await placing;
  clearInterval(tick);
  $('runbar').hidden = true;
  running = false; updateRunButton();
  if (!r.ok) { $('run-note').textContent = r.errors.join(' '); return; }
  result = r;
  showResults();
}

// ------------------------------------------------------------------ results
function showResults() {
  const r = result;
  res.setDesign({ ...design, stages: r.stages.length, half_length_ft: r.stages.map(s => s.half_length_ft) }, { effective: r.stages.map(s => s.half_length_effective_ft) });
  $('npv').textContent = fmt.usd(r.npv_usd);
  $('npv').classList.toggle('neg', r.npv_usd < 0);
  starsInto($('stars'), r.stars);
  $('stars').setAttribute('aria-label', `${r.stars} of 3 stars`);
  const th = r.star_thresholds_usd;
  $('thresholds').textContent = `Stars at ${th.map(fmt.usd).join(', ')}` + (r.cached ? '. Same design as before: result reused.' : '.');
  const best = store.get('best', {}); best[level.id] = Math.max(best[level.id] || 0, r.stars); store.set('best', best);

  const money = $('money'); money.replaceChildren();
  const rows = [['Oil sales', r.revenue.oil_usd], ['Gas sales', r.revenue.gas_usd], ['Water disposal', r.revenue.water_usd],
    ['Operating cost', r.revenue.opex_usd], ['Well cost', -r.cost.total_usd]];
  const dl = document.createElement('dl');
  for (const [k, v] of rows) { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = fmt.usd(v); d.append(dt, dd); dl.appendChild(d); }
  const tot = document.createElement('p'); tot.className = 'money-note';
  tot.textContent = `${fmt.int(r.totals.oil_stb)} stb oil and ${fmt.int(r.totals.gas_mscf)} Mscf gas in ${level.months} months. Cash flows above are undiscounted; NPV discounts at ${Math.round(level.costs.discount_rate * 100)}% a year.`;
  money.append(dl, tot);

  const M = r.monthly;
  lineChart($('chart-oil'), { title: 'Oil rate, stb per day', x: M.month, y: M.oil_stb.map(v => v / 30.44), xLabel: 'month',
    fmtY: v => fmt.int(v), fmtTipX: v => `Month ${v}`, fmtTipY: v => `${fmt.int(v)} stb/d` });
  const pay = M.cum_disc_cash_usd.findIndex(v => v >= 0);
  lineChart($('chart-cash'), { title: 'Cumulative discounted cash', note: 'Starts at minus the well cost. Crossing zero is payout.',
    x: [0, ...M.month], y: [-r.cost.total_usd, ...M.cum_disc_cash_usd], xLabel: 'month', fmtY: fmt.usd, fmtTipX: v => `Month ${v}`,
    marker: pay >= 0 ? { x: M.month[pay], label: `Payout, month ${M.month[pay]}` } : null });
  barChart($('chart-stages'), { title: 'Oil by stage, stb', note: 'Stage 1 is at the toe.', labels: r.stages.map(s => s.stage),
    values: r.stages.map(s => s.oil_stb), fmt: v => fmt.int(v),
    sub: r.stages.map(s => s.half_length_effective_ft < s.half_length_ft ? `${fmt.int(s.half_length_effective_ft)} of ${fmt.int(s.half_length_ft)} ft inside the lease` : `${fmt.int(s.half_length_ft)} ft half-length`) });

  renderBoard();
  const i = levelIndex(level.id);
  $('next').hidden = i >= LEVELS.length - 1;
  show('results');
  const span = Math.max(level.lateral_ft, level.lease_width_ft) * 0.01;
  stage.flyTo([span * 0.05, span * 1.05, span * 1.4], [0, -0.8, 0], 1.0);
  loadField();
}

async function renderBoard() {
  const ol = $('board'); ol.replaceChildren();
  let rows = [];
  try { rows = await api.scores(level.id); } catch { /* leave empty */ }
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scores yet on this lease.'; ol.appendChild(li); return; }
  for (const s of rows) {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'who'; n.textContent = s.player;   // text only: names are user input
    const v = document.createElement('span'); v.className = 'val'; v.textContent = fmt.usd(s.npv_usd);
    const st = document.createElement('span'); st.className = 'st'; st.textContent = '★'.repeat(s.stars);
    li.append(n, st, v); ol.appendChild(li);
  }
}

// pressure field: fetched after results are on screen so they never wait on it
let months = [], playing = false, tMonth = 0;
async function loadField() {
  if (!result.has_field) return;
  $('month-label').textContent = 'Loading pressure field';
  const f = await api.field(result.run_id);
  if (!f) { $('month-label').textContent = ''; return; }
  res.setField(f);
  months = f.months;
  const m = $('month'); m.max = months.length - 1; m.step = 0.01;
  $('leg-hi').textContent = `${fmt.int(f.initial_pressure_psi)} psi`;
  $('leg-lo').textContent = `${fmt.int(f.bhp_psi)} psi`;
  $('timeline').hidden = false;
  const start = q.get('month') != null ? +q.get('month') : 0;
  setMonth(start);
  if (q.get('month') == null) { playing = true; $('play').textContent = 'Pause'; }
}
function setMonth(t) {
  tMonth = Math.max(0, Math.min(months.length - 1, t));
  res.setMonth(tMonth);
  $('month').value = tMonth;
  const k = Math.round(tMonth);
  $('month-label').textContent = months[k] === 0 ? 'Before production' : `Month ${months[k]}`;
}
stage.onUpdate((dt) => {
  if (!playing || !months.length) return;
  setMonth(tMonth + dt * Math.max(2, months.length / 7));   // whole history in about 7 s
  if (tMonth >= months.length - 1) { playing = false; $('play').textContent = 'Play'; }
});
$('play').addEventListener('click', () => {
  if (tMonth >= months.length - 1) setMonth(0);
  playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
});
$('month').addEventListener('input', () => { playing = false; $('play').textContent = 'Play'; setMonth(+$('month').value); });
$('ramp').style.background = `linear-gradient(90deg, ${RAMP.join(', ')})`;

// ------------------------------------------------------------------ wiring and boot
$('run').addEventListener('click', run);
$('again').addEventListener('click', () => { show('design'); res.clearField(); res.setDesign(design); });
$('next').addEventListener('click', () => { const i = levelIndex(level.id); if (LEVELS[i + 1]) openLevel(LEVELS[i + 1].id); });
$('player').value = store.get('player', '');
$('player').addEventListener('change', () => store.set('player', $('player').value.slice(0, 32)));
document.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '?' + (q.get('fixture') ? `fixture=${q.get('fixture')}` : '')); renderLevels(); show('levels'); });

(async function boot() {
  pollStatus();
  LEVELS = await api.levels();
  stage.start();
  const want = q.get('level');
  if (want && LEVELS.find(l => l.id === want)) {
    openLevel(want);
    if (q.get('screen') === 'results' && api.fixture) { simState = 'ready'; await run(); }
  } else {
    // idle backdrop behind the level list: the first lease
    level = LEVELS[0]; design = defaultDesign(level);
    res.setLevel(level); res.setDesign(design); frameCamera();
    renderLevels(); show('levels');
  }
  setTimeout(() => { window.__ready = true; }, 1500);
})();
window.__stage = stage; window.__res = res;
