// Water in 3D: the month's water system. The frac pad (wells this month from view.schedule) draws fresh water from the
// pond and recycled water from the treatment unit; produced water from the producing wells goes to treatment, the
// storage pit, your disposal (SWD) well, or off the lease to commercial disposal. Every line is driven by the last
// month in view.history (fresh_bbl, recycled_bbl, swd_injected_bbl, commercial_disposal_bbl, short_bbl, overflow_bbl);
// bead density is the month's volume against the larger of that month's frac demand and produced water. The pit fills to
// view.storage_bbl / storage_cap_bbl. Recycled water rides trucks or the pipeline (view.history.transport,
// view.pipeline.installed); each truck drawn stands for up to 100,000 bbl moved that month.
// Scale: 1 unit = 1 metre. Not to scale: a real frac pond or pit is far larger than drawn; the layout is schematic.
import { kit, kbbl } from './kit-pad.js';

export function build(ctx, v) {
  ctx.K = kit(ctx); ctx.root = new ctx.THREE.Group(); ctx.stage.scene.add(ctx.root);
  ctx.stage.configure({ size: 110, fog: false });
  draw(ctx, v);
  ctx.frame(new ctx.THREE.Box3(new ctx.THREE.Vector3(-46, 0, -32), new ctx.THREE.Vector3(58, 3, 32)), [0.3, 0.85, 0.75]);
}
export function update(ctx, v) { draw(ctx, v); }

function draw(ctx, v) {
  const { K, root } = ctx, { mat, THREE } = K, V = (x, y, z) => new THREE.Vector3(x, y, z);
  K.reset(root);
  const H = v.history || [], last = H.at(-1), sched = (v.schedule || []).find(s => s.month === (last?.month ?? v.month)) || {};
  K.ground(root, 112, 74, mat.dirt);
  // frac pad: the wells being fracked this month, and a row of frac tanks (500 bbl, ~8 x 45 ft, estimated)
  const pad = new THREE.Group(); pad.position.set(-32, 0, 0); root.add(pad);
  K.add(pad, new THREE.BoxGeometry(26, 0.35, 40), mat.gravel, [0, 0.0, 0], false);
  for (let i = 0; i < (sched.wells || 0); i++) K.wellhead(pad, [-8, -10 + i * 6]);
  for (let i = 0; i < 6; i++) K.add(pad, new THREE.BoxGeometry(13.7, 3, 2.4), mat.paint, [5, 1.5, -15 + i * 3.2]);
  const pond = K.pit(root, [-14, -24], 26, 14, 3, mat.water);           // fresh-water pond
  pond.userData.level(last ? 1 : 0.85);                                  // the source; its own level is not modelled
  const treat = new THREE.Group(); treat.position.set(10, 0, 0); root.add(treat);
  K.add(treat, new THREE.BoxGeometry(12, 3.2, 3), mat.blue, [0, 1.6, 0]);   // treatment trailer (estimated)
  const pit = K.pit(root, [12, 24], 24, 14, 3, mat.brine);
  pit.userData.level(v.storage_cap_bbl ? (v.storage_bbl || 0) / v.storage_cap_bbl : 0);
  const prod = new THREE.Group(); prod.position.set(40, 0, -16); root.add(prod);
  for (const [x, z] of [[-4, 0], [4, 0]]) K.tank(prod, [x, z], { m: mat.blue });  // produced-water tanks at the battery
  K.wellhead(root, [44, 18]);                                                    // your disposal well
  K.add(root, new THREE.BoxGeometry(4, 1.6, 2), mat.yellow, [38, 0.8, 18]);     // injection pump skid (estimated)
  // lines
  const fresh = K.pipe(root, [[-14, -16.5], [-14, -8], [-19, -8]], { y: 0.4 });
  const piped = !!v.pipeline?.installed || last?.transport === 'pipeline';
  const recyc = K.pipe(root, [[4, 0], [-19, 0]], { y: 0.4, r: piped ? 0.14 : 0.02, m: piped ? mat.steel : mat.dark });
  const toTreat = K.pipe(root, [[36, -16], [26, -16], [26, 0], [16, 0]], { y: 0.4 });
  const toPit = K.pipe(root, [[40, -12], [40, 8], [24, 8], [24, 17]], { y: 0.4 });
  const toSwd = K.pipe(root, [[44, -12], [44, 16.5]], { y: 0.4 });
  const toCom = K.pipe(root, [[48, -16], [58, -16]], { y: 0.4, r: 0.02, m: mat.dark });
  const ref = Math.max(sched.demand_bbl || 0, last?.produced_bbl || 0, 1), share = (x) => (x || 0) / ref;
  if (last) {
    K.flow(root, fresh, share(last.fresh_bbl), mat.fresh);
    K.flow(root, recyc, share(last.recycled_bbl), mat.wat);
    K.flow(root, toTreat, share(last.recycled_bbl), mat.wat);
    K.flow(root, toSwd, share(last.swd_injected_bbl), mat.wat);
    K.flow(root, toCom, share(last.commercial_disposal_bbl), mat.wat);
    const dS = (last.storage_end_bbl || 0) - (H.at(-2)?.storage_end_bbl || 0);
    if (dS > 0) K.flow(root, toPit, share(dS), mat.wat);
    // trucks on the recycled-water route when there is no pipeline
    if (!piped && last.recycled_bbl > 0) {
      const nT = Math.min(6, Math.ceil(last.recycled_bbl / 100000));
      for (let i = 0; i < nT; i++) {
        const t = K.truck(root); t.scale.setScalar(0.8); t.position.set(2 - (i / nT) * 22, 0, 3.2);
        if (!ctx.reduced) { const ph = i / nT; K.tick((dt, tt) => { t.position.x = 2 - ((tt * 0.05 + ph) % 1) * 22; }); }
      }
    }
    // commercial disposal leaves by truck, off the lease
    if (last.commercial_disposal_bbl > 0) { const t = K.truck(root, '#8f5e1c'); t.scale.setScalar(0.8); t.position.set(56, 0, -19.5); }
  }
  // labels
  const L = (t, p, c = '', sh) => K.label(t, sh, p, c);
  const short = last?.short_bbl > 0;
  L(last ? `Frac crew needed ${kbbl(last.demand_bbl)}, used ${kbbl(last.used_bbl)}${short ? `: ${kbbl(last.short_bbl)} short` : ''}` : `Month ${v.month}: ${sched.wells ?? 0} well${sched.wells === 1 ? '' : 's'} to frac, ${kbbl(sched.demand_bbl)} needed`, V(-32, 6, -20), short ? 'warn' : '', short ? `Frac ${kbbl(last.short_bbl)} short` : last ? `Frac ${kbbl(last.used_bbl)}` : `Frac ${kbbl(sched.demand_bbl)} needed`);
  if (last) {
    L(`Fresh ${kbbl(last.fresh_bbl)}`, V(-14, 3, -24), '', `Fresh ${kbbl(last.fresh_bbl)}`);
    L(`Recycled ${kbbl(last.recycled_bbl)}${piped ? ' by pipeline' : ' by truck'}`, V(-4, 4, 0), '', `Recycled ${kbbl(last.recycled_bbl)}`);
    L(`Your disposal well ${kbbl(last.swd_injected_bbl)} of ${kbbl(v.swd?.capacity_bbl_month)}${v.swd?.cut ? ': cut by the regulator' : ''}`, V(44, 4, 18), v.swd?.cut ? 'warn' : '', `SWD ${kbbl(last.swd_injected_bbl)}${v.swd?.cut ? ', cut' : ''}`);
    L(`Produced ${kbbl(last.produced_bbl)}`, V(40, 8, -16), '', `Produced ${kbbl(last.produced_bbl)}`);
    if (last.commercial_disposal_bbl > 0) L(`Commercial disposal ${kbbl(last.commercial_disposal_bbl)}`, V(56, 4, -16), '', `Commercial ${kbbl(last.commercial_disposal_bbl)}`);
    if (last.overflow_bbl > 0) L(`Pit overflowed: ${kbbl(last.overflow_bbl)} lost`, V(12, 5, 30), 'warn', `Overflow ${kbbl(last.overflow_bbl)}`);
  }
  L(`Pit ${kbbl(v.storage_bbl)} of ${kbbl(v.storage_cap_bbl)}`, V(12, 4, 24), '', `Pit ${kbbl(v.storage_bbl)}`);
  ctx.describe(last
    ? `Month ${last.month}: the frac crew needed ${kbbl(last.demand_bbl)} and got ${kbbl(last.used_bbl)}, ${kbbl(last.fresh_bbl)} fresh and ${kbbl(last.recycled_bbl)} recycled. Of ${kbbl(last.produced_bbl)} produced water, ${kbbl(last.swd_injected_bbl)} went down your disposal well${last.commercial_disposal_bbl > 0 ? ` and ${kbbl(last.commercial_disposal_bbl)} to commercial disposal` : ''}; the pit holds ${kbbl(v.storage_bbl)}. Bead density shows volume. Not to scale.`
    : `The water system before month 1: the frac pad, the fresh-water pond, the treatment unit, the storage pit, your disposal well and the producing wells' tanks. Plan the month to see the water move. Not to scale.`);
}
