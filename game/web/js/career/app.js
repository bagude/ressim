// Career mode front end over ressim-83's career API (game/API.md, "Career mode (slice 1)").
// URL: career.html?id=<career id>&tab=field|typecurve|plan|board|inbox
import { multiChart, gantt, COLORS } from './charts2.js';
import { fieldMap } from './fieldmap.js';
import { Field3D } from './field3d.js';
import { openRock } from './rock.js';
import { renderMaps, geology } from '../geo/maps.js';
import { renderDiagnostics } from './diag.js';
import { renderReserves } from './reserves.js';
import { reviewPanel } from './review.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
const usd = (v) => { if (v == null) return '–'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)} MM` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`; };
const num = (v, d = 0) => v == null ? '–' : (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const bbl = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(2)} MMbbl` : v >= 1e3 ? `${Math.round(v / 1e3).toLocaleString('en-US')} kbbl` : `${Math.round(v)} bbl`;
const pct = (v) => v == null ? '–' : `${Math.round(v * 100)}%`;
const monthName = (m) => `Y${Math.floor(m / 12) + 1} M${Math.floor(m % 12) + 1}`;

async function call(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!j) return { ok: false, errors: [`${path}: HTTP ${r.status}`] };
  if (!r.ok && j.ok !== false) j.ok = false;
  return j;
}

let C = null;           // career view
let ANALOGS = [];
let draft = null;       // plan being edited
let planRes = null;
let tcSel = new Set();
let tcRes = null;
let tab = q.get('tab') || 'home';
let advanceError = '';

// ------------------------------------------------------------------ landing
async function landing() {
  $('landing').hidden = false; $('app').hidden = true;
  for (const id of ['clock', 'adv1', 'advY']) $(id).hidden = true;
  document.querySelectorAll('.kpi').forEach(k => k.hidden = true);
  const list = await (await fetch('/api/careers')).json().catch(() => []);
  const ul = $('careers'); ul.replaceChildren();
  if (!list.length) ul.append(h('li', { class: 'hint' }, 'No careers yet.'));
  for (const c of list) ul.append(h('li', {}, h('a', { href: `?id=${c.id}` }, h('span', {}, c.name), h('span', { class: 'meta' },
    `${c.status}, month ${c.month}, confidence ${Math.round(c.confidence)}`))));
  $('new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const share = $('new-share')?.value.trim();
    const r = await call('/api/career/new', { name: $('new-name').value.trim(), ...(share ? { share } : {}) });
    if (!r.ok) { $('gen').hidden = false; $('gen').textContent = r.errors.join(' '); return; }
    location.search = `?id=${r.career.id}`;
  });
}

function showApp() {   // undo what waitGenerated hid
  $('landing').hidden = true; $('app').hidden = false; $('gen').hidden = true;
  for (const el of ['clock', 'adv1', 'advY']) $(el).hidden = false;
  document.querySelectorAll('.kpi').forEach(k => { k.hidden = false; });
  renderBar();
}
async function waitGenerated(id) {
  $('landing').hidden = false; $('app').hidden = true;
  for (const el of ['clock', 'adv1', 'advY']) $(el).hidden = true;
  document.querySelectorAll('.kpi').forEach(k => k.hidden = true);
  $('new-form').hidden = true;
  const g = $('gen'); g.hidden = false;
  for (;;) {
    const r = await call(`/api/career?id=${id}`);
    if (!r.ok) { g.textContent = r.errors.join(' '); return null; }
    if (r.career.status !== 'generating') return r.career;
    g.textContent = `Simulating the field's producing wells on the reservoir simulator: ${Math.round(r.career.progress * 100)}%`;
    await new Promise(res => setTimeout(res, 1500));
  }
}

// sticky elements sit under the top bar, whose height changes when it wraps
const syncBar = () => document.documentElement.style.setProperty('--barH', `${document.querySelector('.cbar').offsetHeight}px`);
addEventListener('resize', syncBar); new ResizeObserver(syncBar).observe(document.querySelector('.cbar'));

// ------------------------------------------------------------------ stakes
// This year's oil against the guidance forecast to date: the measure the year-end review scores (the board page states
// the band: below guidance costs confidence, more than 10 % above is sandbagging). A server projection, when present, wins.
function pace() {
  const H = C.history, yi = C.year - 1, y0 = yi * 12;
  let oil = 0, fc = 0, n = 0;
  H.month.forEach((m, i) => { if (m >= y0 && m < y0 + 12 && H.oil_forecast[i] != null) { oil += H.oil[i]; fc += H.oil_forecast[i]; n++; } });
  const P = C.projection;
  if (P && P.production_ratio != null) { oil = P.oil_ytd_bbl; fc = P.oil_forecast_ytd_bbl; n = P.months_done; }
  if (n < 2 || fc <= 0) return null;   // one month is noise
  const r = P?.production_ratio ?? oil / fc;
  const level = r < 0.95 ? 'bad' : r < 0.995 ? 'warn' : r > 1.10 ? 'warn' : 'ok';
  const text = r < 0.995 ? `${Math.round((1 - r) * 100)}% behind guidance` : r > 1.10 ? `${Math.round((r - 1) * 100)}% above guidance: sandbagging` : 'On guidance';
  const rp = !C.budget_needed && RP?.year === C.year ? RP : null;
  const dEx = rp ? rp.confidence_after_expected - rp.confidence_now : P?.confidence_change, dPe = rp ? rp.confidence_after_pessimistic - rp.confidence_now : null;
  const sg = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;
  const proj = dEx != null ? `review on track for ${sg(dEx)}${dPe != null && Math.round(dPe) !== Math.round(dEx) ? ` (${sg(dPe)} if pads slip)` : ''}` : null;
  const after = rp ? rp.confidence_after_pessimistic : P?.confidence_after;
  const danger = after != null && after < SACK() + 10;
  return { r, oil, fc, months: n, level: danger ? 'bad' : level, text, proj, P };
}
const SACK = () => C.sack_below ?? C.projection?.sack_below ?? 20;
let RP = null, rpKey = '';
async function refreshRP() {   // the board's formula on the year so far (or, during a meeting, the saved plan)
  const k = `${C.id}|${C.month}|${C.budget_needed}|${(C.board.reviews || []).length}`;
  if (k === rpKey) return RP; rpKey = k;
  const r = await call(`/api/career/review_preview?id=${C.id}`).catch(() => null);
  RP = r?.ok ? r.review_preview : null;
  return RP;
}

// ------------------------------------------------------------------ the budget meeting, step by step
function meetingSteps() {
  const y0 = (C.year - 1) * 12, first = C.year === 1, pads = (draft || keep.get('draft', null))?.pads?.length || 0;
  const tcs = Object.values(C.typecurves || {}).filter(t => (t.created_month ?? 0) >= y0).length;
  const maps = Object.values(C.geomodels || {}).filter(m => (m.month ?? m.created_month ?? +(String(m.name).match(/month (\d+)/)?.[1] ?? -1)) >= y0).length;
  const last = (C.board.reviews || []).at(-1);
  return [
    ...(last && !first ? [{ done: C.workflow ? C.workflow.steps?.find(x => x.key === 'lookback')?.status === 'done' : keep.get(`readReview${last.year}`, false), tab: 'diag', cta: 'Open Diagnostics', title: `Read the year ${last.year} review`,
      why: `The board moved your confidence ${last.confidence_change >= 0 ? '+' : '−'}${num(Math.abs(last.confidence_change), 1)}${worstParts(last) === 'nothing cost you' ? '' : `: ${worstParts(last)}`}. ${last.confidence_change < 0 ? 'Read the pad report cards and Diagnostics: was the miss your type curve or the execution?' : 'Read the pad report cards: if the rock beat your type curve, raise the curve now, or the extra oil will count as sandbagging next year.'}` }] : []),
    { done: maps > 0, optional: true, tab: 'maps', cta: 'Map the rock', title: 'Map the rock (optional, recommended)',
      why: 'Pick tops on the old vertical wells, map net pay and HCPV, and save the interpretation. The type curve can then scale each pad to the rock under it, instead of one field-wide average.' },
    { done: tcs > 0, tab: 'typecurve', cta: 'Next: build a type curve', title: first ? 'Build a type curve' : 'Rebuild the type curve with this year’s data',
      why: 'It is your forecast of what a new well will produce, drawn from the wells you can see. The board holds you to it: too optimistic and you miss guidance; too cautious and you may beat it by more than 10%, which the board calls sandbagging.' },
    { done: pads > 0 || (first && !!C.plan), tab: 'plan', cta: 'Next: plan your pads', title: first ? 'Plan your first pads' : 'Plan this year\'s pads',
      why: 'Pick open sections and how to drill and frack them. More pads means more oil and a bigger promise, at a bigger cost. The board wants growth of at least 5% over what is already producing.' },
    { done: !C.budget_needed, tab: 'board', cta: 'Go to the board meeting', title: 'Win the budget',
      why: 'Ask for enough money to fund the pads you want this year, and commit to an oil volume (your guidance). That volume is what the year-end review scores.' },
    { done: false, tab: null, cta: null, title: 'Run the year',
      why: 'Continue runs month by month until something needs you: a job to play, a pad coming online, a warning.' },
  ];
}
function nextStep() { return C.budget_needed ? meetingSteps().find(s => !s.done && s.tab && !s.optional) : null; }
// the review parts that cost the most, in words
const PART_LABEL = { production_vs_guidance: 'production against guidance', sandbagging: 'sandbagging', capex_vs_budget: 'capex against budget', delivered_both: 'delivered both', reserve_replacement: 'reserve replacement', reserve_revisions: 'reserve revisions', reserves_audit: 'reserves audit', emissions_intensity: 'emissions intensity' };
function worstParts(rv, n = 3) {
  const P = Object.entries(rv.parts || {}).filter(([, v]) => v < -0.05).sort((a, b) => a[1] - b[1]).slice(0, n);
  return P.length ? P.map(([k, v]) => `${PART_LABEL[k] || k} −${num(-v, 1)}`).join(', ') : 'nothing cost you';
}

// ------------------------------------------------------------------ top bar
function renderBar() {
  $('cname').textContent = C.name; renderRail();
  $('clock').textContent = C.status === 'active' ? `Month ${C.month} of ${C.career_months}, year ${C.year}` : `${C.status}, month ${C.month}`;
  $('cash').textContent = usd(C.cash_usd);
  $('conf').value = C.board.confidence; $('conf-n').textContent = Math.round(C.board.confidence);
  if (C.status === 'active') refreshRP().then((rp) => { if (rp && $('pace').dataset.rp !== rpKey) { $('pace').dataset.rp = rpKey; renderBar(); } });
  const pc = C.status === 'active' ? pace() : null, pk = $('pace');
  pk.hidden = !pc;
  if (pc) {
    pk.className = `kpi pace ${pc.level}`;
    pk.querySelector('strong').textContent = pc.proj ? `${pc.text}, ${pc.proj}` : pc.text;
    pk.title = `Year ${C.year}: ${bbl(pc.oil)} against ${bbl(pc.fc)} of guidance so far. The year-end review costs confidence below guidance and counts more than 10% above as sandbagging; below ${SACK()} confidence the board lets you go.`;
  }
  const pend = C.steer_pending || [];
  const done = C.status !== 'active';
  $('advY').disabled = done || C.budget_needed || pend.length > 0 || !!blockingTask(12 - (C.month % 12));   // year end would pass a blocking job
  $('adv1').disabled = done && !running;
  $('adv1').title = running ? 'Stop after this month' : 'Runs month by month until something needs you';
  // Continue names the real next step: the board meeting, a well to steer, a blocking minigame task, or the next month
  const block = blockingTask();
  $('adv1').textContent = running ? 'Pause' : done ? 'Career over' : C.budget_needed ? (tab === 'board' && !nextStep()?.tab?.match(/typecurve|plan/) ? 'Present the plan (below)' : nextStep()?.cta || 'Go to the board meeting') : pend.length ? `Steer ${pend[0]}` : block ? `Do: ${block.label}` : 'Continue';
  if (block) $('advY').disabled = true;
  $('advY').title = C.budget_needed ? 'The board must approve this year’s budget first.' : pend.length ? 'Steer the waiting wells first.' : '';
  const unread = unreadCount();
  $('inbox-n').textContent = unread || '';
}

async function advance(months) {
  $('adv1').disabled = $('advY').disabled = true;
  $('clock').textContent = 'Running the field on the simulator results…';
  const r = await call('/api/career/advance', { id: C.id, months });
  if (!r.ok) { await reload(); advanceError = r.errors.join(' '); setTab('home'); return; }
  C = r.career; await loadAnalogs(); planRes = null;
  if (r.new_messages?.length && tab !== 'field') tab = 'home';
  renderAll();
}
async function delegateTask(t, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Handing over…'; }
  const r = await call('/api/career/task/delegate', { id: C.id, task: t.id });
  if (!r.ok) { advanceError = (r.errors || ['Could not delegate.']).join(' '); }
  if (r.career) C = r.career; else await reload();
  renderBar(); setTab('home');
}
// career tasks (minigames the career asks for): the first open blocking one that is due by now
// the server refuses to advance past a blocking task's due point, so a task blocks Continue when the next month would pass it
function blockingTask(horizon = 1) {
  return (C?.tasks || []).filter(t => t.status === 'open' && t.blocking && (t.due_month == null || t.due_month < C.month + horizon + 1e-6))
    .sort((a, b) => (a.due_month ?? -1) - (b.due_month ?? -1))[0] || null;
}
// a pad's life in stages: drill → complete → bring on, from the approved schedule's bars and the pad's own jobs
const STAGE_ORDER = ['drill', 'complete', 'bring_on', 'produce', 'corporate'];
const STAGE_LABEL = { drill: 'Drilling', complete: 'Completion', bring_on: 'Bring on', produce: 'Production', corporate: 'Company' };
function padStages(pad, pr) {
  const bars = (pr?.gantt?.bars || []).filter(b => b.pad === pad && b.kind !== 'wait'), ps = (C.pads_started || []).find(p => p.pad === pad);
  const span = (k) => { const B = bars.filter(b => b.kind === k); return B.length ? [Math.min(...B.map(b => b.start_month)), Math.max(...B.map(b => b.end_month))] : null; };
  const when = { drill: span('drill'), complete: span('complete'), bring_on: span('tie_in') };
  if (!when.bring_on && ps?.online_month != null) when.bring_on = [ps.online_month - 0.5, ps.online_month];
  if (!when.drill && ps?.drill_start_month != null) when.drill = [ps.drill_start_month, ps.drill_start_month + 1];
  const jobs = (C.tasks || []).filter(t => t.link?.pad === pad);
  return ['drill', 'complete', 'bring_on'].map(st => {
    const w = when[st], J = jobs.filter(t => t.stage === st), open = J.some(t => t.status === 'open');
    const time = !w ? null : C.month < w[0] - 1e-6 ? 'todo' : C.month >= w[1] - 1e-6 ? 'done' : 'now';
    const state = open ? 'now' : time || (J.length && J.every(t => t.status !== 'open' && t.status !== 'upcoming') ? 'done' : 'todo');
    const tip = [w ? `${monthName(w[0])} to ${monthName(w[1])}` : null, ...J.map(t => `${t.label}: ${t.status === 'upcoming' ? `opens ${monthName(t.opens_month)}` : t.status}`)].filter(Boolean).join('; ');
    return { st, state, tip, jobs: J };
  });
}
function padPipe(pad, pr) {
  const mark = { done: '✓', now: '●', todo: '○' };
  return h('span', { class: 'pad-pipe', role: 'list', 'aria-label': `Pad ${pad} stages` }, ...padStages(pad, pr).flatMap((x, i) => [i ? h('span', { class: 'pp-arrow', 'aria-hidden': 'true' }, '→') : null,
    h('span', { class: `pp ${x.state}`, role: 'listitem', title: x.tip }, `${STAGE_LABEL[x.st].toLowerCase()} ${mark[x.state]}`, x.jobs.some(t => t.status === 'open') ? h('b', { class: 'pp-job' }, ' job') : null)].filter(Boolean)));
}
// pads not yet online (or online this month), each as a small pipeline
function padsInProgress(pr) {
  const P = (C.pads_started || []).filter(p => p.online_month == null || p.online_month > C.month - 1);
  if (!P.length) return null;
  return h('div', { class: 'pipes' }, h('h3', {}, 'Pads in progress'), h('ul', { class: 'plain' }, ...P.map(p => h('li', {}, h('span', { class: 'pp-pad' }, `Pad ${p.pad}`), padPipe(p.pad, pr)))));
}
const taskUrl = (t) => `minigames.html?game=${encodeURIComponent(t.kind)}&id=${encodeURIComponent(t.session)}`;
// ------------------------------------------------------------------ continue: run until something needs you
// Months run one at a time and stop on anything worth a look: a job to play (before it lapses), a pad coming online,
// a board or operations event, a year end. Each stop is shown on Home with the messages that caused it.
let running = false, stopNote = null;
const QUIET = [/^Month \d+ report$/, /^Well \S+ online$/];
const HARD = new Set(['budget_needed', 'steer', 'task_blocking', 'no_plan']);   // the bar's button already leads there
async function runUntilEvent(maxMonths = 12) {
  running = true; stopNote = null; renderBar();
  try {
    for (let i = 0; i < maxMonths && running; i++) {
      $('clock').textContent = `Running month ${C.month + 1}…`;
      const r = await call('/api/career/advance', { id: C.id, until_event: true, max_months: 1 });
      if (!r.ok) { await reload(); advanceError = (r.errors || ['The clock could not advance.']).join(' '); break; }
      C = r.career; renderBar();
      if (tab === 'field' && r.months_advanced) { await loadAnalogs(); renderField(); }
      const st = r.stop;
      if (!st) continue;
      if (HARD.has(st.reason) && !r.months_advanced) break;
      const msgs = (r.new_messages || []).filter(m => !QUIET.some(rx => rx.test(m.title)));
      const t0 = st.message || st.reason.replace(/_/g, ' ');
      stopNote = { title: t0.charAt(0).toUpperCase() + t0.slice(1), reason: st.reason, tasks: st.tasks, msgs };
      break;
    }
  } finally {
    running = false;
    await loadAnalogs(); planRes = null;
    if ((stopNote || advanceError) && tab !== 'field') tab = 'home';
    renderAll();
  }
}
$('adv1').addEventListener('click', () => {
  if (running) { running = false; $('adv1').textContent = 'Pausing…'; return; }
  if (C.budget_needed) return setTab(nextStep()?.tab || 'board');
  const bt = blockingTask();
  if (bt && !(C.steer_pending || []).length) { location.href = taskUrl(bt); return; }
  const pend = C.steer_pending || [];
  if (pend.length) {
    const w = (C.wells || []).find(x => x.id === pend[0]);
    if (w?.steer?.session) { location.href = `geosteer.html?id=${w.steer.session}`; return; }
    return setTab('home');
  }
  runUntilEvent(12);
});
$('advY').addEventListener('click', () => advance(Math.max(1, 12 - (C.month % 12))));


// ------------------------------------------------------------------ tabs
// the inbox is a drawer over whatever step you are on, not a destination
function openInbox(open = true) {
  const d = $('tab-inbox'); d.hidden = !open; document.body.classList.toggle('drawer-open', open); $('inbox-btn').setAttribute('aria-expanded', String(open));
  if (open) { renderInbox(); $('inbox-close').focus(); } else $('inbox-btn').focus();
}
$('inbox-btn')?.addEventListener('click', () => openInbox($('tab-inbox').hidden));
$('inbox-close')?.addEventListener('click', () => openInbox(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('tab-inbox').hidden) openInbox(false); });
// the loop: which phase each tab belongs to, and where the year stands
const PHASE_OF = { diag: 'lookback', reserves: 'lookback', finance: 'lookback', maps: 'prepare', typecurve: 'prepare', plan: 'prepare', board: 'board', home: 'year', field: 'year' };
function phaseNow() {
  if (C.status !== 'active') return 'lookback';
  const W = C.workflow;
  if (W?.current_step) return phaseOfStep(W.steps?.find(x => x.key === W.current_step) || { key: W.current_step });
  if (!C.budget_needed) return 'year';
  const st = meetingSteps(), cur = st.find(x => !x.done && !x.optional);
  return !cur ? 'board' : cur.tab === 'diag' ? 'lookback' : cur.tab === 'board' ? 'board' : 'prepare';
}
const phaseOfStep = (x) => ({ look_back: 'lookback', the_year: 'year' })[x.phase] || x.phase || ({ lookback: 'lookback', review: 'lookback', map: 'prepare', forecast: 'prepare', plan: 'prepare', budget: 'board' })[x.key] || 'year';
function renderRail() {
  const now = phaseNow(), order = ['lookback', 'prepare', 'board', 'year'], i = order.indexOf(now);
  const W = C.workflow?.steps || [];
  for (const g of document.querySelectorAll('.tabs .nav-group')) {
    const ph = g.dataset.phase, j = order.indexOf(ph), att = W.some(x => phaseOfStep(x) === ph && x.status === 'attention');
    g.classList.toggle('now', ph === now); g.classList.toggle('past', C.budget_needed ? j < i : ph !== 'year' && ph !== 'lookback');
    g.querySelector('.ph-state').textContent = ph === now ? 'now' : att ? '!' : '';
    const mine = W.filter(x => phaseOfStep(x) === ph);
    g.title = mine.map(x => `${x.label}: ${x.summary || x.status}`).join(' · ') || (ph === now ? 'Where the year stands' : '');
  }
}
function setTab(t) {
  if (t === 'inbox') { openInbox(true); return; }   // old links and buttons: open the drawer
  tab = t;
  const lb = C?.workflow?.steps?.find(x => x.key === 'lookback');
  if (PHASE_OF[t] === 'lookback' && lb?.status === 'attention')
    call('/api/career/ack', { id: C.id, step: 'lookback' }).then(r => { if (r?.ok && r.workflow) { C.workflow = r.workflow; renderRail(); renderBar(); } }).catch(() => {});
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  for (const s of document.querySelectorAll('.tab:not(.drawer)')) s.hidden = s.id !== `tab-${t}`;
  renderRail(); if (C) renderBar();
  const sel = document.querySelector(`.tabs button[data-tab="${t}"]`), nav = sel?.parentElement;   // phones: the row scrolls; keep the current step in view
  if (sel && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, sel.offsetLeft - 24 - (sel.previousElementSibling?.classList.contains('nav-group') ? sel.previousElementSibling.offsetWidth : 0));
  const u = new URLSearchParams(location.search); u.set('tab', t); history.replaceState(null, '', '?' + u);
  ({ home: renderHome, inbox: () => openInbox(true), maps: () => renderMaps($('maps-host'), { C, analogs: ANALOGS }), diag: () => renderDiagnostics($('diag-host'), { C, monthName, onCareer: (c) => { if (c) { C = c; renderBar(); } } }), reserves: () => renderReserves($('reserves-host'), { C, monthName }), field: renderField, typecurve: renderTC, plan: renderPlan, board: renderBoard, finance: renderFinance, inbox: renderInbox })[t]();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ------------------------------------------------------------------ field
function bubbleLegend() {   // the size key for the production bubble layer
  const el = document.querySelector('.map-legend .bubbles');
  if (!el || !F3) return;
  el.textContent = F3.layer === 'production' && F3.maxCum > 0 ? `Bubble area: cumulative oil per well, the largest ${bbl(F3.maxCum)}. Blue inherited, amber yours.`
    : F3.layer === 'depletion' ? 'Red: oil already produced in the section (a proxy for the pressure the parents have drawn down). Amber dashed: a planned pad whose edge well comes within 1,500 ft of a producing well across the section line (the distance is marked), at risk of parent-child interference: smaller fractures, frac hits, lower rates. The verdict arrives in the inbox when the pad locks.' : '';
}
let focusSec = null;
let F3 = null, activePlan = null, activePlanKey = null, mcMonth = null;
async function activePlanRes() {
  // the Gantt for the board-approved plan, evaluated at the current month (fast, no simulation)
  if (!C.plan) return null;
  const key = `${C.id}:${C.month}:${JSON.stringify(C.plan)}`;
  if (key === activePlanKey) return activePlan;
  const r = await call('/api/career/plan', { id: C.id, plan: C.plan });
  activePlanKey = key; activePlan = r.ok ? r : null;
  return activePlan;
}
async function renderField() {
  fieldMap($('map-field'), { career: C, analogs: ANALOGS, plan: C.plan, selected: new Set(ANALOGS.map(a => a.id)), focus: focusSec,
    onSection: (s) => { focusSec = s; renderField(); } });
  if (!F3) {
    F3 = new Field3D($('field3d'));
    let down = null;
    $('field3d').addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    $('field3d').addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const a = F3.assetAt(e);   // a pump trailer or frac tree on a detailed pad: take it apart in the Workshop
      if (a) { location.href = `workshop.html?asset=${a}&back=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`; return; }
      const s = F3.sectionAt(e); focusSec = s; if (s) F3.flyToSection(s); renderField();
    });
    const wtip = h('div', { class: 'chart-tip well-tip' }); wtip.hidden = true; $('stage3d').appendChild(wtip);
    $('field3d').addEventListener('pointermove', (e) => {
      if (e.buttons) { wtip.hidden = true; return; }
      const asset = F3.assetAt(e);
      $('field3d').style.cursor = asset ? 'pointer' : '';
      if (asset) {
        const r = $('stage3d').getBoundingClientRect();
        wtip.replaceChildren(h('b', {}, asset === 'pump' ? 'Frac pump, 2,500 hp' : 'Frac tree, 15,000 psi'), h('span', {}, 'Click to take it apart in the Workshop'));
        wtip.style.left = `${Math.min(r.width - 300, e.clientX - r.left + 14)}px`; wtip.style.top = `${e.clientY - r.top + 14}px`; wtip.hidden = false;
        return;
      }
      const w = F3.wellAt(e);
      if (!w) { wtip.hidden = true; return; }
      const r = $('stage3d').getBoundingClientRect();
      wtip.replaceChildren(h('b', {}, `${w.id}${w.kind === 'planned' ? ' (planned)' : w.kind === 'you' ? ' (yours)' : ' (inherited)'}`),
        h('span', {}, w.shl.fnl < 0 ? `Surface: ${num(-w.shl.fnl)} ft north of the section's north line, ${num(w.shl.fwl)} ft FWL` : `Surface: ${num(w.shl.fnl)} ft FNL, ${num(w.shl.fwl)} ft FWL`),
        h('span', {}, `Heel: ${num(w.heel.fnl)} ft FNL, ${num(w.heel.fwl)} ft FWL`),
        h('span', {}, `Bottom hole (toe): ${num(w.bhl.fnl)} ft FNL, ${num(w.bhl.fwl)} ft FWL`),
        h('span', { class: 'muted' }, `Nudge at ${num(w.kop)} ft, landed at ${num(w.landed)} ft TVD, ${num(w.lateral)} ft lateral.`),
        h('span', { class: 'muted' }, 'Illustrative directional profile, not survey data'));
      wtip.style.left = `${Math.min(r.width - 300, e.clientX - r.left + 14)}px`; wtip.style.top = `${e.clientY - r.top + 14}px`;
      wtip.hidden = false;
    });
    $('field3d').addEventListener('pointerleave', () => { wtip.hidden = true; });
    $('ug').addEventListener('click', () => {
      const on = $('ug').getAttribute('aria-pressed') !== 'true'; $('ug').setAttribute('aria-pressed', String(on)); F3.setUnderground(on);
      if (focusSec) F3.flyToSection(focusSec); else F3.frame();
    });
    const layerBtns = document.querySelectorAll('.stage-tools [data-layer]');
    layerBtns.forEach(b => b.addEventListener('click', () => {
      layerBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('stage3d').dataset.layer = b.dataset.layer;
      F3.setLayer(b.dataset.layer); bubbleLegend();
    }));
    const styleBtns = document.querySelectorAll('.stage-tools [data-style]');
    const showStyle = (st) => { styleBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === st))); $('stage3d').dataset.style = st; };
    showStyle(F3.mapStyle);
    styleBtns.forEach(b => b.addEventListener('click', () => { showStyle(b.dataset.style); F3.setMapStyle(b.dataset.style);
      document.querySelector('.map-legend .elev').textContent = b.dataset.style === 'topo' && F3.elevNote ? `${F3.elevNote} (illustrative).` : ''; }));
    $('fit').addEventListener('click', () => { focusSec = null; F3.frame(); renderField(); });
    $('map2d').addEventListener('click', () => { const on = $('map-field').hidden; $('map-field').hidden = !on; $('map2d').setAttribute('aria-pressed', String(on)); });
    window.__f3 = F3;
  }
  F3.update(C, ANALOGS, await activePlanRes(), { focus: focusSec });
  // what changed this month, in words (the 3D animation is the same news, shown); a live region so screen readers hear it
  const mc = $('month-changes');
  if (F3.month !== mcMonth) {   // once per month, so re-renders in the same month don't re-announce it
    mc.replaceChildren(...(F3.changes.length ? [h('b', {}, `What changed on the field in ${monthName(C.month)}`), h('ul', {}, ...F3.changes.map(c => h('li', {}, c)))] : []));
    mcMonth = F3.month;
  }
  // every pad as a button: the keyboard and screen-reader way into the 3D view
  const STATE = { planned: 'planned', construction: 'building', drilling: 'drilling', fracturing: 'fracking', 'tie-in': 'tie-in', producing: 'producing' };
  $('pad-list').replaceChildren(...F3.pads.slice().sort((a, b) => a.section.localeCompare(b.section)).map(p => {
    const b = h('button', { type: 'button', 'aria-current': String(focusSec === p.section) }, `Pad ${p.section} `, h('i', {}, `${STATE[p.state] || p.state}, ${p.nWells} well${p.nWells === 1 ? '' : 's'}`));
    b.addEventListener('click', () => { focusSec = p.section; F3.flyToSection(p.section); renderField(); });
    return b;
  }));
  document.querySelector('.map-legend .elev').textContent = F3.mapStyle === 'topo' && F3.elevNote ? `${F3.elevNote} (illustrative).` : '';
  bubbleLegend();
  document.querySelector('.stage-note').textContent = `A map of the field, north up: hover a well for its locations, click a section to zoom in, drag to tilt and orbit, or turn on the underground view to see every wellbore in 3D. Keyboard: focus the view, then arrow keys and plus or minus. ${F3.depthNote} Wells are drawn as lines of fixed screen width; brighter means producing more this month. Equipment is simplified at this scale.`;
  // production history: actual vs the board guidance forecast
  const H = C.history;
  if (H.month.length) {
    multiChart($('ch-history'), { title: 'Field oil, bbl per month', note: 'Your actual production against the forecast you gave the board.',
      x: H.month, xLabel: 'month', fmtY: (v) => num(v), fmtTipX: monthName, series: [
        { name: 'Actual', y: H.oil, color: COLORS.dev },
        { name: 'Guidance forecast', y: H.oil_forecast, color: COLORS.pdp, dash: true },
      ] });
  } else $('ch-history').replaceChildren(h('p', { class: 'hint' }, 'Production history appears here once you advance the first month.'));
  const d = $('sec-detail'); d.replaceChildren();
  if (!focusSec) {
    d.append(h('h2', {}, 'The field'), h('p', { class: 'hint' }, `${C.sections.length} sections of one square mile. ${C.sections.filter(s => s.developed).length} are developed; the rest is open acreage for your pads. Click a section.`));
    const own = ANALOGS.filter(a => a.owner === 'you').length;
    d.append(h('ul', { class: 'plain' },
      h('li', {}, h('span', {}, 'Inherited producing wells'), h('strong', {}, String(ANALOGS.filter(a => a.owner === 'inherited').length))),
      h('li', {}, h('span', {}, 'Your wells online'), h('strong', {}, String(own))),
      h('li', {}, h('span', {}, 'Pads started'), h('strong', {}, String(C.pads_started.length))),
      h('li', {}, h('span', {}, 'Credit line'), h('strong', {}, usd(C.credit_line_usd))),
      h('li', {}, h('span', {}, 'Capital limit'), h('strong', {}, usd(C.capital_limit_usd)))));
    return;
  }
  const s = C.sections.find(x => x.section === focusSec);
  const wells = ANALOGS.filter(a => a.section === focusSec);
  const yours = wells.some(w => w.owner === 'you') || C.pads_started.some(p => p.section === focusSec);
  d.append(h('h2', {}, `Section ${focusSec}`), h('p', { class: 'hint' }, s.developed ? 'Developed: inherited producing wells.' : yours ? 'Your pad.' : 'Open acreage.'));
  if (wells.length) {
    const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Well', 'Spacing ft', 'Half-length', 'Months', 'Cum oil', ''].map(x => h('th', {}, x)))));
    const tb = h('tbody');
    for (const w of wells) tb.append(h('tr', {}, h('td', {}, w.id), h('td', {}, num(w.well_spacing_ft)), h('td', {}, num(w.design.half_length_ft)),
      h('td', {}, String(w.history_months)), h('td', {}, num(w.oil.reduce((a, b) => a + b, 0))),
      h('td', {}, h('button', { type: 'button', class: 'small-btn', 'aria-label': `Rock view of ${w.id}`, onclick: () => openRock(C.id, w, { career: C, design: w.design }) }, 'Rock'))));
    t.append(tb); d.append(t);
    d.append(h('p', { class: 'hint' }, 'Rock opens the simulator’s pressure map around that well, for the months you have seen.'));
  }
  const started = C.pads_started.find(p => p.section === focusSec);
  if (started) { d.append(h('p', {}, `Pad started: ${started.wells} wells, online ${monthName(started.online_month)}, AFE ${usd(started.afe_usd)}, actual ${usd(started.actual_usd)}.`));
    const pp = h('p', {}); d.append(pp); activePlanRes().then(pr => pp.replaceChildren(padPipe(started.pad, pr))); }
  if (!s.developed && !started) d.append(h('button', { type: 'button', class: 'small-btn', onclick: () => { addPad(focusSec); setTab('plan'); } }, 'Add a pad here to the plan'));
}

// ------------------------------------------------------------------ persistence (per career, per browser)
const keep = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(`career.${C.id}.${k}`)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`career.${C.id}.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const cumOil = (a) => a.oil.reduce((s, v) => s + v, 0);
const peakOil = (a) => Math.max(0, ...a.oil);

// ------------------------------------------------------------------ type curve workbench
let tcTimer = null, tcOverride = null, tcHover = null, tcSort = { key: 'section', dir: 1 }, tcAdj = null, adjTimer = null;
function initTC() {
  if (!tcSel.size) {
    const saved = keep.get('tcSel', null);
    tcSel = new Set(saved && saved.length ? saved.filter(id => ANALOGS.some(a => a.id === id)) : ANALOGS.map(a => a.id));
  }
}
function setSel(ids) { tcSel = new Set(ids); keep.set('tcSel', [...tcSel]); tcOverride = null; renderTC(); }
function renderTC() {
  initTC();
  renderTCTable(); renderTCRange(); renderTCMap(); renderSaved();
  $('tc-norm').checked = keep.get('tcNorm', true);
  fillTcGeo();
  {   // the sections the player may forecast: on the plan first, then open acreage
    const sel = $('tc-prox-pad'), cur = sel.value, plan = (draft || C.plan)?.pads?.map(p => p.section) || [];
    const open = C.sections.filter(s => !s.developed && !plan.includes(s.section)).map(s => s.section);
    sel.replaceChildren(h('option', { value: '' }, 'Section…'), ...plan.map(s => h('option', { value: s }, `${s} (planned)`)), ...open.map(s => h('option', { value: s }, s)));
    sel.value = cur || plan[0] || '';
    const nb = $('tc-near'); nb.disabled = !plan.length; nb.title = plan.length ? '' : 'Add pads to the plan first';   // nothing to be near yet
  }
  previewTC();
}
function renderTCTable() {
  const cols = [['', null], ['Well', 'id'], ['Spacing ft', 'well_spacing_ft'], ['Half-length', 'hl'], ['Months', 'history_months'], ['Cum oil', 'cum'], ['Peak bbl/mo', 'peak']];
  const val = (a, k) => k === 'hl' ? a.design.half_length_ft : k === 'cum' ? cumOil(a) : k === 'peak' ? peakOil(a) : k === 'section' ? a.section + a.id : a[k];
  const rows = [...ANALOGS].sort((a, b) => {
    if (tcSort.key === 'section') return (a.section + a.id).localeCompare(b.section + b.id);
    const x = val(a, tcSort.key), y = val(b, tcSort.key);
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * tcSort.dir;
  });
  const t = h('table', { class: 'data tc-grid' });
  const hr = h('tr');
  for (const [lab, key] of cols) {
    const th = h('th', key ? { 'aria-sort': tcSort.key === key ? (tcSort.dir > 0 ? 'ascending' : 'descending') : 'none' } : {});
    if (key) th.append(h('button', { type: 'button', class: 'sort', onclick: () => { tcSort = { key, dir: tcSort.key === key ? -tcSort.dir : 1 }; renderTCTable(); } },
      lab, tcSort.key === key ? (tcSort.dir > 0 ? ' ↑' : ' ↓') : ''));
    hr.append(th);
  }
  t.append(h('thead', {}, hr));
  const tb = h('tbody');
  let lastSec = null;
  for (const a of rows) {
    if (tcSort.key === 'section' && a.section !== lastSec) {   // grouped by section, with a toggle for the whole section
      lastSec = a.section;
      const ids = ANALOGS.filter(x => x.section === a.section).map(x => x.id);
      const all = ids.every(id => tcSel.has(id));
      const cb = h('input', { type: 'checkbox', 'aria-label': `All wells in section ${a.section}` }); cb.checked = all;
      cb.indeterminate = !all && ids.some(id => tcSel.has(id));
      cb.addEventListener('change', () => { const s = new Set(tcSel); ids.forEach(id => cb.checked ? s.add(id) : s.delete(id)); setSel(s); });
      tb.append(h('tr', { class: 'grp' }, h('td', {}, cb), h('td', { colspan: cols.length - 1 }, `Section ${a.section}`, h('span', { class: 'hint' }, `  ${ids.length} wells, ${a.owner === 'you' ? 'yours' : 'inherited'}`))));
    }
    const cb = h('input', { type: 'checkbox', 'aria-label': `Use ${a.id}` }); cb.checked = tcSel.has(a.id);
    cb.addEventListener('change', () => { const s = new Set(tcSel); cb.checked ? s.add(a.id) : s.delete(a.id); setSel(s); });
    const tr = h('tr', { class: tcSel.has(a.id) ? '' : 'off' }, h('td', {}, cb), h('td', {}, a.id, a.owner === 'you' ? h('span', { class: 'tag' }, 'yours') : null),
      h('td', {}, num(a.well_spacing_ft)), h('td', {}, num(a.design.half_length_ft)), h('td', {}, String(a.history_months)), h('td', {}, bbl(cumOil(a))), h('td', {}, num(peakOil(a))));
    tr.addEventListener('pointerenter', () => { tcHover = a.id; drawTC(); renderTCMap(); });
    tr.addEventListener('pointerleave', () => { tcHover = null; drawTC(); renderTCMap(); });
    tb.append(tr);
  }
  t.append(tb);
  // rebuilding must not jump the list or lose the checkbox you were on
  const box = $('tc-table'), top = box.scrollTop, focused = box.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  box.replaceChildren(t);
  box.scrollTop = top;
  if (focused) box.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
// the selection's design range next to the plan's design: the source of the plan's "outside the analogs" warnings
function renderTCRange() {
  const sel = ANALOGS.filter(a => tcSel.has(a.id));
  if (!sel.length) { $('tc-range').replaceChildren(); return; }
  const rng = (f) => [Math.min(...sel.map(f)), Math.max(...sel.map(f))];
  const d = (draft || defaultDraft());
  const open = d.pads.filter(p => !C.pads_started.some(x => x.section === p.section));
  const spacings = open.map(p => Math.round(C.section_ft / p.wells));
  const row = (lab, [lo, hi], mine, unit) => {
    const vals = Array.isArray(mine) ? mine : mine == null ? [] : [mine];
    const inside = vals.every(v => v >= lo - 1e-6 && v <= hi + 1e-6);
    const txt = vals.length ? [...new Set(vals)].map(v => num(v)).join(', ') : null;
    return h('li', {}, h('span', {}, lab), h('span', {}, `${num(lo)}–${num(hi)} ${unit}`),
      h('strong', inside ? {} : { class: 'neg' }, txt == null ? 'no new pads' : `${inside ? '✓' : '✗'} plan ${txt} ${unit}`));
  };
  $('tc-range').replaceChildren(h('h2', {}, 'Current selection against your plan'), h('ul', { class: 'plain rng' },
    row('Well spacing', rng(a => a.well_spacing_ft), spacings, 'ft'),
    row('Half-length', rng(a => a.design.half_length_ft), d.design.half_length_ft, 'ft'),
    row('Conductivity', rng(a => a.design.conductivity_mdft), d.design.conductivity_mdft, 'md-ft'),
    row('Stage spacing', rng(a => a.design.stage_spacing_ft), d.design.stage_spacing_ft, 'ft')),
    h('p', { class: 'hint' }, 'The plan itself is checked against the wells of the saved type curve it uses; save this selection to make them the same.'));
}
function renderTCMap() {
  fieldMap($('map-tc'), { career: C, analogs: ANALOGS, selected: tcSel, highlight: tcHover, plan: draft,
    onWell: (id) => { const s = new Set(tcSel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); } });
}
function renderSaved() {
  const ul = $('tc-list'); ul.replaceChildren();
  const names = Object.keys(C.typecurves), used = (draft || C.plan)?.typecurve;
  if (!names.length) ul.append(h('li', { class: 'hint' }, 'None yet. The plan needs a saved type curve.'));
  for (const n of names) {
    const t = C.typecurves[n];
    ul.append(h('li', {}, h('span', {}, n, n === used ? h('span', { class: 'tag' }, 'used by the plan') : null),
      h('span', { class: 'meta' }, `P50 ${bbl(t.eur_oil_per_1000ft?.p50 ?? 0)}/1,000 ft, ${t.analogs.length} wells`),
      h('button', { type: 'button', class: 'small-btn', onclick: () => { $('tc-name').value = n; setSel(t.analogs); } }, 'Load')));
  }
  const updateBtn = () => { $('tc-save-btn').textContent = C.typecurves[$('tc-name').value.trim()] ? 'Overwrite type curve' : 'Save type curve'; };
  $('tc-name').oninput = updateBtn; updateBtn();
}
// adjust the type curve for geology: the player's saved interpretation and an attribute (server fits the exponent)
const tcDesign = () => ($('tc-design')?.checked ? { normalise_design: true } : {});
const tcGeo = () => { const v = $('tc-geo')?.value; if (!v) return {}; const [geomodel, attribute] = v.split('|'); return { normalise_to: { geomodel, attribute } }; };
async function fillTcGeo() {
  const sel = $('tc-geo'); if (!sel) return;
  const g = await geology(C).catch(() => null), keepV = sel.value || keep.get('tcGeo', '');
  const ATTR = { hcpv: 'HCPV', net_ft: 'net pay', gross_ft: 'gross thickness', phi: 'porosity' };
  sel.replaceChildren(h('option', { value: '' }, 'No (per 1,000 ft only)'), ...Object.entries(g?.geomodels || {}).flatMap(([name, m]) =>
    Object.keys(ATTR).filter(a => Object.values(m.sections || {}).some(v => v[a] != null)).map(a => h('option', { value: `${name}|${a}` }, `${name}: ${ATTR[a]}`))));
  sel.value = [...sel.options].some(o => o.value === keepV) ? keepV : '';
  if ($('tc-design')) $('tc-design').checked = keep.get('tcDesign', false);
  const models = Object.keys(g?.geomodels || {}), newest = models[models.length - 1];
  if (newest && tcSel.size >= 3) {
    const r = await call('/api/career/typecurve', { id: C.id, analogs: [...tcSel], normalise: $('tc-norm').checked, geo_fits: newest }).catch(() => null);
    const F = r?.ok ? r.geo_fits || [] : [];
    for (const o of sel.options) { const [m, a] = o.value.split('|'), f = m === newest && F.find(x => x.attribute === a); if (f) o.textContent = `${o.textContent} (r² ${num(f.r2, 2)})`; }
    // an attribute that is the same under every open section can't tell pads apart, however well it fits the analogs
    const secs = g.geomodels[newest].sections || {}, open = C.sections.filter(x => !x.developed).map(x => secs[x.section]).filter(Boolean);
    const varies = (a) => { const v = open.map(x => x[a]).filter(Number.isFinite); if (v.length < 2) return false; const m = v.reduce((p, q) => p + q, 0) / v.length; return m !== 0 && Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length) / Math.abs(m) > 0.03; };
    const ok = (a) => { const f = F.find(x => x.attribute === a); return f && f.usable != null ? f.usable : varies(a); };
    for (const o of sel.options) { const [m, at] = o.value.split('|'); if (m === newest && at && !ok(at)) o.textContent += ': barely varies across the open sections'; }
    const best = F.find(f => f.r2 >= 0.15 && ok(f.attribute));
    if (!keepV && best) { sel.value = `${newest}|${best.attribute}`; keep.set('tcGeo', sel.value); tcOverride = null; previewTC(); }   // preselect the best, if it explains anything
  }
  const none = sel.options.length < 2;
  $('tc-geo-row').hidden = false; sel.disabled = none;
  let tip = $('tc-geo-none'); if (!tip) { tip = h('p', { class: 'hint', id: 'tc-geo-none' }, 'Save an interpretation on the ', h('button', { type: 'button', class: 'linkish', onclick: () => setTab('maps') }, 'Maps'), ' tab to scale each pad to the rock under it.'); $('tc-geo-row').append(tip); }
  tip.hidden = !none;
}
function geoNote(r) {
  const el = $('tc-geo-note'); if (!el) return;
  const g = r?.geology;
  const AL = { hcpv: 'HCPV', net_ft: 'net pay', gross_ft: 'gross thickness', phi: 'porosity', sw: 'water saturation' };
  const src = typeof g?.source === 'object' && g.source ? `${AL[g.source.attribute] || g.source.attribute || 'geology'} from “${g.source.geomodel || 'your map'}”` : (g?.source || 'geology');
  el.textContent = !g ? '' : `Adjusted for ${src}: production per 1,000 ft scales with the mapped value to the power ${num(g.exponent, 2)} (fit r² ${num(g.r2, 2)} over ${g.n} wells${g.r2 < 0.2 ? '; weak, so the adjustment is small or unreliable' : ''}). Each pad then gets its own factor from your map.`;
}
function previewTC() {
  clearTimeout(tcTimer);
  tcTimer = setTimeout(async () => {
    if (tcSel.size < 3) { $('tc-msg').textContent = 'Pick at least three wells.'; return; }
    const r = await call('/api/career/typecurve', { id: C.id, analogs: [...tcSel], normalise: $('tc-norm').checked, ...tcGeo(), ...tcDesign() });
    if (!r.ok) { $('tc-msg').textContent = r.errors.join(' '); return; }
    tcRes = r; $('tc-msg').textContent = proxMsg; proxMsg = ''; geoNote(r);
    if (!tcOverride) { tcOverride = { ...r.fits.p50 }; tcAdj = null; }
    drawTC(); renderTCSliders();
  }, 250);
}
$('tc-norm').addEventListener('change', () => { keep.set('tcNorm', $('tc-norm').checked); tcOverride = null; previewTC(); });
$('tc-design')?.addEventListener('change', () => { keep.set('tcDesign', $('tc-design').checked); tcOverride = null; previewTC(); });
$('tc-geo')?.addEventListener('change', () => { keep.set('tcGeo', $('tc-geo').value); tcOverride = null; previewTC(); });
$('tc-all').addEventListener('click', () => setSel(ANALOGS.map(a => a.id)));
$('tc-prox')?.addEventListener('click', async () => {
  const pad = $('tc-prox-pad').value; if (!pad) { $('tc-msg').textContent = 'Choose a section to forecast first.'; return; }
  const r = await call('/api/career/typecurve', { id: C.id, proximity: { pad, n: +$('tc-prox-n').value || 8 }, normalise: $('tc-norm').checked });
  if (!r.ok) { $('tc-msg').textContent = r.errors.join(' '); return; }
  const P = r.proximity?.analogs || [];
  proxMsg = `The ${P.length} nearest producing wells to section ${pad}, from ${num(Math.min(...P.map(a => a.distance_ft)) / 5280, 1)} to ${num(Math.max(...P.map(a => a.distance_ft)) / 5280, 1)} miles away. ${r.proximity?.note || ''}`;
  setSel(P.map(a => a.id));
});
let proxMsg = '';
$('tc-none').addEventListener('click', () => setSel([]));
$('tc-near').addEventListener('click', () => {
  // wells in the sections nearest to the pads in the draft plan (Chebyshev distance on the section grid)
  const d = draft || defaultDraft(), secs = Object.fromEntries(C.sections.map(s => [s.section, s]));
  const targets = d.pads.map(p => secs[p.section]).filter(Boolean);
  if (!targets.length) { $('tc-msg').textContent = 'Add pads to the plan first; then this picks the wells closest to them.'; return; }
  const dist = (a) => Math.min(...targets.map(t => Math.max(Math.abs(secs[a.section].col - t.col), Math.abs(secs[a.section].row - t.row))));
  const best = Math.min(...ANALOGS.map(dist));
  let pick = ANALOGS.filter(a => dist(a) <= best + 1);
  if (pick.length < 3) pick = [...ANALOGS].sort((a, b) => dist(a) - dist(b)).slice(0, 3);
  setSel(pick.map(a => a.id));
});

// Arps, monthly volumes. qi per month at the aligned peak; di, dmin nominal per year; switch to exponential at dmin.
function arps({ qi, di, b, dmin }, n) {
  const out = []; const bb = Math.max(b, 1e-6);
  const tsw = di > dmin ? (di / dmin - 1) / (bb * di) : 0;
  const qsw = qi / Math.pow(1 + bb * di * tsw, 1 / bb);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / 12;
    out.push(t < tsw ? qi / Math.pow(1 + bb * di * t, 1 / bb) : qsw * Math.exp(-dmin * (t - tsw)));
  }
  return out;
}
function drawTC() {
  const r = tcRes; if (!r) return;
  const n = Math.min(120, Math.max(48, ...r.wells.map(w => w.aligned_oil.length)));
  const x = [...Array(n).keys()];
  const pad = (a) => x.map(i => a[i] ?? null);
  const series = r.wells.filter(w => w.id !== tcHover).map(w => ({ name: w.id, y: pad(w.aligned_oil), color: COLORS.well, width: 1, legend: false, label: false, tip: false }));
  // one hue for the percentile family, told apart by dash and end labels (blue already means inherited wells)
  series.push({ name: 'P10 (high)', y: r.fit_curves.p10.slice(0, n), color: COLORS.dev, dash: '7 4' });
  series.push({ name: 'P50', y: r.fit_curves.p50.slice(0, n), color: COLORS.dev, width: 2.6 });
  series.push({ name: 'P90 (low)', y: r.fit_curves.p90.slice(0, n), color: COLORS.dev, dash: '2 3' });
  const fitsEqual = tcOverride && ['qi', 'di', 'b', 'dmin'].every(k => Math.abs(tcOverride[k] - r.fits.p50[k]) < 1e-9);
  if (!fitsEqual) series.push({ name: 'Your P50', y: arps(tcOverride, n), color: COLORS.ink, width: 2 });
  const hw = r.wells.find(w => w.id === tcHover);
  if (hw) series.push({ name: hw.id, y: pad(hw.aligned_oil), color: COLORS.ink, width: 2, label: false });
  multiChart($('ch-tc'), { title: `Oil per month${r.per_ft ? ', per 1,000 ft of lateral' : ''}, aligned to peak`, logY: true,
    note: `${r.wells.length} wells in grey${hw ? `; ${hw.id} highlighted` : ''}. Percentile fits use months with at least three wells (${r.months_with_enough_wells} months).`,
    x, xLabel: 'months on production', fmtY: (v) => num(v), fmtTipX: (v) => `Month ${v}`, series, H: 320 });
  const e = $('tc-eur'); e.replaceChildren();
  for (const [k, lab] of [['p90', 'P90 EUR, fitted (low)'], ['p50', 'P50 EUR, fitted'], ['p10', 'P10 EUR, fitted (high)']]) e.append(h('div', {}, h('span', {}, lab), h('strong', {}, bbl(r.eur_oil[k]))));
  if (!fitsEqual && tcAdj) e.append(h('div', { class: 'yours' }, h('span', {}, 'Your P50 EUR'), h('strong', {}, `${bbl(tcAdj.eur_oil.p50)} (${tcAdj.eur_oil.p50 >= r.eur_oil.p50 ? '+' : ''}${pct(tcAdj.eur_oil.p50 / r.eur_oil.p50 - 1)})`)));
  e.append(h('div', {}, h('span', {}, 'Gas-oil ratio'), h('strong', {}, `${num(r.gor_mcf_bbl, 1)} Mcf/bbl`)));
}
function renderTCSliders() {
  const box = $('tc-sliders'); box.replaceChildren();
  const f = tcRes.fits.p50;
  const defs = [['qi', 'Initial rate qi', f.qi * 0.4, f.qi * 1.8, f.qi / 200, (v) => `${num(v)} bbl/mo`],
    ['di', 'Initial decline Di', 0.1, Math.max(30, f.di * 2), 0.05, (v) => `${num(v, 2)} /yr`],
    ['b', 'Hyperbolic exponent b', 0.1, 2.0, 0.01, (v) => num(v, 2)],
    ['dmin', 'Terminal decline Dmin', 0.03, 0.2, 0.005, (v) => `${num(v * 100, 1)}% /yr`]];
  for (const [k, label, lo, hi, step, f2] of defs) {
    const out = h('output', {}, f2(tcOverride[k]));
    const inp = h('input', { type: 'range', min: lo, max: hi, step, 'aria-label': label }); inp.value = tcOverride[k];
    inp.addEventListener('input', () => { tcOverride[k] = +inp.value; out.textContent = f2(+inp.value); drawTC(); previewAdjusted(); });
    box.append(h('div', { class: 'ctl' }, h('label', {}, h('span', {}, label), out), inp));
  }
  box.append(h('button', { type: 'button', class: 'small-btn', onclick: () => { tcOverride = { ...tcRes.fits.p50 }; tcAdj = null; renderTCSliders(); drawTC(); } }, 'Reset to the fit'));
}
// the server prices the hand-adjusted P50 (nothing is stored without save), so EUR follows the sliders
function previewAdjusted() {
  clearTimeout(adjTimer);
  adjTimer = setTimeout(async () => {
    const r = await call('/api/career/typecurve', { id: C.id, analogs: [...tcSel], normalise: $('tc-norm').checked, ...tcGeo(), ...tcDesign(), overrides: { p50: { ...tcOverride } } });
    tcAdj = r.ok ? r.adjusted : null;
    if (!r.ok) $('tc-msg').textContent = r.errors.join(' ');
    drawTC();
  }, 250);
}
$('tc-save').addEventListener('submit', async (e) => {
  e.preventDefault();
  let name = $('tc-name').value.trim();
  if (!name) { let n = Object.keys(C.typecurves).length + 1; while (C.typecurves[`Type curve ${n}`]) n++; name = `Type curve ${n}`; $('tc-name').value = name; }
  const body = { id: C.id, analogs: [...tcSel], normalise: $('tc-norm').checked, ...tcGeo(), ...tcDesign(), save: name };
  const f = tcRes.fits.p50;
  if (['qi', 'di', 'b', 'dmin'].some(k => Math.abs(tcOverride[k] - f[k]) > 1e-9)) body.overrides = { p50: { ...tcOverride } };
  const r = await call('/api/career/typecurve', body);
  $('tc-msg').textContent = r.ok ? `Saved “${name}”. P50 EUR ${bbl(r.saved?.eur_oil_per_1000ft?.p50 ?? r.eur_oil.p50)} per ${r.per_ft ? '1,000 ft' : 'well'}${body.overrides ? ', with your override' : ''}.` : r.errors.join(' ');
  if (r.ok) { await reload(); renderSaved(); }
});

// ------------------------------------------------------------------ plan
// Mode: during a budget meeting the plan is a draft for the board; otherwise it is a what-if, and the approved plan keeps running.
function defaultDraft() {
  const L = C.limits, tcs = Object.keys(C.typecurves);
  const saved = keep.get('draft', null);
  const p = saved || (C.plan ? structuredClone(C.plan) : {
    design: { stage_spacing_ft: 250, half_length_ft: 300, conductivity_mdft: 40, bhp_psi: 1500 },
    typecurve: tcs[0] || null, percentile: 'p50', pads: [], rigs: 1, crews: 1, budget_request: {},
  });
  for (const [k, [lo, hi]] of Object.entries(L.design)) p.design[k] = Math.min(hi, Math.max(lo, p.design[k]));
  if (!p.typecurve || !C.typecurves[p.typecurve]) p.typecurve = tcs[0] || null;
  p.budget_request ||= {};
  for (const k of Object.keys(p.budget_request)) if (+k > 4) delete p.budget_request[k];
  return p;
}
function saveDraft() { keep.set('draft', draft); if (C?.budget_needed) renderBar(); }   // the bar's next step follows the draft
// a draft started before any type curve existed must pick one up as soon as one is saved (else the board check waits forever)
function fixDraftTC() {
  if (!draft) return;
  const tcs = Object.keys(C.typecurves || {});
  if ((!draft.typecurve || !C.typecurves[draft.typecurve]) && tcs.length) { draft.typecurve = tcs[0]; saveDraft(); }
}
function addPad(sec) {
  if (!draft) draft = defaultDraft();
  fixDraftTC();
  if (draft.pads.find(p => p.section === sec)) return;
  const s = C.sections.find(x => x.section === sec);
  if (!s || s.developed) return;
  draft.pads.push({ section: sec, wells: 4 });
  saveDraft();
}
let planTimer = null;
function renderPlan() {
  if (!draft) draft = defaultDraft();
  fixDraftTC();
  renderStrip();
  const locked = new Set(C.pads_started.map(p => p.section));
  fieldMap($('map-plan'), { career: C, analogs: ANALOGS, plan: draft, selected: new Set(), onSection: (s) => {
    const i = draft.pads.findIndex(p => p.section === s);
    if (i >= 0) { if (!locked.has(s)) draft.pads.splice(i, 1); } else addPad(s);
    saveDraft(); renderPlan();
  } });
  // keyboard path to the same action as clicking the map
  const open = C.sections.filter(s => !s.developed && !draft.pads.some(p => p.section === s.section));
  const sel = h('select', { 'aria-label': 'Open section for a new pad' }, h('option', { value: '' }, open.length ? 'Choose an open section' : 'No open sections left'), ...open.map(s => h('option', { value: s.section }, s.section)));
  $('add-pad').replaceChildren(h('label', { class: 'hint' }, 'Click an open section on the map, or '), sel,
    h('button', { type: 'button', class: 'small-btn', onclick: () => { if (sel.value) { addPad(sel.value); renderPlan(); } } }, 'Add pad'));
  const ol = $('pads'); ol.replaceChildren();
  if (!draft.pads.length) ol.append(h('li', { class: 'hint' }, 'No pads yet.'));
  draft.pads.forEach((p, i) => {
    const started = C.pads_started.find(x => x.section === p.section);
    if (started) {   // locked pads: one line
      ol.append(h('li', { class: 'locked-row' }, h('strong', {}, `Pad ${p.section}`), h('span', { class: 'locked' }, `locked: ${started.wells} wells, online ${monthName(started.online_month)}`)));
      return;
    }
    const wells = h('input', { type: 'number', min: C.limits.wells_per_section[0], max: C.limits.wells_per_section[1], step: 1, 'aria-label': `Wells on pad ${p.section}` });
    wells.value = p.wells;
    wells.addEventListener('change', () => { p.wells = Math.min(C.limits.wells_per_section[1], Math.max(C.limits.wells_per_section[0], Math.round(+wells.value))); saveDraft(); renderPlan(); });
    const pc = h('select', { 'aria-label': `Percentile for pad ${p.section}` }, ...['', 'p10', 'p50', 'p90'].map(v => h('option', { value: v }, v ? v.toUpperCase() : 'plan default')));
    pc.value = p.percentile || '';
    pc.addEventListener('change', () => { if (pc.value) p.percentile = pc.value; else delete p.percentile; saveDraft(); schedulePlan(); });
    const st = h('select', { 'aria-label': `Who steers pad ${p.section}` }, h('option', { value: 'staff' }, 'Staff steers'), h('option', { value: 'manual' }, 'I steer'));
    st.value = p.steer || 'staff';
    st.addEventListener('change', () => { p.steer = st.value; saveDraft(); schedulePlan(); });
    // who runs the frac job and the flowback: the company standard, or you (each becomes a minigame task when the pad locks)
    const cpl = h('select', { 'aria-label': `Who designs the frac on pad ${p.section}` }, h('option', { value: 'standard' }, 'Standard frac'), h('option', { value: 'manual' }, 'I pump the job'));
    cpl.value = p.completion || 'standard';
    cpl.addEventListener('change', () => { p.completion = cpl.value; saveDraft(); schedulePlan(); });
    const fb = h('select', { 'aria-label': `Who runs flowback on pad ${p.section}` }, h('option', { value: 'standard' }, 'Standard flowback'), h('option', { value: 'manual' }, 'I run flowback'));
    fb.value = p.flowback || 'standard';
    fb.addEventListener('change', () => { p.flowback = fb.value; saveDraft(); schedulePlan(); });
    ol.append(h('li', {}, h('strong', {}, `Pad ${p.section}`),
      h('span', {}, h('button', { type: 'button', 'aria-label': `Move pad ${p.section} up`, onclick: () => { if (i) { [draft.pads[i - 1], draft.pads[i]] = [draft.pads[i], draft.pads[i - 1]]; saveDraft(); renderPlan(); } } }, '↑'),
        ' ', h('button', { type: 'button', 'aria-label': `Remove pad ${p.section}`, onclick: () => { draft.pads.splice(i, 1); saveDraft(); renderPlan(); } }, 'Remove')),
      h('span', { class: 'pad-ctl' }, 'Wells', wells, `${num(Math.round(C.section_ft / p.wells))} ft apart`, pc, st, cpl, fb)));
  });
  const tcs = Object.keys(C.typecurves), tcBox = $('plan-tc'); tcBox.replaceChildren();
  if (!tcs.length) tcBox.append(h('p', { class: 'hint' }, 'Save a type curve first.'), h('button', { type: 'button', class: 'small-btn', onclick: () => setTab('typecurve') }, 'Open the type curve tab'));
  else {
    const sel2 = h('select', { 'aria-label': 'Type curve' }, ...tcs.map(n => h('option', { value: n }, n))); sel2.value = draft.typecurve;
    sel2.addEventListener('change', () => { draft.typecurve = sel2.value; saveDraft(); schedulePlan(); });
    const per = h('select', { 'aria-label': 'Percentile' }, ...['p10', 'p50', 'p90'].map(v => h('option', { value: v }, `${v.toUpperCase()}${v === 'p10' ? ' (high)' : v === 'p90' ? ' (low)' : ''}`))); per.value = draft.percentile;
    per.addEventListener('change', () => { draft.percentile = per.value; saveDraft(); schedulePlan(); });
    tcBox.append(h('div', { class: 'budget-row' }, sel2, per));
  }
  // design sliders show the selected analogs' range under each one
  const planIds = new Set(C.typecurves[draft.typecurve]?.analogs || []);
  const sel3 = ANALOGS.filter(a => planIds.size ? planIds.has(a.id) : true);
  const rng = (f) => sel3.length ? `${draft.typecurve || 'type curve'} analogs ${num(Math.min(...sel3.map(f)))}–${num(Math.max(...sel3.map(f)))}` : '';
  const dz = $('plan-design'); dz.replaceChildren();
  const DL = { stage_spacing_ft: ['Stage spacing', 'ft', 10, a => a.design.stage_spacing_ft], half_length_ft: ['Fracture half-length', 'ft', 10, a => a.design.half_length_ft],
    conductivity_mdft: ['Fracture conductivity', 'md-ft', 1, a => a.design.conductivity_mdft], bhp_psi: ['Bottom-hole pressure', 'psi', 50, a => a.design.bhp_psi] };
  for (const [k, [lab, unit, step, f]] of Object.entries(DL)) {
    const c = rangeCtl(lab, unit, C.limits.design[k], step, draft.design[k], (v) => { draft.design[k] = v; saveDraft(); schedulePlan(); });
    c.append(h('p', { class: 'hint' }, rng(f) ? `${rng(f)} ${unit}` : ''));
    dz.append(c);
  }
  const eq = $('plan-equip'); eq.replaceChildren();
  eq.append(rangeCtl('Drilling rigs', '', C.limits.rigs, 1, draft.rigs, (v) => { draft.rigs = v; saveDraft(); schedulePlan(); }));
  eq.append(rangeCtl('Frac crews', '', C.limits.crews, 1, draft.crews, (v) => { draft.crews = v; saveDraft(); schedulePlan(); }));
  if (C.emissions) {   // #14: emissions choices for new pads
    draft.emissions ||= { electric_frac: false, vru: false };
    const tog = (k, label, why) => { const c = h('input', { type: 'checkbox' }); c.checked = !!draft.emissions[k];
      c.addEventListener('change', () => { draft.emissions = { ...draft.emissions, [k]: c.checked }; saveDraft(); schedulePlan(); });
      return h('label', { class: 'check em-tog' }, c, ' ', h('span', {}, h('strong', {}, label), h('small', {}, why))); };
    eq.append(h('div', { class: 'em-box' }, h('span', { class: 'lbl-sm' }, 'Emissions'),
      tog('electric_frac', 'Electric frac fleet', `+${num((C.emissions.electric_frac_completion_factor ?? 1.04) * 100 - 100)}% completion cost; halves frac emissions`),
      tog('vru', 'Vapour recovery units', `${usd(C.emissions.vru_usd_pad ?? 150000)} a pad; cuts fugitive emissions by three quarters`)));
  }
  schedulePlan();
}
function rangeCtl(label, unit, [lo, hi], step, value, on) {
  const out = h('output', {}, `${num(value)}${unit ? ' ' + unit : ''}`);
  const inp = h('input', { type: 'range', min: lo, max: hi, step, 'aria-label': label }); inp.value = value;
  inp.addEventListener('input', () => { out.textContent = `${num(+inp.value)}${unit ? ' ' + unit : ''}`; on(+inp.value); });
  return h('div', { class: 'ctl' }, h('label', {}, h('span', {}, label), out), inp);
}
// the strip above everything: what mode you are in, whether the board will accept it, and what to do next
function renderStrip() {
  const meeting = C.budget_needed;
  const bc = planRes?.board_check;
  const v = planRes?.revision;
  const mode = meeting ? `Drafting the year ${C.year} plan for the board meeting.`
    : v ? 'The approved plan keeps running until you apply a revision below.'
    : `What-if. The approved plan keeps running; changes here take effect at the year ${C.year + 1} budget meeting.`;
  const check = !meeting ? null : !bc ? h('span', { class: 'pill' }, 'Board check: evaluating')
    : !bc.floor_applies ? h('span', { class: 'pill ok' }, '✓ No guidance floor this year')
    : (bc.conditions?.find(c => c.key === 'floor')?.passes ?? bc.floor_reachable) ? h('span', { class: 'pill ok' }, `✓ Can reach the floor: up to ${bbl(bc.max_guidance_bbl)} against ${bbl(bc.guidance_floor_bbl)}`)
    : h('span', { class: 'pill bad' }, `✗ Can't reach the floor: ${bbl(bc.max_guidance_bbl)} of ${bbl(bc.guidance_floor_bbl)} needed`);
  $('plan-strip').replaceChildren(...[h('div', {}, h('strong', {}, meeting ? 'Board meeting due' : v ? 'Revise this year' : 'What-if planning'), h('span', {}, ' ' + mode)), check,
    h('span', { class: 'strip-actions' },
      C.plan ? h('button', { type: 'button', class: 'small-btn', onclick: () => { draft = structuredClone(C.plan); draft.budget_request ||= {}; saveDraft(); renderPlan(); } }, 'Reset to the approved plan') : null,
      meeting ? h('button', { type: 'button', class: 'board-go', onclick: () => setTab('board') }, 'Take it to the board') : null)].filter(Boolean));
  let rp = $('plan-revise');
  if (!rp) { rp = h('div', { id: 'plan-revise' }); $('plan-strip').after(rp); }
  rp.replaceChildren(...(!meeting && v ? [revisionPanel(v)] : []));
}
// ------------------------------------------------------------------ scenarios (#5): the same plan under other prices, costs and delays
const SCEN_DEFAULT = [
  { name: 'Low oil', oil_usd_bbl: 55 }, { name: 'High oil', oil_usd_bbl: 90 },
  { name: 'Capex +20%', capex_factor: 1.2 }, { name: 'Six months late', delay_months: 6 },
];
let scenRes = null, scenKey = null;
function renderScenarios() {
  const box = $('plan-scen'); if (!box) return;
  const S = keep.get('scen', SCEN_DEFAULT);
  const key = JSON.stringify([draft, S]);
  if (scenKey !== key) scenRes = null;   // results belong to one plan and one set of scenarios
  const save = (v) => { keep.set('scen', v); renderScenarios(); };
  const cell = (s, i, k, step, w = 70) => { const inp = h('input', { type: 'number', step, style: `width:${w}px`, 'aria-label': `${s.name}: ${k}` }); inp.value = s[k] ?? '';
    inp.addEventListener('change', () => { const v = [...S]; v[i] = { ...v[i] }; if (inp.value === '') delete v[i][k]; else v[i][k] = +inp.value; save(v); }); return inp; };
  const ed = h('table', { class: 'data scen-ed' }, h('thead', {}, h('tr', {}, ...['Scenario', 'Oil $/bbl', 'Capex ×', 'Delay, months', ''].map(x => h('th', {}, x)))),
    h('tbody', {}, ...S.map((s, i) => { const nm = h('input', { type: 'text', value: s.name, style: 'width:140px', 'aria-label': 'Scenario name' });
      nm.addEventListener('change', () => { const v = [...S]; v[i] = { ...v[i], name: nm.value || `Case ${i + 1}` }; save(v); });
      return h('tr', {}, h('td', {}, nm), h('td', {}, cell(s, i, 'oil_usd_bbl', 1)), h('td', {}, cell(s, i, 'capex_factor', 0.05)), h('td', {}, cell(s, i, 'delay_months', 1)),
        h('td', {}, h('button', { type: 'button', class: 'small-btn', 'aria-label': `Remove ${s.name}`, onclick: () => save(S.filter((_, j) => j !== i)) }, '×'))); })));
  const run = h('button', { type: 'button', class: 'small-btn do', onclick: async () => {
    run.disabled = true; run.textContent = 'Running…';
    const r = await call('/api/career/plan', { id: C.id, plan: draft, scenarios: S.slice(0, 9) });
    scenRes = r.ok ? r.scenarios : { error: (r.errors || ['Scenarios failed.']).join(' ') }; scenKey = key; renderScenarios();
  } }, 'Run the scenarios');
  box.replaceChildren(h('h2', {}, 'Scenarios'), h('p', { class: 'hint' }, 'The same development under other prices, costs and delays, on your own forecast. Empty cells keep the plan’s value.'),
    h('div', { style: 'overflow-x:auto' }, ed),
    h('div', { class: 'strip-actions' }, S.length < 9 ? h('button', { type: 'button', class: 'small-btn', onclick: () => save([...S, { name: `Case ${S.length + 1}` }]) }, 'Add a scenario') : null,
      h('button', { type: 'button', class: 'small-btn', onclick: () => save(SCEN_DEFAULT) }, 'Reset'), run));
  if (scenRes?.error) box.append(h('p', { class: 'bad' }, scenRes.error));
  if (scenRes?.cases?.length) {
    const cs = scenRes.cases, base = cs[0];
    box.append(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Case', 'Oil', 'Capex', 'Delay', 'NPV10', 'Change', 'IRR', 'PV10/I', 'Payout', 'F&D'].map(x => h('th', {}, x)))),
      h('tbody', {}, ...cs.map((c, i) => h('tr', i === 0 ? { class: 'now' } : {}, h('td', {}, i === 0 ? 'Your plan' : c.name), h('td', {}, `$${num(c.oil_usd_bbl)}`), h('td', {}, `${num(c.capex_factor, 2)}×`),
        h('td', {}, c.delay_months ? `${num(c.delay_months)} mo` : '–'), h('td', c.npv10_usd < 0 ? { class: 'bad' } : {}, usd(c.npv10_usd)),
        h('td', { class: (c.npv10_change_usd || 0) < 0 ? 'neg' : 'pos' }, i === 0 ? '–' : `${c.npv10_change_usd >= 0 ? '+' : '−'}${usd(Math.abs(c.npv10_change_usd))}`),
        h('td', {}, c.irr == null ? '–' : pct(c.irr)), h('td', {}, num(c.pvi, 2)), h('td', {}, (c.payout_month ?? c.payout_months) == null ? 'never' : `${num(c.payout_month ?? c.payout_months)} mo`), h('td', {}, `$${num(c.fd_usd_boe, 2)}/BOE`)))))),
      scenBars(cs.slice(1), base));
    if (scenRes.notes?.length) box.append(h('ul', { class: 'notes' }, ...scenRes.notes.map(n => h('li', {}, n))));
  }
}
function scenBars(cs, base) {   // the change in NPV10 against the plan, one bar per scenario, sorted (a tornado)
  const rows = [...cs].sort((a, b) => Math.abs(b.npv10_change_usd) - Math.abs(a.npv10_change_usd)), max = Math.max(1, ...rows.map(c => Math.abs(c.npv10_change_usd)));
  return h('div', { class: 'panel-card' }, h('h3', {}, `What moves the value: change in NPV10 against your plan (${usd(base.npv10_usd)})`),
    ...rows.map(c => h('div', { class: 'split-row' }, h('span', {}, c.name), h('span', { class: 'split-bar' }, h('i', { class: c.npv10_change_usd >= 0 ? 'pos' : 'neg',
      style: `width:${50 * Math.abs(c.npv10_change_usd) / max}%;${c.npv10_change_usd >= 0 ? 'left:50%' : 'right:50%'}` })),
      h('strong', { class: c.npv10_change_usd >= 0 ? 'pos' : 'neg' }, `${c.npv10_change_usd >= 0 ? '+' : '−'}${usd(Math.abs(c.npv10_change_usd))}`))));
}
function schedulePlan() { clearTimeout(planTimer); planTimer = setTimeout(() => evaluatePlan(true), 300); }
// mid-year revision (outside a budget meeting): reset guidance to the plan's forecast and/or change this year's budget.
// The server prices it in board confidence; plan changes inside the approved budget are free.
let rev = { revise_guidance: false, budget_usd: null, month: null, basis: 'pace' };
function revBody() {
  if (C.budget_needed) return {};
  if (rev.month !== C.month) rev = { revise_guidance: false, budget_usd: null, month: C.month, basis: 'pace' };
  return { revise_guidance: rev.revise_guidance, guidance_basis: rev.basis || 'pace', ...(rev.budget_usd != null ? { budget_usd: rev.budget_usd } : {}) };
}
async function applyRevision(btn) {
  btn.disabled = true; btn.textContent = 'Taking it to the board…';
  const r = await call('/api/career/revise', { id: C.id, plan: draft, ...revBody() });
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Try again'; $('rev-msg').textContent = (r.errors || ['The board did not accept the revision.']).join(' '); return; }
  C = r.career; rev = { revise_guidance: false, budget_usd: null, month: C.month, basis: 'pace' };
  draft = structuredClone(C.plan); draft.budget_request ||= {}; saveDraft(); activePlanKey = null; planRes = null;
  const v = r.revision, cc = v?.confidence_change ?? 0;
  revDone = `Revised. ${cc ? `Board confidence ${cc > 0 ? '+' : '−'}${num(Math.abs(cc), 1)}.` : 'No confidence cost.'}${v?.revise_guidance ? ` Guidance is now ${bbl(v.new_guidance_bbl)}.` : ''}`;
  renderBar(); renderPlan();
}
let revDone = '';
function revisionPanel(v) {
  const box = h('div', { class: 'revise' });
  const cc = v.confidence_change ?? 0, changed = rev.revise_guidance || (rev.budget_usd != null && Math.abs(rev.budget_usd - v.approved_usd) > 1);
  const guid = h('input', { type: 'checkbox' }); guid.checked = rev.revise_guidance; guid.disabled = v.guidance_revised_this_quarter && !rev.revise_guidance;
  guid.addEventListener('change', () => { rev.revise_guidance = guid.checked; schedulePlan(); });
  const bud = h('input', { type: 'number', min: 0, step: 0.5, 'aria-label': `Year ${v.year} budget, $ MM` });
  bud.value = ((rev.budget_usd ?? v.approved_usd) / 1e6).toFixed(1);
  bud.addEventListener('change', () => { rev.budget_usd = Math.max(0, +bud.value) * 1e6; schedulePlan(); });
  const tw = (a, b, f) => Math.abs((a ?? b) - b) > 1 ? h('span', {}, h('s', { title: 'the original promise' }, f(a)), ' ', f(b)) : h('span', {}, f(b));
  box.append(...[
    h('h3', {}, `Revise the year ${v.year} plan`),
    h('p', { class: 'hint' }, 'Change unstarted pads, the design, rigs and crews inside the approved budget for free. Telling the board early that you will miss costs less than missing at year end; asking for more money costs confidence.'),
    h('div', { class: 'rev-grid' },
      h('span', {}, 'Guidance'), tw(v.original_guidance_bbl, v.guidance_bbl, bbl),
      h('span', { class: 'rev-basis' }, h('label', { class: 'check' }, guid, ` Reset guidance${rev.revise_guidance ? `: ${bbl(v.new_guidance_bbl)}` : ''}${v.guidance_revised_this_quarter ? ' (already revised this quarter)' : ''}`),
        ...[['pace', 'to the current pace'], ['plan', 'to this plan’s forecast']].map(([k, l]) => { const r = h('input', { type: 'radio', name: 'rev-basis', value: k }); r.checked = (rev.basis || 'pace') === k; r.disabled = !rev.revise_guidance;
          r.addEventListener('change', () => { rev.basis = k; schedulePlan(); }); return h('label', { class: 'check' }, r, ` ${l}`); })),
      h('span', {}, 'Budget'), tw(v.original_approved_usd, v.approved_usd, usd),
      h('span', { class: 'req' }, '$', bud, ' MM', h('small', {}, ` board limit ${usd(v.board_limit_usd)}; this plan spends ${usd(v.planned_capex_year_usd)} this year`))),
    v.confidence_if_unrevised != null ? h('div', { class: 'rev-compare' },
      h('div', {}, h('span', {}, 'Do nothing'), h('strong', {}, String(Math.round(v.confidence_if_unrevised))), h('small', {}, 'confidence after the review, at today’s pace')),
      h('div', { class: changed ? 'pick' : '' }, h('span', {}, 'With this revision'), h('strong', {}, String(Math.round(v.confidence_if_revised ?? v.confidence_if_unrevised))), h('small', {}, 'the revision’s cost now, plus the review at today’s pace'))) : null,
    changed && v.confidence_if_revised != null && v.confidence_if_unrevised != null && v.confidence_if_revised < v.confidence_if_unrevised - 0.5
      ? h('p', { class: 'bad' }, `This revision leaves you ${num(v.confidence_if_unrevised - v.confidence_if_revised, 1)} points worse than doing nothing, at today’s pace. Change it, or leave the plan as it is.`) : null,
    h('div', { class: 'rev-price' },
      h('span', { class: `rev-cost ${cc < 0 ? 'neg' : 'pos'}` }, cc < 0 ? `−${num(-cc, 1)} confidence` : 'No confidence cost'),
      ...(cc >= 0 ? [] : [h('small', {}, [v.guidance_confidence ? `guidance ${num(v.guidance_confidence, 1)}` : null, v.budget_confidence ? `budget ${num(v.budget_confidence, 1)}` : null].filter(Boolean).join(', '))]),
      ...(v.allowed ? [h('button', { type: 'button', class: 'board-go', onclick: (e) => applyRevision(e.currentTarget) }, changed ? 'Take the revision to the board' : 'Apply plan changes')] : [])),
    ...(v.allowed ? [] : [h('p', { class: 'bad' }, (v.reasons || []).join(' '))]),
    h('p', { class: 'hint', id: 'rev-msg' }, revDone)].filter(Boolean));
  revDone = '';
  return box;
}
async function evaluatePlan(render = true) {
  if (!draft) draft = defaultDraft();
  fixDraftTC();
  if (!draft.typecurve) { if (render) { $('plan-warn').hidden = false; $('plan-warn').replaceChildren('Save a type curve before planning: the plan runs on your type curve.'); } return null; }
  const r = await call('/api/career/plan', { id: C.id, plan: draft, ...revBody() });
  if (!r.ok) { if (render) { $('plan-warn').hidden = false; $('plan-warn').replaceChildren(h('strong', {}, 'The plan was not evaluated. '), r.errors.join(' ')); } return null; }
  planRes = r; planResMonth = C.month;
  if (!render) return r;
  renderStrip();
  const msgs = [...r.warnings];
  const bc = r.board_check;
  if (bc && bc.floor_applies && !bc.floor_reachable)
    msgs.unshift(`The board will refuse this plan: guidance must reach ${bbl(bc.guidance_floor_bbl)} (your producing base ${bbl(bc.base_oil_bbl)} plus 5%), and this plan funded at the ${usd(bc.board_limit_usd)} limit reaches only ${bbl(bc.max_guidance_bbl)}. Add pads that come online this year.`);
  const cm = r.curtailed_months, nCurt = Array.isArray(cm) ? cm.length : (+cm || 0);   // a list of months or a count
  if (r.battery_limit_bbl_d != null && nCurt > 0)
    msgs.push(`The battery limit of ${num(r.battery_limit_bbl_d)} bbl/d curtails production in ${nCurt} month${nCurt > 1 ? 's' : ''}${Array.isArray(cm) ? ` (from ${monthName(cm[0])})` : ''}.`);
  if (r.unscheduled.length) msgs.push(`No budget year fits pad${r.unscheduled.length > 1 ? 's' : ''} ${r.unscheduled.join(', ')}.`);
  if (r.unbudgeted_years.length) msgs.push(`No budget requested or approved for year ${r.unbudgeted_years.filter(y => y <= 5).join(', ')}: pads that fall there are pushed back.`);
  const w = $('plan-warn'); w.hidden = !msgs.length;
  w.replaceChildren(h('strong', {}, C.budget_needed ? 'Check before you go to the board' : 'Check the plan'), h('ul', {}, ...msgs.map(m => h('li', {}, m))));
  const M = r.measures, unlocked = draft.pads.filter(p => !C.pads_started.some(x => x.section === p.section));
  if (!unlocked.length) {
    $('plan-measures').replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No new pads in this plan.'),
      h('span', {}, ' Economics appear when the plan drills something. Click an open section on the map to add a pad.')));
  } else {
    $('plan-measures').replaceChildren(...[['NPV10', usd(M.npv10_usd)], ['IRR', M.irr == null ? 'none' : pct(M.irr)], ['PV10 / I', num(M.pvi, 2)],
      ['Payout', M.payout_month == null ? 'never' : `${M.payout_month} months`], ['Peak exposure', usd(M.peak_exposure_usd)], ['Capex', usd(M.capex_usd)],
      ['F&D cost', `$${num(M.fd_usd_boe, 2)}/BOE`]].map(([a, b]) => h('div', {}, h('span', {}, a), h('strong', {}, b))));
  }
  // budget by year, with the request edited in its own row (years up to 5: the career is 5 years)
  const t = h('table', { class: 'data byyear' }, h('thead', {}, h('tr', {}, ...['Year', 'Oil forecast (guidance)', 'Planned capex', 'Your request', 'Approved', 'Board limit', 'Operating cash'].map(x => h('th', {}, x)))));
  const tb = h('tbody');
  for (const y of r.budget_by_year.filter(y => y.year <= 5)) {
    const editable = y.year_index >= C.year - 1 && y.approved_usd == null;
    const inp = h('input', { type: 'number', min: 0, step: 0.5, 'aria-label': `Budget request for year ${y.year}, $ MM` });
    const v = draft.budget_request[String(y.year_index)]; inp.value = v != null ? (v / 1e6).toFixed(1) : '';
    inp.placeholder = (y.planned_capex_usd / 1e6).toFixed(1);
    inp.addEventListener('change', () => { if (inp.value === '') delete draft.budget_request[String(y.year_index)]; else draft.budget_request[String(y.year_index)] = Math.max(0, +inp.value) * 1e6; saveDraft(); schedulePlan(); });
    const over = y.board_limit_usd != null && (y.requested_usd ?? 0) > y.board_limit_usd;
    tb.append(h('tr', y.year === C.year ? { class: 'now' } : {}, h('td', {}, `Year ${y.year}${y.year === C.year ? ' (now)' : ''}`),
      h('td', {}, bbl(y.oil_forecast_bbl), y.oil_forecast_unrisked_bbl != null && Math.abs(y.oil_forecast_unrisked_bbl - y.oil_forecast_bbl) > 1 ? h('small', { class: 'hint', title: 'Before the expected pad delays and parent-child interference' }, ` unrisked ${bbl(y.oil_forecast_unrisked_bbl)}`) : null),
      h('td', {}, usd(y.planned_capex_usd)),
      h('td', over ? { class: 'bad' } : {}, editable ? h('span', { class: 'req' }, '$', inp, ' MM') : usd(y.requested_usd)),
      h('td', {}, usd(y.approved_usd)), h('td', {}, y.board_limit_usd != null ? usd(y.board_limit_usd) : ''), h('td', {}, usd(y.op_cash_forecast_usd))));
  }
  t.append(tb);
  $('plan-years').replaceChildren(h('h2', {}, 'Budget by year'), h('p', { class: 'hint' }, 'Type a request beside planned capex. Empty means none: pads in that year wait.'), h('div', { style: 'overflow-x:auto' }, t));
  if (!r.gantt.bars.some(b => b.end_month > C.month)) $('ch-gantt').replaceChildren(h('h2', {}, 'Schedule'), h('p', { class: 'hint' }, 'Nothing scheduled from this month on. Add pads to put rigs and frac crews to work.'));
  else gantt($('ch-gantt'), r.gantt, { now: C.month, fmtMonth: (m) => monthName(m), horizon: Math.min(C.career_months, Math.max(C.month + 18, Math.ceil(Math.max(...r.gantt.bars.map(b => b.end_month), 0) + 1))) });
  const F = r.forecast;
  multiChart($('ch-forecast'), { title: 'Oil forecast on your type curve, bbl per month', note: 'Producing wells (PDP) plus the development in this plan.',
    x: F.month, xLabel: 'month', fmtY: (v) => num(v), fmtTipX: monthName, series: [
      { name: 'Producing wells', y: F.oil_pdp, color: COLORS.pdp, stack: 'oil' },
      { name: 'Development', y: F.oil_dev, color: COLORS.dev, stack: 'oil' },
    ], now: C.month });
  const pt = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Pad', 'Wells', 'Spacing ft', 'Type curve', 'Online', 'Interference', 'Capex', 'NPV10', 'PV10/I', 'IRR'].map(x => h('th', {}, x)))));
  const pb = h('tbody');
  for (const p of r.pads) pb.append(h('tr', {}, h('td', {}, p.pad + (p.started ? ' (locked)' : '')), h('td', {}, String(p.wells)), h('td', {}, num(p.well_spacing_ft)),
    h('td', {}, `${p.typecurve} ${p.percentile.toUpperCase()}`), h('td', {}, p.online_month == null ? 'unscheduled'
      : p.online_month_p90 != null && monthName(p.online_month_p90) !== monthName(p.online_month_p10) ? h('span', {}, monthName(p.online_month_p50 ?? p.online_month), h('small', { class: 'pop' }, ` likely ${monthName(p.online_month_p10)} to ${monthName(p.online_month_p90)}`))
      : monthName(p.online_month)),
    h('td', p.interference_child_factor != null && p.interference_child_factor < 0.97 ? { class: 'bad', title: `Edge well next to ${(p.parents || []).map(x => x.well || x.id || x).join(', ')}` } : {},
      p.interference_child_factor == null ? '–' : `×${num(p.interference_child_factor, 2)}${p.parents?.length ? `, ${p.parents.length} parent${p.parents.length > 1 ? 's' : ''}` : ''}`),
    h('td', {}, usd(p.capex_usd)), h('td', p.npv10_usd < 0 ? { class: 'bad' } : {}, usd(p.npv10_usd)), h('td', {}, num(p.pvi, 2)), h('td', {}, p.irr == null ? '–' : pct(p.irr))));
  pt.append(pb);
  $('plan-pads').replaceChildren(...[h('h2', {}, 'Pad economics'), r.pads.length ? h('div', { style: 'overflow-x:auto' }, pt) : h('p', { class: 'hint' }, 'No pads yet: pick a section on the map above to add one.'),
    r.pads.some(p => p.online_month_p90 != null) ? h('p', { class: 'hint' }, 'Online: the planned month, and the range it will likely fall in. About a quarter of pads start 7 to 40 days late (permits, weather, a late frac crew, pad construction); the odds are known, the draws are not.') : null].filter(Boolean));
  renderScenarios();
  const A = r.afe_estimate_per_well;
  $('plan-afe').replaceChildren(h('h2', {}, `AFE estimate per well: ${usd(A.total_usd)}`), h('p', { class: 'hint' },
    `${A.stages} stages. Drilling ${usd(A.drilling_usd)} over ${num(A.drill_days, 1)} days, completion ${usd(A.completion_usd)} over ${num(A.frac_days, 1)} days, facilities ${usd(A.facilities_usd)}.`));
  return r;
}
let planResMonth = -1;

// ------------------------------------------------------------------ board
let lastDecision = null;
async function renderBoard() {
  const main = $('board-main'), side = $('board-side');
  if (!draft) draft = defaultDraft();
  fixDraftTC();
  if (!planRes || planResMonth !== C.month) await evaluatePlan(false);   // works without visiting Plan first, and never a month stale
  main.replaceChildren(); side.replaceChildren();
  const yi = C.year - 1;
  main.append(h('h2', {}, `Year ${C.year} budget meeting`));
  if (lastDecision) {   // the outcome replaces the form
    const d = lastDecision;
    main.append(h('div', { class: 'decision ' + (d.approved ? 'yes' : 'no') },
      h('strong', {}, d.approved ? `Approved: ${usd(d.approved_usd)}, guidance ${bbl(d.guidance_oil_bbl)}.` : 'Rejected.'),
      d.reasons?.length ? h('ul', {}, ...d.reasons.map(x => h('li', {}, x))) : null),
      d.approved ? h('button', { type: 'button', class: 'board-go', onclick: () => { lastDecision = null; setTab('home'); } }, 'Back to the desk')
        : h('span', { class: 'strip-actions' }, h('button', { type: 'button', class: 'board-go', onclick: () => { lastDecision = null; setTab('plan'); } }, 'Revise the plan'),
          h('button', { type: 'button', class: 'small-btn', onclick: () => { lastDecision = null; renderBoard(); } }, 'Back to the meeting')));
  } else if (!C.budget_needed) {
    main.append(h('p', {}, `The board approved ${usd(C.board.approved[String(yi)])} for year ${C.year}, with oil guidance of ${bbl(C.board.guidance[String(yi)] ?? 0)}. The next meeting is at the start of year ${C.year + 1}.`));
  } else if (!planRes) {
    main.append(h('p', {}, 'The board needs a plan with a type curve.'), h('button', { type: 'button', class: 'board-go', onclick: () => setTab(Object.keys(C.typecurves).length ? 'plan' : 'typecurve') }, 'Build the plan'));
  } else {
    const by = planRes.budget_by_year.find(y => y.year_index === yi), bc = planRes.board_check, M = planRes.measures;
    const ask = draft.budget_request[String(yi)] ?? 0, limit = by?.board_limit_usd ?? bc?.board_limit_usd ?? 0;
    // the ask: editable here, against the limit
    const inp = h('input', { type: 'number', min: 0, step: 0.5, 'aria-label': `Budget request for year ${C.year}, $ MM` }); inp.value = (ask / 1e6).toFixed(1);
    inp.addEventListener('change', async () => { draft.budget_request[String(yi)] = Math.max(0, +inp.value) * 1e6; saveDraft(); await evaluatePlan(false); renderBoard(); });
    const sug = by?.suggested_request_usd;
    const useSug = sug != null && Math.abs(sug - ask) > 5e4 ? h('button', { type: 'button', class: 'small-btn do', onclick: async () => { draft.budget_request[String(yi)] = sug; saveDraft(); await evaluatePlan(false); renderBoard(); } },
      `Use the suggested ${usd(sug)}`) : null;
    main.append(h('div', { class: 'panel-card ask' }, h('h2', {}, 'Your ask'),
      h('div', { class: 'req big-req' }, '$', inp, ' MM', h('span', { class: 'hint' }, ` of a ${usd(limit)} limit; the plan spends ${usd(by?.planned_capex_usd)} this year`)),
      sug > 0 ? h('p', { class: 'hint' }, `Suggested: ${usd(sug)}, the plan’s spend plus 10% for slips and overruns (the review scores capex above 105% of the budget). `, useSug) : null,
      h('div', { class: 'bar' }, h('span', { style: `width:${Math.min(100, limit ? ask / limit * 100 : 0)}%;${ask > limit ? 'background:var(--api-red)' : ''}` })),
      h('p', {}, `Guidance you would commit to: ${bbl(by?.oil_forecast_bbl ?? 0)} this year`,
        by?.oil_forecast_unrisked_bbl != null && by.oil_forecast_unrisked_bbl - by.oil_forecast_bbl > 1 ? ` (${bbl(by.oil_forecast_unrisked_bbl)} before the expected pad delays and parent-child interference)` : '', '. ',
        h('span', { class: 'hint' }, `Land between ${bbl(by?.oil_forecast_bbl ?? 0)} and ${bbl((by?.oil_forecast_bbl ?? 0) * 1.1)}: below it misses guidance, more than 10% above counts as sandbagging.`)),
      h('p', { class: 'hint' }, 'Reserves: pads on this plan that start within five years are booked as proved undeveloped (PUD). The year-end review scores reserve replacement, so a plan with no future pads replaces nothing; PUDs not started within five years are removed.')));
    // the three conditions, each pass or fail with numbers and a way to fix it
    const cond = (ok, label, mine, need, fix) => h('li', { class: ok ? 'pass' : 'fail' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
      h('span', {}, h('strong', {}, label), h('span', { class: 'hint' }, ` ${ok ? 'Passes' : 'Fails'}: ${mine}; needs ${need}.`)),
      ok ? null : h('button', { type: 'button', class: 'small-btn', onclick: fix }, fix === undefined ? '' : 'Fix it'));
    const FIX = { limit: 'Change the ask above', economics: 'Fix in the plan', floor: 'Fix in the plan' };
    const fmtV = (k, v) => v == null ? '–' : k === 'limit' ? usd(v) : k === 'floor' ? bbl(v) : k === 'economics' ? `PV10/I ${num(v, 2)}` : String(v);
    let rows;
    if (bc?.conditions?.length) {
      const TITLE = { limit: 'Request within what the board will fund', economics: 'Development pays on your own forecast', floor: 'Guidance clears the floor' };
      rows = bc.conditions.map(c => {
        const state = c.passes == null ? 'na' : c.passes ? 'pass' : 'fail';
        const fix = c.key === 'limit' ? () => document.querySelector('.ask input')?.focus() : () => setTab('plan');
        return h('li', { class: state }, h('span', { class: 'mark', 'aria-hidden': 'true' }, state === 'na' ? '–' : state === 'pass' ? '✓' : '✗'),
          h('span', {}, h('strong', {}, `${TITLE[c.key] || c.key}: ${state === 'na' ? 'not applicable' : state === 'pass' ? 'passes' : 'fails'}`),
            h('span', { class: 'hint' }, ` ${c.label.charAt(0).toUpperCase() + c.label.slice(1)}.`)),
          state === 'fail' ? h('button', { type: 'button', class: 'small-btn', onclick: fix }, c.key === 'limit' ? 'Change the ask' : 'Fix in the plan') : null);
      });
    } else {   // fallback for a server without per-condition verdicts
      const floorOk = !bc || !bc.floor_applies || (by?.oil_forecast_bbl ?? 0) >= bc.guidance_floor_bbl;
      rows = [cond(ask <= limit && ask > 0, 'Request within the board limit', usd(ask), `at most ${usd(limit)}`, () => setTab('plan')),
        M.pvi == null ? h('li', { class: 'na' }, h('span', { class: 'mark' }, '–'), h('span', {}, h('strong', {}, 'Development pays on your own forecast'), h('span', { class: 'hint' }, ' Not applicable: no new pads.')))
          : cond(M.npv10_usd > 0 && M.pvi >= 0.2, 'Development pays on your own forecast', `NPV10 ${usd(M.npv10_usd)}, PV10/I ${num(M.pvi, 2)}`, 'NPV10 above zero and PV10/I of 0.2 or more', () => setTab('plan')),
        cond(floorOk, 'Guidance at least your producing base plus 5%', bbl(by?.oil_forecast_bbl ?? 0), bc ? bbl(bc.guidance_floor_bbl) : '–', () => setTab('plan'))];
    }
    const rvp = reviewPanel(planRes.review_preview, { title: `If the board approves this plan: the year ${C.year} review` });
    if (rvp) main.append(rvp);
    main.append(h('h2', {}, 'What the board checks'), h('ul', { class: 'conds' }, ...rows),
      h('p', { class: 'hint' }, bc?.rejection_costs_confidence === false ? 'A retry this year is free: only the first rejection costs confidence.' : 'The first rejection this year costs 3 points of confidence; retries are free.'));
    const go = h('button', { type: 'button', class: 'board-go' }, 'Present the plan to the board');
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Presenting to the board: the plan is being simulated (up to a minute)…';
      const r = await call('/api/career/budget', { id: C.id, plan: draft });
      if (!r.ok && !r.decision) { lastDecision = { approved: false, reasons: r.errors }; }
      else { lastDecision = r.decision; if (r.career) C = r.career; }
      if (lastDecision.approved) {
        draft = null; keep.set('draft', null); planRes = null;
        const f = await call(`/api/career?id=${C.id}`);
        if (f.ok) C = f.career.status === 'generating' ? (await waitGenerated(C.id)) || C : f.career;
        showApp();
      }
      renderBar(); renderBoard();
    });
    main.append(go);
  }
  // confidence over time, from the year-end reviews
  const rv = C.board.reviews;
  side.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Board confidence'), h('span', { class: 'big' }, String(Math.round(C.board.confidence))),
    h('div', { class: 'bar' }, h('span', { style: `width:${C.board.confidence}%` }), h('i', { style: 'left:20%' })), h('p', { class: 'hint' }, 'Below 20 the board lets you go.')));
  if (rv.length) {
    const tr = h('div');
    side.append(tr);
    multiChart(tr, { title: 'Confidence after each review', x: [0, ...rv.map(r => r.year)], y: null, xLabel: 'year', H: 160, W: 420,
      fmtY: (v) => num(v), fmtX: (v) => Number.isInteger(v) ? String(v) : '', fmtTipX: (v) => v ? `After year ${v}` : 'Start',
      series: [{ name: 'Confidence', y: [rv[0].confidence - rv[0].confidence_change, ...rv.map(r => r.confidence)], color: COLORS.dev }] });
    const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Year', 'Oil vs guidance', 'Capex vs budget', 'Change'].map(x => h('th', {}, x)))));
    const tb = h('tbody');
    for (const r of rv) tb.append(h('tr', {}, h('td', {}, String(r.year)), h('td', r.production_ratio < 0.9 ? { class: 'bad' } : {}, pct(r.production_ratio)), h('td', {}, pct(r.capex_ratio)),
      h('td', {}, `${r.confidence_change >= 0 ? '+' : ''}${num(r.confidence_change, 1)}`)));
    t.append(tb); side.append(t);
  } else side.append(h('p', { class: 'hint' }, 'No year-end reviews yet.'));
  if (C.score) side.append(h('h2', {}, 'Final score'), h('p', {}, `Value ${usd(C.score.value_usd)}: realised PV10 ${usd(C.score.realised_pv10_usd)} plus remaining PV10 ${usd(C.score.remaining_pv10_usd)}.`));
}

// identical consecutive messages (e.g. repeated budget rejections) collapse into one item with a count
function grouped(list) {
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.title === m.title && last.body === m.body) last.n++;
    else if (last && ((m.data?.well && last.data?.well && m.data.pad === last.data.pad && /online/.test(m.title + last.title))
      || (!m.data && last.body === m.body && /online$/.test(m.title) && /online/.test(last.title)))) {   // per-well "online" -> one pad item
      last.wells = (last.wells || 1) + 1;
      const pad = m.data?.pad || /Pad (\w+)/.exec(m.body)?.[1];
      last.title = `${pad ? `Pad ${pad}` : 'Pad'} online: ${last.wells} wells`;
    }
    else out.push({ ...m, n: 1 });
  }
  return out;
}
const msgItem = (m) => h('li', {}, h('span', { class: 'when' }, monthName(m.month)), h('span', { class: 'kind' }, m.kind),
  h('h3', {}, m.title + (m.n > 1 ? ` (${m.n} times)` : '')), h('p', {}, m.body));

// a pad's report card: actual against your forecast, and the gap split into what the rock was always going to give
// against your type curve, and what execution added or lost (server: data.kind = pad_report)
function reportCard(d) {
  const pct = Math.round(d.ratio * 100), sp = d.split || {};
  const max = Math.max(d.actual_oil_bbl, d.forecast_oil_bbl) || 1;
  const signed = (v) => `${v >= 0 ? '+' : '−'}${bbl(Math.abs(v))}`;
  const row = (lab, v, cls) => h('div', { class: 'rc-row' }, h('span', {}, lab), h('span', { class: 'rc-bar' }, h('i', { class: cls, style: `width:${100 * v / max}%` })), h('strong', {}, bbl(v)));
  const part = (lab, v, why) => v == null ? null : h('li', {}, h('span', {}, lab, h('small', {}, why)), h('strong', { class: v >= 0 ? 'pos' : 'neg' }, signed(v)));
  return h('div', { class: `report-card ${pct >= 95 ? 'good' : pct >= 85 ? 'meh' : 'bad'}` },
    h('div', { class: 'rc-head' }, h('span', { class: 'rc-pct' }, `${pct}%`), h('span', {}, `of your forecast after ${Math.round(d.months)} months, ${d.wells?.length ?? ''} well${d.wells?.length === 1 ? '' : 's'} on pad ${d.pad}`)),
    row('Forecast', d.forecast_oil_bbl, 'fc'), row('Actual', d.actual_oil_bbl, 'act'),
    h('ul', { class: 'rc-split' },
      part('Your type curve against the rock', sp.type_curve_vs_rock_bbl, 'what this design in this section should give, minus what you forecast'),
      part('Execution', sp.execution_bbl, 'steering, frac, flowback, frac hits, lift and well luck')),
    d.split_note ? h('p', { class: 'hint' }, d.split_note) : null,
    C.budget_needed || C.status !== 'active' ? null : h('div', { class: 'strip-actions' },
      h('button', { type: 'button', class: 'small-btn do', onclick: () => setTab('typecurve') }, 'Rebuild the type curve with your own wells'),
      h('button', { type: 'button', class: 'small-btn do', onclick: () => setTab('plan') }, 'Revise this year\'s plan')));
}

function vsStaff(t) {
  const v = t.played_vs_staff;
  if (!v || v.delta == null) return null;
  const f = (x) => v.unit === 'usd' ? usd(Math.abs(x)) : v.unit === 'pct' ? `${num(Math.abs(x), 1)} points` : `${num(Math.abs(x), 1)}`;
  const word = v.delta > 0 ? (typeof v.better === 'string' ? v.better : 'better') : v.delta < 0 ? (typeof v.worse === 'string' ? v.worse : 'worse') : null;
  return h('span', { class: v.delta > 0 ? 'pos' : v.delta < 0 ? 'neg' : '' }, v.delta === 0 ? 'Same as staff.' : `${f(v.delta)} ${word} than staff${v.metric ? ` (${v.metric})` : ''}.`);
}

// ------------------------------------------------------------------ share codes (#15): start a friend on the same field
async function showShare(btn) {
  btn.disabled = true;
  const r = await call(`/api/career/share?id=${C.id}`);
  const box = h('div', { class: 'share-box' });
  if (!r.ok) box.append(h('p', { class: 'bad' }, (r.errors || ['No code.']).join(' ')));
  else {
    const inp = h('input', { type: 'text', readonly: '', value: r.code, 'aria-label': 'Share code', onclick: (e) => e.target.select() });
    const copy = h('button', { type: 'button', class: 'small-btn do' }, 'Copy');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.code); copy.textContent = 'Copied'; } catch { inp.select(); copy.textContent = 'Press Ctrl+C'; } });
    box.append(h('p', { class: 'hint' }, 'Anyone who starts a career with this code gets the same starting field, rock and oil price. None of your decisions carry over.'), h('div', { class: 'share-row' }, inp, copy), r.note ? h('p', { class: 'hint' }, r.note) : null);
  }
  btn.replaceWith(box);
}

// ------------------------------------------------------------------ the rival: staff on autopilot on the same field
// The benchmark is a whole career already run; reveal it only up to the reviews you have reached, so it races you, not spoils.
function rivalCard() {
  const box = $('rival-card'), B = C.benchmark, R = C.board.reviews || [];
  box.hidden = !(B && B.reviews && C.status === 'active');
  if (box.hidden) return;
  const n = R.length, sb = B.reviews.slice(0, n), sackedBy = B.status === 'sacked' && B.months <= C.month;
  const rows = R.map((r, i) => { const b = sb[i]; return h('li', {}, h('span', {}, `Year ${r.year}`),
    h('span', { class: 'cmp' }, h('strong', {}, String(Math.round(r.confidence))), ' you, ',
      b ? h('span', {}, String(Math.round(b.confidence)), ' staff') : h('span', { class: 'neg' }, 'staff sacked'))); });
  box.replaceChildren(...[h('h2', {}, 'The rival: staff on autopilot'),
    h('p', { class: 'hint' }, 'The same field, seed and oil price, run by staff with standard choices and every job delegated. Confidence after each review:'),
    n ? h('ul', {}, ...rows) : h('p', { class: 'hint' }, 'Their first year-end review shows here after yours.'),
    sackedBy ? h('p', { class: 'pos' }, `Staff were sacked in month ${B.months}. You are still here.`) : null].filter(Boolean));
}

// ------------------------------------------------------------------ the career report (finished or sacked)
// Everything here is the server's record of the career: score, the board's yearly reviews, pad report cards, jobs.
function careerReport() {
  const s = C.score, R = C.board.reviews || [], sacked = C.status === 'sacked';
  const B = s?.benchmark?.value_usd != null ? s.benchmark : C.benchmark?.value_usd != null ? C.benchmark : null;   // staff on autopilot, same field and seed
  const LABEL = { production_vs_guidance: 'production against guidance', sandbagging: 'sandbagging', capex_vs_budget: 'capex against budget', delivered_both: 'delivering both', reserve_replacement: 'reserve replacement', reserve_revisions: 'reserve revisions', reserves_audit: 'the reserves audit', emissions_intensity: 'emissions intensity' };
  const box = h('div', { class: `report end ${C.status}` });
  // headline
  if (s?.grade) box.append(h('div', { class: `grade g-${s.grade}`, title: 'A: 1.2× staff or better. B: at least staff. C: at least 0.8× staff. D: below.' }, s.grade));
  box.append(h('h2', {}, sacked ? 'The board has let you go' : 'Five years done'),
    h('p', { class: 'lede' }, sacked ? `Board confidence fell to ${Math.round(C.board.confidence)} in ${monthName(Math.max(0, C.month - 1))}, below the ${SACK()} the board tolerates.`
      : `You ran the asset for ${C.career_months} months and kept the board with you.`));
  const stats = [];
  if (s) stats.push(['Value created', usd(s.value_usd), `${usd(s.realised_pv10_usd)} realised + ${usd(s.remaining_pv10_usd)} still in the ground (PV10)`]);
  if (s && B) { const d = s.value_usd - B.value_usd; stats.push(['Against staff', `${d >= 0 ? '+' : '−'}${usd(Math.abs(d))}`, `${s.ratio != null ? `${num(s.ratio, 2)}× ` : ''}staff on autopilot made ${usd(B.value_usd)}`]); }
  else if (B) stats.push(['Staff on this field', usd(B.value_usd), B.status === 'sacked' ? `on autopilot, sacked in month ${B.months}` : 'on autopilot, all 60 months']);
  stats.push(['Paid to shareholders', usd(C.shareholder_returns_usd ?? 0), 'half of each year\'s free cash flow']);
  const START = C.board.start_confidence ?? 60;   // every career starts here (server START_CONFIDENCE)
  stats.push(['Board confidence', String(Math.round(C.board.confidence)), `started at ${START}`]);
  box.append(h('div', { class: 'report-stats' }, ...stats.map(([a, b, c]) => h('div', {}, h('span', {}, a), h('strong', {}, b), h('small', {}, c)))));
  if (!s && sacked) box.append(h('p', { class: 'hint' }, 'This career ended before final values were recorded for sacked careers.'));
  if (B?.note) box.append(h('p', { class: 'hint' }, `The staff benchmark: ${B.note}`));
  if (C.benchmark?.status === 'computing') box.append(h('p', { class: 'hint' }, 'The staff benchmark is still being simulated; reload in a minute to compare.'));
  // what cost the most confidence, across the reviews
  if (R.length) {
    const tot = {};
    for (const r of R) for (const [k, v] of Object.entries(r.parts || {})) tot[k] = (tot[k] || 0) + v;
    const worst = Object.entries(tot).sort((a, b) => a[1] - b[1])[0];
    if (worst && worst[1] < -1) box.append(h('p', { class: 'lesson' }, h('strong', {}, 'What cost you most: '), `${LABEL[worst[0]] || worst[0]}, ${num(worst[1], 1)} confidence over ${R.length} review${R.length > 1 ? 's' : ''}.`,
      worst[0] === 'production_vs_guidance' ? ' Promise what your type curve can actually deliver: guidance is scored, not the budget you win.' : worst[0] === 'sandbagging' ? ' Beating guidance by more than 10% reads as a forecast you did not believe.' : worst[0] === 'capex_vs_budget' ? ' Spending past the approved budget costs more than it buys.' : ''));
    // year by year
    const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Year', 'Oil', 'Against guidance', 'Capex', 'Against budget', 'Free cash flow', 'Confidence'].map(x => h('th', {}, x)))),
      h('tbody', {}, ...R.map(r => h('tr', {}, h('td', {}, `Year ${r.year}`), h('td', {}, bbl(r.oil_bbl)),
        h('td', { class: r.production_ratio < 0.95 ? 'neg' : r.production_ratio > 1.1 ? 'neg' : 'pos' }, `${num(r.production_ratio * 100)}%`),
        h('td', {}, usd(r.capex_usd)), h('td', { class: r.capex_ratio > 1.05 ? 'neg' : '' }, `${num(r.capex_ratio * 100)}%`),
        h('td', {}, usd(r.free_cash_flow_usd)), h('td', { class: r.confidence_change >= 0 ? 'pos' : 'neg' }, `${r.confidence_change >= 0 ? '+' : '−'}${num(Math.abs(r.confidence_change), 1)} to ${Math.round(r.confidence)}`)))));
    box.append(h('h3', {}, 'Year by year'), h('div', { style: 'overflow-x:auto' }, t));
    const ch = h('div', { class: 'report-chart' }); box.append(ch);
    multiChart(ch, { title: 'Board confidence after each review', x: [0, ...R.map(r => r.year)], xLabel: 'year', H: 180, W: 640, fmtY: (y) => num(y),
      note: 'Year 0 is the start. Rejected budgets, revisions and cost overruns between reviews also move confidence.',
      series: [{ name: 'You', y: [START, ...R.map(r => r.confidence)], color: COLORS.dev },
        ...(B?.reviews?.length ? [{ name: 'Staff on autopilot', y: [START, ...R.map((r, i) => B.reviews[i]?.confidence ?? null)], color: COLORS.pdp }] : []),
        { name: `Sacked below ${SACK()}`, y: [0, ...R.map(() => 0)].map(() => SACK()), color: '#e8806f', dash: true }] });
  }
  // value by year against staff (realised PV10, cumulative)
  if (s?.by_year?.length) {
    const cum = (a) => { let t = 0; return a.map(r => (t += r.realised_pv10_usd)); };
    const yrs = s.by_year.map(r => r.year), ch2 = h('div', { class: 'report-chart' }); box.append(ch2);
    multiChart(ch2, { title: 'Cash value realised so far (PV10), cumulative', x: yrs, xLabel: 'year', H: 180, W: 640, fmtY: usd,
      series: [{ name: 'You', y: cum(s.by_year), color: COLORS.dev },
        ...(B?.by_year?.length ? [{ name: 'Staff on autopilot', y: yrs.map((y, i) => i < B.by_year.length ? cum(B.by_year)[i] : null), color: COLORS.pdp }] : [])] });
  }
  // pads: every report card
  const cards = C.inbox.filter(m => m.data?.kind === 'pad_report').map(m => m.data);
  if (cards.length) {
    const tr = cards.reduce((a, d) => a + (d.split?.type_curve_vs_rock_bbl || 0), 0), ex = cards.reduce((a, d) => a + (d.split?.execution_bbl || 0), 0);
    box.append(h('h3', {}, 'Your pads'), h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Pad', 'Of forecast', 'Type curve against the rock', 'Execution'].map(x => h('th', {}, x)))),
      h('tbody', {}, ...cards.map(d => h('tr', {}, h('td', {}, d.pad), h('td', { class: d.ratio >= 0.95 ? 'pos' : 'neg' }, `${num(d.ratio * 100)}%`),
        h('td', {}, signedBbl(d.split?.type_curve_vs_rock_bbl)), h('td', {}, signedBbl(d.split?.execution_bbl)))))),
      h('p', { class: 'lesson' }, Math.abs(tr) > Math.abs(ex) ? `Most of the gap came from the type curve (${signedBbl(tr)}), not the field work (${signedBbl(ex)}). The rock in your sections differed from the wells you drew the curve from.`
        : `Most of the gap came from execution (${signedBbl(ex)}) rather than the type curve (${signedBbl(tr)}): the jobs, steering and luck on the day.`));
  }
  // jobs: played against staff
  const T = C.tasks || [], played = T.filter(t => t.status === 'done'), cnt = (st) => T.filter(t => t.status === st).length;
  const usdDelta = played.reduce((a, t) => a + (t.played_vs_staff?.unit === 'usd' && t.played_vs_staff.delta != null ? t.played_vs_staff.delta : 0), 0);
  box.append(h('h3', {}, 'Jobs'), h('p', {}, `${played.length} played, ${cnt('delegated')} handed to staff, ${cnt('lapsed')} left to lapse.`,
    played.some(t => t.played_vs_staff?.unit === 'usd') ? ` The jobs you played came out ${usdDelta >= 0 ? usd(usdDelta) + ' better' : usd(-usdDelta) + ' worse'} than staff would have done.` : played.length ? '' : ' Playing a job yourself is how you beat the company standard.'));
  const sb = h('button', { type: 'button', class: 'small-btn' }, 'Share this field'); sb.addEventListener('click', () => showShare(sb));
  box.append(h('div', { class: 'strip-actions' }, h('a', { class: 'small-btn do', href: 'career.html?new=1' }, 'Start a new career'), sb, h('a', { class: 'small-btn', href: './' }, 'Main menu')));
  return box;
}
const signedBbl = (v) => v == null ? '–' : `${v >= 0 ? '+' : '−'}${bbl(Math.abs(v))}`;

// ------------------------------------------------------------------ home: the desk you come back to every month
async function renderHome() {
  const end = $('end-card'); end.replaceChildren();
  // wells waiting for you to steer them block the clock: list them first, with a link to each session
  const pend = C.steer_pending || [];
  if (advanceError || pend.length) {
    const wells = (C.wells || []).filter(w => pend.includes(w.id) || pend.some(p => p.well === w.id));
    end.append(h('div', { class: 'end sacked' }, h('h2', {}, pend.length ? 'Wells waiting for you to steer' : 'The clock could not advance'),
      advanceError ? h('p', {}, advanceError) : null,
      pend.length ? h('ul', { class: 'plain' }, ...pend.map(p => {
        const id = typeof p === 'string' ? p : p.well;
        const w = wells.find(x => x.id === id), sess = (typeof p === 'object' && p.session) || w?.steer?.session;
        return h('li', {}, h('span', {}, `${id}${w?.spud_month != null ? `, spud ${monthName(w.spud_month)}` : ''}`),
          sess ? h('a', { href: `geosteer.html?id=${sess}`, class: 'small-btn' }, 'Steer it') : h('span', { class: 'hint' }, 'session not ready'));
      })) : null));
    advanceError = '';
  }
  const lastRv = (C.board.reviews || []).at(-1);
  if (lastRv && C.status === 'active' && C.month - (C.year - 1) * 12 < 2) {
    const P = Object.entries(lastRv.parts || {}).filter(([, v]) => Math.abs(v) > 0.05).sort((a, b) => a[1] - b[1]);
    end.append(h('div', { class: 'panel-card review-top' }, h('h2', {}, `Year ${lastRv.year} review: confidence ${lastRv.confidence_change >= 0 ? '+' : '−'}${num(Math.abs(lastRv.confidence_change), 1)}, now ${Math.round(C.board.confidence)}`),
      h('p', {}, `${pct(lastRv.production_ratio)} of guidance, capex ${pct(lastRv.capex_ratio)} of budget.`),
      h('ul', { class: 'plain' }, ...P.map(([k, v]) => h('li', {}, h('span', {}, (PART_LABEL[k] || k).replace(/^./, c => c.toUpperCase()), lastRv.notes?.[k] ? h('small', { class: 'hint' }, ` ${lastRv.notes[k]}`) : null),
        h('strong', { class: v >= 0 ? 'pos' : 'neg' }, `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 1)}`))))));
  }
  if (C.budget_needed && C.status === 'active') {
    const steps = meetingSteps(), cur = steps.findIndex(s => !s.done && !s.optional);
    end.append(h('div', { class: 'panel-card steps' }, h('h2', {}, `Year ${C.year} budget meeting`),
      h('ol', {}, ...steps.map((st, i) => h('li', { class: st.done ? 'done' : i === cur ? 'now' : '' },
        h('strong', {}, st.title), h('p', { class: st.optional ? 'why-opt' : '' }, st.why),
        (i === cur || (st.optional && !st.done)) && st.tab ? h('button', { type: 'button', class: `small-btn ${i === cur ? 'do' : ''}`, onclick: () => { if (st.tab === 'diag' && C.board.reviews.length) keep.set(`readReview${C.board.reviews.at(-1).year}`, true); setTab(st.tab); } }, st.cta.replace(/^Next: /, '').replace(/^./, c => c.toUpperCase())) : null)))));
  }
  if (stopNote) {
    const n = stopNote;
    end.append(h('div', { class: 'panel-card stop-note', role: 'status' }, h('h2', {}, n.title),
      n.reason === 'task_due' ? h('p', { class: 'hint' }, 'Staff will apply the standard outcome when it lapses. Play it now, hand it over, or press Continue again to let it lapse.') : null,
      ...(n.msgs || []).filter(m => m.data?.kind === 'pad_report').map(m => reportCard(m.data)),
      ...grouped([...(n.msgs || [])].filter(m => m.data?.kind !== 'pad_report').reverse()).slice(0, 4).map(m => {
        const [lab, go] = msgLink(m) || [];
        return h('p', {}, n.msgs.length > 1 || m.title !== n.title ? h('strong', {}, `${m.title}. `) : null, m.body,
          go ? h('button', { type: 'button', class: 'small-btn', style: 'margin-left:10px', onclick: go }, lab) : null);
      })));
    stopNote = null;
  }
  document.body.classList.toggle('over', C.status === 'sacked' || C.status === 'finished');
  if (C.status === 'sacked' || C.status === 'finished') end.append(careerReport());
  // career tasks: each is a minigame whose result is applied to the career. Grouped by the stage of a pad's life
  // (drilling, completion, bring on, production, company), each stage sorted by due. Upcoming jobs are not open yet:
  // greyed, with the month they open and "Leave to staff" (staff take them the moment they open).
  const all = C.tasks || [], live = all.filter(t => t.status === 'open' || t.status === 'upcoming');
  const COSTS = new Set(['rig-contracts', 'water', 'facility']), sets = (t) => COSTS.has(t.kind) || [].concat(t.affects || []).includes('opex');
  const closed = all.filter(t => t.status !== 'open' && t.status !== 'upcoming').slice(-4).reverse();
  const prJobs = await activePlanRes();
  const pipes = padsInProgress(prJobs);
  const jobRow = (t) => {
    const up = t.status === 'upcoming';
    return h('li', { class: [t.blocking && !up ? 'blocking' : '', up ? 'upcoming' : ''].join(' ').trim() },
      h('span', {}, t.blocking && !up ? h('strong', {}, t.label) : t.label, t.link?.pad ? h('span', { class: 'tag' }, `pad ${t.link.pad}`) : null,
        t.staff_outcome?.headline ? h('small', { class: 'staff' }, `If staff do it: ${t.staff_outcome.headline}`) : null,
        sets(t) && !up ? h('span', { class: 'tag costs' }, 'sets this year’s costs: play it early') : null,
        up ? h('span', { class: 'tag' }, t.predelegated ? `staff take it when it opens, ${monthName(t.opens_month)}` : `opens ${monthName(t.opens_month)}${t.due_month != null ? `, due ${monthName(t.due_month)}` : ''}`)
          : t.blocking ? h('span', { class: 'tag' }, t.due_month != null ? `blocks the clock at ${monthName(t.due_month)}` : 'blocks the clock') : h('span', { class: 'tag' }, t.due_month != null ? `optional, until ${monthName(t.due_month)}` : 'optional')),
      up ? (t.predelegated ? null : h('span', { class: 'strip-actions' }, h('button', { type: 'button', class: 'small-btn', onclick: (e) => delegateTask(t, e.currentTarget) }, 'Leave to staff')))
        : h('span', { class: 'strip-actions' }, h('a', { class: 'small-btn do', href: taskUrl(t) }, 'Do it'),
          h('button', { type: 'button', class: 'small-btn', onclick: (e) => delegateTask(t, e.currentTarget) }, 'Let staff handle it')));
  };
  const groups = STAGE_ORDER.map(st => ({ st, label: live.find(t => t.stage === st)?.stage_label || STAGE_LABEL[st],
    jobs: live.filter(t => (t.stage || 'corporate') === st).sort((a, b) => ((a.due_month ?? a.opens_month ?? 1e9) - (b.due_month ?? b.opens_month ?? 1e9)) || (b.blocking - a.blocking)) })).filter(g => g.jobs.length);
  const nOpen = live.filter(t => t.status === 'open').length;
  if (live.length || closed.length || pipes) end.append(h('div', { class: 'panel-card tasks' }, h('h2', {}, nOpen ? 'Jobs waiting for you' : live.length ? 'Jobs coming up' : 'Recent jobs'),
    pipes,
    ...groups.map(g => h('section', { class: 'stage-group' }, h('h3', {}, g.label, h('small', { class: 'hint' }, ` ${g.jobs.filter(t => t.status === 'open').length} open${g.jobs.some(t => t.status === 'upcoming') ? `, ${g.jobs.filter(t => t.status === 'upcoming').length} coming` : ''}`)),
      h('ul', { class: 'plain' }, ...g.jobs.map(jobRow)))),
    closed.length && live.length ? h('h3', { class: 'done-h' }, 'Recently settled') : null,
    closed.length ? h('ul', { class: 'plain done-tasks' }, ...closed.map(t => h('li', {}, h('span', {}, t.label, h('span', { class: 'tag' }, t.status)),
      h('span', { class: 'hint' }, vsStaff(t) || t.result_headline || (t.status === 'delegated' ? 'Staff ran the standard job.' : t.status === 'lapsed' ? 'Lapsed: the standard outcome applied.' : ''))))) : null,
    h('p', { class: 'hint' }, 'Each job is a minigame and its result counts in this career. A pad’s jobs open in the order of its life: completion jobs when drilling ends, flowback once the frac jobs are settled. Staff give the company’s standard outcome: never a disaster, never better than standard.')));
  // coming up: the next bars of the approved schedule, and the next board meeting
  const ol = $('next-up'); ol.replaceChildren();
  const pr = await activePlanRes();
  const ev = [];
  for (const b of pr?.gantt?.bars || []) {
    if (b.start_month < C.month - 0.01 || b.kind === 'wait') continue;
    const what = { drill: `Spud pad ${b.pad}`, complete: `Frac pad ${b.pad}`, tie_in: `Pad ${b.pad} online` }[b.kind];
    if (what) ev.push({ m: b.kind === 'tie_in' ? b.end_month : b.start_month, what, cls: b.kind, delayed: b.status === 'delayed' });
  }
  const nextBoard = C.budget_needed ? C.month : Math.ceil((C.month + 0.001) / 12) * 12;
  if (nextBoard <= C.career_months) ev.push({ m: nextBoard, what: C.budget_needed ? 'Budget meeting: due now' : `Year ${nextBoard / 12 + 1} budget meeting`, cls: 'board' });
  ev.sort((a, b) => a.m - b.m);
  const held = (pr?.gantt?.bars || []).filter(b => b.status === 'delayed' && b.kind !== 'wait' && b.end_month > C.month);
  const heldPads = [...new Set(held.map(b => b.pad))];
  if (heldPads.length && C.status === 'active' && !C.budget_needed) {
    const on = (p) => held.filter(b => b.pad === p && b.kind === 'tie_in').map(b => b.end_month)[0];
    end.prepend(h('div', { class: 'panel-card held' }, h('h2', {}, `Held for budget: pad${heldPads.length > 1 ? 's' : ''} ${heldPads.join(', ')}`),
      h('p', {}, `${heldPads.map(p => on(p) != null ? `${p} now comes online ${monthName(on(p))}` : `${p} waits for the next budget year`).join('; ')}. This year’s guidance counted ${heldPads.length > 1 ? 'them' : 'it'} earlier, so production will fall short of what the review panel shows.`),
      h('p', { class: 'hint' }, 'Cost overruns on started pads used the room in the budget. Options: revise guidance down early (cheaper now than a year-end miss), or ask for a budget top-up if it releases the pad. Compare both in the Development plan.'),
      h('button', { type: 'button', class: 'small-btn do', onclick: () => setTab('plan') }, 'Open the revision')));
  }
  if (!ev.length) ol.append(h('li', {}, h('strong', {}, 'Nothing scheduled'), h('span', { class: 'when' }, 'Plan pads to fill the calendar.')));
  for (const e of ev.slice(0, 8)) {
    const dm = e.m - C.month;
    ol.append(h('li', { class: e.cls }, h('span', { class: 'when' }, dm <= 0.05 ? 'This month' : `In ${num(dm, 1)} months, ${monthName(e.m)}`),
      h('strong', {}, e.what), e.delayed ? h('span', { class: 'when' }, 'waiting for budget') : null));
  }
  const ib = $('home-inbox'); ib.replaceChildren();
  for (const m of grouped([...C.inbox].reverse()).slice(0, 6)) ib.append(msgItem(m));
  ib.append(h('li', {}, h('button', { type: 'button', class: 'small-btn', onclick: () => setTab('inbox') }, 'All messages')));
  const H = C.history;
  if (H.month.length) multiChart($('home-chart'), { title: 'Field oil against guidance, bbl per month', x: H.month, xLabel: 'month', H: 200,
    fmtY: (v) => num(v), fmtTipX: monthName, series: [{ name: 'Actual', y: H.oil, color: COLORS.dev }, { name: 'Guidance forecast', y: H.oil_forecast, color: COLORS.pdp, dash: true }] });
  else $('home-chart').replaceChildren();
  // board confidence, broken down by the last review's parts
  const conf = C.board.confidence, last = C.board.reviews[C.board.reviews.length - 1];
  const LABEL = { production_vs_guidance: 'Production against guidance', sandbagging: 'Sandbagging', capex_vs_budget: 'Capex against budget', delivered_both: 'Delivered both', reserve_replacement: 'Reserve replacement', reserve_revisions: 'Reserve revisions', reserves_audit: 'Reserves audit', emissions_intensity: 'Emissions intensity' };
  $('conf-card').replaceChildren(...[h('h2', {}, 'Board confidence'), h('span', { class: 'big' }, String(Math.round(conf))),
    h('div', { class: 'bar' }, h('span', { style: `width:${conf}%` }), h('i', { style: 'left:20%', title: 'Below 20 you are sacked' })),
    h('p', { class: 'hint' }, (() => {
      const pc = pace(), tail = pc && pc.level !== 'ok' ? ` This year you are ${pc.text}${pc.proj ? `, ${pc.proj}` : ''}.` : '';
      return (conf < SACK() + 10 ? `Danger: below ${SACK()} the board lets you go.` : conf < 50 ? 'The board is uneasy.' : pc && pc.level === 'bad' ? 'The board is watching.' : 'The board is behind you.') + tail;
    })()),
    h('p', { class: 'hint goal' }, `To win: create the most value by month ${C.career_months}, meaning the cash you generate plus what your wells are still worth (PV10). You lose if confidence falls below ${SACK()} or cash runs past the credit line.`),
    last ? h('ul', {}, ...Object.entries(last.parts).filter(([, v]) => Math.abs(v) > 0.05).map(([k, v]) => h('li', {}, h('span', {}, LABEL[k] || k), h('span', { class: v >= 0 ? 'pos' : 'neg' }, `${v >= 0 ? '+' : ''}${num(v, 1)}`))),
      h('li', {}, h('span', {}, `Year ${last.year} review`), h('strong', {}, `${last.confidence_change >= 0 ? '+' : ''}${num(last.confidence_change, 1)}`))) : null].filter(Boolean));
  // this year: oil to date against guidance (pro rata), capex against budget
  const yi = C.year - 1, y0 = yi * 12, guid = C.board.guidance[String(yi)], appr = C.board.approved[String(yi)];
  const oilYTD = H.month.reduce((a, m, i) => a + (m >= y0 && m < y0 + 12 ? H.oil[i] : 0), 0);
  const capYTD = H.month.reduce((a, m, i) => a + (m >= y0 && m < y0 + 12 ? H.capex_usd[i] : 0), 0);
  const into = Math.max(0, Math.min(12, C.month - y0)), FC = C.board.forecast?.[String(yi)];
  const guidTD = FC ? FC.slice(0, Math.floor(into)).reduce((a, b) => a + b, 0) : guid * into / 12;   // guidance rises as pads come online: not a flat twelfth a month
  const capProj = C.projection?.capex_projected_usd, capRatio = appr ? (capProj ?? capYTD) / appr : 0;
  const meter = (v) => h('div', { class: 'bar meter', title: 'Capex against the approved budget; the red line is 105%' },
    h('span', { class: v > 1.05 ? 'over' : v > 1 ? 'near' : '', style: `width:${Math.min(100, v / 1.2 * 100)}%` }), h('i', { style: `left:${100 / 1.2}%` }), h('i', { class: 'limit', style: `left:${105 / 1.2}%` }));
  $('year-card').replaceChildren(...[h('h2', {}, `Year ${C.year} so far`),
    guid ? h('ul', {}, h('li', {}, h('span', {}, 'Oil to date'), h('strong', { class: oilYTD < guidTD * 0.95 ? 'neg' : '' }, bbl(oilYTD))),
      h('li', {}, h('span', {}, `Guidance to date (${Math.floor(into)} of 12 months)`), h('strong', {}, bbl(guidTD))),
      h('li', {}, h('span', {}, 'Year guidance'), h('strong', {}, bbl(guid))),
      h('li', {}, h('span', {}, capProj != null ? 'Capex, projected for the year' : 'Capex to date'), h('strong', { class: capRatio > 1.05 ? 'neg' : '' }, `${usd(capProj ?? capYTD)} (${pct(capRatio)})`)),
      h('li', {}, h('span', {}, 'Approved budget'), h('strong', {}, usd(appr)))) :
      h('p', { class: 'hint' }, 'No budget approved yet this year. Take a plan to the board.'),
    guid && appr ? meter(capRatio) : null,
    ...(() => {   // the early read: each producing pad against its forecast since it came online (from month 1)
      const P = (C.pads_started || []).filter(p => p.actual_vs_forecast_to_date != null && p.months_producing > 0);
      if (!P.length) return [];
      return [h('h3', { class: 'early-h' }, 'Pads against their forecast'), h('ul', { class: 'early' }, ...P.map(p => {
        const r = p.actual_vs_forecast_to_date, lvl = r < 0.9 ? 'neg' : r < 0.97 ? 'warn' : 'pos';
        return h('li', {}, h('span', {}, `${p.section || p.pad} `, h('small', { class: 'hint' }, `${num(p.months_producing, 0)} month${p.months_producing >= 1.5 ? 's' : ''} online`)),
          h('strong', { class: lvl, title: `${bbl(p.actual_oil_to_date_bbl)} against ${bbl(p.forecast_oil_to_date_bbl)} forecast` }, pct(r)));
      })), P.some(p => p.actual_vs_forecast_to_date < 0.9) ? h('p', { class: 'hint' }, 'A pad under 90% this early usually means the type curve is high. Revising guidance early costs less than missing at year end: see the Development plan.') : null];
    })(),
    guid && appr ? h('p', { class: 'hint' }, 'The review costs confidence below 95% of guidance, and for capex above 105% of the budget (the red line). Supplemental AFEs count.') : null].filter(Boolean));
  const headroom = C.cash_usd + C.credit_line_usd;
  {   // the review as it stands, live: the same numbers as the top bar
    let box = $('rv-home'); if (!box) { box = h('div', { id: 'rv-home' }); $('year-card').after(box); }
    const rp = await refreshRP();
    box.replaceChildren(...[rp && !C.budget_needed && C.status === 'active' ? reviewPanel(rp, { compact: true, title: `Year ${C.year} review, as it stands` }) : null].filter(Boolean));
  }
  rivalCard();
  const shareBtn = h('button', { type: 'button', class: 'small-btn' }, 'Share this field');
  shareBtn.addEventListener('click', () => showShare(shareBtn));
  $('money-card').replaceChildren(h('h2', {}, 'Money'), h('ul', {}, h('li', {}, h('span', {}, 'Cash'), h('strong', {}, usd(C.cash_usd))),
    h('li', {}, h('span', {}, 'Cash plus credit line'), h('strong', {}, usd(headroom))), h('li', {}, h('span', {}, 'Capital limit'), h('strong', {}, usd(C.capital_limit_usd))),
    h('li', {}, h('span', {}, 'Paid to shareholders'), h('strong', {}, usd(C.shareholder_returns_usd ?? 0))),
    ...(() => { const P = C.costs_pending || [], t = P.reduce((a, x) => a + (x.usd || 0), 0);   // job costs that leave cash at the next month's step
      return t > 0 ? [h('li', { class: 'pending' }, h('span', {}, `Committed, leaves cash next month (${P.map(x => x.label).join(', ')})`), h('strong', {}, `−${usd(t)}`)),
        h('li', {}, h('span', {}, 'Cash after that'), h('strong', { class: C.cash_usd - t < -C.credit_line_usd ? 'neg' : '' }, usd(C.cash_usd - t))),
        ...(C.cash_usd - t < -C.credit_line_usd ? [h('li', { class: 'breach' }, h('span', {}, `That is past your ${usd(C.credit_line_usd)} credit line: unless next month's oil covers the gap, the board lets you go.`))] : [])] : []; })()), shareBtn);
}

// ------------------------------------------------------------------ finances
function renderEmissions() {   // #14: the emissions dashboard on Finances
  const box = $('fin-em'); if (!box) return;
  const E = C.emissions, H = C.history;
  if (!E) { box.replaceChildren(); return; }
  const R = (C.board.reviews || []).filter(r => r.emissions);
  box.replaceChildren(h('h2', {}, 'Emissions'),
    h('div', { class: 'tiles diag-tiles' },
      h('div', {}, h('span', {}, 'This year so far'), h('strong', {}, `${num(E.co2e_t_ytd)} t CO₂e`), h('small', {}, `charged at $${num(E.carbon_usd_t)}/t in operating cash`)),
      h('div', {}, h('span', {}, 'Board target'), h('strong', {}, `${num(E.target_kg_boe, 1)} kg/BOE`), h('small', {}, 'falls 8% a year; scored at each review')),
      R.length ? h('div', {}, h('span', {}, `Year ${R[R.length - 1].year} intensity`), h('strong', { class: R[R.length - 1].emissions.intensity_kg_boe > R[R.length - 1].emissions.target_kg_boe ? 'neg' : 'pos' }, `${num(R[R.length - 1].emissions.intensity_kg_boe, 1)} kg/BOE`), h('small', {}, `target ${num(R[R.length - 1].emissions.target_kg_boe, 1)}`)) : null));
  if (H.co2e_t?.some(v => v != null)) { const d = h('div'); box.append(d);
    multiChart(d, { title: 'Emissions, tonnes CO₂e per month', note: 'Flaring, venting and fuel, from your flowback, facility and lift choices.', x: H.month, xLabel: 'month', fmtY: (v) => num(v), fmtTipX: monthName,
      series: [{ name: 'CO₂e', y: H.co2e_t, color: COLORS.dev }] }); }
  if (R.length > 0) box.append(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Year', 'CO₂e', 'Intensity', 'Target', 'Confidence'].map(x => h('th', {}, x)))),
    h('tbody', {}, ...R.map(r => h('tr', {}, h('td', {}, `Year ${r.year}`), h('td', {}, `${num(r.emissions.co2e_t)} t`), h('td', { class: r.emissions.intensity_kg_boe > r.emissions.target_kg_boe ? 'neg' : 'pos' }, `${num(r.emissions.intensity_kg_boe, 1)} kg/BOE`),
      h('td', {}, `${num(r.emissions.target_kg_boe, 1)} kg/BOE`), h('td', {}, r.parts?.emissions_intensity != null ? `${r.parts.emissions_intensity >= 0 ? '+' : '−'}${num(Math.abs(r.parts.emissions_intensity), 1)}` : '–')))))));
  box.append(h('p', { class: 'hint' }, 'Cut them with an electric frac fleet and vapour recovery units (Development plan, Equipment), and by flaring less in flowback.'));
  if (E.notes?.length) box.append(h('ul', { class: 'notes' }, ...E.notes.map(n => h('li', {}, n))));
}
function renderFinance() {
  renderEmissions();
  const H = C.history;
  if (!H.month.length) { $('fin-cash').replaceChildren(h('p', { class: 'hint' }, 'Finances appear after the first month.')); return; }
  multiChart($('fin-cash'), { title: 'Cash, end of month', note: 'Year-end shareholder payouts are taken after the December figure, so the top bar can read lower than the last point.', x: H.month, xLabel: 'month', fmtY: usd, fmtTipX: monthName, series: [{ name: 'Cash', y: H.cash_usd, color: COLORS.dev }] });
  multiChart($('fin-flows'), { title: 'Operating cash and capex, per month', note: 'Operating cash is revenue after operating costs; capex is what you spent on pads.',
    x: H.month, xLabel: 'month', fmtY: usd, fmtTipX: monthName, series: [{ name: 'Operating cash', y: H.op_cash_usd, color: COLORS.pdp }, { name: 'Capex', y: H.capex_usd, color: COLORS.dev }] });
  // revenue follows a hidden monthly oil price path: show what it has done so far, and what the hedges paid or cost
  let px = $('fin-price'); if (!px) { px = h('div', { id: 'fin-price' }); $('fin-flows').after(px); }
  px.replaceChildren();
  if (H.wti_usd_bbl?.some(v => v != null)) {
    const a1 = h('div'); px.append(a1);
    multiChart(a1, { title: 'Oil price received, WTI $/bbl', note: 'The price path is hidden ahead of time; this is what it has done so far.', x: H.month, xLabel: 'month', fmtY: (y) => `$${num(y)}`, fmtTipX: monthName,
      series: [{ name: 'WTI', y: H.wti_usd_bbl, color: COLORS.dev }] });
  }
  if (H.hedge_usd?.some(v => v)) {
    const a2 = h('div'); px.append(a2);
    let cum = 0;
    multiChart(a2, { title: 'Hedge settlements, cumulative', note: 'Positive: your hedges paid out. Negative: you gave up upside.', x: H.month, xLabel: 'month', fmtY: usd, fmtTipX: monthName,
      series: [{ name: 'Hedges', y: H.hedge_usd.map(v => (cum += v || 0)), color: COLORS.pdp }] });
  }
  if ((C.hedge_books || []).length) px.append(h('h2', {}, 'Hedge books'), h('ul', { class: 'plain' }, ...C.hedge_books.map((b, i) => h('li', {},
    h('span', {}, `Book ${i + 1}${b.year != null ? `, year ${b.year}` : ''}`), h('span', { class: 'hint' }, Array.isArray(b.book || b.trades) ? `${(b.book || b.trades).length} trades` : typeof b === 'object' ? Object.keys(b).slice(0, 4).join(', ') : String(b))))));
  if (C.oil_cap_bbl_d != null) px.append(h('p', { class: 'hint' }, `Facility oil limit: ${num(C.oil_cap_bbl_d)} bbl/d.`));
  const rv = C.board.reviews;
  const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Year', 'Oil', 'Guidance', 'Capex', 'Budget', 'Free cash flow', 'To shareholders'].map(x => h('th', {}, x)))));
  const tb = h('tbody');
  for (const r of rv) tb.append(h('tr', {}, h('td', {}, String(r.year)), h('td', {}, bbl(r.oil_bbl)), h('td', r.production_ratio < 0.9 ? { class: 'bad' } : {}, bbl(r.guidance_bbl)),
    h('td', {}, usd(r.capex_usd)), h('td', {}, usd(r.approved_usd)), h('td', {}, usd(r.free_cash_flow_usd)), h('td', {}, usd(r.shareholder_return_usd))));
  t.append(tb);
  $('fin-years').replaceChildren(h('h2', {}, 'Year by year'), rv.length ? t : h('p', { class: 'hint' }, 'The first year-end review fills this table.'));
  const a = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Pad', 'Wells', 'Online', 'AFE', 'Actual', 'Variance'].map(x => h('th', {}, x)))));
  const ab = h('tbody');
  for (const p of C.pads_started) {
    const v = p.actual_usd != null && p.afe_usd ? p.actual_usd / p.afe_usd - 1 : null;
    ab.append(h('tr', {}, h('td', {}, p.pad), h('td', {}, String(p.wells)), h('td', {}, monthName(p.online_month)), h('td', {}, usd(p.afe_usd)), h('td', {}, usd(p.actual_usd)),
      h('td', v != null && v > 0.1 ? { class: 'bad' } : {}, v == null ? '–' : `${v >= 0 ? '+' : ''}${pct(v)}${v > 0.1 ? ', supplemental AFE' : ''}`)));
  }
  a.append(ab);
  $('fin-afe').replaceChildren(h('h2', {}, 'Pads: AFE against actual cost'), C.pads_started.length ? a : h('p', { class: 'hint' }, 'No pads started yet.'));
}

function boardFloorRow(by) {
  const bc = planRes?.board_check;
  if (!bc) return h('li', {}, h('span', {}, 'Oil guidance clears the board’s floor'), h('strong', {}, 'evaluate a plan first'));
  if (!bc.floor_applies) return h('li', {}, h('span', {}, 'Oil guidance floor'), h('strong', {}, 'waived: no open acreage left'));
  return h('li', {}, h('span', {}, `Guidance at least your producing base plus 5% (${bbl(bc.guidance_floor_bbl)})`),
    h('strong', bc.floor_reachable ? {} : { class: 'neg' }, `${by ? bbl(by.oil_forecast_bbl) : '–'}; at most ${bbl(bc.max_guidance_bbl)} at the limit${bc.floor_reachable ? '' : ': unreachable'}`));
}

// ------------------------------------------------------------------ inbox: list and reading pane, filters, unread
let mailFilter = 'all', mailOpen = null;
const KINDS = [['all', 'All'], ['task', 'Jobs'], ['board', 'Board'], ['operations', 'Operations'], ['finance', 'Finance'], ['report', 'Monthly reports']];
function unreadCount() { const seen = keep.get('seen', 0); const closed = new Set((C.tasks || []).filter(t => t.status !== 'open' && t.status !== 'upcoming').map(t => t.id));
  return C.inbox.slice(seen).filter(m => m.kind !== 'report' && !(m.kind === 'task' && closed.has(m.data?.task))).length; }   // routine reports and settled jobs are not news
function markRead() { keep.set('seen', C.inbox.length); $('inbox-n').textContent = ''; }
function msgLink(m) {   // where a message points: a pad on the field, the board, finances, or a steering session
  const d = m.data || {};
  if (m.kind === 'task' && d.kind && d.session) return [`Open the ${d.kind.replace(/-/g, ' ')} job`, () => { location.href = `minigames.html?game=${encodeURIComponent(d.kind)}&id=${encodeURIComponent(d.session)}`; }];
  if (d.session) return [`Open steering for ${d.well || 'the well'}`, () => { location.href = `geosteer.html?id=${d.session}`; }];
  if (d.sessions) { const [w, sid] = Object.entries(d.sessions)[0] || []; if (sid) return [`Steer ${w}`, () => { location.href = `geosteer.html?id=${sid}`; }]; }
  if (d.actual_usd != null) return ['Open finances', () => setTab('finance')];
  if (d.earliest_start_month != null || (d.pad && !d.well && m.title.toLowerCase().includes('unschedul'))) return ['Open the plan', () => setTab('plan')];
  if (d.pad) return [`Show pad ${d.pad}`, () => { focusSec = d.pad; setTab('field'); F3?.flyToSection(focusSec); }];
  const pad = /pad ([A-Z]\d+)/i.exec(m.title + ' ' + m.body);
  if (m.data?.year != null || m.kind === 'board') return ['Open the board', () => setTab('board')];
  if (m.kind === 'finance' || /AFE/.test(m.title)) return ['Open finances', () => setTab('finance')];
  if (/steer/i.test(m.title + m.body)) return ['Open the desk', () => setTab('home')];
  if (pad) return [`Show pad ${pad[1]}`, () => { focusSec = pad[1].toUpperCase(); setTab('field'); F3?.flyToSection(focusSec); }];
  return null;
}
function renderInbox() {
  const seenBefore = keep.get('seen', 0);
  $('mail-filters').replaceChildren(...KINDS.map(([k, lab]) => {
    const n = k === 'all' ? C.inbox.length : C.inbox.filter(m => m.kind === k).length;
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mailFilter === k), onclick: () => { mailFilter = k; mailOpen = null; renderInbox(); } }, `${lab} ${n}`);
  }));
  const ol = $('inbox'); ol.replaceChildren();
  const idx = C.inbox.map((m, i) => ({ ...m, i }));
  // monthly reports fold into one item that opens a table; everything else is a message
  let list = idx.filter(m => mailFilter === 'all' ? m.kind !== 'report' : m.kind === mailFilter);
  const reports = idx.filter(m => m.kind === 'report');
  const items = mailFilter === 'report' ? [] : grouped([...list].reverse());
  if ((mailFilter === 'all' || mailFilter === 'report') && reports.length)
    items.unshift({ folded: true, month: reports[reports.length - 1].month, title: `Monthly reports (${reports.length})`, kind: 'report', i: reports[reports.length - 1].i, n: 1 });
  if (!items.length) ol.append(h('li', { class: 'hint' }, 'Nothing here.'));
  for (const m of items) {
    const unread = m.i >= seenBefore;
    const li = h('li', { class: (unread ? 'unread ' : '') + (mailOpen === m.i ? 'open' : '') },
      h('button', { type: 'button', onclick: () => { mailOpen = m.i; renderInbox(); } },
        h('span', { class: 'when' }, monthName(m.month)), h('span', { class: 'kind' }, m.kind),
        h('strong', {}, m.title + (m.n > 1 ? ` (${m.n} times)` : '')),
        m.folded ? null : h('span', { class: 'snip' }, m.body.slice(0, 90) + (m.body.length > 90 ? '…' : ''))));
    ol.append(li);
  }
  if (mailOpen == null && items.length) mailOpen = items[0].i;
  const pane = $('mail-read'); pane.replaceChildren();
  const open = items.find(m => m.i === mailOpen);
  if (open?.folded) {
    const H = C.history;
    const t = h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Month', 'Oil bbl', 'Forecast bbl', 'Capex', 'Cash'].map(x => h('th', {}, x)))));
    const tb = h('tbody');
    for (let k = H.month.length - 1; k >= 0; k--) tb.append(h('tr', {}, h('td', {}, monthName(H.month[k])), h('td', H.oil_forecast[k] && H.oil[k] < 0.9 * H.oil_forecast[k] ? { class: 'bad' } : {}, num(H.oil[k])),
      h('td', {}, H.oil_forecast[k] == null ? '–' : num(H.oil_forecast[k])), h('td', {}, usd(H.capex_usd[k])), h('td', {}, usd(H.cash_usd[k]))));
    t.append(tb);
    pane.append(h('h2', {}, 'Monthly reports'), h('p', { class: 'hint' }, 'Every month at a glance. Red: more than 10% under the forecast you gave the board.'), t);
  } else if (open) {
    const link = msgLink(open);
    pane.append(h('span', { class: 'when' }, monthName(open.month)), h('span', { class: 'kind' }, open.kind), h('h2', {}, open.title),
      open.data?.kind === 'pad_report' ? reportCard(open.data) : h('p', {}, open.body),
      link ? h('button', { type: 'button', class: 'small-btn', onclick: link[1] }, link[0]) : null);
  }
  markRead();
}

// ------------------------------------------------------------------ boot
async function loadAnalogs() { const r = await call(`/api/career/analogs?id=${C.id}`); ANALOGS = r.ok ? r.analogs : []; }
async function reload() { const r = await call(`/api/career?id=${C.id}`); if (r.ok) C = r.career; renderBar(); }
function renderAll() { renderBar(); setTab(tab === 'inbox' ? 'home' : tab); if (q.get('tab') === 'inbox') openInbox(true); }

(async function boot() {
  const id = q.get('id');
  if (!id) { await landing(); if (q.get('new')) $('new-name').focus(); return; }
  let r = await call(`/api/career?id=${id}`);
  if (!r.ok) return landing();
  C = r.career.status === 'generating' ? await waitGenerated(id) : r.career;
  if (!C) return;
  showApp();
  try { localStorage.setItem('career.last', C.id); } catch { /* the title screen falls back to the list */ }
  await loadAnalogs();
  renderAll();
  window.__ready = true;
})();
