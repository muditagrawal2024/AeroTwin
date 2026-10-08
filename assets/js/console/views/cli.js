import { s3 } from '../../core/s3.js';
import { h, download, fmtDate } from '../../core/util.js';

const history = [];
let transcript = null;

const pad = (s, n) => String(s).padStart(n);
const cliDate = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const parseS3 = uri => {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(uri || '');
  if (!m) throw Object.assign(new Error(`Invalid S3 URI "${uri}". Use the form s3://bucket/key`), { code: 'ParamValidation' });
  return { bucket: m[1], key: m[2] };
};
function tokenize(line) {
  const out = []; let cur = ''; let q = null;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function flags(args) {
  const f = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) f[k] = args[++i]; else f[k] = true;
    } else pos.push(args[i]);
  }
  return { f, pos };
}
const json = o => JSON.stringify(o, null, 4);
const opName = s => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');

const HELP = `AeroTwin AWS CLI emulator. Commands run against the simulated S3 account.

  aws s3 ls [s3://bucket[/prefix]] [--recursive]
  aws s3 mb s3://bucket                     aws s3 rb s3://bucket [--force]
  aws s3 cp <src> <dst>                     (src or dst may be a local file: ./name)
  aws s3 mv s3://a/key s3://b/key           aws s3 rm s3://bucket/key [--recursive]
  aws s3 presign s3://bucket/key [--expires-in seconds]

  aws s3api list-buckets
  aws s3api list-object-versions --bucket b [--prefix p]
  aws s3api head-object --bucket b --key k
  aws s3api put-object --bucket b --key k --body "text"
  aws s3api delete-object --bucket b --key k [--version-id v]
  aws s3api get-bucket-versioning --bucket b
  aws s3api put-bucket-versioning --bucket b --versioning-configuration Status=Enabled
  aws s3api get-bucket-policy --bucket b
  aws s3api get-bucket-lifecycle-configuration --bucket b
  aws s3api get-bucket-notification-configuration --bucket b
  aws s3api restore-object --bucket b --key k [--restore-request Days=7]

  aws sts get-caller-identity
  aws ce get-cost-and-usage

  aerotwin clock +30d | +12h | reset        aerotwin lifecycle run
  clear   history   help`;

async function run(line, print) {
  const t = tokenize(line);
  if (!t.length) return;
  if (t[0] === 'clear') { transcript.replaceChildren(); return; }
  if (t[0] === 'help') return print(HELP);
  if (t[0] === 'history') return print(history.map((c, i) => `${pad(i + 1, 4)}  ${c}`).join('\n'));
  if (t[0] === 'aerotwin') return aerotwin(t.slice(1), print);
  if (t[0] !== 'aws') return print(`${t[0]}: command not found. Type "help" for the list of commands.`, 'err');
  const [svc, op, ...rest] = t.slice(1);
  const { f, pos } = flags(rest);
  if (svc === 's3') return highLevel(op, pos, f, print);
  if (svc === 's3api') return api(op, f, print);
  if (svc === 'sts' && op === 'get-caller-identity') {
    const a = s3.account();
    return print(json({ UserId: a.accessKeyId, Account: a.accountId, Arn: `arn:aws:iam::${a.accountId}:user/aerotwin-student` }));
  }
  if (svc === 'ce' && op === 'get-cost-and-usage') {
    const b = await s3.billing();
    return print(json({ ResultsByTime: [{ TimePeriod: { Start: b.month + '-01' }, Total: { UnblendedCost: { Amount: b.total.toFixed(8), Unit: 'USD' } }, Groups: b.lines.filter(l => l.cost > 0).map(l => ({ Keys: [l.item], Metrics: { UnblendedCost: { Amount: l.cost.toFixed(8), Unit: 'USD' } } })) }], Forecast: b.forecast.toFixed(8) }));
  }
  print(`aws: error: argument operation: Invalid choice "${svc} ${op || ''}". Type "help".`, 'err');
}

async function aerotwin([cmd, arg], print) {
  if (cmd === 'clock') {
    if (arg === 'reset') { await s3.resetClock(); return print(`Clock reset to ${fmtDate(s3.now())}`); }
    const m = /^\+(\d+(?:\.\d+)?)([dh])$/.exec(arg || '');
    if (!m) return print('Usage: aerotwin clock +30d | +12h | reset', 'err');
    const ms = Number(m[1]) * (m[2] === 'd' ? 86400000 : 3600000);
    const changes = await s3.advanceClock(ms);
    print(`Clock is now ${fmtDate(s3.now())}`);
    changes.forEach(c => print(c.action === 'transition' ? `lifecycle: s3://${c.bucket}/${c.key}  ${c.from} -> ${c.to}` : `lifecycle: ${c.action} s3://${c.bucket}/${c.key}`, 'dim'));
    return;
  }
  if (cmd === 'lifecycle' && arg === 'run') {
    const c = await s3.runLifecycle();
    return print(c.length ? c.map(x => `${x.action}: s3://${x.bucket}/${x.key}${x.to ? ' -> ' + x.to : ''}`).join('\n') : 'No lifecycle actions are due.');
  }
  print('Usage: aerotwin clock +30d | aerotwin lifecycle run', 'err');
}

async function highLevel(op, pos, f, print) {
  switch (op) {
    case 'ls': {
      if (!pos[0]) {
        const bs = await s3.listBuckets();
        return print(bs.map(b => `${cliDate(b.createdAt)} ${b.name}`).join('\n') || '');
      }
      const { bucket, key } = parseS3(pos[0]);
      if (f.recursive) {
        const vs = (await s3.listObjectsV2(bucket, { prefix: key, delimiter: '' })).contents;
        return print(vs.map(o => `${cliDate(o.lastModified)} ${pad(o.size, 10)} ${o.key}`).join('\n'));
      }
      const r = await s3.listObjectsV2(bucket, { prefix: key, delimiter: '/' });
      return print([...r.commonPrefixes.map(p => `${pad('PRE', 30)} ${p.slice(key.length)}`), ...r.contents.map(o => `${cliDate(o.lastModified)} ${pad(o.size, 10)} ${o.key.slice(key.length)}`)].join('\n'));
    }
    case 'mb': { const { bucket } = parseS3(pos[0]); await s3.createBucket(bucket); return print(`make_bucket: ${bucket}`); }
    case 'rb': { const { bucket } = parseS3(pos[0]); await s3.deleteBucket(bucket, { force: !!f.force }); return print(`remove_bucket: ${bucket}`); }
    case 'rm': {
      const { bucket, key } = parseS3(pos[0]);
      if (f.recursive) {
        const objs = (await s3.listObjectsV2(bucket, { prefix: key, delimiter: '' })).contents;
        for (const o of objs) { await s3.deleteObject(bucket, o.key); print(`delete: s3://${bucket}/${o.key}`); }
        return;
      }
      await s3.deleteObject(bucket, key); return print(`delete: s3://${bucket}/${key}`);
    }
    case 'cp': case 'mv': {
      const [src, dst] = pos;
      if (!src || !dst) return print(`usage: aws s3 ${op} <source> <destination>`, 'err');
      if (src.startsWith('s3://') && dst.startsWith('s3://')) {
        const a = parseS3(src), b = parseS3(dst);
        const dkey = !b.key || b.key.endsWith('/') ? b.key + a.key.split('/').pop() : b.key;
        await s3.copyObject(a.bucket, a.key, b.bucket, dkey);
        if (op === 'mv') await s3.deleteObject(a.bucket, a.key);
        return print(`${op === 'mv' ? 'move' : 'copy'}: ${src} to s3://${b.bucket}/${dkey}`);
      }
      if (dst.startsWith('s3://')) {
        const b = parseS3(dst);
        print('Choose the local file to upload…', 'dim');
        const file = await pickFile();
        if (!file) return print('upload cancelled', 'err');
        const k = !b.key || b.key.endsWith('/') ? b.key + file.name : b.key;
        await s3.uploadMultipart(b.bucket, k, file, { contentType: file.type || undefined });
        return print(`upload: ./${file.name} to s3://${b.bucket}/${k}`);
      }
      const a = parseS3(src);
      const r = await s3.getObject(a.bucket, a.key, { transferOut: true });
      const name = dst === './' || dst === '.' ? a.key.split('/').pop() : dst.replace(/^\.\//, '');
      download(r.body, name);
      return print(`download: ${src} to ./${name}`);
    }
    case 'presign': {
      const { bucket, key } = parseS3(pos[0]);
      const p = await s3.presign(bucket, key, Number(f['expires-in'] || 3600));
      return print(p.url);
    }
    default: return print(`aws s3: unknown command "${op}". Type "help".`, 'err');
  }
}

async function api(op, f, print) {
  const need = (...k) => { for (const x of k) if (!f[x]) throw Object.assign(new Error(`the following arguments are required: --${x}`), { code: 'ParamValidation' }); };
  switch (op) {
    case 'list-buckets': {
      const bs = await s3.listBuckets();
      return print(json({ Buckets: bs.map(b => ({ Name: b.name, CreationDate: new Date(b.createdAt).toISOString() })), Owner: { ID: s3.account().accountId } }));
    }
    case 'list-object-versions': {
      need('bucket');
      const vs = await s3.listObjectVersions(f.bucket, { prefix: f.prefix || '' });
      return print(json({
        Versions: vs.filter(v => !v.isDeleteMarker).map(v => ({ ETag: v.etag, Size: v.size, StorageClass: v.storageClass, Key: v.key, VersionId: v.versionId, IsLatest: v.isLatest, LastModified: new Date(v.lastModified).toISOString() })),
        DeleteMarkers: vs.filter(v => v.isDeleteMarker).map(v => ({ Key: v.key, VersionId: v.versionId, IsLatest: v.isLatest, LastModified: new Date(v.lastModified).toISOString() }))
      }));
    }
    case 'head-object': {
      need('bucket', 'key');
      const o = await s3.headObject(f.bucket, f.key, { versionId: f['version-id'] });
      return print(json({ LastModified: new Date(o.lastModified).toUTCString(), ContentLength: o.size, ETag: o.etag, VersionId: o.versionId, ContentType: o.contentType, ServerSideEncryption: o.sse || undefined, StorageClass: o.storageClass === 'STANDARD' ? undefined : o.storageClass, Restore: o.restore ? `ongoing-request="${o.restoreStatus === 'in-progress'}", expiry-date="${new Date(o.restore.expiresAt).toUTCString()}"` : undefined, Metadata: o.metadata }));
    }
    case 'put-object': {
      need('bucket', 'key');
      const r = await s3.putObject(f.bucket, f.key, typeof f.body === 'string' ? f.body : '', { storageClass: f['storage-class'] });
      return print(json({ ETag: r.etag, ServerSideEncryption: 'AES256', VersionId: r.versionId === 'null' ? undefined : r.versionId }));
    }
    case 'delete-object': {
      need('bucket', 'key');
      const r = await s3.deleteObject(f.bucket, f.key, { versionId: f['version-id'] });
      return print(json({ DeleteMarker: r.deleteMarker || undefined, VersionId: r.versionId }));
    }
    case 'get-bucket-versioning': {
      need('bucket');
      const b = await s3.getBucket(f.bucket);
      return print(b.versioning === 'Unversioned' ? '' : json({ Status: b.versioning }));
    }
    case 'put-bucket-versioning': {
      need('bucket', 'versioning-configuration');
      const st = /Status=(\w+)/.exec(f['versioning-configuration'])?.[1];
      await s3.putBucketVersioning(f.bucket, st);
      return print('');
    }
    case 'get-bucket-policy': {
      need('bucket');
      const b = await s3.getBucket(f.bucket);
      if (!b.policy) throw Object.assign(new Error('The bucket policy does not exist'), { code: 'NoSuchBucketPolicy' });
      return print(json({ Policy: b.policy.replace(/\s+/g, ' ') }));
    }
    case 'get-bucket-lifecycle-configuration': {
      need('bucket');
      const b = await s3.getBucket(f.bucket);
      if (!b.lifecycle?.length) throw Object.assign(new Error('The lifecycle configuration does not exist'), { code: 'NoSuchLifecycleConfiguration' });
      return print(json({ Rules: b.lifecycle.map(r => ({ ID: r.id, Filter: { Prefix: r.prefix || '' }, Status: r.status || 'Enabled', Transitions: (r.transitions || []).map(t => ({ Days: t.days, StorageClass: t.storageClass })), Expiration: r.expirationDays ? { Days: r.expirationDays } : undefined, NoncurrentVersionExpiration: r.noncurrentExpirationDays ? { NoncurrentDays: r.noncurrentExpirationDays } : undefined })) }));
    }
    case 'get-bucket-notification-configuration': {
      need('bucket');
      const b = await s3.getBucket(f.bucket);
      return print(json({ LambdaFunctionConfigurations: (b.notifications || []).map(n => ({ Id: n.id, LambdaFunctionArn: `arn:aws:lambda:${b.region}:${s3.account().accountId}:function:${n.target}`, Events: n.events, Filter: { Key: { FilterRules: [{ Name: 'Prefix', Value: n.prefix || '' }, { Name: 'Suffix', Value: n.suffix || '' }] } } })) }));
    }
    case 'restore-object': {
      need('bucket', 'key');
      const days = Number(/Days=(\d+)/.exec(f['restore-request'] || '')?.[1] || 7);
      const r = await s3.restoreObject(f.bucket, f.key, { days });
      return print(`Restore initiated. Ready at ${fmtDate(r.readyAt)} on the simulated clock.`);
    }
    default: return print(`aws s3api: unknown operation "${op}". Type "help".`, 'err');
  }
}

function pickFile() {
  return new Promise(res => {
    const i = h('input', { type: 'file', style: 'display:none' });
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.append(i); i.click();
    setTimeout(() => window.addEventListener('focus', () => setTimeout(() => { if (!i.files.length) res(null); }, 600), { once: true }), 100);
  });
}

export async function render(root) {
  transcript ||= h('div', { class: 'cli-out', 'aria-live': 'polite' }, h('span', { class: 'dim' }, `AeroTwin CLI. Credentials for account ${s3.account().accountId} are loaded. Type "help".\n`));
  const input = h('input', { type: 'text', 'aria-label': 'CLI command', autocomplete: 'off', spellcheck: 'false', placeholder: 'aws s3 ls' });
  const print = (text, cls) => { if (text === undefined) return; transcript.append(h('div', { class: cls || '' }, text)); transcript.scrollTop = transcript.scrollHeight; };
  let hi = history.length;
  const exec = async line => {
    print(`$ ${line}`, 'cmd');
    if (line.trim()) history.push(line);
    hi = history.length;
    const prev = s3.source; s3.source = 'cli';
    try { await run(line, print); }
    catch (e) {
      const raw = tokenize(line)[2] || '';
      const op = ({ ls: 'ListObjectsV2', cp: 'CopyObject', mv: 'CopyObject', rm: 'DeleteObject', mb: 'CreateBucket', rb: 'DeleteBucket', presign: 'GetObject' })[raw] || opName(raw || 'unknown');
      print(e.code === 'ParamValidation' ? `aws: error: ${e.message}` : `An error occurred (${e.code || 'Error'}) when calling the ${op} operation: ${e.message}`, 'err');
    } finally { s3.source = prev; }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = input.value; input.value = ''; exec(v); }
    else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); input.value = history[hi] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hi = Math.min(history.length, hi + 1); input.value = history[hi] || ''; e.preventDefault(); }
  });
  const tips = ['aws s3 ls', 'aws s3 ls s3://aerotwin-flight-logs --recursive', 'aws s3api list-object-versions --bucket aerotwin-missions', 'aws s3api get-bucket-lifecycle-configuration --bucket aerotwin-flight-logs', 'aws s3 presign s3://aerotwin-public-gallery/private/owner-notes.txt --expires-in 300', 'aerotwin clock +30d', 'aws ce get-cost-and-usage'];
  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'AWS CLI'),
      h('p', {}, 'The same operations the console performs, typed as AWS CLI commands. Output and error messages follow the real CLI format.'))),
    h('div', { class: 'cli-tips' }, tips.map(t => h('button', { type: 'button', onclick: () => { input.value = t; input.focus(); } }, t))),
    h('div', { class: 'cli' }, transcript, h('div', { class: 'cli-in' }, h('span', {}, '$'), input)));
  input.focus();
}
