// Frac tree, 7-1/16" bore, 15,000 psi: the hero asset. Built bottom to top as separate parts so it can explode.
//
// Dimensions and their status. "sourced" means read from a published sheet (see docs/sources.md); "estimate" means
// sized by eye from photographs and stated as such on the part card.
//   7-1/16" 15K 6BX flange OD 19-7/8"                       sourced (supplier API 6A table)
//   16 studs, 1-1/2" diameter, 13" long                      sourced (supplier API 6A table; IKM datasheet: 16 holes)
//   bolt circle 16-7/8"                                      partly sourced (table column unclear) - shown as approx.
//   BX-156 ring and groove dimensions                        sourced (TME BX ring data sheet)
//   gate valve face-to-face ~35"                              partly sourced (unlabelled manufacturer table)
//   1-1/2" heavy hex nut, 2-3/8" across flats                sourced (ASME B18.2.2 heavy hex)
//   flange thickness, valve face-to-face, body block size    estimate
import * as THREE from 'three';
import { IN, lathe, box, mesh, studRing, merge, tagFlat } from '../engine/kit.js';

const F = {                       // 7-1/16" 15K 6BX flange, inches
  bore: 7.0625, od: 19.875, bc: 16.875, studs: 16, studDia: 1.5, studLen: 13, nutAF: 2.375, nutH: 1.5, holeDia: 1.65,
  thick: 4.06,                    // estimate
  hubR: 6.9, neck: 2.5,           // estimate: hub radius where the flange meets the body
  ftf: 35,                        // gate valve face-to-face: about 35 in for 7-1/16" 15K (unlabelled manufacturer table, unconfirmed)
  // BX-156 groove (TME data sheet): groove OD G = 9.521, width N = 0.921, depth E = 0.44 -> radii 3.84..4.76
  groove: [3.84, 4.76], grooveDepth: 0.44,
  ring: { od: 9.367, h: 0.733, w: 0.733 },   // BX-156 ring (TME data sheet)
};
const W = {                       // 3-1/16" 15K wing outlet flange (estimate, scaled from the same table)
  ring: { od: 4.5, h: 0.5, w: 0.5 },
  bore: 3.0625, od: 14.19, bc: 11.31, studs: 8, studDia: 1.375, studLen: 11.5, nutAF: 2.1875, nutH: 1.375, thick: 3.12,
  hubR: 4.2, neck: 1.8, groove: [1.9, 2.3], grooveDepth: 0.35,
};
const i = (v) => v * IN;

// Flange with its sealing face at y = 0 facing down and the body side going up. Built from two pieces:
//   plate: an extruded disc with the real bolt holes drilled through it (bevelled, so edges catch light)
//   core:  a lathe for the raised centre with the ring groove, plus the hub that runs up into the body
function flangeGeo(f, faceUp = false) {
  const rb = i(f.bore / 2), ro = i(f.od / 2), T = i(f.thick), rh = i(f.hubR), g1 = i(f.groove[0]), g2 = i(f.groove[1]);
  const gd = i(f.grooveDepth), nk = i(f.neck), bev = i(0.14), rc = g2 + i(0.4);
  const shape = new THREE.Shape(); shape.absarc(0, 0, ro - bev, 0, Math.PI * 2, false);
  const inner = new THREE.Path(); inner.absarc(0, 0, rc + bev, 0, Math.PI * 2, true); shape.holes.push(inner);
  const hr = i((f.holeDia || f.studDia + 0.125) / 2) + bev;
  for (let k = 0; k < f.studs; k++) {
    const a = (k + 0.5) * Math.PI * 2 / f.studs;
    const h = new THREE.Path(); h.absarc(Math.cos(a) * i(f.bc / 2), -Math.sin(a) * i(f.bc / 2), hr, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const plate = new THREE.ExtrudeGeometry(shape, { depth: T - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev,
    bevelSegments: 3, curveSegments: 96 });
  plate.translate(0, 0, bev); plate.rotateX(-Math.PI / 2);
  const pn = plate.attributes.normal, edge = new Float32Array(pn.count);
  for (let k = 0; k < pn.count; k++) { const ny = Math.abs(pn.getY(k)); edge[k] = ny > 0.08 && ny < 0.96 ? 1 : 0; }
  plate.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  plate.setAttribute('aCavity', new THREE.BufferAttribute(new Float32Array(pn.count), 1));
  const core = lathe([[rb, 0], [g1, 0], [g1, gd], [g2, gd], [g2, 0], [rc + i(0.05), 0], [rc + i(0.05), T], [rh + i(0.6), T],
    [rh, T + nk], [rb, T + nk], [rb, 0]], { segments: 96, radius: i(0.08) });
  const g = merge([plate, core]);
  if (faceUp) g.rotateX(Math.PI);
  return g;
}

// ring gasket BX: octagonal section
function bxRing(f, mat) {
  // octagonal BX section from the ring's real OD, height and width; it sits half in each groove
  const ro = i(f.ring.od / 2), w = i(f.ring.w), h = i(f.ring.h), r0 = ro - w, c = w * 0.2;
  const g = lathe([[r0 + c, -h / 2], [ro - c, -h / 2], [ro, -h / 2 + c], [ro, h / 2 - c], [ro - c, h / 2], [r0 + c, h / 2],
    [r0, h / 2 - c], [r0, -h / 2 + c], [r0 + c, -h / 2]], { segments: 96, radius: i(0.03), arcSteps: 1 });
  return mesh(g, mat);
}

function studsFor(f, y, M, phase = 0) {
  return studRing({
    count: f.studs, boltCircle: i(f.bc), studDia: i(f.studDia), studLen: i(f.studLen), nutAF: i(f.nutAF), nutH: i(f.nutH),
    y0: y, matStud: M.stud, matNut: M.nut, phase,
  });
}

// a part is a Group with a card and an explode offset (metres, applied as offset * explode)
function part(id, card, explode) {
  const g = new THREE.Group();
  g.name = id;
  g.userData = { id, card, explode: new THREE.Vector3(...explode), home: new THREE.Vector3() };
  return g;
}

// Gate valve with flanges top and bottom. Operator: 'hand' (handwheel) or 'hyd' (hydraulic actuator).
function gateValve(M, { ftf = F.ftf, operator = 'hand', paint = M.treePaint } = {}) {
  const g = new THREE.Group();
  const H = i(ftf);
  const bf = mesh(flangeGeo(F, false), paint); g.add(bf);
  const tf = mesh(flangeGeo(F, true), paint); tf.position.y = H; g.add(tf);
  // machined faces: thin discs that carry the machined material on the sealing faces
  for (const [y, up] of [[-0.0004, false], [H + 0.0004, true]]) {
    const face = mesh(tagFlat(new THREE.RingGeometry(i(F.groove[1] + 0.1), i(F.od / 2 - 0.3), 96)
      .rotateX(up ? -Math.PI / 2 : Math.PI / 2)), M.machined);
    face.position.y = y; g.add(face);
  }
  // forged body block between the necks
  const bodyH = H - 2 * i(F.thick + F.neck) + i(1.2);
  const body = mesh(box(i(15.5), bodyH, i(16.5), i(1.1), 4), paint);
  body.position.y = H / 2; g.add(body);
  // bonnet on +x: a lathe around the stem axis, bolted with its own small stud ring
  const bon = new THREE.Group();
  const bprof = [[0, 0], [i(6.6), 0], [i(6.6), i(2.4)], [i(4.4), i(2.9)], [i(3.6), i(7.5)], [i(1.6), i(8.4)], [i(1.6), i(10.4)], [0, i(10.4)]];
  const bonnet = mesh(lathe(bprof, { segments: 64, radius: i(0.25) }), paint);
  bon.add(bonnet);
  const bs = studRing({ count: 8, boltCircle: i(10.6), studDia: i(1), studLen: i(4.6), nutAF: i(1.625), nutH: i(1),
    y0: i(1.0), matStud: M.stud, matNut: M.nut, phase: Math.PI / 8 });
  bon.add(bs);
  // stem
  const stem = mesh(lathe([[0, 0], [i(0.9), 0], [i(0.9), i(6.5)], [0, i(6.5)]], { segments: 24, radius: i(0.08) }), M.machined);
  stem.position.y = i(10.4); bon.add(stem);
  if (operator === 'hand') {
    const hw = handwheel(M, i(22));
    hw.position.y = i(16.4); bon.add(hw);
  } else {
    const act = hydraulicActuator(M);
    act.position.y = i(10.4); bon.add(act);
  }
  bon.rotation.z = -Math.PI / 2;
  bon.position.set(i(7.75), H / 2, 0);
  g.add(bon);
  // nameplate on the body front
  const plate = mesh(box(i(5), i(3), i(0.12), i(0.1), 2), M.plate);
  plate.position.set(0, H / 2 + i(2), i(8.3)); g.add(plate);
  g.userData.height = H;
  return g;
}

function handwheel(M, dia) {
  const g = new THREE.Group();
  const rim = mesh(tagFlat(new THREE.TorusGeometry(dia / 2, i(0.75), 16, 96), 1), M.handwheel);
  rim.rotation.x = Math.PI / 2; g.add(rim);
  const hub = mesh(lathe([[0, -i(1.5)], [i(1.9), -i(1.5)], [i(1.9), i(1.5)], [0, i(1.5)]], { segments: 32, radius: i(0.3) }), M.handwheel);
  g.add(hub);
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5;
    const sp = mesh(tagFlat(new THREE.CylinderGeometry(i(0.55), i(0.7), dia / 2 - i(1.6), 12).rotateZ(Math.PI / 2)), M.handwheel);
    sp.position.set(Math.cos(a) * (dia / 4 + i(0.6)), 0, Math.sin(a) * (dia / 4 + i(0.6)));
    sp.rotation.y = -a; g.add(sp);
  }
  // spinner knob
  const knob = mesh(lathe([[0, 0], [i(0.8), 0], [i(0.8), i(3.5)], [0, i(3.5)]], { segments: 20, radius: i(0.3) }), M.rubber);
  knob.position.set(dia / 2, i(0.5), 0); g.add(knob);
  return g;
}

function hydraulicActuator(M) {
  const g = new THREE.Group();
  const prof = [[0, 0], [i(5.2), 0], [i(5.2), i(1.2)], [i(4.6), i(1.6)], [i(4.6), i(15)], [i(5.2), i(15.4)], [i(5.2), i(16.6)], [0, i(16.6)]];
  g.add(mesh(lathe(prof, { segments: 64, radius: i(0.3) }), M.actuator));
  // tie rods
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const rod = mesh(tagFlat(new THREE.CylinderGeometry(i(0.4), i(0.4), i(16.6), 12)), M.machined);
    rod.position.set(Math.cos(a) * i(4.9), i(8.3), Math.sin(a) * i(4.9)); g.add(rod);
  }
  // hydraulic fittings and a short hose
  const fit = mesh(lathe([[0, 0], [i(0.7), 0], [i(0.7), i(1.6)], [0, i(1.6)]], { segments: 6, radius: i(0.05) }), M.brass);
  fit.rotation.x = Math.PI / 2; fit.position.set(0, i(2.6), i(4.6)); g.add(fit);
  const fit2 = fit.clone(); fit2.position.y = i(13.8); g.add(fit2);
  // position indicator rod
  const ind = mesh(lathe([[0, 0], [i(0.45), 0], [i(0.45), i(3)], [0, i(3)]], { segments: 16, radius: i(0.1) }), M.machined);
  ind.position.y = i(16.6); g.add(ind);
  return g;
}

// flow cross: 7-1/16 run with two 3-1/16 wing outlets, each with a manual wing valve
function flowCross(M) {
  const g = new THREE.Group();
  const H = i(26);
  g.add(mesh(flangeGeo(F, false), M.treePaint));
  const tf = mesh(flangeGeo(F, true), M.treePaint); tf.position.y = H; g.add(tf);
  const body = mesh(box(i(15), H - 2 * i(F.thick + F.neck) + i(1.2), i(15), i(1.0), 4), M.treePaint);
  body.position.y = H / 2; g.add(body);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    // outlet neck and studded outlet flange
    const neck = mesh(lathe([[i(1.6), 0], [i(3.4), 0], [i(3.4), i(3.0)], [i(1.6), i(3.0)]], { segments: 48, radius: i(0.2) }), M.treePaint);
    neck.position.y = i(7.5); arm.add(neck);
    const of = mesh(flangeGeo(W, true), M.treePaint); of.position.y = i(7.5 + 3.0 + W.thick + W.neck); arm.add(of);
    // wing valve (manual, 3-1/16), bolted onto the outlet
    const wv = new THREE.Group();
    const wf1 = mesh(flangeGeo(W, false), M.treePaint); wv.add(wf1);
    const wbody = mesh(box(i(9), i(9), i(9.5), i(0.8), 3), M.treePaint); wbody.position.y = i(W.thick + W.neck + 4.0); wv.add(wbody);
    const wf2 = mesh(flangeGeo(W, true), M.treePaint); wf2.position.y = i(2 * (W.thick + W.neck) + 8.0); wv.add(wf2);
    const wstem = mesh(lathe([[0, 0], [i(0.6), 0], [i(0.6), i(9)], [0, i(9)]], { segments: 16, radius: i(0.05) }), M.machined);
    wstem.rotation.x = Math.PI / 2; wstem.position.set(0, i(W.thick + W.neck + 4.0), i(4.5)); wv.add(wstem);
    const whw = handwheel(M, i(14)); whw.rotation.x = Math.PI / 2; whw.position.set(0, i(W.thick + W.neck + 4.0), i(13)); wv.add(whw);
    wv.position.y = i(7.5 + 3.0 + W.thick + W.neck);
    wv.add(studsFor(W, 0, M));
    arm.add(wv);
    arm.rotation.z = side * -Math.PI / 2;
    arm.position.y = H / 2;
    g.add(arm);
  }
  g.userData.height = H;
  return g;
}

// goat head: frac head block with inlet legs angled down, each ending in a 3" 1502 hammer-union wing nut
function goatHead(M) {
  const g = new THREE.Group();
  g.add(mesh(flangeGeo(F, false), M.treePaint));
  const coreH = i(20);
  const core = mesh(lathe([[0, 0], [i(8), 0], [i(8), i(2)], [i(7), i(3.2)], [i(7), coreH - i(4)], [i(5.2), coreH - i(1)],
    [i(3.6), coreH], [0, coreH]], { segments: 96, radius: i(0.5) }), M.treePaint);
  core.position.y = i(F.thick + F.neck) - i(0.6); g.add(core);
  const top = i(F.thick + F.neck) + coreH - i(0.6);
  const legs = 6;
  for (let k = 0; k < legs; k++) {
    const a = k * Math.PI * 2 / legs + Math.PI / 6;
    const leg = new THREE.Group();
    const pipe = mesh(lathe([[i(1.5), 0], [i(2.25), 0], [i(2.25), i(13)], [i(1.5), i(13)]], { segments: 40, radius: i(0.12) }), M.treePaint);
    leg.add(pipe);
    // 1502 union: male sub with the wing nut (three lugs)
    const sub = mesh(lathe([[i(1.5), 0], [i(2.6), 0], [i(2.6), i(2.2)], [i(1.5), i(2.2)]], { segments: 40, radius: i(0.15) }), M.machined);
    sub.position.y = i(13); leg.add(sub);
    const wn = mesh(lathe([[i(2.4), 0], [i(3.7), 0], [i(3.7), i(3.2)], [i(2.4), i(3.2)]], { segments: 48, radius: i(0.25) }), M.handwheel);
    wn.position.y = i(14.6); leg.add(wn);
    for (let l = 0; l < 3; l++) {
      const lug = mesh(box(i(1.4), i(2.6), i(2.6), i(0.3), 2), M.handwheel);
      const b = l * Math.PI * 2 / 3;
      lug.position.set(Math.cos(b) * i(4.4), i(16.1), Math.sin(b) * i(4.4)); lug.rotation.y = -b; leg.add(lug);
    }
    leg.position.set(Math.cos(a) * i(5.5), top - i(9), -Math.sin(a) * i(5.5));
    leg.rotation.set(0, a, -Math.PI / 2 + Math.PI / 5, 'YZX');   // legs rise 36 degrees above horizontal
    g.add(leg);
  }
  // lifting eye
  const eye = mesh(tagFlat(new THREE.TorusGeometry(i(2.4), i(0.7), 16, 48), 1), M.treePaint);
  eye.position.y = top + i(2.2); g.add(eye);
  // pressure gauge on a needle valve
  const nv = mesh(box(i(2), i(3), i(2), i(0.2), 2), M.machined); nv.position.set(i(4.5), top - i(1.2), 0); g.add(nv);
  const gauge = gaugeAssembly(M); gauge.position.set(i(4.5), top + i(1.8), 0); g.add(gauge);
  g.userData.height = top;
  return g;
}

function gaugeAssembly(M) {
  const g = new THREE.Group();
  const caseG = mesh(lathe([[0, 0], [i(2.3), 0], [i(2.3), i(1.6)], [0, i(1.6)]], { segments: 48, radius: i(0.15) }), M.machined);
  caseG.rotation.x = Math.PI / 2; caseG.position.y = i(2.6); g.add(caseG);
  const face = new THREE.Mesh(new THREE.CircleGeometry(i(2.05), 48), gaugeFaceMaterial());
  face.position.set(0, i(2.6), i(1.62)); g.add(face);
  const stemG = mesh(lathe([[0, 0], [i(0.4), 0], [i(0.4), i(1.6)], [0, i(1.6)]], { segments: 12, radius: 0 }), M.brass);
  g.add(stemG);
  return g;
}

let _gaugeMat;
function gaugeFaceMaterial() {
  if (_gaugeMat) return _gaugeMat;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#ebe7dc'; x.beginPath(); x.arc(128, 128, 126, 0, 7); x.fill();
  x.strokeStyle = '#222'; x.lineWidth = 3;
  for (let k = 0; k <= 30; k++) {
    const a = Math.PI * 0.75 + k / 30 * Math.PI * 1.5, r0 = k % 5 ? 100 : 88;
    x.beginPath(); x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); x.stroke();
  }
  x.fillStyle = '#b11'; x.beginPath(); x.arc(128, 128, 112, Math.PI * 0.75 + Math.PI * 1.5 * (2 / 3), Math.PI * 2.25); x.arc(128, 128, 104, Math.PI * 2.25, Math.PI * 0.75 + Math.PI * 1.5 * (2 / 3), true); x.fill();
  x.fillStyle = '#222'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
  x.fillText('PSI', 128, 175); x.font = '14px sans-serif'; x.fillText('x1000', 128, 195);
  for (let k = 0; k <= 6; k++) {
    const a = Math.PI * 0.75 + k / 6 * Math.PI * 1.5;
    x.fillText(String(k * 5), 128 + Math.cos(a) * 72, 133 + Math.sin(a) * 72);
  }
  x.strokeStyle = '#111'; x.lineWidth = 5; x.beginPath(); x.moveTo(128, 128);
  const na = Math.PI * 0.75 + 0.0 * Math.PI * 1.5; x.lineTo(128 + Math.cos(na) * 96, 128 + Math.sin(na) * 96); x.stroke();
  x.fillStyle = '#111'; x.beginPath(); x.arc(128, 128, 8, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _gaugeMat = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  return _gaugeMat;
}

// wellhead: tubing-head spool sitting on a casing stub, with side outlets and a gauge
function wellhead(M) {
  const g = new THREE.Group();
  const H = i(24);
  // casing stub (9-5/8" visible above the cellar, painted grey)
  const casing = mesh(lathe([[i(4.4), -i(30)], [i(4.81), -i(30)], [i(4.81), 0], [i(4.4), 0]], { segments: 64, radius: i(0.1) }), M.galv);
  g.add(casing);
  const base = mesh(lathe([[i(4.8), 0], [i(9.5), 0], [i(9.5), i(3.4)], [i(7.4), i(4.4)], [i(7.4), H - i(F.thick + F.neck)], [i(4), H - i(F.thick + F.neck)]],
    { segments: 96, radius: i(0.3) }), M.treePaint);
  g.add(base);
  const tf = mesh(flangeGeo(F, true), M.treePaint); tf.position.y = H; g.add(tf);
  for (const s of [-1, 1]) {
    const o = mesh(lathe([[i(1.0), 0], [i(2.4), 0], [i(2.4), i(5)], [i(3.6), i(5.3)], [i(3.6), i(6.6)], [i(1.0), i(6.6)]], { segments: 48, radius: i(0.15) }), M.treePaint);
    o.rotation.z = s * -Math.PI / 2; o.position.set(s * i(6.8), i(10), 0); g.add(o);
  }
  g.userData.height = H;
  return g;
}

// ------------------------------------------------------------------ assembly
export const CARDS = {
  wellhead: { name: 'Tubing head spool', does: 'Lands on the casing head and gives the frac stack a 15,000 psi flange to bolt to.',
    specs: ['Top flange 7-1/16" 15K, 6BX', 'Side outlets for annulus monitoring'], est: 'body proportions estimated' },
  lmv: { name: 'Lower master valve', does: 'Last line of defence: a full-bore gate valve kept open during pumping and closed only to secure the well.',
    specs: ['7-1/16" bore, 15,000 psi', 'Manual, handwheel operated', 'About 35" flange to flange'], est: 'face-to-face from an unconfirmed table' },
  umv: { name: 'Upper master valve', does: 'Hydraulically actuated gate valve used for routine shut-ins so the lower master stays untouched.',
    specs: ['7-1/16" bore, 15,000 psi', 'Hydraulic actuator, fail-as-is'], est: 'face-to-face estimated' },
  cross: { name: 'Flow cross with wing valves', does: 'Side outlets for flowback and pump-down lines, each behind its own gate valve.',
    specs: ['Run 7-1/16" 15K', 'Wings 3-1/16" 15K, manual'], est: 'wing flange sizes estimated' },
  swab: { name: 'Swab valve', does: 'Top valve of the tree: opened to run wireline tools and plugs into the well between stages.',
    specs: ['7-1/16" bore, 15,000 psi', 'Manual'], est: 'face-to-face estimated' },
  goat: { name: 'Frac head ("goat head")', does: 'Takes treating iron from the pumps through six angled inlets and turns it down the well.',
    specs: ['Six 3" 1502 hammer-union inlets', '7-1/16" 15K bottom flange', 'Pressure gauge on a needle valve'], est: 'inlet count and angle vary by vendor' },
  studs: { name: 'Stud and nut set', does: 'Sixteen studs make up each flange joint, torqued in a star pattern to energise the ring gasket.',
    specs: ['16 x 1-1/2" B7 studs, 13" long', '2H heavy hex nuts, 2-3/8" across flats', 'Bolt circle about 16-7/8"'], est: 'bolt circle approximate' },
  gasket: { name: 'BX-156 ring gasket', does: 'A soft-iron ring that the flanges crush into their grooves to make a metal-to-metal seal.',
    specs: ['API 6A type BX-156', '9.367" OD, 0.733" square octagonal section', 'Single use: replaced at every make-up'], est: '' },
};

export function buildFracTree(M) {
  const root = new THREE.Group();
  root.name = 'frac-tree';
  const parts = [];
  let y = 0;
  const STEP = 0.32;   // explode spacing (m) per level

  const add = (id, obj, level, card = id, extra = [0, 0, 0]) => {
    const p = part(id, CARDS[card], [extra[0], level * STEP + extra[1], extra[2]]);
    p.add(obj); p.position.y = y; p.userData.home.copy(p.position);
    root.add(p); parts.push(p);
    return p;
  };
  const joint = (level) => {
    // gasket + studs straddle the joint; they explode to halfway between the two parts
    const gk = add(`gasket-${level}`, bxRing(F, M.gasket), level + 0.5, 'gasket');
    const st = add(`studs-${level}`, studsFor(F, 0, M), level + 0.5, 'studs', [0, 0, 0]);
    st.userData.explodeStuds = true;
    return [gk, st];
  };

  const wh = wellhead(M); add('wellhead', wh, 0); y += wh.userData.height;
  joint(0);
  const lmv = gateValve(M, { operator: 'hand' }); add('lmv', lmv, 1); y += lmv.userData.height;
  joint(1);
  const umv = gateValve(M, { operator: 'hyd' }); add('umv', umv, 2); y += umv.userData.height;
  joint(2);
  const cr = flowCross(M); add('cross', cr, 3); y += cr.userData.height;
  joint(3);
  const sw = gateValve(M, { operator: 'hand' }); const swp = add('swab', sw, 4); y += sw.userData.height;
  swp.children[0].rotation.y = Math.PI;   // swab handwheel on the opposite side, as on most trees
  joint(4);
  const gh = goatHead(M); add('goat', gh, 5); y += gh.userData.height;

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.parts = parts;
  root.userData.height = y;
  return root;
}

// explode: 0 = assembled, 1 = fully apart. Studs lift a little further and spread so the gasket shows.
export function setExplode(root, e) {
  for (const p of root.userData.parts) {
    const off = p.userData.explode;
    p.position.copy(p.userData.home).addScaledVector(off, e);
    if (p.userData.explodeStuds) p.position.y += e * 0.08;
  }
}
