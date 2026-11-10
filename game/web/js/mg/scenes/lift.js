// Artificial lift in 3D: the well from the surface to the pay, replaying the latest study month by month.
// Drives: well {depth_ft, thickness_ft, tubing_id_in, stages, perm_md}; studies[-1] {plan {method, switch_month,
// injection_mcf_d, intake_psi}, series {month[], method[], oil_bbl_d[], gas_mcf_d[], bhp_psi[]}}.
// Natural flow: oil and gas rising in the tubing at a pace set by the month's rates. Gas lift: lift gas going down the
// annulus and joining the tubing near the bottom (valve depths are not modelled). Pump: a beam unit at the surface and a
// rod string working a pump at the bottom. A month with no oil shows nothing moving: the well has loaded up.
// Broken depth axis; the pumping unit's proportions are estimated and, like the pipe, drawn far larger than the depth scale.
import { kit, depthMap, drawBreaks, n0 } from './kit-wellbore.js';

const NAME = { none: 'natural flow', natural: 'natural flow', gas_lift: 'gas lift', pump: 'rod pump' };

export function build(ctx, v) { draw(ctx, v); }
export function update(ctx, v) { draw(ctx, v); }

function draw(ctx, v) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const W = v.well || {}, D = W.depth_ft || 9000, pay = W.thickness_ft || 100;
  const map = depthMap([[0, 400], [D - 700, D + pay / 2 + 50]], { ftPerUnit: 140, gap: 1.0 });
  const Y = map.Y, rCsg = 0.8, rTub = Math.max(0.16, 0.1 * (W.tubing_id_in || 2.441));
  const st = v.installed?.series ? v.installed : (v.studies || []).at(-1), S = st?.series;
  // rock and pay behind the well
  K.box(4, -Y(D + pay / 2 + 50), 0.05, K.mats.rock, new THREE.Vector3(0, Y(D + pay / 2 + 50) / 2, -1.1));
  K.box(4, Y(D - pay / 2) - Y(D + pay / 2), 2.2, K.mats.pay, new THREE.Vector3(0, Y(D), 0));
  // casing (cut open), tubing, wellhead
  K.pipe(0, Y(D + pay / 2), rCsg, K.mats.casing, { cut: true });
  K.pipe(1.2, Y(D - 60), rTub, K.mats.casing, { cut: true });
  K.tree(0, 0.55);
  // the pump at the bottom and the rod string (pump plans only)
  const pumpG = new THREE.Group(); K.add(pumpG);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rTub * 0.9, rTub * 0.9, 0.9, 16), K.mats.paint); barrel.position.y = Y(D - 60) + 0.45; pumpG.add(barrel);
  const rodTop = 3.2, rodBot = Y(D - 60) + 0.9;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, rodTop - rodBot, 6), K.mats.steel); rod.position.y = (rodTop + rodBot) / 2; pumpG.add(rod);
  // beam pumping unit, estimated proportions: samson post, walking beam, horsehead over the well, crank and counterweight
  const jack = new THREE.Group(); pumpG.add(jack);
  const bx = (w, h, d, m, x, y, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  jack.add(bx(5.2, 0.2, 1.2, K.mats.dark, -2.4, 0.1));
  for (const z of [-0.35, 0.35]) { const leg = bx(0.16, 3.0, 0.16, K.mats.paint, -2.2, 1.6, z); jack.add(leg); }
  const beam = new THREE.Group(); beam.position.set(-2.2, 3.1, 0); jack.add(beam);
  beam.add(bx(4.2, 0.3, 0.32, K.mats.paint, 0.2, 0));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.36, 24, 1, false, Math.PI * 0.25, Math.PI * 0.5), K.mats.paint);
  head.rotation.x = Math.PI / 2; head.position.set(1.65, -0.35, 0); beam.add(head);
  const crank = new THREE.Group(); crank.position.set(-4.4, 1.0, 0); jack.add(crank);
  crank.add(bx(1.4, 0.3, 0.2, K.mats.dark, 0.3, 0, 0.45), bx(0.6, 0.6, 0.3, K.mats.red, 0.85, 0, 0.45));
  // gas-lift supply into the annulus (gas-lift plans only)
  const glG = new THREE.Group(); K.add(glG);
  const line = K.seg(new THREE.Vector3(3.2, 0.4, 0), new THREE.Vector3(rCsg, 0.4, 0), 0.07, new THREE.MeshStandardMaterial({ color: '#3d8be0', roughness: 0.5 })); glG.add(line);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(rTub * 1.4, rTub * 1.4, 0.35, 12), new THREE.MeshStandardMaterial({ color: '#3d8be0' })); valve.position.y = Y(D - 200); glG.add(valve);
  const gasDown = K.flow([new THREE.Vector3(2.9, 0.4, 0.2), new THREE.Vector3(0.55, 0.3, 0.3), new THREE.Vector3(0.55, Y(D - 200), 0.3), new THREE.Vector3(0.05, Y(D - 200), 0.3)], { n: 40, color: '#7fb6f0', r: 0.07 });
  glG.add(gasDown.mesh);
  // what comes up the tubing: oil, and free gas
  const oil = K.flow([new THREE.Vector3(0, Y(D - 60), 0.05), new THREE.Vector3(0, 1.1, 0.05), new THREE.Vector3(1.6, 1.1, 0.05)], { n: 46, color: '#c98322', r: rTub * 0.45 });
  const gas = K.flow([new THREE.Vector3(0.06, Y(D - 60), 0.12), new THREE.Vector3(0.06, 1.1, 0.12), new THREE.Vector3(1.6, 1.15, 0.12)], { n: 24, color: '#e6ebf0', r: rTub * 0.3 });
  // labels
  drawBreaks(K, ctx, map, { w: 1.1, labelX: 1.5 });
  K.ruler(1.4, [{ y: 0, text: '' }, { y: Y(D), text: `${n0(D)} ft` }]);
  ctx.label(`pay, ${n0(pay)} ft, ${W.perm_md} md`, new THREE.Vector3(2.0, Y(D + pay / 2), 0), 'muted');
  if (W.stages) ctx.label(`${W.stages} frac stages in the lateral beyond (not drawn)`, new THREE.Vector3(-1.9, Y(D + pay / 2 + 50) - 0.4, 0), 'muted');
  const now = ctx.label('', new THREE.Vector3(1.9, 2.6, 0)), bhpL = ctx.label('', new THREE.Vector3(0.9, Y(D - 60), 0));
  const glL = ctx.label('lift gas in; it enters the tubing low down (valve depths not modelled)', new THREE.Vector3(3.2, 0.6, 0), 'muted');
  // the replay
  let pumping = false, ph = 0;
  K.on((dt) => { if (!pumping || ctx.reduced) return; ph += dt * 1.6; const a = Math.sin(ph); beam.rotation.z = a * 0.2; crank.rotation.z = -ph; rod.position.y = (rodTop + rodBot) / 2 + a * 0.35; });
  const set = (method, o, g, bhp, m) => {
    pumping = method === 'pump'; pumpG.visible = pumping; glG.visible = method === 'gas_lift';
    glL.el.style.visibility = method === 'gas_lift' ? '' : 'hidden';
    const mo = Math.max(1, ...(S?.oil_bbl_d || [1])), mg = Math.max(1, ...(S?.gas_mcf_d || [1]));
    oil.speed = o > 0 ? 0.03 + 0.2 * o / mo : 0; gas.speed = g > 0 ? 0.04 + 0.25 * g / mg : 0;
    oil.mesh.visible = o > 0; gas.mesh.visible = g > 0;
    gasDown.speed = method === 'gas_lift' ? 0.12 : 0;
    K.text(now, m == null ? 'No study yet' : `Month ${m}: ${NAME[method] || method}, ${n0(o)} bbl/d oil${o > 0 ? '' : ' (no flow: loaded up)'}`);
    K.text(bhpL, bhp == null ? '' : `bottom-hole ${n0(bhp)} psi`);
  };
  if (S?.month?.length) K.timeline(S.month.length, 12, (i) => set(S.method[i], S.oil_bbl_d[i], S.gas_mcf_d?.[i] || 0, S.bhp_psi?.[i], S.month[i]));
  else set('none', 0, 0, null, null);
  if (!ctx.framed) { ctx.framed = true; ctx.frame(new THREE.Box3(new THREE.Vector3(-5.2, Y(D + pay / 2 + 50) - 0.5, -1.2), new THREE.Vector3(4.2, 4.2, 1.2)), [0.35, 0.2, 1]); }
  const p = st?.plan;
  ctx.describe(S ? `Study ${(v.studies || []).length}: ${NAME[p?.method] || p?.method}${p?.method !== 'none' ? ` from month ${p?.switch_month}` : ''}, replayed month by month from the simulator. Moving dots are oil (amber) and gas (white). Depth broken at the zigzags; equipment drawn larger than scale.`
    : `The well to ${n0(D)} ft. Study a lift plan to watch it run month by month. Depth broken at the zigzags; equipment drawn larger than scale.`);
}
