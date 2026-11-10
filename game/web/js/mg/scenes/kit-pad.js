// Shared parts for the pad-surface scenes (flowback, facility, water, rig contracts). Scale: 1 unit = 1 metre.
// The equipment is schematic: shapes and sizes are typical of US land operations, each noted with its source or
// marked "estimated". The layout on the pad is schematic too; what the scenes animate (rates, levels, counts) comes from
// the game's view, never from here.
const FT = 0.3048;

export function kit(ctx) {
  const { THREE, stage } = ctx;
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...o });
  const mat = {
    gravel: M('#5d5a52', { roughness: 0.98 }), dirt: M('#4a4236', { roughness: 1 }),
    steel: M('#b9b7af', { metalness: 0.6, roughness: 0.4 }), paint: M('#d8d4c8', { roughness: 0.55 }),
    green: M('#4f6b4a'), red: M('#a8483c'), blue: M('#3d6f9e'), yellow: M('#d1a33a'), dark: M('#2c3238'),
    water: M('#2f6f8f', { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    brine: M('#5b6e55', { roughness: 0.2, transparent: true, opacity: 0.9 }),
    oil: new THREE.MeshBasicMaterial({ color: '#c98322' }), gas: new THREE.MeshBasicMaterial({ color: '#7fb6e8' }),
    wat: new THREE.MeshBasicMaterial({ color: '#5fa8c8' }), fresh: new THREE.MeshBasicMaterial({ color: '#9fd4ff' }),
    flame: new THREE.MeshBasicMaterial({ color: '#ffb04a', transparent: true, opacity: 0.9 }),
  };
  const offs = [];
  const K = {
    THREE, mat, FT,
    // phones: short labels, muted ones dropped (the description under the canvas keeps the full numbers)
    get narrow() { return stage.canvas.clientWidth < 520; },
    label(long, short, pos, cls = '') { if (K.narrow && cls === 'muted' && short == null) return null; return ctx.label(K.narrow && short ? short : long, pos, cls); },
    // remove everything a previous draw added (meshes and per-frame updaters)
    reset(root) { offs.splice(0).forEach(f => f()); root.clear(); ctx.clearLabels(); },
    tick(fn) { const off = stage.onUpdate(fn); offs.push(off); return off; },
    // change a label's text in place (the shell re-measures it when w is cleared)
    text(L, t, cls) { if (!L) return; L.el.textContent = t; if (cls != null) L.el.className = `lbl ${cls}`; L.w = 0; },
    // play a time-lapse once over `seconds`, calling show(i) for each step; reduced motion shows the last step at once
    lapse(steps, seconds, show) {
      if (ctx.reduced || steps <= 1) { show(steps - 1); return; }
      let t = 0, last = -1; show(0);
      const off = K.tick((dt) => { t += dt / seconds; const i = Math.min(steps - 1, Math.floor(t * steps)); if (i !== last) { last = i; show(i); } if (t >= 1) off(); });
    },
    add(parent, geo, m, [x, y, z] = [0, 0, 0], cast = true) {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; parent.add(o); return o;
    },
    ground(parent, w, d, m = mat.gravel) { const g = K.add(parent, new THREE.BoxGeometry(w, 0.3, d), m, [0, -0.15, 0], false); return g; },
    // wellhead and production tree, ~2.4 m tall (estimated from typical 5,000 psi trees: master valves, tee, wing valve)
    wellhead(parent, [x, z], label) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      K.add(g, new THREE.CylinderGeometry(0.35, 0.35, 0.5, 20), mat.steel, [0, 0.25, 0]);           // casing head
      K.add(g, new THREE.CylinderGeometry(0.14, 0.14, 1.9, 16), mat.red, [0, 1.35, 0]);              // tree body
      for (const y of [0.9, 1.5]) K.add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.18, 16), mat.steel, [0, y, 0]);   // master valves
      const wing = K.add(g, new THREE.CylinderGeometry(0.08, 0.08, 0.8, 12), mat.red, [0.4, 1.95, 0]); wing.rotation.z = Math.PI / 2;
      K.add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16), mat.steel, [0, 2.35, 0]);              // cap
      if (label) ctx.label(label, new THREE.Vector3(x, 3, z));
      return g;
    },
    // horizontal three-phase separator: 36 in OD x 10 ft seam to seam on a skid (estimated, a common small-pad size)
    separator(parent, [x, z], { od = 36 * 0.0254, len = 10 * FT } = {}) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      const body = K.add(g, new THREE.CapsuleGeometry(od / 2, len, 8, 24), mat.paint, [0, 1.3, 0]); body.rotation.z = Math.PI / 2;
      K.add(g, new THREE.BoxGeometry(len + od, 0.15, od * 1.4), mat.dark, [0, 0.1, 0]);
      for (const s of [-1, 1]) K.add(g, new THREE.BoxGeometry(0.15, 1.2, 0.15), mat.dark, [s * len * 0.35, 0.6, 0]);
      return g;
    },
    // API 12F stock tank, 400 bbl: 12 ft OD x 20 ft high (API Spec 12F table of standard sizes)
    tank(parent, [x, z], { od = 12 * FT, hgt = 20 * FT, m = mat.green } = {}) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      K.add(g, new THREE.CylinderGeometry(od / 2, od / 2, hgt, 32), m, [0, hgt / 2, 0]);
      K.add(g, new THREE.CylinderGeometry(od / 2 * 0.98, od / 2, 0.25, 32), mat.dark, [0, hgt + 0.12, 0]);
      return g;
    },
    // flare stack, 40 ft (estimated); flame() sizes a flame on it from a rate
    flare(parent, [x, z], hgt = 40 * FT) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      K.add(g, new THREE.CylinderGeometry(0.2, 0.25, hgt, 16), mat.steel, [0, hgt / 2, 0]);
      K.add(g, new THREE.CylinderGeometry(0.32, 0.2, 0.6, 16), mat.dark, [0, hgt, 0]);
      g.userData.tip = hgt + 0.3; return g;
    },
    flame(stack, size) {
      if (!(size > 0)) return null;
      const f = K.add(stack, new THREE.ConeGeometry(0.6 * size, 3 * size, 16, 1, true), mat.flame, [0, stack.userData.tip + 1.5 * size, 0], false);
      if (!ctx.reduced) K.tick((dt, t) => { const s = 1 + 0.12 * Math.sin(t * 13) + 0.06 * Math.sin(t * 29); f.scale.set(1 / s, s, 1 / s); });
      return f;
    },
    // compressor skid, ~6 x 2.5 x 2.5 m (estimated, small gas-lift or VRU package)
    compressor(parent, [x, z]) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      K.add(g, new THREE.BoxGeometry(6, 0.2, 2.5), mat.dark, [0, 0.1, 0]);
      K.add(g, new THREE.BoxGeometry(5.6, 2.3, 2.3), mat.yellow, [0, 1.35, 0]);
      K.add(g, new THREE.CylinderGeometry(0.25, 0.25, 1, 12), mat.dark, [2, 3, 0]);
      return g;
    },
    // a pipe along a polyline at height y; returns the curve, so flow() can move particles along it
    pipe(parent, pts, { r = 0.1, m = mat.steel, y = 0.5 } = {}) {
      const V = pts.map(([x, z, yy]) => new THREE.Vector3(x, yy ?? y, z));
      const path = new THREE.CurvePath(); for (let i = 1; i < V.length; i++) path.add(new THREE.LineCurve3(V[i - 1], V[i]));
      for (let i = 1; i < V.length; i++) {
        const a = V[i - 1], b = V[i], L = a.distanceTo(b); if (L < 1e-6) continue;
        const o = K.add(parent, new THREE.CylinderGeometry(r, r, L, 10), m, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      }
      return path;
    },
    // beads moving along a pipe: count from the rate (density shows how much), speed fixed. share in 0..1.
    // reduced motion: the beads stay still, spread along the pipe, so the density still reads.
    // returns { set(share) } so a time-lapse can change the rate without rebuilding
    flow(parent, path, share, m, { max = 40, r = 0.3 } = {}) {
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), m, max); parent.add(im);
      let n = 0, off = 0;
      const L = path.getLength(), d = new THREE.Object3D(), place = () => {
        for (let i = 0; i < n; i++) { d.position.copy(path.getPointAt(((i / n) + off) % 1)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
        im.count = n; im.instanceMatrix.needsUpdate = true;
      };
      const set = (s) => { n = Math.round(Math.max(0, Math.min(1, s || 0)) * max); place(); };
      set(share);
      if (!ctx.reduced) K.tick((dt) => { if (!n) return; off = (off + dt * 4 / L) % 1; place(); });
      return { set, mesh: im };
    },
    // vacuum or water truck, ~11 x 2.6 x 3.6 m, ~130 bbl (estimated)
    truck(parent, color = '#c9c6bd') {
      const g = new THREE.Group(); parent.add(g);
      K.add(g, new THREE.BoxGeometry(2.4, 2.6, 2.5), M(color), [4.2, 1.6, 0]);
      const t = K.add(g, new THREE.CylinderGeometry(1.15, 1.15, 7.2, 20), mat.steel, [-0.6, 2.0, 0]); t.rotation.z = Math.PI / 2;
      K.add(g, new THREE.BoxGeometry(10.5, 0.4, 2.3), mat.dark, [0, 0.7, 0]);
      return g;
    },
    // land drilling rig, 1,500 hp class: mast ~142 ft over a ~30 ft substructure (estimated from public rig spec sheets)
    rig(parent, [x, z], { color = '#c94f3a', idle = false } = {}) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      const sub = 30 * FT, mast = 142 * FT;
      K.add(g, new THREE.BoxGeometry(12, sub, 10), mat.dark, [0, sub / 2, 0]);
      const m = new THREE.Group(); m.position.set(0, sub, 0); g.add(m);
      const leg = (dx, dz) => { const o = K.add(m, new THREE.BoxGeometry(0.5, mast, 0.5), M(color), [dx, mast / 2, dz]); return o; };
      leg(-2.2, -2.2); leg(2.2, -2.2); leg(-1, 2.2); leg(1, 2.2);
      for (let y = 6; y < mast; y += 6) K.add(m, new THREE.BoxGeometry(4.8, 0.25, 4.8), M(color), [0, y, 0]);
      K.add(m, new THREE.BoxGeometry(3, 2, 3), mat.dark, [0, mast + 1, 0]);
      if (idle) m.rotation.x = -Math.PI / 2 * 0.98;   // mast laid down: on standby, not drilling
      return g;
    },
    // a lined pit or pond: w x d metres, depth in metres; level() sets the fill 0..1 (from the view)
    pit(parent, [x, z], w, d, depth, m = mat.water) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      const wall = M('#3b3a34');
      for (const [sx, sz, ww, dd] of [[0, d / 2, w + 1, 1], [0, -d / 2, w + 1, 1], [w / 2, 0, 1, d], [-w / 2, 0, 1, d]]) K.add(g, new THREE.BoxGeometry(ww, depth, dd), wall, [sx, depth / 2, sz]);
      K.add(g, new THREE.BoxGeometry(w, 0.1, d), M('#22201c'), [0, 0.05, 0], false);
      const s = K.add(g, new THREE.BoxGeometry(w - 0.2, 1, d - 0.2), m, [0, 0, 0], false);
      g.userData.level = (f) => { const h = Math.max(0.02, Math.min(1, f)) * depth; s.scale.y = h; s.position.y = h / 2 + 0.1; };
      g.userData.level(0);
      return g;
    },
  };
  return K;
}

// numbers for labels
export const n0 = (x) => Math.round(x ?? 0).toLocaleString('en-US');
export const kbbl = (x) => `${(Math.round((x ?? 0) / 1000)).toLocaleString('en-US')}k bbl`;
