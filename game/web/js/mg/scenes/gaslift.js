// Gas lift in 3D: the pad's wells side by side, a lift-gas header feeding each annulus, and what each well makes.
// Drives: total_lift_gas_mscf_d; wells[{id, depth_ft, tubing_id_in, net_pay_ft, gaslift{gas_mscf_d[], oil_stb_d[]}}];
// answers.gas_mscf_d once committed. Before that, the scene follows the allocation sliders as you move them (the
// player's own move) and reads each well's oil off its simulated lift-response curve, the same curve the 2D view plots.
// Gas (blue) goes down the annulus and joins the tubing low down (valve depths are not modelled); oil (amber) comes up
// at a pace set by the rate. Broken depth axis; pipe drawn far wider than scale.
import { kit, depthMap, drawBreaks, n0 } from './kit-wellbore.js';

const interp = (xs, ys, x) => { if (!xs?.length) return 0; if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]); } return ys.at(-1); };

export function build(ctx, v, S) { draw(ctx, v, S); }
export function update(ctx, v, prev, S) { draw(ctx, v, S); }

function draw(ctx, v, S) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const Wl = v.wells || [], n = Wl.length, gap = 3.2, x0 = -((n - 1) * gap) / 2;
  const D = Math.max(...Wl.map(w => w.depth_ft || 9000), 1000), pay = Math.max(...Wl.map(w => w.net_pay_ft || 100), 50);
  const map = depthMap([[0, 300], [D - 500, D + pay / 2 + 40]], { ftPerUnit: 120, gap: 1.0 }), Y = map.Y;
  const blue = new THREE.MeshStandardMaterial({ color: '#3d8be0', roughness: 0.5 });
  K.box(n * gap + 1, Y(D - pay / 2) - Y(D + pay / 2), 2, K.mats.pay, new THREE.Vector3(0, Y(D), 0));
  // the header along the pad, fed from the supply at the left
  const hx0 = x0 - 2, hx1 = x0 + (n - 1) * gap;
  K.seg(new THREE.Vector3(hx0, 0.5, 0.9), new THREE.Vector3(hx1, 0.5, 0.9), 0.1, blue);
  ctx.label(`lift-gas supply ${n0(v.total_lift_gas_mscf_d)} Mscf/d`, new THREE.Vector3(hx0, 0.9, 0.9), 'muted');
  const parts = Wl.map((w, i) => {
    const x = x0 + i * gap, d = w.depth_ft || D, rT = Math.max(0.14, 0.09 * (w.tubing_id_in || 2.5));
    K.pipe(0, Y(d + 20), 0.7, K.mats.casing, { cut: true, x });
    K.pipe(1.0, Y(d - 80), rT, K.mats.casing, { cut: true, x });
    const tr = K.tree(0, 0.42); tr.position.x = x;
    K.seg(new THREE.Vector3(x, 0.5, 0.9), new THREE.Vector3(x, 0.5, 0.35), 0.07, blue);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(rT * 1.4, rT * 1.4, 0.3, 12), blue); valve.position.set(x, Y(d - 250), 0); K.add(valve);
    const gasDown = K.flow([new THREE.Vector3(x, 0.5, 0.9), new THREE.Vector3(x + 0.45, 0.3, 0.3), new THREE.Vector3(x + 0.45, Y(d - 250), 0.3), new THREE.Vector3(x + 0.05, Y(d - 250), 0.3)], { n: 30, color: '#7fb6f0', r: 0.06 });
    const gasUp = K.flow([new THREE.Vector3(x + 0.05, Y(d - 250), 0.1), new THREE.Vector3(x + 0.05, 0.9, 0.1)], { n: 20, color: '#cfe3fa', r: rT * 0.35 });
    const oil = K.flow([new THREE.Vector3(x - 0.03, Y(d - 80), 0.05), new THREE.Vector3(x - 0.03, 0.9, 0.05), new THREE.Vector3(x + 1.2, 0.9, 0.05)], { n: 36, color: '#c98322', r: rT * 0.45 });
    const L = ctx.label('', new THREE.Vector3(x - 0.2, 2.2, 0));
    ctx.label(`${w.tubing_id_in} in tubing`, new THREE.Vector3(x + 0.2, Y(d - 80), 0), 'muted');
    return { w, gasDown, gasUp, oil, L };
  });
  drawBreaks(K, ctx, map, { x: x0 + (n - 1) * gap, w: 0.9, labelX: x0 + (n - 1) * gap + 1.0 });
  ctx.label(`pay, about ${n0(pay)} ft`, new THREE.Vector3(x0 + (n - 1) * gap + 1.0, Y(D + pay / 2), 0), 'muted');
  const tot = ctx.label('', new THREE.Vector3(hx0, 3.0, 0));
  const maxOil = Math.max(1, ...Wl.flatMap(w => w.gaslift?.oil_stb_d || [0])), maxGas = Math.max(1, v.total_lift_gas_mscf_d || 1);
  const show = (alloc) => {
    let used = 0, sum = 0;
    parts.forEach((p, i) => {
      const g = alloc[i] || 0, o = interp(p.w.gaslift?.gas_mscf_d, p.w.gaslift?.oil_stb_d, g);
      used += g; sum += o;
      p.gasDown.speed = g > 0 ? 0.05 + 0.25 * g / maxGas : 0; p.gasDown.mesh.visible = g > 0;
      p.gasUp.speed = g > 0 ? 0.1 + 0.4 * g / maxGas : 0; p.gasUp.mesh.visible = g > 0;
      p.oil.speed = o > 0 ? 0.04 + 0.25 * o / maxOil : 0; p.oil.mesh.visible = o > 0;
      K.text(p.L, `${p.w.id}: ${n0(g)} Mscf/d, ${o > 0 ? `${n0(o)} stb/d` : 'no flow'}`);
    });
    K.text(tot, `${v.answers ? 'Committed' : 'Your split'}: ${n0(used)} of ${n0(v.total_lift_gas_mscf_d)} Mscf/d${used > (v.total_lift_gas_mscf_d || Infinity) ? ' (over the supply)' : ''}, about ${n0(sum)} stb/d`);
    ctx.describe(`${n} wells on one lift-gas supply. Blue: lift gas going down each annulus; amber: oil coming up, faster for more oil (read off each well's simulated response curve). ${v.answers ? 'Your committed split.' : 'Moves with the sliders.'} Depth broken at the zigzags; pipe drawn wider than scale.`);
  };
  const spec = (S?.actions || []).find(a => a.name === 'allocate')?.args?.gas_mscf_d;
  const alloc = (v.answers?.gas_mscf_d || spec?.default || Wl.map(() => 0)).slice();
  show(alloc);
  if (!v.answers) {   // follow the sliders: the field renderer labels each one "Lift gas for <id>"
    const on = (e) => { const lab = e.target?.getAttribute?.('aria-label') || ''; const m = lab.match(/^Lift gas for (.+)$/); if (!m) return; const i = Wl.findIndex(w => w.id === m[1]); if (i < 0) return; alloc[i] = +e.target.value; show(alloc); };
    document.addEventListener('input', on); ctx.offs.push(() => document.removeEventListener('input', on));
  }
  if (!ctx.framed) { ctx.framed = true; ctx.frame(new THREE.Box3(new THREE.Vector3(hx0 - 0.5, Y(D + pay / 2 + 40) - 0.4, -1), new THREE.Vector3(hx1 + 2.5, 3.2, 1.2)), [0.25, 0.25, 1]); }
}
