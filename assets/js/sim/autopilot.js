// Autopilot: the command set that Blockly missions (and the return-to-home
// and auto-land helpers) call. Movement is kinematic and stepped by the
// simulation loop, so pausing or cancelling is exact. Command semantics are
// adapted from Drone Commander (MIT) and re-expressed in metres and compass
// headings: x = east, z = north, y = altitude, heading 0 = north, 90 = east.
const THREE = window.THREE;
const DEG = Math.PI / 180;

export class Cancelled extends Error { constructor() { super('Mission stopped'); this.name = 'Cancelled'; } }

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const norm = a => ((a % 360) + 360) % 360;
const shortest = (from, to) => ((to - from + 540) % 360) - 180;
const toWorld = (x, z) => new THREE.Vector3(x, 0, -z);

// Arc through three points (DroneCommander's computeArcControls).
function arcControls(p0, via, p3) {
  const a = via.clone().sub(p0), b = p3.clone().sub(p0);
  const n = new THREE.Vector3().crossVectors(a, b);
  const nl = n.lengthSq(), scale = a.lengthSq() * b.lengthSq();
  if (scale === 0 || nl <= scale * 1e-12) return null;
  const center = p0.clone().add(new THREE.Vector3().crossVectors(b, n).multiplyScalar(a.lengthSq())
    .add(new THREE.Vector3().crossVectors(n, a).multiplyScalar(b.lengthSq())).multiplyScalar(1 / (2 * nl)));
  const tan = p => { const r = p.clone().sub(center); return r.lengthSq() < 1e-12 ? null : new THREE.Vector3().crossVectors(n, r).normalize(); };
  const t0 = tan(p0), t3 = tan(p3);
  if (!t0 || !t3) return null;
  const desired = via.clone().sub(p0.clone().add(p3).multiplyScalar(0.5)).multiplyScalar(1 / 0.375);
  const rev = t3.clone().multiplyScalar(-1);
  const dot = t0.dot(rev), det = 1 - dot * dot;
  let l0, l3;
  if (Math.abs(det) > 1e-6) {
    const pa = t0.dot(desired), pb = rev.dot(desired);
    l0 = (pa - dot * pb) / det; l3 = (pb - dot * pa) / det;
  } else {
    const c = t0.clone().add(rev); if (c.lengthSq() < 1e-6) return null;
    l0 = l3 = desired.dot(c) / c.lengthSq();
  }
  if (!(l0 > 0 && l3 > 0)) return null;
  return [p0.clone().add(t0.multiplyScalar(l0)), p3.clone().sub(t3.multiplyScalar(l3))];
}

export class Autopilot {
  constructor(sim) {
    this.sim = sim;          // { flight, world, hooks }
    this.tweens = [];
    this._speed = 3;
    this.smoke = false;
    this.busy = false;
    this.lastSafe = new THREE.Vector3();
  }

  get f() { return this.sim.flight; }
  get speed() { return this._speed; }
  set speed(v) { this._speed = Math.min(15, Math.max(0.5, num(v, 3))); }

  // ----- sensors in block coordinates -----
  get x() { return +this.f.pos.x.toFixed(2); }
  get z() { return +(-this.f.pos.z).toFixed(2); }
  get altitude() { return +this.f.pos.y.toFixed(2); }
  get direction() { return +this.f.heading.toFixed(1); }
  get battery() { return +this.f.battery.toFixed(1); }
  get distanceHome() { return +Math.hypot(this.f.pos.x, this.f.pos.z).toFixed(2); }

  // ----- tween engine stepped by the main loop -----
  tween(ms, fn) {
    return new Promise((resolve, reject) => {
      if (ms <= 0) { fn(1); resolve(); return; }
      this.tweens.push({ t: 0, ms, fn, resolve, reject });
    });
  }
  step(dt) {
    if (!this.tweens.length) return;
    const list = this.tweens.slice();
    for (const tw of list) {
      if (!this.tweens.includes(tw)) continue;
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.ms);
      try { tw.fn(p); } catch (e) { this.tweens = this.tweens.filter(x => x !== tw); tw.reject(e); continue; }
      if (p >= 1) { this.tweens = this.tweens.filter(x => x !== tw); tw.resolve(); }
    }
  }
  cancel() {
    const list = this.tweens; this.tweens = [];
    list.forEach(t => t.reject(new Cancelled()));
  }

  requireFlight(name) {
    if (this.f.state === 'flying') return true;
    this.sim.hooks.log(`${name} skipped: the drone is not flying. Add "take off" first.`, 'warn');
    return false;
  }

  /** Move the drone, checking obstacles like DroneCommander's setDroneFlightPosition. */
  setPos(x, y, z) {
    const g = this.sim.world.groundHeightAt(x, z, Math.max(y, this.f.pos.y));
    const yy = Math.max(y, g);
    const hit = this.sim.world.hit(x, yy, z);
    if (hit) {
      this.sim.hooks.collision(hit, this.lastSafe.clone());
      throw new Cancelled();
    }
    this.f.pos.set(x, yy, z);
    this.lastSafe.copy(this.f.pos);
  }

  // ----- flight commands -----
  async takeOff() {
    if (this.f.state === 'flying') return;
    if (this.f.state === 'crashed') { this.sim.hooks.log('The drone has crashed. Reset it before taking off.', 'warn'); return; }
    this.sim.hooks.takeoff();
    const start = this.f.pos.y, target = this.sim.world.groundHeightAt(this.f.pos.x, this.f.pos.z, start) + 5;
    await this.tween((target - start) / 2.5 * 1000, p => this.setPos(this.f.pos.x, start + (target - start) * easeInOut(p), this.f.pos.z));
  }

  async land() {
    if (this.f.state !== 'flying') return;
    const start = this.f.pos.y;
    const g = this.sim.world.groundHeightAt(this.f.pos.x, this.f.pos.z, start);
    const h = start - g;
    await this.tween(h / Math.max(1.5, h / 5) * 1000, p => this.setPos(this.f.pos.x, start - h * easeIn(p), this.f.pos.z));
    this.sim.hooks.landed();
  }

  async setAltitude(a) { if (!this.requireFlight('set altitude')) return; return this.climbTo(num(a, this.f.pos.y)); }
  async changeAltitude(d) { if (!this.requireFlight('change altitude')) return; return this.climbTo(this.f.pos.y + num(d)); }
  async climbTo(target) {
    const start = this.f.pos.y;
    const g = this.sim.world.groundHeightAt(this.f.pos.x, this.f.pos.z, start);
    target = Math.max(g + 0.5, Math.min(300, target));
    await this.tween(Math.abs(target - start) / Math.max(1, Math.min(this.speed, 5)) * 1000, p => this.setPos(this.f.pos.x, start + (target - start) * easeInOut(p), this.f.pos.z));
  }

  async setAngle(deg) { if (!this.requireFlight('set angle')) return; return this.turnTo(norm(num(deg))); }
  async changeAngle(deg) { if (!this.requireFlight('change angle')) return; return this.turnBy(num(deg)); }
  async turnTo(h) { return this.turnBy(shortest(this.f.heading, h)); }
  async turnBy(delta) {
    const start = this.f.heading;
    await this.tween(Math.max(250, Math.abs(delta) / 90 * 1000), p => { this.f.heading = norm(start + delta * easeInOut(p)); });
  }

  local(x, y, z) {   // drone-relative (x right, y up, z forward) to world offset
    return this.f.right.multiplyScalar(x).add(this.f.forward.multiplyScalar(z)).add(new THREE.Vector3(0, y, 0));
  }

  async walk(d) { if (!this.requireFlight('walk')) return; return this.moveTo(this.f.pos.clone().add(this.local(0, 0, num(d)))); }
  async slide(d) { if (!this.requireFlight('slide')) return; return this.moveTo(this.f.pos.clone().add(this.local(num(d), 0, 0))); }
  async walkClimbing(d, c) { if (!this.requireFlight('walk climbing')) return; return this.moveTo(this.f.pos.clone().add(this.local(0, num(c), num(d)))); }
  async moveBy(x, y, z) { if (!this.requireFlight('move by')) return; return this.moveTo(this.f.pos.clone().add(this.local(num(x), num(y), num(z)))); }
  async goTo(x, y, z) {
    if (!this.requireFlight('go to')) return;
    const w = toWorld(num(x), num(z)); w.y = num(y, this.f.pos.y);
    return this.moveTo(w);
  }

  async moveTo(target, { face = false } = {}) {
    const start = this.f.pos.clone();
    const delta = target.clone().sub(start);
    const dist = delta.length();
    if (dist < 1e-3) return;
    if (face && Math.hypot(delta.x, delta.z) > 0.5) {
      await this.turnTo(norm(Math.atan2(delta.x, -delta.z) / DEG));
    }
    await this.tween(dist / this.speed * 1000, p => {
      const q = easeInOutSoft(p, dist);
      this.setPos(start.x + delta.x * q, start.y + delta.y * q, start.z + delta.z * q);
    });
  }

  async returnToBase() {
    if (!this.requireFlight('return to base')) return;
    const cruise = Math.max(this.f.pos.y, 15);
    if (cruise > this.f.pos.y + 0.2) await this.climbTo(cruise);
    const home = this.sim.world.home.clone(); home.y = cruise;
    await this.moveTo(home, { face: true });
  }

  async curveAbs(x, y, z, xd, yd, zd) {
    if (!this.requireFlight('curve abs')) return;
    const via = toWorld(num(x), num(z)); via.y = num(y, this.f.pos.y);
    const dst = toWorld(num(xd), num(zd)); dst.y = num(yd, this.f.pos.y);
    return this.curveThrough(via, dst);
  }
  async curve(x, y, z, xd, yd, zd) {
    if (!this.requireFlight('curve')) return;
    const via = this.f.pos.clone().add(this.local(num(x), num(y), num(z)));
    const dst = via.clone().add(this.local(num(xd), num(yd), num(zd)));
    return this.curveThrough(via, dst);
  }
  async curveThrough(via, dst) {
    const p0 = this.f.pos.clone();
    let c = arcControls(p0, via, dst);
    if (!c) {
      const q = via.clone().multiplyScalar(2).sub(p0.clone().add(dst).multiplyScalar(0.5));
      c = [p0.clone().add(q.clone().sub(p0).multiplyScalar(2 / 3)), dst.clone().add(q.clone().sub(dst).multiplyScalar(2 / 3))];
    }
    const path = new THREE.CubicBezierCurve3(p0, c[0], c[1], dst);
    const len = path.getLength();
    await this.tween(len / this.speed * 1000, p => { const pt = path.getPointAt(p); this.setPos(pt.x, pt.y, pt.z); });
  }

  /** Point-of-interest orbit: circle a ground point while the nose tracks it. */
  async orbitPoi(cx, cz, deg = 360) {
    if (!this.requireFlight('orbit')) return;
    const c = toWorld(num(cx), num(cz));
    const r0 = new THREE.Vector3(this.f.pos.x - c.x, 0, this.f.pos.z - c.z);
    let radius = r0.length();
    if (radius < 3) { radius = 10; await this.moveTo(new THREE.Vector3(c.x + 10, this.f.pos.y, c.z)); }
    const a0 = Math.atan2(this.f.pos.z - c.z, this.f.pos.x - c.x);
    const sweep = num(deg, 360) * DEG;
    await this.turnTo(norm(Math.atan2(c.x - this.f.pos.x, -(c.z - this.f.pos.z)) / DEG));
    const y = this.f.pos.y;
    await this.tween(Math.abs(sweep) * radius / this.speed * 1000, p => {
      const a = a0 + sweep * p;
      const x = c.x + Math.cos(a) * radius, z = c.z + Math.sin(a) * radius;
      this.setPos(x, y, z);
      this.f.heading = norm(Math.atan2(c.x - x, -(c.z - z)) / DEG);
    });
  }

  wait(s) { return this.tween(Math.max(0, num(s)) * 1000, () => {}); }

  // ----- payload / data -----
  async takePhoto() { await this.sim.hooks.photo('mission'); }
  async startRecording() { await this.sim.hooks.startRecording(); }
  async saveRecording() { await this.sim.hooks.stopRecording(); }
  async uploadFlightLog() { await this.sim.hooks.uploadLog(); }
  async putNote(key, text) { await this.sim.hooks.putNote(String(key || 'notes/note.txt'), String(text ?? '')); }
}

function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
function easeIn(p) { return p * (0.4 + 0.6 * p); }
// Accelerate over the first and last ~1.5 m of a move, cruise in the middle.
function easeInOutSoft(p, dist) {
  const r = Math.min(0.5, 1.5 / Math.max(dist, 1e-3));
  if (p < r) return (p * p) / (2 * r * (1 - r));
  if (p > 1 - r) return 1 - ((1 - p) * (1 - p)) / (2 * r * (1 - r));
  return (p - r / 2) / (1 - r);
}
