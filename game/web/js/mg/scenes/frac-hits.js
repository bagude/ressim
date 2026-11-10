// Frac hits in 3D: the child pad's laterals fracked toe to heel, and the producing parents beside them.
// Drives: child {wells, stages_per_well}, stages_done, step/steps, phase; parents[{id, distance_ft, rate_bopd, status,
// preload, gauge, readings[{step, signal, dpsi}], hit_seen, hit_seen_step}]. Shown honestly: a parent's distance is to
// scale (100 ft per unit); the child spacing, the lateral length and which side a parent sits on are schematic (the view
// does not give them). Hits are shown only where a gauge saw them (hit_seen), as in the 2D view; an ungauged parent
// keeps its secret until the job is scored.
import { kit, n0 } from './kit-wellbore.js';

const U = 100, SPACING = 660, STAGE_FT = 250;   // schematic child spacing and stage length, in ft

export function build(ctx, v) { draw(ctx, v, null); }
export function update(ctx, v, prev) { draw(ctx, v, prev); }

function draw(ctx, v, prev) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const C = v.child || {}, nw = C.wells || 4, spw = C.stages_per_well || 40, L = spw * STAGE_FT / U, s = SPACING / U;
  const P = v.parents || [];
  // the child wells along x (heel at 0, toe at L), across z
  const childZ = Array.from({ length: nw }, (_, i) => i * s);
  // parents: near side at their distance; a parent too close to another one already placed goes to the far side
  const placed = [];
  const parentZ = P.map((p) => { const d = (p.distance_ft || 500) / U; let z = -d; if (placed.some(q => Math.abs(q - z) < 1.2)) z = childZ.at(-1) + d; placed.push(z); return z; });
  const zMin = Math.min(-1, ...parentZ) - 2, zMax = Math.max(childZ.at(-1), ...parentZ) + 2;
  K.box(L + 8, 0.6, zMax - zMin, new THREE.MeshStandardMaterial({ color: '#9a8a62', transparent: true, opacity: 0.12, depthWrite: false }), new THREE.Vector3(L / 2, -0.4, (zMin + zMax) / 2));
  // child laterals: grey pipe, amber where fracked; the frac front pulses
  const done = v.stages_done || 0, before = prev ? prev.stages_done || 0 : done;
  const per = (n, i) => Math.floor(n / nw) + (i < n % nw ? 1 : 0);   // zipper: the wells share the stages
  const amber = new THREE.MeshStandardMaterial({ color: '#f0a53a', emissive: '#7a4a12', emissiveIntensity: 0.6 });
  const fronts = [];
  childZ.forEach((z, i) => {
    K.seg(new THREE.Vector3(0, 0, z), new THREE.Vector3(L, 0, z), 0.35, K.mats.casing);
    const pad = K.box(0.8, 0.8, 0.8, K.mats.dark, new THREE.Vector3(-0.8, 0.4, z));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 14), amber); m.rotation.z = Math.PI / 2; m.visible = false; K.add(m);
    fronts.push({ m, z, from: per(before, i), to: per(done, i) });
    if (i === 0) ctx.label(`child pad: ${nw} wells, ${spw} stages each`, new THREE.Vector3(-1.2, 1.0, z), 'muted');
  });
  const setDone = (t) => fronts.forEach(f => { const k = f.from + (f.to - f.from) * t, len = k / spw * L; f.m.visible = len > 0.01; f.m.scale.y = Math.max(0.01, len); f.m.position.set(L - len / 2, 0, f.z); });
  setDone(1);
  if (done !== before && !ctx.reduced) { let t = 0; setDone(0); K.on((dt) => { t = Math.min(1, t + dt / 2); setDone(t); }); }
  // parents
  const col = { producing: '#5fa85e', 'shut-in': '#8a949b', shut_in: '#8a949b' };
  P.forEach((p, i) => {
    const z = parentZ[i], c = p.hit_seen ? '#e8806f' : (col[p.status] || '#b7678f');
    const mat = new THREE.MeshStandardMaterial({ color: c, emissive: p.hit_seen ? '#5a1a12' : '#000', roughness: 0.5 });
    K.seg(new THREE.Vector3(0, 0, z), new THREE.Vector3(L, 0, z), 0.45, mat);
    if (p.gauge) K.box(0.6, 0.6, 0.6, K.mats.paint, new THREE.Vector3(-0.6, 0.3, z));
    if (p.preload) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 20), new THREE.MeshStandardMaterial({ color: '#3d8be0' })); ring.position.set(L * 0.5, 0, z); ring.rotation.y = Math.PI / 2; K.add(ring); }
    const r = (p.readings || []).at(-1);
    const st = p.hit_seen ? `frac hit seen at step ${p.hit_seen_step}` : String(p.status || '').replace(/_/g, ' ');
    ctx.label(`${p.id}: ${n0(p.distance_ft)} ft away, ${n0(p.rate_bopd)} bopd, ${st}${p.preload ? ', pre-loaded' : ''}${p.gauge ? (r ? `; gauge ${r.signal}${r.dpsi ? ` +${n0(r.dpsi)} psi` : ''}` : '; gauge on') : ''}`, new THREE.Vector3(L * 0.15, 0.4, z), p.hit_seen ? 'warn' : '');
    if (p.hit_seen && !ctx.reduced) { let t = 0; K.on((dt) => { t += dt; mat.emissiveIntensity = 0.6 + 0.5 * Math.sin(t * 4); }); }
  });
  ctx.label(v.phase === 'plan' ? 'Planning: nothing fracked yet' : `Step ${v.step} of ${v.steps}: ${n0(done)} of ${n0(v.stages_total)} stages pumped`, new THREE.Vector3(L * 0.55, 2.0, childZ.at(-1)));
  ctx.label('parent distances to scale; child spacing, lateral length and sides schematic', new THREE.Vector3(L * 0.5, -0.8, zMin), 'muted');
  if (!ctx.framed) { ctx.framed = true; ctx.frame(new THREE.Box3(new THREE.Vector3(-2, -0.8, zMin), new THREE.Vector3(L + 2, 2.4, zMax)), [-0.55, 0.9, 0.75]); }
  ctx.describe(`Plan view at depth: ${nw} child laterals (amber where fracked, toe first) and ${P.length} producing parents. Red: a gauge saw a hit. Parent distances to scale; pipe drawn wider than scale; the rest is schematic.`);
}
