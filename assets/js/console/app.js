import { s3 } from '../core/s3.js';
import { h, debounce } from '../core/util.js';
import { topbar, icon, toast } from '../core/ui.js';

const routes = [
  { re: /^\/?$/, view: 'overview', nav: 'overview' },
  { re: /^\/s3\/?$/, view: 'buckets', nav: 's3' },
  { re: /^\/s3\/([^/]+)\/object$/, view: 'object', nav: 's3', keys: ['bucket'] },
  { re: /^\/s3\/([^/]+)\/?$/, view: 'bucket', nav: 's3', keys: ['bucket'] },
  { re: /^\/billing\/?$/, view: 'billing', nav: 'billing' },
  { re: /^\/cli\/?$/, view: 'cli', nav: 'cli' },
  { re: /^\/activity\/?$/, view: 'activity', nav: 'activity' },
  { re: /^\/about\/?$/, view: 'about', nav: 'about' }
];

const navItems = [
  { id: 'overview', label: 'Overview', href: '#/', icon: 'home' },
  { id: 's3', label: 'Buckets', href: '#/s3', icon: 'bucket' },
  { id: 'billing', label: 'Billing and cost', href: '#/billing', icon: 'bill' },
  { id: 'cli', label: 'AWS CLI', href: '#/cli', icon: 'term' },
  { id: 'activity', label: 'Activity log', href: '#/activity', icon: 'list' },
  { id: 'sim', label: 'Drone simulator', href: 'sim.html', icon: 'drone' },
  { id: 'about', label: 'How S3 works here', href: '#/about', icon: 'info' }
];

document.getElementById('top').replaceWith(topbar({ active: 'console' }));
const rail = document.getElementById('rail');
const view = document.getElementById('view');
let current = { cleanup: null, refresh: null, name: null };

function buildRail(active) {
  rail.replaceChildren(
    ...navItems.slice(0, 5).map(n => h('a', { href: n.href, class: n.id === active ? 'on' : '', 'aria-current': n.id === active ? 'page' : null }, icon(n.icon), n.label)),
    h('div', { class: 'rail-group' }, 'Data producer'),
    ...navItems.slice(5, 6).map(n => h('a', { href: n.href }, icon(n.icon), n.label)),
    h('div', { class: 'rail-group' }, 'Learn'),
    ...navItems.slice(6).map(n => h('a', { href: n.href, class: n.id === active ? 'on' : '' }, icon(n.icon), n.label)),
    h('div', { class: 'rail-foot', id: 'acct' })
  );
  const a = s3.account();
  if (a) rail.querySelector('#acct').append(
    h('div', {}, 'Account ', h('code', {}, a.accountId)),
    h('div', {}, 'Alias ', h('code', {}, a.alias)),
    h('div', {}, 'Simulated data lives in this browser (IndexedDB).'));
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { ...r, params, query };
    }
  }
  return { view: 'overview', nav: 'overview', params: {}, query };
}

async function render() {
  const route = parseHash();
  buildRail(route.nav);
  current.cleanup?.();
  const inner = h('div', { class: 'view-inner' });
  view.replaceChildren(inner);
  try {
    const mod = await import(`./views/${route.view}.js`);
    const res = await mod.render(inner, route.params, route.query);
    current = { cleanup: res?.cleanup || null, refresh: res?.refresh || null, name: route.view };
  } catch (e) {
    console.error(e);
    inner.replaceChildren(h('div', { class: 'panel' }, h('div', { class: 'empty' },
      h('h3', {}, e.code === 'NoSuchBucket' ? 'Bucket not found' : 'This page could not load'),
      h('p', {}, e.message || String(e)),
      h('a', { class: 'btn', href: '#/s3' }, 'Go to buckets'))));
  }
  view.focus({ preventScroll: true });
  view.scrollTop = 0;
}

s3.ready().then(() => {
  render();
  window.addEventListener('hashchange', render);
  const refresh = debounce(() => current.refresh?.(), 350);
  s3.on(e => {
    if (e.type === 'reset') return;
    if (e.type === 'object' && e.remote && e.source === 'drone-sim') toast('Drone uploaded an object', `s3://${e.bucket}/${e.key}`);
    if (e.type === 'notification' && e.remote) toast('Event notification delivered', `${e.event.eventName} → ${e.target}`);
    if (['object', 'bucket', 'lifecycle', 'clock'].includes(e.type) || (e.type === 'request' && current.name === 'activity')) refresh();
  });
}).catch(e => {
  view.replaceChildren(h('div', { class: 'view-inner' }, h('div', { class: 'panel' }, h('div', { class: 'empty' },
    h('h3', {}, 'Browser storage is unavailable'),
    h('p', {}, 'AeroTwin keeps the simulated S3 account in IndexedDB. Open the site in a normal (non-private) window, or allow site data for this page.'),
    h('p', { class: 'hint' }, String(e))))));
});
