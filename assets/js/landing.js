// Landing page: a small live scene of the drone hovering over its pad.
import { topbar } from './core/ui.js';
import { createDrone } from './sim/drone-model.js';

document.getElementById('top').replaceWith(topbar({ active: 'home' }));

const THREE = window.THREE;
const canvas = document.getElementById('heroScene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
catch { canvas.remove(); }

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x13253a, 12, 40);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xdbe9f5, 0x1d3650, 0.9));
  const key = new THREE.DirectionalLight(0xffe6cc, 1.1); key.position.set(-4, 6, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6aa7ff, 0.8); rim.position.set(5, 2, -4); scene.add(rim);

  const grid = new THREE.GridHelper(60, 60, 0x2a4661, 0x223b54); scene.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.04, 64), new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
  const gate = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 10, 48), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6 }));
  gate.position.set(2.6, 2.6, -4); gate.rotation.y = 0.9; scene.add(gate);

  const drone = createDrone();
  drone.root.scale.setScalar(1.9);
  scene.add(drone.root);

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    // keep the drone in the right half on wide screens, centred on narrow ones
    const wide = w > 900;
    camera.position.set(0, 3.4, wide ? 8 : 12);
    camera.lookAt(wide ? -2.6 : 0, wide ? 1.5 : 0.4, 0);
  };
  addEventListener('resize', resize);
  resize();

  const alt = document.getElementById('roAlt'), hdg = document.getElementById('roHdg'), bat = document.getElementById('roBat');
  let t = 0, last = performance.now(), batt = 87;
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    drone.root.position.y = 1.8 + Math.sin(t * 1.3) * 0.18;
    drone.root.rotation.y = Math.sin(t * 0.35) * 0.9;
    drone.tilt.rotation.set(Math.sin(t * 0.9) * 0.06, 0, Math.cos(t * 0.7) * 0.07);
    drone.update(dt, 150, t);
    gate.rotation.y += dt * 0.3;
    renderer.render(scene, camera);
    if (Math.floor(t * 4) !== Math.floor((t - dt) * 4)) {
      alt.textContent = (12 + drone.root.position.y - 1.8).toFixed(1);
      hdg.textContent = String(Math.round(((-drone.root.rotation.y * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
      batt = Math.max(20, batt - 0.01); bat.textContent = Math.round(batt);
    }
    if (!reduced) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
