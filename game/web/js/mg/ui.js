// Small shared helpers for the minigame pages.
export const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
export const num = (v, d = 0) => v == null ? '–' : (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const usd = (v) => { if (v == null) return '–'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)} MM` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`; };
const NS = 'http://www.w3.org/2000/svg';
export const sv = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v); p?.appendChild(e); return e; };
