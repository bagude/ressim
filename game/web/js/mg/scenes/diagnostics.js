// Read the Well in 3D: the horizontal well and its stages, its offset neighbour, and the production history replayed
// month by month: oil moves to the heel at a pace set by that month's rate, so a downtime month or a jump stands out.
// Drives: well {lateral_ft, stages, stage_spacing_ft, well_spacing_ft}; history {month[], oil_bbl_d[]}; answers (your
// own diagnosis, marked on the replay once you submit it). Lateral, stage spacing and the offset distance to scale at
// 50 ft per unit; pipe drawn wider than scale; fracture sizes are not in the view, so stages are drawn as perforation
// rings, not fractures.
import { kit, n0 } from './kit-wellbore.js';

export function build(ctx, v) { draw(ctx, v); }
export function update(ctx, v) { draw(ctx, v); }

function draw(ctx, v) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const W = v.well || {}, U = 50, Lat = (W.lateral_ft || 4620) / U, ns = W.stages || 30, sp = (W.stage_spacing_ft || (W.lateral_ft || 4620) / ns) / U;
  const off = (W.well_spacing_ft || 880) / U;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Lat + 10, off + 10), new THREE.MeshStandardMaterial({ color: '#9a8a62', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(Lat / 2, -0.6, -off / 2); K.add(ground);
  // the well (heel at x = 0) and its stages
  K.seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Lat, 0, 0), 0.4, K.mats.casing);
  const bend = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-2.5, 0.6, 0), new THREE.Vector3(-3.6, 3, 0), new THREE.Vector3(-3.7, 7, 0)]);
  K.add(new THREE.Mesh(new THREE.TubeGeometry(bend, 40, 0.4, 12), K.mats.casing));
  const ringM = new THREE.MeshStandardMaterial({ color: '#f0a53a', emissive: '#7a4a12' });
  for (let i = 0; i < ns; i++) { const x = Lat - (i + 0.5) * sp; if (x < 0) break; const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 20), ringM); r.position.x = x; r.rotation.y = Math.PI / 2; K.add(r); }
  // the offset well, to scale
  const offM = new THREE.MeshStandardMaterial({ color: '#8a949b', emissive: '#000', roughness: 0.6 });
  K.seg(new THREE.Vector3(0, 0, -off), new THREE.Vector3(Lat, 0, -off), 0.35, offM);
  ctx.label(`offset well, ${n0(W.well_spacing_ft)} ft away`, new THREE.Vector3(Lat * 0.6, 0.5, -off), 'muted');
  ctx.label(`${ns} stages over ${n0(W.lateral_ft)} ft`, new THREE.Vector3(Lat * 0.6, 0.6, 0), 'muted');
  ctx.label('to surface (not drawn)', new THREE.Vector3(-3.7, 7, 0), 'muted');
  const oil = K.flow([new THREE.Vector3(Lat, 0, 0.05), new THREE.Vector3(0, 0, 0.05), ...bend.getPoints(12).map(p => p.setZ(0.05))], { n: 60, color: '#c98322', r: 0.18 });
  const now = ctx.label('', new THREE.Vector3(-3.4, 4.5, 0));
  const H = v.history || {}, M = H.month || [], Q = H.oil_bbl_d || [], qmax = Math.max(1, ...Q);
  const A = v.answers, down = new Set(A?.downtime || []), hit = A?.frac_hit || 0;
  if (M.length) K.timeline(M.length, 12, (i) => {
    const q = Q[i] || 0;
    oil.speed = q > 0 ? 0.02 + 0.3 * q / qmax : 0; oil.mesh.visible = q > 0;
    const mine = [down.has(M[i]) ? 'you marked downtime' : '', hit && M[i] === hit ? 'you marked the frac hit' : ''].filter(Boolean).join(', ');
    offM.emissive.set(hit && M[i] === hit ? '#7a2a1c' : '#000');
    K.text(now, `Month ${M[i]}: ${n0(q)} bbl/d${mine ? ` (${mine})` : ''}`);
  }, { hold: 2.5 });
  if (!ctx.framed) { ctx.framed = true; ctx.frame(new THREE.Box3(new THREE.Vector3(-4.5, -0.6, -off - 1.5), new THREE.Vector3(Lat + 2, 7.5, 2)), [-0.35, 0.6, 1]); }
  ctx.describe(`The well and its offset neighbour, with ${M.length} months of production replayed: the oil moves faster in a better month and stops when the well was down.${A ? ' Your diagnosis is marked as the months pass.' : ''} To scale except the pipe; stages drawn as rings.`);
}
