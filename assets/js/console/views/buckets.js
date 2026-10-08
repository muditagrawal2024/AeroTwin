import { s3, REGIONS, DEFAULT_REGION, validateBucketName } from '../../core/s3.js';
import { h, fmtBytes, fmtDate } from '../../core/util.js';
import { modal, toast, toastError, confirmDialog, icon } from '../../core/ui.js';
import { accessBadge, versioningBadge } from '../components.js';

export async function render(root) {
  let filter = '';
  const draw = async () => {
    const buckets = await s3.listBuckets();
    const stats = Object.fromEntries(await Promise.all(buckets.map(async b => [b.name, await s3.bucketStats(b.name)])));
    const search = h('input', { type: 'search', placeholder: 'Find buckets by name', value: filter, 'aria-label': 'Find buckets by name', oninput: e => { filter = e.target.value; paint(); } });
    const tbody = h('tbody');
    const paint = () => {
      const list = buckets.filter(b => b.name.includes(filter.trim().toLowerCase()));
      tbody.replaceChildren(...(list.length ? list.map(b => h('tr', {},
        h('td', {}, h('a', { class: 'obj', href: `#/s3/${encodeURIComponent(b.name)}` }, icon('bucket'), b.name)),
        h('td', { class: 'muted' }, `${REGIONS[b.region] || b.region} ${b.region}`),
        h('td', {}, accessBadge(b)),
        h('td', {}, versioningBadge(b.versioning)),
        h('td', { class: 'num' }, stats[b.name].objects),
        h('td', { class: 'num' }, fmtBytes(stats[b.name].bytes)),
        h('td', { class: 'muted' }, fmtDate(b.createdAt)),
        h('td', {}, h('button', { class: 'btn small danger', type: 'button', onclick: () => removeBucket(b, stats[b.name]) }, 'Delete'))
      )) : [h('tr', {}, h('td', { colspan: 8 }, h('div', { class: 'empty' }, h('h3', {}, 'No buckets match'), h('p', {}, 'Create a bucket to start storing objects.'))))]));
    };
    paint();
    root.replaceChildren(
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'AeroTwin'), h('span', { class: 'sep' }, '/'), h('span', {}, 'S3')),
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' }, h('h1', {}, 'Buckets'),
          h('p', {}, 'Buckets are containers for objects. Each bucket lives in one region, and its settings (versioning, encryption, access and lifecycle) apply to everything inside it.')),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: createBucket }, 'Create bucket'))),
      h('section', { class: 'panel' },
        h('header', {}, h('h3', {}, `General purpose buckets (${buckets.length})`), search),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Region'), h('th', {}, 'Access'), h('th', {}, 'Versioning'), h('th', { class: 'num' }, 'Objects'), h('th', { class: 'num' }, 'Size'), h('th', {}, 'Created'), h('th', {}))),
          tbody)))
    );
  };

  async function createBucket() {
    const name = h('input', { type: 'text', placeholder: 'my-drone-data-2026', autocomplete: 'off', spellcheck: 'false' });
    const defaultHint = 'Between 3 and 63 characters: lowercase letters, numbers, dots and hyphens.';
    const problems = h('div', { class: 'hint' }, defaultHint);
    name.addEventListener('input', () => {
      const p = validateBucketName(name.value);
      problems.textContent = name.value && p.length ? p[0] : defaultHint;
      problems.style.color = name.value && p.length ? 'var(--red)' : '';
    });
    const region = h('select', {}, Object.entries(REGIONS).map(([k, v]) => h('option', { value: k, selected: k === DEFAULT_REGION }, `${v} ${k}`)));
    const versioning = h('input', { type: 'checkbox' });
    const block = h('input', { type: 'checkbox', checked: true });
    const enc = h('select', {}, h('option', { value: 'AES256' }, 'Server-side encryption with S3 managed keys (SSE-S3)'), h('option', { value: 'none' }, 'No encryption (not possible on real S3 since 2023)'));
    modal({
      title: 'Create bucket',
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', {}, 'Bucket name'), name, problems),
        h('label', { class: 'field' }, h('span', {}, 'AWS Region'), region),
        h('label', { class: 'switch' }, versioning, 'Enable bucket versioning'),
        h('label', { class: 'switch' }, block, 'Block all public access'),
        h('label', { class: 'field' }, h('span', {}, 'Default encryption'), enc),
        h('p', { class: 'hint' }, 'Real bucket names are unique across every AWS account in a partition. In AeroTwin they only need to be unique in this simulated account.')),
      actions: [{ label: 'Cancel' }, {
        label: 'Create bucket', kind: 'primary', onClick: async () => {
          await s3.createBucket(name.value.trim(), { region: region.value, versioning: versioning.checked ? 'Enabled' : 'Unversioned', blockPublicAccess: block.checked, encryption: enc.value });
          toast('Bucket created', name.value.trim());
          location.hash = `#/s3/${encodeURIComponent(name.value.trim())}`;
        }
      }]
    });
  }

  async function removeBucket(b, st) {
    const nonEmpty = st.versions + st.deleteMarkers > 0;
    const ok = await confirmDialog({
      title: `Delete ${b.name}`,
      message: nonEmpty
        ? `This bucket holds ${st.versions} object version(s) and ${st.deleteMarkers} delete marker(s). S3 refuses to delete a bucket that is not empty, so AeroTwin will empty it first, permanently removing every version.`
        : 'The bucket is empty and will be deleted.',
      confirmLabel: nonEmpty ? 'Empty and delete' : 'Delete bucket', danger: true, typeToConfirm: b.name
    });
    if (!ok) return;
    try { await s3.deleteBucket(b.name, { force: nonEmpty }); toast('Bucket deleted', b.name); draw(); }
    catch (e) { toastError(e); }
  }

  await draw();
  return { refresh: draw };
}
