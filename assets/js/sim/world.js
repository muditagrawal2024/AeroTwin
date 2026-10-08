// Procedural, seeded world: vertiport, city district, park, radio tower,
// lake and a floating ring course. Every solid thing registers a collider
// so the flight model and autopilot can test against it.
const THREE = window.THREE;

export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, hgt, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export const TOWER = { x: 40, z: 80 };   // block coordinates (x east, z north)
export const toWorld = (x, z) => ({ x, z: -z });

export function buildWorld(scene) {
  const rand = mulberry32(2026);
  const colliders = [];   // { type:'box', minX,maxX,minZ,maxZ, top, bottom } | { type:'cyl', x,z,r, top }
  const night = [];       // materials that glow at night
  const animated = [];

  // ---------- ground ----------
  const groundTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#56704f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${30 + rand() * 40},${60 + rand() * 50},${30 + rand() * 30},${0.15 + rand() * 0.2})`;
      g.fillRect(rand() * w, rand() * h, 2 + rand() * 3, 2 + rand() * 3);
    }
  });
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(1600, 160, 0x9fc3dc, 0x9fc3dc);
  grid.material.transparent = true;
  grid.material.opacity = 0.07;
  grid.position.y = 0.03;
  scene.add(grid);

  // roads
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.95 });
  const road = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); m.receiveShadow = true; scene.add(m);
  };
  road(0, -60, 10, 120);       // home to city
  road(0, -185, 260, 10);      // city avenue
  for (const x of [-90, -30, 30, 90]) road(x, -185, 8, 150);
  road(-60, 0, 120, 8);        // to the park

  // ---------- vertiport (home) ----------
  const padTex = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#2b3743'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f2c14e'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 18, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e7eef5'; g.font = 'bold 120px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', w / 2, w / 2 + 6);
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.8 }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; pad.receiveShadow = true;
  scene.add(pad);
  const padLights = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x3fc6b4 }));
    l.position.set(Math.cos(a) * 4.4, 0.12, Math.sin(a) * 4.4);
    scene.add(l); padLights.push(l);
  }
  animated.push(t => padLights.forEach((l, i) => l.material.color.setHex(((Math.floor(t * 6) + i) % 12) < 2 ? 0xffffff : 0x3fc6b4)));

  // ---------- city district (north) ----------
  const facade = (lit) => canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = lit ? '#000' : '#cfd8e0'; g.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 14) {
      const on = rand() > 0.55;
      g.fillStyle = lit ? (on ? '#ffd9a0' : '#000') : '#42566a';
      g.fillRect(x, y, 8, 10);
    }
  });
  const facadeDay = facade(false), facadeLit = facade(true);
  const palette = [0xc9d3dc, 0xa9bccd, 0x8ea3b6, 0xd8cbbd, 0xb7c7b8];
  const buildings = [];
  for (let bx = -120; bx <= 120; bx += 30) {
    for (let bz = 120; bz <= 250; bz += 26) {
      if (Math.abs(bx) < 8 || Math.abs(bz - 185) < 10) continue;
      if (rand() < 0.15) continue;
      const w = 12 + rand() * 10, d = 10 + rand() * 9;
      const hgt = 10 + Math.pow(rand(), 1.6) * 55 + (Math.abs(bx) < 40 ? 15 : 0);
      buildings.push({ x: bx + (rand() - 0.5) * 4, z: bz + (rand() - 0.5) * 4, w, d, h: hgt });
    }
  }
  // a rooftop landing target
  buildings.push({ x: 60, z: 128, w: 18, d: 18, h: 26, pad: true });
  for (const b of buildings) {
    const day = facadeDay.clone(); day.needsUpdate = true; day.wrapS = day.wrapT = THREE.RepeatWrapping; day.repeat.set(Math.max(1, Math.round(b.w / 6)), Math.max(1, Math.round(b.h / 8)));
    const lit = facadeLit.clone(); lit.needsUpdate = true; lit.wrapS = lit.wrapT = THREE.RepeatWrapping; lit.repeat.copy(day.repeat);
    const mat = new THREE.MeshStandardMaterial({ color: palette[Math.floor(rand() * palette.length)], map: day, emissive: 0xffc77a, emissiveMap: lit, emissiveIntensity: 0, roughness: 0.85 });
    night.push(mat);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5d6b78, roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [mat, mat, roofMat, roofMat, mat, mat]);
    const wp = toWorld(b.x, b.z);
    m.position.set(wp.x, b.h / 2, wp.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    colliders.push({ type: 'box', minX: wp.x - b.w / 2, maxX: wp.x + b.w / 2, minZ: wp.z - b.d / 2, maxZ: wp.z + b.d / 2, top: b.h, bottom: 0, name: b.pad ? 'rooftop pad' : 'building' });
    if (b.pad) {
      const rp = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshStandardMaterial({ map: padTex, transparent: true }));
      rp.rotation.x = -Math.PI / 2; rp.position.set(wp.x, b.h + 0.05, wp.z); scene.add(rp);
    }
  }

  // ---------- park with trees (west), instanced ----------
  const treeCount = 140;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 1, 6);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f6b47, roughness: 0.9 }), treeCount);
  trunks.castShadow = crowns.castShadow = true;
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < treeCount; i++) {
    let x, z;
    do { x = -170 + rand() * 135; z = -70 + rand() * 140; } while (Math.abs(z) < 7 && x > -125);
    const hgt = 7 + rand() * 7, r = 1.6 + rand() * 1.2;
    const wp = toWorld(x, z);
    mtx.compose(new THREE.Vector3(wp.x, hgt * 0.18, wp.z), new THREE.Quaternion(), new THREE.Vector3(1, hgt * 0.36, 1));
    trunks.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(wp.x, hgt * 0.36 + hgt * 0.32, wp.z), new THREE.Quaternion(), new THREE.Vector3(r, hgt * 0.64, r));
    crowns.setMatrixAt(i, mtx);
    colliders.push({ type: 'cyl', x: wp.x, z: wp.z, r: r * 0.85, top: hgt, name: 'tree' });
  }
  scene.add(trunks, crowns);

  // ---------- radio tower ----------
  const tw = toWorld(TOWER.x, TOWER.z);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xd85a2a, roughness: 0.6, metalness: 0.3 });
  const towerWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 9; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.6 - i * 0.14, 1.75 - i * 0.14, 5, 4, 1, true), i % 2 ? towerWhite : towerMat);
    seg.position.set(tw.x, 2.5 + i * 5, tw.z);
    seg.castShadow = true;
    scene.add(seg);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  beacon.position.set(tw.x, 45.6, tw.z);
  scene.add(beacon);
  animated.push(t => beacon.material.color.setHex(Math.sin(t * 4) > 0 ? 0xff3b30 : 0x3a0d0b));
  colliders.push({ type: 'cyl', x: tw.x, z: tw.z, r: 2, top: 46, name: 'radio tower' });

  // ---------- lake (east) ----------
  const lake = new THREE.Mesh(new THREE.CircleGeometry(42, 64), new THREE.MeshStandardMaterial({ color: 0x2c6e8f, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.92 }));
  lake.rotation.x = -Math.PI / 2;
  const lw = toWorld(115, 10);
  lake.position.set(lw.x, 0.05, lw.z);
  scene.add(lake);

  // ---------- ring course ----------
  const ringDefs = [[20, 0, 8], [70, 25, 10], [115, 60, 12], [160, 25, 14], [160, -20, 12], [115, -45, 9], [70, -25, 8], [35, -15, 6]];
  const rings = ringDefs.map(([x, z, y], i) => {
    const next = ringDefs[(i + 1) % ringDefs.length];
    const prev = ringDefs[(i + ringDefs.length - 1) % ringDefs.length];
    const wp = toWorld(x, z), wn = toWorld(next[0], next[1]), wpv = toWorld(prev[0], prev[1]);
    const dir = new THREE.Vector3(wn.x - wpv.x, 0, wn.z - wpv.z).normalize();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.4 });
    const m = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 10, 40), mat);
    m.position.set(wp.x, y, wp.z);
    m.lookAt(wp.x + dir.x, y, wp.z + dir.z);
    scene.add(m);
    return { mesh: m, mat, center: new THREE.Vector3(wp.x, y, wp.z), normal: dir, radius: 3.2, passed: false };
  });

  const world = {
    colliders, rings, night,
    home: new THREE.Vector3(0, 0, 0),
    groundHeightAt(x, z, below = Infinity) {
      let hgt = 0;
      for (const c of colliders) {
        if (c.top > below + 0.3) continue;
        if (c.type === 'box') { if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) hgt = Math.max(hgt, c.top); }
        else if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) hgt = Math.max(hgt, c.top);
      }
      return hgt;
    },
    /** Returns the collider the sphere (x,y,z,r) penetrates from the side, or null. */
    hit(x, y, z, r = 0.35) {
      for (const c of colliders) {
        if (y > c.top - 0.12) continue;
        if (c.type === 'box') {
          if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return c;
        } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return c;
      }
      return null;
    },
    /** Push a point out of a collider horizontally; returns the push normal. */
    pushOut(p, c, r = 0.35) {
      if (c.type === 'box') {
        const opts = [[c.minX - r - p.x, 'x'], [c.maxX + r - p.x, 'x'], [c.minZ - r - p.z, 'z'], [c.maxZ + r - p.z, 'z']];
        opts.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
        const [d, axis] = opts[0];
        p[axis] += d;
        return axis === 'x' ? new THREE.Vector3(Math.sign(d), 0, 0) : new THREE.Vector3(0, 0, Math.sign(d));
      }
      const v = new THREE.Vector3(p.x - c.x, 0, p.z - c.z);
      if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
      v.normalize();
      p.x = c.x + v.x * (c.r + r); p.z = c.z + v.z * (c.r + r);
      return v;
    },
    update(t) { animated.forEach(fn => fn(t)); rings.forEach((r, i) => { if (!r.passed) r.mat.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3 + i); }); },
    setNight(amount) { night.forEach(m => { m.emissiveIntensity = amount * 0.9; }); }
  };
  return world;
}
