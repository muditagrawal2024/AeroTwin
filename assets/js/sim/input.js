// Keyboard + gamepad input. Both feed the same four stick axes
// (throttle, yaw, pitch, roll) using the Mode 2 transmitter layout:
//   left stick  = throttle (up/down) + yaw (left/right)   -> W S A D
//   right stick = pitch (forward/back) + roll (left/right) -> arrow keys
// Mode 1 swaps throttle and pitch, as on many European transmitters.

const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);

export class InputManager {
  constructor({ isFlightFocus }) {
    this.keys = new Set();          // physical codes currently down (flight)
    this.anyKeys = new Set();       // every key, for Blockly sensors
    this.isFlightFocus = isFlightFocus;
    this.listeners = {};
    this.mode = 2;
    this.deadzone = 0.1;
    this.expo = 0.3;
    this.invertPitch = false;
    this.gamepadIndex = null;
    this.gamepadId = '';
    this.prevButtons = [];
    this.kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.gp = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.touch = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.lastSource = 'keyboard';
    this.usedSources = new Set();

    window.addEventListener('keydown', e => {
      this.anyKeys.add(e.code);
      if (!this.isFlightFocus(e)) return;
      if (FLIGHT_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.emit('key', e.code, e);
    });
    window.addEventListener('keyup', e => { this.anyKeys.delete(e.code); this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.anyKeys.clear(); });
    window.addEventListener('gamepadconnected', e => { this.gamepadIndex = e.gamepad.index; this.gamepadId = e.gamepad.id; this.emit('gamepad', true, e.gamepad.id); });
    window.addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === this.gamepadIndex) { this.gamepadIndex = null; this.emit('gamepad', false); } });
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { (this.listeners[name] || []).forEach(fn => fn(...a)); }

  /** For Blockly's "key pressed" sensor. Accepts DroneCommander names too. */
  isKeyPressed(name) {
    const map = { ARROW_UP: 'ArrowUp', ARROW_DOWN: 'ArrowDown', ARROW_LEFT: 'ArrowLeft', ARROW_RIGHT: 'ArrowRight', SPACE: 'Space', RETURN: 'Enter' };
    const code = map[name] || (name.length === 1 ? (/\d/.test(name) ? 'Digit' + name : 'Key' + name.toUpperCase()) : name);
    return this.anyKeys.has(code);
  }

  gamepadButton(i) {
    const gp = this.gamepadIndex !== null ? navigator.getGamepads()[this.gamepadIndex] : null;
    return !!gp?.buttons[i]?.pressed;
  }

  shape(v) {
    const dz = this.deadzone;
    if (Math.abs(v) < dz) return 0;
    const n = (Math.abs(v) - dz) / (1 - dz) * Math.sign(v);
    return (1 - this.expo) * n + this.expo * n * n * n;
  }

  /** Call once per frame. Returns blended sticks in [-1, 1]. */
  poll(dt) {
    // Keyboard: keys drive the stick toward ±1 at a finite rate so taps are gentle.
    const k = this.keys;
    const target = {
      throttle: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      yaw: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      pitch: (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0),
      roll: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)
    };
    if (this.mode === 1) [target.throttle, target.pitch] = [target.pitch, target.throttle];
    if (this.override) Object.assign(target, this.override);
    const rate = 4.5 * dt;
    for (const a of Object.keys(this.kb)) {
      const d = target[a] - this.kb[a];
      this.kb[a] += Math.sign(d) * Math.min(Math.abs(d), target[a] === 0 ? rate * 1.8 : rate);
    }

    // Gamepad (standard mapping): axes 0/1 left stick, 2/3 right stick.
    const gp = this.gamepadIndex !== null ? navigator.getGamepads()[this.gamepadIndex] : null;
    if (gp) {
      const ax = i => this.shape(gp.axes[i] || 0);
      let thr = -ax(1), yaw = ax(0), pitch = -ax(3), roll = ax(2);
      if (this.mode === 1) [thr, pitch] = [pitch, thr];
      if (this.invertPitch) pitch = -pitch;
      const f = 1 - Math.exp(-dt / 0.05);
      this.gp.throttle += (thr - this.gp.throttle) * f;
      this.gp.yaw += (yaw - this.gp.yaw) * f;
      this.gp.pitch += (pitch - this.gp.pitch) * f;
      this.gp.roll += (roll - this.gp.roll) * f;
      // edge-triggered buttons
      gp.buttons.forEach((b, i) => {
        if (b.pressed && !this.prevButtons[i]) this.emit('button', i);
        this.prevButtons[i] = b.pressed;
      });
    } else {
      this.gp = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    }

    // Blend: whichever source deflects an axis further wins that axis.
    let kbActive = false, gpActive = false, tActive = false;
    for (const a of Object.keys(this.sticks)) {
      const kv = this.kb[a], gv = this.gp[a], tv = this.touch[a];
      const best = [kv, gv, tv].reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0);
      this.sticks[a] = best;
      if (Math.abs(kv) > 0.05) kbActive = true;
      if (Math.abs(gv) > 0.05) gpActive = true;
      if (Math.abs(tv) > 0.05) tActive = true;
    }
    if (gpActive) { this.lastSource = 'gamepad'; }
    else if (tActive) { this.lastSource = 'touch'; }
    else if (kbActive) { this.lastSource = 'keyboard'; }
    return this.sticks;
  }

  activeSources() {
    const s = [];
    if (Object.values(this.kb).some(v => Math.abs(v) > 0.05)) s.push('keyboard');
    if (Object.values(this.gp).some(v => Math.abs(v) > 0.05)) s.push('gamepad');
    if (Object.values(this.touch).some(v => Math.abs(v) > 0.05)) s.push('touch');
    return s;
  }

  /** On-screen thumb sticks for touch screens. */
  attachTouch(el, axes) {
    const knob = el.querySelector('i');
    let id = null;
    const set = (x, y) => {
      this.touch[axes[0]] = x; this.touch[axes[1]] = -y;
      if (this.mode === 1 && axes[1] === 'throttle') { this.touch.pitch = -y; this.touch.throttle = 0; }
      if (this.mode === 1 && axes[1] === 'pitch') { this.touch.throttle = -y; this.touch.pitch = 0; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    };
    const move = e => {
      const r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2 - 14)));
      const y = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2 - 14)));
      set(this.shape(x), this.shape(y));
    };
    el.addEventListener('pointerdown', e => { id = e.pointerId; el.setPointerCapture(id); move(e); e.preventDefault(); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = e => { if (e.pointerId !== id) return; id = null; set(0, 0); this.touch.throttle = this.touch.pitch = 0; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  magnitude() { return Math.max(...Object.values(this.sticks).map(Math.abs)); }
}
