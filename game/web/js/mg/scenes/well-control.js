// Kick! in 3D: the well from the BOP to the bit. Casing to the shoe (well.shoe_tvd_ft), open hole to the bit (depth_ft),
// drill pipe and collars (well.bha_length_ft), mud in the annulus. The influx sits at the bottom of the annulus with the
// volume the pits gained (shut_in.pit_gain_bbl, or the last reading), stacked with the annular capacities in the view.
// When the kill starts, the kill mud fills the string and then the annulus by the strokes pumped (pump[].strokes x
// pump_output_bbl_stk) and pushes the influx up ahead of it: volume bookkeeping only; gas expansion is not modelled
// (the server's hydrostatics are textbook). Depths are to scale; pipe and the BOP are drawn far wider than scale.
import { kit, depthMap, drawBreaks, n0, n1 } from './kit-wellbore.js';

export function build(ctx, v) { draw(ctx, v, null); }
export function update(ctx, v, prev) { draw(ctx, v, prev); }

function draw(ctx, v, prev) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const W = v.well || {}, TD = v.depth_ft || 10000, bha = W.bha_length_ft || 600, shoe = W.shoe_tvd_ft || TD * 0.6;
  // a broken depth axis: the wellhead, the shoe and the bottom of the hole at 150 ft per unit, the rest squeezed out
  const map = depthMap([[0, 300], [shoe - 250, shoe + 250], [TD - Math.max(900, bha + 400), TD]], { ftPerUnit: 200, gap: 1.0, td: TD });
  const Y = map.Y;
  const rHole = 1.0, rCsg = 1.08, rDP = 0.24, rDC = 0.4, rMud = 0.96;
  // rock behind the well, the shoe and the open hole
  const back = K.box(3.2, -Y(TD), 0.05, K.mats.rock, new THREE.Vector3(0, Y(TD) / 2, -1.25));
  back.renderOrder = -1;
  K.pipe(0, Y(shoe), rCsg, K.mats.casing, { cut: true });
  K.pipe(Y(shoe), Y(TD), rHole, K.mats.hole, { cut: true });
  K.box(rCsg * 2 + 0.3, 0.08, 0.3, K.mats.steel, new THREE.Vector3(0, Y(W.shoe_tvd_ft), -0.6));   // shoe marker
  // the string: drill pipe to the top of the collars, collars to the bit
  const pipeM = K.mats.casing;   // cut open (back half) so the mud inside the string shows
  K.pipe(2.6, Y(TD - bha), rDP, pipeM, { cut: true });
  K.pipe(Y(TD - bha), Y(TD) + 0.15, rDC, pipeM, { cut: true });
  K.pipe(2.6, Y(TD - bha), rDP * 0.8, new THREE.MeshStandardMaterial({ color: '#b39a78', roughness: 0.9 }));
  K.pipe(Y(TD - bha), Y(TD) + 0.15, rDC * 0.55, new THREE.MeshStandardMaterial({ color: '#b39a78', roughness: 0.9 }));
  const bit = new THREE.Mesh(new THREE.ConeGeometry(rDC * 1.15, 0.3, 16), K.mats.paint); bit.rotation.x = Math.PI; bit.position.y = Y(TD) + 0.15; K.add(bit);
  // fluids in the annulus (back half, so the string in front stays visible): mud, kill mud, influx
  const col = (color, opacity) => { const m = K.pipe(0, -1, rMud, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.9, depthWrite: false, side: THREE.DoubleSide }), { cut: true }); m.visible = false; return m; };
  const span = (m, dTop, dBot) => { if (!(dBot > dTop)) { m.visible = false; return; } m.visible = true; m.scale.y = Y(dTop) - Y(dBot); m.position.y = (Y(dTop) + Y(dBot)) / 2; };
  const mud = col('#7a6a55', 0.32); span(mud, 0, TD);
  const killA = col('#3f3226', 0.75), influx = col('#e6ebf0', 0.85);
  // kill mud inside the string: a thin core drawn just in front of the pipe axis
  const killS = new THREE.Mesh(new THREE.CylinderGeometry(rDP * 0.86, rDP * 0.86, 1, 12), new THREE.MeshStandardMaterial({ color: '#3f3226', roughness: 0.9 })); killS.visible = false; K.add(killS);
  // volumes: the annulus fills from the bottom (collars first), the string from the top (drill pipe first)
  const aDC = W.annular_capacity_dc_bbl_ft || 0.03, aDP = W.annular_capacity_dp_bbl_ft || 0.045, sDP = W.string_capacity_dp_bbl_ft || 0.018, sDC = W.string_capacity_dc_bbl_ft || 0.007;
  const annH = (V) => (V <= bha * aDC ? V / aDC : bha + (V - bha * aDC) / aDP);   // height above the bit holding V bbl
  const strD = (V) => { const dp = TD - bha; return V <= dp * sDP ? V / sDP : dp + (V - dp * sDP) / sDC; };
  const S = v.shut_in, R = v.readings || [], P = v.pump || [], out = W.pump_output_bbl_stk || 0.1;
  // the influx is drawn only once the well is shut in on a real kick: while drilling, pit readings are noisy and are the player's evidence
  const gain = S && v.phase !== 'drilling' ? S.pit_gain_bbl : 0;
  const strVol = (W.strokes_to_bit || 0) * out;
  const setStrokes = (st) => {
    const Vp = st * out, Vs = Math.min(Vp, strVol), Va = Math.max(0, Vp - strVol);
    if (Vs > 0) { const d = Math.min(TD, strD(Vs)); killS.visible = true; killS.scale.y = -Y(d); killS.position.set(0, Y(d) / 2, 0.02); } else killS.visible = false;
    span(killA, TD - annH(Va), TD);
    // the influx rides on top of whatever has been pushed into the annulus since the kill began
    const bottom = TD - annH(Va), top = TD - annH(Va + gain);
    if (gain > 0.2 && top > 0) span(influx, Math.max(0, top), bottom); else influx.visible = false;
    return { top, bottom };
  };
  const st1 = P.at(-1)?.strokes || 0, st0 = prev?.pump?.at(-1)?.strokes ?? st1;
  const pos = setStrokes(st1);
  if (st1 !== st0 && !ctx.reduced) { let t = 0; setStrokes(st0); K.on((dt) => { t = Math.min(1, t + dt / 2.5); setStrokes(st0 + (st1 - st0) * t); }); }
  // circulation while the pumps run (drilling, or circulating the kick out through the choke)
  const pumping = v.phase === 'drilling' || v.phase === 'pumping';
  const down = K.flow([new THREE.Vector3(0, 2.6, 0.25), new THREE.Vector3(0, Y(TD), 0.25)], { n: 50, color: '#b39a78', r: 0.07, speed: pumping ? 0.05 : 0 });
  const up = K.flow([new THREE.Vector3(0.55, Y(TD), 0.3), new THREE.Vector3(0.55, 0, 0.3)], { n: 50, color: '#b39a78', r: 0.07, speed: pumping ? 0.04 : 0 });
  if (!pumping) { down.mesh.visible = false; up.mesh.visible = false; }
  // the BOP stack above the wellhead, drawn wide (estimated proportions of a 13-5/8 in stack: annular on top of two rams)
  const shut = !!S && v.phase !== 'drilling';
  const stack = [['annular', 0.8, 1.5], ['pipe rams', 0.55, 1.9], ['blind rams', 0.55, 1.9]];
  let y = 0.05;
  for (const [name, h, w] of stack.slice().reverse()) {
    K.box(w, h, 1.1, name === 'annular' ? K.mats.paint : K.mats.red, new THREE.Vector3(0, y + h / 2, 0));
    if (name === 'pipe rams') for (const sgn of [-1, 1]) {        // ram blocks: open = pulled back, shut = against the pipe
      const ram = K.box(0.5, h * 0.7, 0.6, K.mats.dark, new THREE.Vector3(sgn * (shut ? rDP + 0.25 : w / 2 + 0.25), y + h / 2, 0.3));
      if (shut && !ctx.reduced && !prev?.shut_in) { const x1 = ram.position.x; ram.position.x = sgn * (w / 2 + 0.25); K.on((dt) => { ram.position.x += (x1 - ram.position.x) * Math.min(1, dt * 4); }); }
    }
    y += h + 0.04;
  }
  // choke line off the spool to the choke, with the casing gauge
  K.seg(new THREE.Vector3(0.9, 0.3, 0), new THREE.Vector3(2.6, 0.3, 0), 0.08, K.mats.steel);
  K.box(0.5, 0.5, 0.5, K.mats.steel, new THREE.Vector3(2.75, 0.3, 0));
  ctx.label(shut ? (P.length ? `casing ${n0(P.at(-1).casing_psi)} psi` : `SICP ${n0(S.sicp_psi)} psi`) : 'choke line', new THREE.Vector3(3.0, 0.6, 0), shut ? '' : 'muted');
  ctx.label(shut ? (P.length ? `drill pipe ${n0(P.at(-1).dpp_psi)} psi` : `SIDPP ${n0(S.sidpp_psi)} psi`) : 'standpipe', new THREE.Vector3(0.3, 2.7, 0), shut ? '' : 'muted');
  if (W.maasp_psi || v.answers?.maasp_psi) ctx.label(`MAASP ${n0(W.maasp_psi || v.answers.maasp_psi)} psi`, new THREE.Vector3(3.0, 1.2, 0), 'muted');
  ctx.label(shut ? 'BOP shut: pipe rams closed' : 'BOP open', new THREE.Vector3(1.1, y - 0.3, 0), shut ? 'warn' : 'muted');
  // depths
  drawBreaks(K, ctx, map, { w: 1.3, labelX: 1.9 });
  K.ruler(1.7, [{ y: 0, text: '' }, { y: Y(W.shoe_tvd_ft), text: `shoe ${n0(W.shoe_tvd_ft)} ft` }, { y: Y(TD), text: `bit ${n0(TD)} ft` }]);
  if (influx.visible) ctx.label(`influx, ${n1(gain)} bbl over ${n0(pos.bottom - Math.max(0, pos.top))} ft`, new THREE.Vector3(rMud + 0.1, Y((pos.top + pos.bottom) / 2), 0), 'warn');
  if (killS.visible || killA.visible) ctx.label(`kill mud ${n1(v.answers?.kmw_ppg)} ppg, ${n0(st1)} strokes pumped`, new THREE.Vector3(0.3, Y(Math.min(TD, strD(Math.min(st1 * out, strVol)))), 0.3));
  ctx.label(`mud ${n1(W.mw_ppg)} ppg`, new THREE.Vector3(rMud, Y(150), 0), 'muted');
  // frame once, then only when the well gets much deeper (it does not)
  const R2 = -Y(TD);
  if (!ctx.R || Math.abs(R2 - ctx.R) / ctx.R > 0.3) { ctx.frame(new THREE.Box3(new THREE.Vector3(-1.4, Y(TD) - 0.4, -1.3), new THREE.Vector3(4.6, y + 0.6, 1.3)), [0.5, 0.18, 1], !!ctx.R); ctx.R = R2; }
  const phase = { drilling: 'Drilling, mud circulating.', shut_in: 'Shut in, rams closed.', kill_sheet: 'Shut in while you work the kill sheet.', pumping: 'Pumping kill mud; it pushes the influx up to the choke.', finished: 'The job is over.' }[v.phase] || '';
  ctx.describe(`Well to ${n0(TD)} ft, casing to ${n0(W.shoe_tvd_ft)} ft. ${phase}${influx.visible ? ` Pale: the ${n1(gain)} bbl influx (expansion not shown).` : ''} Depth broken at the zigzags; pipe drawn wider than scale.`);
}
