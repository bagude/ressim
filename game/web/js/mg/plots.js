// A small x-y plot for the engineering minigames: several series (lines and/or points), linear or log axes, vertical
// and horizontal markers, a legend and end labels. One measure per plot (dataviz rule: never two y scales).
import { h, num, sv } from './ui.js';

const fmt = (v) => (v === 0 ? '0' : Math.abs(v) >= 1e4 ? `${num(v / 1000)}k` : Math.abs(v) >= 100 ? num(v) : Math.abs(v) >= 1 ? num(v, 1) : Math.abs(v) >= 0.01 ? num(v, 2) : v.toExponential(0));

/**
 * o: {title, note, xl, yl, logX, logY, W, H, series: [{name, x[], y[], color, dash, points, line = true}], vx: [{x, label}], hy: [{y, label}],
 *     xMin, xMax, yMin, yMax, invertY}
 */
export function plot(o) {
  const card = h('div', { class: 'panel-card plotcard' });
  const S = o.series.map(s => ({ ...s, pts: s.x.map((x, i) => [x, s.y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.logX || x > 0) && (!o.logY || y > 0)) }));
  const all = S.flatMap(s => s.pts);
  card.append(h('h3', {}, o.title));
  if (!all.length) { card.append(h('p', { class: 'hint' }, 'No data yet.')); return card; }
  const tx = o.logX ? Math.log10 : (v) => v, ty = o.logY ? Math.log10 : (v) => v;
  let x0 = o.xMin ?? Math.min(...all.map(p => p[0])), x1 = o.xMax ?? Math.max(...all.map(p => p[0]));
  let y0 = o.yMin ?? Math.min(...all.map(p => p[1])), y1 = o.yMax ?? Math.max(...all.map(p => p[1]));
  for (const v of o.vx || []) { if (v.x != null) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); } }
  for (const v of o.hy || []) { if (v.y != null) { y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } }
  let a0 = tx(x0), a1 = tx(x1), b0 = ty(y0), b1 = ty(y1);
  if (!o.logX && o.xMin == null && x0 > 0 && x0 < 0.25 * x1) a0 = 0;
  if (!o.logY && o.yMin == null && y0 > 0 && y0 < 0.25 * y1) b0 = 0;
  const pa = (a1 - a0) * 0.04 || 1, pb = (b1 - b0) * 0.06 || 1; a1 += pa; b1 += pb; if (o.logX) a0 -= pa; if (o.logY || b0 !== 0) b0 -= pb;
  const W = o.W || 520, H = o.H || 280, m = { l: 56, r: 92, t: 12, b: 38 };
  const X = (v) => m.l + (tx(v) - a0) / (a1 - a0) * (W - m.l - m.r);
  const Y = (v) => { const f = (ty(v) - b0) / (b1 - b0); return o.invertY ? m.t + f * (H - m.t - m.b) : H - m.b - f * (H - m.t - m.b); };
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'xyplot', role: 'img', 'aria-label': o.title });
  const ticks = (a, b, log) => log ? (() => { const out = []; for (let e = Math.floor(a); e <= Math.ceil(b); e++) for (const k of (b - a < 2 ? [1, 2, 5] : [1])) { const v = k * 10 ** e; if (Math.log10(v) >= a && Math.log10(v) <= b) out.push(v); } return out; })() : Array.from({ length: 5 }, (_, i) => a + (b - a) * i / 4);
  for (const v of ticks(a0, a1, o.logX)) { sv('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: 'grid' }, s); sv('text', { x: X(v), y: H - m.b + 14, 'text-anchor': 'middle' }, s).textContent = fmt(v); }
  for (const v of ticks(b0, b1, o.logY)) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, s); sv('text', { x: m.l - 5, y: Y(v) + 3, 'text-anchor': 'end' }, s).textContent = fmt(v); }
  sv('text', { x: (W - m.r + m.l) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axl' }, s).textContent = o.xl || '';
  sv('text', { x: 11, y: (H - m.b + m.t) / 2, transform: `rotate(-90 11 ${(H - m.b + m.t) / 2})`, 'text-anchor': 'middle', class: 'axl' }, s).textContent = o.yl || '';
  for (const v of o.vx || []) if (v.x != null) {   // several marks: each label on its own row (v.row), optional stroke colour
    sv('line', { x1: X(v.x), x2: X(v.x), y1: m.t, y2: H - m.b, class: 'mark', ...(v.color ? { style: `stroke:${v.color};stroke-dasharray:none` } : {}) }, s);
    if (v.label) { const lx = X(v.x), right = lx > W - m.r - 90; sv('text', { x: right ? lx - 4 : lx + 4, y: m.t + 11 + 12 * (v.row || 0), class: 'markl', 'text-anchor': right ? 'end' : 'start' }, s).textContent = v.label; }
  }
  for (const v of o.hy || []) if (v.y != null) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v.y), y2: Y(v.y), class: 'mark' }, s); if (v.label) sv('text', { x: m.l + 4, y: Y(v.y) - 4, class: 'markl' }, s).textContent = v.label; }
  const ends = [], clip = `clip${Math.random().toString(36).slice(2, 8)}`;   // series stay inside the axes when a range is capped
  sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }, sv('clipPath', { id: clip }, sv('defs', {}, s)));
  const sg = sv('g', { 'clip-path': `url(#${clip})` }, s);
  for (const sr of S) {
    if (!sr.pts.length) continue;
    if (sr.line !== false) sv('path', { d: sr.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(''), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-dasharray': sr.dash === true ? '5 4' : sr.dash || null }, sg);
    if (sr.points) for (const [x, y] of sr.pts) sv('circle', { cx: X(x), cy: Y(y), r: 3, fill: sr.color, stroke: '#16202a', 'stroke-width': 1 }, sg);
    const [lx, ly] = sr.pts[sr.pts.length - 1]; ends.push({ y: Math.max(m.t, Math.min(H - m.b, Y(ly))), x: X(lx), name: sr.name });
  }
  ends.sort((p, q) => p.y - q.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;   // de-collide end labels
  for (const e of ends) sv('text', { x: W - m.r + 6, y: e.y + 3, class: 'endl' }, s).textContent = e.name;
  if (S.length > 1) card.append(h('div', { class: 'plotleg' }, ...S.map(sr => h('span', {}, h('i', { style: `border-top:2px ${sr.dash ? 'dashed' : 'solid'} ${sr.color}` }), sr.name))));
  card.append(s);
  if (o.note) card.append(h('p', { class: 'hint' }, o.note));
  return card;
}
