// Map kit for the land games: section tiles on the ground, lease lines, and well paths drawn on the surface the way the
// career map draws them (pad at the surface location, heel to toe, a tick at the bottom-hole end).
// Frame: 1 unit = 100 ft. x east, z south, from the NW corner of the first tile. Sections are 5,280 ft (one square mile, 640 acres).
// Well geometry follows the server's slot rule (game/README and the career field): laterals run north-south, the heel sits
// 300 ft inside the north line, slot k of n sits at x = (k + 0.5) * 5280 / n, and the toe stops 300 ft short of the south line.
export const U = 100, SEC_FT = 5280, INSET_FT = 300;
export const SEC = SEC_FT / U;
// series colours in fixed order (the game's validated palette): you first, then the rivals in the order the view lists them
export const OWNER = ['#c98322', '#3d8be0', '#b7678f', '#5fa85e'];

export function ownerColor(name, rivals = []) {
  if (name === 'You') return OWNER[0];
  const i = rivals.indexOf(name);
  return i < 0 ? '#8a949c' : OWNER[1 + (i % 3)];
}

// a section tile: a thin ground slab with an outline (dashed for an open lease)
export function tile(ctx, root, { x, z, size = SEC, color = '#3a4636', fill = null, fillOpacity = 0.55, dashed = false, line = '#d9cfb8' }) {
  const { THREE } = ctx, g = new THREE.Group();
  g.position.set(x + size / 2, 0, z + size / 2); root.add(g);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(size, 0.6, size), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  ground.position.y = -0.3; g.add(ground);   // no shadows: at map scale they only add acne
  if (fill) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.96, size * 0.96), new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: fillOpacity, depthWrite: false }));
    f.rotation.x = -Math.PI / 2; f.position.y = 0.3; g.add(f); g.userData.fill = f;   // layers sit 0.3+ apart: the depth buffer resolves ~0.06 units at map distance
  }
  const h = size / 2, pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([a, b]) => new THREE.Vector3(a, 0.45, b));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed ? new THREE.LineDashedMaterial({ color: line, dashSize: 2.4, gapSize: 1.6 }) : new THREE.LineBasicMaterial({ color: line });
  const outline = new THREE.Line(geo, mat); if (dashed) outline.computeLineDistances(); g.add(outline);
  return g;
}

// the x position of slot k of n inside a section, in units from the section's west line
export const slotX = (k, n) => (k + 0.5) * SEC / n;

// a well on the map: pad at the heel, path heel to toe, tick at the toe. planned = dashed and dim.
export function well(ctx, root, { x, z0, lateralFt = null, planned = false, color = '#e9e2d0' }) {
  const { THREE } = ctx, g = new THREE.Group(); root.add(g);
  const heel = z0 + INSET_FT / U, maxToe = z0 + SEC - INSET_FT / U, toe = lateralFt ? Math.min(heel + lateralFt / U, maxToe) : maxToe;
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.6, heel), new THREE.Vector3(x, 0.6, toe)]);
  const mat = planned ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 1, transparent: true, opacity: 0.6 }) : new THREE.LineBasicMaterial({ color });
  const ln = new THREE.Line(geo, mat); if (planned) ln.computeLineDistances(); g.add(ln);
  // pad: 300 x 400 ft is a typical multi-well pad footprint (estimated); drawn small so it reads as a symbol
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), new THREE.MeshStandardMaterial({ color: planned ? '#6b6f68' : '#cfc6b0', roughness: 0.9 }));
  pad.position.set(x, 0.6, heel - 0.9); g.add(pad);
  const tick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - 0.8, 0.6, toe), new THREE.Vector3(x + 0.8, 0.6, toe)]);
  g.add(new THREE.Line(tick, new THREE.LineBasicMaterial({ color, transparent: planned, opacity: planned ? 0.6 : 1 })));
  return { g, heel, toe };
}

// a flat production bubble on the map (area proportional to the value: a map symbol, not a bar)
export function bubble(ctx, root, { x, z, r, color = '#3d8be0' }) {
  const { THREE } = ctx;
  const m = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.3, r), 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.75, z); root.add(m);
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.3, r) - 0.12, Math.max(0.3, r), 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.9, z); root.add(ring);
  return m;
}

// fade new objects in (skipped when the viewer prefers reduced motion)
export function fadeIn(ctx, groups, seconds = 0.9) {
  if (ctx.reduced || !groups.length) return;
  const mats = [];
  for (const g of groups) g.traverse(o => { if (o.material) for (const m of [].concat(o.material)) { mats.push([m, m.opacity ?? 1, m.transparent]); m.transparent = true; m.opacity = 0; } });
  let t = 0;
  const off = ctx.stage.onUpdate((dt) => {
    t = Math.min(1, t + dt / seconds);
    for (const [m, o] of mats) m.opacity = o * t;
    if (t >= 1) { for (const [m, o, tr] of mats) { m.opacity = o; m.transparent = tr; } off(); }
  });
}

export const mm = (usd) => `$${(usd / 1e6).toFixed(1)} MM`;
