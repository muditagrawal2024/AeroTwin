export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtBytes(n) {
  if (n === undefined || n === null) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

export function fmtUSD(v, digits) {
  if (!Number.isFinite(v)) return '$0.00';
  const d = digits ?? (v === 0 ? 2 : v < 0.01 ? 6 : v < 1 ? 4 : 2);
  return '$' + v.toFixed(d);
}

export function fmtDate(ms, withTime = true) {
  const d = new Date(ms);
  const opts = withTime
    ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { year: 'numeric', month: 'short', day: '2-digit' };
  return d.toLocaleString('en-GB', opts);
}

export function isoDate(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

export function randId(len = 16, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return [...buf].map(b => alphabet[b % alphabet.length]).join('');
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function guessContentType(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return ({
    json: 'application/json', xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    webm: 'video/webm', mp4: 'video/mp4', pdf: 'application/pdf', zip: 'application/zip'
  })[ext] || 'application/octet-stream';
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const t = h('textarea', {}, text); document.body.append(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  });
}
