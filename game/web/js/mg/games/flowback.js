// Flowback: open the choke month by month. Bottom-hole pressure is drawn against the bubble point: below it, gas comes
// out of solution in the rock and GOR climbs. One measure per chart.
// view {month, bubble_point_psi, choke_64ths, series {month[], bhp_psi[], oil_bbl_d[], gas_mcf_d[], gor_scf_bbl[], water_bbl_d[], cum_cash_usd[]}}
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const S = v.series || {}, x = S.month || [];
  const bhp = S.bhp_psi?.[S.bhp_psi.length - 1], pb = v.bubble_point_psi;
  const below = bhp != null && pb != null && bhp < pb;
  host.append(h('div', { class: 'alarms', role: 'status' },
    pb != null ? h('span', { class: 'alarm-chip' + (below ? '' : ' ok') }, below ? `⚠ Below the bubble point: ${num(bhp)} psi under ${num(pb)} psi` : `Above the bubble point: ${num(bhp ?? 0)} psi, bubble point ${num(pb)} psi`) : null,
    v.choke_64ths != null ? h('span', { class: 'tag' }, `Choke ${v.choke_64ths}/64 in`) : null,
    v.oil_price_usd_bbl != null ? h('span', { class: 'tag' }, `Oil $${num(v.oil_price_usd_bbl, 2)}/bbl`) : null,
    v.gas_price_usd_mcf != null ? h('span', { class: v.gas_price_usd_mcf < 0 ? 'alarm-chip' : 'tag' }, `Gas ${v.gas_price_usd_mcf < 0 ? '−' : ''}$${num(Math.abs(v.gas_price_usd_mcf), 2)}/Mcf${v.gas_market ? `: ${v.gas_market}` : ''}`) : null));
  if (v.gas_price_usd_mcf != null && v.gas_price_usd_mcf <= 0)
    host.append(h('p', { class: 'hint' }, 'Gas is worth nothing or less here: every extra Mcf costs you. Below the bubble point the rock gives much more gas but little more oil.'));
  const grid = h('div', { class: 'views' }); host.append(grid);
  const add = (title, series, fmt) => { const d = h('div', { class: 'panel-card' }); grid.append(d); multiChart(d, { title, x, xLabel: 'month', H: 200, W: 560, fmtY: fmt, fmtTipX: (m) => `Month ${m}`, series }); };
  if (S.bhp_psi) add('Bottom-hole pressure, psi', [{ name: 'BHP', y: S.bhp_psi, color: COLORS.dev }, ...(pb != null ? [{ name: 'Bubble point', y: x.map(() => pb), color: '#c8463a', dash: '4 3', tip: false }] : [])], (y) => num(y));
  if (S.oil_bbl_d) add('Oil rate, bbl/d', [{ name: 'Oil', y: S.oil_bbl_d, color: COLORS.dev }], (y) => num(y));
  if (S.gor_scf_bbl) add('Gas-oil ratio, scf/bbl', [{ name: 'GOR', y: S.gor_scf_bbl, color: COLORS.pdp }], (y) => num(y));
  if (S.gas_mcf_d) add('Gas, Mcf/d', [{ name: 'Gas produced', y: S.gas_mcf_d, color: COLORS.pdp },
    ...(v.gas_takeaway_mcf_d ? [{ name: 'Takeaway limit', y: x.map(() => v.gas_takeaway_mcf_d), color: '#c8463a', dash: '4 3', tip: false }] : []),
    ...(S.flared_mcf_d?.some(f => f > 0) ? [{ name: 'Flared', y: S.flared_mcf_d, color: '#c8463a' }] : [])], (y) => num(y));
  if (S.cum_cash_usd) add('Cumulative cash', [{ name: 'Cash', y: S.cum_cash_usd, color: COLORS.dev }], usd);
  host.append(h('p', { class: 'hint' }, `Month ${v.month} of ${v.decision_months}. Initial reservoir pressure ${num(v.initial_pressure_psi)} psi, bubble point ${num(pb)} psi, ${v.stages} stages. Gas above ${num(v.gas_takeaway_mcf_d)} Mcf/d is flared at $${num(v.flare_fee_usd_mcf, 2)}/Mcf.`));
}
// hold the bottom-hole pressure where the player left it
export const prefill = (S) => { const b = S.view?.schedule_bhp_psi; return { set_month: { bhp_psi: b?.length ? b[b.length - 1] : undefined } }; };
