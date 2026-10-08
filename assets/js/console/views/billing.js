import { s3 } from '../../core/s3.js';
import { h, fmtUSD } from '../../core/util.js';
import { toast } from '../../core/ui.js';
import { STORAGE_CLASSES, FREE_TIER, GB } from '../../core/pricing.js';

let inr = false;
let selectedMonth = null;

export async function render(root) {
  const draw = async () => {
    const bill = await s3.billing(selectedMonth || undefined);
    const settings = bill.settings;
    const money = (v, d) => inr ? `₹${(v * bill.prices.usdToInr).toFixed(d ?? (v * bill.prices.usdToInr < 1 ? 4 : 2))}` : fmtUSD(v, d);
    const budget = settings.monthlyBudget || 1;
    const pct = Math.min(100, bill.forecast / budget * 100);
    const state = bill.total > budget ? 'bad' : bill.forecast > budget ? 'warn' : 'ok';

    // Storage run-rate per bucket (what each bucket costs per month right now).
    const buckets = await s3.listBuckets({ log: false });
    const runRate = [];
    for (const b of buckets) {
      const vs = await s3.listObjectVersions(b.name, { log: false });
      runRate.push([b.name, vs.reduce((s, v) => s + (v.isDeleteMarker ? 0 : v.size / GB * bill.prices.storage[v.storageClass]), 0)]);
    }
    const maxRate = Math.max(1e-12, ...runRate.map(r => r[1]));

    const groups = {};
    bill.lines.forEach(l => (groups[l.group] ||= []).push(l));

    const budgetInput = h('input', { type: 'number', min: 0.01, step: 0.01, value: budget, style: 'width:110px' });
    const freeTier = h('input', { type: 'checkbox', checked: settings.freeTier });
    const monthSel = h('select', { 'aria-label': 'Billing period', onchange: e => { selectedMonth = e.target.value; draw(); } },
      (bill.months.length ? bill.months : [bill.month]).map(m => h('option', { value: m, selected: m === bill.month }, new Date(m + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }))));

    root.replaceChildren(...[
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' }, h('h1', {}, 'Billing and cost'),
          h('p', {}, 'S3 charges for three things: how many GB you store per month in each storage class, how many requests you make, and data transferred out. AeroTwin meters all three as you use the console and fly the drone.')),
        h('div', { class: 'actions' }, monthSel,
          h('button', { class: 'btn small', type: 'button', onclick: () => { inr = !inr; draw(); } }, inr ? 'Show USD' : 'Show INR'))),
      state !== 'ok' ? h('div', { class: 'panel', style: `border-color:${state === 'bad' ? 'var(--red)' : 'var(--amber)'};margin-bottom:16px` }, h('div', { class: 'pad' },
        h('b', {}, state === 'bad' ? 'Budget exceeded. ' : 'Forecast is over budget. '),
        `Month-to-date charges are ${money(bill.total)} and the forecast for the month is ${money(bill.forecast)} against a budget of ${money(budget)}.`)) : null,
      h('div', { class: 'gauges' },
        g(money(bill.total, 6), 'Charges so far this month'),
        g(money(bill.forecast, 6), 'Forecast for the month', 'storage run-rate + request rate'),
        g(money(budget), 'Monthly budget', `${pct.toFixed(0)}% forecast use`),
        g(bill.requests.put.toLocaleString(), 'PUT-class requests', `${bill.requests.get.toLocaleString()} GET-class`)),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Bill details')),
          h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Line item'), h('th', { class: 'num' }, 'Usage'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'Cost'))),
            h('tbody', {}, Object.entries(groups).flatMap(([grp, lines]) => [
              h('tr', {}, h('td', { colspan: 4, style: 'color:var(--muted);font-weight:600;background:var(--ink-2)' }, grp)),
              ...lines.map(l => h('tr', {},
                h('td', {}, l.cls ? h('span', { class: 'cls', style: `--c:${STORAGE_CLASSES[l.cls].color}` }, l.item) : l.item),
                h('td', { class: 'num' }, l.unit === 'requests' ? l.quantity.toLocaleString() : `${fmtQty(l.quantity)} ${l.unit}`),
                h('td', { class: 'num' }, l.unit === 'requests' ? `${money(l.rate, 4)} / 1k` : `${money(l.rate, 5)} / ${l.unit}`),
                h('td', { class: 'num' }, money(l.cost, 6))))
            ]), h('tr', {}, h('td', { colspan: 3, style: 'font-weight:700' }, 'Total'), h('td', { class: 'num', style: 'font-weight:700' }, money(bill.total, 6))))))),
        h('div', {},
          h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Budget alert')),
            h('div', { class: 'pad stack' },
              h('div', { class: 'progress', style: 'height:10px' }, h('i', { style: `width:${pct}%;background:${state === 'ok' ? 'var(--teal)' : state === 'warn' ? 'var(--amber)' : 'var(--red)'}` })),
              h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Monthly budget (USD)'), budgetInput),
                h('label', { class: 'switch', style: 'align-self:flex-end;margin-bottom:6px' }, freeTier, 'Apply the S3 free tier')),
              h('p', { class: 'hint' }, `Free tier: ${FREE_TIER.standardGB} GB of Standard storage, ${FREE_TIER.getRequests.toLocaleString()} GET and ${FREE_TIER.putRequests.toLocaleString()} PUT requests, ${FREE_TIER.transferOutGB} GB transfer out each month.`),
              h('div', {}, h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
                await s3.setBillingSettings({ ...settings, monthlyBudget: Math.max(0.01, Number(budgetInput.value) || 1), freeTier: freeTier.checked });
                toast('Budget saved', fmtUSD(Number(budgetInput.value))); draw();
              } }, 'Save budget')))),
          h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Monthly storage run-rate by bucket')),
            h('div', { class: 'pad' }, runRate.map(([name, v]) => h('div', { class: 'hbar' }, h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, name), h('div', { class: 'track' }, h('i', { style: `width:${v / maxRate * 100}%;background:var(--orange)` })), h('span', { class: 'val' }, money(v, 8)))))))),
      whatIf(bill.prices, money),
      priceSettings(bill.prices, settings, draw)
    ].filter(Boolean));
  };
  await draw();
  return { refresh: draw };
}

function fmtQty(q) { return q === 0 ? '0' : q < 1e-9 ? '< 0.000000001' : q < 1 ? q.toFixed(9).replace(/0+$/, '') : q.toFixed(3); }
function g(v, l, s) { return h('div', { class: 'gauge' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l), s ? h('div', { class: 's' }, s) : null); }

// ----- what-if calculator: projected cost for a real drone fleet -----
function whatIf(prices, money) {
  const fields = {
    drones: ['Drones in the fleet', 25],
    flights: ['Flights per drone per day', 6],
    logMB: ['Flight log size (MB)', 2],
    photos: ['Photos per flight', 40],
    photoMB: ['Photo size (MB)', 6],
    videoMB: ['Video per flight (MB)', 300]
  };
  const inputs = {};
  const out = h('div', { class: 'stack' });
  const compute = () => {
    const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Math.max(0, Number(el.value) || 0)]));
    const flightsPerMonth = v.drones * v.flights * 30;
    const monthlyGB = flightsPerMonth * (v.logMB + v.photos * v.photoMB + v.videoMB) / 1024;
    const putsPerMonth = flightsPerMonth * (1 + v.photos + 1);
    const reqCost = putsPerMonth / 1000 * prices.putPer1k;
    const flat = [], tiered = [];
    for (let m = 1; m <= 12; m++) {
      flat.push(monthlyGB * m * prices.storage.STANDARD + reqCost);
      const ia = monthlyGB * Math.min(2, m - 1);
      const gl = monthlyGB * Math.max(0, Math.min(9, m - 3));
      const transitions = (m > 1 ? putsPerMonth : 0) + (m > 3 ? putsPerMonth : 0);
      tiered.push(monthlyGB * prices.storage.STANDARD + ia * prices.storage.STANDARD_IA + gl * prices.storage.GLACIER + reqCost + transitions / 1000 * 0.01);
    }
    const sumFlat = flat.reduce((a, b) => a + b, 0), sumTier = tiered.reduce((a, b) => a + b, 0);
    out.replaceChildren(
      h('div', { class: 'gauges', style: 'margin:0' },
        g(`${monthlyGB.toFixed(0)} GB`, 'New data per month', `${flightsPerMonth.toLocaleString()} flights`),
        g(money(sumFlat, 0), 'First year, everything in Standard'),
        g(money(sumTier, 0), 'First year with the lifecycle rule'),
        g(`${sumFlat ? ((1 - sumTier / sumFlat) * 100).toFixed(0) : 0}%`, 'Saved by tiering')),
      lineChart([{ name: 'All in S3 Standard', color: '#6aa7ff', values: flat }, { name: 'Lifecycle: IA at 30 d, Glacier at 90 d', color: '#3fc6b4', values: tiered }], money),
      h('p', { class: 'hint' }, 'The lifecycle projection keeps the newest month in Standard, the next two months in Standard-IA and older data in Glacier Flexible Retrieval, and includes lifecycle transition requests at $0.01 per 1,000. Minimum storage durations and per-object overheads are left out to keep the model readable.'));
  };
  const grid = h('div', { class: 'grid-3' }, Object.entries(fields).map(([k, [label, def]]) =>
    h('label', { class: 'field' }, h('span', {}, label), inputs[k] = h('input', { type: 'number', min: 0, value: def, oninput: compute }))));
  compute();
  return h('section', { class: 'panel', style: 'margin-top:16px' },
    h('header', {}, h('h3', {}, 'What would a real drone fleet cost?')),
    h('div', { class: 'pad stack' }, h('p', { class: 'hint' }, 'Scale the simulator up to a fleet and compare keeping every byte in S3 Standard against the tier-flight-logs lifecycle rule used by the aerotwin-flight-logs bucket.'), grid, out));
}

function lineChart(series, money) {
  const W = 720, H = 220, P = { l: 64, r: 16, t: 14, b: 28 };
  const max = Math.max(...series.flatMap(s => s.values)) * 1.08 || 1;
  const x = i => P.l + i * (W - P.l - P.r) / 11;
  const y = v => H - P.b - v / max * (H - P.t - P.b);
  const ticks = [0, .25, .5, .75, 1].map(f => f * max);
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly storage cost projection">
    ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#223b54"/><text x="${P.l - 8}" y="${y(t) + 4}" text-anchor="end">${money(t, 0)}</text>`).join('')}
    ${Array.from({ length: 12 }, (_, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">M${i + 1}</text>`).join('')}
    ${series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
      ${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${s.name}, month ${i + 1}: ${money(v, 2)}</title></circle>`).join('')}
      <text x="${x(11) - 4}" y="${y(s.values[11]) - 8}" text-anchor="end" style="fill:${s.color}">${s.name}</text>`).join('')}
  </svg>`;
  return h('div', { html: svg });
}

function priceSettings(prices, settings, redraw) {
  const fields = {};
  const row = (label, path, val) => h('label', { class: 'field' }, h('span', {}, label), fields[path] = h('input', { type: 'number', step: 'any', min: 0, value: val }));
  return h('section', { class: 'panel', style: 'margin-top:16px' },
    h('header', {}, h('h3', {}, 'Price list')),
    h('div', { class: 'pad stack' },
      h('p', { class: 'hint' }, 'Defaults are the published list prices for US East (N. Virginia). Edit them to match another region, for example S3 Standard in Asia Pacific (Mumbai), before a demo.'),
      h('div', { class: 'grid-3' },
        ...Object.entries(STORAGE_CLASSES).map(([k, v]) => row(`${v.short} per GB-month`, 'storage.' + k, prices.storage[k])),
        row('PUT/COPY/POST/LIST per 1,000', 'putPer1k', prices.putPer1k),
        row('GET and others per 1,000', 'getPer1k', prices.getPer1k),
        row('Transfer out per GB', 'transferOutPerGB', prices.transferOutPerGB),
        row('INR per USD', 'usdToInr', prices.usdToInr)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
          const p = { storage: {} };
          for (const [path, el] of Object.entries(fields)) {
            const v = Number(el.value);
            if (path.startsWith('storage.')) p.storage[path.slice(8)] = v; else p[path] = v;
          }
          await s3.setBillingSettings({ ...settings, prices: p }); toast('Prices saved', 'Bills are recalculated with the new rates'); redraw();
        } }, 'Save prices'),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { await s3.setBillingSettings({ ...settings, prices: null }); toast('Prices reset', 'Using list prices again'); redraw(); } }, 'Reset to defaults'))));
}
