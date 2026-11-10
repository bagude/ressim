// Geometry kit: every part in the game is built from these helpers.
// Units: 1 scene unit = 1 metre. Dimensions are written in the units of their source (usually inches) and converted here.
//
// Every geometry built here carries two float attributes the wear shader reads:
//   aEdge   1 on convex edges and fillets (paint chips, polish), 0 elsewhere
//   aCavity 1 in concave corners (grime, dirt), 0 elsewhere
// They are written at build time from the construction itself, never estimated from the mesh afterwards.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const IN = 0.0254;

// Geometry detail multiplier. 1 in the workshop; lower for pad-scale scenes so a spread of identical units stays light.
let DETAIL = 1;
export function setDetail(d) { DETAIL = d; }
export const FT = 0.3048;

// ---------------------------------------------------------------- profiles
// A profile is a list of [r, y] points in metres, walked from the bottom of the axis to the top (or around a closed
// section). roundProfile replaces every corner with a small arc so lathe normals never smear across a flat face,
// and tags each arc point as convex (edge) or concave (cavity).
export function roundProfile(pts, radius = 0.004, arcSteps = 3, closed = false) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector2(...pts[i]);
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd || radius <= 0) { out.push({ p, edge: 0, cav: 0 }); continue; }
    const a = new THREE.Vector2(...pts[(i - 1 + n) % n]);
    const b = new THREE.Vector2(...pts[(i + 1) % n]);
    const da = a.clone().sub(p), db = b.clone().sub(p);
    const la = da.length(), lb = db.length();
    if (la < 1e-6 || lb < 1e-6) continue;
    da.divideScalar(la); db.divideScalar(lb);
    const cosT = THREE.MathUtils.clamp(da.dot(db), -1, 1);
    const theta = Math.acos(cosT);                       // interior angle at the corner
    if (Math.abs(Math.PI - theta) < 0.02) { out.push({ p, edge: 0, cav: 0 }); continue; }  // straight through
    const r = Math.min(radius, 0.45 * la, 0.45 * lb);
    const d = r / Math.tan(theta / 2);                     // tangent distance from the corner
    const t0 = p.clone().addScaledVector(da, d);
    const t1 = p.clone().addScaledVector(db, d);
    // convexity: turning direction of the walk relative to the outward side (outward = +r for a lathe profile)
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    const convex = cross > 0;   // left turn while walking with the outside on the right
    const bis = da.clone().add(db).normalize();
    const c = p.clone().addScaledVector(bis, r / Math.sin(theta / 2));
    const a0 = Math.atan2(t0.y - c.y, t0.x - c.x);
    let a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    let dA = a1 - a0;
    while (dA > Math.PI) dA -= 2 * Math.PI;
    while (dA < -Math.PI) dA += 2 * Math.PI;
    for (let k = 0; k <= arcSteps; k++) {
      const ang = a0 + dA * (k / arcSteps);
      const q = new THREE.Vector2(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
      out.push({ p: q, edge: convex ? 1 : 0, cav: convex ? 0 : 1 });
    }
  }
  // Faces have no interior vertices, so an edge tag would interpolate across the whole face. Pin the tag down to a
  // narrow band next to each arc by inserting untagged points a short way along every long straight run.
  const band = Math.max(radius * 2.5, 0.003);
  const res = [];
  for (let k = 0; k < out.length; k++) {
    const a = out[k], b = out[k + 1];
    res.push(a);
    if (!b) break;
    const L = a.p.distanceTo(b.p);
    if (L > band * 2.2 && (a.edge || a.cav || b.edge || b.cav)) {
      res.push({ p: a.p.clone().lerp(b.p, band / L), edge: 0, cav: 0 });
      res.push({ p: a.p.clone().lerp(b.p, 1 - band / L), edge: 0, cav: 0 });
    }
  }
  return res;
}

// Lathe a profile around +Y. pts: [[r, y], ...] metres. segments: radial resolution (6 gives a hex nut).
export function lathe(pts, { segments = 64, radius = 0.004, arcSteps = 3, phi0 = 0, phiLen = Math.PI * 2 } = {}) {
  if (segments > 8) segments = Math.max(8, Math.round(segments * DETAIL));   // hex nuts (6) keep their flats
  if (DETAIL < 1) arcSteps = Math.max(1, Math.round(arcSteps * DETAIL));
  const prof = roundProfile(pts, radius, arcSteps);
  const geo = new THREE.LatheGeometry(prof.map(o => o.p), segments, phi0, phiLen);
  const cols = segments + 1;
  const edge = new Float32Array(geo.attributes.position.count);
  const cav = new Float32Array(geo.attributes.position.count);
  // LatheGeometry lays vertices out segment-major: index = seg * nProfile + j
  for (let s = 0; s < cols; s++) {
    for (let j = 0; j < prof.length; j++) {
      edge[s * prof.length + j] = prof[j].edge;
      cav[s * prof.length + j] = prof[j].cav;
    }
  }
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geo.setAttribute('aCavity', new THREE.BufferAttribute(cav, 1));
  return geo;   // LatheGeometry's own normals already follow the filleted profile and handle the seam

}

// Rounded box with edge tags (every vertex within the bevel radius of two or more faces is an edge).
export function box(w, h, d, radius = 0.006, segs = 3) {
  const geo = new RoundedBoxGeometry(w, h, d, segs, Math.min(radius, w / 2.2, h / 2.2, d / 2.2));
  // RoundedBoxGeometry has no vertices inside its flat faces, so tag by normal instead of position:
  // a vertex whose normal is axis-aligned sits on a flat face (0); anything on the bevel is an edge (1).
  const nrm = geo.attributes.normal;
  const edge = new Float32Array(nrm.count);
  for (let i = 0; i < nrm.count; i++) {
    const m = Math.max(Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i)));
    edge[i] = THREE.MathUtils.smoothstep(0.9995 - m, 0, 0.08);
  }
  const pos = geo.attributes.position;
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geo.setAttribute('aCavity', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  return geo;
}

// Tube along a curve (hoses, bent pipe). Ends are left open; cap them with lathe parts when visible.
export function tube(curve, radius, { tubular = 64, radial = 16 } = {}) {
  const geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  return tagFlat(geo);
}

export function tagFlat(geo, edgeValue = 0) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(n).fill(edgeValue), 1));
  geo.setAttribute('aCavity', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geo;
}

export function merge(geos) {
  const g = mergeGeometries(geos.map(x => x.index ? x.toNonIndexed() : x), false);
  geos.forEach(x => x.dispose());
  return g;
}

// ---------------------------------------------------------------- standard parts

// Hex nut, across-flats `af` metres, height h, with chamfered faces (lathe with 6 segments).
export function hexNutGeometry(af, h) {
  const rc = af / 2 / Math.cos(Math.PI / 6);       // across-corners radius
  const ch = rc - af / 2 * 0.98;                    // 30-degree chamfer that just touches the flats
  const hole = af * 0.34;
  const g = lathe([[hole, 0], [rc - ch, 0], [rc, ch * 0.6], [rc, h - ch * 0.6], [rc - ch, h], [hole, h], [hole, 0]],
    { segments: 6, radius: 0.0012, arcSteps: 2, phi0: Math.PI / 6 });
  const flat = g.toNonIndexed();   // hex flats must shade flat, not as a smoothed cylinder
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

// Threaded stud: a cylinder whose thread is drawn by the material (thread pitch in metres via uv repeat).
export function studGeometry(d, len) {
  const r = d / 2;
  return lathe([[0, 0], [r * 0.85, 0], [r, r * 0.15], [r, len - r * 0.15], [r * 0.85, len], [0, len]],
    { segments: 20, radius: 0.0008, arcSteps: 1 });
}

// A ring of instanced studs with a nut on each end. Returns a Group that travels with whatever it is parented to.
export function studRing({ count, boltCircle, studDia, studLen, nutAF, nutH, y0, matStud, matNut, phase = 0 }) {
  const grp = new THREE.Group();
  const studs = new THREE.InstancedMesh(studGeometry(studDia, studLen), matStud, count);
  const nuts = new THREE.InstancedMesh(hexNutGeometry(nutAF, nutH), matNut, count * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const a = phase + (i + 0.5) * Math.PI * 2 / count;
    const x = Math.cos(a) * boltCircle / 2, z = Math.sin(a) * boltCircle / 2;
    m.compose(new THREE.Vector3(x, y0 - studLen / 2, z), q, s); studs.setMatrixAt(i, m);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 3.7 % (Math.PI / 3));  // nuts are not all aligned
    return_nut(nuts, 2 * i, x, y0 - studLen / 2 + nutH * 0.35, z, q, m, s);
    return_nut(nuts, 2 * i + 1, x, y0 + studLen / 2 - nutH * 1.35, z, q, m, s);
    q.identity();
  }
  studs.castShadow = nuts.castShadow = true;
  studs.receiveShadow = nuts.receiveShadow = true;
  grp.add(studs, nuts);
  return grp;
}
function return_nut(nuts, i, x, y, z, q, m, s) {
  m.compose(new THREE.Vector3(x, y, z), q, s);
  nuts.setMatrixAt(i, m);
}

export function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const o = new THREE.Mesh(geo, mat);
  o.castShadow = cast; o.receiveShadow = receive;
  return o;
}

// ---------------------------------------------------------------- baking for scenes with many identical units
// Flattens an assembly into one geometry per material (world transforms applied, instanced children expanded) and
// returns one InstancedMesh per material holding every placement. 300 draw calls per pump trailer become ~15 for a
// whole spread. Animated parts are frozen in place; use this only where nothing needs to move.
export function bakeInstanced(root, placements, { minRadius = 0 } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const m = new THREE.Matrix4(), mi = new THREE.Matrix4();
  const push = (mat, geo, matrix) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    const n = g.attributes.position.count;
    for (const [name, size] of [['uv', 2], ['aEdge', 1], ['aCavity', 1]]) {
      if (!g.attributes[name]) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * size), size));
    }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aEdge', 'aCavity'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat).push(g);
  };
  const scl = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (minRadius > 0) {   // skip parts too small to see at this scale (studs, nuts, lugs, fittings)
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scl);
      if (o.geometry.boundingSphere.radius * Math.max(scl.x, scl.y, scl.z) < minRadius) return;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.length > 1) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mi); push(mats[0], o.geometry, new THREE.Matrix4().multiplyMatrices(m, mi)); }
    } else push(mats[0], o.geometry, m.clone());
  });
  const out = new THREE.Group();
  for (const [mat, geos] of groups) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    const im = new THREE.InstancedMesh(merged, mat, placements.length);
    placements.forEach((p, i) => im.setMatrixAt(i, p));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    out.add(im);
  }
  return out;
}
