// Rig contracts in 3D: the drilling programme as a field of well slots, one per well in view.target_wells, grouped
// five to a pad (the grouping is schematic). Drilled wells (view.wells_drilled) carry a wellhead; the rest are survey
// stakes. Each rig in view.fleet stands on the next undrilled pads, labelled term or spot with its day rate. When last
// month's utilisation (view.utilisation.used) was below the rigs contracted, the surplus rigs are drawn with the mast
// laid down: on standby, paid but not drilling. Newly drilled wells rise after each month.
// Scale: 1 unit = 1 metre (rig mast ~142 ft, see kit-pad.js); pad spacing is compressed for legibility.
import { kit, n0 } from './kit-pad.js';

const PER = 5, DX = 60, DZ = 48, COLS = 5;

export function build(ctx, v) {
  ctx.K = kit(ctx); ctx.root = new ctx.THREE.Group(); ctx.stage.scene.add(ctx.root);
  draw(ctx, v, null);
}
export function update(ctx, v, prev) { draw(ctx, v, prev); }

function draw(ctx, v, prev) {
  const { K, root } = ctx, { mat, THREE } = K, Vc = (x, y, z) => new THREE.Vector3(x, y, z);
  K.reset(root);
  const N = v.target_wells || 0, pads = Math.ceil(N / PER), rows = Math.ceil(pads / COLS);
  const padXZ = (p) => [(p % COLS - (COLS - 1) / 2) * DX, (Math.floor(p / COLS) - (rows - 1) / 2) * DZ];
  const W = (COLS - 1) * DX + 50, D = (rows - 1) * DZ + 40;
  K.ground(root, W, D, mat.dirt);
  const done = Math.floor(v.wells_drilled || 0), before = prev ? Math.floor(prev.wells_drilled || 0) : done;
  for (let p = 0; p < pads; p++) {
    const [x, z] = padXZ(p);
    K.add(root, new THREE.BoxGeometry(34, 0.3, 14), mat.gravel, [x, 0, z], false);
  }
  // slots: wellheads for drilled wells, stakes for the rest (instanced: up to a few hundred)
  const stake = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 2.5, 8), mat.yellow, Math.max(1, N - done));
  const head = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.6, 5, 12), mat.green, Math.max(1, done));
  stake.count = Math.max(0, N - done); head.count = done; root.add(stake, head); head.castShadow = true;
  const o = new THREE.Object3D(), slot = (i) => { const [x, z] = padXZ(Math.floor(i / PER)); return [x - 12 + (i % PER) * 6, z]; };
  let si = 0;
  const fresh = [];
  for (let i = 0; i < N; i++) {
    const [x, z] = slot(i);
    if (i < done) { o.position.set(x, 2.5, z); o.scale.set(1, 1, 1); o.updateMatrix(); head.setMatrixAt(i, o.matrix); if (i >= before) fresh.push(i); }
    else { o.position.set(x, 1.25, z); o.scale.set(1, 1, 1); o.updateMatrix(); stake.setMatrixAt(si++, o.matrix); }
  }
  if (fresh.length && !ctx.reduced) {   // the month's new wells rise out of the ground
    let t = 0; const off = K.tick((dt) => {
      t = Math.min(1, t + dt / 1.2);
      for (const i of fresh) { const [x, z] = slot(i); o.position.set(x, 2.5 * t, z); o.scale.set(1, Math.max(0.02, t), 1); o.updateMatrix(); head.setMatrixAt(i, o.matrix); }
      head.instanceMatrix.needsUpdate = true; if (t >= 1) off();
    });
  }
  // rigs on the next undrilled pads; surplus rigs (used < contracted last month) on standby, mast down
  const fleet = v.fleet || [], U = v.utilisation || {}, k = (U.month?.length || 0) - 1;
  const idle = k >= 0 ? Math.max(0, Math.round((U.contracted[k] || 0) - (U.used[k] || 0))) : 0;
  const firstPad = Math.floor(done / PER);
  fleet.forEach((r, i) => {
    const p = Math.min(pads - 1, firstPad + i), [x, z] = padXZ(p), standby = i >= fleet.length - idle;
    K.rig(root, [x + 10, z - 2], { color: r.type === 'spot' ? '#3d6f9e' : '#c94f3a', idle: standby });
    K.label(`${r.id}, ${r.type}${r.type === 'term' ? ` to month ${r.until_month}` : ''}, $${n0(r.usd_day)}/day${standby ? ': on standby' : ''}`, `${r.id} ${r.type}${standby ? ', standby' : ''}`, Vc(x + 10, standby ? 14 : 50, z - 2), standby ? 'warn' : '');
  });
  const behind = v.month > 1 && fleet.length === 0;
  K.label(`${(v.wells_drilled || 0).toFixed(1)} of ${N} wells drilled, month ${Math.min(v.month, v.months)} of ${v.months}`, `${(v.wells_drilled || 0).toFixed(1)} / ${N} wells`, Vc(-W / 2 + 10, 8, -D / 2), behind ? 'warn' : '');
  ctx.stage.configure({ size: Math.max(W, D), fog: false });
  const R = Math.max(W, D);
  if (!ctx.R || Math.abs(R - ctx.R) / ctx.R > 0.3) { ctx.frame(new THREE.Box3(Vc(-W / 2, 0, -D / 2), Vc(W / 2, 48, D / 2)), [0.3, 0.42, 0.9], !!ctx.R); ctx.R = R; }
  ctx.describe(`${(v.wells_drilled || 0).toFixed(1)} of ${N} wells drilled by month ${Math.min(v.month, v.months)}, five to a pad. ${fleet.length ? `${fleet.length} rig${fleet.length > 1 ? 's' : ''} on location: ${fleet.map(r => `${r.id} (${r.type}, $${n0(r.usd_day)} a day)`).join(', ')}${idle ? `; ${idle} on standby last month` : ''}.` : 'No rig under contract.'} Green heads are drilled wells; yellow stakes are still to drill.`);
}
