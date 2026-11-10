// Client for ressim-83's game API (game/API.md). With ?fixture=1 it serves saved responses instead, so the UI can be
// developed and screenshotted without the simulator and without writing scores.
const FIX = new URLSearchParams(location.search).get('fixture');

async function json(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON error */ }
  if (!r.ok && !(body && body.errors)) throw new Error(`${url}: HTTP ${r.status}`);
  return { status: r.status, body };
}

export const api = {
  fixture: !!FIX,

  async status() {
    if (FIX) return 'ready';
    try { return (await json('/api/status')).body.sim; } catch { return 'error'; }
  },

  async levels() {
    return (await json(FIX ? 'fixtures/levels.json' : '/api/levels')).body;
  },

  async scores(level) {
    if (FIX) return [];
    return (await json(`/api/scores?level=${encodeURIComponent(level)}`)).body;
  },

  // returns { ok, ...run } or { ok:false, errors[] }; 503 when the server runs without the simulator
  async run(level, design, player, { record = true } = {}) {
    if (FIX) {
      const name = FIX === 'sandbox' ? 'fixtures/run-sandbox.json' : 'fixtures/run.json';
      await new Promise(r => setTimeout(r, 1200));
      return (await json(name)).body;
    }
    const { status, body } = await json('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, design, player, record }),
    });
    if (status === 503) return { ok: false, errors: ['The simulator is not running. Start the server without --no-sim.'] };
    return body;
  },

  async field(runId) {
    if (FIX) return (await json(FIX === 'sandbox' ? 'fixtures/field-sandbox.json' : 'fixtures/field.json')).body;
    const { status, body } = await json(`/api/field?run=${encodeURIComponent(runId)}`);
    return status === 200 ? body : null;
  },
};

// Capex, the same formula the server uses (API.md). Checked against a server run: 6 x 250 ft, 50 md-ft, 1,500 psi on
// First Light gives $4,397,500, matching the server's cost.total_usd.
export function capex(level, design) {
  const c = level.costs, n = design.stages;
  const hl = per(design.half_length_ft, n), cd = per(design.conductivity_mdft, n);
  const well = c.well_base_usd + c.lateral_usd_ft * level.lateral_ft;
  const stages = c.stage_usd * n;
  const size = hl.reduce((a, h) => a + c.half_length_usd * (h / 100) ** 2, 0);
  const prop = cd.reduce((a, k) => a + c.conductivity_usd_mdft * k, 0);
  const lift = c.lift_usd_per_kpsi * Math.max(0, c.lift_free_bhp_psi - design.bhp_psi) / 1000;
  return { well, stages, size, prop, lift, total: well + stages + size + prop + lift };
}
export const per = (v, n) => Array.isArray(v) ? v.slice(0, n) : Array(n).fill(v);

export const fmt = {
  usd: (v) => {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`;
    return `${s}$${Math.round(a)}`;
  },
  int: (v) => Math.round(v).toLocaleString('en-US'),
};
