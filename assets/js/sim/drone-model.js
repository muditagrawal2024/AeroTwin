// Procedural quadcopter: carbon body, high-visibility orange canopy,
// spinning props with motion discs, navigation LEDs and a camera gimbal.
const THREE = window.THREE;

export function createDrone({ ghost = false } = {}) {
  const root = new THREE.Group();        // position + heading
  const tilt = new THREE.Group();        // pitch / roll
  root.add(tilt);
  const mat = (color, extra = {}) => ghost
    ? new THREE.MeshBasicMaterial({ color: 0x9fe8de, transparent: true, opacity: 0.35, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...extra });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.5), mat(0x20262d));
  body.castShadow = !ghost;
  tilt.add(body);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff7a1a, { roughness: 0.35 }));
  canopy.scale.set(1, 0.55, 1.35);
  canopy.position.y = 0.05;
  tilt.add(canopy);

  const arms = [];
  const props = [];
  const armMat = mat(0x2c343d);
  const motorMat = mat(0x8a96a3, { metalness: 0.7 });
  const bladeMat = ghost ? mat() : new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.6 });
  const discMat = ghost ? mat() : new THREE.MeshBasicMaterial({ color: 0xbfd6e6, transparent: true, opacity: 0, depthWrite: false });
  [[1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.5), armMat);
    arm.position.set(sx * 0.2, 0.01, sz * 0.2);
    arm.rotation.y = Math.atan2(sx, sz);
    arm.castShadow = !ghost;
    tilt.add(arm); arms.push(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), motorMat);
    motor.position.set(sx * 0.36, 0.04, sz * 0.36);
    tilt.add(motor);
    const prop = new THREE.Group();
    prop.position.set(sx * 0.36, 0.085, sz * 0.36);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.035), bladeMat);
    prop.add(blade);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), discMat);
    disc.rotation.x = -Math.PI / 2;
    prop.add(disc);
    prop.userData = { dir: i === 0 || i === 3 ? 1 : -1, blade, disc };
    tilt.add(prop); props.push(prop);
  });

  // navigation lights: green front, red rear (flash)
  const led = (color, x, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, 0, z); tilt.add(m); return m;
  };
  const leds = ghost ? [] : [led(0x3dff8a, 0.36, -0.42), led(0x3dff8a, -0.36, -0.42), led(0xff3b30, 0.36, 0.42), led(0xff3b30, -0.36, 0.42)];
  leds.forEach(l => { l.position.y = 0.0; l.position.x *= 0.5; });

  // camera gimbal at the nose
  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.07, -0.26);
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.07), mat(0x111417));
  gimbal.add(camBody);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), ghost ? mat() : new THREE.MeshStandardMaterial({ color: 0x0a2a4a, metalness: 0.9, roughness: 0.1 }));
  lens.rotation.x = Math.PI / 2; lens.position.z = -0.04;
  gimbal.add(lens);
  tilt.add(gimbal);

  // landing skids
  if (!ghost) {
    const skidMat = mat(0x2c343d);
    [-0.13, 0.13].forEach(x => {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.36), skidMat);
      skid.position.set(x, -0.11, 0); tilt.add(skid);
      [-0.1, 0.1].forEach(z => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.07, 0.015), skidMat); leg.position.set(x, -0.075, z); tilt.add(leg); });
    });
  }

  // headlight for night flights
  let headlight = null;
  if (!ghost) {
    headlight = new THREE.SpotLight(0xfff1d6, 0, 60, Math.PI / 7, 0.45, 1.2);
    headlight.position.set(0, -0.05, -0.3);
    headlight.target.position.set(0, -2.5, -8);
    tilt.add(headlight, headlight.target);
  }

  // scale the whole model up slightly so it reads well on screen
  root.scale.setScalar(ghost ? 1.6 : 1.6);

  let spin = 0;
  return {
    root, tilt, gimbal, props, headlight,
    update(dt, rpm, t) {
      spin += dt * rpm;
      props.forEach(p => {
        p.rotation.y = spin * p.userData.dir;
        if (!ghost) {
          p.userData.disc.material.opacity = Math.min(0.28, rpm / 140);
          p.userData.blade.visible = rpm < 60;
        }
      });
      if (leds.length) {
        const flash = (t % 1.2) < 0.08;
        leds[2].visible = leds[3].visible = flash || rpm === 0;
      }
    }
  };
}
