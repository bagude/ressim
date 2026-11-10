// Well test in 3D: the horizontal well in its pay with its fractures, a gauge at the heel, and the latest test replayed:
// the flow period (oil moving to the heel at the test rate) then the shut-in (valve closed, nothing moving) while the
// gauge reads the buildup. Drives: well {lateral_ft, stages, stage_spacing_ft, half_length_ft, net_pay_ft,
// initial_pressure_psi}; tests[-1] {rate_stb_d, flow_days, shut_days, flow {days[], pressure_psi[], rate_stb_d[]},
// hours[], pressure_psi[]}. The fractures are tinted by the gauge's drawdown (one number for the whole well: the model
// has one pressure at the wellbore, not a map). Lateral, fractures and pay to scale at 50 ft per unit; the vertical
// section above the heel is not drawn and the pipe is drawn wider than scale. The replay steps through the record,
// which is logged densely at early times, so early hours pass slowly.
import { kit, n0, n1 } from './kit-wellbore.js';

export function build(ctx, v) { draw(ctx, v); }
export function update(ctx, v) { draw(ctx, v); }

function draw(ctx, v) {
  const K = kit(ctx), { THREE } = K;
  K.reset();
  const W = v.well || {}, U = 50, Lat = (W.lateral_ft || 4620) / U, xf = (W.half_length_ft || 300) / U, hp = (W.net_pay_ft || 100) / U;
  const ns = W.stages || 15, sp = (W.stage_spacing_ft || (W.lateral_ft || 4620) / ns) / U;
  const pi = W.initial_pressure_psi || 5000;
  // the pay and the lateral (heel at x = 0, toe at +Lat)
  const payM = new THREE.MeshStandardMaterial({ color: '#9a8a62', transparent: true, opacity: 0.16, depthWrite: false, roughness: 1 });
  const payB = K.box(Lat + 6, hp, xf * 2 + 6, payM, new THREE.Vector3(Lat / 2, 0, 0));
  K.add(new THREE.LineSegments(new THREE.EdgesGeometry(payB.geometry), new THREE.LineBasicMaterial({ color: '#9a8a62', transparent: true, opacity: 0.6 }))).position.copy(payB.position);
  K.seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Lat, 0, 0), 0.35, K.mats.casing);
  // the bend up to the vertical section, cut short
  const bend = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-2.5, 0.6, 0), new THREE.Vector3(-3.6, 3, 0), new THREE.Vector3(-3.7, 8, 0)]);
  K.add(new THREE.Mesh(new THREE.TubeGeometry(bend, 40, 0.35, 12), K.mats.casing));
  ctx.label('to surface (vertical section not drawn)', new THREE.Vector3(-3.7, 8, 0), 'muted');
  // fractures: one plane per stage, both wings, full pay height
  const fracMat = new THREE.MeshStandardMaterial({ color: '#f0a53a', emissive: '#5a3608', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  for (let i = 0; i < ns; i++) {
    const x = Lat - (i + 0.5) * sp; if (x < 0) break;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(xf * 2, hp * 0.96), fracMat); f.position.set(x, 0, 0); f.rotation.y = Math.PI / 2; K.add(f);
  }
  // the gauge at the heel
  K.box(0.9, 0.5, 0.5, K.mats.paint, new THREE.Vector3(-0.8, 0.25, 0.35));
  const gauge = ctx.label('', new THREE.Vector3(-0.8, 0.9, 0.4));
  // oil flowing to the heel and up
  const oil = K.flow([new THREE.Vector3(Lat, 0, 0.05), new THREE.Vector3(0, 0, 0.05), ...bend.getPoints(12).map(p => p.setZ(0.05))], { n: 60, color: '#c98322', r: 0.16 });
  ctx.label(`${ns} stages, fractures ${n0(W.half_length_ft)} ft each way`, new THREE.Vector3(Lat * 0.6, hp / 2 + 0.3, xf), 'muted');
  ctx.label(`pay ${n0(W.net_pay_ft)} ft`, new THREE.Vector3(Lat + 3, -hp / 2, xf + 3), 'muted');
  const T = (v.tests || []).at(-1);
  if (T) {
    // one record: the flow period, then the shut-in measured from the start of the test
    const fd = T.flow?.days || [], fp = T.flow?.pressure_psi || [], fr = T.flow?.rate_stb_d || [];
    const rec = [...fd.map((d, i) => ({ d, p: fp[i], q: fr[i] ?? T.rate_stb_d, shut: false })), ...(T.hours || []).map((hh, i) => ({ d: T.flow_days + hh / 24, hh, p: T.pressure_psi[i], q: 0, shut: true }))];
    const pmin = Math.min(...rec.map(r => r.p)), qmax = Math.max(1, ...rec.map(r => r.q));
    const c0 = new THREE.Color('#f0a53a'), c1 = new THREE.Color('#e8806f');
    K.timeline(rec.length, 12, (i) => {
      const r = rec[i];
      oil.speed = r.q > 0 ? 0.03 + 0.12 * r.q / qmax : 0; oil.mesh.visible = r.q > 0;
      fracMat.color.copy(c0).lerp(c1, Math.max(0, Math.min(1, (pi - r.p) / Math.max(1, pi - pmin))));
      K.text(gauge, r.shut ? `shut in ${r.hh < 24 ? `${n1(r.hh)} h` : `${n1(r.hh / 24)} days`}: ${n0(r.p)} psi` : `flowing ${r.d < 1 ? `${n1(r.d * 24)} h` : `${n1(r.d)} days`} at ${n0(r.q)} stb/d: ${n0(r.p)} psi`);
    }, { hold: 2.5 });
  } else { oil.speed = 0.05; K.text(gauge, `producing, initial pressure was ${n0(pi)} psi`); }
  if (!ctx.framed) { ctx.framed = true; ctx.frame(new THREE.Box3(new THREE.Vector3(-4.5, -hp / 2 - 0.5, -xf - 3), new THREE.Vector3(Lat + 3, 8.5, xf + 3)), [-0.35, 0.55, 1]); }
  ctx.describe(T ? `Test ${(v.tests || []).length} replayed: ${n1(T.flow_days)} days flowing at ${n0(T.rate_stb_d)} stb/d, then ${n1(T.shut_days)} days shut in while the heel gauge reads the buildup. Fractures redden with the drawdown. To scale except the pipe.`
    : `The horizontal well and its ${ns} fractures in the pay, producing. Run a test to replay it here. To scale except the pipe.`);
}
