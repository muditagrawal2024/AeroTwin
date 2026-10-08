// First-run data: sample missions and a demo flight for the logbook.

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
  'Survey square': missionXml([
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
  'Tower orbit': missionXml([
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
  'Smoke spiral': missionXml([
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
  'Keyboard steered': missionXml([
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
  'Photo patrol': missionXml([
    blk('take_off'),
    blk('set_speed', { values: { SPEED: 5 } }),
    blk('set_altitude', { values: { ALTITUDE: 22 } }),
    blk('controls_repeat_ext', { values: { TIMES: 3 }, statements: { DO: [
      blk('walk', { values: { DIST: 25 } }),
      blk('take_photo'),
      blk('log_message', { raw: { TEXT: text('Waypoint reached, photo saved') } }),
      blk('change_angle', { values: { ANGLE: 120 } })
    ] } }),
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

