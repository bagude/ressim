// Rock zoom for a career well: the simulator's pressure field for one well, from GET /api/career/field.
// The server sends ONE fracture's share (x = one stage spacing, y = half the gap to each neighbouring well, no-flow
// there). Every stage of the well behaves the same in this model, so we tile that cell along the lateral `stages`
// times and draw the well between its neighbours. Months run from first production to what the player has seen.
import { Stage } from '../engine/stage.js';
import { Reservoir, RAMP } from '../game/reservoir.js';

let overlay = null, stage = null, res = null, playing = false, t = 0, months = [];

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function tile(f) {
  const n = f.stages, nx = f.nx, ny = f.ny, X = f.x_edges_ft, sp = f.stage_spacing_ft;
  const xe = [];
  for (let s = 0; s < n; s++) for (let i = (s ? 1 : 0); i <= nx; i++) xe.push(X[i] + s * sp);
  const NX = nx * n;
  const rep = (arr, mapMask) => {
    const out = new Array(NX * ny);
    for (let j = 0; j < ny; j++) for (let s = 0; s < n; s++) for (let i = 0; i < nx; i++) {
      const v = arr[j * nx + i];
      out[j * NX + s * nx + i] = mapMask ? (v > 0 ? s + 1 : 0) : v;
    }
    return out;
  };
  return { ...f, nx: NX, x_edges_ft: xe, frac_mask: rep(f.frac_mask, true), pressure_psi: f.pressure_psi.map(a => rep(a)) };
}

export async function openRock(careerId, well, { career, design }) {
  const r = await fetch(`/api/career/field?id=${encodeURIComponent(careerId)}&well=${encodeURIComponent(well.id)}`);
  if (!r.ok) { alertMsg(`No pressure field for ${well.id} yet: it needs at least one month on production.`); return; }
  const f = await r.json();
  if (!overlay) build();
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  const T = tile(f);
  const L = f.stages * f.stage_spacing_ft;
  const level = { lateral_ft: L, lease_width_ft: f.well_spacing_ft, thickness_ft: career.reservoir?.thickness_ft ?? 100,
    top_depth_ft: career.reservoir?.top_ft ?? null };
  res.setLevel(level);
  res.setDesign({ stages: f.stages, half_length_ft: Math.min(design.half_length_ft, f.well_spacing_ft / 2) });
  res.setField(T);
  months = f.months;
  overlay.querySelector('#rk-title').textContent = `${well.id}: pressure around its fractures`;
  overlay.querySelector('#rk-note').textContent = `${f.stages} stages, ${f.stage_spacing_ft} ft apart, ${f.well_spacing_ft} ft from its neighbours. ` +
    `One stage's simulated cell, repeated along the lateral; the lease lines here are the no-flow boundaries halfway to the neighbouring wells. ` +
    `Months since first production, up to what you have seen. Nominal ${level.thickness_ft} ft zone.`;
  overlay.querySelector('#rk-hi').textContent = `${Math.round(f.initial_pressure_psi).toLocaleString('en-US')} psi`;
  overlay.querySelector('#rk-lo').textContent = `${Math.round(f.bhp_psi).toLocaleString('en-US')} psi`;
  const m = overlay.querySelector('#rk-month'); m.max = months.length - 1; m.value = 0;
  t = 0; set(0); playing = true; overlay.querySelector('#rk-play').textContent = 'Pause';
  const span = Math.max(L, f.well_spacing_ft) * 0.01;
  stage.camera.position.set(span * 0.25, span * 0.55, span * 0.85); stage.controls.target.set(0, -0.5, 0);
  stage.resize();
}

function set(v) {
  t = Math.max(0, Math.min(months.length - 1, v));
  res.setMonth(t);
  overlay.querySelector('#rk-month').value = t;
  const k = Math.round(t);
  overlay.querySelector('#rk-label').textContent = months[k] === 0 ? 'Before production' : `Month ${months[k]} on production`;
}

function build() {
  overlay = el('div', { class: 'rock', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rk-title' },
    el('div', { class: 'rock-head' }, el('h2', { id: 'rk-title' }), el('button', { type: 'button', class: 'small-btn', onclick: close }, 'Close')),
    el('p', { id: 'rk-note', class: 'hint' }),
    el('div', { class: 'rock-stage' }, el('canvas', { id: 'rk-canvas', 'aria-label': 'Pressure map around the well' })),
    el('div', { class: 'rock-time' },
      el('button', { type: 'button', id: 'rk-play', class: 'small-btn', onclick: () => {
        if (t >= months.length - 1) set(0);
        playing = !playing; overlay.querySelector('#rk-play').textContent = playing ? 'Pause' : 'Play'; } }, 'Play'),
      el('input', { type: 'range', id: 'rk-month', min: 0, max: 1, step: 0.01, 'aria-label': 'Month' }),
      el('span', { id: 'rk-label' }),
      el('div', { class: 'legend' }, el('span', { id: 'rk-hi' }), el('span', { class: 'ramp', style: `background: linear-gradient(90deg, ${RAMP.join(', ')})` }), el('span', { id: 'rk-lo' }))));
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  overlay.querySelector('#rk-month').addEventListener('input', (e) => { playing = false; overlay.querySelector('#rk-play').textContent = 'Play'; set(+e.target.value); });
  stage = new Stage(overlay.querySelector('#rk-canvas'));
  stage.camera.near = 0.3; stage.camera.updateProjectionMatrix();   // depth precision for a mile-long cutaway
  stage.gtao.enabled = false; stage.bloom.enabled = false;   // keeps the map's pixels equal to the legend (measured in the level game)
  res = new Reservoir(stage, { labelParent: overlay.querySelector('.rock-stage') });
  stage.onUpdate((dt) => { if (playing && months.length) { set(t + dt * Math.max(1.5, months.length / 6)); if (t >= months.length - 1) { playing = false; overlay.querySelector('#rk-play').textContent = 'Play'; } } });
  stage.start();
}

function close() { overlay.hidden = true; playing = false; document.body.style.overflow = ''; }
function alertMsg(text) { const p = document.getElementById('sec-detail'); if (p) p.append(el('p', { class: 'hint' }, text)); }
