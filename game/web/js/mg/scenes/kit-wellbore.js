// Wellbore-cutaway kit shared by the lift, gas-lift, well-test, kick, frac-hit and diagnostics scenes.
// Conventions: y up, y = 0 at the surface, depths to scale at the scene's ft-per-unit; pipe, wellheads and surface
// equipment are drawn far wider than that scale (a 2-7/8 in tubing at 300 ft per unit would be invisible), and every
// scene says so in its description. Proportions of the surface equipment are estimated, not from a data sheet.
// Casing and hole are drawn as the back half of a cylinder, so the camera looks into the well.

export function kit(ctx) {
  const { THREE, stage } = ctx;
  if (!ctx.root) {
    stage.gtao.enabled = false; stage.bloom.strength = 0.1; stage.scene.fog = null;
    ctx.root = new THREE.Group(); stage.scene.add(ctx.root);
  }
  const root = ctx.root;
  ctx.offs = ctx.offs || [];
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, ...o });
  const mats = {
    steel: M({ color: '#b9b6ae', metalness: 0.75, roughness: 0.35 }),
    casing: M({ color: '#8d969c', metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }),
    hole: M({ color: '#5a4a3a', roughness: 0.95, side: THREE.DoubleSide }),
    rock: M({ color: '#3a4550', roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    pay: M({ color: '#9a8a62', roughness: 1, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    paint: M({ color: '#c98322', roughness: 0.5, metalness: 0.2 }),
    red: M({ color: '#c8432f', roughness: 0.5, metalness: 0.2 }),
    dark: M({ color: '#2a3138', roughness: 0.7 }),
  };
  const K = {
    THREE, root, mats,
    // clear the scene before a redraw: meshes, labels and any per-frame updaters the last draw registered
    reset() { for (const f of ctx.offs) f(); ctx.offs.length = 0; root.clear(); ctx.clearLabels(); },
    on(fn) { const off = stage.onUpdate(fn); ctx.offs.push(off); return off; },
    add(o) { root.add(o); return o; },
    // a vertical pipe from y0 to y1 (y1 below y0); cut = back half only, so the inside shows
    pipe(y0, y1, r, mat, { cut = false, x = 0, z = 0 } = {}) {
      const h = Math.max(1e-3, y0 - y1);
      const g = cut ? new THREE.CylinderGeometry(r, r, h, 32, 1, true, Math.PI / 2, Math.PI) : new THREE.CylinderGeometry(r, r, h, 20);
      const m = new THREE.Mesh(g, mat); m.position.set(x, (y0 + y1) / 2, z); root.add(m); return m;
    },
    // a pipe between two points (laterals, flowlines)
    seg(a, b, r, mat, cut = false) {
      const d = new THREE.Vector3().subVectors(b, a), h = d.length();
      const g = cut ? new THREE.CylinderGeometry(r, r, h, 32, 1, true, Math.PI / 2, Math.PI) : new THREE.CylinderGeometry(r, r, h, 16);
      const m = new THREE.Mesh(g, mat); m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); root.add(m); return m;
    },
    box(w, h, d, mat, pos) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(pos); root.add(m); return m; },
    // fluid moving along a polyline: small spheres; .speed is in polyline lengths per second (0 = still)
    flow(points, { n = 40, color = '#f0a53a', r = 0.08, speed = 0.1, emissive = null } = {}) {
      const P = points.map(p => p.clone()), L = [0];
      for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
      const tot = L.at(-1) || 1;
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), M({ color, emissive: emissive || color, emissiveIntensity: 0.35 }), n);
      root.add(mesh);
      const s = Array.from({ length: n }, (_, i) => i / n), m4 = new THREE.Matrix4(), v = new THREE.Vector3();
      const at = (u) => { const d = u * tot; let i = 1; while (i < L.length - 1 && L[i] < d) i++; const t = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1); return v.lerpVectors(P[i - 1], P[i], Math.min(1, Math.max(0, t))); };
      const F = { mesh, speed, place() { s.forEach((u, i) => { m4.makeTranslation(at(u)); mesh.setMatrixAt(i, m4); }); mesh.instanceMatrix.needsUpdate = true; } };
      F.place();
      if (!ctx.reduced) K.on((dt) => { if (!F.speed || !mesh.visible) return; for (let i = 0; i < n; i++) s[i] = (s[i] + F.speed * dt) % 1; F.place(); });
      return F;
    },
    // a vertical depth ruler at x with labelled ticks [{y, text}]
    ruler(x, ticks, z = 0) {
      const ys = ticks.map(t => t.y), top = Math.max(...ys), bot = Math.min(...ys);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, top, z), new THREE.Vector3(x, bot, z)]), new THREE.LineBasicMaterial({ color: '#6f7d87' }));
      root.add(line);
      for (const t of ticks) {
        root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - 0.25, t.y, z), new THREE.Vector3(x + 0.25, t.y, z)]), new THREE.LineBasicMaterial({ color: '#9aa6ae' })));
        if (t.text) ctx.label(t.text, new THREE.Vector3(x + 0.3, t.y, z), 'muted');   // labels sit right of their anchor (the shell's rule)
      }
    },
    // a label whose text can change every frame (the shell re-measures it when w is cleared)
    text(L, s) { if (L.el.textContent !== s) { L.el.textContent = s; L.w = 0; } },
    // step through n states over `secs`, hold the last one, loop. Reduced motion: show the last state only.
    timeline(n, secs, fn, { hold = 2 } = {}) {
      if (!n) return;
      if (ctx.reduced || n === 1) { fn(n - 1, true); return; }
      let t = 0, last = -1;
      K.on((dt) => {
        t += dt; if (t > secs + hold) { t = 0; last = -1; }
        const i = Math.min(n - 1, Math.floor(t / secs * n));
        if (i !== last) { last = i; fn(i, i === n - 1); }
      });
    },
    // a production tree, drawn wide (estimated proportions): master valve block, wing, cap
    tree(y = 0, s = 1, open = true) {
      const g = new THREE.Group(); g.position.y = y; root.add(g);
      const b = (w, h, d, mat, x, yy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), mat); m.position.set(x * s, yy * s, 0); g.add(m); return m; };
      b(1.6, 0.35, 1.6, mats.steel, 0, 0.18);          // casing head flange
      b(0.7, 1.4, 0.7, mats.steel, 0, 1.05);           // master valves
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32 * s, 0.05 * s, 6, 20), open ? mats.paint : mats.red); wheel.position.set(0.55 * s, 1.0 * s, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel);
      b(1.2, 0.35, 0.35, mats.steel, 0.8, 1.55);       // wing toward the flowline
      b(0.5, 0.4, 0.5, mats.steel, 0, 1.95);           // tree cap (gauge goes here)
      return g;
    },
  };
  return K;
}

// A broken depth axis: the zones that matter ([[d0, d1], ...] in ft) at ftPerUnit, the long stretches between them squeezed
// into `gap` units each and marked with a break. Monotonic, so columns and paths that cross a break still read right.
// Returns {Y(d), breaks: [{y0, y1, from, to}]}.
export function depthMap(zones, { ftPerUnit = 150, gap = 1.2, td = null } = {}) {
  const Z = zones.map(([a, b]) => [Math.max(0, a), b]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const M = [];
  for (const z of Z) { const l = M.at(-1); if (l && (z[0] - l[1]) / ftPerUnit < gap * 1.5) l[1] = Math.max(l[1], z[1]); else M.push([...z]); }
  if (td != null && M.length && M.at(-1)[1] < td) M.at(-1)[1] = td;
  const knots = [];   // [depth, y]
  let y = 0;
  M.forEach(([a, b], i) => {
    if (i === 0) { if (a > 0) { knots.push([0, 0]); y = -gap; } knots.push([a, y]); }
    else { y -= gap; knots.push([a, y]); }
    y -= (b - a) / ftPerUnit; knots.push([b, y]);
  });
  const breaks = [];
  for (let i = 1; i < knots.length; i++) if (knots[i][0] - knots[i - 1][0] > 0 && Math.abs((knots[i][1] - knots[i - 1][1]) * ftPerUnit) < (knots[i][0] - knots[i - 1][0]) * 0.99)
    breaks.push({ y0: knots[i - 1][1], y1: knots[i][1], from: knots[i - 1][0], to: knots[i][0] });
  const Y = (d) => {
    if (d <= knots[0][0]) return knots[0][1] - (d - knots[0][0]) / ftPerUnit;
    for (let i = 1; i < knots.length; i++) if (d <= knots[i][0]) { const [d0, y0] = knots[i - 1], [d1, y1] = knots[i]; return y0 + (y1 - y0) * (d - d0) / ((d1 - d0) || 1); }
    const [dl, yl] = knots.at(-1); return yl - (d - dl) / ftPerUnit;
  };
  return { Y, breaks, ftPerUnit };
}

// draw the breaks of a depthMap across a well of half-width w at x: two zigzags and the omitted interval
export function drawBreaks(K, ctx, map, { x = 0, w = 1.2, z = 0.4, labelX = null } = {}) {
  const { THREE } = K;
  for (const b of map.breaks) {
    for (const yy of [b.y0 - 0.15, b.y1 + 0.15]) {
      const pts = []; for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(x - w + (2 * w * i) / 8, yy + (i % 2 ? 0.12 : -0.12), z));
      K.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e8e2d4' })));
    }
    ctx.label(`${n0(b.to - b.from)} ft not drawn`, new THREE.Vector3(labelX ?? x + w + 0.2, (b.y0 + b.y1) / 2, z), 'muted');
  }
}

// fmt helpers used by the labels
export const n0 = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x).toLocaleString('en-US'));
export const n1 = (x) => (x == null || !isFinite(x) ? '–' : (Math.round(x * 10) / 10).toLocaleString('en-US'));
