// Quadcopter flight model used for manual (keyboard / gamepad) flying.
// "Angle mode" like most camera drones: sticks command a tilt angle, a
// yaw rate and a climb rate; thrust tilted by the attitude accelerates
// the airframe against linear drag, with optional wind gusts.
const THREE = window.THREE;
const G = 9.81;
const DEG = Math.PI / 180;

export class FlightModel {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;           // degrees clockwise from north (-Z)
    this.pitch = 0;             // radians, nose down positive (forward flight)
    this.roll = 0;              // radians, right wing down positive
    this.state = 'landed';      // landed | flying | crashed
    this.battery = 100;
    this.sport = false;
    this.wind = false;
    this.gust = new THREE.Vector3();
    this.gustTarget = new THREE.Vector3();
    this.gustTimer = 0;
    this.groundTime = 0;
    this.lastHit = null;
    this.speedTotal = 0;
  }

  get forward() { const h = this.heading * DEG; return new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)); }
  get right() { const h = this.heading * DEG; return new THREE.Vector3(Math.cos(h), 0, Math.sin(h)); }
  get ground() { return this.world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y); }
  get altitudeAGL() { return this.pos.y - this.ground; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  reset(at = new THREE.Vector3()) {
    this.pos.copy(at); this.pos.y = this.world.groundHeightAt(at.x, at.z);
    this.vel.set(0, 0, 0); this.heading = 0; this.pitch = this.roll = 0;
    this.state = 'landed'; this.battery = 100; this.groundTime = 0;
  }

  /**
   * Advance the physics. Returns an event string when something notable
   * happens: 'landed', 'crashed', 'bump' or null.
   */
  step(dt, s) {
    if (this.state !== 'flying') return null;
    const maxTilt = (this.sport ? 35 : 22) * DEG;
    const yawRate = this.sport ? 150 : 95;
    const climb = this.sport ? 6 : 4;
    const k = 1 - Math.exp(-dt / 0.12);

    this.pitch += (s.pitch * maxTilt - this.pitch) * k;
    this.roll += (s.roll * maxTilt - this.roll) * k;
    this.heading = (this.heading + s.yaw * yawRate * dt + 360) % 360;

    const acc = this.forward.multiplyScalar(G * Math.tan(this.pitch))
      .add(this.right.multiplyScalar(G * Math.tan(this.roll)));
    // drag (stronger when sticks are centred, mimicking position hold)
    const centred = Math.abs(s.pitch) < 0.05 && Math.abs(s.roll) < 0.05;
    const drag = centred ? 1.6 : 0.42;
    acc.x -= this.vel.x * drag;
    acc.z -= this.vel.z * drag;

    if (this.wind) {
      this.gustTimer -= dt;
      if (this.gustTimer <= 0) {
        this.gustTimer = 1.5 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2, m = Math.random() * 3.2;
        this.gustTarget.set(Math.cos(a) * m, (Math.random() - 0.5) * 0.6, Math.sin(a) * m);
      }
      this.gust.lerp(this.gustTarget, 1 - Math.exp(-dt / 0.8));
      acc.add(this.gust);
    }

    this.vel.x += acc.x * dt;
    this.vel.z += acc.z * dt;
    const targetVy = s.throttle * climb;
    this.vel.y += (targetVy - this.vel.y) * (1 - Math.exp(-dt / 0.25)) + (this.wind ? this.gust.y * dt : 0);
    this.pos.addScaledVector(this.vel, dt);

    // battery drain: hover cost + manoeuvre cost (about 9 minutes of flight)
    this.battery = Math.max(0, this.battery - dt * (0.15 + 0.09 * Math.abs(s.throttle) + 0.08 * (Math.abs(this.pitch) + Math.abs(this.roll)) / maxTilt));

    // obstacles
    const hit = this.world.hit(this.pos.x, this.pos.y, this.pos.z);
    if (hit) {
      const impact = this.speed;
      if (impact > 4.5) { this.lastHit = hit; return this.crash(); }
      const n = this.world.pushOut(this.pos, hit);
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn * 1.4);
      return 'bump';
    }

    // ground / rooftop contact
    const g = this.ground;
    if (this.pos.y <= g) {
      if (this.vel.y < -6) { this.lastHit = { name: 'ground' }; this.pos.y = g; return this.crash(); }
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.vel.x *= Math.exp(-dt * 6); this.vel.z *= Math.exp(-dt * 6);
      if (s.throttle <= 0.05) {
        this.groundTime += dt;
        if (this.groundTime > 0.6 && this.speed < 1.2) {
          this.state = 'landed'; this.vel.set(0, 0, 0); this.pitch = this.roll = 0;
          return 'landed';
        }
      }
    } else this.groundTime = 0;
    if (this.pos.y > 400) { this.pos.y = 400; this.vel.y = Math.min(0, this.vel.y); }
    return null;
  }

  crash() {
    this.state = 'crashed';
    return 'crashed';
  }

  /** Simple tumble to the ground after a crash. */
  stepCrashed(dt) {
    const g = this.world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
    this.vel.y -= G * dt;
    this.vel.x *= Math.exp(-dt * 0.8); this.vel.z *= Math.exp(-dt * 0.8);
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= g) { this.pos.y = g; this.vel.set(0, 0, 0); }
    this.roll += dt * 5 * (this.pos.y > g ? 1 : 0);
    this.pitch = Math.min(this.pitch + dt * 2, 1.2);
  }
}
