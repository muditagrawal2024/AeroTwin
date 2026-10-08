import { s3 } from '../../core/s3.js';
import { h, fmtBytes, fmtDate, download, esc } from '../../core/util.js';
import { toast, toastError, confirmDialog, openClock } from '../../core/ui.js';
import { STORAGE_CLASSES } from '../../core/pricing.js';
import { clsTag, copyable, pathPlot } from '../components.js';

export async function render(root, { bucket }, query) {
  const key = query.get('key');
  const versionId = query.get('versionId') || undefined;

  const draw = async () => {
    const b = await s3.getBucket(bucket);
    const o = await s3.headObject(bucket, key, { versionId });
    const versions = (await s3.listObjectVersions(bucket, { prefix: key, log: false })).filter(v => v.key === key);
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/') + 1) : '';
    const archived = STORAGE_CLASSES[o.storageClass].archived;

    const preview = h('div', { class: 'preview' }, h('p', { class: 'hint' }, 'Loading preview…'));
    const presignOut = h('div', { class: 'stack' });
    const expires = h('select', {}, [[60, '1 minute'], [900, '15 minutes'], [3600, '1 hour'], [86400, '1 day'], [604800, '7 days (maximum)']].map(([v, l]) => h('option', { value: v, selected: v === 3600 }, l)));

    root.replaceChildren(...[
      h('div', { class: 'crumbs' }, h('a', { href: '#/s3' }, 'S3'), h('span', { class: 'sep' }, '/'), h('a', { href: `#/s3/${encodeURIComponent(bucket)}` }, bucket),
        ...parent.split('/').filter(Boolean).flatMap((p, i, arr) => [h('span', { class: 'sep' }, '/'), h('a', { href: `#/s3/${encodeURIComponent(bucket)}?prefix=${encodeURIComponent(arr.slice(0, i + 1).join('/') + '/')}` }, p)])),
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' }, h('h1', { style: 'word-break:break-all' }, key.slice(parent.length) || key),
          h('p', {}, versionId ? `Viewing version ${versionId}` : 'Latest version')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', disabled: archived && o.restoreStatus !== 'restored', onclick: async () => { try { const r = await s3.getObject(bucket, key, { versionId }); download(r.body, key.split('/').pop()); } catch (e) { toastError(e); } } }, 'Download'),
          h('a', { class: 'btn', href: s3.objectUrl(bucket, key), target: '_blank', rel: 'noopener' }, 'Open public URL'),
          key.endsWith('.json') && key.startsWith('logs/') ? h('a', { class: 'btn primary', href: `sim.html#replay=${encodeURIComponent(bucket + '/' + key)}` }, 'Replay flight') : null,
          key.endsWith('.xml') && bucket === 'aerotwin-missions' ? h('a', { class: 'btn primary', href: `sim.html#mission=${encodeURIComponent(key)}` }, 'Open in mission editor') : null,
          h('button', { class: 'btn danger', type: 'button', onclick: () => remove(b) }, versionId ? 'Delete version' : 'Delete'))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Object overview')), h('div', { class: 'pad' }, h('dl', { class: 'kv' },
          h('dt', {}, 'S3 URI'), h('dd', {}, copyable(`s3://${bucket}/${key}`)),
          h('dt', {}, 'ARN'), h('dd', {}, copyable(`arn:aws:s3:::${bucket}/${key}`)),
          h('dt', {}, 'Object URL'), h('dd', {}, copyable(s3.s3Url(bucket, key, b.region))),
          h('dt', {}, 'ETag'), h('dd', {}, copyable(o.etag, h('code', {}, o.etag))),
          h('dt', {}, 'Size'), h('dd', {}, `${fmtBytes(o.size)} (${o.size.toLocaleString()} bytes)`),
          h('dt', {}, 'Type'), h('dd', {}, o.contentType),
          h('dt', {}, 'Last modified'), h('dd', {}, fmtDate(o.lastModified)),
          h('dt', {}, 'Version ID'), h('dd', {}, h('code', {}, o.versionId)),
          h('dt', {}, 'Storage class'), h('dd', {}, clsTag(o.storageClass), o.transitionedAt ? h('span', { class: 'hint' }, `  moved by lifecycle on ${fmtDate(o.transitionedAt, false)}`) : null),
          h('dt', {}, 'Encryption'), h('dd', {}, o.sse ? 'SSE-S3 (AES-256-GCM)' : 'None'),
          h('dt', {}, 'Uploaded by'), h('dd', {}, h('code', {}, o.uploadedBy || 'console')),
          ...Object.entries(o.metadata || {}).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))),
        h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Preview')), h('div', { class: 'pad stack' }, preview))),
      archived ? h('section', { class: 'panel', style: 'margin-top:16px' }, h('header', {}, h('h3', {}, 'Archived object'), o.restoreStatus === 'restored' ? h('span', { class: 'badge ok' }, 'Restored copy available') : o.restoreStatus === 'in-progress' ? h('span', { class: 'badge warn' }, 'Restore in progress') : h('span', { class: 'badge' }, 'Archived')),
        h('div', { class: 'pad stack' },
          h('p', { class: 'hint' }, `${STORAGE_CLASSES[o.storageClass].label} objects cannot be read directly. A restore makes a temporary copy available after about ${STORAGE_CLASSES[o.storageClass].restoreHours} hours (standard tier) and charges a retrieval fee per GB.`),
          o.restore ? h('p', {}, `Restore requested ${fmtDate(o.restore.requestedAt)}, ready ${fmtDate(o.restore.readyAt)}, copy expires ${fmtDate(o.restore.expiresAt)}.`) : null,
          h('div', { class: 'actions' },
            h('button', { class: 'btn small primary', type: 'button', disabled: o.restoreStatus === 'in-progress' || o.restoreStatus === 'restored', onclick: async () => { try { await s3.restoreObject(bucket, key, { days: 7, versionId }); toast('Restore initiated', 'Move the clock forward to complete it'); draw(); } catch (e) { toastError(e); } } }, 'Initiate restore (7 days)'),
            h('button', { class: 'btn small', type: 'button', onclick: () => openClock() }, 'Time-travel the clock')))) : null,
      h('div', { class: 'grid-2', style: 'margin-top:16px' },
        h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Share with a presigned URL')),
          h('div', { class: 'pad stack' },
            h('p', { class: 'hint' }, 'A presigned URL lets anyone GET this private object until it expires. AeroTwin signs it with the AWS Signature Version 4 algorithm using this account\'s secret key; changing any character makes the signature check fail.'),
            h('div', { class: 'row' }, h('label', { class: 'field', style: 'flex:1' }, h('span', {}, 'Expires in'), expires),
              h('button', { class: 'btn primary', type: 'button', style: 'align-self:flex-end', onclick: async () => {
                try {
                  const p = await s3.presign(bucket, key, Number(expires.value));
                  presignOut.replaceChildren(
                    h('label', { class: 'field' }, h('span', {}, 'URL (works in this browser)'), h('textarea', { rows: 4, readonly: true }, p.url)),
                    h('div', { class: 'actions' }, copyable(p.url, 'Copy URL'), h('a', { class: 'btn small', href: p.url, target: '_blank', rel: 'noopener' }, 'Open'), h('span', { class: 'hint' }, `Expires ${fmtDate(p.expiresAt)} (simulated clock)`)),
                    h('details', {}, h('summary', { class: 'hint' }, 'Show the signing steps'),
                      h('div', { class: 'preview', style: 'margin-top:8px' }, h('pre', {}, `Canonical request\n-----------------\n${p.canonicalRequest}\n\nString to sign\n--------------\n${p.stringToSign}\n\nSignature = HMAC-SHA256(signingKey, stringToSign)\n${p.signature}\n\nReal-S3 form of this URL\n${p.awsStyleUrl}`))));
                } catch (e) { toastError(e); }
              } }, 'Generate')),
            presignOut)),
        h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Storage class'), clsTag(o.storageClass)),
          h('div', { class: 'pad stack' },
            h('p', { class: 'hint' }, 'Changing the class copies the object onto itself with the new class (a CopyObject request), which creates a new version in versioned buckets.'),
            h('div', { class: 'row' }, ...Object.entries(STORAGE_CLASSES).map(([k, v]) => h('button', {
              class: 'btn small', type: 'button', disabled: k === o.storageClass || !!versionId || (archived && o.restoreStatus !== 'restored'),
              onclick: async () => { try { await s3.copyObject(bucket, key, bucket, key, { storageClass: k }); toast('Storage class changed', `${STORAGE_CLASSES[o.storageClass].short} → ${v.short}`); draw(); } catch (e) { toastError(e); } }
            }, v.short)))))),
      h('section', { class: 'panel', style: 'margin-top:16px' }, h('header', {}, h('h3', {}, `Versions (${versions.length})`)),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Version ID'), h('th', {}, 'Last modified'), h('th', { class: 'num' }, 'Size'), h('th', {}, 'Storage class'), h('th', {}))),
          h('tbody', {}, versions.map(v => h('tr', {},
            h('td', {}, v.isDeleteMarker ? h('span', { class: 'muted' }, v.versionId) : h('a', { class: 'obj', href: `#/s3/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}&versionId=${encodeURIComponent(v.versionId)}` }, h('code', {}, v.versionId)),
              v.isLatest ? h('span', { class: 'badge ok', style: 'margin-left:8px' }, 'Current') : null, v.isDeleteMarker ? h('span', { class: 'badge bad', style: 'margin-left:8px' }, 'Delete marker') : null),
            h('td', { class: 'muted' }, fmtDate(v.lastModified)),
            h('td', { class: 'num' }, v.isDeleteMarker ? '—' : fmtBytes(v.size)),
            h('td', {}, v.isDeleteMarker ? '—' : clsTag(v.storageClass)),
            h('td', {}, v.isDeleteMarker || v.isLatest ? null : h('button', { class: 'btn small', type: 'button', onclick: async () => {
              try { await s3.copyObject(bucket, key, bucket, key, { versionId: v.versionId }); toast('Version restored', 'It was copied on top as the new current version'); location.hash = `#/s3/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}`; } catch (e) { toastError(e); }
            } }, 'Make current'))))))))
    ].filter(Boolean));

    loadPreview(preview, bucket, key, versionId, o);
  };

  async function remove(b) {
    const ok = await confirmDialog({
      title: versionId ? 'Delete this version permanently?' : `Delete ${key.split('/').pop()}?`,
      message: versionId ? 'This version will be removed for good.' : b.versioning === 'Enabled' ? 'S3 will add a delete marker. Earlier versions stay recoverable from the Versions list.' : 'Versioning is off, so the object is deleted permanently.',
      confirmLabel: 'Delete', danger: true
    });
    if (!ok) return;
    try { await s3.deleteObject(bucket, key, { versionId }); toast('Deleted', key); location.hash = `#/s3/${encodeURIComponent(bucket)}?prefix=${encodeURIComponent(key.includes('/') ? key.slice(0, key.lastIndexOf('/') + 1) : '')}`; }
    catch (e) { toastError(e); }
  }

  await draw();
}

async function loadPreview(el, bucket, key, versionId, o) {
  if (o.size > 8 * 1024 * 1024) { el.replaceChildren(h('p', { class: 'hint' }, 'Too large to preview. Download the object instead.')); return; }
  let r;
  try { r = await s3.getObject(bucket, key, { versionId }); }
  catch (e) { el.replaceChildren(h('p', { class: 'hint' }, `${e.code}: ${e.message}`)); return; }
  const type = o.contentType || '';
  if (type.startsWith('image/')) {
    el.replaceChildren(h('img', { src: URL.createObjectURL(r.body), alt: key }));
  } else if (type.startsWith('video/')) {
    el.replaceChildren(h('video', { src: URL.createObjectURL(r.body), controls: true }));
  } else if (type.includes('json') || type.startsWith('text/') || type.includes('xml')) {
    const text = await r.body.text();
    if (key.startsWith('logs/') && key.endsWith('.json')) {
      try {
        const log = JSON.parse(text);
        el.replaceChildren(
          pathPlot(log),
          h('dl', { class: 'kv', style: 'margin-top:12px' },
            h('dt', {}, 'Flight'), h('dd', {}, log.flightId),
            h('dt', {}, 'Control'), h('dd', {}, (log.control || []).join(', ') || 'autopilot'),
            h('dt', {}, 'Duration'), h('dd', {}, `${log.durationS} s, ${log.samples.length} samples at ${log.sampleRateHz} Hz`),
            h('dt', {}, 'Distance'), h('dd', {}, `${log.stats.distanceM} m, max altitude ${log.stats.maxAltM} m, top speed ${log.stats.maxSpeed} m/s`),
            h('dt', {}, 'Battery used'), h('dd', {}, `${log.stats.batteryUsedPct}%`),
            h('dt', {}, 'Result'), h('dd', {}, log.crashed ? 'Crashed' : 'Landed safely')),
          h('details', {}, h('summary', { class: 'hint' }, 'Raw JSON'), h('pre', {}, text.slice(0, 4000) + (text.length > 4000 ? '\n…' : ''))));
        return;
      } catch { /* fall through */ }
    }
    let shown = text;
    if (type.includes('json')) { try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* raw */ } }
    el.replaceChildren(h('pre', { html: esc(shown.slice(0, 20000)) }));
  } else {
    el.replaceChildren(h('p', { class: 'hint' }, `No preview for ${type || 'this type'}.`));
  }
}
