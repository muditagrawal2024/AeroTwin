// Flight data recorder: samples telemetry at 10 Hz while airborne and saves
// each flight as a JSON log in the logbook.
import { store } from '../core/store.js';

const HZ = 10;

const stamp = ms => {
  const d = new Date(ms).toISOString();
  return { y: d.slice(0, 4), m: d.slice(5, 7), d: d.slice(8, 10), compact: d.slice(0, 19).replace(/[-:]/g, '').replace('T', '-') };
};

export class Recorder {
  constructor() { this.active = null; this.acc = 0; }

  start(callsign) {
    const now = Date.now();
    this.active = {
      flightId: `FLT-${stamp(now).compact}`,
      callsign, startedAtMs: now, t: 0,
      samples: [], events: [], control: new Set(), distance: 0, maxAlt: 0, maxSpeed: 0, batteryStart: null, last: null,
      rings: 0, photos: 0
    };
    this.acc = 0;
    this.event('takeoff');
  }

  get flying() { return !!this.active; }
  get elapsed() { return this.active ? this.active.t : 0; }

  event(type, extra = {}) { if (this.active) this.active.events.push({ t: +this.elapsed.toFixed(2), type, ...extra }); }
  markControl(src) { if (this.active && src) this.active.control.add(src); }

  sample(dt, f, sticks) {
    const a = this.active;
    if (!a) return;
    if (a.batteryStart === null) a.batteryStart = f.battery;
    a.t += dt;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    const row = [+this.elapsed.toFixed(2), +f.pos.x.toFixed(2), +f.pos.y.toFixed(2), +(-f.pos.z).toFixed(2), +f.heading.toFixed(1), +f.speedTotal.toFixed(2),
      +sticks.throttle.toFixed(2), +sticks.yaw.toFixed(2), +sticks.pitch.toFixed(2), +sticks.roll.toFixed(2), +f.battery.toFixed(1)];
    if (a.last) a.distance += Math.hypot(row[1] - a.last[1], row[2] - a.last[2], row[3] - a.last[3]);
    a.maxAlt = Math.max(a.maxAlt, row[2]);
    a.maxSpeed = Math.max(a.maxSpeed, row[5]);
    a.samples.push(row);
    a.last = row;
  }

  build(final, { crashed = false, reason } = {}) {
    const a = this.active;
    const last = a.samples[a.samples.length - 1];
    return {
      format: 'aerotwin-flight-log/1',
      flightId: a.flightId,
      callsign: a.callsign,
      startedAt: new Date(a.startedAtMs).toISOString(),
      durationS: +this.elapsed.toFixed(1),
      control: [...a.control],
      world: 'aerotwin-district',
      sampleRateHz: HZ,
      columns: ['t', 'x', 'y', 'z', 'heading', 'speed', 'throttle', 'yaw', 'pitch', 'roll', 'battery'],
      coordinateNote: 'x = east, z = north, y = altitude (metres); heading in degrees clockwise from north',
      samples: a.samples,
      events: a.events,
      stats: {
        distanceM: +a.distance.toFixed(1), maxAltM: +a.maxAlt.toFixed(1), maxSpeed: +a.maxSpeed.toFixed(2),
        batteryUsedPct: +((a.batteryStart ?? 100) - (last ? last[10] : 100)).toFixed(1),
        ringsPassed: a.rings, photos: a.photos
      },
      crashed, endReason: reason || (crashed ? 'crash' : 'landed'), final
    };
  }

  /** Save the log to the logbook and end the flight. */
  async save({ crashed = false, reason } = {}) {
    if (!this.active) return null;
    if (!this.active.samples.length) { this.active = null; return null; }
    const log = this.build(true, { crashed, reason });
    this.active = null;
    return store.addFlight(log);
  }
}
