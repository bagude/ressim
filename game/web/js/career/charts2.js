// Multi-series charts and the Gantt for career mode. Same anatomy as game/charts.js: 2px lines, recessive grid,
// hover crosshair with every series' value, a legend for >= 2 series plus direct end labels, and a table view.
// Series colours (validated for the dark surface, all six checks pass): development #c98322, PDP #3d8be0.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};
export const COLORS = { dev: '#c98322', pdp: '#3d8be0', well: 'rgba(169,176,179,0.28)', ink: '#e7e2d6' };

function ticks(lo, hi, n = 4) {
  const span = hi - lo || 1, s0 = span / n, mag = 10 ** Math.floor(Math.log10(s0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= s0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) out.push(10 ** e);
  return out.filter(v => v >= lo * 0.999 && v <= hi * 1.001);
}

function shell(host, o) {
  host.replaceChildren();
  const fig = document.createElement('figure'); fig.className = 'chart';
  const cap = document.createElement('figcaption'); cap.textContent = o.title; fig.appendChild(cap);
  if (o.note) { const p = document.createElement('p'); p.className = 'chart-note'; p.textContent = o.note; fig.appendChild(p); }
  const legendSeries = o.series.filter(s => s.legend !== false);
  if (legendSeries.length >= 2) {
    const lg = document.createElement('div'); lg.className = 'legend-row';
    for (const s of legendSeries) {
      const it = document.createElement('span'); it.className = 'lg';
      const sw = document.createElement('i');
      const da = s.dash === true ? [4, 3] : typeof s.dash === 'string' ? s.dash.split(/\s+/).map(Number) : null;
      sw.style.background = da ? `repeating-linear-gradient(90deg, ${s.color} 0 ${da[0]}px, transparent ${da[0]}px ${da[0] + da[1]}px)` : s.color;   // swatch takes the series' own colour and dash
      const t = document.createElement('span'); t.textContent = s.name;
      it.append(sw, t); lg.appendChild(it);
    }
    fig.appendChild(lg);
  }
  host.appendChild(fig);
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; fig.appendChild(tip);
  return { fig, tip };
}

// o: { title, note, x[], series: [{name, y[], color, dash?, width?, stack?: 'group', area?: bool, legend?: false,
//      label?: false, tip?: false}], logY?, yMin?, fmtY, fmtTipX?, xLabel, W?, H?, now?: x value marker }
export function multiChart(host, o) {
  const { fig, tip } = shell(host, o);
  const W = o.W || 900, H = o.H || 260, m = { l: 62, r: 96, t: 10, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title }, fig);
  const xs = o.x, n = xs.length;
  // stacking: cumulative per stack group, drawn as areas
  const stacks = {};
  const drawn = o.series.map(s => {
    if (!s.stack) return { ...s, lo: null, hi: s.y };
    const base = stacks[s.stack] || Array(n).fill(0);
    const hi = s.y.map((v, i) => base[i] + (v ?? 0));
    stacks[s.stack] = hi;
    return { ...s, lo: base, hi };
  });
  const all = drawn.flatMap(s => s.hi.filter(v => v != null && isFinite(v)));
  let y0, y1, yT;
  if (o.logY) {
    y0 = o.yMin || Math.max(1e-6, Math.min(...all.filter(v => v > 0)));
    y1 = Math.max(...all);
    y0 = 10 ** Math.floor(Math.log10(y0)); y1 = 10 ** Math.ceil(Math.log10(y1));
    yT = logTicks(y0, y1);
  } else {
    y0 = Math.min(0, ...all); y1 = Math.max(0, ...all);
    yT = ticks(y0, y1); y0 = Math.min(y0, yT[0]); y1 = Math.max(y1, yT[yT.length - 1]);
  }
  const x0 = xs[0], x1 = xs[n - 1];
  const X = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
  const Y = v => {
    if (o.logY) { const lv = Math.log10(Math.max(v, y0)); return H - m.b - (lv - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) * (H - m.t - m.b); }
    return H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  };
  for (const v of yT) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'axis-zero' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = o.fmtY(v);
  }
  const intX = xs.every(Number.isInteger);   // months, quarters, years: no half-unit ticks
  for (const v of ticks(x0, x1, 6)) { if (intX && !Number.isInteger(v)) continue; el('text', { x: X(v), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = o.fmtX ? o.fmtX(v) : v; }
  if (o.xLabel) el('text', { x: W - m.r, y: H - 8, class: 'tick', 'text-anchor': 'start', dx: 6 }, svg).textContent = o.xLabel;
  if (o.now != null && o.now >= x0 && o.now <= x1) {
    el('line', { x1: X(o.now), x2: X(o.now), y1: m.t, y2: H - m.b, class: 'marker' }, svg);
    el('text', { x: X(o.now) + 4, y: m.t + 10, class: 'tick marker-text' }, svg).textContent = 'Now';
  }
  const path = (ys) => { let d = '', pen = false; ys.forEach((v, i) => { if (v == null || !isFinite(v) || (o.logY && v <= 0)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return d; };
  for (const s of drawn) {
    if (s.lo) {
      const top = s.hi.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      const bot = s.lo.map((v, i) => `L${X(xs[n - 1 - i]).toFixed(1)},${Y(s.lo[n - 1 - i]).toFixed(1)}`).join('');
      el('path', { d: top + bot + 'Z', fill: s.color, 'fill-opacity': 0.55, stroke: 'none' }, svg);
      el('path', { d: top, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    } else {
      el('path', { d: path(s.hi), fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-dasharray': s.dash === true ? '5 4' : (s.dash || null),
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      // short series get point markers, so a lone value (one quarter so far) is still visible
      if (n <= 12 && !s.dash && s.legend !== false) s.hi.forEach((v, i) => { if (v != null && isFinite(v)) el('circle', { cx: X(xs[i]), cy: Y(v), r: 4, fill: s.color, stroke: '#16202a', 'stroke-width': 1.5 }, svg); });
    }
  }
  // direct end labels for named series (<= 4), pushed apart vertically so they never overlap
  if (o.series.filter(q => q.legend !== false).length <= 4) {
    const labs = [];
    for (const s of drawn) {
      if (s.label === false || s.legend === false) continue;
      let k = n - 1; while (k > 0 && (s.hi[k] == null || !isFinite(s.hi[k]))) k--;
      if (s.hi[k] != null) labs.push({ name: s.name, x: X(xs[k]) + 6, y: Y(s.hi[k]) + 4 });
    }
    labs.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) labs[i].y = Math.max(labs[i].y, labs[i - 1].y + 12);
    for (const l of labs) el('text', { x: l.x, y: l.y, class: 'tick end-label' }, svg).textContent = l.name;
  }
  // hover: one crosshair, every tip-able series' value at that x
  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', (ev) => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let k = Math.round((p.x - m.l) / (W - m.l - m.r) * (n - 1)); k = Math.max(0, Math.min(n - 1, k));
    cross.setAttribute('x1', X(xs[k])); cross.setAttribute('x2', X(xs[k])); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = o.fmtTipX ? o.fmtTipX(xs[k]) : xs[k]; tip.appendChild(b);
    for (const s of o.series) {
      if (s.tip === false || s.y[k] == null) continue;
      const r = document.createElement('span'); r.className = 'row';
      const sw = document.createElement('i'); sw.style.background = s.color;
      const t = document.createElement('span'); t.textContent = `${s.name}: ${o.fmtY(s.y[k])}`;
      r.append(sw, t); tip.appendChild(r);
    }
    tip.hidden = false;
    const rr = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(rr.width - 170, Math.max(0, X(xs[k]) / W * rr.width + 12))}px`;
    tip.style.top = `${m.t / H * rr.height + 20}px`;
  });
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  // table view
  const named = o.series.filter(s => s.tip !== false);
  const d = document.createElement('details'); d.className = 'chart-table';
  const sm = document.createElement('summary'); sm.textContent = 'Show as table'; d.appendChild(sm);
  const t = document.createElement('table');
  const hr = t.createTHead().insertRow(); for (const h of [o.xLabel || 'x', ...named.map(s => s.name)]) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); }
  const tb = t.createTBody();
  const stride = Math.max(1, Math.round(n / 40));
  for (let i = 0; i < n; i += stride) { const r = tb.insertRow(); r.insertCell().textContent = o.fmtTipX ? o.fmtTipX(xs[i]) : xs[i]; for (const s of named) r.insertCell().textContent = s.y[i] == null ? '' : o.fmtY(s.y[i]); }
  d.appendChild(t); fig.appendChild(d);
}

// Gantt in the agreed shape: lanes, bars (kind, status), links, milestones. Months on x.
const BAR = { drill: '#3d8be0', complete: '#c98322', tie_in: '#7b8a94', facility_build: '#7b8a94', wait: '#4a5864' };
export function gantt(host, g, { now = 0, fmtMonth = (m) => m, horizon = null } = {}) {
  host.replaceChildren();
  const fig = document.createElement('figure'); fig.className = 'chart gantt';
  const cap = document.createElement('figcaption'); cap.textContent = 'Schedule'; fig.appendChild(cap);
  const lg = document.createElement('div'); lg.className = 'legend-row';
  for (const [k, name] of [['drill', 'Drilling'], ['complete', 'Fracturing'], ['tie_in', 'Tie-in'], ['wait', 'Pad construction']]) {
    const it = document.createElement('span'); it.className = 'lg';
    const sw = document.createElement('i'); sw.style.background = BAR[k];
    const t = document.createElement('span'); t.textContent = name; it.append(sw, t); lg.appendChild(it);
  }
  const it = document.createElement('span'); it.className = 'lg';
  const sw = document.createElement('i'); sw.className = 'hatch'; const t = document.createElement('span'); t.textContent = 'Waiting for budget';
  it.append(sw, t); lg.appendChild(it);
  fig.appendChild(lg);
  host.appendChild(fig);
  const lanes = g.lanes, rowH = 26, m = { l: 96, r: 12, t: 22, b: 8 };
  const end = Math.max(...g.bars.map(b => b.end_month), now + 1);
  const x0 = Math.floor(now), x1 = horizon ?? Math.max(x0 + 6, Math.ceil(end + 1));   // the schedule starts now; the past is history
  const W = 900, H = m.t + lanes.length * rowH + m.b;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Drilling and completion schedule' }, fig);
  const defs = el('defs', {}, svg);
  const pat = el('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 6, height: 6, fill: '#2c3c4a' }, pat); el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#c8463a', 'stroke-width': 2.5 }, pat);
  const X = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
  // year bands and month ticks
  for (let mth = Math.ceil(x0 / 12) * 12; mth <= x1; mth += 12) {
    el('line', { x1: X(mth), x2: X(mth), y1: m.t - 6, y2: H - m.b, class: 'grid strong' }, svg);
    el('text', { x: X(mth) + 3, y: m.t - 8, class: 'tick' }, svg).textContent = `Year ${mth / 12 + 1}`;
  }
  lanes.forEach((ln, i) => {
    const y = m.t + i * rowH;
    if (i % 2 === 0) el('rect', { x: m.l, y, width: W - m.l - m.r, height: rowH, fill: 'rgba(44,60,74,0.25)' }, svg);
    el('text', { x: m.l - 8, y: y + rowH / 2 + 4, class: 'tick lane', 'text-anchor': 'end' }, svg).textContent = ln.label;
  });
  const laneIdx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; fig.appendChild(tip);
  for (const b of g.bars) {
    const i = laneIdx[b.lane]; if (i == null || b.end_month <= x0) continue;
    const y = m.t + i * rowH + 5, h = rowH - 10;
    const xa = X(Math.max(x0, b.start_month)), xb = Math.max(xa + 3, X(b.end_month));
    const fill = b.status === 'delayed' ? 'url(#hatch)' : BAR[b.kind] || BAR.wait;
    const r = el('rect', { x: xa, y, width: xb - xa, height: h, rx: 3, fill, class: 'gbar' + (b.status === 'curtailed' ? ' curtailed' : '') }, svg);
    if (xb - xa > 46 && b.kind !== 'wait') el('text', { x: xa + 5, y: y + h - 5, class: 'tick bar-label' }, svg).textContent = b.pad || '';
    r.addEventListener('pointermove', (ev) => {
      tip.replaceChildren();
      const bb = document.createElement('b'); bb.textContent = b.label; tip.appendChild(bb);
      const s = document.createElement('span'); s.textContent = `${fmtMonth(b.start_month)} to ${fmtMonth(b.end_month)}`; tip.appendChild(s);
      if (b.status && b.status !== 'planned') { const st = document.createElement('span'); st.className = 'muted'; st.textContent = b.status === 'delayed' ? 'Waiting for budget' : b.status; tip.appendChild(st); }
      tip.hidden = false;
      const rr = svg.getBoundingClientRect();
      tip.style.left = `${Math.min(rr.width - 180, Math.max(0, xa / W * rr.width))}px`;
      tip.style.top = `${(y + h + 4) / H * rr.height}px`;
    });
    r.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
  for (const ms of g.milestones || []) {
    if (ms.month < x0 || ms.month > x1) continue;   // past milestones are history, not schedule
    const x = X(ms.month);
    el('path', { d: `M${x},${m.t - 4}l4,4l-4,4l-4,-4Z`, fill: '#e7e2d6' }, svg);
  }
  if (now >= x0 && now <= x1) {
    el('line', { x1: X(now), x2: X(now), y1: m.t - 6, y2: H - m.b, class: 'marker' }, svg);
  }
}
