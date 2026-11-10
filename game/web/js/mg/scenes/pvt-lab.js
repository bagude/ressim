// PVT lab in 3D: the sample bottles on a rack (view.samples) and, for the latest sample with a CCE or DL test, the
// visual cells stepping down in pressure through the lab's own rows.
// CCE cell (tests.cce.rows: oil_rb, gas_rb): the gas stays in the cell, so the volume grows; gas appears below the bubble point.
// DL cell (tests.dl.rows: bod, gas_released_scf_bbl, bg_rb_mscf): at each step the gas comes out of solution and is
// vented, so the oil shrinks step by step. Gas volume at a step = gas released (scf/bbl) * Bg (rb/Mscf) / 1000.
// Vertical scale: 1 unit = 1 reservoir barrel per barrel of stock-tank (CCE) or residual (DL) oil, the lab's own bases.
// The cell is drawn at that scale; real visual cells hold a few hundred cc. Bottle and cell proportions are estimated.

let R = 0.42; const AMBER = '#c98322', GAS = '#bcd3e0';
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function build(ctx, v, St) {
  const { THREE, stage } = ctx;
  stage.gtao.enabled = false; stage.scene.fog = null; stage.bloom.strength = 0.1;
  ctx.root = new THREE.Group(); stage.scene.add(ctx.root);
  stage.onUpdate((dt) => tick(ctx, dt));
  draw(ctx, v, St);
}
export function update(ctx, v, prev, St) { draw(ctx, v, St); }

// one cell: glass tube, oil column, gas column above it, steel piston on top of the fluid
function cell(ctx, root, x, H) {
  const { THREE } = ctx, g = new THREE.Group(); g.position.x = x; root.add(g);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, H + 0.4, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: '#9fb4c2', transparent: true, opacity: 0.07, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.y = (H + 0.4) / 2; g.add(glass);
  const steel = new THREE.MeshStandardMaterial({ color: '#b9b6ae', metalness: 0.85, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.14, R + 0.14, 0.16, 40), steel); base.position.y = -0.08; g.add(base);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.14, R + 0.14, 0.16, 40), steel); cap.position.y = H + 0.48; g.add(cap);
  const unit = new THREE.CylinderGeometry(R, R, 1, 40); unit.translate(0, 0.5, 0);   // a unit-height column, scaled per frame
  const oil = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: AMBER, roughness: 0.35, transparent: true, opacity: 0.9 }));
  const gas = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: GAS, roughness: 0.6, transparent: true, opacity: 0.4, depthWrite: false }));
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.1, 40), steel);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 12), steel); rod.geometry.translate(0, 0.5, 0);
  g.add(oil, gas, piston, rod);
  const set = (o, gv) => {
    oil.scale.y = Math.max(0.001, o); gas.position.y = o; gas.scale.y = Math.max(0.001, gv); gas.visible = gv > 0.002;
    piston.position.y = o + gv + 0.05; rod.position.y = o + gv + 0.1; rod.scale.y = Math.max(0.01, H + 0.4 - (o + gv + 0.1));
  };
  return { g, set };
}

function draw(ctx, v, St) {
  const { THREE, stage } = ctx, root = ctx.root;
  root.clear(); ctx.clearLabels(); ctx.anim = null;
  const S = v.samples || [], narrow = stage.canvas.clientWidth < 600;   // phone: compact labels; the 2D tables carry the detail
  const tested = [...S].reverse().find(s => s.tests?.cce || s.tests?.dl);
  const cce = tested?.tests?.cce, dl = tested?.tests?.dl, sep = tested?.tests?.separator;
  const pb = cce?.bubble_point_psia ?? dl?.bubble_point_psia ?? sep?.bubble_point_psia;
  // the rack: one bottle per sample, flagged when it was taken below the measured bubble point (a two-phase sample)
  const steel = new THREE.MeshStandardMaterial({ color: '#9fa3a6', metalness: 0.8, roughness: 0.35 });
  S.forEach((s, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 20), steel);
    b.rotation.z = Math.PI / 2; b.position.set((i - (S.length - 1) / 2) * 1.6, 0.12, 1.6 + R); root.add(b);
    const spb = s.tests?.cce?.bubble_point_psia ?? s.tests?.dl?.bubble_point_psia ?? s.tests?.separator?.bubble_point_psia;
    const below = spb && s.sampling_pressure_psia < spb;
    ctx.label(narrow ? `#${s.id}${below ? ' below Pb' : `, ${fmt(s.sampling_pressure_psia)} psia`}` : `#${s.id} ${s.method.replace(/_/g, ' ')}, taken at ${fmt(s.sampling_pressure_psia)} psia${below ? ': below the bubble point, two phases' : ''}`,
      new THREE.Vector3((i - (S.length - 1) / 2) * 1.6, 0.3, 1.6 + R), below ? 'warn' : 'muted');
  });
  // the cells
  const cceRows = cce?.rows || [], dlRows = (dl?.rows || []).filter(r => r.pressure_psia > 15);   // the last DL step is the flash to stock tank
  const cceMax = Math.max(0, ...cceRows.map(r => r.oil_rb + r.gas_rb));
  const dlGas = (r) => (r.gas_released_scf_bbl || 0) * (r.bg_rb_mscf || 0) / 1000;
  const dlMax = Math.max(0, ...dlRows.map(r => r.bod + dlGas(r)));
  const cells = [];
  R = Math.max(0.42, Math.max(cceMax, dlMax) / 7);   // both cells share one width, so their volumes compare by height
  const both = cceRows.length && dlRows.length;
  if (cceRows.length) {
    const c = cell(ctx, root, both ? -(1.3 + R) : 0, cceMax); c.set(cceRows[0].oil_rb, cceRows[0].gas_rb);
    const L = ctx.label('', new THREE.Vector3(c.g.position.x, cceMax + 0.8, 0));
    // ring at the cell volume where the pressure reaches the bubble point (interpolated between the lab's rows)
    const j = cceRows.findIndex(r => r.pressure_psia < pb);
    if (pb && j > 0) {
      const a = cceRows[j - 1], b = cceRows[j], t = (a.pressure_psia - pb) / (a.pressure_psia - b.pressure_psia), vb = a.oil_rb + a.gas_rb + t * (b.oil_rb + b.gas_rb - a.oil_rb - a.gas_rb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.08, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: '#f0a53a' }));
      ring.rotation.x = Math.PI / 2; ring.position.set(c.g.position.x, vb, 0); root.add(ring);
      ctx.label(`${narrow ? 'Pb' : 'bubble point'} ${fmt(pb)} psia`, new THREE.Vector3(c.g.position.x - R - 0.1, vb, 0));
    }
    cells.push({ kind: 'cce', c, L, rows: cceRows });
  }
  if (dlRows.length) {
    const c = cell(ctx, root, both ? 1.3 + R : 0, dlMax); c.set(dlRows[0].bod, 0);
    const L = ctx.label('', new THREE.Vector3(c.g.position.x, dlMax + 0.8, 0));
    cells.push({ kind: 'dl', c, L, rows: dlRows });
  }
  if (sep && !narrow) ctx.label(`Separator: Bo ${fmt(sep.bo_rb_stb, 3)} rb/stb, GOR ${fmt(sep.gor_scf_stb)} scf/stb, ${fmt(sep.oil_gravity_api, 1)}° API`, new THREE.Vector3(0, -0.8, 1.2), 'muted');
  // after the report: what you reported and, from the result's lookback, the true reservoir fluid
  const top = Math.max(cceMax, dlMax, 1);
  if (v.answers && !(narrow && St?.result?.lookback)) ctx.label(`Your report: bubble point ${fmt(v.answers.bubble_point_psia)} psia, Bo ${fmt(v.answers.bo_rb_stb, 3)} rb/stb`, new THREE.Vector3(0, top + 1.5, 0));
  const lb = St?.result?.lookback;
  if (lb?.bubble_point_psia) {
    const q = (lb.samples || []).find(x => x.id === tested?.id)?.quality;
    ctx.label(narrow ? `True Pb ${fmt(lb.bubble_point_psia)} psia, Bo ${fmt(lb.bo_rb_stb, 3)}${v.answers ? ` (you: ${fmt(v.answers.bubble_point_psia)}, ${fmt(v.answers.bo_rb_stb, 3)})` : ''}` : `The reservoir fluid: bubble point ${fmt(lb.bubble_point_psia)} psia, Bo ${fmt(lb.bo_rb_stb, 3)} rb/stb${q ? `. Sample #${tested.id}: ${q}` : ''}`, new THREE.Vector3(0, top + 1.1, 0), 'warn');
  }
  // play the pressure steps; with reduced motion, show the lowest pressure step
  ctx.anim = { cells, t: 0, step: 1.5, hold: 2.5 };
  if (ctx.reduced) for (const k of cells) pose(k, k.rows.length - 1, 1);
  else for (const k of cells) pose(k, 0, 1);
  const H = Math.max(cceMax, dlMax, 1);
  stage.configure({ size: Math.max(4, H * 1.5), fog: false });
  const key = `${cells.length}:${H.toFixed(2)}:${S.length}`;
  if (ctx.key !== key) {
    ctx.frame(new THREE.Box3(new THREE.Vector3(-2.4 - 2 * R, -0.9, -R), new THREE.Vector3(2.4 + 2 * R, H + 1.4, 1.9 + R)), [0.15, 0.35, 1], !!ctx.key);
    ctx.key = key;
  }
  ctx.describe(!S.length ? 'The PVT lab, empty: take a fluid sample to start.'
    : !cells.length ? `The sample rack: ${S.length} sample${S.length > 1 ? 's' : ''}. Send one for a CCE or DL test to see it in the cell.`
      : `Sample #${tested.id} in the cells, pressure stepping down from ${fmt(cells[0].rows[0].pressure_psia)} psia. ${cceRows.length ? `CCE keeps the gas: bubble point ${fmt(pb)} psia, volume ${fmt(cceMax, 2)} rb by ${fmt(cceRows.at(-1).pressure_psia)} psia. ` : ''}${dlRows.length ? `DL vents it: oil shrinks from ${fmt(dlRows[0].bod, 3)} to ${fmt(dl.residual_oil_rb_stb, 3)} rb.` : ''}`);
}

// set a cell to step i, fraction f through it (for DL: first the gas comes out, then it is vented)
function pose(k, i, f) {
  const r = k.rows[i], p = k.rows[Math.max(0, i - 1)];
  if (k.kind === 'cce') {
    const e = i === 0 ? 1 : f;
    k.c.set(p.oil_rb + (r.oil_rb - p.oil_rb) * e, p.gas_rb + (r.gas_rb - p.gas_rb) * e);
    text(k, `CCE, gas kept: ${Math.round(i === 0 ? r.pressure_psia : p.pressure_psia + (r.pressure_psia - p.pressure_psia) * e).toLocaleString('en-US')} psia`);
  } else {
    const g = (r.gas_released_scf_bbl || 0) * (r.bg_rb_mscf || 0) / 1000;
    const out = Math.min(1, f / 0.55), vent = Math.max(0, (f - 0.6) / 0.4);
    k.c.set(p.bod + (r.bod - p.bod) * out, i === 0 ? 0 : g * out * (1 - vent));
    text(k, `DL, gas vented: ${Math.round(r.pressure_psia).toLocaleString('en-US')} psia${i && f > 0.6 && f < 1 ? ', venting' : ''}`);
  }
}
function text(k, s) { if (k.L.el.textContent !== s) { k.L.el.textContent = s; k.L.w = 0; } }

function tick(ctx, dt) {
  const A = ctx.anim; if (!A || ctx.reduced || !A.cells.length) return;
  const n = Math.max(...A.cells.map(k => k.rows.length)), total = n * A.step + A.hold;
  A.t = (A.t + dt) % total;
  const i = Math.floor(A.t / A.step), f = (A.t % A.step) / A.step;
  for (const k of A.cells) { if (i >= k.rows.length) pose(k, k.rows.length - 1, 1); else pose(k, i, Math.min(1, f * 1.25)); }
}
