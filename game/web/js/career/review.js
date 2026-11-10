// "What will the review score": the board's year-end formula applied to the plan (or to the year so far), from the
// server's review_preview. One row per scored part: the expected points, the pessimistic case (pads not yet started slip
// 40 days, capex 8 % over), the part's range, and the one-line reason. Nothing here re-derives the board's formula.
// rp = {year, basis, guidance_bbl, parts: [{key, label, range: [lo, hi], expected, pessimistic, why}],
//       confidence_now, confidence_after_expected, confidence_after_pessimistic, sack_below, notes[]}
import { h } from '../mg/ui.js';

const f1 = (v) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;
const cls = (v) => (v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'zero');

// a range strip: the part's range lo..hi with zero marked, the expected value (filled) and the pessimistic one (ring)
function strip(p) {
  const [lo, hi] = p.range, span = hi - lo || 1, at = (v) => `${((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100}%`;
  return h('span', { class: 'rv-strip', 'aria-hidden': 'true', title: `Range ${f1(lo)} to ${f1(hi)}` },
    h('i', { class: 'rv-zero', style: `left:${at(0)}` }),
    Math.abs(p.pessimistic - p.expected) > 0.05 ? h('b', { class: `rv-pess ${cls(p.pessimistic)}`, style: `left:${at(p.pessimistic)}` }) : null,
    h('b', { class: `rv-exp ${cls(p.expected)}`, style: `left:${at(p.expected)}` }));
}

export function reviewPanel(rp, { compact = false, title } = {}) {
  if (!rp?.parts?.length) return null;
  const sack = rp.sack_below ?? 20, ex = rp.confidence_after_expected, pe = rp.confidence_after_pessimistic;
  const dEx = ex - rp.confidence_now, dPe = pe - rp.confidence_now;
  // compact: only the parts that move confidence, worst first
  const parts = compact ? rp.parts.filter(p => Math.abs(p.expected) > 0.05 || Math.abs(p.pessimistic) > 0.05).sort((a, b) => a.pessimistic - b.pessimistic) : rp.parts;
  const danger = pe < sack + 10;
  return h('div', { class: `panel-card rv ${compact ? 'compact' : ''} ${danger ? 'danger' : ''}` },
    h('h2', {}, title || `What the year ${rp.year} review will score`),
    h('p', { class: 'rv-head' },
      h('span', {}, 'Confidence ', h('strong', {}, String(Math.round(rp.confidence_now)))),
      h('span', {}, ' → expected ', h('strong', { class: cls(dEx) }, `${Math.round(ex)} (${f1(dEx)})`)),
      h('span', {}, ', if pads slip and costs run over ', h('strong', { class: cls(dPe) }, `${Math.round(pe)} (${f1(dPe)})`)),
      h('span', { class: 'hint' }, `. Below ${sack} the board lets you go.`)),
    rp.basis ? h('p', { class: 'hint' }, `Scored on ${rp.basis}.`) : null,
    h('ul', { class: 'rv-parts' }, ...parts.map(p => h('li', {},
      h('span', { class: 'rv-name' }, p.label, h('small', {}, p.why)),
      strip(p),
      h('span', { class: 'rv-val' }, h('strong', { class: cls(p.expected) }, f1(p.expected)),
        Math.abs(p.pessimistic - p.expected) > 0.05 ? h('small', { class: cls(p.pessimistic) }, `pessimistic ${f1(p.pessimistic)}`) : null)))),
    compact && parts.length < rp.parts.length ? h('p', { class: 'hint' }, `${rp.parts.length - parts.length} other parts score nothing either way.`) : null,
    ...(rp.notes || []).map(n => h('p', { class: 'hint' }, n)),
    h('p', { class: 'hint rv-key' }, 'Filled dot: expected. Ring: pessimistic case (every pad not yet started slips 40 days, capex 8% over). Line: zero.'));
}
