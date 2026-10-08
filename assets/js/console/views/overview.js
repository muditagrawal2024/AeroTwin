import { s3 } from '../../core/s3.js';
import { h, fmtBytes, fmtUSD, fmtDate } from '../../core/util.js';
import { classBar } from '../components.js';

export async function render(root) {
  const draw = async () => {
    const [stats, bill, reqs, buckets] = await Promise.all([s3.accountStats(), s3.billing(), s3.listRequests(8), s3.listBuckets({ log: false })]);
    let flights = [];
    try { flights = JSON.parse(await s3.getObjectText('aerotwin-flight-logs', 'analytics/flight-index.json')); } catch { /* no index yet */ }

    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' },
          h('h1', {}, 'S3 overview'),
          h('p', {}, 'A working simulation of Amazon S3. Create buckets, upload objects, turn on versioning and lifecycle rules, share with policies or presigned URLs, and watch the bill. The drone simulator writes its flight logs, photos and missions into these buckets as you fly.')),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: '#/s3' }, 'Open buckets'),
          h('a', { class: 'btn primary', href: 'sim.html' }, 'Fly the drone'))),
      h('div', { class: 'gauges' },
        gauge(stats.buckets, 'Buckets', `${buckets.filter(b => b.versioning === 'Enabled').length} with versioning`),
        gauge(stats.objects, 'Objects', `${stats.versions} versions stored`),
        gauge(fmtBytes(stats.bytes), 'Stored', 'all versions, all classes'),
        gauge(fmtUSD(bill.total, 6), 'Charges this month', `Forecast ${fmtUSD(bill.forecast, 6)}`),
        gauge(flights.length, 'Flights indexed', 'by the flight-indexer function')),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' },
          h('header', {}, h('h3', {}, 'Storage by class')),
          h('div', { class: 'pad' }, classBar(stats.byClass),
            h('p', { class: 'hint', style: 'margin-top:12px' }, 'Flight logs start in Standard and move to Standard-IA after 30 days and to Glacier Flexible Retrieval after 90, following the tier-flight-logs lifecycle rule. Use the clock in the top bar to move time forward.'))),
        h('section', { class: 'panel' },
          h('header', {}, h('h3', {}, 'Latest API calls'), h('a', { class: 'btn small ghost', href: '#/activity' }, 'View all')),
          h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('tbody', {},
            reqs.map(r => h('tr', {},
              h('td', {}, h('code', {}, r.api)),
              h('td', { class: 'muted' }, r.bucket ? `${r.bucket}${r.key ? '/' + r.key : ''}`.slice(0, 48) : '—'),
              h('td', {}, h('span', { class: `badge ${r.status < 300 ? 'ok' : 'bad'}` }, r.status))))))))),
      h('section', { class: 'panel', style: 'margin-top:16px' },
        h('header', {}, h('h3', {}, 'Recent drone flights stored in S3'), h('a', { class: 'btn small', href: '#/s3/aerotwin-flight-logs?prefix=logs/' }, 'Browse flight logs')),
        flights.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Flight'), h('th', {}, 'Started'), h('th', {}, 'Control'), h('th', { class: 'num' }, 'Duration'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'Max altitude'), h('th', {}, 'Result'), h('th', {}))),
          h('tbody', {}, flights.slice(0, 8).map(f => h('tr', {},
            h('td', {}, h('a', { class: 'obj', href: `#/s3/aerotwin-flight-logs/object?key=${encodeURIComponent(f.key)}` }, f.flightId)),
            h('td', { class: 'muted' }, fmtDate(Date.parse(f.startedAt))),
            h('td', {}, (f.control || []).join(', ')),
            h('td', { class: 'num' }, `${Math.round(f.durationS)} s`),
            h('td', { class: 'num' }, `${(f.distanceM || 0).toFixed(0)} m`),
            h('td', { class: 'num' }, `${(f.maxAltM || 0).toFixed(1)} m`),
            h('td', {}, f.crashed ? h('span', { class: 'badge bad' }, 'Crashed') : h('span', { class: 'badge ok' }, 'Landed')),
            h('td', {}, h('a', { class: 'btn small', href: `sim.html#replay=${encodeURIComponent('aerotwin-flight-logs/' + f.key)}` }, 'Replay'))))))) :
          h('div', { class: 'empty' }, h('h3', {}, 'No flights yet'), h('p', {}, 'Take off in the simulator and land again. The flight log appears here within a second.')))
    );
  };
  await draw();
  return { refresh: draw };
}

function gauge(v, l, s) {
  return h('div', { class: 'gauge' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l), s ? h('div', { class: 's' }, s) : null);
}
