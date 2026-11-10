// Land auction in 3D: the lease map. One section tile per tract (view.tracts), a row per round and a column per slot.
// Open tracts have dashed lease lines and their planned well slots (tract.wells, placed by the server's slot rule);
// an appraised tract carries a survey stake; a closed tract is tinted by who won it, with the winning bid on its label.
import { SEC, tile, slotX, well, ownerColor, fadeIn, mm } from './kit-map.js';

const GAP = 6;   // a road between tracts, in units (600 ft): a layout gap, not survey data

export function build(ctx, v) {
  const { THREE, stage } = ctx;
  stage.gtao.enabled = false; stage.scene.fog = null; stage.bloom.strength = 0.08;
  ctx.root = new THREE.Group(); stage.scene.add(ctx.root);
  ctx.seen = new Set();
  draw(ctx, v);
}
export function update(ctx, v) { draw(ctx, v); }

const COL = { a: 0, b: 1, c: 2 };
// a short name: words until it is at least five letters (Caprock, Mesa Ridge, Two Forks)
const short = (n) => { let o = ''; for (const w of n.split(' ')) { o = o ? `${o} ${w}` : w; if (o.length >= 5) break; } return o; };

function draw(ctx, v) {
  const { THREE, stage } = ctx, root = ctx.root;
  root.clear(); ctx.clearLabels();
  const T = v.tracts || [], rivals = v.rivals || [], fresh = [];
  // with many closed tracts, their labels shrink to the id and the winner's first name (the 2D view and the description carry the rest)
  const many = T.filter(t => !t.open).length > 3;
  let maxCol = 0, maxRow = 0;
  for (const t of T) {
    const col = COL[t.slot] ?? 0, row = (t.round || 1) - 1;
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
    const size = Math.sqrt((t.acres || 640) / 640) * SEC;   // 640 acres is one section
    const x = col * (SEC + GAP), z = row * (SEC + GAP);
    const owner = !t.open ? t.winner : null;
    const g = tile(ctx, root, { x, z, size, dashed: !!t.open, fill: owner ? ownerColor(owner, rivals) : null, line: t.open ? '#f0c27a' : '#d9cfb8' });
    for (let k = 0; k < (t.wells || 0); k++) well(ctx, g, { x: slotX(k, t.wells) * size / SEC - size / 2, z0: -size / 2, planned: true });
    if (t.appraised) {
      // survey stake with a flag: a symbol, sized to read at map scale (estimated)
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), new THREE.MeshStandardMaterial({ color: '#e9e2d0' }));
      stake.position.set(size * 0.32, 3, -size * 0.32); g.add(stake);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: '#f0a53a', side: THREE.DoubleSide }));
      flag.position.set(size * 0.32 + 1.2, 5.2, -size * 0.32); g.add(flag);
    }
    const c = new THREE.Vector3(x + size / 2, 1, z + size / 2);
    if (t.open) {
      const e = t.estimate || {}, src = t.appraised ? (t.hint?.appraisal ? `appraised ${t.hint.appraisal}` : 'appraised') : `from ${e.source || 'analogs'}`;
      ctx.label(`${t.id}: ${t.wells} wells, P50 ${mm(e.value_p50_usd || 0)} (${src})`, c);
    } else if (owner) {
      const yours = owner === 'You', bid = t.your_bid_usd > 0 && !yours ? `, you bid ${mm(t.your_bid_usd)}` : '';
      ctx.label(many ? `${t.id} ${yours ? 'yours' : short(owner)}` : `${t.id}: ${yours ? 'yours' : owner}, ${mm(t.winning_bid_usd || 0)}${bid}`, c);
    } else ctx.label(`${t.id}: no sale`, c, 'muted');
    if (!ctx.seen.has(t.id)) { ctx.seen.add(t.id); fresh.push(g); }
  }
  if (ctx.built) fadeIn(ctx, fresh); ctx.built = true;
  ctx.label('N', new THREE.Vector3(((maxCol + 1) * SEC + maxCol * GAP) / 2, 0.5, -4), 'muted');   // north is -z, the map's top
  // frame the tracts on the map; reframe when a new round adds a row
  const W = (maxCol + 1) * SEC + maxCol * GAP, D = (maxRow + 1) * SEC + maxRow * GAP;
  stage.configure({ size: Math.max(W, D), fog: false });
  if (ctx.rows !== maxRow) {
    ctx.frame(new THREE.Box3(new THREE.Vector3(0, -1, -2), new THREE.Vector3(W, 4, D + SEC * 0.35)), [0.3, 1.0, 0.75], ctx.rows !== undefined);
    ctx.rows = maxRow;
  }
  const open = T.filter(t => t.open), closed = T.filter(t => !t.open);
  const youWon = closed.filter(t => t.winner === 'You').map(t => t.id);
  const by = {}; for (const t of closed) { const n = t.winner === 'You' ? 'you' : t.winner || 'no sale'; by[n] = (by[n] || 0) + 1; }
  ctx.describe(`Lease map, round ${v.round} of ${v.rounds}. ${open.length ? `Open: ${open.map(t => `${t.id} (${t.wells} wells)`).join(', ')}.` : 'No tracts open.'}`
    + (closed.length ? ` Closed: ${Object.entries(by).map(([n, c]) => `${n} ${c}`).join(', ')}${youWon.length ? ` (you hold ${youWon.join(', ')})` : ''}.` : '')
    + ` Colour: ${['you', ...(v.rivals || [])].map((n, i) => `${n} ${['amber', 'blue', 'rose', 'green'][i] || ''}`.trim()).join(', ')}. Dashed: planned well slots.`);
}
