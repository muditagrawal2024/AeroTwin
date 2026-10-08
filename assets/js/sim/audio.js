// Procedural motor sound (idea from Drone Simulator by Subham): two detuned
// sawtooth oscillators through a low-pass filter, pitch and level follow
// the motor load.
export class MotorAudio {
  constructor() { this.ctx = null; this.volume = 0.5; this.muted = false; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 900; this.filter.Q.value = 0.7;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 110;
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth'; this.o2.frequency.value = 113;
    this.o1.connect(this.filter); this.o2.connect(this.filter);
    this.filter.connect(this.gain); this.gain.connect(ctx.destination);
    this.o1.start(); this.o2.start();
  }
  /** load in [0, 1]; 0 with spinning=false silences the motors. */
  set(load, spinning) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 120 + load * 260;
    const vol = spinning && !this.muted ? (0.05 + load * 0.09) * this.volume : 0;
    this.o1.frequency.setTargetAtTime(f, t, 0.08);
    this.o2.frequency.setTargetAtTime(f * 1.027, t, 0.08);
    this.filter.frequency.setTargetAtTime(600 + load * 1400, t, 0.1);
    this.gain.gain.setTargetAtTime(vol, t, 0.12);
  }
}
