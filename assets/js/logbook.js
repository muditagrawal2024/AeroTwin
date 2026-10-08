// Logbook: every recorded flight with its track, the photos and videos taken
// by the gimbal camera, and saved missions.
import { store } from './core/store.js';
import { h, fmtBytes, download, debounce } from './core/util.js';
import { topbar, toast, confirmDialog } from './core/ui.js';

document.getElementById('top').replaceWith(topbar({ active: 'logbook' }));
const main = document.getElementById('main');
let tab = 'flights';
let selected = null;
const urls = [];

const fmtWhen = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function readHash() {
  const v = decodeURIComponent(location.hash.slice(1));
  if (v === 'media' || v === 'missions' || v === 'flights') { tab = v; selected = null; }
  else if (v) { tab = 'flights'; selected = v; }
}

async function render() {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const [flights, media, missions, usage] = await Promise.all([store.listFlights(), store.listMedia(), store.listMissions(), store.usage()]);
  const totalTime = flights.reduce((a, f) => a + f.durationS, 0);
  const totalDist = flights.reduce((a, f) => a + f.distanceM, 0);

  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['flights', `Flights (${flights.length})`], ['media', `Photos and videos (${media.length})`], ['missions', `Missions (${missions.length})`]].map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', class: tab === id ? 'on' : '', 'aria-selected': String(tab === id), onclick: () => { location.hash = id; } }, label)));

  let body;
  if (tab === 'flights') body = await flightsView(flights);
  else if (tab === 'media') body = mediaView(media);
  else body = missionsView(missions);

  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', {}, 'Logbook'),
        h('p', {}, 'Flights are recorded from take-off to landing at ten samples a second. Everything here is stored in this browser.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: exportAll }, 'Export all'),
        h('a', { class: 'btn primary', href: 'sim.html' }, 'Fly again'))),
    h('div', { class: 'gauges' },
      g(flights.length, 'Flights'), g(mmss(totalTime), 'Time in the air'), g(`${(totalDist / 1000).toFixed(2)} km`, 'Distance flown'),
      g(flights.filter(f => f.crashed).length, 'Crashes'), g(fmtBytes(usage.bytes), 'Stored in this browser')),
    tabs, body);
}

function g(v, l) { return h('div', { class: 'gauge' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l)); }

async function flightsView(flights) {
  if (!flights.length) return empty('No flights yet', 'Open the simulator, press Space to take off and land again. The flight appears here straight away.');
  const sel = flights.find(f => f.id === selected) || flights[0];
  const log = await store.getFlight(sel.id);
  const list = h('div', { class: 'flight-list', role: 'list' }, flights.map(f => h('button', {
    type: 'button', role: 'listitem', class: `fl-item ${f.id === sel.id ? 'on' : ''}`, onclick: () => { location.hash = encodeURIComponent(f.id); }
  },
    h('b', {}, f.flightId),
    h('span', {}, fmtWhen(f.startedAt)),
    h('span', { class: 'fl-meta' }, `${mmss(f.durationS)} · ${Math.round(f.distanceM)} m`, f.crashed ? h('span', { class: 'badge bad' }, 'Crashed') : null))));

  const ev = (log.events || []).filter(e => !['takeoff'].includes(e.type));
  const detail = h('section', { class: 'panel' },
    h('header', {}, h('h2', {}, log.flightId),
      h('div', { class: 'actions' },
        h('a', { class: 'btn small primary', href: `sim.html#replay=${encodeURIComponent(sel.id)}` }, 'Replay in 3D'),
        h('button', { class: 'btn small', type: 'button', onclick: () => download(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }), `${log.flightId}.json`) }, 'Download log'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
          if (await confirmDialog({ title: `Delete ${log.flightId}?`, message: 'The flight log will be removed from this browser.', confirmLabel: 'Delete flight', danger: true })) {
            await store.remove('flights', sel.id); selected = null; location.hash = 'flights'; render();
          }
        } }, 'Delete'))),
    h('div', { class: 'pad stack' },
      pathPlot(log),
      h('p', { class: 'hint' }, 'Track seen from above, coloured by altitude from teal (low) to orange (high).'),
      altChart(log),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Started'), h('dd', {}, fmtWhen(log.startedAt)),
        h('dt', {}, 'Callsign'), h('dd', {}, log.callsign || '—'),
        h('dt', {}, 'Flown with'), h('dd', {}, (log.control || []).join(', ') || 'autopilot only'),
        h('dt', {}, 'Duration'), h('dd', {}, `${log.durationS} s (${log.samples.length} samples)`),
        h('dt', {}, 'Distance'), h('dd', {}, `${log.stats.distanceM} m`),
        h('dt', {}, 'Highest point'), h('dd', {}, `${log.stats.maxAltM} m`),
        h('dt', {}, 'Top speed'), h('dd', {}, `${log.stats.maxSpeed} m/s (${(log.stats.maxSpeed * 3.6).toFixed(1)} km/h)`),
        h('dt', {}, 'Battery used'), h('dd', {}, `${log.stats.batteryUsedPct}%`),
        h('dt', {}, 'Rings passed'), h('dd', {}, String(log.stats.ringsPassed || 0)),
        h('dt', {}, 'Result'), h('dd', {}, log.crashed ? `Crashed (${(log.events || []).find(e => e.type === 'crash')?.obstacle || 'impact'})` : 'Landed safely')),
      ev.length ? h('details', {}, h('summary', { class: 'hint' }, `Flight events (${ev.length})`),
        h('table', { class: 't' }, h('tbody', {}, ev.map(e => h('tr', {}, h('td', { class: 'num' }, `${e.t.toFixed(1)} s`), h('td', {}, e.type.replace(/-/g, ' ')), h('td', { class: 'muted' }, Object.entries(e).filter(([k]) => !['t', 'type'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', '))))))) : null));
  return h('div', { class: 'log-grid' }, list, detail);
}

function mediaView(media) {
  if (!media.length) return empty('No photos or videos yet', 'Press P while flying to take a photo with the gimbal camera, or R to start and stop a video.');
  return h('div', { class: 'media-grid' }, media.map(m => {
    const url = URL.createObjectURL(m.blob); urls.push(url);
    return h('figure', { class: 'media' },
      m.kind === 'photo' ? h('img', { src: url, alt: `Photo ${m.id}`, loading: 'lazy' }) : h('video', { src: url, controls: true, preload: 'metadata' }),
      h('figcaption', {},
        h('div', {}, h('b', {}, m.id), h('div', { class: 'hint' }, `${new Date(m.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}, ${fmtBytes(m.size)}${m.meta?.altitude !== undefined ? `, ${m.meta.altitude} m up` : ''}`)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => download(m.blob, `${m.id}.${m.kind === 'photo' ? 'png' : (m.type.includes('mp4') ? 'mp4' : 'webm')}`) }, 'Download'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await store.remove('media', m.id); render(); } }, 'Delete'))));
  }));
}

function missionsView(missions) {
  return h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Mission'), h('th', {}, 'Last saved'), h('th', { class: 'num' }, 'Earlier versions'), h('th', {}))),
    h('tbody', {}, missions.map(m => h('tr', {},
      h('td', {}, h('b', {}, m.id), m.sample ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'Example') : null),
      h('td', { class: 'muted' }, new Date(m.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })),
      h('td', { class: 'num' }, m.versions.length),
      h('td', {}, h('div', { class: 'actions', style: 'justify-content:flex-end' },
        h('a', { class: 'btn small primary', href: `sim.html#mission=${encodeURIComponent(m.id)}` }, 'Open in editor'),
        h('button', { class: 'btn small', type: 'button', onclick: () => download(new Blob([m.xml], { type: 'text/xml' }), `${m.id}.xml`) }, 'Download XML'),
        m.sample ? null : h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
          if (await confirmDialog({ title: `Delete "${m.id}"?`, message: 'The mission and its earlier versions will be removed.', confirmLabel: 'Delete mission', danger: true })) { await store.remove('missions', m.id); render(); }
        } }, 'Delete')))))))));
}

function empty(title, text) {
  return h('section', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, text), h('a', { class: 'btn primary', href: 'sim.html' }, 'Open the simulator')));
}

async function exportAll() {
  const flights = await store.all('flights');
  const missions = await store.all('missions');
  const data = { format: 'aerotwin-logbook/1', exportedAt: new Date().toISOString(), flights: flights.map(f => f.log), missions: missions.map(m => ({ name: m.id, xml: m.xml })) };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `aerotwin-logbook-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Logbook exported', `${flights.length} flights and ${missions.length} missions. Photos and videos download individually.`);
}

// --- charts ---
function pathPlot(log) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'path-plot'); svg.setAttribute('viewBox', '0 0 600 300');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Flight track seen from above');
  const s = log.samples || [];
  if (!s.length) return svg;
  const xs = s.map(r => r[1]), zs = s.map(r => r[3]);
  const minX = Math.min(...xs, -10), maxX = Math.max(...xs, 10), minZ = Math.min(...zs, -10), maxZ = Math.max(...zs, 10);
  const scale = Math.min(560 / (maxX - minX), 260 / (maxZ - minZ));
  const cx = 300 - (minX + maxX) / 2 * scale, cy = 150 + (minZ + maxZ) / 2 * scale;
  const P = r => [cx + r[1] * scale, cy - r[3] * scale];
  let inner = '';
  const step = Math.max(10, Math.round(scale * 10) * 2);
  for (let x = cx % step; x < 600; x += step) inner += `<line x1="${x}" y1="0" x2="${x}" y2="300" stroke="#223b54"/>`;
  for (let y = cy % step; y < 300; y += step) inner += `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="#223b54"/>`;
  const maxAlt = Math.max(...s.map(r => r[2]), 1);
  const k = Math.max(1, Math.floor(s.length / 400));
  for (let i = k; i < s.length; i += k) {
    const a = s[i][2] / maxAlt; const [x1, y1] = P(s[i - k]), [x2, y2] = P(s[i]);
    inner += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="hsl(${172 - a * 147} 75% ${55 + a * 5}%)" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  const [hx, hy] = P([0, 0, 0, 0]);
  inner += `<circle cx="${hx}" cy="${hy}" r="7" fill="none" stroke="#f2c14e" stroke-width="1.6"/><text x="${hx + 11}" y="${hy + 4}" fill="#95abc1" font-size="12" font-family="Archivo, sans-serif">pad</text>`;
  if (log.crashed) { const [lx, ly] = P(s[s.length - 1]); inner += `<path d="M${lx - 6} ${ly - 6}L${lx + 6} ${ly + 6}M${lx + 6} ${ly - 6}L${lx - 6} ${ly + 6}" stroke="#ff6461" stroke-width="2.4"/>`; }
  inner += `<text x="586" y="20" fill="#95abc1" font-size="12" text-anchor="end" font-family="Archivo, sans-serif">N ↑</text>`;
  svg.innerHTML = inner;
  return svg;
}

function altChart(log) {
  const s = log.samples || [];
  if (s.length < 2) return h('span');
  const W = 600, H = 110, end = s[s.length - 1][0] || 1, maxA = Math.max(...s.map(r => r[2]), 1) * 1.1, maxV = Math.max(...s.map(r => r[5]), 1) * 1.1;
  const pts = (col, max) => s.filter((_, i) => i % Math.max(1, Math.floor(s.length / 300)) === 0).map(r => `${(r[0] / end * W).toFixed(1)},${(H - 16 - r[col] / max * (H - 26)).toFixed(1)}`).join(' ');
  return h('div', { html: `<svg class="alt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Altitude and speed over time">
    <line x1="0" x2="${W}" y1="${H - 16}" y2="${H - 16}" stroke="#2a4661"/>
    <polyline fill="none" stroke="#3fc6b4" stroke-width="2" points="${pts(2, maxA)}"/>
    <polyline fill="none" stroke="#ff7a1a" stroke-width="1.6" stroke-dasharray="4 3" points="${pts(5, maxV)}"/>
    <text x="4" y="12" fill="#3fc6b4" font-size="12" font-family="Archivo, sans-serif">Altitude (max ${(maxA / 1.1).toFixed(1)} m)</text>
    <text x="${W - 4}" y="12" fill="#ff7a1a" font-size="12" text-anchor="end" font-family="Archivo, sans-serif">Speed (max ${(maxV / 1.1).toFixed(1)} m/s)</text>
    <text x="0" y="${H - 2}" fill="#6d86a0" font-size="11" font-family="Archivo, sans-serif">0 s</text>
    <text x="${W}" y="${H - 2}" fill="#6d86a0" font-size="11" text-anchor="end" font-family="Archivo, sans-serif">${end.toFixed(0)} s</text></svg>` });
}

readHash();
window.addEventListener('hashchange', () => { readHash(); render(); });
store.ready().then(render).catch(e => {
  main.replaceChildren(empty('Browser storage is unavailable', 'The logbook keeps flights in this browser. Open the site in a normal (non-private) window to use it.'));
  console.error(e);
});
store.on(debounce(() => render(), 300));
