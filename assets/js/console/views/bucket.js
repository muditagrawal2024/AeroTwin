import { s3, REGIONS } from '../../core/s3.js';
import { h, fmtBytes, fmtDate, download } from '../../core/util.js';
import { modal, toast, toastError, confirmDialog, icon, openClock } from '../../core/ui.js';
import { STORAGE_CLASSES } from '../../core/pricing.js';
import { publicReadPolicy, evaluatePolicy, validatePolicy } from '../../core/policy.js';
import { clsTag, accessBadge, versioningBadge, copyable, classBar } from '../components.js';

const TABS = [['objects', 'Objects'], ['properties', 'Properties'], ['permissions', 'Permissions'], ['management', 'Management'], ['metrics', 'Metrics']];

export async function render(root, { bucket }, query) {
  const b = await s3.getBucket(bucket);
  const tab = query.get('tab') || 'objects';
  const prefix = query.get('prefix') || '';
  const body = h('div');
  const href = (t, p = prefix) => `#/s3/${encodeURIComponent(bucket)}?tab=${t}${p ? '&prefix=' + encodeURIComponent(p) : ''}`;

  root.replaceChildren(
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'AeroTwin'), h('span', { class: 'sep' }, '/'), h('a', { href: '#/s3' }, 'S3'), h('span', { class: 'sep' }, '/'), h('span', {}, bucket)),
    h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', {}, bucket),
        h('p', {}, h('span', { class: 'row', style: 'gap:8px' }, accessBadge(b), versioningBadge(b.versioning), h('span', { class: 'badge' }, b.encryption === 'AES256' ? 'SSE-S3' : 'Unencrypted'), h('span', { class: 'badge' }, b.region))))),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', class: id === tab ? 'on' : '', 'aria-selected': id === tab ? 'true' : 'false',
      onclick: () => { location.hash = href(id, id === 'objects' ? prefix : ''); }
    }, label))),
    body
  );

  const views = { objects: objectsTab, properties: propertiesTab, permissions: permissionsTab, management: managementTab, metrics: metricsTab };
  const draw = async () => {
    const fresh = await s3.getBucket(bucket);
    await views[tab](body, fresh, prefix, href);
  };
  await draw();
  return { refresh: tab === 'objects' || tab === 'metrics' ? draw : null };
}

// ============================ Objects ============================
let showVersions = false;
async function objectsTab(root, b, prefix, href) {
  const bucket = b.name;
  const selected = new Set();
  const list = await s3.listObjectsV2(bucket, { prefix, delimiter: '/' });
  const versions = showVersions ? await s3.listObjectVersions(bucket, { prefix, log: false }) : [];

  const parts = prefix.split('/').filter(Boolean);
  const pathCrumbs = h('div', { class: 'crumbs', style: 'margin:0' },
    h('a', { href: href('objects', '') }, bucket),
    ...parts.flatMap((p, i) => [h('span', { class: 'sep' }, '/'), h('a', { href: href('objects', parts.slice(0, i + 1).join('/') + '/') }, p)]));

  const delBtn = h('button', { class: 'btn danger small', type: 'button', disabled: true, onclick: () => deleteSelected() }, 'Delete');
  const dlBtn = h('button', { class: 'btn small', type: 'button', disabled: true, onclick: () => downloadSelected() }, 'Download');
  const syncButtons = () => { delBtn.disabled = dlBtn.disabled = selected.size === 0; };
  const verSwitch = h('input', { type: 'checkbox', checked: showVersions, onchange: e => { showVersions = e.target.checked; objectsTab(root, b, prefix, href); } });

  const rowFor = o => {
    const name = o.key.slice(prefix.length);
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${name}`, onchange: e => { e.target.checked ? selected.add(o) : selected.delete(o); syncButtons(); } });
    const objHref = `#/s3/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(o.key)}${showVersions ? '&versionId=' + encodeURIComponent(o.versionId) : ''}`;
    return h('tr', {},
      h('td', {}, cb),
      h('td', {}, o.isDeleteMarker
        ? h('span', { class: 'obj muted' }, icon('file'), name)
        : h('a', { class: 'obj', href: objHref }, icon('file'), name)),
      showVersions ? h('td', { class: 'mono muted', style: 'font-size:12px' }, o.versionId === 'null' ? 'null' : o.versionId.slice(0, 12) + '…', o.isLatest ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, 'Latest') : null) : null,
      h('td', { class: 'muted' }, o.isDeleteMarker ? 'Delete marker' : (o.contentType || '').split('/').pop()),
      h('td', { class: 'muted' }, fmtDate(o.lastModified)),
      h('td', { class: 'num' }, o.isDeleteMarker ? '—' : fmtBytes(o.size)),
      h('td', {}, o.isDeleteMarker ? '—' : clsTag(o.storageClass), o.restoreStatus === 'restored' ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, 'Restored') : o.restoreStatus === 'in-progress' ? h('span', { class: 'badge warn', style: 'margin-left:6px' }, 'Restoring') : null)
    );
  };

  const rows = [];
  for (const p of list.commonPrefixes) {
    rows.push(h('tr', {},
      h('td', {}),
      h('td', {}, h('a', { class: 'obj', href: href('objects', p) }, icon('folder'), p.slice(prefix.length))),
      showVersions ? h('td', {}) : null,
      h('td', { class: 'muted' }, 'Folder'), h('td', {}), h('td', {}), h('td', {})));
  }
  const items = showVersions ? versions.filter(v => !v.key.slice(prefix.length).includes('/') && v.key !== prefix) : list.contents.filter(o => o.key !== prefix);
  items.forEach(o => rows.push(rowFor(o)));

  root.replaceChildren(h('section', { class: 'panel' },
    h('header', {},
      h('div', { style: 'flex:1;min-width:200px' }, h('h3', {}, `Objects (${items.length + list.commonPrefixes.length})`), pathCrumbs),
      h('div', { class: 'actions' },
        h('label', { class: 'switch', style: 'font-size:13px' }, verSwitch, 'Show versions'),
        dlBtn, delBtn,
        h('button', { class: 'btn small', type: 'button', onclick: () => createFolder() }, 'Create folder'),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => uploadDialog(bucket, prefix, () => objectsTab(root, b, prefix, href)) }, icon('upload'), 'Upload'))),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', { style: 'width:32px' }), h('th', {}, 'Name'), showVersions ? h('th', {}, 'Version ID') : null, h('th', {}, 'Type'), h('th', {}, 'Last modified'), h('th', { class: 'num' }, 'Size'), h('th', {}, 'Storage class'))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 7 }, h('div', { class: 'empty' },
        h('h3', {}, prefix ? 'This folder is empty' : 'This bucket is empty'),
        h('p', {}, 'Upload files, or fly the drone: flight logs, photos and missions land in the AeroTwin buckets automatically.')))))))
  ));
  setupDrop(root, bucket, prefix, () => objectsTab(root, b, prefix, href));

  async function createFolder() {
    const name = h('input', { type: 'text', placeholder: 'survey-2026' });
    modal({
      title: 'Create folder',
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', {}, 'Folder name'), name),
        h('p', { class: 'hint' }, 'S3 has a flat key space. The console shows folders by grouping keys on the "/" delimiter; creating a folder writes an empty object whose key ends in "/".')),
      actions: [{ label: 'Cancel' }, { label: 'Create folder', kind: 'primary', onClick: async () => {
        const n = name.value.trim().replace(/\/+$/, '');
        if (!n || n.includes('/')) { toast('Folder names cannot be empty or contain "/"', '', 'warn'); return false; }
        await s3.putObject(bucket, `${prefix}${n}/`, '', { contentType: 'application/x-directory' });
        objectsTab(root, b, prefix, href);
      } }]
    });
  }

  async function deleteSelected() {
    const objs = [...selected];
    const permanent = showVersions || b.versioning === 'Unversioned';
    const ok = await confirmDialog({
      title: `Delete ${objs.length} object${objs.length > 1 ? 's' : ''}`,
      message: permanent
        ? (showVersions ? 'The selected versions will be deleted permanently. This cannot be undone.' : 'Versioning is off for this bucket, so the objects will be deleted permanently.')
        : 'Versioning is on, so S3 adds a delete marker and keeps every previous version. Turn on "Show versions" to recover or permanently remove them.',
      confirmLabel: permanent ? 'Delete permanently' : 'Add delete markers', danger: true, typeToConfirm: permanent ? 'permanently delete' : undefined
    });
    if (!ok) return;
    const res = await s3.deleteObjects(bucket, objs.map(o => ({ key: o.key, versionId: showVersions ? o.versionId : undefined })));
    const failed = res.filter(r => r.error);
    toast(failed.length ? 'Some deletes failed' : 'Deleted', `${res.length - failed.length} succeeded, ${failed.length} failed`, failed.length ? 'warn' : 'ok');
    objectsTab(root, b, prefix, href);
  }

  async function downloadSelected() {
    for (const o of selected) {
      try { const r = await s3.getObject(bucket, o.key, { versionId: showVersions ? o.versionId : undefined }); download(r.body, o.key.split('/').pop() || 'object'); }
      catch (e) { toastError(e); }
    }
  }
}

function setupDrop(root, bucket, prefix, done) {
  const panel = root.querySelector('.panel');
  panel.addEventListener('dragover', e => { e.preventDefault(); panel.style.outline = '2px dashed var(--orange)'; });
  panel.addEventListener('dragleave', () => { panel.style.outline = ''; });
  panel.addEventListener('drop', e => {
    e.preventDefault(); panel.style.outline = '';
    if (e.dataTransfer.files.length) uploadDialog(bucket, prefix, done, [...e.dataTransfer.files]);
  });
}

export function uploadDialog(bucket, prefix, done, initial = []) {
  const files = [...initial];
  const list = h('div', { class: 'stack' });
  const picker = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: e => { files.push(...e.target.files); paint(); } });
  const zone = h('div', { class: 'drop' }, 'Drag files here, or ', h('button', { class: 'btn small', type: 'button', onclick: () => picker.click() }, 'Choose files'), picker);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); files.push(...e.dataTransfer.files); paint(); });
  const cls = h('select', {}, Object.entries(STORAGE_CLASSES).map(([k, v]) => h('option', { value: k }, v.label)));
  const bars = new Map();
  const paint = () => list.replaceChildren(...files.map(f => {
    const bar = h('i'); bars.set(f, bar);
    return h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', {}, f.name), h('span', { class: 'hint mono' }, fmtBytes(f.size), f.size > 5 * 1024 * 1024 ? ' · multipart' : '')), h('div', { class: 'progress' }, bar));
  }));
  paint();
  modal({
    title: `Upload to ${bucket}/${prefix}`,
    body: h('div', { class: 'stack' }, zone, list,
      h('label', { class: 'field' }, h('span', {}, 'Storage class'), cls),
      h('p', { class: 'hint' }, 'Files over 5 MB are sent as a multipart upload (CreateMultipartUpload, one UploadPart per 5 MB, CompleteMultipartUpload) and get a multipart ETag ending in "-N".')),
    actions: [{ label: 'Cancel' }, { label: 'Upload', kind: 'primary', onClick: async () => {
      if (!files.length) { toast('Choose at least one file', '', 'warn'); return false; }
      for (const f of files) {
        await s3.uploadMultipart(bucket, prefix + f.name, f, { contentType: f.type || undefined, storageClass: cls.value }, p => { bars.get(f).style.width = `${p * 100}%`; });
      }
      toast('Upload succeeded', `${files.length} file${files.length > 1 ? 's' : ''} to s3://${bucket}/${prefix}`);
      done?.();
    } }]
  });
}

// ============================ Properties ============================
async function propertiesTab(root, b) {
  const a = s3.account();
  const tagText = h('textarea', { rows: 4 }, Object.entries(b.tags || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  const enc = h('select', {}, h('option', { value: 'AES256', selected: b.encryption === 'AES256' }, 'SSE-S3 (AES-256, S3 managed keys)'), h('option', { value: 'none', selected: b.encryption !== 'AES256' }, 'None'));

  const notifRows = (b.notifications || []).map((n, i) => h('tr', {},
    h('td', {}, n.id), h('td', {}, h('code', {}, (n.events || []).join(', '))), h('td', { class: 'muted' }, `${n.prefix || '*'} … ${n.suffix || '*'}`),
    h('td', {}, h('code', {}, n.target)),
    h('td', {}, h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
      const next = b.notifications.filter((_, j) => j !== i);
      await s3.putBucketNotification(b.name, next); toast('Notification removed', n.id); propertiesTab(root, await s3.getBucket(b.name));
    } }, 'Remove'))));

  root.replaceChildren(
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Bucket overview')), h('div', { class: 'pad' }, h('dl', { class: 'kv' },
      h('dt', {}, 'AWS Region'), h('dd', {}, `${REGIONS[b.region] || ''} ${b.region}`),
      h('dt', {}, 'Amazon Resource Name'), h('dd', {}, copyable(`arn:aws:s3:::${b.name}`)),
      h('dt', {}, 'Owner account'), h('dd', {}, a.accountId),
      h('dt', {}, 'Created'), h('dd', {}, fmtDate(b.createdAt)),
      h('dt', {}, 'Object ownership'), h('dd', {}, 'Bucket owner enforced (ACLs disabled)')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Bucket versioning'), versioningBadge(b.versioning)),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'With versioning, every overwrite keeps the previous version and a delete only adds a delete marker, so you can recover from mistakes. Once enabled, versioning can be suspended but never turned off again.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', disabled: b.versioning === 'Enabled', onclick: async () => { await s3.putBucketVersioning(b.name, 'Enabled'); toast('Versioning enabled', b.name); propertiesTab(root, await s3.getBucket(b.name)); } }, 'Enable'),
          h('button', { class: 'btn small', type: 'button', disabled: b.versioning !== 'Enabled', onclick: async () => { await s3.putBucketVersioning(b.name, 'Suspended'); toast('Versioning suspended', b.name); propertiesTab(root, await s3.getBucket(b.name)); } }, 'Suspend')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Default encryption')),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'AeroTwin really encrypts each object body with AES-256-GCM before writing it to browser storage, using a key that never leaves the simulated account. Reads decrypt it transparently, just like SSE-S3.'),
        h('div', { class: 'row' }, enc, h('button', { class: 'btn small', type: 'button', onclick: async () => { await s3.putBucketEncryption(b.name, enc.value); toast('Default encryption saved', 'Applies to new objects only'); } }, 'Save')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Tags')),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'One key=value pair per line. Cost allocation tags group charges in a bill.'),
        tagText,
        h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const tags = Object.fromEntries(tagText.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
          await s3.putBucketTagging(b.name, tags); toast('Tags saved', `${Object.keys(tags).length} tag(s)`);
        } }, 'Save tags')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Event notifications'), h('button', { class: 'btn small', type: 'button', onclick: () => addNotification(root, b) }, 'Create event notification')),
      notifRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Events'), h('th', {}, 'Filter'), h('th', {}, 'Destination'), h('th', {}))),
        h('tbody', {}, notifRows))) : h('div', { class: 'empty' }, h('p', {}, 'No event notifications. S3 can call a function or send a message whenever objects are created or removed.')))
  );
}

function addNotification(root, b) {
  const id = h('input', { type: 'text', value: 'notify-' + Math.random().toString(36).slice(2, 6) });
  const ev = h('select', {}, ['s3:ObjectCreated:*', 's3:ObjectCreated:Put', 's3:ObjectRemoved:*', 's3:ObjectRemoved:DeleteMarkerCreated'].map(e => h('option', { value: e }, e)));
  const prefix = h('input', { type: 'text', placeholder: 'logs/' });
  const suffix = h('input', { type: 'text', placeholder: '.json' });
  const target = h('select', {}, h('option', { value: 'flight-indexer' }, 'Function: flight-indexer (summarises flight logs)'), h('option', { value: 'console-toast' }, 'Topic: console-toast (shows a toast in every open tab)'));
  modal({
    title: 'Create event notification',
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), id),
      h('label', { class: 'field' }, h('span', {}, 'Event types'), ev),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Prefix'), prefix), h('label', { class: 'field' }, h('span', {}, 'Suffix'), suffix)),
      h('label', { class: 'field' }, h('span', {}, 'Destination'), target)),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
      const next = [...(b.notifications || []), { id: id.value.trim(), events: [ev.value], prefix: prefix.value.trim(), suffix: suffix.value.trim(), target: target.value }];
      await s3.putBucketNotification(b.name, next);
      toast('Event notification saved', id.value);
      propertiesTab(root, await s3.getBucket(b.name));
    } }]
  });
}

// ============================ Permissions ============================
async function permissionsTab(root, b) {
  const block = h('input', { type: 'checkbox', checked: b.blockPublicAccess });
  const policy = h('textarea', { rows: 14, spellcheck: 'false', 'aria-label': 'Bucket policy JSON' }, b.policy || '');
  const errors = h('div', { class: 'hint' });
  const testKey = h('input', { type: 'text', placeholder: 'shared/aerotwin-drone.svg', style: 'flex:1' });
  const testOut = h('div', { class: 'hint' });

  const validate = () => {
    if (!policy.value.trim()) { errors.textContent = 'No policy. Only the bucket owner can access objects.'; errors.style.color = ''; return; }
    const v = validatePolicy(policy.value, b.name);
    errors.textContent = v.ok ? 'Policy is valid.' : v.errors.join(' ');
    errors.style.color = v.ok ? 'var(--teal)' : 'var(--red)';
  };
  policy.addEventListener('input', validate);
  validate();

  root.replaceChildren(
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Block public access'), b.blockPublicAccess ? h('span', { class: 'badge ok' }, 'On') : h('span', { class: 'badge warn' }, 'Off')),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'A safety switch that overrides any policy granting public access. While it is on, public object URLs always return AccessDenied and public policies cannot be saved.'),
        h('div', { class: 'row' }, h('label', { class: 'switch' }, block, 'Block all public access'),
          h('button', { class: 'btn small', type: 'button', onclick: async () => {
            if (!block.checked) {
              const ok = await confirmDialog({ title: 'Turn off Block Public Access?', message: 'Objects in this bucket can become public through the bucket policy. Only do this for content you intend to share with everyone.', confirmLabel: 'Turn off', danger: true, typeToConfirm: 'confirm' });
              if (!ok) { block.checked = true; return; }
            }
            await s3.putPublicAccessBlock(b.name, block.checked); toast('Block Public Access saved', block.checked ? 'On' : 'Off'); permissionsTab(root, await s3.getBucket(b.name));
          } }, 'Save')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Bucket policy'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { policy.value = publicReadPolicy(b.name, 'shared/'); validate(); } }, 'Template: public read for shared/'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { policy.value = JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'DenyDeletes', Effect: 'Deny', Principal: '*', Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'], Resource: `arn:aws:s3:::${b.name}/*` }] }, null, 2); validate(); } }, 'Template: deny deletes'))),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'A JSON resource policy attached to the bucket. Statements are evaluated together, and an explicit Deny always wins over an Allow.'),
        policy, errors,
        h('div', { class: 'actions' },
          h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
            try { await s3.putBucketPolicy(b.name, policy.value.trim() || null); toast('Bucket policy saved', b.name); permissionsTab(root, await s3.getBucket(b.name)); }
            catch (e) { toastError(e); }
          } }, 'Save policy'),
          h('button', { class: 'btn small danger', type: 'button', disabled: !b.policy, onclick: async () => { await s3.putBucketPolicy(b.name, null); toast('Bucket policy deleted', b.name); permissionsTab(root, await s3.getBucket(b.name)); } }, 'Delete policy')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Policy simulator')),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'Check what an anonymous visitor gets when they open the public URL of a key.'),
        h('div', { class: 'row' }, testKey, h('button', { class: 'btn small', type: 'button', onclick: () => {
          const key = testKey.value.trim() || 'shared/aerotwin-drone.svg';
          const doc = b.policy ? JSON.parse(b.policy) : null;
          const decision = evaluatePolicy(doc, { action: 's3:GetObject', resource: `arn:aws:s3:::${b.name}/${key}` });
          const final = b.blockPublicAccess ? 'AccessDenied: Block Public Access is on' : decision === 'Allow' ? 'Allowed: a policy statement grants s3:GetObject to everyone' : decision === 'Deny' ? 'AccessDenied: an explicit Deny matched' : 'AccessDenied: no statement allows it (implicit deny)';
          testOut.textContent = `GET arn:aws:s3:::${b.name}/${key} → ${final}`;
          testOut.style.color = final.startsWith('Allowed') ? 'var(--teal)' : 'var(--red)';
        } }, 'Evaluate')),
        testOut))
  );
}

// ============================ Management ============================
async function managementTab(root, b) {
  const rules = b.lifecycle || [];
  const rulesEl = rules.length ? rules.map((r, i) => h('div', { class: 'rule' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('b', {}, r.id), ' ', h('span', { class: `badge ${r.status === 'Disabled' ? '' : 'ok'}` }, r.status || 'Enabled'), ' ', h('span', { class: 'hint' }, `applies to ${r.prefix ? `keys starting with "${r.prefix}"` : 'every object'}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => ruleDialog(root, b, r, i) }, 'Edit'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await s3.putBucketLifecycle(b.name, rules.filter((_, j) => j !== i)); toast('Lifecycle rule deleted', r.id); managementTab(root, await s3.getBucket(b.name)); } }, 'Delete'))),
    h('div', { class: 'flow' },
      h('span', { class: 'step' }, 'Upload → Standard'),
      ...(r.transitions || []).slice().sort((x, y) => x.days - y.days).flatMap(t => [h('span', { class: 'arrow' }, `${t.days} d`), h('span', { class: 'step' }, STORAGE_CLASSES[t.storageClass].short)]),
      ...(r.expirationDays ? [h('span', { class: 'arrow' }, `${r.expirationDays} d`), h('span', { class: 'step', style: 'border-color:rgba(255,100,97,.5)' }, 'Expire')] : [])),
    r.noncurrentExpirationDays ? h('div', { class: 'hint' }, `Noncurrent versions are deleted ${r.noncurrentExpirationDays} days after they stop being current.`) : null
  )) : [h('div', { class: 'empty' }, h('p', {}, 'No lifecycle rules. Add one to move ageing data to cheaper storage or delete it automatically.'))];

  root.replaceChildren(
    h('section', { class: 'panel' },
      h('header', {}, h('h3', {}, 'Lifecycle rules'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => openClock() }, 'Time-travel the clock'),
          h('button', { class: 'btn small', type: 'button', onclick: async () => { const c = await s3.runLifecycle(); toast('Lifecycle evaluated', `${c.length} change(s)`); } }, 'Run now'),
          h('button', { class: 'btn small primary', type: 'button', onclick: () => ruleDialog(root, b) }, 'Create rule'))),
      h('div', { class: 'pad stack' },
        h('p', { class: 'hint' }, 'S3 evaluates lifecycle rules once a day. AeroTwin evaluates them every time the simulated clock moves, so a 90-day policy can be demonstrated in a second.'),
        ...rulesEl))
  );
}

function ruleDialog(root, b, rule = {}, index = -1) {
  const t = Object.fromEntries((rule.transitions || []).map(x => [x.storageClass, x.days]));
  const id = h('input', { type: 'text', value: rule.id || 'rule-' + Math.random().toString(36).slice(2, 6) });
  const prefix = h('input', { type: 'text', value: rule.prefix || '', placeholder: 'logs/ (leave empty for the whole bucket)' });
  const status = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: rule.status !== 'Disabled' }), 'Enabled');
  const days = {};
  const dayField = (cls, label) => h('label', { class: 'field' }, h('span', {}, label), days[cls] = h('input', { type: 'number', min: 0, value: t[cls] ?? '', placeholder: 'days' }));
  const exp = h('input', { type: 'number', min: 1, value: rule.expirationDays ?? '', placeholder: 'days' });
  const nexp = h('input', { type: 'number', min: 1, value: rule.noncurrentExpirationDays ?? '', placeholder: 'days' });
  modal({
    title: index >= 0 ? `Edit ${rule.id}` : 'Create lifecycle rule',
    body: h('div', { class: 'stack' },
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Rule name'), id), h('label', { class: 'field' }, h('span', {}, 'Prefix filter'), prefix)),
      status,
      h('h3', {}, 'Transition current versions after'),
      h('div', { class: 'grid-2' },
        dayField('STANDARD_IA', 'Standard-IA (min 30)'), dayField('GLACIER_IR', 'Glacier Instant Retrieval'),
        dayField('GLACIER', 'Glacier Flexible Retrieval'), dayField('DEEP_ARCHIVE', 'Glacier Deep Archive')),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Expire current versions after'), exp),
        h('label', { class: 'field' }, h('span', {}, 'Delete noncurrent versions after'), nexp))),
    actions: [{ label: 'Cancel' }, { label: 'Save rule', kind: 'primary', onClick: async () => {
      const transitions = Object.entries(days).filter(([, el]) => el.value !== '').map(([cls, el]) => ({ storageClass: cls, days: Number(el.value) }));
      const next = {
        id: id.value.trim() || 'rule', prefix: prefix.value.trim(), status: status.querySelector('input').checked ? 'Enabled' : 'Disabled', transitions,
        expirationDays: exp.value ? Number(exp.value) : undefined, noncurrentExpirationDays: nexp.value ? Number(nexp.value) : undefined
      };
      const rules = [...(b.lifecycle || [])];
      if (index >= 0) rules[index] = next; else rules.push(next);
      await s3.putBucketLifecycle(b.name, rules);
      toast('Lifecycle rule saved', next.id);
      managementTab(root, await s3.getBucket(b.name));
    } }]
  });
}

// ============================ Metrics ============================
async function metricsTab(root, b) {
  const st = await s3.bucketStats(b.name);
  const reqs = (await s3.listRequests(2000)).filter(r => r.bucket === b.name);
  const byApi = {};
  reqs.forEach(r => { byApi[r.api] = (byApi[r.api] || 0) + 1; });
  const max = Math.max(1, ...Object.values(byApi));
  root.replaceChildren(
    h('div', { class: 'gauges' },
      h('div', { class: 'gauge' }, h('div', { class: 'v' }, st.objects), h('div', { class: 'l' }, 'Current objects')),
      h('div', { class: 'gauge' }, h('div', { class: 'v' }, st.versions), h('div', { class: 'l' }, 'Stored versions')),
      h('div', { class: 'gauge' }, h('div', { class: 'v' }, st.deleteMarkers), h('div', { class: 'l' }, 'Delete markers')),
      h('div', { class: 'gauge' }, h('div', { class: 'v' }, fmtBytes(st.bytes)), h('div', { class: 'l' }, 'Total bucket size'))),
    h('div', { class: 'grid-2' },
      h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Storage by class')), h('div', { class: 'pad' }, classBar(st.byClass))),
      h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Requests by API')),
        h('div', { class: 'pad' }, Object.keys(byApi).length ? Object.entries(byApi).sort((x, y) => y[1] - x[1]).map(([api, n]) =>
          h('div', { class: 'hbar' }, h('code', {}, api), h('div', { class: 'track' }, h('i', { style: `width:${n / max * 100}%;background:var(--blue)` })), h('span', { class: 'val' }, n))) : h('p', { class: 'hint' }, 'No requests recorded yet.'))))
  );
}
