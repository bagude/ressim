// Small SVG charts for the results panel. One series each (so no legend box: the title names it), 2px lines,
// recessive grid, hover crosshair with a tooltip, and a text table for screen readers.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function frame(host, { title, note }) {
  host.replaceChildren();
  const fig = document.createElement('figure'); fig.className = 'chart';
  const cap = document.createElement('figcaption'); cap.textContent = title; fig.appendChild(cap);
  if (note) { const p = document.createElement('p'); p.className = 'chart-note'; p.textContent = note; fig.appendChild(p); }
  host.appendChild(fig);
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; fig.appendChild(tip);
  return { fig, tip };
}

function table(fig, title, head, rows) {
  const d = document.createElement('details'); d.className = 'chart-table';
  const s = document.createElement('summary'); s.textContent = 'Show as table'; d.appendChild(s);
  const t = document.createElement('table'); t.setAttribute('aria-label', title);
  t.innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  d.appendChild(t); fig.appendChild(d);
}

// line chart. opts: { title, note, x[], y[], xLabel, fmtY(v), fmtX(v), zero: bool, marker: {x, label} }
export function lineChart(host, o) {
  const { fig, tip } = frame(host, o);
  const W = 360, H = 170, m = { l: 52, r: 12, t: 10, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title }, fig);
  const xs = o.x, ys = o.y;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  const yt = niceTicks(y0, y1); y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]);
  const X = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  for (const v of yt) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'axis-zero' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = o.fmtY(v);
  }
  for (const v of niceTicks(x0, x1, 5)) {
    el('text', { x: X(v), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = o.fmtX ? o.fmtX(v) : v;
  }
  if (o.xLabel) el('text', { x: W - m.r, y: H - 8, class: 'tick', 'text-anchor': 'end' }, svg).textContent = o.xLabel;
  el('path', { d: xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(''), class: 'series' }, svg);
  if (o.marker) {
    const mx = X(o.marker.x);
    el('line', { x1: mx, x2: mx, y1: m.t, y2: H - m.b, class: 'marker' }, svg);
    const nearRight = mx > W - 110;
    el('text', { x: nearRight ? mx - 4 : mx + 4, y: m.t + 10, class: 'tick marker-text', 'text-anchor': nearRight ? 'end' : 'start' }, svg).textContent = o.marker.label;
  }
  // hover
  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 4.5, class: 'dot', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const show = (ev) => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(X(xs[i]) - p.x) < Math.abs(X(xs[best]) - p.x)) best = i;
    const cx = X(xs[best]), cy = Y(ys[best]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${o.fmtTipX ? o.fmtTipX(xs[best]) : xs[best]}</b><span>${o.fmtTipY ? o.fmtTipY(ys[best]) : o.fmtY(ys[best])}</span>`;
    const r = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(r.width - 120, Math.max(0, cx / W * r.width - 50))}px`;
    tip.style.top = `${cy / H * r.height - 52}px`;
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  table(fig, o.title, [o.xLabel || 'x', o.title], xs.map((x, i) => [o.fmtTipX ? o.fmtTipX(x) : x, o.fmtTipY ? o.fmtTipY(ys[i]) : o.fmtY(ys[i])]));
}

// bar chart. opts: { title, note, labels[], values[], fmt(v), sub[] (secondary text per bar for the tooltip) }
export function barChart(host, o) {
  const { fig, tip } = frame(host, o);
  const n = o.values.length, W = 360, H = 150, m = { l: 52, r: 8, t: 10, b: 22 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title }, fig);
  const yt = niceTicks(0, Math.max(...o.values));
  const y1 = yt[yt.length - 1] || 1;
  const Y = v => H - m.b - v / y1 * (H - m.t - m.b);
  for (const v of yt) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'axis-zero' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = o.fmt(v);
  }
  const slot = (W - m.l - m.r) / n, bw = Math.max(4, Math.min(28, slot - 2));   // >= 2px gap between bars
  o.values.forEach((v, i) => {
    const x = m.l + i * slot + (slot - bw) / 2, y = Y(v), h = Y(0) - y;
    const r = Math.min(4, bw / 2, h);
    // rounded data end (top), square at the baseline
    el('path', { d: `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z`, class: 'bar' }, svg);
    if (n <= 15) el('text', { x: x + bw / 2, y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = o.labels[i];
    const hit = el('rect', { x: m.l + i * slot, y: m.t, width: slot, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', () => {
      tip.hidden = false;
      tip.innerHTML = `<b>Stage ${o.labels[i]}</b><span>${o.fmt(v)}</span>${o.sub ? `<span class="muted">${o.sub[i]}</span>` : ''}`;
      const rr = svg.getBoundingClientRect();
      tip.style.left = `${Math.min(rr.width - 140, Math.max(0, (x + bw / 2) / W * rr.width - 60))}px`;
      tip.style.top = `${y / H * rr.height - 64}px`;
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
  table(fig, o.title, ['Stage', o.title], o.values.map((v, i) => [o.labels[i], o.fmt(v)]));
}
