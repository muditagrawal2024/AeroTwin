import { s3 } from '../../core/s3.js';
import { h, fmtDate, fmtBytes } from '../../core/util.js';

let filterSource = '';
let filterApi = '';

export async function render(root) {
  const draw = async () => {
    const all = await s3.listRequests(1500);
    const sources = [...new Set(all.map(r => r.source))].sort();
    const apis = [...new Set(all.map(r => r.api))].sort();
    const rows = all.filter(r => (!filterSource || r.source === filterSource) && (!filterApi || r.api === filterApi)).slice(0, 400);
    const srcSel = h('select', { 'aria-label': 'Filter by caller', onchange: e => { filterSource = e.target.value; draw(); } }, h('option', { value: '' }, 'All callers'), sources.map(s => h('option', { value: s, selected: s === filterSource }, s)));
    const apiSel = h('select', { 'aria-label': 'Filter by API', onchange: e => { filterApi = e.target.value; draw(); } }, h('option', { value: '' }, 'All API calls'), apis.map(s => h('option', { value: s, selected: s === filterApi }, s)));
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' }, h('h1', {}, 'Activity log'),
          h('p', {}, 'Every API call against the simulated account, in the style of CloudTrail: who made it (console, CLI, drone simulator, lifecycle, a notification function or an anonymous public request), what it touched and how S3 answered.')),
        h('div', { class: 'actions' }, srcSel, apiSel)),
      h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Event time (simulated)'), h('th', {}, 'API'), h('th', {}, 'Caller'), h('th', {}, 'Resource'), h('th', { class: 'num' }, 'Bytes'), h('th', {}, 'Result'))),
        h('tbody', {}, rows.length ? rows.map(r => h('tr', {},
          h('td', { class: 'muted', style: 'white-space:nowrap' }, fmtDate(r.time)),
          h('td', {}, h('code', {}, r.api)),
          h('td', {}, h('span', { class: `badge ${r.source === 'drone-sim' ? 'hot' : r.source === 'public' || r.source === 'presigned' ? 'warn' : ''}` }, r.source)),
          h('td', { style: 'word-break:break-all' }, r.bucket ? `${r.bucket}${r.key ? '/' + r.key : ''}` : '—', r.note ? h('div', { class: 'hint' }, r.note) : null),
          h('td', { class: 'num' }, r.bytes ? fmtBytes(r.bytes) : '—'),
          h('td', {}, h('span', { class: `badge ${r.status < 300 ? 'ok' : 'bad'}` }, r.status < 300 ? `${r.status} OK` : `${r.status} ${r.error || ''}`))
        )) : h('tr', {}, h('td', { colspan: 6 }, h('div', { class: 'empty' }, h('p', {}, 'No calls match these filters.')))))))));
  };
  await draw();
  return { refresh: draw };
}
