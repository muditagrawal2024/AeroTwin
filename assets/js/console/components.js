import { h, copyText, fmtBytes } from '../core/util.js';
import { STORAGE_CLASSES } from '../core/pricing.js';
import { toast } from '../core/ui.js';

export function clsTag(cls) {
  const c = STORAGE_CLASSES[cls] || STORAGE_CLASSES.STANDARD;
  return h('span', { class: 'cls', style: `--c:${c.color}` }, c.short);
}

export function accessBadge(b) {
  if (!b.blockPublicAccess && b.policy && /"Principal"\s*:\s*("\*"|\{\s*"AWS"\s*:\s*"\*")/.test(b.policy)) {
    return h('span', { class: 'badge hot', title: 'A bucket policy grants public read access' }, 'Public');
  }
  if (!b.blockPublicAccess) return h('span', { class: 'badge warn' }, 'Objects can be public');
  return h('span', { class: 'badge' }, 'Bucket and objects not public');
}

export function versioningBadge(v) {
  return h('span', { class: `badge ${v === 'Enabled' ? 'ok' : v === 'Suspended' ? 'warn' : ''}` }, v);
}

export function copyable(text, display) {
  return h('span', { class: 'copyable' }, h('span', {}, display ?? text),
    h('button', {
      class: 'copy-btn', type: 'button', title: 'Copy', 'aria-label': `Copy ${text}`,
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
      onclick: () => { copyText(text); toast('Copied', text.length > 90 ? text.slice(0, 90) + '…' : text); }
    }));
}

export function classBar(byClass) {
  const total = Object.values(byClass).reduce((a, b) => a + b, 0);
  const bar = h('div', { class: 'classbar', role: 'img', 'aria-label': 'Storage by class' });
  const legend = h('div', { class: 'legend' });
  for (const [cls, meta] of Object.entries(STORAGE_CLASSES)) {
    const v = byClass[cls] || 0;
    if (total && v) bar.append(h('span', { style: `width:${(v / total * 100).toFixed(2)}%;background:${meta.color}`, title: `${meta.label}: ${fmtBytes(v)}` }));
    legend.append(h('span', { class: 'cls', style: `--c:${meta.color}` }, meta.short, h('b', {}, fmtBytes(v))));
  }
  return h('div', {}, bar, legend);
}

/** Draws the top-down track of a flight log as an inline SVG. */
export function pathPlot(log) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'path-plot');
  svg.setAttribute('viewBox', '0 0 400 220');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Flight path seen from above');
  const s = log.samples || [];
  if (!s.length) return svg;
  const xs = s.map(r => r[1]), zs = s.map(r => r[3]);
  const minX = Math.min(...xs, -5), maxX = Math.max(...xs, 5), minZ = Math.min(...zs, -5), maxZ = Math.max(...zs, 5);
  const scale = Math.min(360 / (maxX - minX), 180 / (maxZ - minZ));
  const cx = 200 - (minX + maxX) / 2 * scale, cy = 110 + (minZ + maxZ) / 2 * scale;
  const P = r => [cx + r[1] * scale, cy - r[3] * scale];
  let inner = '';
  for (let i = 0; i <= 400; i += 40) inner += `<line x1="${i}" y1="0" x2="${i}" y2="220" stroke="#223b54"/>`;
  for (let i = 0; i <= 220; i += 40) inner += `<line x1="0" y1="${i}" x2="400" y2="${i}" stroke="#223b54"/>`;
  const maxAlt = Math.max(...s.map(r => r[2]), 1);
  const step = Math.max(1, Math.floor(s.length / 300));
  for (let i = step; i < s.length; i += step) {
    const a = s[i][2] / maxAlt;
    const [x1, y1] = P(s[i - step]), [x2, y2] = P(s[i]);
    inner += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="hsl(${172 - a * 147} 75% ${55 + a * 5}%)" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  const [hx, hy] = P([0, 0, 0, 0]);
  inner += `<circle cx="${hx}" cy="${hy}" r="6" fill="none" stroke="#e7eef5" stroke-width="1.5"/><text x="${hx + 9}" y="${hy + 4}" fill="#95abc1" font-size="11">home</text>`;
  if (log.crashed) {
    const [lx, ly] = P(s[s.length - 1]);
    inner += `<circle cx="${lx}" cy="${ly}" r="7" fill="none" stroke="#ff6461" stroke-width="2"/><text x="${lx + 10}" y="${ly + 4}" fill="#ff9c9a" font-size="11">crash</text>`;
  }
  svg.innerHTML = inner;
  return svg;
}
