// Hedging: a quarter at a time. Price history, how much of each month's oil is hedged, cash against the covenant
// floor, the trade book and today's quotes.
// view {month, quarter, quarters_total, spot_wti_usd_bbl, differential_usd_bbl, wells, hedge_cap, implied_vol,
//       covenant_floor_usd[quarter], coverage [{month, forecast_bbl, swap_bbl, floor_bbl, capped_bbl, hedge_ratio}],
//       book [{type, quarter, first_month, bbl[], price?, strike?...}], history [{month, wti, oil_bbl, physical_usd, hedge_usd, cash_usd}],
//       quarterly_cash_usd[], quotes {swap_price_usd_bbl, put_premium_usd_bbl [{strike, premium}], call_premium_usd_bbl [...], note}}
import { h, num, usd } from '../ui.js';
import { multiChart, COLORS } from '../../career/charts2.js';

export function render(v, host) {
  host.replaceChildren();
  const breach = (v.quarterly_cash_usd || []).some((c, i) => v.covenant_floor_usd?.[i] != null && c < v.covenant_floor_usd[i]);
  host.append(h('div', { class: 'alarms' }, breach ? h('span', { class: 'alarm-chip' }, '⚠ A quarter fell below the covenant floor') : h('span', { class: 'alarm-chip ok' }, 'Covenant met so far'),
    h('span', { class: 'tag' }, `Quarter ${v.quarter} of ${v.quarters_total}`), h('span', { class: 'tag' }, `WTI $${num(v.spot_wti_usd_bbl, 2)}`),
    h('span', { class: 'tag' }, `Your differential ${v.differential_usd_bbl >= 0 ? '+' : '−'}$${num(Math.abs(v.differential_usd_bbl), 2)}`),
    h('span', { class: 'tag' }, `Hedge at most ${num(v.hedge_cap * 100)}%`), h('span', { class: 'tag' }, `Implied volatility ${num(v.implied_vol * 100)}%`)));
  const grid = h('div', { class: 'views' }); host.append(grid);
  const H = v.history || [];
  if (H.length) {
    let d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'WTI so far, $/bbl', x: H.map(r => r.month), xLabel: 'month', H: 200, W: 560, fmtY: (y) => `$${num(y)}`, fmtTipX: (m) => `Month ${m}`, series: [{ name: 'WTI', y: H.map(r => r.wti), color: COLORS.dev }] });
    let cum = 0, cumU = 0;
    const hedged = H.map(r => (cum += r.cash_usd)), un = H.map(r => (cumU += r.physical_usd));
    d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Cumulative cash: with your hedges against none', x: H.map(r => r.month), xLabel: 'month', H: 200, W: 560, fmtY: usd, fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'With hedges', y: hedged, color: COLORS.dev }, { name: 'Unhedged', y: un, color: COLORS.pdp, dash: true }] });
  }
  const Q = v.quarterly_cash_usd || [], F = v.covenant_floor_usd || [];
  if (F.length) {
    const d = h('div', { class: 'panel-card' }); grid.append(d);
    const qx = F.map((_, i) => i + 1);
    multiChart(d, { title: 'Quarterly cash against the covenant floor', x: qx, xLabel: 'quarter', H: 200, W: 560, fmtY: usd, fmtX: (x) => Number.isInteger(x) ? String(x) : '', fmtTipX: (q) => `Quarter ${q}`,
      series: [{ name: 'Your cash', y: qx.map((_, i) => Q[i] ?? null), color: COLORS.dev }, { name: 'Covenant floor', y: F, color: '#c8463a', dash: '4 3' }] });
  }
  const C = v.coverage || [];
  if (C.length) {
    const d = h('div', { class: 'panel-card' }); grid.append(d);
    multiChart(d, { title: 'Share of each month’s oil hedged', x: C.map(c => c.month), xLabel: 'month', H: 200, W: 560, fmtY: (y) => `${num(y * 100)}%`, fmtTipX: (m) => `Month ${m}`,
      series: [{ name: 'Hedged share', y: C.map(c => c.hedge_ratio), color: COLORS.dev }, { name: 'Cap', y: C.map(() => v.hedge_cap), color: '#c8463a', dash: '4 3', tip: false }] });
  }
  const book = v.book || [];
  grid.append(h('div', { class: 'panel-card' }, h('h2', {}, 'Your book'), book.length ? h('ul', { class: 'plain' }, ...book.map(b => h('li', {},
    h('span', {}, `${b.type.charAt(0).toUpperCase() + b.type.slice(1)}${b.price != null ? ` at $${num(b.price, 2)}` : ''}${b.put_strike != null ? `, floor $${num(b.put_strike, 2)}` : ''}${b.call_strike != null ? `, cap $${num(b.call_strike, 2)}` : ''}`),
    h('span', { class: 'hint' }, `${num((b.bbl || []).reduce((a, x) => a + x, 0))} bbl over ${(b.bbl || []).length} months`)))) : h('p', { class: 'hint' }, 'No hedges: you take whatever the price does.'),
    v.quotes ? h('div', {}, h('h2', {}, 'Quotes now'), h('p', {}, `Swap: $${num(v.quotes.swap_price_usd_bbl, 2)}/bbl.`),
      h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Put strike'), h('th', {}, 'Premium'), h('th', {}, 'Call strike'), h('th', {}, 'Premium'))),
        h('tbody', {}, ...(v.quotes.put_premium_usd_bbl || []).map((p, i) => { const c = v.quotes.call_premium_usd_bbl?.[i]; return h('tr', {}, h('td', {}, `$${num(p.strike, 2)}`), h('td', {}, `$${num(p.premium, 2)}`), h('td', {}, c ? `$${num(c.strike, 2)}` : ''), h('td', {}, c ? `$${num(c.premium, 2)}` : '')); }))),
      h('p', { class: 'hint' }, v.quotes.note)) : null));
}
