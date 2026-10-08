// First-run data: the buckets, rules and sample objects a new AeroTwin
// account starts with, so every S3 feature has something to show.
import { publicReadPolicy } from './policy.js';

const DAY = 86400000;

// --- tiny Blockly XML builder used for the sample missions ---
const num = n => `<shadow type="math_number"><field name="NUM">${n}</field></shadow>`;
function blk(type, { values = {}, fields = {}, statements = {}, raw = {} } = {}) {
  return { type, values, fields, statements, raw };
}
function render(b) {
  let s = `<block type="${b.type}">`;
  for (const [k, v] of Object.entries(b.fields)) s += `<field name="${k}">${v}</field>`;
  for (const [k, v] of Object.entries(b.values)) s += `<value name="${k}">${typeof v === 'number' ? num(v) : renderChain([v])}</value>`;
  for (const [k, v] of Object.entries(b.raw)) s += `<value name="${k}">${v}</value>`;
  for (const [k, v] of Object.entries(b.statements)) s += `<statement name="${k}">${renderChain(v)}</statement>`;
  return s;
}
function renderChain(list) {
  if (!list.length) return '';
  const [first, ...rest] = list;
  return render(first) + (rest.length ? `<next>${renderChain(rest)}</next>` : '') + '</block>';
}
export function missionXml(chain) {
  return `<xml xmlns="https://developers.google.com/blockly/xml"><block type="start_block" x="24" y="24"><next>${renderChain(chain)}</next></block></xml>`;
}
const bool = v => `<block type="logic_boolean"><field name="BOOL">${v ? 'TRUE' : 'FALSE'}</field></block>`;
const key = k => `<block type="sensor_keypressed"><field name="KEY">${k}</field></block>`;
const text = t => `<shadow type="text"><field name="TEXT">${t}</field></shadow>`;

export const SAMPLE_MISSIONS = {
  'samples/survey-square.xml': missionXml([
    blk('take_off'),
    blk('set_speed', { values: { SPEED: 4 } }),
    blk('set_altitude', { values: { ALTITUDE: 18 } }),
    blk('controls_repeat_ext', { values: { TIMES: 4 }, statements: { DO: [
      blk('walk', { values: { DIST: 30 } }),
      blk('take_photo'),
      blk('change_angle', { values: { ANGLE: 90 } })
    ] } }),
    blk('return_to_base'),
    blk('land')
  ]),
  'samples/tower-orbit.xml': missionXml([
    blk('take_off'),
    blk('set_speed', { values: { SPEED: 6 } }),
    blk('go_to', { values: { X: 40, Y: 32, Z: 52 } }),
    blk('smoke', { raw: { SMOKE: bool(true) } }),
    blk('orbit_poi', { values: { X: 40, Z: 80, DEG: 360 } }),
    blk('smoke', { raw: { SMOKE: bool(false) } }),
    blk('take_photo'),
    blk('return_to_base'),
    blk('land')
  ]),
  'samples/smoke-spiral.xml': missionXml([
    blk('take_off'),
    blk('set_speed', { values: { SPEED: 5 } }),
    blk('smoke', { raw: { SMOKE: bool(true) } }),
    blk('controls_repeat_ext', { values: { TIMES: 24 }, statements: { DO: [
      blk('walk_climbing', { values: { DIST: 6, CLIMB: 1 } }),
      blk('change_angle', { values: { ANGLE: 30 } })
    ] } }),
    blk('smoke', { raw: { SMOKE: bool(false) } }),
    blk('return_to_base'),
    blk('land')
  ]),
  'samples/keyboard-steered.xml': missionXml([
    blk('take_off'),
    blk('log_message', { raw: { TEXT: text('Steer with I J K L, climb with U, finish with Q') } }),
    blk('controls_whileUntil', {
      fields: { MODE: 'UNTIL' },
      raw: { BOOL: key('Q') },
      statements: { DO: [
        blk('controls_if', {
          raw: { IF0: key('I') },
          statements: { DO0: [blk('walk', { values: { DIST: 2 } })] }
        }),
        blk('controls_if', {
          raw: { IF0: key('J') },
          statements: { DO0: [blk('change_angle', { values: { ANGLE: -15 } })] }
        }),
        blk('controls_if', {
          raw: { IF0: key('L') },
          statements: { DO0: [blk('change_angle', { values: { ANGLE: 15 } })] }
        }),
        blk('controls_if', {
          raw: { IF0: key('K') },
          statements: { DO0: [blk('walk', { values: { DIST: -2 } })] }
        }),
        blk('controls_if', {
          raw: { IF0: key('U') },
          statements: { DO0: [blk('change_altitude', { values: { ALTITUDE: 2 } })] }
        })
      ] }
    }),
    blk('return_to_base'),
    blk('land')
  ]),
  'samples/s3-data-run.xml': missionXml([
    blk('take_off'),
    blk('set_speed', { values: { SPEED: 5 } }),
    blk('set_altitude', { values: { ALTITUDE: 22 } }),
    blk('controls_repeat_ext', { values: { TIMES: 3 }, statements: { DO: [
      blk('walk', { values: { DIST: 25 } }),
      blk('take_photo'),
      blk('s3_put_note', { raw: { KEY: text('notes/waypoint.txt'), TEXT: text('Waypoint reached, photo captured') } }),
      blk('change_angle', { values: { ANGLE: 120 } })
    ] } }),
    blk('upload_flight_log'),
    blk('return_to_base'),
    blk('land')
  ])
};

// A synthetic figure-eight flight used as sample telemetry.
export function syntheticFlight(startedAt, { seconds = 90, seed = 1, label = 'FLT-SAMPLE' } = {}) {
  const hz = 10;
  const samples = [];
  let dist = 0, maxAlt = 0, maxSpeed = 0, prev = null;
  for (let i = 0; i <= seconds * hz; i++) {
    const t = i / hz;
    const ramp = Math.min(1, t / 6) * Math.min(1, (seconds - t) / 6);
    const a = t / seconds * Math.PI * 2;
    const x = Math.sin(a) * 45 * ramp;
    const z = Math.sin(a * 2) * 22 * ramp;
    const y = 0.2 + ramp * (12 + 4 * Math.sin(a * 3 + seed));
    let speed = 0, heading = 0;
    if (prev) {
      const dx = x - prev[1], dz = z - prev[3], dy = y - prev[2];
      const d = Math.hypot(dx, dy, dz);
      dist += d; speed = d * hz;
      heading = ((Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360;
    }
    maxAlt = Math.max(maxAlt, y); maxSpeed = Math.max(maxSpeed, speed);
    const row = [+t.toFixed(1), +x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +heading.toFixed(1), +speed.toFixed(2),
      +(0.5 * ramp).toFixed(2), 0, +(0.4 * ramp).toFixed(2), +(0.2 * Math.cos(a)).toFixed(2), +(100 - t / seconds * 18).toFixed(1)];
    samples.push(row);
    prev = row;
  }
  return {
    format: 'aerotwin-flight-log/1',
    flightId: label,
    callsign: 'AT-01',
    startedAt: new Date(startedAt).toISOString(),
    durationS: seconds,
    control: ['keyboard'],
    world: 'aerotwin-district',
    sampleRateHz: hz,
    columns: ['t', 'x', 'y', 'z', 'heading', 'speed', 'throttle', 'yaw', 'pitch', 'roll', 'battery'],
    coordinateNote: 'x = east, z = north, y = altitude (metres); heading in degrees clockwise from north',
    samples,
    events: [{ t: 0, type: 'takeoff' }, { t: seconds, type: 'landed' }],
    stats: { distanceM: +dist.toFixed(1), maxAltM: +maxAlt.toFixed(1), maxSpeed: +maxSpeed.toFixed(2), batteryUsedPct: 18 },
    crashed: false
  };
}


const droneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="480" height="320">
<rect width="240" height="160" fill="#14273a"/>
<g stroke="#ff7a1a" stroke-width="5" stroke-linecap="round"><line x1="70" y1="50" x2="170" y2="110"/><line x1="170" y1="50" x2="70" y2="110"/></g>
<g fill="none" stroke="#9fc3dc" stroke-width="3"><ellipse cx="70" cy="50" rx="30" ry="7"/><ellipse cx="170" cy="50" rx="30" ry="7"/><ellipse cx="70" cy="110" rx="30" ry="7"/><ellipse cx="170" cy="110" rx="30" ry="7"/></g>
<rect x="100" y="66" width="40" height="28" rx="8" fill="#e8eef4"/><circle cx="120" cy="80" r="6" fill="#14273a"/>
</svg>`;

// Creates any of the four AeroTwin buckets that are missing. Safe to call on
// every page load: existing buckets (and anything the user changed) are untouched.
export async function ensureBuckets(s3) {
  const fresh = {};
  const ensure = async (name, opts) => { fresh[name] = !(await s3.headBucket(name)); if (fresh[name]) await s3.createBucket(name, opts); };
  const logs = 'aerotwin-flight-logs';
  const media = 'aerotwin-drone-media';
  const missions = 'aerotwin-missions';
  const gallery = 'aerotwin-public-gallery';
  await ensure(logs, {
    versioning: 'Enabled',
    tags: { project: 'AeroTwin', data: 'telemetry' },
    lifecycle: [{
      id: 'tier-flight-logs', status: 'Enabled', prefix: 'logs/',
      transitions: [{ days: 30, storageClass: 'STANDARD_IA' }, { days: 90, storageClass: 'GLACIER' }],
      expirationDays: 365, noncurrentExpirationDays: 30
    }],
    notifications: [{ id: 'index-new-flights', events: ['s3:ObjectCreated:*'], prefix: 'logs/', suffix: '.json', target: 'flight-indexer' }]
  });
  await ensure(media, {
    tags: { project: 'AeroTwin', data: 'camera' },
    lifecycle: [{
      id: 'archive-raw-video', status: 'Enabled', prefix: 'videos/',
      transitions: [{ days: 30, storageClass: 'STANDARD_IA' }, { days: 180, storageClass: 'DEEP_ARCHIVE' }]
    }]
  });
  await ensure(missions, { versioning: 'Enabled', tags: { project: 'AeroTwin', data: 'missions' } });
  await ensure(gallery, { blockPublicAccess: false, tags: { project: 'AeroTwin', access: 'public' } });
  if (fresh[gallery]) await s3.putBucketPolicy(gallery, publicReadPolicy(gallery, 'shared/'));
  return fresh;
}

export async function seed(s3) {
  // Idempotent: if an earlier page load was interrupted part-way through
  // seeding, only the missing buckets (and their sample objects) are created.
  const now = s3.now();
  const has = async (b, k) => !!(await s3._findVersion(b, k));
  const logs = 'aerotwin-flight-logs';
  const missions = 'aerotwin-missions';
  const gallery = 'aerotwin-public-gallery';
  await ensureBuckets(s3);

  for (const [k, xml] of Object.entries(SAMPLE_MISSIONS)) {
    if (await has(missions, k)) continue;
    await s3.putObject(missions, k, xml, { contentType: 'application/xml', metadata: { 'x-amz-meta-author': 'aerotwin' } });
  }

  const flights = [
    { daysAgo: 120, seconds: 70, seed: 3 },
    { daysAgo: 45, seconds: 90, seed: 1 },
    { daysAgo: 2, seconds: 60, seed: 2 }
  ];
  for (const f of flights) {
    const started = now - f.daysAgo * DAY;
    const d = new Date(started).toISOString();
    const id = `FLT-${d.slice(0, 10).replace(/-/g, '')}-S${f.seed}`;
    const key = `logs/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/${id}.json`;
    if (await has(logs, key)) continue;
    const log = syntheticFlight(started, { ...f, label: id });
    await s3.putObject(logs, key, JSON.stringify(log), {
      contentType: 'application/json', lastModified: started + f.seconds * 1000,
      metadata: { 'x-amz-meta-callsign': 'AT-01', 'x-amz-meta-control': 'keyboard' }
    });
  }

  if (!(await has(gallery, 'shared/aerotwin-drone.svg'))) await s3.putObject(gallery, 'shared/aerotwin-drone.svg', droneSvg, { contentType: 'image/svg+xml' });
  if (!(await has(gallery, 'shared/readme.txt'))) await s3.putObject(gallery, 'shared/readme.txt', 'Objects under shared/ are readable by anyone because of the bucket policy.\nEverything else in this bucket stays private.\n', { contentType: 'text/plain' });
  if (!(await has(gallery, 'private/owner-notes.txt'))) await s3.putObject(gallery, 'private/owner-notes.txt', 'This object is outside shared/, so the public URL returns AccessDenied.\n', { contentType: 'text/plain' });
}
