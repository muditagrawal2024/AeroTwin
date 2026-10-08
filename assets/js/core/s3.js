// AeroTwin S3 engine
// ------------------------------------------------------------------
// A browser-side simulation of Amazon S3 built on IndexedDB. It models the
// parts of S3 that matter for understanding the service:
//   * buckets (naming rules, region, tags) and objects (keys, prefixes,
//     metadata, ETag = MD5, Content-Type, multipart uploads)
//   * versioning (Unversioned / Enabled / Suspended, delete markers)
//   * storage classes, lifecycle rules (transitions + expiration) and
//     Glacier restores, driven by a simulated clock that can time-travel
//   * server-side encryption (SSE-S3 style, real AES-256-GCM via WebCrypto)
//   * Block Public Access + bucket policies, public object URLs
//   * presigned URLs signed with a real AWS Signature Version 4 derivation
//   * event notifications to "functions" and to every open tab
//   * request metering + storage GB-month accounting for the billing view
// Every call is recorded in a CloudTrail-style activity log.

import { md5 } from './md5.js';
import { evaluatePolicy, validatePolicy } from './policy.js';
import { STORAGE_CLASSES, PUT_CLASS, FREE_REQUESTS, MONTH_MS } from './pricing.js';
import { randId, guessContentType } from './util.js';

const DB_NAME = 'aerotwin-s3';
const DB_VERSION = 1;
const DAY = 86400000;
export const REGIONS = {
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-south-2': 'Asia Pacific (Hyderabad)',
  'us-east-1': 'US East (N. Virginia)',
  'eu-west-1': 'Europe (Ireland)',
  'ap-southeast-1': 'Asia Pacific (Singapore)'
};
export const DEFAULT_REGION = 'ap-south-1';

export class S3Error extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------- tiny IndexedDB helpers ----------
function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('meta');
      db.createObjectStore('buckets', { keyPath: 'name' });
      const objs = db.createObjectStore('objects', { keyPath: 'id' });
      objs.createIndex('bucket', 'bucket');
      objs.createIndex('bucketKey', ['bucket', 'key']);
      db.createObjectStore('blobs', { keyPath: 'id' });
      const log = db.createObjectStore('requests', { keyPath: 'seq', autoIncrement: true });
      log.createIndex('time', 'time');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
async function sha256hex(msg) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(msg))); }
const amzDate = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const uriEncode = (s, keepSlash) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(keepSlash ? /%2F/g : /$^/, '/');
const monthKey = ms => new Date(ms).toISOString().slice(0, 7);

export function validateBucketName(name) {
  const problems = [];
  if (name.length < 3 || name.length > 63) problems.push('Bucket names must be between 3 and 63 characters long.');
  if (!/^[a-z0-9.-]+$/.test(name)) problems.push('Use only lowercase letters, numbers, dots (.) and hyphens (-).');
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) problems.push('Bucket names must begin and end with a letter or number.');
  if (/\.\./.test(name)) problems.push('Bucket names must not contain two adjacent periods.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) problems.push('Bucket names must not be formatted as an IP address.');
  if (/^xn--|^sthree-|-s3alias$|--ol-s3$/.test(name)) problems.push('This prefix or suffix is reserved by AWS.');
  return problems;
}

class S3Engine {
  constructor() {
    this.db = null;
    this.listeners = new Set();
    this.functions = new Map();
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('aerotwin-s3') : null;
    if (this.channel) this.channel.onmessage = e => this._emitLocal(e.data, true);
    this.meta = {};
    this._ready = null;
    this.source = 'console';
  }

  ready() {
    if (!this._ready) this._ready = this._init();
    return this._ready;
  }

  async _init() {
    this.db = await openDB();
    let account = await this._get('meta', 'account');
    if (!account) {
      account = {
        accountId: String(100000000000 + Math.floor(Math.random() * 899999999999)),
        accessKeyId: 'AKIA' + randId(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
        secretAccessKey: randId(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'),
        alias: 'aerotwin-lab',
        createdAt: Date.now()
      };
      account.sseKey = [...crypto.getRandomValues(new Uint8Array(32))];
      await this._put('meta', account, 'account');
      await this._put('meta', 0, 'clockOffset');
      await this._put('meta', { lastTick: Date.now(), months: {}, current: {} }, 'usage');
      await this._put('meta', { monthlyBudget: 1, freeTier: true, prices: null }, 'billing');
    }
    this.meta.account = account;
    this.meta.clockOffset = (await this._get('meta', 'clockOffset')) || 0;
    this.sseKey = await crypto.subtle.importKey('raw', new Uint8Array(account.sseKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (!(await this._get('meta', 'seeded'))) {
      const { seed } = await import('./seed.js');
      const prev = this.source; this.source = 'aerotwin-setup';
      try { await seed(this); await this._put('meta', true, 'seeded'); }
      catch (e) { console.warn('Sample data could not be created', e); }
      finally { this.source = prev; }
    }
    await this.runLifecycle();
    return this;
  }

  // ---------- events ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emitLocal(evt, remote = false) {
    if (evt.type === 'clock') this.meta.clockOffset = evt.offset;
    this.listeners.forEach(fn => { try { fn({ ...evt, remote }); } catch (e) { console.error(e); } });
  }
  _emit(evt) {
    this._emitLocal(evt);
    this.channel?.postMessage(evt);
  }
  registerFunction(name, handler) { this.functions.set(name, handler); }

  // ---------- simulated clock ----------
  now() { return Date.now() + (this.meta.clockOffset || 0); }
  async advanceClock(ms) {
    await this._integrateUsage();
    this.meta.clockOffset = (this.meta.clockOffset || 0) + ms;
    await this._put('meta', this.meta.clockOffset, 'clockOffset');
    await this._integrateUsage();
    const result = await this.runLifecycle();
    this._emit({ type: 'clock', offset: this.meta.clockOffset });
    return result;
  }
  async resetClock() {
    await this._integrateUsage();
    this.meta.clockOffset = 0;
    await this._put('meta', 0, 'clockOffset');
    const u = await this._get('meta', 'usage');
    u.lastTick = this.now();
    await this._put('meta', u, 'usage');
    this._emit({ type: 'clock', offset: 0 });
  }

  // ---------- raw store access ----------
  _tx(stores, mode = 'readonly') { return this.db.transaction(stores, mode); }
  _get(store, key) { return req(this._tx(store).objectStore(store).get(key)); }
  _put(store, value, key) { return req(this._tx(store, 'readwrite').objectStore(store).put(value, key)); }
  _del(store, key) { return req(this._tx(store, 'readwrite').objectStore(store).delete(key)); }
  _all(store) { return req(this._tx(store).objectStore(store).getAll()); }
  _byIndex(store, index, key) { return req(this._tx(store).objectStore(store).index(index).getAll(key)); }

  // ---------- accounting ----------
  async _integrateUsage(delta) {
    const u = (await this._get('meta', 'usage')) || { lastTick: this.now(), months: {}, current: {} };
    let t = u.lastTick;
    const end = this.now();
    // Split the integration at month boundaries so each bill is accurate.
    while (t < end) {
      const d = new Date(t);
      const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      const segEnd = Math.min(end, nextMonth);
      const m = (u.months[monthKey(t)] ||= this._emptyMonth());
      for (const [cls, bytes] of Object.entries(u.current)) {
        m.byteMs[cls] = (m.byteMs[cls] || 0) + bytes * (segEnd - t);
      }
      t = segEnd;
    }
    u.lastTick = Math.max(end, u.lastTick);
    if (delta) {
      const m = (u.months[monthKey(end)] ||= this._emptyMonth());
      if (delta.bytes) {
        for (const [cls, b] of Object.entries(delta.bytes)) u.current[cls] = Math.max(0, (u.current[cls] || 0) + b);
      }
      if (delta.api) {
        m.api[delta.api] = (m.api[delta.api] || 0) + 1;
        if (FREE_REQUESTS.has(delta.api)) { /* free */ }
        else if (PUT_CLASS.has(delta.api)) m.putRequests++;
        else m.getRequests++;
      }
      if (delta.retrieval) m.retrieval[delta.retrieval.cls] = (m.retrieval[delta.retrieval.cls] || 0) + delta.retrieval.bytes;
      if (delta.transferOut) m.transferOut += delta.transferOut;
    }
    await this._put('meta', u, 'usage');
    return u;
  }
  _emptyMonth() { return { byteMs: {}, api: {}, putRequests: 0, getRequests: 0, retrieval: {}, transferOut: 0 }; }
  async usage() { return this._integrateUsage(); }

  async _log(entry) {
    const rec = { time: this.now(), realTime: Date.now(), source: this.source, status: 200, ...entry };
    await req(this._tx('requests', 'readwrite').objectStore('requests').add(rec));
    if (entry.api) await this._integrateUsage({ api: entry.api });
    this._emit({ type: 'request', entry: rec });
    return rec;
  }
  async listRequests(limit = 300) {
    const all = await this._all('requests');
    return all.slice(-limit).reverse();
  }
  async _fail(api, err, ctx = {}) {
    await this._log({ api, ...ctx, status: err.status || 400, error: err.code });
    throw err;
  }

  // ---------- account ----------
  account() { return this.meta.account; }
  async getBillingSettings() { return (await this._get('meta', 'billing')) || { monthlyBudget: 1, freeTier: true, prices: null }; }
  async setBillingSettings(s) { await this._put('meta', s, 'billing'); this._emit({ type: 'billing' }); }

  // ---------- buckets ----------
  async listBuckets({ log = true } = {}) {
    const b = await this._all('buckets');
    if (log) await this._log({ api: 'ListBuckets' });
    return b.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getBucket(name) {
    const b = await this._get('buckets', name);
    if (!b) throw new S3Error('NoSuchBucket', `The specified bucket "${name}" does not exist.`, 404);
    return b;
  }

  async headBucket(name) { return !!(await this._get('buckets', name)); }

  async createBucket(name, opts = {}) {
    const ctx = { bucket: name };
    const problems = validateBucketName(name);
    if (problems.length) return this._fail('CreateBucket', new S3Error('InvalidBucketName', problems[0]), ctx);
    if (await this._get('buckets', name)) {
      return this._fail('CreateBucket', new S3Error('BucketAlreadyOwnedByYou', 'Your previous request to create the named bucket succeeded and you already own it.', 409), ctx);
    }
    const bucket = {
      name,
      region: opts.region || DEFAULT_REGION,
      createdAt: this.now(),
      versioning: opts.versioning || 'Unversioned',
      encryption: opts.encryption || 'AES256',
      blockPublicAccess: opts.blockPublicAccess !== false,
      policy: opts.policy || null,
      lifecycle: opts.lifecycle || [],
      notifications: opts.notifications || [],
      tags: opts.tags || {},
      objectOwnership: 'BucketOwnerEnforced'
    };
    await this._put('buckets', bucket);
    await this._log({ api: 'CreateBucket', ...ctx });
    this._emit({ type: 'bucket', action: 'created', bucket: name });
    return bucket;
  }

  async deleteBucket(name, { force = false } = {}) {
    const ctx = { bucket: name };
    try { await this.getBucket(name); } catch (e) { return this._fail('DeleteBucket', e, ctx); }
    const objs = await this._byIndex('objects', 'bucket', name);
    if (objs.length && !force) {
      return this._fail('DeleteBucket', new S3Error('BucketNotEmpty', 'The bucket you tried to delete is not empty. You must delete all versions in the bucket.', 409), ctx);
    }
    for (const o of objs) await this._removeVersion(o);
    await this._del('buckets', name);
    await this._log({ api: 'DeleteBucket', ...ctx });
    this._emit({ type: 'bucket', action: 'deleted', bucket: name });
  }

  async _updateBucket(name, api, patch) {
    const b = await this.getBucket(name).catch(e => this._fail(api, e, { bucket: name }));
    Object.assign(b, patch);
    await this._put('buckets', b);
    await this._log({ api, bucket: name });
    this._emit({ type: 'bucket', action: 'updated', bucket: name });
    return b;
  }

  async putBucketVersioning(name, status) {
    if (!['Enabled', 'Suspended'].includes(status)) throw new S3Error('MalformedXML', 'Versioning status must be Enabled or Suspended.');
    const b = await this.getBucket(name);
    if (b.versioning === 'Unversioned' && status === 'Suspended') {
      throw new S3Error('InvalidArgument', 'Versioning has never been enabled on this bucket, so it cannot be suspended.');
    }
    return this._updateBucket(name, 'PutBucketVersioning', { versioning: status });
  }
  async putBucketEncryption(name, algo) { return this._updateBucket(name, 'PutBucketEncryption', { encryption: algo }); }
  async putPublicAccessBlock(name, block) { return this._updateBucket(name, 'PutPublicAccessBlock', { blockPublicAccess: !!block }); }
  async putBucketTagging(name, tags) { return this._updateBucket(name, 'PutBucketTagging', { tags }); }
  async putBucketPolicy(name, text) {
    if (text) {
      const b = await this.getBucket(name);
      const v = validatePolicy(text, name);
      if (!v.ok) return this._fail('PutBucketPolicy', new S3Error('MalformedPolicy', v.errors.join(' ')), { bucket: name });
      const grantsPublic = (Array.isArray(v.doc.Statement) ? v.doc.Statement : [v.doc.Statement])
        .some(s => s.Effect === 'Allow' && (s.Principal === '*' || s.Principal?.AWS === '*'));
      if (grantsPublic && b.blockPublicAccess) {
        return this._fail('PutBucketPolicy', new S3Error('AccessDenied', 'Block Public Access is on for this bucket, so a policy that grants public access cannot be saved. Turn off Block Public Access first.', 403), { bucket: name });
      }
    }
    return this._updateBucket(name, text ? 'PutBucketPolicy' : 'DeleteBucketPolicy', { policy: text || null });
  }
  async putBucketLifecycle(name, rules) {
    for (const r of rules) {
      const days = (r.transitions || []).map(t => t.days);
      if (days.some(d => !(d >= 0))) throw new S3Error('InvalidArgument', `Rule "${r.id}": transition days must be zero or more.`);
      const ia = (r.transitions || []).find(t => t.storageClass === 'STANDARD_IA');
      if (ia && ia.days < 30) throw new S3Error('InvalidArgument', `Rule "${r.id}": objects must be stored at least 30 days before moving to Standard-IA.`);
      if (r.expirationDays && days.some(d => d >= r.expirationDays)) throw new S3Error('InvalidArgument', `Rule "${r.id}": expiration must come after every transition.`);
    }
    const b = await this._updateBucket(name, 'PutBucketLifecycleConfiguration', { lifecycle: rules });
    await this.runLifecycle();
    return b;
  }
  async putBucketNotification(name, configs) { return this._updateBucket(name, 'PutBucketNotificationConfiguration', { notifications: configs }); }

  // ---------- objects ----------
  _objId(bucket, key, versionId) { return `${bucket}\u0000${key}\u0000${versionId}`; }

  async _versions(bucket, key) {
    const v = await this._byIndex('objects', 'bucketKey', [bucket, key]);
    return v.sort((a, b) => b.lastModified - a.lastModified || b.seq - a.seq);
  }

  async _removeVersion(o) {
    await this._del('objects', o.id);
    if (o.blobId) await this._del('blobs', o.blobId);
    await this._integrateUsage({ bytes: { [o.storageClass || 'STANDARD']: -(o.size || 0) } });
  }

  async _toBytes(body) {
    if (body === undefined || body === null) return new Uint8Array();
    if (typeof body === 'string') return enc.encode(body);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return enc.encode(JSON.stringify(body));
  }

  async putObject(bucket, key, body, opts = {}) {
    const ctx = { bucket, key };
    let b;
    try { b = await this.getBucket(bucket); } catch (e) { return this._fail('PutObject', e, ctx); }
    if (!key || key.length > 1024) return this._fail('PutObject', new S3Error('KeyTooLongError', 'Object keys must be between 1 and 1024 characters.'), ctx);
    const cls = opts.storageClass || 'STANDARD';
    if (!STORAGE_CLASSES[cls]) return this._fail('PutObject', new S3Error('InvalidStorageClass', `${cls} is not a valid storage class.`), ctx);

    const bytes = await this._toBytes(body);
    const etag = md5(bytes);
    let stored = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    let iv = null;
    if (b.encryption === 'AES256') {
      iv = crypto.getRandomValues(new Uint8Array(12));
      stored = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.sseKey, bytes);
    }
    const versioned = b.versioning === 'Enabled';
    const versionId = versioned ? randId(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._') : 'null';
    const now = opts.lastModified || this.now();

    // Previous versions: overwrite the "null" version, or mark the latest noncurrent.
    for (const v of await this._versions(bucket, key)) {
      if (v.versionId === 'null' && !versioned) { await this._removeVersion(v); continue; }
      if (v.isLatest) { v.isLatest = false; v.noncurrentSince = now; await this._put('objects', v); }
    }

    const blobId = randId(24);
    await this._put('blobs', { id: blobId, data: stored, iv });
    const rec = {
      id: this._objId(bucket, key, versionId),
      bucket, key, versionId,
      seq: performance.now() + Math.random(),
      isLatest: true,
      isDeleteMarker: false,
      size: bytes.byteLength,
      etag: `"${etag}"`,
      contentType: opts.contentType || guessContentType(key),
      storageClass: cls,
      lastModified: now,
      metadata: opts.metadata || {},
      tags: opts.tags || {},
      sse: b.encryption === 'AES256' ? 'AES256' : null,
      blobId,
      uploadedBy: this.source,
      multipart: opts.parts > 1 ? opts.parts : 0
    };
    if (rec.multipart) rec.etag = `"${md5(enc.encode(etag + rec.multipart))}-${rec.multipart}"`;
    await this._put('objects', rec);
    await this._integrateUsage({ bytes: { [cls]: bytes.byteLength } });
    await this._log({ api: opts.api || 'PutObject', ...ctx, bytes: bytes.byteLength, versionId });
    await this._notify(b, 'ObjectCreated:' + (opts.api === 'CopyObject' ? 'Copy' : opts.parts > 1 ? 'CompleteMultipartUpload' : 'Put'), rec);
    return { versionId, etag: rec.etag, size: rec.size, key, bucket };
  }

  /** Simulates a multipart upload: one UploadPart call per 5 MB part. */
  async uploadMultipart(bucket, key, file, opts = {}, onProgress) {
    const PART = 5 * 1024 * 1024;
    const parts = Math.max(1, Math.ceil(file.size / PART));
    if (parts > 1) await this._log({ api: 'CreateMultipartUpload', bucket, key });
    for (let i = 0; i < parts; i++) {
      if (parts > 1) await this._log({ api: 'UploadPart', bucket, key, bytes: Math.min(PART, file.size - i * PART), note: `part ${i + 1} of ${parts}` });
      onProgress?.((i + 1) / parts, i + 1, parts);
      await new Promise(r => setTimeout(r, parts > 1 ? 60 : 0));
    }
    return this.putObject(bucket, key, file, { ...opts, parts, api: parts > 1 ? 'CompleteMultipartUpload' : 'PutObject' });
  }

  async _findVersion(bucket, key, versionId) {
    const versions = await this._versions(bucket, key);
    if (versionId) return versions.find(v => v.versionId === versionId);
    return versions.find(v => v.isLatest);
  }

  async headObject(bucket, key, opts = {}) {
    const ctx = { bucket, key };
    try { await this.getBucket(bucket); } catch (e) { return this._fail('HeadObject', e, ctx); }
    const o = await this._findVersion(bucket, key, opts.versionId);
    if (!o || (o.isDeleteMarker && !opts.versionId)) return this._fail('HeadObject', new S3Error('NoSuchKey', 'The specified key does not exist.', 404), ctx);
    if (opts.log !== false) await this._log({ api: 'HeadObject', ...ctx });
    return { ...o, restoreStatus: this._restoreStatus(o) };
  }

  _restoreStatus(o) {
    if (!STORAGE_CLASSES[o.storageClass]?.archived) return null;
    if (!o.restore) return 'archived';
    const now = this.now();
    if (now < o.restore.readyAt) return 'in-progress';
    if (now < o.restore.expiresAt) return 'restored';
    return 'archived';
  }

  async getObject(bucket, key, opts = {}) {
    const ctx = { bucket, key };
    try { await this.getBucket(bucket); } catch (e) { return this._fail('GetObject', e, ctx); }
    const o = await this._findVersion(bucket, key, opts.versionId);
    if (!o) return this._fail('GetObject', new S3Error(opts.versionId ? 'NoSuchVersion' : 'NoSuchKey', opts.versionId ? 'The specified version does not exist.' : 'The specified key does not exist.', 404), ctx);
    if (o.isDeleteMarker) return this._fail('GetObject', new S3Error(opts.versionId ? 'MethodNotAllowed' : 'NoSuchKey', opts.versionId ? 'The specified version is a delete marker.' : 'The specified key does not exist.', opts.versionId ? 405 : 404), ctx);
    const rs = this._restoreStatus(o);
    if (rs === 'archived' || rs === 'in-progress') {
      return this._fail('GetObject', new S3Error('InvalidObjectState', rs === 'in-progress'
        ? 'A restore is in progress for this archived object. Advance the clock or wait until it completes.'
        : `The object is in ${STORAGE_CLASSES[o.storageClass].label}. Restore it before reading.`, 403), ctx);
    }
    const blob = await this._get('blobs', o.blobId);
    let data = blob.data;
    if (blob.iv) data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv }, this.sseKey, data);
    const retrievalFee = STORAGE_CLASSES[o.storageClass].retrieval;
    await this._log({ api: 'GetObject', ...ctx, bytes: o.size });
    if (retrievalFee) await this._integrateUsage({ retrieval: { cls: o.storageClass, bytes: o.size } });
    if (opts.transferOut) await this._integrateUsage({ transferOut: o.size });
    return { meta: o, body: new Blob([data], { type: o.contentType }) };
  }

  async getObjectText(bucket, key, opts) {
    const r = await this.getObject(bucket, key, opts);
    return r.body.text();
  }

  async deleteObject(bucket, key, opts = {}) {
    const ctx = { bucket, key };
    let b;
    try { b = await this.getBucket(bucket); } catch (e) { return this._fail('DeleteObject', e, ctx); }
    const versions = await this._versions(bucket, key);
    if (opts.versionId) {
      const v = versions.find(x => x.versionId === opts.versionId);
      if (!v) return this._fail('DeleteObject', new S3Error('NoSuchVersion', 'The specified version does not exist.', 404), ctx);
      await this._removeVersion(v);
      if (v.isLatest) {
        const next = versions.find(x => x !== v);
        if (next) { next.isLatest = true; delete next.noncurrentSince; await this._put('objects', next); }
      }
      await this._log({ api: 'DeleteObject', ...ctx, versionId: opts.versionId });
      await this._notify(b, 'ObjectRemoved:Delete', v);
      return { deleted: true, versionId: v.versionId };
    }
    if (b.versioning === 'Unversioned') {
      for (const v of versions) await this._removeVersion(v);
      await this._log({ api: 'DeleteObject', ...ctx });
      await this._notify(b, 'ObjectRemoved:Delete', { key, bucket });
      return { deleted: true };
    }
    // Versioned (or suspended): add a delete marker and keep older versions.
    const now = this.now();
    for (const v of versions) {
      if (b.versioning === 'Suspended' && v.versionId === 'null') { await this._removeVersion(v); continue; }
      if (v.isLatest) { v.isLatest = false; v.noncurrentSince = now; await this._put('objects', v); }
    }
    const vid = b.versioning === 'Enabled' ? randId(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._') : 'null';
    const marker = {
      id: this._objId(bucket, key, vid), bucket, key, versionId: vid, seq: performance.now() + Math.random(),
      isLatest: true, isDeleteMarker: true, size: 0, storageClass: 'STANDARD', lastModified: now, uploadedBy: this.source
    };
    await this._put('objects', marker);
    await this._log({ api: 'DeleteObject', ...ctx, versionId: vid, note: 'delete marker' });
    await this._notify(b, 'ObjectRemoved:DeleteMarkerCreated', marker);
    return { deleteMarker: true, versionId: vid };
  }

  async deleteObjects(bucket, keys) {
    const out = [];
    for (const k of keys) {
      try { out.push({ key: k.key || k, ...(await this.deleteObject(bucket, k.key || k, { versionId: k.versionId })) }); }
      catch (e) { out.push({ key: k.key || k, error: e.code }); }
    }
    return out;
  }

  async copyObject(srcBucket, srcKey, dstBucket, dstKey, opts = {}) {
    const src = await this.getObject(srcBucket, srcKey, { versionId: opts.versionId });
    return this.putObject(dstBucket, dstKey, src.body, {
      api: 'CopyObject',
      contentType: src.meta.contentType,
      storageClass: opts.storageClass || src.meta.storageClass,
      metadata: opts.metadata || src.meta.metadata,
      tags: src.meta.tags
    });
  }

  async putObjectTagging(bucket, key, tags) {
    const o = await this._findVersion(bucket, key);
    if (!o || o.isDeleteMarker) throw new S3Error('NoSuchKey', 'The specified key does not exist.', 404);
    o.tags = tags;
    await this._put('objects', o);
    await this._log({ api: 'PutObjectTagging', bucket, key });
  }

  async restoreObject(bucket, key, { days = 7, versionId } = {}) {
    const ctx = { bucket, key };
    const o = await this._findVersion(bucket, key, versionId);
    if (!o || o.isDeleteMarker) return this._fail('RestoreObject', new S3Error('NoSuchKey', 'The specified key does not exist.', 404), ctx);
    const cls = STORAGE_CLASSES[o.storageClass];
    if (!cls.archived) return this._fail('RestoreObject', new S3Error('InvalidObjectState', `Restore is only needed for archived storage classes, and this object is in ${cls.label}.`, 403), ctx);
    const readyAt = this.now() + cls.restoreHours * 3600000;
    o.restore = { requestedAt: this.now(), readyAt, expiresAt: readyAt + days * DAY, days };
    await this._put('objects', o);
    await this._log({ api: 'RestoreObject', ...ctx });
    await this._integrateUsage({ retrieval: { cls: o.storageClass, bytes: o.size } });
    this._emit({ type: 'object', bucket, key });
    return o.restore;
  }

  async listObjectsV2(bucket, { prefix = '', delimiter = '/', maxKeys = 1000, log = true } = {}) {
    const ctx = { bucket, key: prefix || undefined };
    try { await this.getBucket(bucket); } catch (e) { return this._fail('ListObjectsV2', e, ctx); }
    const all = (await this._byIndex('objects', 'bucket', bucket)).filter(o => o.isLatest && !o.isDeleteMarker && o.key.startsWith(prefix));
    const contents = [];
    const prefixes = new Set();
    for (const o of all.sort((a, b) => a.key < b.key ? -1 : 1)) {
      const rest = o.key.slice(prefix.length);
      const idx = delimiter ? rest.indexOf(delimiter) : -1;
      if (idx >= 0) prefixes.add(prefix + rest.slice(0, idx + 1));
      else contents.push({ ...o, restoreStatus: this._restoreStatus(o) });
    }
    if (log) await this._log({ api: 'ListObjectsV2', ...ctx });
    return { contents: contents.slice(0, maxKeys), commonPrefixes: [...prefixes].sort(), keyCount: contents.length + prefixes.size, isTruncated: contents.length > maxKeys };
  }

  async listObjectVersions(bucket, { prefix = '', log = true } = {}) {
    try { await this.getBucket(bucket); } catch (e) { return this._fail('ListObjectVersions', e, { bucket }); }
    const all = (await this._byIndex('objects', 'bucket', bucket)).filter(o => o.key.startsWith(prefix));
    if (log) await this._log({ api: 'ListObjectVersions', bucket, key: prefix || undefined });
    return all.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : b.lastModified - a.lastModified)
      .map(o => ({ ...o, restoreStatus: this._restoreStatus(o) }));
  }

  async bucketStats(bucket) {
    const all = await this._byIndex('objects', 'bucket', bucket);
    const s = { objects: 0, versions: all.length, bytes: 0, deleteMarkers: 0, byClass: {} };
    for (const o of all) {
      if (o.isDeleteMarker) { s.deleteMarkers++; continue; }
      if (o.isLatest) s.objects++;
      s.bytes += o.size;
      s.byClass[o.storageClass] = (s.byClass[o.storageClass] || 0) + o.size;
    }
    return s;
  }

  async accountStats() {
    const buckets = await this._all('buckets');
    const all = await this._all('objects');
    const s = { buckets: buckets.length, objects: 0, versions: 0, bytes: 0, byClass: {}, byBucket: {} };
    for (const o of all) {
      if (o.isDeleteMarker) continue;
      s.versions++;
      if (o.isLatest) s.objects++;
      s.bytes += o.size;
      s.byClass[o.storageClass] = (s.byClass[o.storageClass] || 0) + o.size;
      s.byBucket[o.bucket] = (s.byBucket[o.bucket] || 0) + o.size;
    }
    return s;
  }

  // ---------- lifecycle ----------
  async runLifecycle() {
    const buckets = await this._all('buckets');
    const now = this.now();
    const changes = [];
    const prev = this.source;
    this.source = 'lifecycle';
    try {
      for (const b of buckets) {
        const rules = (b.lifecycle || []).filter(r => r.status !== 'Disabled');
        if (!rules.length) continue;
        const objs = await this._byIndex('objects', 'bucket', b.name);
        for (const o of objs) {
          const rule = rules.find(r => o.key.startsWith(r.prefix || ''));
          if (!rule || o.isDeleteMarker) continue;
          if (!o.isLatest) {
            if (rule.noncurrentExpirationDays && o.noncurrentSince && now - o.noncurrentSince >= rule.noncurrentExpirationDays * DAY) {
              await this._removeVersion(o);
              await this._log({ api: 'LifecycleExpiration', bucket: b.name, key: o.key, versionId: o.versionId, note: `noncurrent version expired by rule ${rule.id}` });
              changes.push({ bucket: b.name, key: o.key, action: 'expired-noncurrent' });
            }
            continue;
          }
          const age = (now - o.lastModified) / DAY;
          if (rule.expirationDays && age >= rule.expirationDays) {
            await this.deleteObject(b.name, o.key);
            changes.push({ bucket: b.name, key: o.key, action: 'expired' });
            continue;
          }
          const due = (rule.transitions || []).filter(t => age >= t.days).sort((a, b) => b.days - a.days)[0];
          if (due && due.storageClass !== o.storageClass && classRank(due.storageClass) > classRank(o.storageClass)) {
            await this._integrateUsage({ bytes: { [o.storageClass]: -o.size, [due.storageClass]: o.size } });
            const from = o.storageClass;
            o.storageClass = due.storageClass;
            o.transitionedAt = now;
            await this._put('objects', o);
            await this._log({ api: 'LifecycleTransition', bucket: b.name, key: o.key, note: `${from} → ${due.storageClass} (rule ${rule.id})` });
            changes.push({ bucket: b.name, key: o.key, action: 'transition', from, to: due.storageClass });
          }
        }
      }
    } finally { this.source = prev; }
    if (changes.length) this._emit({ type: 'lifecycle', changes });
    return changes;
  }

  // ---------- notifications ----------
  async _notify(bucket, eventName, obj) {
    const event = {
      eventVersion: '2.1', eventSource: 'aws:s3', awsRegion: bucket.region,
      eventTime: new Date(this.now()).toISOString(), eventName,
      userIdentity: { principalId: this.source },
      s3: { bucket: { name: bucket.name, arn: `arn:aws:s3:::${bucket.name}` }, object: { key: obj.key, size: obj.size, eTag: obj.etag?.replace(/"/g, ''), versionId: obj.versionId } }
    };
    this._emit({ type: 'object', eventName, bucket: bucket.name, key: obj.key, size: obj.size, source: this.source, event });
    for (const cfg of bucket.notifications || []) {
      const matchesEvent = (cfg.events || []).some(e => {
        const pattern = e.replace(/^s3:/, '');
        return pattern.endsWith('*') ? eventName.startsWith(pattern.slice(0, -1)) : pattern === eventName;
      });
      if (!matchesEvent) continue;
      if (cfg.prefix && !obj.key.startsWith(cfg.prefix)) continue;
      if (cfg.suffix && !obj.key.endsWith(cfg.suffix)) continue;
      const fn = this.functions.get(cfg.target);
      this._emit({ type: 'notification', target: cfg.target, id: cfg.id, event });
      if (fn) {
        const prev = this.source;
        this.source = `function:${cfg.target}`;
        try { await fn({ Records: [event] }, this); }
        catch (e) { console.warn('Notification target failed', cfg.target, e); }
        finally { this.source = prev; }
      }
    }
  }

  // ---------- access: public URLs and presigned URLs ----------
  objectUrl(bucket, key) {
    return new URL(`view.html?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`, location.href).href;
  }
  s3Url(bucket, key, region) {
    return `https://${bucket}.s3.${region || DEFAULT_REGION}.amazonaws.com/${uriEncode(key, true)}`;
  }

  async _signingKey(dateStamp, region) {
    const kDate = await hmac('AWS4' + this.meta.account.secretAccessKey, dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, 's3');
    return hmac(kService, 'aws4_request');
  }

  async _presignParts(bucket, key, region, date, expires) {
    const dateStamp = date.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const q = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.meta.account.accessKeyId}/${scope}`,
      'X-Amz-Date': date,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'host'
    };
    const canonicalQuery = Object.keys(q).sort().map(k => `${uriEncode(k)}=${uriEncode(q[k])}`).join('&');
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const canonicalRequest = ['GET', '/' + uriEncode(key, true), canonicalQuery, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256hex(canonicalRequest)].join('\n');
    const signature = hex(await hmac(await this._signingKey(dateStamp, region), stringToSign));
    return { q, signature, canonicalRequest, stringToSign, host };
  }

  async presign(bucket, key, expiresIn = 3600) {
    const b = await this.getBucket(bucket);
    if (expiresIn < 1 || expiresIn > 604800) throw new S3Error('AuthorizationQueryParametersError', 'X-Amz-Expires must be between 1 second and 7 days (604800 seconds).');
    const date = amzDate(this.now());
    const { q, signature, canonicalRequest, stringToSign, host } = await this._presignParts(bucket, key, b.region, date, expiresIn);
    const qs = new URLSearchParams({ ...q, 'X-Amz-Signature': signature }).toString();
    await this._log({ api: 'GeneratePresignedUrl', bucket, key, note: `expires in ${expiresIn}s` });
    return {
      url: `${this.objectUrl(bucket, key)}&${qs}`,
      awsStyleUrl: `https://${host}/${uriEncode(key, true)}?${qs}`,
      expiresAt: this.now() + expiresIn * 1000,
      canonicalRequest, stringToSign, signature
    };
  }

  /** Called by the endpoint emulator (view.html). */
  async authorizeGet(params) {
    const bucket = params.get('bucket');
    const key = params.get('key');
    const b = await this.getBucket(bucket);
    if (params.has('X-Amz-Signature')) {
      const date = params.get('X-Amz-Date') || '';
      const expires = Number(params.get('X-Amz-Expires'));
      const cred = (params.get('X-Amz-Credential') || '').split('/');
      if (cred[0] !== this.meta.account.accessKeyId) throw new S3Error('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.', 403);
      const { signature } = await this._presignParts(bucket, key, cred[2] || b.region, date, expires);
      if (signature !== params.get('X-Amz-Signature')) throw new S3Error('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided.', 403);
      const signedAt = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +date.slice(9, 11), +date.slice(11, 13), +date.slice(13, 15));
      if (this.now() > signedAt + expires * 1000) throw new S3Error('AccessDenied', 'Request has expired', 403);
      return 'presigned';
    }
    if (b.blockPublicAccess) throw new S3Error('AccessDenied', 'Access Denied (Block Public Access is enabled on this bucket)', 403);
    const decision = evaluatePolicy(b.policy ? JSON.parse(b.policy) : null, { action: 's3:GetObject', resource: `arn:aws:s3:::${bucket}/${key}` });
    if (decision !== 'Allow') throw new S3Error('AccessDenied', 'Access Denied', 403);
    return 'public';
  }

  // ---------- billing ----------
  async billing(month) {
    const u = await this._integrateUsage();
    const settings = await this.getBillingSettings();
    const { DEFAULT_PRICES, FREE_TIER, GB } = await import('./pricing.js');
    const prices = { ...DEFAULT_PRICES, ...(settings.prices || {}), storage: { ...DEFAULT_PRICES.storage, ...(settings.prices?.storage || {}) } };
    const mk = month || monthKey(this.now());
    const m = u.months[mk] || this._emptyMonth();
    const lines = [];
    let storageGBMonthStd = 0;
    for (const cls of Object.keys(STORAGE_CLASSES)) {
      const gbMonths = (m.byteMs[cls] || 0) / GB / MONTH_MS;
      if (cls === 'STANDARD') storageGBMonthStd = gbMonths;
      let billable = gbMonths;
      if (cls === 'STANDARD' && settings.freeTier) billable = Math.max(0, gbMonths - FREE_TIER.standardGB);
      lines.push({ group: 'Storage', item: STORAGE_CLASSES[cls].label, cls, quantity: gbMonths, unit: 'GB-Mo', rate: prices.storage[cls], cost: billable * prices.storage[cls] });
    }
    const putBillable = settings.freeTier ? Math.max(0, m.putRequests - FREE_TIER.putRequests) : m.putRequests;
    const getBillable = settings.freeTier ? Math.max(0, m.getRequests - FREE_TIER.getRequests) : m.getRequests;
    lines.push({ group: 'Requests', item: 'PUT, COPY, POST, LIST requests', quantity: m.putRequests, unit: 'requests', rate: prices.putPer1k, cost: putBillable / 1000 * prices.putPer1k });
    lines.push({ group: 'Requests', item: 'GET, SELECT and all other requests', quantity: m.getRequests, unit: 'requests', rate: prices.getPer1k, cost: getBillable / 1000 * prices.getPer1k });
    for (const [cls, bytes] of Object.entries(m.retrieval)) {
      const gb = bytes / GB;
      lines.push({ group: 'Retrieval', item: `${STORAGE_CLASSES[cls].label} retrieval`, cls, quantity: gb, unit: 'GB', rate: STORAGE_CLASSES[cls].retrieval, cost: gb * STORAGE_CLASSES[cls].retrieval });
    }
    const outGB = m.transferOut / GB;
    const outBillable = settings.freeTier ? Math.max(0, outGB - FREE_TIER.transferOutGB) : outGB;
    lines.push({ group: 'Data transfer', item: 'Data transfer out to the internet', quantity: outGB, unit: 'GB', rate: prices.transferOutPerGB, cost: outBillable * prices.transferOutPerGB });
    const total = lines.reduce((s, l) => s + l.cost, 0);

    // Forecast: current storage run-rate + request rate so far this month.
    const now = this.now();
    const d = new Date(now);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const elapsed = Math.max(1, now - monthStart);
    const remaining = monthEnd - now;
    let storageRunRate = 0;
    for (const [cls, bytes] of Object.entries(u.current)) storageRunRate += bytes / GB / MONTH_MS * prices.storage[cls];
    const reqSoFar = lines.filter(l => l.group === 'Requests').reduce((s, l) => s + l.cost, 0);
    const forecast = mk === monthKey(now) ? total + storageRunRate * remaining + reqSoFar / elapsed * remaining : total;

    return {
      month: mk, lines, total, forecast, prices, settings,
      requests: { put: m.putRequests, get: m.getRequests, api: m.api },
      freeTierUse: { standardGB: storageGBMonthStd, put: m.putRequests, get: m.getRequests, transferOutGB: outGB },
      months: Object.keys(u.months).sort(),
      currentBytes: u.current
    };
  }

  async resetAccount() {
    this.db.close();
    await req(indexedDB.deleteDatabase(DB_NAME));
    this._emit({ type: 'reset' });
    location.reload();
  }
}

function classRank(c) { return ['STANDARD', 'STANDARD_IA', 'GLACIER_IR', 'GLACIER', 'DEEP_ARCHIVE'].indexOf(c); }

export const s3 = new S3Engine();

// "Lambda-style" function: summarises every flight log written under logs/
// and keeps an index object the console and simulator read for replays.
s3.registerFunction('flight-indexer', async (event, engine) => {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = rec.s3.object.key;
    if (!key.endsWith('.json') || !rec.eventName.startsWith('ObjectCreated')) continue;
    let log;
    try { log = JSON.parse(await engine.getObjectText(bucket, key)); } catch { continue; }
    let index = [];
    try { index = JSON.parse(await engine.getObjectText(bucket, 'analytics/flight-index.json')); } catch { /* first run */ }
    index = index.filter(f => f.key !== key);
    index.unshift({
      key, flightId: log.flightId, startedAt: log.startedAt, durationS: log.durationS,
      control: log.control, distanceM: log.stats?.distanceM, maxAltM: log.stats?.maxAltM,
      maxSpeed: log.stats?.maxSpeed, crashed: !!log.crashed, samples: log.samples?.length || 0
    });
    await engine.putObject(bucket, 'analytics/flight-index.json', JSON.stringify(index.slice(0, 200), null, 2), { contentType: 'application/json' });
  }
});
