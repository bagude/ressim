// Frac pump trailer, 2,500 hp diesel class, with its tractor. x runs along the unit (tractor at +x), y up, z across.
//
// Sourced (docs/gaps-fleet.md, docs/pad-inventory.md):
//   trailer 12.0 x 2.5 x 4.15 m, 37 t                     one OEM listing (Cat 3512C + QPA2500), unconfirmed elsewhere
//   whole unit with tractor 61.25 x 8 x 13.5 ft            Baker Hughes Rhino 2000 spec sheet
//   Cat 3512C, 2,500 hp at 1,900 rpm                       Cat dealer sheet
//   quintuplex pump 85 x 74 x 43 in, 8 in stroke           SERVA QPA-2500 (search summary)
//   Allison 9800 transmission; quintuplex 4.5-5.5 in plungers  Baker Hughes Rhino 2000 spec sheet
// Estimated (by eye from photographs): deck height, engine block proportions, radiator package, tractor, walkways.
import * as THREE from 'three';
import { IN, lathe, box, mesh, tagFlat, studRing } from '../engine/kit.js';
import { surface } from '../engine/materials.js';

const DECK = 1.25;           // top of the deck, m (estimate)
const TRAILER_L = 12.0, TRAILER_W = 2.5;   // sourced (OEM listing)
const STROKE = 8 * IN;       // sourced
const CRANK_R = STROKE / 2;
const ROD_L = 30 * IN;       // connecting rod length (estimate)

function mats(M) {
  const c = (h) => new THREE.Color(h);
  return {
    ...M,
    frame: surface({ name: 'frame paint', paint: c('#2b2f33'), chip: 0.55, grime: 0.7, rough: 0.6, streak: 0.4 }),
    body: surface({ name: 'unit paint', paint: c('#b9b6ad'), chip: 0.45, grime: 0.65, rough: 0.5, streak: 0.6, clearcoat: 0.3 }),
    accent: surface({ name: 'accent paint', paint: c('#d98a1c'), chip: 0.5, grime: 0.5, rough: 0.5 }),
    engine: surface({ name: 'engine paint', paint: c('#545a5f'), chip: 0.35, grime: 0.8, rough: 0.55, grimeColor: c('#1d1a16') }),
    pump: surface({ name: 'pump paint', paint: c('#39434b'), chip: 0.5, grime: 0.6, rough: 0.55 }),
    fluidEnd: surface({ name: 'forged fluid end', paint: null, under: c('#6c6f71'), chip: 0, grime: 0.55, rough: 0.48, bump: 0.5,
      grimeColor: c('#4a3b2c') }),
    plunger: surface({ name: 'plunger', paint: null, under: c('#c7c9cb'), chip: 0, grime: 0.05, rough: 0.12, bump: 0.01, machined: 0.5 }),
    tire: surface({ name: 'tire', paint: c('#1b1b1c'), chip: 0, grime: 0.55, rough: 0.9, bump: 1.6, bumpFreq: 60, grimeColor: c('#5a4c3a') }),
    rim: surface({ name: 'rim', paint: c('#c8c7c2'), chip: 0.3, grime: 0.6, rough: 0.4, metal: 0.4 }),
    radiatorCore: surface({ name: 'radiator core', paint: null, under: c('#3a3c3d'), chip: 0, grime: 0.4, rough: 0.6, bump: 2.5, bumpFreq: 900 }),
    deckPlate: surface({ name: 'tread plate', paint: null, under: c('#7d8184'), chip: 0, grime: 0.85, rough: 0.55, bump: 0.6, bumpFreq: 220, tread: 1, grimeColor: c('#3d3326') }),
    cab: surface({ name: 'cab paint', paint: c('#2f3d4a'), chip: 0.15, grime: 0.5, rough: 0.32, metal: 0.3, clearcoat: 0.9, streak: 0.6 }),
    chrome: surface({ name: 'chrome', paint: null, under: c('#d4d7da'), chip: 0, grime: 0.15, rough: 0.08, bump: 0.01 }),
    darkGlass: new THREE.MeshPhysicalMaterial({ color: '#0d1418', roughness: 0.05, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.0 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff9a2a', emissiveIntensity: 0.6, roughness: 0.3 }),
    redLamp: new THREE.MeshStandardMaterial({ color: '#a01010', emissive: '#ff2a1a', emissiveIntensity: 0.5, roughness: 0.3 }),
  };
}

// cylinder along an axis, centred, with filleted ends
function cyl(r, len, axis, mat, { segs = 40, ri = 0, fillet = 0.006 } = {}) {
  const pts = ri > 0 ? [[ri, -len / 2], [r, -len / 2], [r, len / 2], [ri, len / 2]] : [[0, -len / 2], [r, -len / 2], [r, len / 2], [0, len / 2]];
  const g = lathe(pts, { segments: segs, radius: Math.min(fillet, r * 0.3) });
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, mat);
}
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

function part(id, card, explode) {
  const g = new THREE.Group();
  g.name = id;
  g.userData = { id, card, explode: new THREE.Vector3(...explode), home: new THREE.Vector3() };
  return g;
}

// ------------------------------------------------------------------ wheels
function wheel(K, { dual = true } = {}) {
  const g = new THREE.Group();
  const tireProf = [[0.292, -0.14], [0.45, -0.14], [0.505, -0.125], [0.527, -0.08], [0.527, 0.08], [0.505, 0.125], [0.45, 0.14], [0.292, 0.14]];
  const tireG = lathe(tireProf, { segments: 72, radius: 0.02 }); tireG.rotateX(Math.PI / 2);
  const rimG = lathe([[0, -0.11], [0.12, -0.11], [0.2, -0.13], [0.29, -0.13], [0.29, 0.12], [0.27, 0.12], [0.25, 0.02], [0.08, 0.02], [0, 0.04]],
    { segments: 48, radius: 0.006 }); rimG.rotateX(Math.PI / 2);
  const offs = dual ? [-0.155, 0.155] : [0];
  for (const dz of offs) {
    const t = mesh(tireG, K.tire); t.position.z = dz; g.add(t);
    const r = mesh(rimG, K.rim); r.position.z = dz; if (dz < 0) r.rotation.y = Math.PI; g.add(r);
  }
  // hub with ten wheel nuts on the outer face
  const hub = cyl(0.11, 0.12, 'z', K.machined, { segs: 32 }); hub.position.z = (dual ? 0.155 : 0) + 0.1; g.add(hub);
  const nutG = lathe([[0, 0], [0.016, 0], [0.016, 0.03], [0, 0.03]], { segments: 6, radius: 0.002 }); nutG.rotateX(Math.PI / 2);
  const nuts = new THREE.InstancedMesh(nutG, K.chrome, 10);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 10; k++) {
    const a = k * Math.PI / 5;
    m.makeTranslation(Math.cos(a) * 0.143, Math.sin(a) * 0.143, (dual ? 0.155 : 0) + 0.12);
    nuts.setMatrixAt(k, m);
  }
  g.add(nuts);
  g.userData.spin = true;
  return g;
}

function axleSet(K, xs, track = 1.82) {
  const g = new THREE.Group();
  for (const x of xs) {
    const axle = cyl(0.065, track, 'z', K.frame, { segs: 20 }); axle.position.set(x, 0.527, 0); g.add(axle);
    for (const s of [-1, 1]) {
      const w = wheel(K); w.position.set(x, 0.527, s * track / 2);
      if (s < 0) w.rotation.y = Math.PI;
      g.add(w);
    }
    // leaf spring hangers
    for (const s of [-1, 1]) {
      const spring = mesh(box(1.1, 0.12, 0.09, 0.01), K.frame); spring.position.set(x, 0.66, s * 0.48); g.add(spring);
    }
  }
  return g;
}

// ------------------------------------------------------------------ chassis
function chassis(K) {
  const g = new THREE.Group();
  const x0 = -TRAILER_L / 2, x1 = TRAILER_L / 2 - 2.6;   // main deck
  // I-beam main rails
  const shape = new THREE.Shape();
  const h = 0.46, fw = 0.2, tw = 0.014, tf = 0.022;
  shape.moveTo(-fw / 2, 0); shape.lineTo(fw / 2, 0); shape.lineTo(fw / 2, tf); shape.lineTo(tw / 2, tf); shape.lineTo(tw / 2, h - tf);
  shape.lineTo(fw / 2, h - tf); shape.lineTo(fw / 2, h); shape.lineTo(-fw / 2, h); shape.lineTo(-fw / 2, h - tf); shape.lineTo(-tw / 2, h - tf);
  shape.lineTo(-tw / 2, tf); shape.lineTo(-fw / 2, tf); shape.closePath();
  const railG = tagFlat(new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false }));
  railG.rotateY(Math.PI / 2); railG.computeVertexNormals();
  for (const s of [-1, 1]) { const r = mesh(railG, K.frame); r.position.set(x0, DECK - 0.05 - h, s * 0.5); g.add(r); }
  // deck: tread plate with side skirts
  const deck = mesh(box(x1 - x0, 0.05, TRAILER_W, 0.01), K.deckPlate); deck.position.set((x0 + x1) / 2, DECK - 0.025, 0); g.add(deck);
  for (const s of [-1, 1]) {
    const skirt = mesh(box(x1 - x0, 0.32, 0.03, 0.008), K.frame); skirt.position.set((x0 + x1) / 2, DECK - 0.2, s * (TRAILER_W / 2 - 0.015)); g.add(skirt);
  }
  // crossmembers
  const cm = new THREE.InstancedMesh(box(0.08, 0.2, 1.0, 0.008), K.frame, 18);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 18; k++) { m.makeTranslation(x0 + 0.3 + k * (x1 - x0 - 0.6) / 17, DECK - 0.2, 0); cm.setMatrixAt(k, m); }
  g.add(cm);
  // gooseneck: raised front deck over the fifth wheel
  const gx0 = x1, gx1 = TRAILER_L / 2;
  const neck = mesh(box(gx1 - gx0, 0.42, 1.2, 0.02), K.frame); neck.position.set((gx0 + gx1) / 2, DECK + 0.32, 0); g.add(neck);
  const neckDeck = mesh(box(gx1 - gx0, 0.04, TRAILER_W, 0.01), K.deckPlate); neckDeck.position.set((gx0 + gx1) / 2, DECK + 0.55, 0); g.add(neckDeck);
  const ramp = mesh(box(0.5, 0.6, 1.2, 0.02), K.frame); ramp.position.set(gx0 + 0.05, DECK + 0.05, 0); ramp.rotation.z = 0.6; g.add(ramp);
  // kingpin plate
  const kp = cyl(0.045, 0.1, 'y', K.machined, { segs: 16 }); kp.position.set(gx1 - 0.9, DECK + 0.05, 0); g.add(kp);
  // landing gear
  for (const s of [-1, 1]) {
    const leg = mesh(box(0.14, DECK - 0.2, 0.14, 0.01), K.frame); leg.position.set(gx0 - 0.4, (DECK - 0.2) / 2 + 0.12, s * 0.75); g.add(leg);
    const foot = mesh(box(0.3, 0.05, 0.3, 0.01), K.frame); foot.position.set(gx0 - 0.4, 0.045, s * 0.75); g.add(foot);
  }
  const crank = cyl(0.02, 0.4, 'z', K.machined, { segs: 12 }); crank.position.set(gx0 - 0.4, DECK - 0.5, 1.05); g.add(crank);
  // mud flaps and tail lights
  for (const s of [-1, 1]) {
    const flap = mesh(box(0.012, 0.55, 0.6, 0.005), K.rubber); flap.position.set(x0 + 0.1, 0.55, s * 0.9); g.add(flap);
    const tl = cyl(0.045, 0.03, 'x', K.redLamp, { segs: 20 }); tl.position.set(x0 - 0.005, DECK - 0.15, s * 1.05); g.add(tl);
  }
  // amber clearance lamps along the skirt
  const lampG = lathe([[0, 0], [0.025, 0], [0.025, 0.02], [0, 0.03]], { segments: 16, radius: 0.003 });
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const l = mesh(lampG.clone().rotateX(s * Math.PI / 2), K.lamp); l.position.set(x0 + 1 + k * 2.6, DECK - 0.15, s * (TRAILER_W / 2 + 0.002)); g.add(l);
  }
  return g;
}

// ------------------------------------------------------------------ radiator package (front, over the gooseneck)
function radiator(K) {
  const g = new THREE.Group();
  const W = 2.3, H = 1.95, D = 0.95;   // sized so the package and air cleaners top out at the sourced 4.15 m
  const base = DECK + 0.57;
  // frame: four posts and a top rail, so the core shows between them
  for (const [y, h] of [[base + 0.06, 0.12], [base + H - 0.06, 0.12]]) {
    const rail = mesh(box(D, h, W, 0.015), K.body); rail.position.set(0, y, 0); g.add(rail);
  }
  for (const zs of [-1, 1]) {
    const side = mesh(box(D, H, 0.1, 0.015), K.body); side.position.set(0, base + H / 2, zs * (W / 2 - 0.05)); g.add(side);
  }
  // cores (stacked jacket-water and aftercooler sections)
  const core = mesh(box(0.22, H - 0.26, W - 0.22, 0.004), K.radiatorCore); core.position.set(0.15, base + H / 2, 0); g.add(core);
  // front grille: instanced horizontal louvres
  const n = 26, louvres = new THREE.InstancedMesh(box(0.06, 0.012, W - 0.22, 0.003), K.body, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5);
  for (let k = 0; k < n; k++) { m.compose(new THREE.Vector3(D / 2 - 0.04, base + 0.18 + k * (H - 0.36) / (n - 1), 0), q, new THREE.Vector3(1, 1, 1)); louvres.setMatrixAt(k, m); }
  g.add(louvres);
  // fan shroud on the engine side, fan inside it
  const shroud = mesh(lathe([[0.95, -0.12], [1.02, -0.12], [1.02, 0.14], [0.95, 0.14]], { segments: 72, radius: 0.01 }).rotateZ(-Math.PI / 2), K.frame);
  shroud.position.set(-0.12, base + H / 2, 0); g.add(shroud);
  const fan = new THREE.Group(); fan.position.set(-0.12, base + H / 2, 0);
  const bladeShape = new THREE.Shape(); bladeShape.moveTo(0.12, -0.08); bladeShape.quadraticCurveTo(0.6, -0.17, 0.92, -0.12);
  bladeShape.lineTo(0.92, 0.1); bladeShape.quadraticCurveTo(0.55, 0.12, 0.12, 0.06); bladeShape.closePath();
  const bladeG = tagFlat(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.012, bevelEnabled: false })); bladeG.computeVertexNormals();
  for (let k = 0; k < 8; k++) {
    const holder = new THREE.Group(); holder.rotation.x = k * Math.PI / 4; const bb = mesh(bladeG, K.frame);
    bb.rotation.set(0, Math.PI / 2, 0.35); bb.position.z = 0; holder.add(bb); fan.add(holder);
  }
  fan.add(cyl(0.14, 0.2, 'x', K.frame, { segs: 24 }));
  fan.userData.spinX = true;
  g.add(fan);
  // air cleaners on the roof of the package
  for (const s of [-1, 1]) {
    const ac = cyl(0.18, 0.75, 'x', K.body, { segs: 40, fillet: 0.03 }); ac.position.set(-0.05, base + H + 0.2, s * 0.55); g.add(ac);
    const cap = cyl(0.16, 0.12, 'x', K.rubber, { segs: 32 }); cap.position.set(-0.48, base + H + 0.2, s * 0.55); g.add(cap);
  }
  g.position.x = TRAILER_L / 2 - 1.35;
  g.userData.fan = fan;
  return g;
}

// ------------------------------------------------------------------ engine (V12, crank along x)
function engine(K) {
  const g = new THREE.Group();
  const L = 2.55, y0 = DECK + 0.12;
  const pan = mesh(box(L * 0.9, 0.35, 0.8, 0.03), K.engine); pan.position.set(0, y0 + 0.18, 0); g.add(pan);
  const block = mesh(box(L, 0.6, 1.0, 0.04), K.engine); block.position.set(0, y0 + 0.65, 0); g.add(block);
  // two banks at +-30 degrees with six valve covers each
  for (const s of [-1, 1]) {
    const bank = new THREE.Group();
    const head = mesh(box(L * 0.94, 0.42, 0.5, 0.035), K.engine); head.position.y = 0.21; bank.add(head);
    for (let k = 0; k < 6; k++) {
      const vc = mesh(box(0.33, 0.14, 0.42, 0.04, 4), K.engine); vc.position.set(-L * 0.4 + k * (L * 0.8) / 5, 0.48, 0); bank.add(vc);
      // injector line bosses
      const boss = cyl(0.03, 0.08, 'y', K.machined, { segs: 12 }); boss.position.set(-L * 0.4 + k * (L * 0.8) / 5, 0.58, 0.06 * s); bank.add(boss);
    }
    // exhaust manifold along the outer side of each bank
    const ex = cyl(0.075, L * 0.85, 'x', K.machined, { segs: 24 }); ex.position.set(0, 0.2, s * 0.3); bank.add(ex);
    bank.rotation.x = -s * Math.PI / 6;
    bank.position.set(0, y0 + 0.92, s * 0.22);
    g.add(bank);
  }
  // turbochargers at the radiator end
  for (const s of [-1, 1]) {
    const t = new THREE.Group();
    const scroll = mesh(tagFlat(new THREE.TorusGeometry(0.15, 0.08, 16, 40)), K.machined); t.add(scroll);
    const comp = cyl(0.14, 0.2, 'z', K.chrome, { segs: 32 }); comp.position.z = -0.12 * s; t.add(comp);
    t.position.set(L / 2 + 0.05, y0 + 1.45, s * 0.42); g.add(t);
    const pipe = cyl(0.09, 0.3, 'y', K.machined, { segs: 24 }); pipe.position.set(L / 2 + 0.05, y0 + 1.65, s * 0.42); g.add(pipe);
  }
  // flywheel housing at the transmission end
  const fwh = mesh(lathe([[0, 0], [0.62, 0], [0.62, 0.22], [0.45, 0.32], [0, 0.32]], { segments: 64, radius: 0.02 }).rotateZ(Math.PI / 2), K.engine);
  fwh.position.set(-L / 2 + 0.02, y0 + 0.7, 0); g.add(fwh);
  // engine mounts
  for (const x of [-L * 0.35, L * 0.35]) for (const s of [-1, 1]) {
    const mt = mesh(box(0.25, 0.25, 0.2, 0.02), K.frame); mt.position.set(x, y0 + 0.1, s * 0.55); g.add(mt);
  }
  // exhaust stacks: through the walkway roof, each with a muffler and rain cap
  for (const s of [-1, 1]) {
    const muff = cyl(0.26, 1.1, 'y', K.galv, { segs: 40, fillet: 0.04 }); muff.position.set(L / 2 - 0.3, y0 + 1.95, s * 0.55); g.add(muff);
    const stack = cyl(0.1, 0.35, 'y', K.galv, { segs: 24 }); stack.position.set(L / 2 - 0.3, y0 + 2.62, s * 0.55); g.add(stack);
    const cap = mesh(box(0.24, 0.015, 0.24, 0.004), K.galv); cap.position.set(L / 2 - 0.3 + 0.02, y0 + 2.81, s * 0.55); cap.rotation.z = -0.5; g.add(cap);
  }
  g.position.x = 1.9;
  return g;
}

function transmission(K) {
  const g = new THREE.Group();
  const y = DECK + 0.82;
  const bell = mesh(lathe([[0, 0], [0.5, 0], [0.42, 0.35], [0.42, 0.5], [0, 0.5]], { segments: 56, radius: 0.02 }).rotateZ(Math.PI / 2), K.engine);
  bell.position.set(0.5, y, 0); g.add(bell);
  const caseB = mesh(box(0.9, 0.8, 0.8, 0.05), K.engine); caseB.position.set(-0.25, y - 0.05, 0); g.add(caseB);
  const ribs = new THREE.InstancedMesh(box(0.03, 0.82, 0.84, 0.01), K.engine, 4);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 4; k++) { m.makeTranslation(-0.6 + k * 0.23, y - 0.05, 0); ribs.setMatrixAt(k, m); }
  g.add(ribs);
  const cooler = cyl(0.08, 0.6, 'x', K.machined, { segs: 20 }); cooler.position.set(-0.2, y + 0.45, 0.25); g.add(cooler);
  g.position.x = -0.65;
  return g;
}

function driveshaft(K) {
  const g = new THREE.Group();
  const y = DECK + 0.78;
  const spin = new THREE.Group(); spin.position.set(-2.45, y, 0);
  const tubeM = cyl(0.075, 2.1, 'x', K.frame, { segs: 24 }); spin.add(tubeM);
  for (const x of [-1.1, 1.1]) {
    const yoke = cyl(0.12, 0.1, 'x', K.machined, { segs: 6 }); yoke.position.x = x; spin.add(yoke);
  }
  g.add(spin);
  g.userData.shaft = spin;
  return g;
}

// ------------------------------------------------------------------ pump: power end + fluid end (crank along z)
function powerEnd(K) {
  const g = new THREE.Group();
  const W = 74 * IN;   // sourced pump width (across the trailer)
  // housing: extruded side profile (rounded crown) along z
  const s = new THREE.Shape();
  s.moveTo(-0.62, 0); s.lineTo(0.55, 0); s.lineTo(0.55, 0.62); s.quadraticCurveTo(0.5, 1.02, 0.0, 1.06);
  s.quadraticCurveTo(-0.5, 1.0, -0.62, 0.7); s.closePath();
  const hg = new THREE.ExtrudeGeometry(s, { depth: W - 0.3, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 24 });
  hg.translate(0, 0, -(W - 0.3) / 2);
  const n = hg.attributes.normal, e = new Float32Array(n.count);
  for (let k = 0; k < n.count; k++) { const nz = Math.abs(n.getZ(k)); e[k] = nz > 0.08 && nz < 0.96 ? 1 : 0; }
  hg.setAttribute('aEdge', new THREE.BufferAttribute(e, 1)); hg.setAttribute('aCavity', new THREE.BufferAttribute(new Float32Array(n.count), 1));
  const housing = mesh(hg, K.pump); housing.position.y = DECK; g.add(housing);
  // bearing caps on both ends of the crankshaft, with studs
  for (const sgn of [-1, 1]) {
    const capG = lathe([[0, 0], [0.3, 0], [0.3, 0.05], [0.22, 0.09], [0, 0.09]], { segments: 48, radius: 0.008 });
    capG.rotateX(sgn * Math.PI / 2);
    const cap = mesh(capG, K.pump); cap.position.set(0, DECK + 0.55, sgn * (W / 2 - 0.12)); g.add(cap);
    const st = studRing({ count: 12, boltCircle: 0.52, studDia: 0.022, studLen: 0.07, nutAF: 0.036, nutH: 0.024, y0: 0, matStud: K.stud, matNut: K.nut });
    st.rotation.x = sgn * Math.PI / 2; st.position.set(0, DECK + 0.55, sgn * (W / 2 - 0.1)); g.add(st);
  }
  // reduction gearbox on the +z side, input shaft from the driveshaft
  const gb = mesh(lathe([[0, 0], [0.5, 0], [0.5, 0.24], [0.4, 0.3], [0, 0.3]], { segments: 64, radius: 0.015 }).rotateX(Math.PI / 2), K.pump);
  gb.position.set(0.35, DECK + 0.55, W / 2 - 0.05); g.add(gb);
  // lube oil filters and lines
  for (let k = 0; k < 2; k++) {
    const f = cyl(0.06, 0.3, 'y', K.accent, { segs: 24, fillet: 0.015 }); f.position.set(0.62, DECK + 0.4, -0.3 + k * 0.18); g.add(f);
  }
  // crosshead guides / pony rod windows: five openings on the fluid-end face
  for (let k = 0; k < 5; k++) {
    const z = -W / 2 + 0.25 + k * (W - 0.5) / 4;
    const win = mesh(box(0.04, 0.3, 0.22, 0.01), K.frame); win.position.set(-0.64, DECK + 0.5, z); g.add(win);
  }
  g.position.x = -4.0;
  return g;
}

function fluidEnd(K) {
  const g = new THREE.Group();
  const W = 74 * IN - 0.2;
  const blk = mesh(box(0.52, 0.72, W, 0.03), K.fluidEnd); blk.position.set(0, DECK + 0.5, 0); g.add(blk);
  const zs = [...Array(5)].map((_, k) => -W / 2 + 0.25 + k * (W - 0.5) / 4);
  // suction covers (rear face) and discharge covers (top), each held by a big retainer nut
  const retG = lathe([[0, 0], [0.105, 0], [0.105, 0.07], [0.085, 0.095], [0, 0.095]], { segments: 6, radius: 0.004 });
  for (const z of zs) {
    const r1 = mesh(retG.clone().rotateZ(Math.PI / 2), K.fluidEnd); r1.position.set(-0.26, DECK + 0.48, z); g.add(r1);
    const r2 = mesh(retG, K.fluidEnd); r2.position.set(0, DECK + 0.86, z); g.add(r2);
    // packing nut on the plunger side
    const pk = cyl(0.11, 0.08, 'x', K.machined, { segs: 8 }); pk.position.set(0.3, DECK + 0.5, z); g.add(pk);
  }
  // suction manifold below, with a riser to each cylinder
  const man = cyl(0.11, W + 0.2, 'z', K.pump, { segs: 32 }); man.position.set(-0.05, DECK + 0.02, 0); g.add(man);
  for (const z of zs) { const r = cyl(0.06, 0.18, 'y', K.pump, { segs: 20 }); r.position.set(-0.05, DECK + 0.12, z); g.add(r); }
  // discharge: 3" 1502 outlets at both ends of the block
  for (const s of [-1, 1]) {
    const o = cyl(0.06, 0.24, 'z', K.fluidEnd, { segs: 24 }); o.position.set(0, DECK + 0.68, s * (W / 2 + 0.12)); g.add(o);
    const wnut = cyl(0.095, 0.08, 'z', K.handwheel, { segs: 40 }); wnut.position.set(0, DECK + 0.68, s * (W / 2 + 0.27)); g.add(wnut);
    for (let l = 0; l < 3; l++) {
      const a = l * Math.PI * 2 / 3;
      const lug = mesh(box(0.06, 0.06, 0.07, 0.008), K.handwheel);
      lug.position.set(Math.cos(a) * 0.12, DECK + 0.68 + Math.sin(a) * 0.12, s * (W / 2 + 0.27)); g.add(lug);
    }
  }
  // stay rods tying the fluid end back to the power end
  for (const y of [DECK + 0.22, DECK + 0.8]) for (const s of [-1, 1]) {
    const rod = cyl(0.03, 0.42, 'x', K.machined, { segs: 16 }); rod.position.set(0.47, y, s * (W / 2 - 0.08)); g.add(rod);
  }
  g.position.x = -5.3;
  g.userData.cylZ = zs;
  return g;
}

// the reciprocating set: five plungers, driven by slider-crank kinematics at 8 in stroke
function plungers(K, zs) {
  const g = new THREE.Group();
  const list = [];
  for (const z of zs) {
    const p = new THREE.Group();
    const pl = cyl(2.5 * IN, 0.42, 'x', K.plunger, { segs: 32, fillet: 0.004 }); p.add(pl);
    const clamp = cyl(0.07, 0.06, 'x', K.handwheel, { segs: 6 }); clamp.position.x = 0.23; p.add(clamp);
    p.position.set(-4.83, DECK + 0.5, z);
    g.add(p); list.push(p);
  }
  g.userData.list = list;
  return g;
}

// ------------------------------------------------------------------ walkway, rails, fuel tank, control box
function walkway(K) {
  const g = new THREE.Group();
  const y = DECK, x0 = -1.75, x1 = 2.95;
  for (const s of [-1, 1]) {
    // handrail along each side of the engine bay
    const top = cyl(0.022, x1 - x0, 'x', K.accent, { segs: 12 }); top.position.set((x0 + x1) / 2, y + 1.05, s * 1.18); g.add(top);
    const mid = cyl(0.018, x1 - x0, 'x', K.accent, { segs: 12 }); mid.position.set((x0 + x1) / 2, y + 0.55, s * 1.18); g.add(mid);
    for (let k = 0; k <= 4; k++) {
      const post = cyl(0.022, 1.05, 'y', K.accent, { segs: 12 }); post.position.set(x0 + k * (x1 - x0) / 4, y + 0.525, s * 1.18); g.add(post);
    }
  }
  // ladder at the rear of the engine bay
  const ladder = new THREE.Group();
  for (const s of [-1, 1]) { const side = cyl(0.02, 1.3, 'y', K.galv, { segs: 10 }); side.position.set(0, -0.6, s * 0.2); ladder.add(side); }
  for (let k = 0; k < 4; k++) { const rung = cyl(0.016, 0.4, 'z', K.galv, { segs: 10 }); rung.position.set(0, -1.1 + k * 0.32, 0); ladder.add(rung); }
  ladder.position.set(-1.85, DECK, 1.32); g.add(ladder);
  // fuel tank slung under the deck between the axles and the landing gear
  const tank = mesh(box(2.4, 0.6, 2.1, 0.12, 5), K.galv); tank.position.set(0.6, DECK - 0.62, 0); g.add(tank);
  const neck = cyl(0.06, 0.08, 'y', K.chrome, { segs: 16 }); neck.position.set(0.0, DECK - 0.28, 1.0); g.add(neck);
  // local control box with gauges
  const cb = mesh(box(0.5, 0.7, 0.3, 0.02), K.body); cb.position.set(-1.6, DECK + 1.1, -1.05); g.add(cb);
  for (let k = 0; k < 3; k++) {
    const gg = cyl(0.05, 0.02, 'x', K.machined, { segs: 24 }); gg.position.set(-1.34, DECK + 1.25 - k * 0.15, -1.05); g.add(gg);
  }
  return g;
}

// ------------------------------------------------------------------ tractor (generic heavy-haul day cab)
function tractor(K) {
  const g = new THREE.Group();
  const fx = 0;   // fifth-wheel position in tractor space
  // frame rails
  for (const s of [-1, 1]) { const rail = mesh(box(6.6, 0.3, 0.1, 0.01), K.frame); rail.position.set(2.4, 0.95, s * 0.45); g.add(rail); }
  // fifth wheel
  const fw = mesh(box(0.9, 0.12, 0.95, 0.03), K.frame); fw.position.set(fx, 1.18, 0); g.add(fw);
  // cab
  const cabY = 1.35;
  const cab = mesh(box(2.0, 2.0, 2.45, 0.12, 5), K.cab); cab.position.set(3.4, cabY + 1.0, 0); g.add(cab);
  const ws = mesh(box(0.04, 0.85, 2.15, 0.02), K.darkGlass); ws.position.set(4.41, cabY + 1.45, 0); ws.rotation.z = 0.12; g.add(ws);
  for (const s of [-1, 1]) {
    const win = mesh(box(0.85, 0.7, 0.03, 0.02), K.darkGlass); win.position.set(3.75, cabY + 1.45, s * 1.226); g.add(win);
    const door = mesh(box(0.02, 1.3, 0.9, 0.02), K.cab); door.position.set(3.55, cabY + 0.8, s * 1.23); door.rotation.y = Math.PI / 2; g.add(door);
    // mirror on an arm
    const arm = cyl(0.015, 0.45, 'z', K.chrome, { segs: 8 }); arm.position.set(4.35, cabY + 1.5, s * 1.45); g.add(arm);
    const mir = mesh(box(0.06, 0.38, 0.2, 0.02), K.frame); mir.position.set(4.35, cabY + 1.45, s * 1.67); g.add(mir);
    // steps
    for (let k = 0; k < 2; k++) { const st = mesh(box(0.4, 0.04, 0.22, 0.01), K.deckPlate); st.position.set(3.6, 0.55 + k * 0.4, s * 1.25); g.add(st); }
    // fuel tank
    const ft = cyl(0.33, 1.3, 'x', K.chrome, { segs: 40, fillet: 0.05 }); ft.position.set(2.3, 0.75, s * 0.95); g.add(ft);
    // exhaust stacks behind the cab
    const ex = cyl(0.065, 2.4, 'y', K.chrome, { segs: 20 }); ex.position.set(2.28, 2.6, s * 1.05); g.add(ex);
  }
  // hood and grille
  const hood = mesh(box(1.9, 1.0, 1.9, 0.18, 5), K.cab); hood.position.set(5.35, 1.75, 0); g.add(hood);
  const grille = mesh(box(0.06, 0.9, 1.1, 0.03), K.chrome); grille.position.set(6.31, 1.72, 0); g.add(grille);
  const bars = new THREE.InstancedMesh(box(0.03, 0.02, 1.02, 0.004), K.frame, 9);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 9; k++) { m.makeTranslation(6.35, 1.36 + k * 0.09, 0); bars.setMatrixAt(k, m); }
  g.add(bars);
  const bumper = mesh(box(0.3, 0.32, 2.4, 0.05), K.chrome); bumper.position.set(6.45, 0.85, 0); g.add(bumper);
  for (const s of [-1, 1]) {
    const hl = mesh(box(0.05, 0.16, 0.34, 0.02), K.lamp); hl.position.set(6.31, 1.25, s * 0.82); g.add(hl);
    const fender = mesh(box(1.25, 0.12, 0.42, 0.05), K.cab); fender.position.set(5.6, 1.18, s * 1.02); g.add(fender);
  }
  // roof lights
  for (let k = -2; k <= 2; k++) { const l = mesh(box(0.06, 0.05, 0.08, 0.01), K.lamp); l.position.set(4.35, cabY + 2.03, k * 0.25); g.add(l); }
  // wheels: steer axle and tandem drive axles
  const steer = new THREE.Group();
  for (const s of [-1, 1]) { const w = wheel(K, { dual: false }); w.position.set(5.6, 0.527, s * 1.0); if (s < 0) w.rotation.y = Math.PI; steer.add(w); }
  g.add(steer);
  g.add(axleSet(K, [0.6, -0.75], 1.82));
  g.position.x = TRAILER_L / 2 - 0.9;   // fifth wheel under the kingpin
  return g;
}

// ------------------------------------------------------------------ assembly
export const CARDS = {
  tractor: { name: 'Tractor', does: 'Hauls the 37-tonne pump trailer to the pad and stays coupled while it works.',
    specs: ['Heavy-haul day cab, tandem drive', 'Couples at the gooseneck fifth wheel'], est: 'generic tractor, proportions estimated' },
  radiator: { name: 'Radiator package', does: 'Sheds the engine’s heat through jacket-water and charge-air cores, pulled by a hydraulic fan.',
    specs: ['Front of the trailer, over the gooseneck', 'Air cleaners on its roof'], est: 'size estimated from photographs' },
  engine: { name: 'Diesel engine', does: 'A V12 that turns diesel into the shaft power the pump needs to push slurry at frac pressure.',
    specs: ['Cat 3512C class, 2,500 hp at 1,900 rpm', 'Twin turbochargers, twin exhaust stacks'], est: 'block proportions estimated' },
  transmission: { name: 'Transmission', does: 'Multi-speed automatic that lets the pump run from low rate to full rate without stalling the engine.',
    specs: ['Allison 9800 or Cat CX-48 class'], est: 'case shape estimated' },
  driveshaft: { name: 'Driveshaft', does: 'Carries torque from the transmission to the pump’s reduction gearbox.', specs: ['Universal joints both ends'], est: '' },
  powerEnd: { name: 'Pump power end', does: 'Crankshaft, connecting rods and crossheads that turn rotation into straight-line plunger strokes.',
    specs: ['Quintuplex: five throws', '8 in stroke', 'Pump overall 85 x 74 x 43 in'], est: 'housing profile estimated' },
  plungers: { name: 'Plungers', does: 'Five polished plungers that displace fluid on every stroke; packing seals them against 15,000 psi.',
    specs: ['4.5 to 5.5 in diameter (quintuplex range)', '8 in stroke, phased 72 degrees apart'], est: '' },
  fluidEnd: { name: 'Fluid end', does: 'Forged steel block with a suction and a discharge valve per cylinder. The highest-wear part of a frac fleet.',
    specs: ['Up to 15,000 psi working pressure', '3 in 1502 discharge both ends', 'Suction manifold underneath'], est: 'block size estimated' },
  chassis: { name: 'Trailer chassis', does: 'Gooseneck trailer that carries the whole power train as one road-legal unit.',
    specs: ['12.0 x 2.5 m, 4.15 m high overall', 'About 37 t loaded (one manufacturer listing)'], est: 'deck height estimated' },
  axles: { name: 'Running gear', does: 'Tri-axle with dual wheels to spread 37 tonnes over the pad and the highway.', specs: ['11R22.5-size tyres'], est: 'tyre size assumed' },
  walkway: { name: 'Walkway, fuel tank and controls', does: 'Handrails and a ladder for the crew, a belly fuel tank, and a local gauge panel.',
    specs: ['Fuel for about 4 h at full power (400 gal on a comparable unit)'], est: 'layout estimated' },
};

export function buildPumpTrailer(M) {
  const K = mats(M);
  const root = new THREE.Group(); root.name = 'pump-trailer';
  const parts = [];
  const add = (id, obj, explode) => {
    const p = part(id, CARDS[id], explode); p.add(obj); p.userData.home.copy(p.position);
    root.add(p); parts.push(p); return p;
  };
  add('chassis', chassis(K), [0, 0, 0]);
  add('axles', axleSet(K, [-2.7, -3.95, -5.2]), [0, -0.0, 2.4]);
  add('walkway', walkway(K), [0, 0, -2.6]);
  add('tractor', tractor(K), [5.5, 0, 0]);
  const rad = add('radiator', radiator(K), [1.2, 2.2, 0]);
  add('engine', engine(K), [0, 3.0, 0]);
  add('transmission', transmission(K), [0, 2.4, 0]);
  const ds = add('driveshaft', driveshaft(K), [0, 1.8, 0]);
  add('powerEnd', powerEnd(K), [0, 2.0, 0]);
  const fe = add('fluidEnd', fluidEnd(K), [-2.4, 1.6, 0]);
  const pl = add('plungers', plungers(K, fe.children[0].userData.cylZ), [-1.2, 1.8, 0]);

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.parts = parts;
  root.userData.height = 4.15;
  root.userData.length = 18.7;

  // running state: crank angle and fan
  let theta = 0;
  root.userData.rpm = 160;   // pump crank speed (a quintuplex runs roughly 100-300 rpm)
  const fan = rad.children[0].userData.fan;
  const shaft = ds.children[0].userData.shaft;
  const list = pl.children[0].userData.list;
  root.userData.update = (dt) => {
    const w = root.userData.rpm / 60 * Math.PI * 2;
    theta += w * dt;
    list.forEach((p, k) => {
      const a = theta + k * Math.PI * 2 / 5;
      const s = CRANK_R * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - (CRANK_R * Math.sin(a)) ** 2) - ROD_L;  // slider-crank
      p.position.x = -4.83 + s;
    });
    if (fan) fan.rotation.x += dt * 18;
    if (shaft) shaft.rotation.x += w * dt * 6.5;   // pump gear reduction about 6.5:1
  };
  return root;
}

export function setExplode(root, e) {
  for (const p of root.userData.parts) p.position.copy(p.userData.home).addScaledVector(p.userData.explode, e);
}
