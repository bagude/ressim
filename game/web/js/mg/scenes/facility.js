// Facility in 3D: three wells (view.wells) flowing through their flowlines into one central facility: inlet manifold,
// separator at the design's pressure, compression when the design pays for it, and the oil line to the tanks.
// The design shown is the built one (view.built) or the latest study (view.studies). After each new design the scene
// plays its 24 simulated months: each flowline's beads follow series.per_well, and the oil line is drawn against
// the facility's oil capacity (series.cap_bbl_d), so a full line means the facility is the bottleneck.
// Scale: 1 unit = 1 metre; the layout is schematic (wells are spread for legibility, not at their true spacing).
import { kit, n0 } from './kit-pad.js';

const WZ = [-16, 0, 16];

export function build(ctx, v) {
  ctx.K = kit(ctx); ctx.root = new ctx.THREE.Group(); ctx.stage.scene.add(ctx.root);
  ctx.stage.configure({ size: 80, fog: false });
  draw(ctx, v, null);
  ctx.frame(new ctx.THREE.Box3(new ctx.THREE.Vector3(-36, 0, -18), new ctx.THREE.Vector3(26, 5, 18)), [0.45, 0.6, 0.85]);
}
export function update(ctx, v, prev) { draw(ctx, v, prev); }

const pick = (v) => v.built || v.studies?.at(-1) || null;

function draw(ctx, v, prev) {
  const { K, root } = ctx, { mat, THREE } = K, V = (x, y, z) => new THREE.Vector3(x, y, z);
  K.reset(root);
  const D = pick(v), W = v.wells || [], des = D?.design || {}, ser = D?.series || {};
  K.ground(root, 78, 52);
  const flows = [], wl = [];
  W.slice(0, 3).forEach((w, i) => {
    const z = WZ[i] ?? i * 16 - 16;
    K.wellhead(root, [-34, z]);
    const line = K.pipe(root, [[-33.6, z, 1.95], [-33, z, 0.5], [-14, z, 0.5], [-12, 0, 0.5]]);
    flows.push(K.flow(root, line, 0, mat.oil));
    wl.push(K.label(`${w.id}: ${(w.perm_md * 1000).toFixed(1)} microdarcy, ${w.thickness_ft} ft net, ${n0(w.half_length_ft)} ft half-length`, w.id, V(-34, 3.4, z), 'muted'));
  });
  K.add(root, new THREE.BoxGeometry(2, 1.4, 6), mat.red, [-12, 0.7, 0]);   // inlet manifold (estimated)
  K.separator(root, [-2, 0], { od: 48 * 0.0254, len: 15 * 0.3048 });       // 48 in x 15 ft, a three-well facility size (estimated)
  if (D?.compression_usd_month > 0) { K.compressor(root, [-2, 12]); K.label(`Compression, $${n0(D.compression_usd_month)} a month`, null, V(-2, 3.5, 12), 'muted'); }
  for (const [x, z] of [[14, -8], [19, -8], [24, -8]]) K.tank(root, [x, z]);
  K.pipe(root, [[-12, 0], [-5, 0]]);
  const oilL = K.pipe(root, [[1, 0], [10, 0], [10, -4], [24, -4], [24, -6.2, 0.6]]);
  const total = K.flow(root, oilL, 0, mat.oil);
  if (D) K.label(`Separator at ${n0(des.separator_psi)} psi${des.tubing ? `, ${des.tubing} tubing` : ''}, ${String(des.allocation || '').replace('_', ' ')} allocation`, `Separator ${n0(des.separator_psi)} psi`, V(-2, 3.2, 0));
  const capL = D ? ctx.label('', V(19, 8, -8)) : null, monL = D ? ctx.label('', V(-34, 6, -24), 'muted') : null, nw = K.narrow;
  const show = (m) => {
    const cap = ser.cap_bbl_d?.[m] ?? des.oil_cap_bbl_d, tot = ser.total_oil_bbl_d?.[m] ?? 0;
    W.slice(0, 3).forEach((w, i) => { const q = ser.per_well?.[w.id]?.[m] ?? 0; flows[i].set(q / 1000); K.text(wl[i], nw ? `${w.id} ${n0(q)}` : `${w.id}: ${n0(q)} bbl/d`, ''); });
    total.set(cap ? tot / cap : 0);
    const full = cap && tot >= cap * 0.99;
    K.text(capL, nw ? `Oil ${n0(tot)} / ${n0(cap)} bbl/d${full ? ', at limit' : ''}` : `Oil ${n0(tot)} of ${n0(cap)} bbl/d capacity${full ? ': the facility is the limit' : ''}`, full ? 'warn' : '');
    K.text(monL, `Month ${ser.month?.[m] ?? m + 1} of ${ser.month?.length ?? v.months}`, 'muted');
  };
  const n = ser.month?.length || 0;
  if (D && n) {
    const key = JSON.stringify([des, D.npv10_usd]), was = prev && pick(prev) ? JSON.stringify([pick(prev).design, pick(prev).npv10_usd]) : null;
    if (key !== was || !prev) K.lapse(n, 10, show); else show(n - 1);
  }
  ctx.describe(D
    ? `${v.built ? 'The built facility' : 'The latest study'}: three wells into a separator at ${n0(des.separator_psi)} psi with ${n0(des.oil_cap_bbl_d)} bbl/d of oil capacity. The scene plays the ${n} simulated months; bead density shows each well's rate, and a full oil line means the facility is holding the wells back.`
    : `Three wells and the central facility site, before any study. Run an engineering study to see how the design flows.`);
}
