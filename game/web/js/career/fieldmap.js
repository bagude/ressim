// Top-down land map of the field: 1-mile sections from career.sections[] (col, row; size never hard-coded), producing
// laterals drawn at their real spacing, the player's planned pads as dashed laterals with their drilling order.
// Laterals run north to south across each section, heel near the north line, in slots across the section (the server's slot rule).
import { COLORS } from './charts2.js';
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

// opts: { career, analogs[], plan (normalised plan or null), selected: Set of analog ids, focus: section name,
//         onSection(name), onWell(id), compact }
export function fieldMap(host, o) {
  host.replaceChildren();
  const c = o.career, secs = c.sections;
  const cols = Math.max(...secs.map(s => s.col)) + 1, rows = Math.max(...secs.map(s => s.row)) + 1;
  const S = 100, pad = 26;
  const W = cols * S + pad * 2, H = rows * S + pad * 2;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fieldmap', role: 'group', 'aria-label': 'Field map: sections and wells' }, host);
  const bySec = Object.fromEntries(secs.map(s => [s.section, s]));
  const started = new Set((c.pads_started || []).map(p => p.section));
  const planned = new Map((o.plan?.pads || []).map((p, i) => [p.section, { ...p, order: i + 1 }]));
  // compass and scale
  el('text', { x: W - pad, y: 16, class: 'map-note', 'text-anchor': 'end' }, svg).textContent = 'N ↑   one section = 1 mile';
  for (const s of secs) {
    const x = pad + s.col * S, y = pad + s.row * S;
    const g = el('g', { class: 'sec' + (s.developed ? ' developed' : '') + (o.focus === s.section ? ' focus' : '') + (planned.has(s.section) ? ' planned' : '') + (started.has(s.section) ? ' started' : ''),
      tabindex: 0, role: 'button', 'aria-label': `Section ${s.section}${s.developed ? ', developed' : ', open acreage'}${planned.has(s.section) ? `, pad ${planned.get(s.section).order} in the plan` : ''}` }, svg);
    el('rect', { x: x + 1, y: y + 1, width: S - 2, height: S - 2, rx: 2, class: 'sec-box' }, g);
    el('text', { x: x + 6, y: y + S - 6, class: 'sec-name' }, g).textContent = s.section;   // bottom-left, clear of the laterals
    const act = () => o.onSection?.(s.section);
    g.addEventListener('click', act);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    // planned pad: dashed laterals at the plan's spacing, order badge
    const pp = planned.get(s.section);
    if (pp && !s.developed) {
      for (let k = 0; k < pp.wells; k++) {
        const xx = x + (k + 0.5) * S / pp.wells;
        el('line', { x1: xx, x2: xx, y1: y + 6, y2: y + S - 6, class: 'lat planned' + (started.has(s.section) ? ' locked' : '') }, g);
      }
      el('circle', { cx: x + S - 12, cy: y + S - 10, r: 8, class: 'order' }, g);
      el('text', { x: x + S - 12, y: y + S - 6.5, class: 'order-n', 'text-anchor': 'middle' }, g).textContent = pp.order;
    }
  }
  // producing wells (analogs: inherited and the player's own), grouped per section
  const groups = {};
  for (const a of o.analogs || []) (groups[a.section] ||= []).push(a);
  for (const [sec, list] of Object.entries(groups)) {
    const s = bySec[sec]; if (!s) continue;
    const x = pad + s.col * S, y = pad + s.row * S;
    const n = Math.max(list[0].wells_per_section || list.length, list.length);
    list.forEach((a, k) => {
      const xx = x + (k + 0.5) * S / n;
      const sel = o.selected?.has(a.id);
      const line = el('line', { x1: xx, x2: xx, y1: y + 6, y2: y + S - 6, class: 'lat ' + a.owner + (sel ? ' sel' : '') + (o.highlight === a.id ? ' hl' : ''),
        stroke: a.owner === 'you' ? COLORS.dev : COLORS.pdp }, svg);
      const hit = el('line', { x1: xx, x2: xx, y1: y + 6, y2: y + S - 6, class: 'lat-hit' }, svg);
      const t = el('title', {}, hit); t.textContent = `${a.id}: ${a.owner === 'you' ? 'your well' : 'inherited'}, ${Math.round(a.well_spacing_ft)} ft spacing`;
      hit.addEventListener('click', (e) => { e.stopPropagation(); o.onWell?.(a.id); });
      el('circle', { cx: xx, cy: y + 6, r: 2.2, fill: a.owner === 'you' ? COLORS.dev : COLORS.pdp }, svg);   // heel
      void line;
    });
  }
  return svg;
}
