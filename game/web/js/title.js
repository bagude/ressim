// Title screen: the main menu over the same illustrative aerial land the career map draws.
import { buildBase, hashStr } from './career/mapTexture.js';

// Continue: the career last opened in this browser, if it is still running; otherwise the first active one.
(async () => {
  let list = [];
  try { list = await (await fetch('/api/careers')).json(); } catch { return; }
  let last = null;
  try { last = localStorage.getItem('career.last'); } catch { /* storage blocked: fall back to the list */ }
  const c = list.find(x => x.id === last && x.status === 'active') || list.find(x => x.status === 'active');
  if (!c) return;
  const a = document.getElementById('continue');
  a.href = `career.html?id=${encodeURIComponent(c.id)}`;
  document.getElementById('continue-desc').textContent = `${c.name}: month ${c.month} of 60, board confidence ${Math.round(c.confidence)}.`;
  a.hidden = false;
})();

// the land: drawn once at the window's size, darkened by CSS so the menu reads
function paint() {
  const cv = document.getElementById('land'), W = innerWidth, H = innerHeight;
  const gw = 360, gd = gw * H / W;
  const base = buildBase({ seed: hashStr('title'), gw, gd, Wc: Math.min(2400, Math.round(W * Math.min(2, devicePixelRatio || 1))), style: 'aerial' });
  cv.width = base.canvas.width; cv.height = base.canvas.height;
  const c = cv.getContext('2d');
  c.drawImage(base.canvas, 0, 0);
  // section-line roads and a few pads with their laterals, so it reads as an oilfield from the air
  const k = base.k, SEC = 52.8, px = (x) => (x + gw / 2) * k, pz = (z) => (z + gd / 2) * k;
  c.strokeStyle = '#ddd2ba'; c.lineWidth = Math.max(2, 0.45 * k);
  for (let x = -gw / 2 + 20; x < gw / 2; x += SEC) { c.beginPath(); c.moveTo(px(x), 0); c.lineTo(px(x), cv.height); c.stroke(); }
  for (let z = -gd / 2 + 14; z < gd / 2; z += SEC) { c.beginPath(); c.moveTo(0, pz(z)); c.lineTo(cv.width, pz(z)); c.stroke(); }
  const pads = [[1, 0], [3, 1], [4, 0], [2, 2], [5, 2]];
  for (const [col, row] of pads) {
    const x0 = -gw / 2 + 20 + col * SEC, z0 = -gd / 2 + 14 + row * SEC, x = x0 + 3.2, z = z0 + SEC / 2;
    if (pz(z) > cv.height) continue;
    c.fillStyle = '#e4dccb'; c.fillRect(px(x - 2.3), pz(z - 1.8), 4.6 * k, 3.6 * k);
    for (let w = 0; w < 4; w++) {
      const zl = z0 + (w + 0.5) * SEC / 4;
      c.strokeStyle = 'rgba(18,22,26,0.7)'; c.lineWidth = Math.max(3, 0.5 * k);
      c.beginPath(); c.moveTo(px(x - 1.2), pz(z)); c.lineTo(px(x0 + 3.5), pz(zl)); c.lineTo(px(x0 + 3.5 + 46), pz(zl)); c.stroke();
      c.strokeStyle = col === 3 ? '#c98322' : '#3d8be0'; c.lineWidth = Math.max(1.5, 0.25 * k); c.stroke();
    }
  }
}
document.fonts?.ready.finally?.(paint) ?? paint();
let t = null;
addEventListener('resize', () => { clearTimeout(t); t = setTimeout(paint, 250); });
