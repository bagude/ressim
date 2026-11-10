// Flowback in 3D: the pad during flowback. Well, choke manifold, separator, stock tanks, the gas sales line and the flare.
// Driven by the latest month of view.series: oil, water and gas rates set how full each line runs; gas to sales is drawn
// against the takeaway limit (view.gas_takeaway_mcf_d), so a full sales line means you are at the limit; gas above it
// goes to the flare, and the flame is sized from series.flared_mcf_d. The tag on the well reads the bottom-hole pressure
// against the bubble point. Scale: 1 unit = 1 metre; the layout is schematic (see kit-pad.js for equipment sizes).
import { kit, n0 } from './kit-pad.js';

export function build(ctx, v) {
  ctx.K = kit(ctx); ctx.root = new ctx.THREE.Group(); ctx.stage.scene.add(ctx.root);
  ctx.stage.configure({ size: 70, fog: false });
  draw(ctx, v);
  ctx.frame(new ctx.THREE.Box3(new ctx.THREE.Vector3(-24, 0, -12), new ctx.THREE.Vector3(30, 6, 16)), [0.5, 0.55, 0.9]);
}
export function update(ctx, v) { draw(ctx, v); }

function draw(ctx, v) {
  const { K, root } = ctx, { mat } = K;
  K.reset(root);
  const S = v.series || {}, i = (S.month?.length || 0) - 1, at = (k) => (i >= 0 ? S[k]?.[i] : null);
  const oil = at('oil_bbl_d'), gas = at('gas_mcf_d'), wat = at('water_bbl_d'), flared = at('flared_mcf_d') || 0, bhp = at('bhp_psi');
  const pb = v.bubble_point_psi, cap = v.gas_takeaway_mcf_d || 0, sales = gas == null ? 0 : Math.max(0, gas - flared);
  K.ground(root, 64, 44);
  K.wellhead(root, [-22, 0]);
  K.add(root, new K.THREE.BoxGeometry(2.4, 1.2, 1.6), mat.red, [-13, 0.6, 0]);   // choke manifold skid (estimated)
  K.separator(root, [-1, 0]);
  K.tank(root, [12, -9]); K.tank(root, [17, -9]);
  K.tank(root, [12, 9], { m: mat.blue });                                         // produced-water tank
  const stack = K.flare(root, [24, 14]);
  K.add(root, new K.THREE.BoxGeometry(1.4, 1.4, 1.4), mat.yellow, [22, 0.7, 2]);  // gas sales meter run (estimated)
  // lines: well -> choke -> separator; separator -> oil tanks, water tank, gas sales (off the pad east), flare
  const inlet = K.pipe(root, [[-21.6, 0, 1.95], [-21, 0, 0.6], [-13, 0, 0.6], [-3, 0, 0.6]]);
  const oilL = K.pipe(root, [[0, -0.6], [0, -5], [12, -5], [12, -6.8, 0.6]]);
  const watL = K.pipe(root, [[0, 0.6], [0, 5], [12, 5], [12, 6.8, 0.6]]);
  const gasL = K.pipe(root, [[1.5, 0, 1.9], [1.5, 2, 1.9], [22, 2, 1.9], [32, 2, 1.9]], { r: 0.12 });
  const flL = K.pipe(root, [[22, 2.8, 1.9], [22, 14, 1.9], [23.8, 14, 1.9]], { r: 0.12 });
  if (oil != null) {
    const all = (oil || 0) + (wat || 0);
    K.flow(root, inlet, Math.min(1, all / 1000), mat.oil);                        // one bead per 25 bbl/d of liquid
    K.flow(root, oilL, Math.min(1, (oil || 0) / 1000), mat.oil);
    K.flow(root, watL, Math.min(1, (wat || 0) / 1000), mat.wat);
    if (cap) K.flow(root, gasL, sales / cap, mat.gas);                            // a full line = at the takeaway limit
    if (flared > 0) { K.flow(root, flL, Math.min(1, flared / Math.max(cap, 1)), mat.gas); K.flame(stack, 0.6 + 2.4 * Math.sqrt(Math.min(1, flared / Math.max(cap, 1)))); }
  }
  const V = (x, y, z) => new K.THREE.Vector3(x, y, z);
  if (bhp != null) K.label(`Bottom-hole ${n0(bhp)} psi${pb ? (bhp < pb ? `, below the ${n0(pb)} psi bubble point` : `, above the ${n0(pb)} psi bubble point`) : ''}`, `BHP ${n0(bhp)} psi${pb && bhp < pb ? ', below bubble pt' : ''}`, V(-22, 3.5, 0), bhp < pb ? 'warn' : '');
  if (oil != null) {
    K.label(`Oil ${n0(oil)} bbl/d`, null, V(14.5, 7, -9));
    K.label(`Water ${n0(wat)} bbl/d`, null, V(12, 7, 9), 'muted');
    K.label(`Gas to sales ${n0(sales)} of ${n0(cap)} Mcf/d takeaway`, `Gas ${n0(sales)} / ${n0(cap)} Mcf/d`, V(27, 2.5, 2), sales >= cap * 0.98 ? 'warn' : '');
    K.label(flared > 0 ? `Flaring ${n0(flared)} Mcf/d` : 'Flare: nothing flared', null, V(24, 14, 14), flared > 0 ? 'warn' : 'muted');
  } else K.label('Shut in: set the first month’s bottom-hole pressure', 'Shut in', V(-22, 3.5, 0));
  if (v.gas_price_usd_mcf != null && v.gas_price_usd_mcf <= 0) K.label(`Gas sells at −$${Math.abs(v.gas_price_usd_mcf).toFixed(2)}/Mcf`, `Gas −$${Math.abs(v.gas_price_usd_mcf).toFixed(2)}`, V(32, 2, 2), 'warn');
  ctx.describe(oil == null
    ? `The pad before flowback: well, choke, separator, oil and water tanks, the gas sales line and the flare. Nothing is flowing yet.`
    : `Month ${v.month}: the well flows ${n0(oil)} bbl/d of oil and ${n0(gas)} Mcf/d of gas at ${n0(bhp)} psi bottom-hole. ${n0(sales)} Mcf/d goes to sales against a ${n0(cap)} Mcf/d limit${flared > 0 ? `; ${n0(flared)} Mcf/d is flared` : ''}. Bead density shows each line's rate.`);
}
