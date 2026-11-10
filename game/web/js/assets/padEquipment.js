// Pad-scale equipment, medium detail, metres. Sources in docs/pad-inventory.md and docs/gaps-*.md:
//   frac tank 45 ft x 102 in x 133 in (NTE 500 bbl)                       sourced
//   light tower mast 23 ft, 4 x 1,100 W, trailer 118 x 57 x 101 in stowed  sourced (Generac MLT6)
//   data van: 26 ft box on a Class 8 chassis                               sourced (Dragon control van listing)
//   silo battery about 60 x 34 x 61 ft                                     search excerpt only (Solaris 6-pack)
//   blender 36 x 8 x 12.6 ft                                               sourced (Baker Hughes 125E)
//   everything else (missile length, zipper skid, rig mast height)          estimated from photographs
import * as THREE from 'three';
import { IN, FT, lathe, box, mesh, tagFlat } from '../engine/kit.js';
import { surface } from '../engine/materials.js';

const c = (h) => new THREE.Color(h);
export function padMaterials(M) {
  return {
    ...M,
    white: surface({ name: 'white unit', paint: c('#c9c6bd'), chip: 0.35, grime: 0.7, rough: 0.5, streak: 0.7 }),
    frame: surface({ name: 'frame', paint: c('#2b2f33'), chip: 0.5, grime: 0.7, rough: 0.6 }),
    tank: surface({ name: 'frac tank', paint: c('#8f3b26'), chip: 0.6, grime: 0.7, rough: 0.6, streak: 0.9 }),
    silo: surface({ name: 'silo', paint: c('#d7d3c8'), chip: 0.3, grime: 0.6, rough: 0.5, streak: 1.0 }),
    amber: surface({ name: 'safety amber', paint: c('#d98a1c'), chip: 0.5, grime: 0.5, rough: 0.5 }),
    rigRed: surface({ name: 'rig paint', paint: c('#b23a22'), chip: 0.5, grime: 0.6, rough: 0.55 }),
    iron: surface({ name: 'treating iron', paint: c('#3a3f44'), chip: 0.5, grime: 0.5, rough: 0.5 }),
    hose: surface({ name: 'hose', paint: c('#1b1d1f'), chip: 0, grime: 0.4, rough: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#0d1418', roughness: 0.05, clearcoat: 1 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffe6b0', emissiveIntensity: 0.8 }),
  };
}

const cylY = (r, h, mat, segs = 24) => mesh(lathe([[0, 0], [r, 0], [r, h], [0, h]], { segments: segs, radius: Math.min(0.02, r * 0.2) }), mat);
const cylX = (r, len, mat, segs = 20) => { const m = cylY(r, len, mat, segs); m.geometry.rotateZ(-Math.PI / 2); m.geometry.translate(-len / 2, 0, 0); return m; };
const cylZ = (r, len, mat, segs = 20) => { const m = cylY(r, len, mat, segs); m.geometry.rotateX(Math.PI / 2); m.geometry.translate(0, 0, -len / 2); return m; };
const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };
function wheels(K, xs, track = 1.85) {
  const g = new THREE.Group();
  const tire = lathe([[0.29, -0.14], [0.47, -0.14], [0.527, -0.09], [0.527, 0.09], [0.47, 0.14], [0.29, 0.14]], { segments: 24, radius: 0.02 }); tire.rotateX(Math.PI / 2);
  for (const x of xs) for (const s of [-1, 1]) for (const d of [-0.16, 0.16]) g.add(at(mesh(tire, K.rubber), x, 0.527, s * track / 2 + d));
  return g;
}
function trailerDeck(K, L, W = 2.5, h = 1.25) {
  const g = new THREE.Group();
  g.add(at(mesh(box(L, 0.08, W, 0.01), K.frame), 0, h - 0.04, 0));
  for (const s of [-1, 1]) g.add(at(mesh(box(L, 0.4, 0.12, 0.01), K.frame), 0, h - 0.3, s * 0.5));
  return g;
}

// ---------------------------------------------------------------- frac tank (500 bbl, V-bottom), sourced size
export function fracTank(K) {
  const L = 45 * FT, W = 102 * IN, H = 133 * IN;
  const g = new THREE.Group();
  const s = new THREE.Shape();   // side profile: sloped front (towing nose), flat top, V-ish bottom
  s.moveTo(-L / 2, 0.55); s.lineTo(L / 2 - 1.2, 0.35); s.lineTo(L / 2, 1.1); s.lineTo(L / 2, H); s.lineTo(-L / 2 + 0.4, H); s.lineTo(-L / 2, H - 0.4); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  geo.translate(0, 0, -W / 2); geo.computeVertexNormals();
  g.add(mesh(tagFlat(geo), K.tank));
  // corrugation ribs, top walkway rail, ladder, manway, valves
  for (let k = 0; k < 14; k++) g.add(at(mesh(box(0.08, H - 0.8, W + 0.06, 0.01), K.tank), -L / 2 + 0.8 + k * (L - 2.2) / 13, (H + 0.6) / 2, 0));
  for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) g.add(at(cylX(0.025, L - 1, K.amber, 8), 0, H + 1.0, z));
  for (let k = 0; k < 7; k++) for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) g.add(at(cylY(0.025, 1.0, K.amber, 8), -L / 2 + 0.8 + k * (L - 1.6) / 6, H, z));
  g.add(at(cylY(0.3, 0.2, K.tank, 20), -L / 4, H, 0));
  for (const z of [-0.6, 0.6]) g.add(at(cylZ(0.11, 0.35, K.iron, 16), -L / 2 - 0.05, 0.75, z));
  g.add(wheels(K, [L / 2 - 1.5, L / 2 - 2.6]));
  return g;
}

// ---------------------------------------------------------------- light tower (Generac MLT6 class), sourced size
export function lightTower(K) {
  const g = new THREE.Group();
  g.add(at(mesh(box(118 * IN, 0.9, 57 * IN, 0.05), K.amber), 0, 0.95, 0));
  g.add(wheels(K, [0], 1.2));
  const mast = 23 * FT;
  for (let k = 0; k < 5; k++) g.add(at(mesh(box(0.14 - k * 0.018, mast / 5 + 0.2, 0.14 - k * 0.018, 0.01), K.galv), 0.8, 1.4 + k * mast / 5 + mast / 10, 0));
  const bar = at(mesh(box(0.08, 0.08, 1.6, 0.01), K.galv), 0.8, 1.4 + mast, 0); g.add(bar);
  for (const z of [-0.6, -0.2, 0.2, 0.6]) { const lamp = at(mesh(box(0.25, 0.32, 0.32, 0.03), K.frame), 0.85, 1.4 + mast - 0.25, z); g.add(lamp);
    g.add(at(mesh(box(0.02, 0.26, 0.26, 0.01), K.lamp), 0.98, 1.4 + mast - 0.25, z)); }
  for (const s of [-1, 1]) g.add(at(mesh(box(0.1, 0.1, 1.4, 0.01), K.frame), s * 1.2, 0.3, 0));   // outriggers
  return g;
}

// ---------------------------------------------------------------- data van: 26 ft box on a truck chassis (sourced)
export function dataVan(K) {
  const g = new THREE.Group();
  const L = 26 * FT;
  g.add(at(mesh(box(L, 2.6, 2.5, 0.06), K.white), -1.0, 2.6, 0));
  for (let k = 0; k < 3; k++) g.add(at(mesh(box(0.9, 0.5, 0.02, 0.01), K.glass), -3 + k * 1.6, 2.9, 1.26));
  g.add(at(mesh(box(1.0, 0.45, 1.1, 0.04), K.white), -2.2, 4.1, 0));          // roof A/C units
  g.add(at(mesh(box(1.0, 0.45, 1.1, 0.04), K.white), 0.4, 4.1, 0));
  g.add(at(cylY(0.05, 3.0, K.galv, 8), -4.6, 3.9, 0.9));                     // antenna mast
  g.add(at(mesh(box(0.5, 0.05, 0.05, 0.01), K.frame), -4.6, 6.9, 0.9));
  g.add(at(mesh(box(2.1, 2.2, 2.4, 0.15), K.white), L / 2 + 0.2, 2.1, 0));    // cab
  g.add(at(mesh(box(0.04, 0.8, 2.1, 0.02), K.glass), L / 2 + 1.27, 2.55, 0));
  g.add(at(mesh(box(1.2, 0.9, 2.2, 0.12), K.white), L / 2 + 1.7, 1.4, 0));
  g.add(at(cylY(0.3, 0.5, K.frame, 6), -4.7, 1.0, -1.0));                     // stairs
  g.add(wheels(K, [L / 2 + 1.6, -3.0, -4.3]));
  return g;
}

// ---------------------------------------------------------------- blender (sourced envelope 36 x 8 x 12.6 ft)
export function blender(K) {
  const g = new THREE.Group();
  const L = 36 * FT;
  g.add(trailerDeck(K, L));
  g.add(at(cylY(0.85, 1.7, K.white, 32), -2.0, 1.25, 0));                    // mixing tub
  g.add(at(cylY(0.9, 0.12, K.frame, 32), -2.0, 2.95, 0));
  for (const s of [-1, 1]) {                                                 // suction and discharge manifolds with valves
    g.add(at(cylX(0.13, L * 0.7, K.iron, 16), 0.5, 1.6, s * 1.15));
    for (let k = 0; k < 8; k++) g.add(at(cylZ(0.07, 0.3, K.amber, 12), -3.5 + k * 1.0, 1.6, s * 1.32));
  }
  for (const z of [-0.6, 0.6]) {                                             // sand screws (augers) rising to the tub
    const sc = cylX(0.22, 4.0, K.white, 16); sc.rotation.z = 0.5; at(sc, -4.5, 2.4, z); g.add(sc);
  }
  g.add(at(mesh(box(1.8, 1.2, 2.2, 0.06), K.white), -6.3, 3.5, 0));            // hopper
  g.add(at(mesh(box(3.0, 1.8, 2.3, 0.06), K.white), 3.2, 2.1, 0));             // engine and hydraulics house
  g.add(at(mesh(box(1.4, 1.3, 1.4, 0.06), K.frame), 1.0, 1.9, 0));             // control cab
  g.add(wheels(K, [-3.5, -4.7]));
  return g;
}

// ---------------------------------------------------------------- vertical silo battery, conveyor to the blender
export function siloBattery(K) {
  const g = new THREE.Group();
  const H = 61 * FT;   // search excerpt only (Solaris 6-pack 60 x 34 x 61 ft)
  g.add(at(mesh(box(60 * FT, 1.0, 34 * FT, 0.05), K.frame), 0, 0.5, 0));
  for (let k = 0; k < 6; k++) {
    const x = -7.5 + (k % 3) * 7.5, z = (Math.floor(k / 3) - 0.5) * 5.0;
    const s = mesh(lathe([[0, 1.0], [0.5, 1.0], [2.0, 4.0], [2.0, H - 1.2], [1.4, H - 0.3], [0, H]], { segments: 32, radius: 0.08 }), K.silo);
    g.add(at(s, x, 0, z));
    for (let r = 0; r < 4; r++) g.add(at(cylY(0.08, 3.2, K.frame, 8), x + Math.cos(r * 1.57) * 1.6, 0.8, z + Math.sin(r * 1.57) * 1.6));
  }
  g.add(at(mesh(box(22, 0.5, 0.9, 0.03), K.frame), 0, 1.6, 0));               // belt conveyor under the silos
  const ramp = mesh(box(9, 0.4, 0.9, 0.03), K.frame); ramp.rotation.z = -0.3; g.add(at(ramp, 14.5, 2.9, 0));
  for (const x of [-11, 11]) g.add(at(mesh(box(0.3, H, 0.3, 0.02), K.amber), x, H / 2, 6.0));   // stair towers
  return g;
}

// ---------------------------------------------------------------- missile (manifold trailer)
export function missile(K, n = 6) {
  const g = new THREE.Group();
  const L = Math.max(12, n * 3.3);   // estimate: about 11 ft of manifold per pump pair
  g.add(trailerDeck(K, L, 2.5, 1.0));
  for (const s of [-1, 1]) {
    g.add(at(cylX(0.16, L, K.white, 20), 0, 1.35, s * 0.9));                 // low-pressure suction headers
    for (let k = 0; k < n; k++) g.add(at(cylZ(0.06, 0.6, K.hose, 10), -L / 2 + 1.5 + k * (L - 3) / Math.max(1, n - 1), 1.35, s * 1.35));
  }
  for (const z of [-0.25, 0.25]) g.add(at(cylX(0.06, L + 1, K.iron, 16), 0, 1.75, z));   // high-pressure lines
  for (let k = 0; k < n; k++) for (const s of [-1, 1]) {                     // plug valves on each pump tie-in
    const x = -L / 2 + 1.5 + k * (L - 3) / Math.max(1, n - 1);
    g.add(at(mesh(box(0.25, 0.25, 0.25, 0.03), K.amber), x, 1.75, s * 0.25));
  }
  g.add(wheels(K, [-L / 2 + 1.2]));
  g.userData.length = L;
  return g;
}

// ---------------------------------------------------------------- zipper manifold: one valve stack per well
export function zipper(K, nWells, spacing) {
  const g = new THREE.Group();
  const L = nWells * spacing;
  g.add(at(mesh(box(2.4, 0.3, L, 0.04), K.frame), 0, 0.15, 0));
  g.add(at(cylZ(0.14, L, K.iron, 20), 0, 0.9, 0));                           // header
  for (let k = 0; k < nWells; k++) {
    const z = (k - (nWells - 1) / 2) * spacing;
    g.add(at(mesh(box(0.7, 1.2, 0.7, 0.05), K.treePaint), 0, 1.6, z));      // valve body
    g.add(at(cylX(0.3, 0.15, K.handwheel, 16), 0.5, 1.6, z));
  }
  return g;
}

// ---------------------------------------------------------------- drilling rig (pad rig, walking substructure)
export function drillingRig(K) {
  const g = new THREE.Group();
  const SUB = 9, MAST = 43;   // substructure ~30 ft, mast ~142 ft clear height: estimates
  // substructure: boxes on walking feet, BOP stack beneath the floor
  for (const s of [-1, 1]) g.add(at(mesh(box(14, SUB, 2.2, 0.08), K.rigRed), 0, SUB / 2, s * 3.6));
  g.add(at(mesh(box(12, 0.5, 9.4, 0.06), K.frame), 0, SUB, 0));             // rig floor
  g.add(at(cylY(0.7, 4.5, K.treePaint, 24), 0, 0.2, 0));                     // BOP stack
  g.add(at(cylY(0.8, 0.6, K.treePaint, 24), 0, 2.2, 0));
  // mast: four tapering legs with lattice, crown, monkeyboard, travelling block
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [dx, dz] of legs) {
    const leg = mesh(box(0.35, MAST, 0.35, 0.02), K.rigRed);
    leg.position.set(dx * 2.1, SUB + MAST / 2, dz * 2.1); leg.rotation.set(-dz * 0.03, 0, dx * 0.03); g.add(leg);
  }
  const lat = new THREE.InstancedMesh(box(0.12, 0.12, 4.2, 0.01), K.rigRed, 64);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let k = 0; k < 16; k++) {
    const y = SUB + 1.5 + k * (MAST - 3) / 15, w = 2.1 - k * 0.07;
    for (let f = 0; f < 4; f++) {
      q.setFromEuler(new THREE.Euler(0, f * Math.PI / 2, (k % 2 ? 1 : -1) * 0.5));
      const off = new THREE.Vector3(Math.sin(f * Math.PI / 2) * w, 0, Math.cos(f * Math.PI / 2) * w);
      m.compose(new THREE.Vector3(off.x, y, off.z), q, sc); lat.setMatrixAt(i++, m);
    }
  }
  g.add(lat);
  g.add(at(mesh(box(2.4, 1.2, 2.4, 0.05), K.rigRed), 0, SUB + MAST + 0.6, 0));   // crown
  g.add(at(mesh(box(3.0, 0.2, 1.4, 0.02), K.galv), 1.6, SUB + 27, 0));          // monkeyboard
  g.add(at(mesh(box(0.9, 2.2, 0.9, 0.05), K.amber), 0, SUB + 16, 0));           // travelling block / top drive
  g.add(at(cylY(0.04, MAST - 18, K.galv, 6), 0, SUB + 17, 0));                 // drill line
  // drawworks, doghouse, catwalk and V-door, pipe racks
  g.add(at(mesh(box(4.5, 2.6, 3.0, 0.08), K.rigRed), -4.0, SUB + 1.6, 0));
  g.add(at(mesh(box(5, 3, 3, 0.08), K.white), -3.0, SUB + 1.5, 4.5));
  const vd = mesh(box(14, 0.4, 1.4, 0.03), K.frame); vd.rotation.z = 0.55; g.add(at(vd, 11, SUB / 2, 0));
  g.add(at(mesh(box(14, 1.0, 1.4, 0.04), K.frame), 21, 0.6, 0));
  for (const s of [-1, 1]) {
    g.add(at(mesh(box(13, 0.3, 4, 0.03), K.frame), 21, 1.0, s * 4));
    const pipes = new THREE.InstancedMesh(cylX(0.06, 12.5, K.iron, 8).geometry, K.iron, 30);
    for (let p = 0; p < 30; p++) { m.makeTranslation(21, 1.25 + Math.floor(p / 10) * 0.13, s * 4 - 1.6 + (p % 10) * 0.36); pipes.setMatrixAt(p, m); }
    g.add(pipes);
  }
  // mud system: pits, shakers, pumps, generators
  for (let k = 0; k < 4; k++) g.add(at(mesh(box(12, 2.6, 3, 0.06), K.white), -14 + k * 0.2, 1.3, -10 + k * 3.4));
  for (let k = 0; k < 2; k++) g.add(at(mesh(box(5.5, 2.6, 2.6, 0.06), K.white), -24, 1.3, -8 + k * 3.2));   // mud pumps
  for (let k = 0; k < 3; k++) g.add(at(mesh(box(6, 2.8, 2.6, 0.06), K.amber), -24, 1.4, 4 + k * 3.0));     // generators
  g.add(at(mesh(box(3, 2.2, 2, 0.05), K.galv), -6.5, SUB - 1.1, -6));        // shakers
  return g;
}
