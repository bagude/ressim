// Local stand-in for /api/mg while games are being built server-side (?mock=1). Same shapes as game/API.md "Minigames";
// the numbers are invented for layout work and are labelled as a preview everywhere they show.
const LIST = [
  { kind: 'pump-job', title: 'Pump the Job', blurb: 'Run a frac stage from the van: rate, proppant ramp and pressure. Watch the fracture grow against the barriers.', status: 'live', sim: true },
  { kind: 'flowback', title: 'Flowback', blurb: 'Open the choke month by month. Draw down too hard and you cross the bubble point.', status: 'live', sim: true },
  { kind: 'facility', title: 'Debottleneck', blurb: 'Several wells, one separator. Size the tubing, set the pressure, choose how to allocate.', status: 'coming', sim: true },
  { kind: 'lift', title: 'Artificial Lift', blurb: 'Natural flow, gas lift or a pump: switch at the right time as the well declines.', status: 'coming', sim: true },
  { kind: 'land-auction', title: 'Land Auction', blurb: 'Sealed bids on tracts, with hints. Beware the winner’s curse.', status: 'coming', sim: false },
  { kind: 'rig-contracts', title: 'Rig Contracts', blurb: 'Term or spot? Ride a rig rate market without stranding rigs.', status: 'coming', sim: false },
  { kind: 'hedging', title: 'Hedging', blurb: 'Swaps and collars against a price path you cannot see.', status: 'coming', sim: false },
  { kind: 'diagnostics', title: 'Read the Well', blurb: 'A noisy production history: name the flow regime, spot the frac hit, estimate half-length.', status: 'coming', sim: false },
  { kind: 'well-control', title: 'Take a Kick', blurb: 'Pit gain and pressures after a kick. Work out the kill mud weight and pump it.', status: 'coming', sim: false },
];
const sessions = {};
function pumpView(state) {
  const n = state.t.length, t = state.t;
  return {
    phase: state.phase, stage: 1, pay: { top_ft: -50, base_ft: 50 }, barriers: [{ top_ft: -130, base_ft: -50, stress_psi: 6900 }, { top_ft: 50, base_ft: 140, stress_psi: 7100 }],
    fracture: { half_length_ft: state.xf, height_up_ft: state.hu, height_down_ft: state.hd, width_in: 0.18, propped_half_length_ft: state.xp },
    series: { t_min: t, surface_psi: t.map((x, i) => 7800 + 900 * Math.sin(i / 7) + i * 6), net_psi: t.map((x, i) => 300 + i * 9), rate_bpm: t.map(() => state.rate), ppa: t.map((x, i) => Math.min(4, i / 12)) },
    schedule: [{ ppa: 0, bbl: 400 }, { ppa: 0.5, bbl: 300 }, { ppa: 1.0, bbl: 300 }, { ppa: 2.0, bbl: 300 }, { ppa: 3.0, bbl: 200 }],
    alarms: state.alarms, limits: { max_surface_psi: 10500 }, proppant_placed_lb: n * 4000,
  };
}
function newPump(id) {
  const st = { phase: 'pad', t: [...Array(20).keys()].map(i => i * 0.5), xf: 120, hu: 30, hd: 25, xp: 0, rate: 80, alarms: [] };
  return { st, session: () => ({ id, kind: 'pump-job', title: 'Pump the Job (preview data)', status: st.done ? 'finished' : 'active', turn: st.t.length - 20,
    notes: ['Preview with invented numbers: the real game runs the fracture-growth model (pseudo-3D, symmetric barriers).',
      'Growth predicts length and height only; conductivity is a declared input with no proppant transport model.'],
    actions: st.done ? [] : [
      { name: 'pump', label: 'Pump the next 5 minutes', args: { rate_bpm: { type: 'number', min: 40, max: 110, step: 1, unit: 'bbl/min', default: st.rate }, ppa: { type: 'number', min: 0, max: 4, step: 0.25, unit: 'lb/gal', default: 1 } } },
      { name: 'flush', label: 'Flush and finish the stage', args: {} },
    ],
    view: pumpView(st),
    result: st.done ? { score: 2.4e6, stars: 2, headline: 'Stage placed: 285 ft propped half-length', breakdown: { propped_half_length_ft: 285, conductivity_mdft: 42, oil_bbl_5yr: 61000, npv10_usd: 2.4e6, height_growth_ft: 70 } } : null }) };
}
export function handle(path, body) {
  if (path === '/api/mg') return LIST;
  const m = /^\/api\/mg\/([\w-]+)(\/(new|act))?(\?id=(.+))?$/.exec(path);
  if (!m) return { ok: false, errors: ['no such endpoint'] };
  const [, kind, , verb, , qid] = m;
  if (verb === 'new') {
    const id = 'mock' + Math.random().toString(36).slice(2, 8);
    sessions[id] = kind === 'pump-job' ? newPump(id) : { session: () => ({ id, kind, title: `${kind} (preview data)`, status: 'active', turn: 0, notes: ['Preview with invented numbers.'],
      actions: [{ name: 'step', label: 'Advance one month', args: { choke_64ths: { type: 'int', min: 8, max: 64, unit: '/64 in', default: 16 } } }],
      view: { month: 0, bhp_psi: 4800, series: { month: [0, 1, 2, 3], oil_bbl_d: [0, 900, 700, 600], gor_scf_bbl: [800, 820, 900, 1100] } } }) };
    sessionStorage.setItem('mg.mock.' + id, kind);
    return { ok: true, session: sessions[id].session() };
  }
  const id = qid || body?.id;
  if (!sessions[id]) sessions[id] = sessionStorage.getItem('mg.mock.' + id) === 'pump-job' ? newPump(id) : null;
  if (!sessions[id]) return { ok: false, errors: ['This preview session expired; start a new one.'] };
  if (verb === 'act' && kind === 'pump-job') {
    const st = sessions[id].st;
    if (body.action === 'flush') { st.done = true; return { ok: true, session: sessions[id].session(), events: ['Flushed. Stage complete.'] }; }
    st.rate = body.rate_bpm;
    for (let k = 0; k < 10; k++) st.t.push(st.t[st.t.length - 1] + 0.5);
    st.xf += body.rate_bpm * 0.6; st.hu += body.rate_bpm > 95 ? 18 : 4; st.hd += 3; st.xp = Math.max(st.xp, st.xf * Math.min(1, body.ppa / 3));
    st.phase = body.ppa > 0 ? 'proppant' : 'pad';
    const ev = [`Pumped 5 minutes at ${body.rate_bpm} bbl/min, ${body.ppa} lb/gal.`];
    if (st.hu > 80 && !st.alarms.includes('height_runaway')) { st.alarms.push('height_runaway'); ev.push('Height runaway: the fracture broke through the upper barrier.'); }
    return { ok: true, session: sessions[id].session(), events: ev };
  }
  return { ok: true, session: sessions[id].session() };
}
