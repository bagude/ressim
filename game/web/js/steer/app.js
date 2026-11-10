// Geosteering desk over ressim-83's /api/steer (game/API.md, "Geosteering").
// Coordinates from the server: md along the lateral from the heel; tvd relative, positive down, 0 = mid-pay at the heel;
// s = position in the pay (ft from mid-pay, positive below); inc in degrees, 90 = horizontal, above 90 = drilling up.
// The true structure is never shown until `lookback` arrives after finish.
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v); p?.appendChild(e); return e; };
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };
const num = (v, d = 0) => (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)} MM` : `${s}$${Math.round(a / 1e3)}k`; };

async function call(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return j || { ok: false, errors: [`HTTP ${r.status}`] };
}

let S = null;                 // session
let interp = [{ md: 0, dip_deg: 0, throw_ft: 0, thickness_factor: 1 }];
let prev = null;              // last preview
let targetInc = 90;
let PROG = null;              // the well's prognosis from the geology desk (career wells only), if the player saved one
// planned landing line in this screen's frame: it starts at mid-pay at the heel and follows the dip the player's
// structure map predicts (the map's absolute depth is not tied to this frame yet)
function progAt(md) {
  if (!PROG) return null;
  const L = PROG.md[PROG.md.length - 1] || S.lateral_ft;
  const f = Math.max(0, Math.min(1, md / L)) * (PROG.md.length - 1), i = Math.min(PROG.md.length - 2, Math.floor(f)), t = f - i;
  const lerp = (a) => a[i] * (1 - t) + a[i + 1] * t;
  const top = lerp(PROG.top_tvd), base = lerp(PROG.base_tvd), sd = PROG.sd_ft ? lerp(PROG.sd_ft) : 0;
  // with the session's datum (absolute TVD of mid-pay at the heel) the plan sits at its true depth; without it, it is
  // drawn from mid-pay at the heel and only its shape (the dip) means anything
  const d0 = S.geo?.heel_mid_pay_tvd_ft;
  const tz = S.geo?.target_zone;   // the clean net bench, at a fixed depth below the top of the gross pay
  if (d0 != null) return { tvd: top + PROG.target_ft - d0, top: top - d0, base: base - d0, sd, abs: true,
    bench: tz ? [top + tz.top_offset_ft - d0, top + tz.top_offset_ft + tz.thickness_ft - d0] : null };
  return { tvd: top - PROG.top_tvd[0], sd, abs: false };
}
async function sendPrognosis(btn) {
  btn.disabled = true; btn.textContent = 'Sending…';
  const along = PROG.md.filter(md => md <= S.lateral_ft + 1).map((md, i) => ({ md, tvd: PROG.top_tvd[i] }));
  const r = await call('/api/steer/prognosis', { id: S.id, target_ft: PROG.target_ft, top_tvd_along: along,
    ...(PROG.type_well ? { type_well: PROG.type_well } : {}), ...(PROG.type_well_picks ? { type_well_picks: PROG.type_well_picks } : {}) });
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Try again'; $('msg').textContent = (r.errors || ['The rig did not take the prognosis.']).join(' '); return; }
  if (r.session) S = r.session; else { const g = await call(`/api/steer?id=${encodeURIComponent(S.id)}`); if (g.ok) S = g.session; }
  renderAll();
}
function startFromPrognosis() {   // one segment per 900 ft, each with the dip of the planned line over it
  const out = [];
  for (let md = 0; md < S.lateral_ft; md += 900) {
    const a = progAt(md).tvd, b = progAt(Math.min(S.lateral_ft, md + 900)).tvd;
    out.push({ md, dip_deg: +(Math.atan2(b - a, Math.min(900, S.lateral_ft - md)) * 180 / Math.PI).toFixed(2), throw_ft: 0, thickness_factor: 1 });
  }
  interp = out; changed(); renderSegs(); drawXsec();
}

// ---------------------------------------------------------------- belief geometry (the player's interpretation)
function midTvd(md) {
  let tv = 0;
  for (let i = 0; i < interp.length; i++) {
    const a = interp[i].md, b = i + 1 < interp.length ? interp[i + 1].md : Infinity;
    if (md <= a) break;
    tv += (interp[i].throw_ft || 0) + Math.tan(interp[i].dip_deg * Math.PI / 180) * (Math.min(md, b) - a);
  }
  return tv;
}
function halfAt(md) {
  let f = 1; for (const s of interp) if (s.md <= md) f = s.thickness_factor ?? 1;
  return S.pay_ft_on_typelog / 2 * f;
}

// ---------------------------------------------------------------- panels
function drawTypelog() {
  const host = $('typelog'); host.replaceChildren();
  const W = 200, H = 520, m = { l: 34, r: 8, t: 8, b: 20 };
  const t = S.typelog, s0 = Math.min(...t.s_ft), s1 = Math.max(...t.s_ft);
  const X = g => m.l + (g - 0) / 160 * (W - m.l - m.r), Y = s => m.t + (s - s0) / (s1 - s0) * (H - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Typelog: gamma against position in the pay' }, host);
  const half = S.pay_ft_on_typelog / 2;
  sv('rect', { x: m.l, y: Y(-half), width: W - m.l - m.r, height: Y(half) - Y(-half), class: 'pay' }, svg);
  for (const s of [-60, -30, 0, 30, 60]) if (s >= s0 && s <= s1) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(s), y2: Y(s), class: 'grid' }, svg); sv('text', { x: m.l - 4, y: Y(s) + 3, 'text-anchor': 'end' }, svg).textContent = s; }
  for (const g of [0, 50, 100, 150]) sv('text', { x: X(g), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = g;
  sv('path', { d: t.s_ft.map((s, i) => `${i ? 'L' : 'M'}${X(t.gamma_api[i]).toFixed(1)},${Y(s).toFixed(1)}`).join(''), class: 'tl-curve' }, svg);
  if (prev?.bit_s_ft != null) sv('line', { x1: m.l, x2: W - m.r, y1: Y(prev.bit_s_ft), y2: Y(prev.bit_s_ft), class: 'tl-bit' }, svg);
  sv('text', { x: W - m.r, y: m.t + 10, 'text-anchor': 'end' }, svg).textContent = 'gamma API';
}

function drawXsec() {
  const host = $('xsec'); host.replaceChildren();
  const W = 900, H = 300, m = { l: 48, r: 12, t: 12, b: 24 };
  const L = S.lateral_ft;
  const mds = []; for (let x = 0; x <= L; x += 30) mds.push(x);
  const path = S.survey;
  const tvAll = [...path.map(p => p.tvd), ...mds.map(x => midTvd(x) - halfAt(x)), ...mds.map(x => midTvd(x) + halfAt(x)), ...(PROG ? mds.flatMap(x => { const p = progAt(x); return p.abs ? [p.top, p.base] : [p.tvd]; }) : [])];
  const lb = S.lookback;
  if (lb) { tvAll.push(...lb.pay_top_tvd_ft, ...lb.pay_base_tvd_ft); }
  let y0 = Math.min(...tvAll) - 15, y1 = Math.max(...tvAll) + 15;
  const X = v => m.l + v / L * (W - m.l - m.r), Y = v => m.t + (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const ve = ((W - m.l - m.r) / L) / ((H - m.t - m.b) / (y1 - y0));
  $('xs-note').textContent = (PROG ? `Blue dashed: your planned landing line from the geology desk (type well ${PROG.type_well})${progAt(0).abs ? ', with the pay top and base you mapped (thin blue), at true depth' : ''}, and the map's uncertainty. ` : '') + `Your interpretation of the pay (amber), the drilled path (white), the bit and the gamma sensor 50 ft behind it. Vertical scale exaggerated about ${Math.round(1 / ve)} times.` + (lb ? ' The dashed white lines are the true pay top and base.' : '');
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cross-section along the lateral' }, host);
  for (let x = 0; x <= L; x += 500) { sv('line', { x1: X(x), x2: X(x), y1: m.t, y2: H - m.b, class: 'grid' }, svg); sv('text', { x: X(x), y: H - 8, 'text-anchor': 'middle' }, svg).textContent = `${num(x)} ft`; }
  const step = (y1 - y0) > 120 ? 40 : 20;
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, svg); sv('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, svg).textContent = `${v} ft`; }
  // belief pay band
  const top = mds.map(x => [X(x), Y(midTvd(x) - halfAt(x))]), base = mds.map(x => [X(x), Y(midTvd(x) + halfAt(x))]);
  sv('path', { d: 'M' + top.map(p => p.join(',')).join('L') + 'L' + [...base].reverse().map(p => p.join(',')).join('L') + 'Z', class: 'pay' }, svg);
  sv('path', { d: 'M' + top.map(p => p.join(',')).join('L'), class: 'pay-edge' }, svg);
  sv('path', { d: 'M' + base.map(p => p.join(',')).join('L'), class: 'pay-edge' }, svg);
  for (const s of interp.slice(1)) sv('line', { x1: X(s.md), x2: X(s.md), y1: m.t, y2: H - m.b, class: 'segline' }, svg);
  if (lb) {
    sv('path', { d: lb.md_ft.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(lb.pay_top_tvd_ft[i])}`).join(''), class: 'truth-edge' }, svg);
    sv('path', { d: lb.md_ft.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(lb.pay_base_tvd_ft[i])}`).join(''), class: 'truth-edge' }, svg);
  }
  if (PROG) {
    sv('path', { d: mds.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(progAt(x).tvd - progAt(x).sd)}`).join('') + [...mds].reverse().map(x => `L${X(x)},${Y(progAt(x).tvd + progAt(x).sd)}`).join('') + 'Z', class: 'prog-band' }, svg);
    sv('path', { d: mds.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(progAt(x).tvd)}`).join(''), class: 'prog-line' }, svg);
    if (progAt(0).bench) sv('path', { d: mds.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(progAt(x).bench[0])}`).join('') + [...mds].reverse().map(x => `L${X(x)},${Y(progAt(x).bench[1])}`).join('') + 'Z', class: 'prog-bench' }, svg);
    if (progAt(0).abs) for (const k of ['top', 'base']) sv('path', { d: mds.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(progAt(x)[k])}`).join(''), class: 'prog-edge' }, svg);
  }
  sv('path', { d: path.map((p, i) => `${i ? 'L' : 'M'}${X(p.md)},${Y(p.tvd)}`).join(''), class: 'path' }, svg);
  // projected next interval at the target inclination (straight, ignoring the dogleg ramp)
  if (!S.at_td && !S.finished) {
    const b = S.bit, d = Math.min(S.interval_ft, L - b.md), dtv = -Math.tan((targetInc - 90) * Math.PI / 180) * d;
    sv('path', { d: `M${X(b.md)},${Y(b.tvd)}L${X(b.md + d)},${Y(b.tvd + dtv)}`, class: 'ahead' }, svg);
  }
  const g = S.gamma[S.gamma.length - 1];
  if (g) sv('circle', { cx: X(g.md), cy: Y(g.tvd), r: 4.5, class: 'sensor' }, svg);
  sv('circle', { cx: X(S.bit.md), cy: Y(S.bit.tvd), r: 6, class: 'bit' }, svg);
}

function drawCorr() {
  const host = $('corr'); host.replaceChildren();
  const W = 900, H = 170, m = { l: 48, r: 12, t: 10, b: 22 };
  const L = S.lateral_ft;
  const X = v => m.l + v / L * (W - m.l - m.r), Y = g => m.t + (1 - g / 160) * (H - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Measured against modelled gamma' }, host);
  for (const g of [0, 50, 100, 150]) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(g), y2: Y(g), class: 'grid' }, svg); sv('text', { x: m.l - 6, y: Y(g) + 3, 'text-anchor': 'end' }, svg).textContent = g; }
  for (let x = 0; x <= L; x += 500) sv('text', { x: X(x), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = `${num(x)} ft`;
  if (S.gamma.length) sv('path', { d: S.gamma.map((p, i) => `${i ? 'L' : 'M'}${X(p.md)},${Y(p.gamma_api)}`).join(''), class: 'gamma' }, svg);
  if (prev?.synthetic?.length) sv('path', { d: prev.synthetic.map((p, i) => `${i ? 'L' : 'M'}${X(p.md)},${Y(p.gamma_api)}`).join(''), class: 'synth' }, svg);
  if (!S.gamma.length) sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg).textContent = 'Drill the first interval to start logging gamma.';
}

// ---------------------------------------------------------------- controls
function slider(label, lo, hi, step, value, fmt, on) {
  const out = h('output', {}, fmt(value));
  const inp = h('input', { type: 'range', min: lo, max: hi, step, 'aria-label': label }); inp.value = value;
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); on(+inp.value); });
  return h('div', { class: 'ctl' }, h('label', {}, h('span', {}, label), out), inp);
}
function renderProg() {
  const box = $('prog'); if (!box) return;
  box.hidden = !S.link;
  if (!S.link) return;
  if (!PROG) { box.replaceChildren(h('h2', {}, 'Prognosis'), h('p', { class: 'hint' }, 'No prognosis for this well yet. Plan it on the geology desk (Maps, then Plan a well): type log, landing target and the dip your structure map expects.'),
    h('a', { class: 'small-btn', href: `career.html?id=${S.link.career}&tab=maps` }, 'Open the geology desk')); return; }
  const dip = Math.atan2(progAt(S.lateral_ft).tvd - progAt(0).tvd, S.lateral_ft) * 180 / Math.PI;
  const tz = S.geo?.target_zone, inBench = tz ? PROG.target_ft >= tz.top_offset_ft && PROG.target_ft <= tz.top_offset_ft + tz.thickness_ft : null;
  const sent = S.prognosis, canSend = !sent && !S.finished && (S.survey?.length || 0) <= 1 && S.bit.md <= 1;
  box.replaceChildren(h('h2', {}, 'Prognosis'),
    h('p', { class: 'hint' }, `From your geology desk (month ${PROG.month}, ${PROG.picks_used} picked wells): type well ${PROG.type_well}, mean dip ${num(dip, 2)}° ${dip > 0 ? 'down' : 'up'}, top uncertain by up to ±${num(Math.max(...(PROG.sd_ft || [0])))} ft.`),
    tz ? h('p', { class: inBench ? 'hint pos' : 'hint neg' }, `Target: the clean bench, ${num(tz.top_offset_ft)} to ${num(tz.top_offset_ft + tz.thickness_ft)} ft below the top of the gross pay (${num(tz.thickness_ft)} ft). Your landing target, ${num(PROG.target_ft)} ft below the top, is ${inBench ? 'inside it' : 'outside it: move it on the geology desk before you send the plan'}.`) : null,
    sent ? h('p', { class: 'hint pos' }, `On the rig${sent.type_well ? `: the typelog is ${sent.type_well}'s gamma, stretched to this well's pay` : ''}. Your plan is scored against the truth at the end.`)
      : canSend ? h('button', { type: 'button', class: 'small-btn do', onclick: (e) => sendPrognosis(e.currentTarget) }, 'Send the prognosis to the rig')
      : h('p', { class: 'hint' }, 'Drilling has started; the prognosis can only go to the rig before the first interval.'),
    h('button', { type: 'button', class: 'small-btn', onclick: startFromPrognosis }, 'Start your interpretation from the prognosis'),
    h('p', { class: 'hint' }, 'The map is a plan, not the rock: the gamma you log is the truth. Where it disagrees, trust the log.'));
}
function renderSegs() {
  const ol = $('segs'); ol.replaceChildren();
  interp.forEach((s, i) => {
    const li = h('li', {}, h('div', { class: 'seg-head' }, h('span', {}, `From ${num(s.md)} ft`),
      i ? h('button', { type: 'button', class: 'small-btn', onclick: () => { interp.splice(i, 1); changed(); renderSegs(); } }, 'Remove') : null));
    li.append(slider('Dip', -6, 6, 0.05, s.dip_deg, v => `${num(v, 2)}°`, v => { s.dip_deg = v; changed(); }));
    if (i) li.append(slider('Fault throw at start', -30, 30, 0.5, s.throw_ft || 0, v => `${num(v, 1)} ft`, v => { s.throw_ft = v; changed(); }));
    li.append(slider('Pay thickness', 0.6, 1.4, 0.01, s.thickness_factor ?? 1, v => `${num(v * S.pay_ft_on_typelog, 1)} ft`, v => { s.thickness_factor = v; changed(); }));
    ol.append(li);
  });
}
function renderInc() {
  const b = S.bit, box = $('inc-ctl'); box.replaceChildren();
  const dmax = S.dls_max_deg_100ft * S.interval_ft / 100;
  const lo = Math.max(80, b.inc - dmax), hi = Math.min(100, b.inc + dmax);
  targetInc = Math.min(hi, Math.max(lo, targetInc));
  box.append(slider('Target inclination', +lo.toFixed(2), +hi.toFixed(2), 0.05, targetInc,
    v => `${num(v, 2)}° (${v > 90 ? 'up' : v < 90 ? 'down' : 'level'} ${num(Math.abs(v - 90), 2)}°)`, v => { targetInc = v; drawXsec(); }));
  box.append(h('p', { class: 'hint' }, `Now ${num(b.inc, 2)}°. Dogleg limit ${S.dls_max_deg_100ft}°/100 ft: at most ${num(dmax, 1)}° change this interval.`));
}

let pvTimer = null;
function changed() {
  drawXsec(); clearTimeout(pvTimer); pvTimer = setTimeout(preview, 200);
  try { localStorage.setItem('steer.interp.' + S.id, JSON.stringify(interp)); } catch { /* private mode */ }   // your picks survive a reload
}
async function preview() {
  const r = await call('/api/steer/preview', { id: S.id, interpretation: interp });
  if (!r.ok) { $('msg').textContent = r.errors.join(' '); return; }
  prev = r;
  $('parallel').replaceChildren(`Bit is ${r.bit_in_pay ? 'inside' : 'outside'} the pay on your interpretation, ${num(Math.abs(r.bit_s_ft), 1)} ft ${r.bit_s_ft >= 0 ? 'below' : 'above'} mid-pay. Parallel to your beds: ${num(r.parallel_inclination_deg, 2)}°. `,
    h('button', { type: 'button', class: 'small-btn', onclick: () => { targetInc = r.parallel_inclination_deg; renderInc(); drawXsec(); } }, 'Use it'));
  drawTypelog(); drawCorr();
}

function renderAll() {
  $('days').textContent = num(S.days, 1); $('dec').textContent = S.decisions;
  $('bit').textContent = `${num(S.bit.md)} ft md, ${num(S.bit.inc, 2)}°`;
  $('status').textContent = S.finished ? 'Finished' : S.at_td ? 'At total depth' : `${num(S.bit.md / S.lateral_ft * 100)}% drilled`;
  $('note').textContent = S.note;
  $('finish').disabled = !S.at_td || S.finished;
  $('drill').disabled = S.at_td || S.finished;
  $('st-md').min = Math.max(0, S.bit.md - 1500); $('st-md').max = S.bit.md; if (!$('st-md').value) $('st-md').value = Math.max(0, S.bit.md - 300);
  if (S.link) { $('back').href = `career.html?id=${S.link.career}`; $('back').textContent = `Back to career (well ${S.link.well})`; }
  renderProg(); renderSegs(); renderInc(); drawTypelog(); drawXsec(); drawCorr();
  if (S.result) renderResult();
  preview();
}

function renderResult() {
  const r = S.result, box = $('result'); box.hidden = false; box.replaceChildren();
  box.append(h('h2', {}, 'Lookback'), h('p', {}, `In zone: ${num(r.in_zone_pct, 1)}% of the lateral` + (r.expert_in_zone_pct != null ? ` (an expert got ${num(r.expert_in_zone_pct, 1)}%).` : '.')));
  if (r.in_zone_plan_pct != null) {   // the plan against the execution: how good was the map, how good was the steering
    const d = r.in_zone_pct - r.in_zone_plan_pct;
    box.append(h('ul', { class: 'plain' }, h('li', {}, h('span', {}, 'Your plan, drilled exactly as mapped'), h('strong', {}, `${num(r.in_zone_plan_pct, 1)}% in zone`)),
      h('li', {}, h('span', {}, 'Your steering'), h('strong', {}, `${num(r.in_zone_pct, 1)}% in zone`))),
      h('p', { class: 'hint' }, d > 2 ? `Steering added ${num(d, 1)} points: you read the gamma where the map was wrong.` : d < -2 ? `Steering lost ${num(-d, 1)} points against simply following your map: the map was better than the calls you made.` : 'The steering matched the plan: the map was close, or you followed it.'));
  }
  if (r.stars != null) box.append(h('span', { class: 'stars-big', 'aria-label': `${r.stars} of 3 stars` }, '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)),
    h('p', { class: 'hint' }, r.stars_rule || 'Stars at 80, 90 and 97% of the expert’s NPV10.'));
  if (r.measures) box.append(h('ul', { class: 'plain' },
    h('li', {}, h('span', {}, 'Your NPV10'), h('strong', {}, usd(r.measures.npv10_usd))),
    r.expert_npv10_usd != null ? h('li', {}, h('span', {}, 'Expert NPV10'), h('strong', {}, usd(r.expert_npv10_usd))) : null,
    r.value_ratio != null ? h('li', {}, h('span', {}, 'Value against the expert'), h('strong', {}, `${num(r.value_ratio * 100)}%`)) : null,
    r.oil_bbl_20yr != null ? h('li', {}, h('span', {}, 'Oil in 20 years'), h('strong', {}, `${num(r.oil_bbl_20yr)} bbl`)) : null,
    h('li', {}, h('span', {}, 'Extra rig days'), h('strong', {}, num(r.extra_rig_days ?? 0, 1)))));
  if (r.stages?.length) {
    const inBar = r.stages.filter(s => s.into_barrier_ft > 0).length;
    box.append(h('p', { class: 'hint' }, `${r.stages.length} stages; ${inBar} landed in a barrier and get a choked connection to the pay.`));
  }
}

async function act(body, path = '/api/steer/drill') {
  for (const b of ['drill', 'finish', 'sidetrack', 'auto']) $(b).disabled = true;
  $('msg').textContent = path.endsWith('finish') ? 'Simulating each stage’s landing on the reservoir simulator: about 5 to 25 seconds.' : 'Drilling…';
  const r = await call(path, { id: S.id, ...body });
  $('msg').textContent = r.ok ? '' : r.errors.join(' ');
  if (r.session) S = r.session;
  $('sidetrack').disabled = false; $('auto').disabled = false;
  renderAll();
}
$('drill').addEventListener('click', () => act({ target_inclination_deg: targetInc, look_around: $('look').checked, interpretation: interp }));
$('finish').addEventListener('click', () => act({}, '/api/steer/finish'));
$('sidetrack').addEventListener('click', () => act({ sidetrack_to_md: +$('st-md').value }));
$('auto').addEventListener('click', () => act({}, '/api/steer/autosteer'));
$('add-seg').addEventListener('click', () => {
  const g = S.gamma[S.gamma.length - 1], md = g ? g.md : S.bit.md;
  if (interp.some(s => Math.abs(s.md - md) < 50)) return;
  const last = interp[interp.length - 1];
  interp.push({ md, dip_deg: last.dip_deg, throw_ft: 0, thickness_factor: last.thickness_factor ?? 1 });
  interp.sort((a, b) => a.md - b.md); renderSegs(); changed();
});
$('new').addEventListener('click', async () => {
  const r = await call('/api/steer/new', {});
  if (r.ok) location.search = `?id=${r.session.id}`;
});

(async function boot() {
  const id = q.get('id');
  if (!id) { $('start').hidden = false; return; }
  const r = await call(`/api/steer?id=${encodeURIComponent(id)}`);
  if (!r.ok) { $('start').hidden = false; return; }
  S = r.session; targetInc = S.bit.inc;
  try { const saved = JSON.parse(localStorage.getItem('steer.interp.' + S.id)); if (Array.isArray(saved) && saved.length) interp = saved; } catch { /* none */ }
  if (S.link) try { PROG = (JSON.parse(localStorage.getItem(`geo.prog.${S.link.career}`)) || {})[S.link.well] || null; } catch { PROG = null; }
  $('desk').hidden = false;
  renderAll();
})();
