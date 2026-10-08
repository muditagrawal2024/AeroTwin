// AeroTwin flight simulator: ties together the world, flight model,
// keyboard/gamepad input, Blockly missions, HUD and the logbook.
import { store } from '../core/store.js';
import { h, fmtBytes, download } from '../core/util.js';
import { topbar, toast } from '../core/ui.js';
import { buildWorld, toWorld } from './world.js';
import { createDrone } from './drone-model.js';
import { FlightModel } from './flight.js';
import { InputManager } from './input.js';
import { Autopilot } from './autopilot.js';
import { MissionEditor, EMPTY_MISSION } from './mission.js';
import { Recorder } from './recorder.js';
import { MotorAudio } from './audio.js';

const THREE = window.THREE;
const DEG = Math.PI / 180;
const $ = id => document.getElementById(id);

// ---------------- settings (per-viewer convenience) ----------------
const DEFAULTS = { callsign: 'AT-01', stickMode: 2, deadzone: 0.1, expo: 0.3, invertPitch: false, sport: false, wind: false, autoUpload: true, volume: 0.5, sound: true, shadows: true, helpSeen: false };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('aerotwin.sim') || '{}') }; } catch { /* storage unavailable */ }
const saveSettings = () => { try { localStorage.setItem('aerotwin.sim', JSON.stringify(settings)); } catch { /* ignore */ } };

$('top').replaceWith(topbar({ active: 'sim' }));

// ---------------- renderer and scene ----------------
const canvas = $('view');
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2500);
const gimbalCam = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 1500);

const hemi = new THREE.HemisphereLight(0xdbe9f5, 0x47523c, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
sun.position.set(-80, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
scene.add(sun, sun.target);
scene.fog = new THREE.Fog(0x9cc0da, 160, 900);
scene.background = new THREE.Color(0x9cc0da);

const world = buildWorld(scene);
const drone = createDrone();
scene.add(drone.root);
const ghost = createDrone({ ghost: true });
ghost.root.visible = false;
scene.add(ghost.root);

// smoke trail
const SMOKE_MAX = 8000;
const smokeGeo = new THREE.BufferGeometry();
const smokePos = new Float32Array(SMOKE_MAX * 3);
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
smokeGeo.setDrawRange(0, 0);
const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ size: 1.4, map: smokeTex, transparent: true, depthWrite: false, color: 0xffe2c7, opacity: 0.8 }));
smoke.frustumCulled = false;
scene.add(smoke);
let smokeCount = 0, smokeTimer = 0;

// replay path line
let replayLine = null;

// ---------------- simulation objects ----------------
const flight = new FlightModel(world);
flight.sport = settings.sport;
flight.wind = settings.wind;
flight.reset(new THREE.Vector3(0, 0, 0));
const recorder = new Recorder();
const audio = new MotorAudio();
audio.volume = settings.volume;
audio.muted = !settings.sound;

let control = 'pilot';    // pilot | auto
let autoTask = null;      // takeoff | land | rth | mission | emergency
const kinVel = new THREE.Vector3();
const prevPos = new THREE.Vector3();
let ringIndex = 0, ringStart = 0, lastRingSide = null;
let lowBatteryWarned = false;

const input = new InputManager({
  isFlightFocus: e => {
    const t = e.target;
    if (!t || t === document.body || t === stage || stage.contains(t) && !t.closest('.drawer, .help')) return !(t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    return false;
  }
});
input.mode = settings.stickMode; input.deadzone = settings.deadzone; input.expo = settings.expo; input.invertPitch = settings.invertPitch;

// ---------------- HUD helpers ----------------
function banner(title, sub = '', kind = '', ms = 2200) {
  const b = $('banner');
  b.className = `banner ${kind}`;
  b.replaceChildren(h('b', {}, title), sub ? h('span', {}, sub) : '');
  b.hidden = false;
  clearTimeout(banner.t);
  banner.t = setTimeout(() => { b.hidden = true; }, ms);
}

const saves = [];
function feed(item) {
  saves.unshift(item);
  if (saves.length > 60) saves.pop();
  const el = h('div', { class: `feed-item ${item.ok ? '' : 'err'}` },
    item.ok ? h('a', { href: item.href || 'logbook.html', target: '_blank', rel: 'noopener' },
      h('span', { class: 'ok' }, 'Saved '), item.label, h('div', { class: 'meta' }, item.detail || ''))
      : h('span', {}, `Could not save: ${item.error}`));
  const f = $('feed');
  f.prepend(el);
  while (f.children.length > 3) f.lastElementChild.remove();
  setTimeout(() => el.remove(), 6000);
  if (drawerTab === 'saved' && !$('drawer').hidden) renderDrawer();
}

const logEl = $('missionLog');
function mlog(text, kind = '') {
  logEl.append(h('div', { class: kind }, text));
  while (logEl.children.length > 200) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------------- flight lifecycle hooks ----------------
const autopilot = new Autopilot({
  get flight() { return flight; },
  world,
  hooks: {
    log: (t, k) => mlog(t, k),
    takeoff: () => startFlight(),
    landed: () => endFlight('landed'),
    collision: (hit, safe) => {
      mlog(`Obstacle ahead (${hit.name}). Mission stopped, emergency landing.`, 'error');
      banner('Obstacle detected', `Emergency landing near the ${hit.name}`, 'bad', 3000);
      recorder.event('collision-avoidance', { obstacle: hit.name });
      flight.pos.copy(safe);
      editor?.stop();
      autopilot.cancel();
      setTimeout(() => runAuto('emergency', () => autopilot.land()), 0);
    },
    photo: src => takePhoto(src),
    startRecording: () => startRecording(),
    stopRecording: () => stopRecording(),
  }
});

function startFlight() {
  audio.init();
  flight.state = 'flying';
  flight.groundTime = 0;
  if (!recorder.flying) recorder.start(settings.callsign);
  lowBatteryWarned = false;
}

async function endFlight(reason) {
  flight.state = reason === 'crashed' ? 'crashed' : 'landed';
  flight.vel.set(0, 0, 0);
  if (reason !== 'crashed') { flight.pitch = flight.roll = 0; }
  if (recording) await stopRecording();
  if (recorder.flying) {
    recorder.event(reason);
    if (settings.autoUpload) await saveLog(reason === 'crashed');
    else { recorder.active = null; }
  }
}

async function saveLog(crashed = false) {
  try {
    const r = await recorder.save({ crashed });
    if (r) {
      feed({ ok: true, label: `flight ${r.id}`, detail: `${r.log.durationS} s, ${r.log.stats.distanceM} m flown${crashed ? ', crashed' : ''}`, href: `logbook.html#${encodeURIComponent(r.id)}` });
      toast(crashed ? 'Crash recorded' : 'Flight saved', `${r.id} is in your logbook`, crashed ? 'warn' : 'ok');
    }
    return r;
  } catch (e) { feed({ ok: false, error: e.message }); }
}

async function runAuto(name, fn) {
  autopilot.cancel();
  if (name !== 'mission' && editor?.running) editor.stop();
  autoTask = name; control = 'auto';
  updateState();
  try { await fn(); }
  catch (e) { if (e.name !== 'Cancelled') { console.error(e); mlog(e.message, 'error'); } }
  finally {
    if (autoTask === name) {
      autoTask = null; control = 'pilot';
      flight.vel.copy(kinVel);
      updateState();
    }
  }
}

function pilotOverride() {
  if (control !== 'auto' || autoTask === 'emergency') return;
  if (autoTask === 'mission' && editor?.usesManualSensors()) return;
  if (input.magnitude() < 0.35) return;
  editor?.stop();
  autopilot.cancel();
  autoTask = null; control = 'pilot';
  flight.vel.copy(kinVel);
  recorder.event('pilot-override');
  banner('Pilot override', 'You have the controls');
  updateState();
}

function takeoffOrLand() {
  if (flight.state === 'crashed') { banner('Crashed', 'Press Backspace (or Menu on a gamepad) to reset to the pad', 'bad'); return; }
  if (flight.state === 'landed') runAuto('takeoff', () => autopilot.takeOff());
  else runAuto('land', () => autopilot.land());
}
function returnHome() { if (flight.state === 'flying') runAuto('rth', async () => { await autopilot.returnToBase(); await autopilot.land(); }); }
function resetDrone() {
  if (flight.state === 'flying') return banner('Land first', 'Reset is available on the ground or after a crash');
  autopilot.cancel(); editor?.stop();
  autoTask = null; control = 'pilot';
  flight.reset(new THREE.Vector3(0, 0, 0));
  resetRings();
  smokeCount = 0; smokeGeo.setDrawRange(0, 0);
  banner('Reset', 'Back on the vertiport with a full battery', 'ok');
}
function stopAutomation() {
  if (control === 'auto' && autoTask !== 'emergency') {
    editor?.stop(); autopilot.cancel();
    autoTask = null; control = 'pilot'; flight.vel.copy(kinVel);
    banner('Automation stopped', 'Hovering. You have the controls');
  }
}

// ---------------- camera, photos and video ----------------
const CAMS = ['chase', 'fpv', 'orbit', 'top'];
const CAM_LABEL = { chase: 'Chase', fpv: 'FPV', orbit: 'Orbit', top: 'Top-down' };
let camMode = 'chase';
const orbit = { yaw: 0.6, pitch: 0.35, dist: 14, dragging: false, lx: 0, ly: 0 };
function cycleCamera() {
  camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
  $('camBtn').textContent = CAM_LABEL[camMode];
  drone.root.visible = camMode !== 'fpv';
}
canvas.addEventListener('pointerdown', e => { stage.focus(); if (camMode === 'orbit') { orbit.dragging = true; orbit.lx = e.clientX; orbit.ly = e.clientY; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => {
  if (!orbit.dragging) return;
  orbit.yaw -= (e.clientX - orbit.lx) * 0.006; orbit.pitch = Math.min(1.45, Math.max(0.05, orbit.pitch + (e.clientY - orbit.ly) * 0.005));
  orbit.lx = e.clientX; orbit.ly = e.clientY;
});
canvas.addEventListener('pointerup', () => { orbit.dragging = false; });
canvas.addEventListener('wheel', e => { if (camMode === 'orbit' || camMode === 'chase') { e.preventDefault(); orbit.dist = Math.min(80, Math.max(4, orbit.dist * (1 + Math.sign(e.deltaY) * 0.1))); } }, { passive: false });

function updateGimbal() {
  const p = flight.pos;
  gimbalCam.position.set(p.x, p.y + 0.05, p.z).add(flight.forward.multiplyScalar(0.45));
  gimbalCam.rotation.set(-10 * DEG, -flight.heading * DEG, 0, 'YXZ');
}

const shotRT = new THREE.WebGLRenderTarget(640, 480);
const shotCanvas = document.createElement('canvas');
shotCanvas.width = 640; shotCanvas.height = 480;
const shotCtx = shotCanvas.getContext('2d');
const shotPixels = new Uint8Array(640 * 480 * 4);
function captureFrame(osd = true) {
  updateGimbal();
  gimbalCam.aspect = 4 / 3; gimbalCam.updateProjectionMatrix();
  const vis = drone.root.visible; drone.root.visible = false;
  renderer.setRenderTarget(shotRT);
  renderer.render(scene, gimbalCam);
  renderer.readRenderTargetPixels(shotRT, 0, 0, 640, 480, shotPixels);
  renderer.setRenderTarget(null);
  drone.root.visible = vis;
  const img = shotCtx.createImageData(640, 480);
  for (let y = 0; y < 480; y++) img.data.set(shotPixels.subarray((479 - y) * 640 * 4, (480 - y) * 640 * 4), y * 640 * 4);
  shotCtx.putImageData(img, 0, 0);
  if (osd) {
    shotCtx.fillStyle = 'rgba(0,0,0,0.45)'; shotCtx.fillRect(0, 446, 640, 34);
    shotCtx.fillStyle = '#fff'; shotCtx.font = '14px "B612 Mono", monospace';
    const d = new Date().toISOString().replace('T', ' ').slice(0, 19);
    shotCtx.fillText(`${settings.callsign}  ${d}Z  x ${autopilot.x.toFixed(1)}  z ${autopilot.z.toFixed(1)}  alt ${flight.pos.y.toFixed(1)} m  hdg ${String(Math.round(flight.heading)).padStart(3, '0')}`, 12, 468);
  }
  return shotCanvas;
}

async function takePhoto(src = 'pilot') {
  const c = captureFrame();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  flashPip();
  try {
    const r = await store.addMedia('photo', blob, { callsign: settings.callsign, altitude: +flight.pos.y.toFixed(1), heading: Math.round(flight.heading), x: autopilot.x, z: autopilot.z, trigger: src });
    if (recorder.active) { recorder.active.photos++; recorder.event('photo', { id: r.id }); }
    feed({ ok: true, label: `photo ${r.id}`, detail: `${fmtBytes(r.size)} PNG at ${flight.pos.y.toFixed(1)} m`, href: 'logbook.html#media' });
  } catch (e) { feed({ ok: false, error: e.message }); }
}
function flashPip() { const p = $('pip'); p.style.boxShadow = '0 0 0 3px #fff'; setTimeout(() => { p.style.boxShadow = ''; }, 140); }

let recording = null;
const vidCanvas = document.createElement('canvas');
vidCanvas.width = 640; vidCanvas.height = 480;
const vidCtx = vidCanvas.getContext('2d');
function startRecording() {
  if (recording) return;
  if (!window.MediaRecorder || !vidCanvas.captureStream) { mlog('Video recording is not supported in this browser.', 'warn'); return; }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const stream = vidCanvas.captureStream(24);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start(500);
  recording = { rec, chunks, mime: rec.mimeType || mime || 'video/webm', acc: 0 };
  $('recDot').hidden = false;
  recorder.event('recording-start');
}
function stopRecording() {
  if (!recording) return Promise.resolve();
  const r = recording; recording = null;
  $('recDot').hidden = true;
  return new Promise(resolve => {
    r.rec.onstop = async () => {
      const type = r.mime.split(';')[0];
      const blob = new Blob(r.chunks, { type });
      try {
        const up = await store.addMedia('video', blob, { callsign: settings.callsign });
        recorder.event('recording-saved', { id: up.id });
        feed({ ok: true, label: `video ${up.id}`, detail: fmtBytes(up.size), href: 'logbook.html#media' });
      } catch (e) { feed({ ok: false, error: e.message }); }
      resolve();
    };
    r.rec.stop();
  });
}

// ---------------- time of day ----------------
const TOD = {
  Day: { sky: 0x9cc0da, fog: [160, 900], hemi: 0.75, sun: 1.05, sunColor: 0xfff4e0, night: 0, head: 0 },
  Dusk: { sky: 0xd99a74, fog: [120, 700], hemi: 0.45, sun: 0.7, sunColor: 0xffb07a, night: 0.45, head: 1.2 },
  Night: { sky: 0x0b1626, fog: [60, 420], hemi: 0.12, sun: 0.08, sunColor: 0x9fb8ff, night: 1, head: 3 }
};
let tod = 'Day';
function setTod(name) {
  tod = name;
  const t = TOD[name];
  scene.background.setHex(t.sky); scene.fog.color.setHex(t.sky); scene.fog.near = t.fog[0]; scene.fog.far = t.fog[1];
  hemi.intensity = t.hemi; sun.intensity = t.sun; sun.color.setHex(t.sunColor);
  world.setNight(t.night);
  drone.headlight.intensity = t.head;
  $('todBtn').textContent = name;
  stage.style.background = '#' + t.sky.toString(16).padStart(6, '0');
}

// ---------------- rings ----------------
function resetRings() {
  ringIndex = 0; lastRingSide = null;
  world.rings.forEach(r => { r.passed = false; r.mat.color.setHex(0xff7a1a); r.mat.emissive.setHex(0xff7a1a); });
  $('ringInfo').textContent = `Ring course 0/${world.rings.length}`;
}
function checkRings() {
  if (flight.state !== 'flying') return;
  const r = world.rings[ringIndex];
  const rel = flight.pos.clone().sub(r.center);
  const side = rel.dot(r.normal);
  const lateral = rel.clone().sub(r.normal.clone().multiplyScalar(side)).length();
  if (lastRingSide !== null && lastRingSide < 0 && side >= 0 && lateral < r.radius) {
    if (ringIndex === 0) ringStart = performance.now();
    r.passed = true; r.mat.color.setHex(0x3fc6b4); r.mat.emissive.setHex(0x3fc6b4); r.mat.emissiveIntensity = 0.8;
    ringIndex++;
    if (recorder.active) { recorder.active.rings++; recorder.event('ring', { n: ringIndex }); }
    if (ringIndex >= world.rings.length) {
      const lap = (performance.now() - ringStart) / 1000;
      banner('Lap complete', `${world.rings.length} rings in ${lap.toFixed(1)} s`, 'ok', 3500);
      recorder.event('lap', { seconds: +lap.toFixed(2) });
      setTimeout(resetRings, 1500);
      ringIndex = 0;
    } else banner(`Ring ${ringIndex}/${world.rings.length}`, '', 'ok', 900);
    $('ringInfo').textContent = `Ring course ${ringIndex}/${world.rings.length}`;
    lastRingSide = null;
    return;
  }
  lastRingSide = Math.abs(side) < 8 ? side : null;
}

// ---------------- replay ----------------
let replay = null;
async function loadReplay(id) {
  try {
    const log = await store.getFlight(id);
    if (!log) throw new Error(`Flight ${id} is not in the logbook.`);
    if (!log.samples?.length) throw new Error('This flight log has no samples.');
    replay = { log, t: 0, playing: true, speed: 1, id };
    if (replayLine) scene.remove(replayLine);
    const pts = log.samples.map(s => { const w = toWorld(s[1], s[3]); return new THREE.Vector3(w.x, s[2] + 0.05, w.z); });
    replayLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3fc6b4, transparent: true, opacity: 0.85 }));
    scene.add(replayLine);
    ghost.root.visible = true;
    banner('Replaying flight', `${log.flightId}, ${log.durationS} s`, 'ok', 2600);
    openDrawer('replay');
  } catch (e) {
    toast('Replay failed', e.message, 'error', 6000);
  }
}
function stopReplay() {
  replay = null; ghost.root.visible = false;
  if (replayLine) { scene.remove(replayLine); replayLine = null; }
  if (drawerTab === 'replay') renderDrawer();
}
function stepReplay(dt) {
  if (!replay) return;
  const s = replay.log.samples;
  if (replay.playing) replay.t += dt * replay.speed;
  const end = s[s.length - 1][0];
  if (replay.t >= end) { replay.t = end; replay.playing = false; }
  let i = replay.idx || 0;
  if (s[i][0] > replay.t) i = 0;
  while (i < s.length - 2 && s[i + 1][0] <= replay.t) i++;
  replay.idx = i;
  const a = s[i], b = s[Math.min(i + 1, s.length - 1)];
  const k = b[0] > a[0] ? (replay.t - a[0]) / (b[0] - a[0]) : 0;
  const lerp = (u, v) => u + (v - u) * Math.min(1, Math.max(0, k));
  const w = toWorld(lerp(a[1], b[1]), lerp(a[3], b[3]));
  ghost.root.position.set(w.x, lerp(a[2], b[2]), w.z);
  let dh = b[4] - a[4]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  ghost.root.rotation.y = -(a[4] + dh * k) * DEG;
  ghost.tilt.rotation.set(-(a[8] || 0) * 0.35, 0, -(a[9] || 0) * 0.35);
  ghost.update(dt, a[2] > 0.3 ? 120 : 0, performance.now() / 1000);
  const sl = $('replaySlider');
  if (sl && !sl.matches(':active')) { sl.value = String(replay.t / end * 1000); $('replayTime').textContent = `${replay.t.toFixed(1)} / ${end.toFixed(1)} s`; }
}

// ---------------- mission editor ----------------
let editor = null;
let missionKey = '';
function setMode(mode) {
  const mission = mode === 'mission';
  $('shell').classList.toggle('with-mission', mission);
  $('modePilot').classList.toggle('on', !mission); $('modePilot').setAttribute('aria-selected', String(!mission));
  $('modeMission').classList.toggle('on', mission); $('modeMission').setAttribute('aria-selected', String(mission));
  if (mission && !editor) {
    editor = new MissionEditor($('blockly'), { onChange: () => { try { localStorage.setItem('aerotwin.missionDraft', editor.xml()); } catch { /* ignore */ } } });
    let draft = null;
    try { draft = localStorage.getItem('aerotwin.missionDraft'); } catch { /* ignore */ }
    if (draft) { try { editor.load(draft); } catch { editor.load(EMPTY_MISSION); } }
    else loadMission('Survey square');
    refreshMissionList();
  }
  setTimeout(() => { resize(); editor?.resize(); }, 30);
}
async function refreshMissionList() {
  const sel = $('missionList');
  const list = await store.listMissions();
  sel.replaceChildren(h('option', { value: '' }, 'Open a saved mission…'),
    h('optgroup', { label: 'Your missions' }, ...list.filter(m => !m.sample).map(m => h('option', { value: m.id, selected: m.id === missionKey }, m.id))),
    h('optgroup', { label: 'Examples' }, ...list.filter(m => m.sample).map(m => h('option', { value: m.id, selected: m.id === missionKey }, m.id))));
}
async function loadMission(name) {
  const m = await store.getMission(name);
  if (!m) return mlog(`No mission called "${name}".`, 'error');
  editor.load(m.xml);
  missionKey = name;
  $('missionName').textContent = m.sample ? `${name} (example)` : name;
  mlog(`Opened "${name}".`, 'ok');
}
async function runMission() {
  if (!editor || editor.running) return;
  if (flight.state === 'crashed') { banner('Crashed', 'Reset the drone first (Backspace)', 'bad'); return; }
  $('runMission').disabled = true; $('stopMission').disabled = false;
  logEl.replaceChildren();
  mlog('Mission started.', 'ok');
  recorder.markControl('mission');
  let result;
  await runAuto('mission', async () => {
    result = await editor.run(autopilot, {
      log: mlog,
      key: k => input.isKeyPressed(k),
      pad: i => input.gamepadButton(i),
      onVars: vars => renderVars(vars)
    });
  });
  mlog(result === 'stopped' ? 'Mission stopped.' : result === 'error' ? 'Mission ended with an error.' : result === 'empty' ? '' : 'Mission complete.', result === 'done' ? 'ok' : 'warn');
  $('runMission').disabled = false; $('stopMission').disabled = true;
}
let varsT = 0;
function renderVars(vars) {
  const now = performance.now();
  if (now - varsT < 120) return; varsT = now;
  const entries = Object.entries(vars || {});
  $('missionVars').replaceChildren(...(entries.length ? entries.map(([k, v]) => h('div', {}, h('b', {}, k), ' = ', JSON.stringify(v) ?? 'undefined')) : [h('span', { class: 'hint' }, 'No variables in this mission.')]));
}

$('modePilot').onclick = () => setMode('pilot');
$('modeMission').onclick = () => setMode('mission');
$('runMission').onclick = runMission;
$('stopMission').onclick = () => { editor?.stop(); autopilot.cancel(); };
$('missionList').onchange = e => { if (e.target.value) loadMission(e.target.value); };
$('newMission').onclick = () => { editor.load(EMPTY_MISSION); missionKey = ''; $('missionName').textContent = 'untitled.xml'; };
$('exportMission').onclick = () => download(new Blob([editor.xml()], { type: 'text/xml' }), (missionKey.split('/').pop() || 'mission.xml'));
$('importMission').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { editor.load(await f.text()); missionKey = f.name.replace(/\.xml$/i, ''); $('missionName').textContent = `${f.name} (not saved yet)`; mlog(`Imported ${f.name}.`, 'ok'); }
  catch (err) { mlog(`That file is not a Blockly XML program: ${err.message}`, 'error'); }
  e.target.value = '';
};
$('saveMission').onclick = async () => {
  const current = await store.getMission(missionKey);
  const name = prompt('Save mission as:', current?.sample ? `My ${missionKey.toLowerCase()}` : (missionKey || 'My mission'));
  if (!name?.trim()) return;
  const r = await store.putMission(name.trim(), editor.xml());
  missionKey = r.id;
  $('missionName').textContent = r.id;
  feed({ ok: true, label: `mission "${r.id}"`, detail: r.versions.length ? `${r.versions.length} earlier version(s) kept` : 'first version', href: 'logbook.html#missions' });
  mlog(`Saved "${r.id}".`, 'ok');
  refreshMissionList();
};

// ---------------- drawer ----------------
let drawerTab = 'replay';
function openDrawer(tab) { if (tab) drawerTab = tab; $('drawer').hidden = false; renderDrawer(); }
$('dataBtn').onclick = () => { $('drawer').hidden ? openDrawer() : ($('drawer').hidden = true); };
$('drawerClose').onclick = () => { $('drawer').hidden = true; stage.focus(); };
document.querySelectorAll('.drawer .tabs button').forEach(b => b.onclick = () => { drawerTab = b.dataset.tab; renderDrawer(); });

async function renderDrawer() {
  document.querySelectorAll('.drawer .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === drawerTab));
  const body = $('drawerBody');
  if (drawerTab === 'replay') {
    const items = [];
    if (replay) {
      const end = replay.log.samples[replay.log.samples.length - 1][0];
      items.push(h('div', { class: 'replay-bar' },
        h('b', {}, `Replaying ${replay.log.flightId}`),
        h('input', { type: 'range', id: 'replaySlider', min: 0, max: 1000, value: replay.t / end * 1000, 'aria-label': 'Replay position', oninput: e => { replay.t = e.target.value / 1000 * end; replay.idx = 0; } }),
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('span', { class: 'hint mono', id: 'replayTime' }, ''),
          h('div', { class: 'actions' },
            h('button', { class: 'btn small', type: 'button', onclick: e => { if (replay.t >= end) replay.t = 0; replay.playing = !replay.playing; e.target.textContent = replay.playing ? 'Pause' : 'Play'; } }, replay.playing ? 'Pause' : 'Play'),
            h('button', { class: 'btn small', type: 'button', onclick: e => { replay.speed = replay.speed >= 8 ? 1 : replay.speed * 2; e.target.textContent = `${replay.speed}×`; } }, `${replay.speed}×`),
            h('button', { class: 'btn small danger', type: 'button', onclick: stopReplay }, 'Stop')))));
    }
    const list = await store.listFlights();
    body.replaceChildren(...items, ...(list.length ? list.slice(0, 40).map(f => h('div', { class: 'flight-row' },
      h('b', {}, f.flightId),
      h('span', { class: 'hint' }, `${new Date(f.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}, ${Math.round(f.durationS)} s, ${Math.round(f.distanceM)} m${f.crashed ? ', crashed' : ''}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => loadReplay(f.id) }, replay?.id === f.id ? 'Restart' : 'Replay'))) : [h('p', {}, 'No flights yet. Take off and land to record one.')]));
  } else if (drawerTab === 'saved') {
    body.replaceChildren(
      h('p', { class: 'hint' }, 'Everything saved during this session. The full history is in the logbook.'),
      ...(saves.length ? saves.map(u => h('div', { class: 'flight-row' },
        h('b', {}, u.ok ? u.label : 'Save failed'),
        h('span', { class: 'hint' }, u.ok ? u.detail : u.error),
        u.ok ? h('a', { class: 'btn small', href: u.href || 'logbook.html', target: '_blank', rel: 'noopener' }, 'Open') : h('span'))) : [h('p', {}, 'Nothing saved yet. Press P for a photo, or land after a flight.')]),
      h('a', { class: 'btn', href: 'logbook.html', target: '_blank', rel: 'noopener' }, 'Open the logbook'));
  } else {
    const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
    const toggle = (label, key, apply) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: settings[key], onchange: e => { settings[key] = e.target.checked; apply?.(e.target.checked); saveSettings(); } }), label);
    body.replaceChildren(h('div', { class: 'set-grid' },
      field('Callsign', h('input', { type: 'text', value: settings.callsign, maxlength: 12, onchange: e => { settings.callsign = e.target.value.trim() || 'AT-01'; saveSettings(); } }), 'Written into flight-log metadata (x-amz-meta-callsign).'),
      field('Stick layout', h('select', { onchange: e => { settings.stickMode = input.mode = Number(e.target.value); saveSettings(); } },
        h('option', { value: 2, selected: settings.stickMode === 2 }, 'Mode 2: throttle on the left (W S, left stick)'),
        h('option', { value: 1, selected: settings.stickMode === 1 }, 'Mode 1: throttle on the right (↑ ↓, right stick)'))),
      field(`Gamepad dead zone (${Math.round(settings.deadzone * 100)}%)`, h('input', { type: 'range', min: 0, max: 0.3, step: 0.01, value: settings.deadzone, oninput: e => { settings.deadzone = input.deadzone = Number(e.target.value); e.target.previousSibling.textContent = `Gamepad dead zone (${Math.round(settings.deadzone * 100)}%)`; saveSettings(); } })),
      field(`Stick expo (${Math.round(settings.expo * 100)}%)`, h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: settings.expo, oninput: e => { settings.expo = input.expo = Number(e.target.value); e.target.previousSibling.textContent = `Stick expo (${Math.round(settings.expo * 100)}%)`; saveSettings(); } }), 'Softens small stick movements for precise hovering.'),
      toggle('Invert gamepad pitch', 'invertPitch', v => { input.invertPitch = v; }),
      toggle('Sport mode (G)', 'sport', v => { flight.sport = v; }),
      toggle('Wind gusts', 'wind', v => { flight.wind = v; }),
      toggle('Save a flight log after each landing or crash', 'autoUpload'),
      toggle('Shadows', 'shadows', v => { renderer.shadowMap.enabled = v; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }),
      field(`Motor volume (${Math.round(settings.volume * 100)}%)`, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings.volume, oninput: e => { settings.volume = audio.volume = Number(e.target.value); e.target.previousSibling.textContent = `Motor volume (${Math.round(settings.volume * 100)}%)`; saveSettings(); } }))));
  }
}

// ---------------- keyboard and gamepad actions ----------------
input.on('key', code => {
  switch (code) {
    case 'Space': takeoffOrLand(); break;
    case 'KeyH': returnHome(); break;
    case 'KeyC': cycleCamera(); break;
    case 'KeyP': takePhoto('pilot'); break;
    case 'KeyR': recording ? stopRecording() : startRecording(); break;
    case 'KeyM': autopilot.smoke = !autopilot.smoke; banner(autopilot.smoke ? 'Smoke on' : 'Smoke off', '', '', 900); break;
    case 'KeyG': settings.sport = flight.sport = !flight.sport; saveSettings(); banner(flight.sport ? 'Sport mode' : 'Normal mode', flight.sport ? 'Up to 35° tilt and 6 m/s climb' : 'Up to 22° tilt and 4 m/s climb', '', 1400); break;
    case 'KeyN': setTod(tod === 'Day' ? 'Dusk' : tod === 'Dusk' ? 'Night' : 'Day'); break;
    case 'Escape': stopAutomation(); break;
    case 'Backspace': resetDrone(); break;
    case 'Slash': toggleHelp(); break;
  }
});
window.addEventListener('keydown', e => { if (e.key === '?' || (e.key === 'Escape' && !$('help').hidden)) { if (e.key === 'Escape') toggleHelp(false); } });
input.on('button', i => {
  ({ 0: takeoffOrLand, 1: returnHome, 2: cycleCamera, 3: () => takePhoto('pilot'), 4: () => { autopilot.smoke = !autopilot.smoke; }, 5: () => (recording ? stopRecording() : startRecording()), 8: () => { flight.sport = !flight.sport; banner(flight.sport ? 'Sport mode' : 'Normal mode', '', '', 1200); }, 9: resetDrone })[i]?.();
});
input.on('gamepad', (on, id) => {
  $('srcGp').querySelector('.dot').className = `dot ${on ? 'on' : ''}`;
  $('gpName').textContent = on ? (id || 'Gamepad').replace(/\(.*?\)/g, '').trim().slice(0, 32) || 'Gamepad' : 'No gamepad';
  toast(on ? 'Gamepad connected' : 'Gamepad disconnected', on ? id : '', on ? 'ok' : 'warn');
});

function toggleHelp(force) {
  const el = $('help');
  el.hidden = force === undefined ? !el.hidden : !force;
  if (el.hidden) { settings.helpSeen = true; saveSettings(); stage.focus(); }
}
$('helpBtn').onclick = () => toggleHelp();
$('helpClose').onclick = () => toggleHelp(false);
$('helpGo').onclick = () => { toggleHelp(false); audio.init(); };
$('camBtn').onclick = cycleCamera;
$('todBtn').onclick = () => setTod(tod === 'Day' ? 'Dusk' : tod === 'Dusk' ? 'Night' : 'Day');
$('sndBtn').onclick = () => { settings.sound = !settings.sound; audio.muted = !settings.sound; audio.init(); $('sndBtn').textContent = settings.sound ? 'Sound on' : 'Sound off'; saveSettings(); };
$('sndBtn').textContent = settings.sound ? 'Sound on' : 'Sound off';

// ---------------- touch screens ----------------
if (matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch-ui');
  $('touch').hidden = false;
  input.attachTouch($('tsL'), ['yaw', 'throttle']);
  input.attachTouch($('tsR'), ['roll', 'pitch']);
  $('tTake').onclick = () => { audio.init(); takeoffOrLand(); };
  $('tHome').onclick = returnHome;
  $('tPhoto').onclick = () => takePhoto('pilot');
    $('srcKb').lastChild.textContent = 'Touch';
}

// ---------------- HUD rendering ----------------
const compass = $('compass').getContext('2d');
function drawCompass(hdg) {
  const c = compass, W = 220, H = 40;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = 'rgba(231,238,245,0.55)'; c.fillStyle = '#e7eef5'; c.font = '11px "B612 Mono", monospace'; c.textAlign = 'center';
  for (let d = Math.floor((hdg - 60) / 5) * 5; d <= hdg + 60; d += 5) {
    const x = W / 2 + (d - hdg) * 1.8;
    const n = ((d % 360) + 360) % 360;
    const major = n % 30 === 0;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, major ? 10 : 5); c.stroke();
    if (major) c.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0'), x, 24);
  }
  const home = (Math.atan2(-flight.pos.x, flight.pos.z) / DEG + 360) % 360;
  let dh = ((home - hdg + 540) % 360) - 180;
  if (Math.hypot(flight.pos.x, flight.pos.z) > 2 && Math.abs(dh) < 60) { c.fillStyle = '#3fc6b4'; c.fillText('H', W / 2 + dh * 1.8, 37); }
  c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(W / 2 - 5, 0); c.lineTo(W / 2 + 5, 0); c.lineTo(W / 2, 7); c.fill();
}

const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const S = 168, scale = 0.55, cx = S / 2, cy = S / 2;
  const px = flight.pos.x, pz = flight.pos.z;
  const map = (x, z) => [cx + (x - px) * scale, cy + (z - pz) * scale];
  mm.clearRect(0, 0, S, S);
  mm.save(); mm.beginPath(); mm.arc(cx, cy, S / 2 - 1, 0, Math.PI * 2); mm.clip();
  mm.fillStyle = 'rgba(15,29,44,0.0)'; mm.fillRect(0, 0, S, S);
  const [lx, lz] = map(115, -10); mm.fillStyle = 'rgba(44,110,143,0.7)'; mm.beginPath(); mm.arc(lx, lz, 42 * scale, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = 'rgba(159,195,220,0.55)';
  for (const c of world.colliders) {
    if (c.type === 'box') { const [x, z] = map(c.minX, c.minZ); mm.fillRect(x, z, (c.maxX - c.minX) * scale, (c.maxZ - c.minZ) * scale); }
    else if (c.name === 'radio tower') { const [x, z] = map(c.x, c.z); mm.fillStyle = '#ff3b30'; mm.fillRect(x - 2, z - 2, 4, 4); mm.fillStyle = 'rgba(159,195,220,0.55)'; }
  }
  mm.fillStyle = 'rgba(63,140,90,0.55)';
  for (const c of world.colliders) if (c.name === 'tree') { const [x, z] = map(c.x, c.z); if (x > -4 && x < S + 4 && z > -4 && z < S + 4) mm.fillRect(x - 1, z - 1, 2, 2); }
  world.rings.forEach((r, i) => { const [x, z] = map(r.center.x, r.center.z); mm.fillStyle = r.passed ? '#3fc6b4' : i === ringIndex ? '#ffd2a8' : '#ff7a1a'; mm.beginPath(); mm.arc(x, z, i === ringIndex ? 3.5 : 2.5, 0, Math.PI * 2); mm.fill(); });
  const [hx, hz] = map(0, 0); mm.strokeStyle = '#f2c14e'; mm.lineWidth = 1.5; mm.beginPath(); mm.arc(hx, hz, 5, 0, Math.PI * 2); mm.stroke();
  if (replay) { const [gx, gz] = map(ghost.root.position.x, ghost.root.position.z); mm.fillStyle = '#9fe8de'; mm.beginPath(); mm.arc(gx, gz, 3.5, 0, Math.PI * 2); mm.fill(); }
  mm.restore();
  mm.save(); mm.translate(cx, cy); mm.rotate(flight.heading * DEG);
  mm.fillStyle = '#ff7a1a'; mm.beginPath(); mm.moveTo(0, -8); mm.lineTo(5.5, 6); mm.lineTo(0, 3); mm.lineTo(-5.5, 6); mm.closePath(); mm.fill();
  mm.restore();
  mm.fillStyle = '#95abc1'; mm.font = '10px Archivo, sans-serif'; mm.textAlign = 'center'; mm.fillText('N', cx, 12);
}

const graph = $('graph').getContext('2d');
const hist = [];
function drawGraph(s) {
  hist.push([s.throttle, s.yaw, s.pitch, s.roll]);
  if (hist.length > 220) hist.shift();
  graph.clearRect(0, 0, 220, 64);
  graph.strokeStyle = 'rgba(149,171,193,0.25)'; graph.beginPath(); graph.moveTo(0, 32); graph.lineTo(220, 32); graph.stroke();
  ['#ff7a1a', '#3fc6b4', '#6aa7ff', '#f2c14e'].forEach((col, k) => {
    graph.strokeStyle = col; graph.lineWidth = 1.5; graph.beginPath();
    hist.forEach((v, i) => { const y = 32 - v[k] * 28; i ? graph.lineTo(i, y) : graph.moveTo(i, y); });
    graph.stroke();
  });
}

function updateState() {
  const el = $('flightState');
  let text = 'On the pad', cls = '';
  if (flight.state === 'crashed') { text = 'Crashed. Press Backspace to reset'; cls = 'crashed'; }
  else if (control === 'auto') { text = { takeoff: 'Taking off', land: 'Landing', rth: 'Returning home', mission: 'Mission running', emergency: 'Emergency landing' }[autoTask] || 'Autopilot'; cls = 'auto'; }
  else if (flight.state === 'flying') { text = `Flying: ${input.lastSource}${flight.sport ? ', sport' : ''}`; cls = 'flying'; }
  else if (flight.pos.y > 0.5) text = 'Landed on a rooftop';
  el.textContent = text; el.className = `state ${cls}`;
}

let hudT = 0;
function updateHud(dt, s) {
  hudT += dt;
  $('stickL').style.left = `${50 + s.yaw * 40}%`; $('stickL').style.top = `${50 - s.throttle * 40}%`;
  $('stickR').style.left = `${50 + s.roll * 40}%`; $('stickR').style.top = `${50 - s.pitch * 40}%`;
  if (input.mode === 1) { $('stickL').style.top = `${50 - s.pitch * 40}%`; $('stickR').style.top = `${50 - s.throttle * 40}%`; }
  drawGraph(s);
  if (hudT < 1 / 12) return;
  hudT = 0;
  const v = flight.state === 'flying' ? (control === 'auto' ? kinVel : flight.vel) : new THREE.Vector3();
  $('iAlt').textContent = flight.pos.y.toFixed(1);
  $('iVs').textContent = v.y.toFixed(1);
  $('iSpd').textContent = Math.hypot(v.x, v.z).toFixed(1);
  $('iHdg').textContent = `Heading ${String(Math.round(flight.heading) % 360).padStart(3, '0')}°`;
  const b = flight.battery;
  $('iBat').textContent = Math.round(b);
  $('iBat').className = `iv ${b < 15 ? 'bad' : b < 30 ? 'warn' : ''}`;
  $('iBatBar').style.width = `${b}%`;
  $('iBatBar').style.background = b < 15 ? 'var(--red)' : b < 30 ? 'var(--amber)' : 'var(--teal)';
  const t = recorder.elapsed;
  $('iTime').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('iHome').textContent = Math.round(Math.hypot(flight.pos.x, flight.pos.z));
  if (!$('touch').hidden) $('tTake').textContent = flight.state === 'flying' ? 'Land' : 'Take off';
  drawCompass(flight.heading);
  drawMinimap();
  updateState();
}

// ---------------- resize ----------------
let pipRect = { x: 16, y: 16, w: 288, h: 216 };
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  const p = $('pip').getBoundingClientRect();
  pipRect = { x: p.left - r.left, y: r.bottom - p.bottom, w: p.width, h: p.height };
}
window.addEventListener('resize', resize);
new ResizeObserver(() => { resize(); editor?.resize(); }).observe(stage);

// ---------------- main loop ----------------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
let lastSamples = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
let simTime = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  simTime += dt;
  const s = simulate(dt, simTime);
  if (!window.aerotwin?.pauseRender) render(dt, simTime, s);
}

function simulate(dt, t) {
  const s = input.poll(dt);
  lastSamples = s;
  prevPos.copy(flight.pos);

  if (flight.state === 'flying') {
    if (control === 'auto') {
      pilotOverride();
    }
    if (control === 'pilot') {
      input.activeSources().forEach(src => recorder.markControl(src));
      const ev = flight.step(dt, s);
      if (ev === 'landed') endFlight('landed');
      else if (ev === 'crashed') onCrash();
      kinVel.copy(flight.vel);
    } else {
      autopilot.step(dt);
      flight.battery = Math.max(0, flight.battery - dt * 0.2);
      const v = flight.pos.clone().sub(prevPos).divideScalar(Math.max(dt, 1e-4));
      kinVel.lerp(v, 1 - Math.exp(-dt / 0.15));
      const fwd = kinVel.dot(flight.forward), rgt = kinVel.dot(flight.right);
      const k = 1 - Math.exp(-dt / 0.18);
      flight.pitch += (Math.max(-0.45, Math.min(0.45, fwd * 0.045)) - flight.pitch) * k;
      flight.roll += (Math.max(-0.45, Math.min(0.45, rgt * 0.045)) - flight.roll) * k;
    }
    // battery management
    if (flight.battery < 15 && !lowBatteryWarned) { lowBatteryWarned = true; banner('Low battery', 'Returning home automatically', 'bad', 3000); recorder.event('low-battery'); if (control === 'pilot') returnHome(); }
    if (flight.battery <= 0 && autoTask !== 'land' && autoTask !== 'emergency') { banner('Battery empty', 'Forced landing', 'bad'); runAuto('emergency', () => autopilot.land()); }
  } else if (flight.state === 'crashed') {
    flight.stepCrashed(dt);
    autopilot.step(dt);
  } else {
    autopilot.step(dt);   // a mission may be waiting to take off
    kinVel.set(0, 0, 0);
  }
  flight.speedTotal = (control === 'auto' ? kinVel : flight.vel).length();
  recorder.sample(dt, flight, s);
  checkRings();
  stepReplay(dt);

  // smoke
  if (autopilot.smoke && flight.state === 'flying') {
    smokeTimer += dt;
    if (smokeTimer > 0.04) {
      smokeTimer = 0;
      const i = smokeCount % SMOKE_MAX;
      smokePos[i * 3] = flight.pos.x; smokePos[i * 3 + 1] = flight.pos.y - 0.15; smokePos[i * 3 + 2] = flight.pos.z;
      smokeCount++;
      smokeGeo.attributes.position.needsUpdate = true;
      smokeGeo.setDrawRange(0, Math.min(smokeCount, SMOKE_MAX));
    }
  }

  return s;
}

function render(dt, t, s) {
  // drone visuals
  drone.root.position.copy(flight.pos);
  drone.root.position.y += 0.2;
  drone.root.rotation.y = -flight.heading * DEG;
  drone.tilt.rotation.set(-flight.pitch, 0, -flight.roll);
  const load = flight.state === 'flying' ? Math.min(1, 0.45 + Math.abs(s.throttle) * 0.35 + (Math.abs(flight.pitch) + Math.abs(flight.roll)) * 0.6 + Math.max(0, kinVel.y) * 0.05) : 0;
  drone.update(dt, flight.state === 'flying' ? 90 + load * 70 : 0, t);
  audio.set(load, flight.state === 'flying');
  world.update(t);

  // shadow camera follows the drone
  sun.position.set(flight.pos.x - 80, 140, flight.pos.z + 60);
  sun.target.position.copy(flight.pos);

  // main camera
  const follow = replay && flight.state !== 'flying' ? ghost.root.position : flight.pos;
  const followHeading = replay && flight.state !== 'flying' ? -ghost.root.rotation.y / DEG : flight.heading;
  const fwd = new THREE.Vector3(Math.sin(followHeading * DEG), 0, -Math.cos(followHeading * DEG));
  if (camMode === 'chase') {
    const back = Math.max(5, orbit.dist * 0.55);
    const desired = follow.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, back * 0.38 + 1.2, 0));
    desired.y = Math.max(desired.y, world.groundHeightAt(desired.x, desired.z, desired.y) + 0.8);
    camera.position.lerp(desired, 1 - Math.exp(-dt / 0.18));
    camTarget.lerp(follow.clone().addScaledVector(fwd, 3).add(new THREE.Vector3(0, 0.6, 0)), 1 - Math.exp(-dt / 0.1));
    camera.lookAt(camTarget);
  } else if (camMode === 'fpv') {
    camera.position.copy(follow).add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(fwd, 0.4);
    camera.rotation.set(-flight.pitch * 0.8 + 5 * DEG, -followHeading * DEG, -flight.roll, 'YXZ');
  } else if (camMode === 'orbit') {
    const off = new THREE.Vector3(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.dist);
    camera.position.copy(follow).add(off);
    camera.lookAt(follow);
  } else {
    camera.position.lerp(new THREE.Vector3(follow.x, follow.y + 55, follow.z + 0.01), 1 - Math.exp(-dt / 0.2));
    camera.lookAt(follow);
  }

  // render: main view, then the gimbal camera into the picture-in-picture box
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  renderer.render(scene, camera);
  if (pipRect.w >= 2) {
    updateGimbal();
    gimbalCam.aspect = pipRect.w / Math.max(1, pipRect.h); gimbalCam.updateProjectionMatrix();
    const vis = drone.root.visible; drone.root.visible = false;
    renderer.setScissorTest(true);
    renderer.setScissor(pipRect.x, pipRect.y, pipRect.w, pipRect.h);
    renderer.setViewport(pipRect.x, pipRect.y, pipRect.w, pipRect.h);
    renderer.render(scene, gimbalCam);
    renderer.setScissorTest(false);
    drone.root.visible = vis;
  }

  if (recording) {
    recording.acc += dt;
    if (recording.acc > 1 / 24) { recording.acc = 0; vidCtx.drawImage(captureFrame(true), 0, 0); }
  }
  updateHud(dt, s);
}

function onCrash() {
  const what = flight.lastHit?.name || 'obstacle';
  banner('Crashed', `Hit the ${what} at ${flight.speed.toFixed(1)} m/s. Press Backspace to reset.`, 'bad', 4000);
  recorder.event('crash', { obstacle: what, speed: +flight.speed.toFixed(2) });
  editor?.stop(); autopilot.cancel();
  autoTask = null; control = 'pilot';
  endFlight('crashed');
}

// ---------------- boot ----------------
store.ready().then(() => {
  resize();
  setTod('Day');
  resetRings();
  camera.position.set(0, 4, 9);
  camTarget.set(0, 0.5, 0);
  frame();
  stage.focus();
  if (!settings.helpSeen) toggleHelp(true);
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('replay')) {
    toggleHelp(false);
    loadReplay(hash.get('replay'));
  }
  if (hash.get('mode') === 'mission') { toggleHelp(false); setMode('mission'); }
  if (hash.get('mission')) { toggleHelp(false); setMode('mission'); setTimeout(() => loadMission(hash.get('mission')), 300); }
}).catch(e => {
  toast('Browser storage is unavailable', 'Flights cannot be saved in this window. Open the page in a normal (non-private) window to keep a logbook.', 'error', 15000);
  console.error(e);
  resize(); setTod('Day'); frame();
});

// expose for debugging and automated tests
async function advance(seconds, sticks) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    input.override = sticks || null;
    simulate(1 / 60, simTime += 1 / 60);
    await new Promise(r => setTimeout(r, 0));
  }
  input.override = null;
}
window.aerotwin = { pauseRender: false, renderOnce: () => render(0.016, simTime, input.sticks), advance, flight, autopilot, recorder, store, get control() { return control; }, get autoTask() { return autoTask; }, takeoffOrLand, returnHome, takePhoto, loadReplay, setMode, runMission, get editor() { return editor; } };
