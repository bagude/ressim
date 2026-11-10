// Pump the Job in 3D: a cutaway of the rock at the stage. Pay and barriers (from view.pay and view.barriers), the
// horizontal wellbore with its perforation clusters, and one fracture per cluster, shaped from the simulated height
// profile (view.growth.profile) and sized from view.clusters; darker where propped. After a pump, the fractures grow.
// 1 unit = 10 ft. x along the wellbore, y up (0 = the perforations), z across (the fracture wings).
// Everything drawn comes from the view; nothing is invented (surface pressure is not modelled, so no gauge is shown).
const U = 10;

export function build(ctx, v, S) {
  const { THREE, stage } = ctx;
  stage.gtao.enabled = false;            // a translucent cutaway reads better without ambient occlusion
  stage.bloom.strength = 0.12;
  stage.scene.fog = null;
  ctx.root = new THREE.Group(); stage.scene.add(ctx.root);
  draw(ctx, v, null);
}
export function update(ctx, v, prev) { draw(ctx, v, prev); }

function draw(ctx, v, prev) {
  const { THREE, stage } = ctx;
  const root = ctx.root;
  root.clear(); ctx.clearLabels();
  const pay = v.pay || { top_ft: -50, base_ft: 50 }, bars = v.barriers || [], f = v.fracture || {}, g = v.growth || {};
  const C = v.clusters?.length ? v.clusters : (f.half_length_ft ? [{ position_ft: 0, half_length_ft: f.half_length_ft, propped_half_length_ft: f.propped_half_length_ft, fluid_share: 1, height_at_well_ft: (f.height_up_ft || 0) + (f.height_down_ft || 0) }] : []);
  const pos = C.map((c, i) => c.position_ft ?? i * 50), x0 = Math.min(0, ...pos), x1 = Math.max(0, ...pos);
  const mid = (x0 + x1) / 2;
  const xf = Math.max(150, ...C.map(c => c.half_length_ft || 0), f.half_length_ft || 0);
  const halfL = Math.max(120, (x1 - x0) / 2 + 120) / U, halfW = xf * 1.2 / U;
  const top = Math.min(pay.top_ft, ...bars.map(b => b.top_ft), -(f.height_up_ft || 0) - 20), base = Math.max(pay.base_ft, ...bars.map(b => b.base_ft), (f.height_down_ft || 0) + 20);
  const Y = (d) => -d / U;   // depth relative to the perforations (positive down) to height
  // rock layers, translucent so the fractures read through them
  const slab = (t, b, color, opacity, label, cls) => {
    const h = Math.abs(Y(t) - Y(b)), m = new THREE.Mesh(new THREE.BoxGeometry(halfL * 2, h, halfW * 2),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.95, depthWrite: false }));
    m.position.set(0, (Y(t) + Y(b)) / 2, 0); root.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    e.position.copy(m.position); root.add(e);
    if (label) ctx.label(label, new THREE.Vector3(halfL, (Y(t) + Y(b)) / 2, -halfW), cls);   // the far corner, clear of the wing labels
  };
  for (const b of bars) slab(b.top_ft, b.base_ft, '#6f7d87', 0.10, b.stress_psi ? `barrier, +${Math.round(b.stress_psi).toLocaleString('en-US')} psi` : 'barrier', 'muted');
  slab(pay.top_ft, pay.base_ft, '#9a8a62', 0.10, `pay, ${Math.round(pay.base_ft - pay.top_ft)} ft`, 'muted');
  // the wellbore and its clusters
  const steel = new THREE.MeshStandardMaterial({ color: '#c9c6bd', metalness: 0.8, roughness: 0.35 });
  const wb = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, halfL * 2, 16), steel); wb.rotation.z = Math.PI / 2; root.add(wb);
  for (const p of pos) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 8, 24), new THREE.MeshStandardMaterial({ color: '#f0a53a', emissive: '#7a4a12' })); ring.rotation.y = Math.PI / 2; ring.position.x = (p - mid) / U; root.add(ring); }
  // fractures: the simulated profile (height against distance along the wing), symmetric about the perforations
  const prof = g.profile?.x_ft?.length ? g.profile : null, H0 = prof ? Math.max(...prof.height_ft) : Math.max(1, (f.height_up_ft || 0) + (f.height_down_ft || 0));
  const runaway = (v.alarms || []).includes('height_runaway'), screened = (v.alarms || []).includes('screen_out');
  const shape = (len, heightAtWell) => {
    const s = new THREE.Shape(), k = heightAtWell / H0, pts = [];
    if (prof) prof.x_ft.forEach((x, i) => { if (x <= len) pts.push([x / U, prof.height_ft[i] * k / 2 / U]); });
    else for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([len * t / U, heightAtWell / 2 / U * Math.sqrt(Math.max(0, 1 - t * t))]); }
    if (!pts.length) return null;
    const outline = [...pts.slice().reverse().map(([x, y]) => [-x, y]), ...pts, ...pts.slice().reverse().map(([x, y]) => [x, -y]), ...pts.map(([x, y]) => [-x, -y])];
    s.moveTo(outline[0][0], outline[0][1]); for (const [x, y] of outline.slice(1)) s.lineTo(x, y);
    return new THREE.ShapeGeometry(s);
  };
  // the settled proppant bank: from the fracture's base up by growth.propped.bank_height_ft(x), out to the propped length
  const P = g.propped?.x_ft?.length ? g.propped : null;
  const bank = (len, hw) => {
    if (!P || !prof || !(len > 0)) return null;
    const k = hw / H0, sx = len / (P.half_length_ft || len), top = [], bot = [];
    P.x_ft.forEach((x, i) => {
      const X = x * sx; if (X > len) return;
      const j = prof.x_ft.findIndex(xx => xx >= X), hf = (j < 0 ? prof.height_ft.at(-1) : prof.height_ft[j]) * k;
      const b = -hf / 2 / U; bot.push([X / U, b]); top.push([X / U, b + Math.min(hf, P.bank_height_ft[i] * k) / U]);
    });
    if (!bot.length) return null;
    const s = new THREE.Shape(), mirror = (pts) => pts.map(([x, y]) => [-x, y]);
    const outline = [...mirror(bot).reverse(), ...bot, ...top.slice().reverse(), ...mirror(top)];
    s.moveTo(...outline[0]); for (const q of outline.slice(1)) s.lineTo(...q);
    return new THREE.ShapeGeometry(s);
  };
  ctx.fracs = [];
  C.forEach((c, i) => {
    const hw = c.height_at_well_ft || H0, geo = shape(c.half_length_ft || 0, hw); if (!geo) return;
    const grp = new THREE.Group(); grp.position.set((pos[i] - mid) / U, 0, 0); grp.rotation.y = Math.PI / 2; root.add(grp);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: runaway ? '#e8806f' : '#f0a53a', emissive: runaway ? '#5a1a12' : '#5a3608', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    grp.add(m);
    const pg = bank(Math.min(c.propped_half_length_ft || 0, c.half_length_ft || 0), hw);
    if (pg) { const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: '#8f5e1c', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); pm.position.z = 0.02; grp.add(pm); }
    ctx.fracs.push(grp);
  });
  // fluid split: one label when the clusters took about the same share, one per cluster when they did not
  const sh = C.map(c => Math.round((c.fluid_share || 0) * 100));
  if (C.length > 1 && Math.max(...sh) - Math.min(...sh) <= 3) ctx.label(`${C.length} clusters, about ${sh[0]}% of the fluid each`, new THREE.Vector3(0, H0 / 2 / U + 2, 0));
  else if (C.length > 1) C.forEach((c, i) => ctx.label(`${sh[i]}%`, new THREE.Vector3((pos[i] - mid) / U, (c.height_at_well_ft || H0) / 2 / U + 2 + (i % 2) * 2.5, 0)));
  if (C.length) ctx.label(`half-length ${Math.round(Math.max(...C.map(c => c.half_length_ft || 0)))} ft`, new THREE.Vector3(0, 0, (Math.max(...C.map(c => c.half_length_ft || 0))) / U), 'muted');
  if (runaway) ctx.label('height runaway: the fracture broke through a barrier', new THREE.Vector3(0, Y(top) - 1, 0), 'warn');
  if (screened) ctx.label('screen-out near the wellbore', new THREE.Vector3(0, -1.5, 0), 'warn');
  // grow from nothing after a pump (a new set of fractures), unless the viewer prefers reduced motion
  const grew = C.length && (!prev || JSON.stringify(prev.clusters || prev.fracture) !== JSON.stringify(v.clusters || v.fracture));
  if (grew && !ctx.reduced) {
    // replay the simulated growth (growth.history: half-length and height against time), squeezed into four seconds
    const Hh = g.history?.t_min?.length ? g.history : null, n = Hh ? Hh.t_min.length : 0;
    const L1 = Hh ? Hh.half_length_ft[n - 1] || 1 : 1, h1 = Hh ? Hh.height_at_well_ft[n - 1] || 1 : 1;
    let t = 0; ctx.fracs.forEach(gp => gp.scale.set(0.02, 0.02, 1));
    ctx.growOff?.();
    ctx.growOff = stage.onUpdate((dt) => {
      t = Math.min(1, t + dt / 4);
      let sx = 1 - (1 - t) ** 3, sy = sx;
      if (Hh) { const i = Math.min(n - 1, Math.floor(t * (n - 1))); sx = Hh.half_length_ft[i] / L1; sy = Hh.height_at_well_ft[i] / h1; }
      ctx.fracs.forEach(gp => gp.scale.set(Math.max(0.02, sx), Math.max(0.02, sy), 1));
      if (t >= 1) { ctx.growOff(); ctx.growOff = null; }
    });
  }
  // camera: oblique, from above the pay and off the wellbore's end, framing the block
  // frame the whole block; re-frame when it grows or shrinks a lot (after a pump)
  const R = Math.hypot(halfL, halfW, (Y(top) - Y(base)) / 2);
  stage.configure({ size: R * 2, fog: false });
  if (!ctx.R || R / ctx.R > 1.3 || ctx.R / R > 1.3) {
    ctx.frame(new THREE.Box3(new THREE.Vector3(-halfL, Y(base), -halfW), new THREE.Vector3(halfL, Y(top), halfW)), [0.82, 0.36, 0.45], !!ctx.R);
    ctx.R = R;
  }
  ctx.describe(C.length
    ? `Cutaway of the stage: ${C.length} fracture${C.length > 1 ? 's' : ''} up to ${Math.round(xf)} ft long each way, in a ${Math.round(pay.base_ft - pay.top_ft)} ft pay between barriers. Darker: propped. Drag to orbit.`
    : `Cutaway of the stage before pumping: the wellbore in a ${Math.round(pay.base_ft - pay.top_ft)} ft pay between barriers. Pump the stage to grow the fractures.`);
}
