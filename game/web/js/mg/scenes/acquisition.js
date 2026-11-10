// Acquisition in 3D: the package on the map. One section tile per view.sections entry, the data-room wells (view.data_room)
// drawn heel to toe in their slots, a flat bubble on each well sized by its oil to date (sum of oil_bbl), and the
// undeveloped sections' inventory as dashed slots (view.inventory_wells_per_section). When the deal closes the package is
// tinted by who bought it (view.outcome).
import { SEC, tile, slotX, well, bubble, ownerColor, fadeIn, mm } from './kit-map.js';

const GAP = 6;

export function build(ctx, v) {
  const { THREE, stage } = ctx;
  stage.gtao.enabled = false; stage.scene.fog = null; stage.bloom.strength = 0.08;
  ctx.root = new THREE.Group(); stage.scene.add(ctx.root);
  draw(ctx, v, null);
}
export function update(ctx, v, prev) { draw(ctx, v, prev); }

const kb = (b) => `${Math.round(b / 1000).toLocaleString('en-US')} kbbl`;

function draw(ctx, v, prev) {
  const { THREE, stage } = ctx, root = ctx.root;
  root.clear(); ctx.clearLabels();
  const secs = v.sections || [], room = v.data_room || [], out = v.outcome || null;
  const owner = out ? (out.won ? 'You' : out.winner) : null;
  const tint = owner ? ownerColor(owner, v.rivals || []) : null;
  const cum = (w) => (w.oil_bbl || []).reduce((a, b) => a + b, 0);
  const maxCum = Math.max(1, ...room.map(cum));
  const narrow = stage.canvas.clientWidth < 600;   // phone: short labels (the description and the 2D data room carry the detail)
  const tiles = [];
  secs.forEach((s, i) => {
    const x = i * (SEC + GAP), g = tile(ctx, root, { x, z: 0, fill: tint, fillOpacity: 0.2, dashed: !s.developed, line: s.developed ? '#d9cfb8' : '#f0c27a' });
    tiles.push(g);
    const wells = room.filter(w => w.section === s.section);
    if (s.developed) {
      const n = wells[0]?.wells_per_section || wells.length || 1;
      wells.forEach((w, j) => {
        const k = Math.max(0, (parseInt(String(w.id).split('-').pop(), 10) || j + 1) - 1);
        const p = well(ctx, g, { x: slotX(k, n) - SEC / 2, z0: -SEC / 2, lateralFt: w.lateral_ft });
        // bubble area proportional to oil to date; the biggest well gets 40 % of the slot spacing as its radius
        bubble(ctx, g, { x: slotX(k, n) - SEC / 2, z: (p.heel + p.toe) / 2, r: 0.4 * (SEC / n) * Math.sqrt(cum(w) / maxCum) });
      });
      const tot = wells.reduce((a, w) => a + cum(w), 0), mo = wells.map(w => w.months);
      const first = wells.reduce((a, w) => a + (w.oil_bbl?.[0] || 0), 0), last = wells.reduce((a, w) => a + (w.oil_bbl?.at(-1) || 0), 0);
      ctx.label(narrow ? `${s.section}: ${wells.length} wells, ${kb(tot)}` : `${s.section}: ${wells.length} wells, ${kb(tot)} in ${Math.min(...mo)}–${Math.max(...mo)} months; first month ${kb(first)}, latest ${kb(last)}`, new THREE.Vector3(x + SEC / 2, 1, SEC + 2));
    } else {
      const n = v.inventory_wells_per_section || 0;
      for (let k = 0; k < n; k++) well(ctx, g, { x: slotX(k, n) - SEC / 2, z0: -SEC / 2, planned: true });
      ctx.label(narrow ? `${s.section}: ${n} slots, undeveloped` : `${s.section}: undeveloped, ${n} inventory slots`, new THREE.Vector3(x + SEC / 2, 1, SEC + 2));
    }
  });
  if (owner) ctx.label(owner === 'You' ? `Yours at ${mm(out.your_bid_usd || 0)}` : `Sold to ${owner} at ${mm(out.winning_bid_usd || 0)}${out.your_bid_usd ? `, you bid ${mm(out.your_bid_usd)}` : ''}`,
    new THREE.Vector3((secs.length * (SEC + GAP) - GAP) / 2, 2, -3), owner === 'You' ? '' : 'muted');
  else if (out) ctx.label(out.your_bid_usd === 0 || out.passed ? 'You walked away' : 'No sale', new THREE.Vector3((secs.length * (SEC + GAP) - GAP) / 2, 2, -3), 'muted');
  if (prev && !prev.outcome && out) fadeIn(ctx, tiles.map(t => t.userData.fill).filter(Boolean));
  const W = secs.length * (SEC + GAP) - GAP;
  stage.configure({ size: Math.max(W, SEC), fog: false });
  if (!ctx.framed) { ctx.frame(new THREE.Box3(new THREE.Vector3(0, -1, -4), new THREE.Vector3(W, 4, SEC + 4)), [0.25, 1.0, 0.8]); ctx.framed = true; }
  const dev = secs.filter(s => s.developed).map(s => s.section), und = secs.filter(s => !s.developed).map(s => s.section);
  ctx.describe(`The package: ${secs.length} sections. ${dev.length ? `${dev.join(' and ')} producing, ${room.length} wells drawn heel to toe, bubbles sized by oil to date (${kb(room.reduce((a, w) => a + cum(w), 0))} in all).` : ''}`
    + (und.length ? ` ${und.join(' and ')} undeveloped: dashed lines are inventory slots.` : '')
    + (owner ? ` Bought by ${owner === 'You' ? 'you' : owner}.` : '') + ' Drag to orbit.');
}
