// Logbook storage: flights, photos, videos and missions are kept in the
// browser's IndexedDB, so the site works as plain static files on any host.
import { randId } from './util.js';

const DB_NAME = 'aerotwin-logbook';
const STORES = ['flights', 'media', 'missions'];

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

class Store {
  constructor() {
    this.db = null;
    this._ready = null;
    this.listeners = new Set();
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('aerotwin-logbook') : null;
    if (this.channel) this.channel.onmessage = e => this.listeners.forEach(fn => fn({ ...e.data, remote: true }));
  }

  ready() {
    if (!this._ready) this._ready = (async () => {
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (!(await this.count('missions'))) {
        const { SAMPLE_MISSIONS, syntheticFlight } = await import('./seed.js');
        for (const [name, xml] of Object.entries(SAMPLE_MISSIONS)) await this.putMission(name, xml, { sample: true, silent: true });
        await this.addFlight(syntheticFlight(Date.now() - 2 * 86400000, { seconds: 75, seed: 2, label: 'FLT-DEMO' }), { silent: true });
      }
      return this;
    })();
    return this._ready;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(evt) { this.listeners.forEach(fn => fn(evt)); this.channel?.postMessage(evt); }

  _os(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); }
  count(store) { return req(this._os(store).count()); }
  all(store) { return req(this._os(store).getAll()); }
  get(store, id) { return req(this._os(store).get(id)); }
  async put(store, value) { await req(this._os(store, 'readwrite').put(value)); return value; }
  async remove(store, id) { await req(this._os(store, 'readwrite').delete(id)); this._emit({ type: store, action: 'deleted', id }); }

  // ----- flights -----
  async addFlight(log, { silent } = {}) {
    const rec = { id: log.flightId || 'FLT-' + randId(8), savedAt: Date.now(), log, size: JSON.stringify(log).length };
    await this.put('flights', rec);
    if (!silent) this._emit({ type: 'flights', action: 'added', id: rec.id });
    return rec;
  }
  async listFlights() {
    const all = await this.all('flights');
    return all.map(f => ({ id: f.id, savedAt: f.savedAt, size: f.size, ...summary(f.log) })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async getFlight(id) { return (await this.get('flights', id))?.log; }

  // ----- photos and videos -----
  async addMedia(kind, blob, meta = {}) {
    const rec = { id: `${kind === 'photo' ? 'IMG' : 'VID'}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randId(4)}`, kind, blob, type: blob.type, size: blob.size, createdAt: Date.now(), meta };
    await this.put('media', rec);
    this._emit({ type: 'media', action: 'added', id: rec.id });
    return rec;
  }
  async listMedia() { return (await this.all('media')).sort((a, b) => b.createdAt - a.createdAt); }

  // ----- missions (each save keeps the previous versions) -----
  async putMission(name, xml, { sample = false, silent = false } = {}) {
    const prev = await this.get('missions', name);
    const versions = prev ? [...prev.versions, { xml: prev.xml, savedAt: prev.savedAt }].slice(-20) : [];
    const rec = { id: name, xml, savedAt: Date.now(), sample, versions };
    await this.put('missions', rec);
    if (!silent) this._emit({ type: 'missions', action: 'saved', id: name });
    return rec;
  }
  async listMissions() { return (await this.all('missions')).sort((a, b) => (a.sample === b.sample ? a.id.localeCompare(b.id) : a.sample ? 1 : -1)); }
  async getMission(name) { return this.get('missions', name); }

  async usage() {
    const [f, m, s] = await Promise.all(['flights', 'media', 'missions'].map(x => this.all(x)));
    return { flights: f.length, media: m.length, missions: s.length, bytes: f.reduce((a, x) => a + x.size, 0) + m.reduce((a, x) => a + x.size, 0) + s.reduce((a, x) => a + x.xml.length, 0) };
  }
}

export function summary(log) {
  return {
    flightId: log.flightId, startedAt: log.startedAt, durationS: log.durationS, control: log.control || [],
    distanceM: log.stats?.distanceM || 0, maxAltM: log.stats?.maxAltM || 0, maxSpeed: log.stats?.maxSpeed || 0,
    crashed: !!log.crashed, rings: log.stats?.ringsPassed || 0, photos: log.stats?.photos || 0, samples: log.samples?.length || 0
  };
}

export const store = new Store();
