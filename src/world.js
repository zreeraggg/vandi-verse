// Environment, obstacles, chillara and bus stops: stylised 3D (soft lit materials, rounded shapes,
// painted canvas textures), curved by the shared bend in fx.js. A Thrissur town road at golden hour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, basic, canvasTex, FONT, gltfLoader, swayMat } from './fx.js';

export const LANE_W = 2.4, ROAD_W = LANE_W * 3 + 1.2, SPAWN_Z = -120;
export const laneX = (l) => (l - 1) * LANE_W;
export const CROWN_Y = 6.4; // falling coconuts hang this high
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const HORIZON = 0xffcf9a; // matches the sky at the vanishing point

// Rounded boxes share geometry per size (templates are cloned many times).
const geoCache = {};
function rgeo(w, h, d, r) {
  const k = [w, h, d, r].join();
  // Rounded corners only where they show: a thin bar or slab would spend ~300 triangles on invisible bevels.
  return (geoCache[k] ??= Math.min(w, h, d) < 0.25 || r < 0.03 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)));
}
function box(w, h, d, m, x = 0, y = 0, z = 0, { r = 0.04, shadow = false, receive = false } = {}) {
  const mesh = new THREE.Mesh(rgeo(w, h, d, r), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = receive;
  return mesh;
}
// Speckle + grime helpers for painted textures.
function speckle(g, w, h, n, a0, a1, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rnd(a0, a1)})`;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}
function grime(g, w, h, from = 0.6) {
  const gr = g.createLinearGradient(0, h * from, 0, h);
  gr.addColorStop(0, 'rgba(60,45,30,0)');
  gr.addColorStop(1, 'rgba(60,45,30,0.35)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}
const rep = (t, x, y) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(x, y); return t; };
// Slice i of an n-slice vertical atlas (slice 0 at the top of the canvas).
function uvSlice(geo, i, n) {
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1) / n + uv.getY(k) / n);
  return geo;
}
// Same geometry, own copy, tinted through vertex colours (lets every wall share one material).
function tinted(geo, hex) {
  const g = geo.clone(), c = new THREE.Color(hex), n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return g;
}
// Merge every mesh under root into one mesh per material (and lines into one per material): a shop of
// 40 parts becomes ~8 draw calls. Shadow flags carry over per material.
// Plain single-colour standard materials also fold into a few shared vertex-coloured ones (by roughness/metal class),
// which saves ~20 draw calls per scenery strip on phones. Textured, glowing, see-through and custom-shader ones keep their own.
const tmpM = new THREE.Matrix4(), vcMats = {}, ROUGH = [0.15, 0.35, 0.55, 0.8];
const plainCache = THREE.Material.prototype.customProgramCacheKey;
function vcMat(m) {
  if (!m.isMeshStandardMaterial || m.map || m.vertexColors || m.transparent || m.alphaTest || m.emissive.getHex() || m.normalMap
    || m.envMapIntensity !== 1 || !m.onBeforeCompile || m.customProgramCacheKey !== plainCache) return null;
  const r = ROUGH.reduce((a, b) => (Math.abs(b - m.roughness) < Math.abs(a - m.roughness) ? b : a));
  const metal = m.metalness >= 0.5 ? 0.85 : 0, key = r + '|' + metal + '|' + m.side;
  return (vcMats[key] ??= mat(0xffffff, { vertexColors: true, roughness: r, metalness: metal, side: m.side }));
}
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh && !o.isLineSegments) return;
    const vc = !o.isLineSegments && vcMat(o.material), material = vc || o.material;
    const key = (o.isLineSegments ? 'L' : 'M') + material.uuid;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: material, line: o.isLineSegments, geos: [], cast: false, recv: false }));
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const keep = o.isLineSegments ? ['position'] : ['position', 'normal', 'uv', ...(material.vertexColors && !vc ? ['color'] : [])];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (vc) { // its colour moves into the vertices; every merged part needs the same attribute set
      const n = g.attributes.position.count, c = o.material.color;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? c.r : i % 3 === 1 ? c.g : c.b)), 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
    }
    tmpM.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(tmpM);
    if (!o.isLineSegments && tmpM.determinant() < 0) { // mirrored: restore the triangle winding
      for (const a of Object.values(g.attributes)) for (let t = 0; t < a.count; t += 3) for (let c = 0; c < a.itemSize; c++) {
        const v = a.getComponent(t + 1, c); a.setComponent(t + 1, c, a.getComponent(t + 2, c)); a.setComponent(t + 2, c, v);
      }
    }
    b.geos.push(g);
    b.cast ||= o.castShadow;
    b.recv ||= o.receiveShadow;
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    const m = b.line ? new THREE.LineSegments(geo, b.mat) : new THREE.Mesh(geo, b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    out.add(m);
  }
  return out;
}

// Sketchfab models (credits in assets/models/CREDITS.md), shrunk for phones: palm.glb ("Coconut Palm" by evolveduk),
// nut.glb (green coconut), auto.glb (Indian tuk tuk) and car.glb (Maruti 800). Loaded before the world is built so they can be baked into the scenery strips.
// A failed load returns {} and the world falls back to its procedural palms and sphere coconut.
export async function loadModels() {
  const loader = gltfLoader, out = {};
  await Promise.all(['palm', 'nut', 'auto', 'car'].map((k) => loader.loadAsync(`assets/models/${k}.glb`).then((g) => (out[k] = g.scene), () => {})));
  return out;
}
// Model meshes → plain meshes with geometry pre-transformed by `m` and world materials (so they bend with the road).
// Obstacles build one template this way and clone it per spawn (clones share geometry and materials).
const litCache = new Map();
function modelMeshes(root, m = new THREE.Matrix4()) {
  const g = new THREE.Group();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    if (!litCache.has(src)) litCache.set(src, mat(0xffffff, { map: src.map, normalMap: src.normalMap, alphaTest: src.alphaTest, side: src.side, roughness: 0.8 }));
    const mesh = new THREE.Mesh(o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld)), litCache.get(src));
    mesh.castShadow = true;
    g.add(mesh);
  });
  return g;
}

// Sky gradient stops for golden hour, dusk (after 2 km) and monsoon rain; setMood() blends between them.
const SKY = {
  day: ['#3d5aa8', '#9a86c4', '#f4a99a', '#ffc98a', '#ffd9a0'],
  dusk: ['#141a3a', '#3b2f5e', '#a0506a', '#e07a4a', '#f0a070'],
  wet: ['#4a5260', '#646c78', '#848b94', '#9aa0a6', '#a8adb2'],
};
const SKY_AT = [0, 0.28, 0.42, 0.52, 1];
const STARS = Array.from({ length: 40 }, (_, i) => [(i * 97) % 256, ((i * 53) % 170) + 4, i % 3 ? 1 : 1.6]); // fixed spots, so they don't jump on redraw
function drawSky(g, w, h, dusk = 0, wet = 0) {
  const c = new THREE.Color(), d = new THREE.Color(), r = new THREE.Color();
  const s = g.createLinearGradient(0, 0, 0, h);
  SKY_AT.forEach((at, i) => s.addColorStop(at, '#' + c.set(SKY.day[i]).lerp(d.set(SKY.dusk[i]), dusk).lerp(r.set(SKY.wet[i]), wet * 0.85).getHexString()));
  g.globalAlpha = 1;
  g.fillStyle = s;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  for (const [x, y, size] of STARS) { g.globalAlpha = dusk * (1 - wet) * 0.8; g.fillRect(x, y, size, size); }
  const sunY = h * (0.5 + dusk * 0.05); // the sun sinks a little at dusk
  g.globalAlpha = 1 - wet; // no sun behind a monsoon deck
  const glow = g.createRadialGradient(w / 2, sunY, 0, w / 2, sunY, 120);
  glow.addColorStop(0, 'rgba(255,240,190,0.95)');
  glow.addColorStop(0.25, dusk > 0.5 ? 'rgba(255,140,90,0.6)' : 'rgba(255,200,120,0.6)');
  glow.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = dusk > 0.5 ? '#ffcf9e' : '#fff6d8';
  g.beginPath(); g.arc(w / 2, sunY, 22, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  // Clouds: pink-lit at golden hour, dim mauve at night, grey in the rain.
  const cloud = (day, night, rain) => '#' + c.set(day).lerp(d.set(night), dusk).lerp(r.set(rain), wet).getHexString();
  for (const [fill, dy] of [[cloud('#e28080', '#3a2c4a', '#6a707a'), 5], [cloud('#ffd6ba', '#5d4a6a', '#969ca6'), 0]]) {
    g.fillStyle = fill;
    for (const [cx, cy, s2] of [[50, 70, 1], [190, 120, 0.8], [120, 40, 0.6], [230, 30, 0.5]]) {
      for (const [dx, ddy, rr] of [[0, 0, 22], [20, -8, 18], [-20, 2, 16], [38, 4, 14], [-36, 6, 12]]) {
        g.beginPath();
        g.arc(cx + dx * s2, cy + (ddy + dy) * s2, rr * s2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.globalAlpha = wet * 0.55; // monsoon cloud deck
  g.fillStyle = '#5d636d';
  g.fillRect(0, 0, w, h * 0.45);
  g.globalAlpha = 1;
}

export function createWorld(scene, renderer, models = {}) {
  // ---------- sky, light, fog
  // shortcut: screen-space background stretches on landscape screens, upgrade to a sky dome if desktop matters.
  const sky = canvasTex(256, 512, (g, w, h) => drawSky(g, w, h));
  scene.background = sky;
  // Image-based light from the same sunset sky: warm horizon bounce on every surface, reflections on glass and water.
  const envSrc = sky.clone();
  envSrc.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envSrc).texture;
  pmrem.dispose();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene.fog = new THREE.Fog(HORIZON, 38, 115);
  const hemi = new THREE.HemisphereLight(0xffe2c4, 0x6d7a4a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb46b, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = matchMedia('(pointer: coarse)').matches ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // soft filtering is ~4x the shadow lookups: desktop only

  // Far Western Ghats silhouettes on the horizon. Not bent like the world (the bend would sink them),
  // so they sit where the curved road meets the sky; they never scroll, like real far hills.
  const hillMats = [];
  // Backwaters at the foot of the hills: a glinting band whose ripples drift slowly (ambient()).
  const waterTex = canvasTex(256, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#b996a6'); gr.addColorStop(1, '#e6b48f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,238,200,0.7)';
    for (let i = 0; i < 60; i++) g.fillRect((i * 71) % w, (i * 13) % h, 4 + (i % 5) * 3, 1);
  });
  waterTex.wrapS = THREE.RepeatWrapping;
  waterTex.repeat.x = 8;
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(520, 3), new THREE.MeshBasicMaterial({ map: waterTex, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    water.position.set(0, -21.6, -139); // just in front of the nearer hills, over their feet
    water.renderOrder = -1;
    scene.add(water);
    hillMats.push(water.material);
    const hillTex = canvasTex(8, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#8a74a8'); gr.addColorStop(0.6, '#c99aa8'); gr.addColorStop(1, '#ffcf9a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    for (const [far, amp, seed, y0] of [[150, 17, 1.3, -23], [140, 10, 4.1, -23]]) {
      const shape = new THREE.Shape();
      shape.moveTo(-260, 0);
      for (let x = -260; x <= 260; x += 8) shape.lineTo(x, amp * (0.55 + 0.3 * Math.sin(x * 0.021 + seed) + 0.15 * Math.sin(x * 0.067 + seed * 2)));
      shape.lineTo(260, 0);
      const geo = new THREE.ShapeGeometry(shape);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5, pos.getY(i) / amp);
      const hills = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: hillTex, fog: false, transparent: true, opacity: far > 145 ? 0.75 : 0.95, depthWrite: false }));
      hills.position.set(0, y0, -far);
      hills.renderOrder = -1;
      scene.add(hills);
      hillMats.push(hills.material); // darkened at dusk / in rain
    }
  }

  // ---------- road, kerbs, footpaths, verge
  const ROAD_LEN = 240, roadZ = -ROAD_LEN / 2 + 20;
  const roadTex = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#5a5c63';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, 0.03, 0.12, 2);
    // darker tyre tracks down each lane, lighter worn crown between them
    for (const lx of [-1, 0, 1]) {
      const cx = ((lx * LANE_W + ROAD_W / 2) / ROAD_W) * w;
      for (const off of [-0.55, 0.55]) {
        const tx = cx + (off * w) / ROAD_W;
        const tg = g.createLinearGradient(tx - 22, 0, tx + 22, 0);
        tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(0.5, 'rgba(20,18,18,0.22)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = tg; g.fillRect(tx - 22, 0, 44, h);
      }
    }
    // patch repairs and cracks
    for (const [x, y, pw, ph] of [[60, 120, 90, 140], [330, 600, 70, 110], [200, 860, 120, 60]]) {
      g.fillStyle = 'rgba(30,30,34,0.28)'; g.fillRect(x, y, pw, ph);
      g.strokeStyle = 'rgba(20,20,20,0.3)'; g.lineWidth = 2; g.strokeRect(x, y, pw, ph);
    }
    g.strokeStyle = 'rgba(25,22,22,0.45)'; g.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rnd(-14, 14); y += rnd(6, 22); g.lineTo(x, y); }
      g.stroke();
    }
    // worn paint: edge lines and lane dashes
    const paint = (x, y, pw, ph) => {
      g.fillStyle = 'rgba(245,242,230,0.92)'; g.fillRect(x, y, pw, ph);
      g.fillStyle = 'rgba(90,92,99,0.55)';
      for (let i = 0; i < (pw * ph) / 30; i++) g.fillRect(x + Math.random() * pw, y + Math.random() * ph, 2, 2);
    };
    paint(12, 0, 12, h); paint(w - 24, 0, 12, h);
    for (const x of [-LANE_W / 2, LANE_W / 2]) {
      const px = ((x + ROAD_W / 2) / ROAD_W) * w;
      paint(px - 6, 0, 12, h * 0.22);
      paint(px - 6, h * 0.5, 12, h * 0.22);
    }
  });
  rep(roadTex, 1, ROAD_LEN / 20);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN, 1, 120), mat(0xffffff, { map: roadTex, roughness: 0.92 }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = roadZ;
  road.receiveShadow = true;
  scene.add(road);

  const grassTex = rep(canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6a9a3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `hsla(${rnd(70, 110)},${rnd(35, 55)}%,${rnd(22, 45)}%,0.6)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, rnd(2, 5));
    }
  }), 60, ROAD_LEN / 4);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(240, ROAD_LEN, 8, 120), mat(0xffffff, { map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.05, roadZ);
  grass.receiveShadow = true;
  scene.add(grass);

  const kerbTex = rep(canvasTex(16, 128, (g) => {
    g.fillStyle = '#ecebe4'; g.fillRect(0, 0, 16, 64);
    g.fillStyle = '#2a2a2e'; g.fillRect(0, 64, 16, 64);
    speckle(g, 16, 128, 160, 0.05, 0.18, 1);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 63, 16, 2); g.fillRect(0, 127, 16, 1);
  }), 1, ROAD_LEN / 2.4);
  // Interlocking zig-zag pavers, grey and terracotta, with dirt in the joints.
  const pathTex = rep(canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5b4b40'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 3 === 0 ? `hsl(18,${rnd(35, 45)}%,${rnd(42, 50)}%)` : `hsl(30,${rnd(6, 12)}%,${rnd(55, 64)}%)`;
      const ox = x * 32 + (y % 2) * 16, oy = y * 16;
      g.beginPath();
      g.moveTo(ox + 1, oy + 1); g.lineTo(ox + 15, oy + 4); g.lineTo(ox + 31, oy + 1);
      g.lineTo(ox + 31, oy + 15); g.lineTo(ox + 15, oy + 12); g.lineTo(ox + 1, oy + 15);
      g.closePath(); g.fill();
      if (ox + 32 > w) { g.save(); g.translate(-w, 0); g.fill(); g.restore(); }
    }
    speckle(g, w, h, 900, 0.04, 0.15, 1);
  }), 2, ROAD_LEN / 1.6);
  const kerbMat = mat(0xffffff, { map: kerbTex, roughness: 0.8, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(0.35, ROAD_LEN, 1, 120), kerbMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(side * (ROAD_W / 2 + 0.17), 0.22, roadZ);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.22, ROAD_LEN, 1, 120), kerbMat);
    face.rotation.order = 'ZYX';
    face.rotation.set(-Math.PI / 2, 0, -side * Math.PI / 2);
    face.position.set(side * ROAD_W / 2, 0.11, roadZ);
    scene.add(top, face);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(2.6, ROAD_LEN, 1, 120), mat(0xffffff, { map: pathTex, roughness: 0.9 }));
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(side * (ROAD_W / 2 + 1.62), 0.2, roadZ);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // ---------- painted textures for buildings
  const plasterTex = rep(canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { // soft blotches
      const x = Math.random() * w, y = Math.random() * h, r = rnd(10, 40);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${Math.random() < 0.5 ? '120,100,80' : '255,255,255'},0.08)`); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(g, w, h, 2500, 0.02, 0.07, 1);
    for (let i = 0; i < 6; i++) { // rain streaks
      const x = Math.random() * w;
      const sg = g.createLinearGradient(0, h * 0.2, 0, h * 0.7);
      sg.addColorStop(0, 'rgba(70,60,50,0.12)'); sg.addColorStop(1, 'rgba(70,60,50,0)');
      g.fillStyle = sg; g.fillRect(x, h * 0.2, rnd(3, 8), h * 0.5);
    }
    grime(g, w, h, 0.7);
  }), 1, 1);
  const tileTex = rep(canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7a3420'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const ox = x * 16 + (y % 2) * 8, oy = y * 16;
      const tg = g.createLinearGradient(0, oy, 0, oy + 16);
      const l = rnd(38, 48);
      tg.addColorStop(0, `hsl(${rnd(12, 20)},55%,${l + 8}%)`); tg.addColorStop(1, `hsl(${rnd(10, 18)},55%,${l - 10}%)`);
      g.fillStyle = tg;
      g.beginPath(); g.ellipse(ox + 8, oy + 8, 7.5, 9, 0, 0, Math.PI * 2); g.fill();
      if (ox + 16 > w) { g.beginPath(); g.ellipse(ox + 8 - w, oy + 8, 7.5, 9, 0, 0, Math.PI * 2); g.fill(); }
    }
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(40,50,30,${rnd(0.05, 0.2)})`; g.fillRect(Math.random() * w, Math.random() * h, rnd(4, 14), rnd(2, 6)); } // moss
  }), 6, 3);
  const lateriteTex = rep(canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#6b3a24'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const ox = x * 32 + (y % 2) * 16;
      g.fillStyle = `hsl(${rnd(14, 22)},${rnd(45, 58)}%,${rnd(36, 46)}%)`;
      g.fillRect(ox + 1, y * 16 + 1, 30, 14);
      if (ox + 32 > w) g.fillRect(ox + 1 - w, y * 16 + 1, 30, 14);
    }
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(40,15,5,${rnd(0.15, 0.4)})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(0.5, 1.6), 0, 7); g.fill(); } // laterite pores
  }), 4, 1);
  const shutterTex = canvasTex(64, 128, (g, w, h) => {
    for (let y = 0; y < h; y += 4) {
      const sg = g.createLinearGradient(0, y, 0, y + 4);
      sg.addColorStop(0, '#c9ccd0'); sg.addColorStop(0.6, '#9ea3a8'); sg.addColorStop(1, '#6f7479');
      g.fillStyle = sg; g.fillRect(0, y, w, 4);
    }
    g.fillStyle = 'rgba(120,70,30,0.25)'; g.fillRect(0, h - 20, w, 20); // rust at the bottom
    speckle(g, w, h, 300, 0.05, 0.15, 1);
  });
  function drawInterior(g, w, h, hue) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#fff2d0'); bg.addColorStop(1, '#c9a070');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const y of [22, 46, 70]) { // shelves full of goods
      g.fillStyle = '#6b4a30'; g.fillRect(4, y + 14, w - 8, 3);
      for (let x = 6; x < w - 8; x += rnd(5, 9)) {
        g.fillStyle = `hsl(${(hue + rnd(-60, 60) + 360) % 360},${rnd(40, 80)}%,${rnd(35, 65)}%)`;
        const ih = rnd(6, 13); g.fillRect(x, y + 14 - ih, rnd(3, 6), ih);
      }
    }
    g.fillStyle = 'rgba(255,255,240,0.9)'; g.fillRect(20, 3, w - 40, 3); // tube light
    g.fillStyle = '#5a3d28'; g.fillRect(0, h - 18, w, 18); // counter
  }
  const woodTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#7a4b2a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(40,20,8,${rnd(0.1, 0.3)})`; g.lineWidth = rnd(0.5, 1.5); const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rnd(-6, 6), h / 3, x + rnd(-6, 6), (2 * h) / 3, x, h); g.stroke(); }
    g.strokeStyle = 'rgba(30,15,5,0.6)'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h / 2 - 6); g.strokeRect(4, h / 2 + 2, w - 8, h / 2 - 6); // panels
  });
  const barkTex = rep(canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = '#7d6450'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(40,28,20,0.45)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(200,180,150,0.18)'; g.fillRect(0, y + 2, w, 2); }
    speckle(g, w, h, 200, 0.05, 0.2, 1);
  }), 2, 10);
  // Palm frond: a rachis with leaflets on a transparent sheet (alpha-tested).
  const frondTex = canvasTex(128, 512, (g, w, h) => {
    g.strokeStyle = '#8a8a3a'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    for (let y = h - 20; y > 10; y -= 9) {
      const t = y / h, len = (w / 2 - 4) * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.1 + 0.05)) ** 0.6;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${rnd(88, 104)},${rnd(45, 60)}%,${rnd(26, 38)}%)`;
        g.lineWidth = rnd(3, 5);
        g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * len * 0.5, y - 10, w / 2 + s * len, y - rnd(18, 28)); g.stroke();
      }
    }
  });
  const bananaTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#5ea640';
    g.beginPath(); g.moveTo(w / 2, h);
    g.bezierCurveTo(w * 1.05, h * 0.7, w * 0.95, h * 0.15, w / 2, 0);
    g.bezierCurveTo(w * 0.05, h * 0.15, -w * 0.05, h * 0.7, w / 2, h); g.fill();
    g.strokeStyle = 'rgba(30,70,20,0.35)'; g.lineWidth = 1;
    for (let y = h - 10; y > 10; y -= 6) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(4, y - 18); g.moveTo(w / 2, y); g.lineTo(w - 4, y - 18); g.stroke(); }
    g.globalCompositeOperation = 'destination-out'; // wind tears
    for (let i = 0; i < 9; i++) { const y = rnd(20, h - 30); g.fillRect(Math.random() < 0.5 ? 0 : w * 0.72, y, w * 0.28, 2); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#c9d77a'; g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
  });

  const M = {
    wall: mat(0xffffff, { map: plasterTex, vertexColors: true }),
    tile: mat(0xffffff, { map: tileTex, roughness: 0.75 }), tile2: mat(0xd8c0b0, { map: tileTex, roughness: 0.75 }),
    laterite: mat(0xffffff, { map: lateriteTex }), concrete: mat(0xcfc8bc, { map: plasterTex }),
    glass: mat(0x2a3540, { roughness: 0.12, metalness: 0.2, envMapIntensity: 1.4 }), frame: mat(0x3b5f7a, { roughness: 0.6 }),
    wood: mat(0xffffff, { map: woodTex, roughness: 0.7 }), shutter: mat(0xffffff, { map: shutterTex, roughness: 0.5, metalness: 0.4 }),
    trunk: mat(0xffffff, { map: barkTex }), tyre: mat(0x1a1a1a, { roughness: 0.9 }), frond: mat(0xffffff, { map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    frond2: mat(0xc8d8a0, { map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    banana: mat(0xffffff, { map: bananaTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }), bananaTrunk: mat(0x8aa048),
    nut: mat(0x7f9a2e, { roughness: 0.5 }), black: mat(0x1e1e22, { roughness: 0.5 }), steel: mat(0xb8bcc0, { roughness: 0.35, metalness: 0.8 }),
    pole: mat(0xb9b4aa, { map: plasterTex }), lamp: mat(0xffe6a8, { emissive: 0xffb84a, emissiveIntensity: 1.6 }), tank: mat(0x23272b, { roughness: 0.45 }),
    bush: mat(0x4e8a34, { roughness: 0.9 }), bush2: mat(0x3f7a2c, { roughness: 0.9 }), pot: mat(0xa8502e, { roughness: 0.8 }),
    canopy: mat(0x35662a, { roughness: 0.9 }), canopy2: mat(0x2b5a24, { roughness: 0.9 }),
    fruit: [mat(0xf08a1c, { roughness: 0.5 }), mat(0xf2d13a, { roughness: 0.5 }), mat(0x6aa83a, { roughness: 0.5 }), mat(0xc0282a, { roughness: 0.45 })],
  };

  // Frond geometry: a strip that droops and folds into a shallow V, UVs along its length.
  function frondGeo(len, wid) {
    const geo = new THREE.PlaneGeometry(wid, len, 2, 10);
    geo.translate(0, len / 2, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / len;
      p.setZ(i, t * t * len * 0.55 + Math.abs(p.getX(i)) * 0.35);
      p.setY(i, p.getY(i) * (1 - t * 0.15));
    }
    geo.computeVertexNormals();
    return geo;
  }
  function crown(top, n, seedLen = 1) {
    const sets = [[], []];
    for (let i = 0; i < n; i++) {
      const f = frondGeo(rnd(3.2, 4.0) * seedLen, 1.3);
      f.rotateX(rnd(0.75, 1.35));
      f.rotateY((i / n) * Math.PI * 2 + rnd(-0.2, 0.2));
      f.translate(top.x, top.y, top.z);
      sets[i % 2].push(f);
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(mergeGeometries(sets[0]), M.frond), new THREE.Mesh(mergeGeometries(sets[1]), M.frond2));
    const nuts = [];
    for (let i = 0; i < 6; i++) nuts.push(new THREE.SphereGeometry(rnd(0.17, 0.22), 10, 8).translate(top.x + Math.cos(i * 1.1) * 0.26, top.y - 0.25 - (i % 2) * 0.12, top.z + Math.sin(i * 1.1) * 0.26));
    const nm = new THREE.Mesh(mergeGeometries(nuts), M.nut);
    nm.castShadow = true;
    g.add(nm);
    return g;
  }
  function palmTemplate(seed) {
    const g = new THREE.Group();
    const lean = 0.6 + seed * 0.6, H = 7.6 + seed * 0.8;
    const top = new THREE.Vector3(lean, H, 0);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.15, H * 0.35, 0), new THREE.Vector3(lean * 0.6, H * 0.72, 0), top]);
    const tube = new THREE.TubeGeometry(curve, 14, 0.17, 8);
    const pos = tube.attributes.position; // taper: wide, flared base
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), c = curve.getPointAt(Math.min(1, Math.max(0, y / H)));
      const k = 1 + 0.6 * Math.max(0, 1 - y / 0.8) - 0.15 * (y / H);
      pos.setX(i, c.x + (pos.getX(i) - c.x) * k); pos.setZ(i, c.z + (pos.getZ(i) - c.z) * k);
    }
    tube.computeVertexNormals();
    const trunk = new THREE.Mesh(tube, M.trunk);
    trunk.castShadow = true;
    g.add(trunk, crown(top, 13));
    return g;
  }
  const palms = models.palm
    ? [1.15, 1.3, 1.45].map((k) => modelMeshes(models.palm, new THREE.Matrix4().makeScale(k, k, k)))
    : [palmTemplate(0), palmTemplate(0.5), palmTemplate(1)];
  // Roadside palms sway in the breeze. Own material copies, so the coconut-drop palm stays still and its nut stays in the crown.
  const swayed = new Map();
  for (const p of palms) p.traverse((o) => { if (o.isMesh) o.material = swayed.get(o.material) ?? swayed.set(o.material, swayMat(o.material)).get(o.material); });

  function bananaTemplate() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 1.9, 9).translate(0, 0.95, 0), M.bananaTrunk));
    const leaves = [];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.PlaneGeometry(0.8, 2.0, 1, 6).translate(0, 1.0, 0);
      const p = f.attributes.position;
      for (let k = 0; k < p.count; k++) { const t = p.getY(k) / 2; p.setZ(k, t * t * 1.0); }
      f.computeVertexNormals();
      f.rotateX(rnd(0.3, 0.8));
      f.rotateY((i / 7) * Math.PI * 2 + rnd(-0.3, 0.3));
      f.translate(0, 1.75, 0);
      leaves.push(f);
    }
    g.add(new THREE.Mesh(mergeGeometries(leaves), M.banana));
    return g;
  }
  const banana = bananaTemplate();
  function bushTemplate() {
    const parts = [];
    for (let i = 0; i < 5; i++) parts.push(new THREE.IcosahedronGeometry(rnd(0.35, 0.55), 1).translate(rnd(-0.5, 0.5), rnd(0.25, 0.5), rnd(-0.5, 0.5)));
    const m = new THREE.Mesh(mergeGeometries(parts), Math.random() < 0.5 ? M.bush : M.bush2);
    m.castShadow = true;
    return m;
  }
  const bushes = [bushTemplate(), bushTemplate()];

  // Mango tree: a stout trunk under a lumpy dark canopy.
  function mangoTemplate() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 3.0, 9).translate(0, 1.5, 0), M.trunk);
    trunk.castShadow = true;
    const parts = [[], []];
    for (let i = 0; i < 9; i++) parts[i % 2].push(new THREE.IcosahedronGeometry(rnd(0.9, 1.4), 1).translate(rnd(-1.2, 1.2), rnd(3.2, 4.6), rnd(-1.2, 1.2)));
    g.add(trunk);
    parts.forEach((pp, k) => { const m = new THREE.Mesh(mergeGeometries(pp), k ? M.canopy : M.canopy2); m.castShadow = true; g.add(m); });
    return g;
  }
  const mangos = [mangoTemplate(), mangoTemplate()];

  // Scooters, rear toward +z, front wheel at -z. 'activa': the everyday Kerala scooter (tall leg shield, boxy rear,
  // long seat, grab rail); 'vespa': retro body with round side cowls and a fender-top tail lamp.
  // Self-contained (own material cache, own wheels) because parked ones are built before the obstacle helpers exist.
  const scootMat = new Map();
  const sm = (hex, o = {}) => scootMat.get(hex + JSON.stringify(o)) ?? scootMat.set(hex + JSON.stringify(o), mat(hex, o)).get(hex + JSON.stringify(o));
  // Side profile (points as [z, y], front = -z) extruded across the scooter with a rounded bevel: smooth, curved panels.
  function panel(pts, width, bevel, m) {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]); // [cz, cy, z, y] = curve through a control point
      else sh.lineTo(p[0], p[1]);
    }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10 });
    geo.translate(0, 0, -width / 2).rotateY(-Math.PI / 2); // shape plane → side view; extrusion → across (x)
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    return mesh;
  }
  let plateMat;
  function scooterBody(style, paint) {
    const vespa = style === 'vespa';
    const g = new THREE.Group(), body = sm(paint, { roughness: 0.22, metalness: 0.35 }), dark = sm(0x1c1c1f, { roughness: 0.6 });
    const trim = sm(vespa ? 0x6b4a32 : 0x3a3d42, { roughness: 0.45 }); // Vespa: brown seat; Activa: grey lower panels
    const chrome = sm(0xdfe3e6, { roughness: 0.12, metalness: 1 }), alloy = sm(0x9da3a8, { roughness: 0.3, metalness: 0.8 });
    const tail = sm(0xff2a1a, { emissive: 0xff1a0a, emissiveIntensity: 0.9 }), amber = sm(0xffa000, { emissive: 0xff8000, emissiveIntensity: 0.5 });
    const lamp = sm(0xfff2cc, { emissive: 0xffd27a, emissiveIntensity: 1.1 });
    plateMat ??= mat(0xffffff, { map: canvasTex(128, 48, (c, w, h) => {
      c.fillStyle = '#f5f5f0'; c.fillRect(0, 0, w, h); c.strokeStyle = '#222'; c.lineWidth = 3; c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = '#111'; c.font = `800 20px ${FONT}`; c.textAlign = 'center'; c.fillText('KL 08', w / 2, 21); c.fillText('BK 7291', w / 2, 41);
    }) });
    const cyl = (r1, r2, len, m, seg = 14) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), m);

    // Wheels: tyre, alloy rim with five spokes, hub; the front one gets a brake disc. Wheels go first (main.js spins children 0 and 1).
    for (const [z, front] of [[-0.62, true], [0.58, false]]) {
      const w = new THREE.Group();
      w.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.068, 10, 24).rotateY(Math.PI / 2), dark));
      w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.07, 20).rotateZ(Math.PI / 2), alloy));
      for (let i = 0; i < 5; i++) { const sp = box(0.075, 0.2, 0.03, alloy, 0, 0, 0, { r: 0.01 }); sp.rotation.x = (i / 5) * Math.PI * 2; w.add(sp); }
      w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10).rotateZ(Math.PI / 2), chrome));
      if (front) { const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 18).rotateZ(Math.PI / 2), chrome); disc.position.x = 0.06; w.add(disc); }
      w.position.set(0, 0.26, z);
      g.add(w);
    }
    // Front: fork legs and a curved fender hugging the tyre.
    for (const x of [-0.08, 0.08]) { const f = cyl(0.025, 0.025, 0.7, chrome, 8); f.position.set(x, 0.6, -0.66); f.rotation.x = 0.28; g.add(f); }
    const fender = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.06, 8, 16, Math.PI * 0.75).rotateY(Math.PI / 2), body);
    fender.scale.set(1.5, 1, 1);
    fender.rotation.x = Math.PI * 0.12;
    fender.position.set(0, 0.26, -0.62);
    g.add(fender);

    // Leg shield / apron: curved front face sweeping up to the handlebar.
    g.add(panel([[-0.36, 0.32], [-0.5, 0.3], [-0.72, 0.55, -0.66, 0.96], [-0.58, 0.99], [-0.56, 0.6, -0.36, 0.4]], vespa ? 0.28 : 0.3, 0.07, body)); // thinner shell
    if (!vespa) g.add(panel([[-0.36, 0.3], [-0.5, 0.29], [-0.6, 0.38], [-0.38, 0.4]], 0.36, 0.04, trim)); // grey lower apron trim
    else g.add(box(0.05, 0.05, 0.18, chrome, 0, 0.8, -0.62, { r: 0.02 })); // horn-cast badge on the Vespa nose
    // Floorboard with rubber mat strips.
    g.add(box(0.38, 0.06, 0.52, trim, 0, 0.3, -0.1, { r: 0.03 }));
    for (let i = 0; i < 4; i++) g.add(box(0.3, 0.012, 0.03, dark, 0, 0.335, -0.3 + i * 0.12, { r: 0.004 }));

    // Rear body: Activa = long smooth teardrop with grey skirt and chrome strip; Vespa = slim core with two round cowls.
    if (vespa) {
      g.add(panel([[-0.05, 0.34], [0.62, 0.38], [0.84, 0.56, 0.7, 0.76], [-0.05, 0.74], [-0.14, 0.55, -0.05, 0.34]], 0.16, 0.06, body));
      for (const x of [-0.17, 0.17]) {
        const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 14), body);
        cowl.scale.set(0.8, 0.95, 1.85);
        cowl.position.set(x, 0.5, 0.34);
        cowl.castShadow = true;
        g.add(cowl, box(0.02, 0.02, 0.5, chrome, x * 1.32, 0.42, 0.32, { r: 0.008 })); // chrome strip low on each cowl
      }
      g.add(panel([[0.6, 0.62], [0.82, 0.6], [0.88, 0.7, 0.78, 0.78], [0.6, 0.76]], 0.14, 0.03, body)); // rear fender
      g.add(box(0.16, 0.08, 0.08, tail, 0, 0.8, 0.8, { r: 0.03 })); // tail lamp on the fender
    } else {
      g.add(panel([[-0.05, 0.36], [0.6, 0.4], [0.82, 0.5, 0.78, 0.7], [0.62, 0.78], [-0.05, 0.76], [-0.12, 0.55, -0.05, 0.36]], 0.22, 0.11, body)); // fat bevel = rounded flanks
      g.add(panel([[0.0, 0.34], [0.56, 0.37], [0.62, 0.45], [0.0, 0.43]], 0.42, 0.02, trim));
      for (const x of [-0.235, 0.235]) g.add(box(0.012, 0.025, 0.55, chrome, x, 0.6, 0.3, { r: 0.006 }));
      g.add(box(0.26, 0.09, 0.05, tail, 0, 0.68, 0.82, { r: 0.03 }));
    }
    for (const x of [-0.17, 0.17]) g.add(box(0.06, 0.05, 0.04, amber, x, vespa ? 0.72 : 0.68, vespa ? 0.78 : 0.81, { r: 0.015 })); // rear indicators
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), plateMat);
    plate.position.set(0, 0.5, vespa ? 0.8 : 0.79);
    g.add(plate);

    // Seat: curved cushion with a chrome piping line; curved grab rail behind it (Activa).
    g.add(panel([[-0.12, 0.76], [0.6, 0.78], [0.72, 0.82, 0.66, 0.88], [0.3, 0.92, -0.04, 0.9], [-0.16, 0.86, -0.12, 0.76]], 0.24, 0.05, vespa ? trim : dark));
    g.add(box(0.36, 0.012, 0.7, chrome, 0, 0.8, 0.26, { r: 0.005 }));
    if (!vespa) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 14, Math.PI).rotateX(-Math.PI / 2), chrome);
      rail.position.set(0, 0.86, 0.62);
      g.add(rail);
    }
    // Handlebar: casing or cowl, headlamp, speedo dome, bar with grips and levers, round mirrors, front indicators.
    if (vespa) {
      g.add(box(0.44, 0.12, 0.16, body, 0, 1.04, -0.56, { r: 0.06 }));
      const head = cyl(0.085, 0.085, 0.05, lamp, 18).rotateX(Math.PI / 2);
      head.position.set(0, 1.05, -0.65);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.014, 6, 18), chrome);
      bezel.position.set(0, 1.05, -0.675);
      g.add(head, bezel);
    } else {
      g.add(panel([[-0.48, 0.94], [-0.7, 0.96], [-0.66, 1.08], [-0.5, 1.1]], 0.4, 0.05, body));
      g.add(box(0.24, 0.08, 0.03, lamp, 0, 1.0, -0.74, { r: 0.03 }));
      for (const x of [-0.19, 0.19]) g.add(box(0.07, 0.04, 0.03, amber, x, 1.0, -0.72, { r: 0.012 }));
    }
    const speedo = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm(0x222a33, { roughness: 0.1, metalness: 0.3 }));
    speedo.position.set(0, 1.1, -0.5);
    const bar = cyl(0.016, 0.016, 0.62, chrome, 8).rotateZ(Math.PI / 2);
    bar.position.set(0, 1.12, -0.52);
    g.add(speedo, bar);
    for (const sd of [-1, 1]) {
      const grip = cyl(0.025, 0.025, 0.12, dark, 10).rotateZ(Math.PI / 2);
      grip.position.set(sd * 0.29, 1.12, -0.52);
      const stalk = cyl(0.008, 0.008, 0.22, chrome, 6);
      stalk.position.set(sd * 0.22, 1.24, -0.53);
      stalk.rotation.z = -sd * 0.25;
      const mirror = cyl(0.045, 0.045, 0.015, chrome, 14).rotateX(Math.PI / 2);
      mirror.position.set(sd * 0.25, 1.35, -0.53);
      g.add(grip, box(0.14, 0.012, 0.02, chrome, sd * 0.25, 1.11, -0.57, { r: 0.004 }), stalk, mirror);
    }
    // Exhaust: muffler with a chrome tip and black heat shield. Footrests and a side stand.
    const muff = cyl(0.055, 0.06, 0.42, dark, 12).rotateX(Math.PI / 2);
    muff.position.set(0.2, 0.3, 0.42);
    const tip = cyl(0.035, 0.035, 0.08, chrome, 10).rotateX(Math.PI / 2);
    tip.position.set(0.2, 0.31, 0.66);
    g.add(muff, tip, box(0.02, 0.07, 0.3, sm(0x2a2a2a, { roughness: 0.4, metalness: 0.6 }), 0.265, 0.33, 0.4, { r: 0.01 }));
    for (const sd of [-1, 1]) g.add(box(0.1, 0.02, 0.05, dark, sd * 0.24, 0.36, 0.2, { r: 0.01 }));
    const stand = cyl(0.012, 0.012, 0.22, dark, 6);
    stand.position.set(-0.16, 0.12, 0.05);
    stand.rotation.z = 0.5;
    g.add(stand);
    return g;
  }
  // Parked on the side stand, nose toward the road.
  function scooterTemplate([style, paint]) {
    const g = scooterBody(style, paint);
    g.rotation.z = 0.08;
    g.rotation.y = rnd(-0.4, 0.4);
    return g;
  }
  const scooters = [['activa', 0xf2f2ee], ['activa', 0x9aa0a6], ['vespa', 0x8d8478], ['activa', 0xb71c1c], ['vespa', 0x8fd3c1]].map(scooterTemplate);

  // Fruit stall: stacked wooden crates heaped with oranges, bananas, guavas and apples, under an umbrella.
  function stallTemplate() {
    const g = new THREE.Group();
    const fruit = [[], [], [], []];
    [[0, 0.25, -0.5], [0, 0.25, 0.5], [0.05, 0.75, 0]].forEach(([x, y, z], k) => {
      g.add(box(0.7, 0.5, 0.9, M.wood, x, y, z, { r: 0.03, shadow: true }));
      for (let i = 0; i < 14; i++) fruit[(k + i) % 4].push(new THREE.SphereGeometry(rnd(0.07, 0.1), 8, 6).translate(x + rnd(-0.28, 0.28), y + 0.28 + rnd(0, 0.08), z + rnd(-0.36, 0.36)));
    });
    fruit.forEach((f, k) => g.add(new THREE.Mesh(mergeGeometries(f), M.fruit[k])));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 6).translate(0.3, 1.1, 0), M.steel));
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.45, 8, 1, true).translate(0.3, 2.25, 0), mat(0x1565c0, { side: THREE.DoubleSide, roughness: 0.7 }));
    umb.castShadow = true;
    g.add(umb);
    return g;
  }
  const stall = stallTemplate();

  // Kerala milestone: white stone with a yellow cap, the distance to town painted on it.
  const milestoneTex = canvasTex(64, 96, (g, w, h) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2b51c'; g.beginPath(); g.arc(w / 2, 30, 30, Math.PI, 0); g.fill(); g.fillRect(2, 28, w - 4, 6);
    g.fillStyle = '#222'; g.textAlign = 'center';
    g.font = `800 11px ${FONT}`; g.fillText('THRISSUR', w / 2, 52);
    g.font = `800 20px ${FONT}`; g.fillText('3', w / 2, 76);
    g.font = `700 9px ${FONT}`; g.fillText('KM', w / 2, 88);
  });
  function milestoneTemplate() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.2, 0); shape.lineTo(0.2, 0); shape.lineTo(0.2, 0.42); shape.absarc(0, 0.42, 0.2, 0, Math.PI, false); shape.lineTo(-0.2, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
    geo.translate(0, 0, -0.07);
    const uv = geo.attributes.uv, pos = geo.attributes.position; // paint maps straight onto the stone's outline
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 0.2) / 0.4, pos.getY(i) / 0.62);
    const m = new THREE.Mesh(geo, mat(0xffffff, { map: milestoneTex, roughness: 0.8 }));
    m.rotation.y = Math.PI / 2; // painted face toward the oncoming road
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  const milestone = milestoneTemplate();

  // Real Thrissur names (a fun nod to the town, not endorsements).
  const SHOPS = [
    ['KALYAN SILKS', 'Textiles · Thrissur', '#8e1b1b', '#ffd27a'], ['JOYALUKKAS', 'Jewellery', '#1a3a6b', '#ffd36b'],
    ['PATHANS', 'Restaurant · Round South', '#0f5132', '#ffffff'], ['INDIAN COFFEE HOUSE', 'Coffee · Masala Dosa', '#6d3b1f', '#ffe9b0'],
    ['HOTEL BHARATH', 'Pure Vegetarian', '#b5481a', '#fff4d6'], ['CURRENT BOOKS', 'Books · Thrissur', '#22303c', '#f2c94c'],
    ['CHEMMANUR', 'Jewellers', '#5a1f6e', '#ffd36b'], ['KALYAN JEWELLERS', 'Trust is everything', '#7a1020', '#f7d58a'],
  ];
  const WALLS = [0xf3c98b, 0x9fd3e6, 0xc6e0a3, 0xf6dd8a, 0xd9c2ea, 0xf3b9b0, 0xa9dccf, 0xf1ead2];
  // All shop interiors and signboards live in two atlases, so every shop shares two materials.
  const interiorAtlas = canvasTex(128, 96 * SHOPS.length, (g) => SHOPS.forEach((_, i) => { g.save(); g.translate(0, i * 96); drawInterior(g, 128, 96, i * 47); g.restore(); }));
  const signAtlas = canvasTex(512, 128 * SHOPS.length, (c) => SHOPS.forEach((shop, i) => { c.save(); c.translate(0, i * 128); drawSign(c, 512, 128, shop); c.restore(); }));
  const interiorMat = mat(0xffffff, { map: interiorAtlas, emissive: 0xffffff, emissiveMap: interiorAtlas, emissiveIntensity: 0.55 });
  const signMat = mat(0xffffff, { map: signAtlas, emissive: 0xffffff, emissiveMap: signAtlas, emissiveIntensity: 0.35, roughness: 0.5 });
  function drawSign(c, w, h, [name, sub, bg, fg]) {
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, bg); gr.addColorStop(1, new THREE.Color(bg).multiplyScalar(0.7).getStyle());
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.lineWidth = 4; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    let size = 64;
    c.font = `800 ${size}px ${FONT}`;
    while (c.measureText(name).width > w - 50) { size -= 2; c.font = `800 ${size}px ${FONT}`; }
    c.fillText(name, w / 2, 74);
    c.font = `700 26px ${FONT}`; c.globalAlpha = 0.85; c.fillText(sub, w / 2, 110); c.globalAlpha = 1;
  }
  function shopTemplate(i) {
    const shop = SHOPS[i], g = new THREE.Group();
    const two = i % 3 !== 1, H = two ? 6.6 : 3.8, w = 5.6, d = 5;
    const wall = box(d, H, w, M.wall, d / 2, H / 2, 0, { r: 0.08, shadow: true, receive: true });
    wall.geometry = tinted(wall.geometry, WALLS[i]);
    g.add(wall);
    // Ground floor: lit interior behind a half-raised shutter, between two pillars.
    const inner = new THREE.Mesh(uvSlice(new THREE.PlaneGeometry(w * 0.78, 2.5), i, SHOPS.length), interiorMat);
    inner.rotation.y = -Math.PI / 2;
    inner.position.set(-0.01, 1.25, 0);
    const shutter = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.7), M.shutter);
    shutter.rotation.y = -Math.PI / 2;
    shutter.position.set(-0.03, 2.2, 0);
    g.add(inner, shutter);
    for (const z of [-w / 2 + 0.25, w / 2 - 0.25]) g.add(box(0.4, 2.7, 0.4, M.concrete, -0.1, 1.35, z, { shadow: true }));
    g.add(box(0.5, 0.18, w + 0.1, M.concrete, -0.1, 0.09, 0, { receive: true })); // step
    // Sunshade slab, then the signboard above it.
    g.add(box(1.1, 0.14, w + 0.2, M.concrete, -0.45, 2.75, 0, { shadow: true }));
    const sign = new THREE.Mesh(uvSlice(new THREE.PlaneGeometry(w * 0.94, 1.05), i, SHOPS.length), signMat);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(-0.13, 3.35, 0);
    g.add(box(0.12, 1.2, w * 0.98, M.black, -0.05, 3.35, 0), sign);
    if (two) {
      for (const z of [-1.35, 1.35]) { // upper windows: frame, glass with grill, sunshade
        g.add(box(0.14, 1.35, 1.25, M.frame, -0.02, 4.75, z));
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.15), M.glass);
        glass.rotation.y = -Math.PI / 2;
        glass.position.set(-0.1, 4.75, z);
        g.add(glass, box(0.55, 0.08, 1.6, M.concrete, -0.27, 5.55, z, { shadow: true }));
        for (let k = -2; k <= 2; k++) g.add(box(0.03, 1.1, 0.03, M.black, -0.12, 4.75, z + k * 0.2, { r: 0.01 }));
      }
      g.add(box(d + 0.2, 0.35, w + 0.2, M.concrete, d / 2, H + 0.17, 0, { r: 0.05 })); // parapet lip
      if (i % 2 === 0) { // black water tank on the roof
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 16), M.tank);
        tank.position.set(d * 0.6, H + 0.9, w * 0.25);
        tank.castShadow = true;
        g.add(tank);
      }
    } else { // single storey: tiled hip roof
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.7, 4, 1), M.tile);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(0.98, 1, 1.12);
      roof.position.set(d / 2, H + 0.85, 0);
      roof.castShadow = true;
      g.add(roof);
    }
    return g;
  }
  const shops = SHOPS.map((_, i) => shopTemplate(i));

  function houseTemplate(i) {
    const g = new THREE.Group();
    // Laterite compound wall with plastered gate pillars and caps.
    g.add(box(0.35, 1.1, 8.6, M.laterite, 0.2, 0.75, 0, { r: 0.03, shadow: true }));
    for (const z of [-1.3, 1.3]) g.add(box(0.55, 1.6, 0.55, M.concrete, 0.2, 1.0, z, { shadow: true }), box(0.7, 0.15, 0.7, M.concrete, 0.2, 1.85, z));
    const W = 5.6, D = 6.6, x0 = 5.6;
    const body = box(W, 3, D, M.wall, x0, 1.5, 0, { r: 0.06, shadow: true, receive: true });
    body.geometry = tinted(body.geometry, WALLS[(i + 3) % WALLS.length]);
    g.add(body);
    // Verandah: plinth, round pillars, wooden door and windows.
    g.add(box(1.4, 0.35, D * 0.7, M.concrete, x0 - W / 2 - 0.55, 0.17, 0, { receive: true }));
    for (const z of [-D * 0.3, D * 0.3]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.7, 12), M.concrete);
      p.position.set(x0 - W / 2 - 1.05, 1.7, z);
      p.castShadow = true;
      g.add(p);
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), M.wood);
    door.rotation.y = -Math.PI / 2;
    door.position.set(x0 - W / 2 - 0.01, 1.2, 0);
    g.add(door);
    for (const z of [-1.9, 1.9]) {
      g.add(box(0.1, 1.15, 1.05, M.wood, x0 - W / 2 - 0.02, 1.7, z), box(0.4, 0.07, 1.3, M.concrete, x0 - W / 2 - 0.2, 2.35, z));
    }
    // Kerala two-tier tiled hip roof with deep eaves over the verandah.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 1.9, 4, 1), i % 2 ? M.tile : M.tile2);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 1.2);
    roof.position.set(x0 - 0.5, 3.9, 0);
    roof.castShadow = true;
    const roof2 = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.4, 4, 1), M.tile);
    roof2.rotation.y = Math.PI / 4;
    roof2.position.set(x0, 5.05, 0);
    roof2.castShadow = true;
    g.add(roof, roof2);
    // Front yard: a tulasi thara (raised holy-basil pedestal) and potted plants on the verandah edge.
    g.add(box(0.7, 0.7, 0.7, M.concrete, 1.9, 0.35, -2.4, { r: 0.06, shadow: true }), box(0.85, 0.12, 0.85, M.tile2, 1.9, 0.76, -2.4, { r: 0.03 }));
    const tulasi = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1).translate(1.9, 1.08, -2.4), M.bush);
    tulasi.castShadow = true;
    g.add(tulasi);
    for (const z of [-1.2, 1.2]) {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.35, 10).translate(x0 - W / 2 - 1.1, 0.52, z), M.pot));
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1).translate(x0 - W / 2 - 1.1, 0.88, z), M.bush2));
    }
    return g;
  }
  const houses = [0, 1, 2, 3].map(houseTemplate);

  // Concrete electric pole with a crossarm, insulators, a sodium street lamp, and sagging wires to the next pole.
  const POLE_GAP = 26;
  function postTemplate() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 8.4, 6).translate(0, 4.2, 0), M.pole);
    pole.castShadow = true;
    g.add(pole, box(0.12, 0.12, 1.8, M.pole, 0, 7.7, 0, { r: 0.02 }));
    for (const z of [-0.8, 0, 0.8]) g.add(box(0.07, 0.16, 0.07, mat(0x8fb7c9, { roughness: 0.3 }), 0, 7.86, z, { r: 0.02 }));
    g.add(box(1.2, 0.07, 0.07, M.steel, -0.6, 6.9, 0, { r: 0.02 }), box(0.45, 0.12, 0.22, M.steel, -1.15, 6.85, 0), box(0.36, 0.04, 0.16, M.lamp, -1.15, 6.78, 0, { r: 0.01 }));
    const wire = [];
    for (const z of [-0.8, 0, 0.8]) {
      for (let k = 0; k < 12; k++) {
        const t0 = k / 12, t1 = (k + 1) / 12;
        const y0 = 7.9 - Math.sin(Math.PI * t0) * 0.7, y1 = 7.9 - Math.sin(Math.PI * t1) * 0.7;
        wire.push(0, y0, z - t0 * POLE_GAP, 0, y1, z - t1 * POLE_GAP);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    // Wires keep the world's bend: line materials use the same basic shader as MeshBasicMaterial.
    const wm = new THREE.LineBasicMaterial({ color: 0x1d1d22 });
    wm.onBeforeCompile = basic({}).onBeforeCompile;
    g.add(new THREE.LineSegments(wg, wm));
    // Sodium glow round the lamp (two crossed quads, readable from any side) and its pool of light on the road.
    // One shared additive material, invisible until dusk (setMood).
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).translate(-1.15, 6.7, 0), lampGlow));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateY(Math.PI / 2).translate(-1.15, 6.7, 0), lampGlow));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5).rotateX(-Math.PI / 2).translate(-1.6, -0.17, 0), lampGlow));
    return g;
  }
  const glowTex = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  const lampGlow = basic({ map: glowTex, color: 0xffb44a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const post = postTemplate();

  // Festival bunting strung across the road between poles: paper triangles in four colours on a sagging string.
  const BUNT = [0xd62828, 0xffcc33, 0x2e9e4f, 0x2f6fd6].map((c) => mat(c, { side: THREE.DoubleSide, roughness: 0.8 }));
  function buntingTemplate() {
    const half = ROAD_W / 2 + 0.9, tris = [[], [], [], []], line = [];
    const yAt = (x) => 6.6 - 0.6 * (1 - (x / half) ** 2); // lowest flag tip ~5.6 m: above the game-over camera (5.4 m)
    let k = 0;
    for (let x = -half + 0.1; x < half - 0.4; x += 0.5, k++) {
      const y0 = yAt(x), y1 = yAt(x + 0.4), ym = yAt(x + 0.2);
      const t = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([x, y0, 0, x + 0.4, y1, 0, x + 0.2, ym - 0.38, 0], 3));
      t.computeVertexNormals();
      tris[k % 4].push(t);
    }
    for (let x = -half; x < half; x += 0.25) line.push(x, yAt(x), 0, x + 0.25, yAt(x + 0.25), 0);
    const g = new THREE.Group();
    tris.forEach((list, i) => g.add(new THREE.Mesh(mergeGeometries(list), BUNT[i])));
    const lg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
    const lm = new THREE.LineBasicMaterial({ color: 0x2a2626 });
    lm.onBeforeCompile = basic({}).onBeforeCompile;
    g.add(new THREE.LineSegments(lg, lm));
    return g;
  }
  const bunting = buntingTemplate();

  // Chayakkada, the way the old ones looked: a brass samovar, a glass cabinet of pazhampori and vada, jars of snacks,
  // steel tumblers, the day's paper, a blue bench and a plantain bunch hanging off the front of the roof.
  // The empty `steam` marker tells ambient() where to puff steam from (the bake keeps only meshes).
  const chaiSign = canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = '#1d6b3a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffe9a8'; g.font = `800 46px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ചായക്കട · TEA SHOP', w / 2, h / 2 + 3);
  });
  const CM = {
    roof: mat(0xb03a2e, { roughness: 0.8 }), sign: mat(0xffffff, { map: chaiSign, emissive: 0xffffff, emissiveMap: chaiSign, emissiveIntensity: 0.25 }),
    brass: mat(0xc8962e, { roughness: 0.3, metalness: 0.85 }), see: mat(0xdff0ff, { roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
    fry: mat(0xb8711f, { roughness: 0.6 }), plantain: mat(0xd9c43a, { roughness: 0.55 }), stalk: mat(0x5a4a24, { roughness: 0.9 }),
    lid: mat(0xc0282a, { roughness: 0.5 }), paper: mat(0xece6d6, { roughness: 0.9 }), bench: mat(0x2f6fd6, { roughness: 0.7 }),
  };
  function chaiTemplate() {
    const g = new THREE.Group();
    const add = (geo, m) => { const o = new THREE.Mesh(geo, m); g.add(o); return o; };
    g.add(box(0.8, 1.0, 1.6, M.wood, 0, 0.5, 0, { r: 0.03, shadow: true }), box(0.9, 0.06, 1.7, M.steel, 0, 1.03, 0, { r: 0.01 }));
    // brass samovar with its chimney and a tap toward the road
    add(new THREE.CylinderGeometry(0.15, 0.18, 0.42, 14).translate(0.12, 1.27, 0.0), CM.brass);
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 10).translate(0.12, 1.58, 0.0), CM.brass);
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 6).rotateZ(Math.PI / 2).translate(-0.06, 1.14, 0.0), CM.brass);
    // glass cabinet with fried snacks: pazhampori (long) and vada (round)
    add(new THREE.BoxGeometry(0.42, 0.3, 0.5).translate(-0.12, 1.21, -0.42), CM.see);
    for (let i = 0; i < 4; i++) add(new THREE.CapsuleGeometry(0.035, 0.1, 3, 8).rotateX(Math.PI / 2).translate(-0.2 + (i % 2) * 0.12, 1.1 + (i >> 1) * 0.07, -0.55 + (i % 2) * 0.05), CM.fry);
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).translate(-0.12 + (i % 2) * 0.1, 1.09 + (i >> 1) * 0.05, -0.3), CM.fry);
    // jars of snacks (banana chips, laddu, achappam) with red lids
    [[0.5, M.fruit[1]], [0.7, M.fruit[0]], [0.9, CM.fry]].forEach(([z, m]) => {
      add(new THREE.CylinderGeometry(0.09, 0.09, 0.26, 12).translate(-0.18, 1.19, z - 0.2), CM.see);
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10).translate(-0.18, 1.14, z - 0.2), m);
      add(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 12).translate(-0.18, 1.34, z - 0.2), CM.lid);
    });
    // stacked steel tumblers and the newspaper
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.045, 0.036, 0.12, 10).translate(0.18, 1.12 + i * 0.07, 0.4), M.steel);
    add(new THREE.BoxGeometry(0.28, 0.015, 0.36).rotateY(0.3).translate(0.2, 1.07, 0.62), CM.paper);
    g.add(box(0.05, 1.35, 0.05, M.wood, 0.35, 1.7, -0.78), box(0.05, 1.35, 0.05, M.wood, 0.35, 1.7, 0.78));
    g.add(box(1.4, 0.06, 2.0, CM.roof, 0.05, 2.4, 0, { shadow: true }));
    add(new THREE.PlaneGeometry(1.8, 0.34).rotateY(-Math.PI / 2).translate(-0.66, 2.2, 0), CM.sign);
    // plantain bunch on a string from the front of the roof, beside the board
    const bunch = [new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4).translate(0, 2.22, 0), new THREE.CylinderGeometry(0.025, 0.03, 0.62, 6).translate(0, 1.8, 0)];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + r * 0.45;
      bunch.push(new THREE.CapsuleGeometry(0.028, 0.13, 3, 6).rotateZ(-0.55).translate(0.07, 0.03, 0).rotateY(a).translate(0, 2.0 - r * 0.1, 0));
    }
    const fruitGeo = mergeGeometries(bunch.slice(2)), stalkGeo = mergeGeometries(bunch.slice(0, 2));
    add(stalkGeo.translate(-0.52, 0, -0.78), CM.stalk);
    add(fruitGeo.translate(-0.52, 0, -0.78), CM.plantain).castShadow = true;
    // blue bench along the side
    g.add(box(0.4, 0.05, 1.1, CM.bench, -0.1, 0.45, 1.45, { r: 0.01 }), box(0.05, 0.43, 0.05, CM.bench, -0.25, 0.22, 1.0), box(0.05, 0.43, 0.05, CM.bench, -0.25, 0.22, 1.9),
      box(0.05, 0.43, 0.05, CM.bench, 0.05, 0.22, 1.0), box(0.05, 0.43, 0.05, CM.bench, 0.05, 0.22, 1.9));
    const steam = new THREE.Object3D();
    steam.position.set(0.12, 1.7, 0.0);
    steam.userData.steam = true;
    g.add(steam);
    return g;
  }
  const chai = chaiTemplate();

  // ---------- place scenery along both sides, in CHUNKS strips that are each baked into a few meshes.
  // A strip that has passed behind the camera jumps back one span (the street repeats every SPAN metres).
  const SPAN = 15 - SPAWN_Z, CHUNKS = 8, CL = SPAN / CHUNKS;
  const strips = Array.from({ length: CHUNKS }, (_, k) => {
    const g = new THREE.Group();
    g.position.z = SPAWN_Z + (k + 1) * CL; // origin at the strip's near end
    return g;
  });
  function put(obj, z) {
    const g = strips[Math.min(CHUNKS - 1, Math.max(0, Math.floor((z - SPAWN_Z) / CL)))];
    obj.position.z = z - g.position.z;
    g.add(obj);
  }
  function place(obj, side, x, z) {
    obj.position.set(side * x, 0, 0);
    if (side < 0) obj.rotation.y = Math.PI; // templates face -x; turn them to face the road (no mirroring, so signs stay readable)
    put(obj, z);
  }
  for (const side of [-1, 1]) {
    let z = SPAWN_Z;
    let i = side > 0 ? 0 : 3;
    while (z < 15) {
      const kind = i++ % 5;
      if (kind === 1 || kind === 4) { place(houses[i % houses.length].clone(), side, ROAD_W / 2 + 3.4, z + 4.5); z += 9.5; }
      else if (kind === 3) {
        place(banana.clone(), side, ROAD_W / 2 + 4.2, z + 1.5); place(banana.clone(), side, ROAD_W / 2 + 5.4, z + 3); place(pick(bushes).clone(), side, ROAD_W / 2 + 3.4, z + 2.4);
        if (i % 2) place(pick(mangos).clone(), side, ROAD_W / 2 + 7.5, z + 2.2);
        z += 4.5;
      } else {
        place(shops[(i * 3 + (side > 0 ? 0 : 4)) % shops.length].clone(), side, ROAD_W / 2 + 3.6, z + 2.9);
        // something on the footpath in front of most shops
        if (i % 3 === 0) place(pick(scooters).clone(), side, ROAD_W / 2 + 2.2, z + rnd(1.2, 4.6));
        else if (i % 3 === 1) place((i % 2 ? chai : stall).clone(), side, ROAD_W / 2 + 2.4, z + 1.8);
        z += 6.2;
      }
    }
    for (let pz = SPAWN_Z; pz < 15; pz += rnd(7, 10)) {
      const p = pick(palms).clone();
      p.rotation.y = (side > 0) === !models.palm ? Math.PI + rnd(-0.5, 0.5) : rnd(-0.5, 0.5); // lean toward the road (the model leans -x, the procedural ones +x)
      p.position.set(side * (ROAD_W / 2 + 3.1 + rnd(0, 0.4)), 0, 0);
      put(p, pz);
    }
    for (let pz = SPAWN_Z + 30 + (side > 0 ? 40 : 0); pz < 15; pz += 80) place(milestone.clone(), side, ROAD_W / 2 + 0.75, pz);
    for (let pz = SPAWN_Z + (side > 0 ? 12 : 0), n = 0; pz < 15; pz += POLE_GAP, n++) {
      const p = post.clone();
      p.position.set(side * (ROAD_W / 2 + 0.9), 0.2, 0);
      if (side < 0) p.scale.x = -1; // mirror (not turn) so the lamp arm faces the road and the wires still run ahead
      put(p, pz);
      if (side > 0 && n % 2 === 0) put(bunting.clone(), pz); // every other pole
    }
  }
  const scenery = strips.map((g) => {
    g.updateMatrixWorld(true);
    const steam = [];
    g.traverse((o) => { if (o.userData.steam) steam.push(o.getWorldPosition(new THREE.Vector3()).sub(g.position)); });
    const b = bake(g);
    b.position.copy(g.position);
    b.userData.steam = steam; // kettle spots, relative to the strip
    scene.add(b);
    return b;
  });

  // ---------- obstacles
  const busSide = canvasTex(512, 160, (g, w, h) => {
    const body = g.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#f6e7b8'); body.addColorStop(0.62, '#eedc9f'); body.addColorStop(0.63, '#c62828'); body.addColorStop(1, '#8f1818');
    g.fillStyle = body; g.fillRect(0, 0, w, h);
    for (let x = 18; x < w - 40; x += 62) {
      g.fillStyle = '#1d2831'; g.fillRect(x, 14, 52, 66);
      const shine = g.createLinearGradient(x, 14, x + 52, 80);
      shine.addColorStop(0, 'rgba(255,220,170,0.35)'); shine.addColorStop(0.4, 'rgba(255,255,255,0)');
      g.fillStyle = shine; g.fillRect(x, 14, 52, 66);
      g.fillStyle = '#c9c2a6'; g.fillRect(x - 3, 12, 3, 70);
    }
    g.fillStyle = '#ffd34d'; g.fillRect(0, h * 0.6, w, 5);
    g.fillStyle = '#fff'; g.font = `800 26px ${FONT}`; g.fillText('KERALA RTC', 30, h - 22);
    speckle(g, w, h, 600, 0.03, 0.1, 2);
    grime(g, w, h, 0.8);
  });
  const busRear = canvasTex(256, 256, (g, w, h) => {
    const body = g.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#f6e7b8'); body.addColorStop(0.5, '#eedc9f'); body.addColorStop(0.51, '#c62828'); body.addColorStop(1, '#8f1818');
    g.fillStyle = body; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2831'; g.fillRect(18, 20, w - 36, 90);
    g.fillStyle = 'rgba(255,220,170,0.3)'; g.fillRect(24, 24, 40, 80);
    g.fillStyle = '#111'; g.fillRect(40, 116, w - 80, 22);
    g.fillStyle = '#ffb000'; g.font = `800 18px ${FONT}`; g.textAlign = 'center'; g.fillText('THRISSUR', w / 2, 133);
    g.fillStyle = '#fff'; g.font = `800 34px ${FONT}`; g.fillText('KSRTC', w / 2, 180);
    g.fillStyle = '#ff3d00'; g.fillRect(12, 196, 36, 22); g.fillRect(w - 48, 196, 36, 22);
    g.fillStyle = '#ffeb3b'; g.fillRect(84, 200, 88, 22);
    g.fillStyle = '#111'; g.font = `800 16px ${FONT}`; g.fillText('KL 08 BX 2024', w / 2, 217);
    grime(g, w, h, 0.75);
  });
  // Front of an oncoming KSRTC: big split windscreen, lit destination board, KSRTC on the cream panel, headlamps and grille.
  const busFront = canvasTex(256, 256, (g, w, h) => {
    const body = g.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#f6e7b8'); body.addColorStop(0.55, '#eedc9f'); body.addColorStop(0.56, '#c62828'); body.addColorStop(1, '#8f1818');
    g.fillStyle = body; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.fillRect(26, 8, w - 52, 26);
    g.fillStyle = '#ffb000'; g.font = `800 20px ${FONT}`; g.textAlign = 'center'; g.fillText('THRISSUR FAST', w / 2, 28);
    for (const x of [14, w / 2 + 3]) { // split windscreen with a sky reflection
      const gl = g.createLinearGradient(x, 40, x + 110, 132);
      gl.addColorStop(0, '#5d7286'); gl.addColorStop(0.45, '#1d2831'); gl.addColorStop(1, '#141c22');
      g.fillStyle = gl; g.fillRect(x, 40, w / 2 - 17, 94);
    }
    g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.moveTo(60, 132); g.lineTo(112, 92); g.moveTo(190, 132); g.lineTo(242, 92); g.stroke(); // wipers
    g.fillStyle = '#fff'; g.font = `800 30px ${FONT}`; g.fillText('KSRTC', w / 2, 170);
    g.fillStyle = '#2a2a2a'; g.fillRect(70, 182, w - 140, 34); // grille
    g.fillStyle = '#555'; for (let y = 186; y < 214; y += 6) g.fillRect(74, y, w - 148, 2);
    g.fillStyle = '#ffeb3b'; g.fillRect(84, 224, 88, 22);
    g.fillStyle = '#111'; g.font = `800 16px ${FONT}`; g.fillText('KL 15 A 1234', w / 2, 241);
    grime(g, w, h, 0.75);
  });
  const autoRear = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1a1b'; g.textAlign = 'center';
    g.font = `800 30px ${FONT}`; g.fillText('Ammede Anugraham', w / 2, 42);
    g.fillStyle = '#fff'; g.fillRect(68, 62, 120, 42);
    g.fillStyle = '#1d1a1b'; g.font = `800 28px ${FONT}`; g.fillText('KL 08 AB', w / 2, 94);
    grime(g, w, h, 0.7);
  });
  const OM = {
    busSide: mat(0xffffff, { map: busSide, roughness: 0.45 }), busRear: mat(0xffffff, { map: busRear, roughness: 0.45 }), busFront: mat(0xffffff, { map: busFront, roughness: 0.4 }),
    cream: mat(0xf2e3b0, { roughness: 0.45 }), red: mat(0xb82424, { roughness: 0.45 }), roof: mat(0xe6e1d3, { roughness: 0.6 }),
    black: mat(0x1b1b1e, { roughness: 0.6 }), tyre: mat(0x1a1a1a, { roughness: 0.9 }), hub: mat(0xc0c4c8, { roughness: 0.3, metalness: 0.9 }),
    yellow: mat(0xf2c230, { roughness: 0.4 }), autoTop: mat(0x1e1e1e, { side: THREE.DoubleSide, roughness: 0.7 }),
    autoRear: mat(0xffffff, { map: autoRear, roughness: 0.45 }), glass: mat(0x24303a, { roughness: 0.1, metalness: 0.3, envMapIntensity: 1.5 }),
    wood: mat(0x8d6e63, { map: woodTex }), pothole: mat(0x2c2620, { roughness: 1 }), water: mat(0x4f6573, { roughness: 0.05, metalness: 0.1, envMapIntensity: 1.6 }),
    rim: mat(0x6e6458, { roughness: 1 }), nut: mat(0x7c9a2e, { roughness: 0.5 }), stalk: mat(0x6d4c41),
    chrome: mat(0xdde2e6, { roughness: 0.15, metalness: 1 }), light: mat(0xfff2cc, { emissive: 0xffd27a, emissiveIntensity: 1.2 }),
    tail: mat(0xff3b2f, { emissive: 0xff2010, emissiveIntensity: 0.9 }),
    shadow: basic({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  // Obstacles spawn all run long: their geometry and materials are made once and shared, never per spawn.
  const once = {};
  const shared = (key, make) => (once[key] ??= make());
  const wheel = (r, wdt) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(shared('tyre' + r, () => new THREE.TorusGeometry(r * 0.78, r * 0.24, 8, 18).rotateY(Math.PI / 2)), OM.tyre));
    g.add(new THREE.Mesh(shared('hub' + r + wdt, () => new THREE.CylinderGeometry(r * 0.55, r * 0.55, wdt, 14).rotateZ(Math.PI / 2)), OM.hub));
    return g;
  };
  const SLOGANS = [
    ['THRISSUR POORAM', 'Ellarum varanam!', '#6a1b9a', '#ffeb3b'], ['HAPPY ONAM', 'Swaraj Round friends', '#f9a825', '#1b5e20'],
    ['PULIKKALI 2026', 'Naalam Onam, Round-il', '#e65100', '#ffffff'], ['VADAKKUMNATHAN', 'Temple festival', '#b71c1c', '#ffd54f'],
    ['MEGA OFFER', 'Mobile shop, junction', '#0d47a1', '#ffffff'],
  ];
  const flexMats = SLOGANS.map(([a, b, bg, fg]) => {
    const t = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const v = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.6);
      v.addColorStop(0, 'rgba(255,255,255,0.12)'); v.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = v; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = fg; g.textAlign = 'center';
      let size = 66; g.font = `800 ${size}px ${FONT}`;
      while (g.measureText(a).width > w - 60) { size -= 2; g.font = `800 ${size}px ${FONT}`; }
      g.fillText(a, w / 2, 118);
      g.font = `700 40px ${FONT}`; g.fillText(b, w / 2, 190);
    });
    return mat(0xffffff, { side: THREE.DoubleSide, map: t, roughness: 0.6 });
  });
  function potholeGeo() {
    const geo = new THREE.CircleGeometry(0.95, 16);
    const p = geo.attributes.position;
    for (let i = 1; i < p.count; i++) {
      const k = rnd(0.75, 1.1);
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    return geo.rotateX(-Math.PI / 2);
  }
  const potholeGeos = [potholeGeo(), potholeGeo(), potholeGeo()];
  const flat = (geo, m, y, s = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.scale.setScalar(s);
    return mesh;
  };

  // Leaning palms for falling coconuts, one template per lean distance, built on first use.
  const nutGeo = models.nut
    ? modelMeshes(models.nut, new THREE.Matrix4().makeScale(0.33, 0.33, 0.33).multiply(new THREE.Matrix4().makeTranslation(-0.02, -0.07, -0.02))).children[0]
    : new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12));
  const leanPalms = {};
  // Model palm: its left trunk's crown sits at (-1.8, 4.0). Scale it so that crown is just above CROWN_Y,
  // then shear (x += k*y) so the crown lands exactly dx over the lane, keeping the fronds level.
  const CROWN = { x: 1.8, y: 4.0 }, CS = (CROWN_Y + 0.3) / CROWN.y;
  function leaningPalm(dx) {
    const key = dx.toFixed(1);
    if (leanPalms[key]) return leanPalms[key];
    if (models.palm) {
      const k = (CROWN.x * CS - dx) / (CROWN.y * CS);
      return (leanPalms[key] = bake(modelMeshes(models.palm, new THREE.Matrix4().makeShear(0, 0, k, 0, 0, 0).multiply(new THREE.Matrix4().makeScale(CS, CS, CS)))));
    }
    const g = new THREE.Group();
    const top = new THREE.Vector3(-dx, CROWN_Y + 0.35, 0);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-dx * 0.12, CROWN_Y * 0.4, 0), new THREE.Vector3(-dx * 0.55, CROWN_Y * 0.82, 0), top]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.18, 8), M.trunk);
    trunk.castShadow = true;
    g.add(trunk, crown(top, 12, 0.9));
    return (leanPalms[key] = bake(g));
  }

  // People for bikes: capsule limbs and torso, helmet with visor (or hair and a plait), hands on the bars.
  const SKIN = [0x8d5a3b, 0xa86b48, 0x6e4430], SHIRTS = [0x2e5fa8, 0xe8e2d4, 0x8a2b2b, 0x2f6b47, 0xd98c2b, 0x5b3f8c];
  const capsule = (r, len, m, x, y, z, rx = 0, rz = 0) => {
    const c = new THREE.Mesh(shared('cap' + r + len, () => new THREE.CapsuleGeometry(r, len, 4, 10)), m);
    c.position.set(x, y, z);
    c.rotation.set(rx, 0, rz);
    c.castShadow = true;
    return c;
  };
  // look: optional { shirt, pants, helmet } colours; helmet: null forces bare head (hair + plait).
  // Riders are dozens of small meshes; each look is baked into one mesh per material and pooled (6 looks per bike style),
  // so a bike costs a handful of draw calls and no per-spawn GPU buffers.
  const riderPool = {};
  function bakedRiders(kind, make) {
    const pool = (riderPool[kind] ??= []);
    if (pool.length < 6) pool.push(bake(make()));
    return pick(pool).clone();
  }
  // Bakes a vehicle body into one mesh per material, keeping its first two children (the wheels, which spin) separate.
  function bakeExceptWheels(body) {
    const rest = new THREE.Group(), out = new THREE.Group();
    const [w0, w1, ...parts] = body.children;
    for (const c of parts) rest.add(c);
    out.add(w0, w1, bake(rest));
    return out;
  }
  function rider(seat, pillion, look = {}) {
    const g = new THREE.Group();
    const cm = (hex, rough) => shared('m' + hex, () => mat(hex, { roughness: rough }));
    const skin = cm(pick(SKIN), 0.55), shirt = cm(look.shirt ?? pick(SHIRTS), 0.8);
    const pants = cm(look.pants ?? (pillion ? pick([0xc2185b, 0x1565c0, 0x6a1b9a, 0xe0a030]) : pick([0x2b2f3a, 0x3e3a33, 0xe8e2d4])), 0.85);
    const lean = pillion ? -0.05 : 0.28; // the rider leans to the bars
    const torso = capsule(0.19, 0.32, shirt, 0, seat + 0.42, 0, lean);
    torso.scale.set(1.15, 1, 0.8);
    g.add(torso, capsule(0.06, 0.06, skin, 0, seat + 0.78, -lean * 0.3)); // neck
    const head = new THREE.Mesh(shared('head', () => new THREE.SphereGeometry(0.14, 18, 14)), skin);
    head.position.set(0, seat + 0.92, -lean * 0.45);
    head.scale.set(0.95, 1.08, 1);
    g.add(head);
    if (look.helmet !== null && (!pillion || look.helmet || Math.random() < 0.4)) {
      const hc = look.helmet ?? pick([0xd32f2f, 0x212121, 0xfafafa, 0x1976d2, 0xf9a825]);
      const helmet = new THREE.Mesh(shared('helmet', () => new THREE.SphereGeometry(0.175, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6)), shared('hm' + hc, () => mat(hc, { roughness: 0.2, metalness: 0.1 })));
      helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.03, 0));
      const visor = new THREE.Mesh(shared('visor', () => new THREE.SphereGeometry(0.168, 16, 8, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.32, Math.PI * 0.22)), OM.glass);
      visor.position.copy(helmet.position);
      g.add(helmet, visor);
    } else {
      const hair = new THREE.Mesh(shared('hair', () => new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58)), cm(0x15110f, 0.5));
      hair.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0.01));
      g.add(hair, capsule(0.045, 0.32, cm(0x15110f, 0.5), 0, seat + 0.66, head.position.z + 0.14)); // plait
    }
    for (const sd of [-1, 1]) {
      if (pillion) {
        g.add(capsule(0.055, 0.3, shirt, sd * 0.24, seat + 0.42, 0.02, 0.1)); // arms by the side, hands on the grab rail
        g.add(capsule(0.045, 0.02, skin, sd * 0.25, seat + 0.2, 0.05));
      } else {
        g.add(capsule(0.055, 0.34, shirt, sd * 0.24, seat + 0.5, -0.2, 1.05)); // arms reaching forward
        g.add(capsule(0.045, 0.02, skin, sd * 0.3, seat + 0.42, -0.42)); // hands on the grips
      }
      g.add(capsule(0.08, 0.32, pants, sd * 0.15, seat + 0.05, -0.18, 1.35)); // thigh
      g.add(capsule(0.065, 0.3, pants, sd * 0.19, seat - 0.28, -0.36, 0.2)); // shin
      g.add(box(0.11, 0.08, 0.22, OM.black, sd * 0.19, seat - 0.5, -0.4, { r: 0.03 })); // chappal on the footrest
    }
    return g;
  }

  // Vehicle templates from the models: sit on the road (min y = 0), centred on x/z, rear toward the camera (+z).
  const vehicle = (root, rotY, scale) => {
    const m = new THREE.Matrix4().makeRotationY(rotY).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    const g = modelMeshes(root, m), b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3());
    for (const mesh of g.children) mesh.geometry.translate(-c.x, -b.min.y, -c.z);
    return g;
  };
  const autoModel = models.auto && vehicle(models.auto, 0, 1.05);
  const carModel = models.car && vehicle(models.car, Math.PI / 2, 1.12);

  const FACTORY = {
    // A KSRTC either standing in your lane, moving with the traffic (rear + tail lamps toward the camera), or, when
    // o.oncoming, charging at you (front, lit headlamps). The body sits in its own group so main.js can rock it.
    bus(o = {}) {
      const g = new THREE.Group(), body = new THREE.Group();
      const shell = new THREE.Mesh(rgeo(2.0, 2.35, 7.6, 0.18), [OM.busSide, OM.busSide, OM.roof, OM.red, o.oncoming ? OM.busFront : OM.busRear, OM.busRear]);
      shell.position.y = 1.6;
      shell.castShadow = true;
      body.add(shell, box(1.85, 0.16, 7.2, OM.roof, 0, 2.86, 0, { r: 0.06, shadow: true }), box(2.08, 0.28, 0.3, OM.black, 0, 0.55, 3.82, { r: 0.08 }));
      for (const x of [-0.75, 0.75]) body.add(box(0.26, 0.16, 0.04, o.oncoming ? OM.light : OM.tail, x, 0.95, 3.82, { r: 0.02 }));
      if (o.oncoming) body.add(box(0.08, 0.5, 0.08, OM.black, 0.75, 3.05, -3.4, { r: 0.03 })); // roof exhaust stack (smoke comes out here)
      g.add(body);
      const wheels = [];
      for (const x of [-0.9, 0.9]) for (const z of [-2.6, 2.4]) {
        const w = wheel(0.46, 0.3);
        w.position.set(x, 0.46, z);
        wheels.push(w);
        g.add(w);
      }
      return { mesh: g, halfW: 0.98, top: 2.95, body, wheels, wob: Math.random() * 6, smokeT: 0 };
    },
    auto(o) {
      const g = new THREE.Group();
      // Indicator on the side it will swerve to (no rotation on the group, so local x = world x).
      const blinker = box(0.2, 0.14, 0.06, mat(0x7a3d00, { emissive: 0x000000 }), o.toLane > o.lane ? 0.55 : -0.55, 0.95, 1.33, { r: 0.03 }); // own material: it blinks
      if (autoModel) {
        g.add(autoModel.clone(), blinker);
        return { mesh: g, halfW: 0.68, top: 1.75, blinker, moveT: 0 };
      }
      const body = box(1.36, 0.8, 1.5, OM.yellow, 0, 0.72, 0.35, { r: 0.18, shadow: true });
      const nose = box(1.0, 0.75, 0.9, OM.yellow, 0, 0.72, -0.8, { r: 0.22, shadow: true });
      const canopyGeo = shared('canopy', () => new THREE.CylinderGeometry(0.7, 0.7, 1.9, 18, 1, true, Math.PI / 2, Math.PI));
      const canopy = new THREE.Mesh(canopyGeo, OM.autoTop);
      canopy.rotation.x = Math.PI / 2;
      canopy.scale.x = 0.97;
      canopy.position.set(0, 1.12, 0.1);
      canopy.castShadow = true;
      const back = new THREE.Mesh(shared('autoBack', () => new THREE.CircleGeometry(0.7, 18, 0, Math.PI)), OM.autoTop);
      back.position.set(0, 1.12, 1.05);
      back.scale.x = 0.97;
      const shield = box(1.0, 0.7, 0.05, OM.glass, 0, 1.45, -0.82, { r: 0.02 });
      shield.rotation.x = 0.25;
      const rear = new THREE.Mesh(shared('autoRearGeo', () => new THREE.PlaneGeometry(1.3, 0.62)), OM.autoRear);
      rear.position.set(0, 0.74, 1.12);
      g.add(body, nose, canopy, back, shield, rear, box(0.1, 0.1, 0.05, OM.light, 0, 1.0, -1.27, { r: 0.03 }));
      for (const [x, z] of [[0, -1.0], [-0.62, 0.75], [0.62, 0.75]]) {
        const w = wheel(0.28, 0.2);
        w.position.set(x, 0.28, z);
        g.add(w);
      }
      blinker.position.set(blinker.position.x, 1.0, 1.12);
      g.add(blinker);
      return { mesh: g, halfW: 0.68, top: 1.85, blinker, moveT: 0 };
    },
    // A Maruti 800 riding away from you (model; a rounded-box hatchback if the model didn't load). Can't be jumped.
    car() {
      const g = new THREE.Group();
      if (carModel) g.add(carModel.clone());
      else {
        const paint = shared('carPaint', () => mat(0xe8e8e8, { roughness: 0.35, metalness: 0.2 }));
        g.add(box(1.4, 0.7, 3.2, paint, 0, 0.6, 0, { r: 0.2, shadow: true }), box(1.25, 0.55, 1.8, OM.glass, 0, 1.2, 0.2, { r: 0.15 }));
        for (const x of [-0.65, 0.65]) for (const z of [-1.0, 1.0]) { const w = wheel(0.3, 0.2); w.position.set(x, 0.3, z); g.add(w); }
      }
      return { mesh: g, halfW: 0.75, top: 1.45 };
    },
    // Two-wheelers riding away from the camera. Can't be jumped. Mix: commuter motorbike, a Vespa-style delivery
    // scooter (red jacket, silver helmet, yellow box), or a white Activa with a side-saddle pillion.
    bike() {
      const kind = Math.random();
      if (kind < 0.6) {
        const vespa = kind < 0.28, style = vespa ? 'vespa' : 'activa', paint = vespa ? pick([0x8d8478, 0x9aa0a6]) : pick([0xf2f2ee, 0xf2f2ee, 0x9aa0a6, 0xb71c1c]);
        const g = shared('scoot' + style + paint, () => bakeExceptWheels(scooterBody(style, paint))).clone(); // clones share geometry: no per-spawn GPU buffers
        const riders = bakedRiders(style, () => {
        const riders = new THREE.Group();
        const r1 = rider(0.8, false, vespa ? { shirt: 0xc62828, pants: 0x2f3f5f, helmet: 0xc0c4c8 } : { shirt: 0x7e57c2, pants: 0x1f2430 });
        r1.position.z = 0.12;
        riders.add(r1);
        if (vespa) { // delivery box on his back, with a reflective band
          riders.add(box(0.5, 0.5, 0.32, shared('dbox', () => mat(0xf5c518, { roughness: 0.55 })), 0, 1.38, 0.4, { r: 0.05, shadow: true }));
          riders.add(box(0.51, 0.05, 0.33, OM.chrome, 0, 1.25, 0.4, { r: 0.01 }));
        } else if (Math.random() < 0.7) { // side-saddle pillion, legs down the left side
          const r2 = rider(0.84, true, { shirt: pick([0x26a69a, 0xec407a, 0xffb300]), helmet: null });
          r2.rotation.y = Math.PI / 2;
          r2.position.set(-0.04, 0, 0.45);
          riders.add(r2);
        }
        return riders;
        });
        g.add(riders);
        return { mesh: g, halfW: 0.45, top: 1.75, wheels: [g.children[0], g.children[1]], riders, wob: Math.random() * 6 }; // wheels are added first
      }
      const g = new THREE.Group();
      const pc = pick([0x1a1a1a, 0xb71c1c, 0x0d47a1, 0x37474f, 0x5d4037]);
      const paint = shared('paint' + pc, () => mat(pc, { roughness: 0.3, metalness: 0.3 }));
      const wheels = [];
      for (const z of [-0.65, 0.65]) {
        const w = wheel(0.33, 0.1);
        w.position.set(0, 0.33, z);
        wheels.push(w);
        g.add(w);
      }
      g.add(shared('moto' + pc, () => { const s = new THREE.Group(); const add = (...m) => s.add(...m);
      add(box(0.3, 0.32, 0.75, paint, 0, 0.72, -0.12, { r: 0.12, shadow: true })); // tank
      add(box(0.32, 0.12, 0.85, OM.black, 0, 0.84, 0.35, { r: 0.05 })); // seat
      add(box(0.22, 0.26, 0.5, OM.chrome, 0.05, 0.42, 0.1, { r: 0.08 })); // engine
      add(box(0.07, 0.07, 0.9, OM.chrome, 0.18, 0.35, 0.55, { r: 0.03 })); // exhaust
      add(box(0.06, 0.6, 0.06, OM.chrome, 0, 0.7, -0.62, { r: 0.02 }), box(0.7, 0.05, 0.05, OM.chrome, 0, 1.02, -0.55, { r: 0.02 })); // fork, bars
      add(box(0.3, 0.18, 0.12, paint, 0, 0.62, 0.95, { r: 0.05 }), box(0.18, 0.08, 0.03, OM.tail, 0, 0.62, 1.02, { r: 0.02 })); // rear mudguard + tail lamp
      return bake(s); }).clone());
      const riders = bakedRiders('moto', () => {
      const riders = new THREE.Group();
      const r1 = rider(0.62, false);
      r1.position.z = 0.15;
      riders.add(r1);
      if (Math.random() < 0.55) {
        const r2 = rider(0.66, true);
        r2.position.z = 0.62;
        riders.add(r2);
      }
      return riders;
      });
      g.add(riders);
      return { mesh: g, halfW: 0.45, top: 1.75, wheels, riders, wob: Math.random() * 6 };
    },
    pothole() {
      const g = new THREE.Group();
      const geo = pick(potholeGeos);
      g.add(flat(geo, OM.rim, 0.012, 1.15), flat(geo, OM.pothole, 0.018), flat(geo, OM.water, 0.022, 0.7));
      for (let i = 0; i < 4; i++) {
        const r = box(0.16, 0.1, 0.14, OM.rim, rnd(-0.9, 0.9), 0.05, rnd(-0.9, 0.9), { r: 0.04 });
        r.rotation.y = rnd(0, 3);
        g.add(r);
      }
      return { mesh: g, halfW: 0.75 };
    },
    flex() {
      const g = new THREE.Group();
      for (const x of [-1.2, 1.2]) g.add(box(0.12, 3.0, 0.12, OM.wood, x, 1.5, 0, { r: 0.03, shadow: true }));
      const banner = new THREE.Mesh(shared('banner', () => {
        const geo = new THREE.PlaneGeometry(2.3, 1.2, 8, 1), bp = geo.attributes.position; // slight sag of the stretched cloth
        for (let i = 0; i < bp.count; i++) bp.setZ(i, Math.sin(((bp.getX(i) + 1.15) / 2.3) * Math.PI) * 0.06);
        geo.computeVertexNormals();
        return geo;
      }), pick(flexMats));
      banner.position.y = 1.92; // bottom edge at 1.32: standing = hit, sliding = pass
      banner.castShadow = true;
      g.add(banner, box(2.5, 0.08, 0.08, OM.wood, 0, 2.55, 0, { r: 0.02 }));
      return { mesh: g, halfW: 1.1 };
    },
    // A palm leaning in from the nearer roadside with the nut hanging in its crown, right above the lane.
    // main.js shakes the palm, drops the nut with gravity and squashes it on landing.
    coconut(o) {
      const g = new THREE.Group();
      const side = o.lane === 0 ? -1 : o.lane === 2 ? 1 : Math.random() < 0.5 ? -1 : 1;
      const baseX = side * (ROAD_W / 2 + 1.2) - laneX(o.lane);
      const palm = leaningPalm(Math.abs(baseX)).clone();
      palm.scale.x = side; // template leans toward -x from a right-hand base; mirror it for the left side
      palm.position.x = baseX;
      const nut = new THREE.Mesh(nutGeo.geometry, models.nut ? nutGeo.material : OM.nut);
      nut.scale.set(1, 1.1, 1);
      nut.castShadow = true;
      if (!models.nut) nut.add(box(0.06, 0.14, 0.06, OM.stalk, 0, 0.32, 0, { r: 0.02 }));
      nut.position.y = CROWN_Y;
      const shadow = new THREE.Mesh(shared('nutShadow', () => new THREE.CircleGeometry(0.5, 18).rotateX(-Math.PI / 2)), OM.shadow.clone()); // own material: fades per nut
      shadow.position.y = 0.03;
      shadow.material.opacity = 0;
      g.add(palm, nut, shadow);
      return { mesh: g, halfW: 0.3, nut, shadow, palm, cy: CROWN_Y, phase: 'hang', t: 0 };
    },
  };

  // ---------- chillara: ₹1 (steel) and ₹5 (brass), textured from the user's coin sheets (assets/textures/pickups):
  // tails (big numeral, wheat stalks) faces the runner, heads (Lion Capital, भारत / INDIA) on the back, reeded edge
  // strip round the rim. Each face also uses its own greyscale as a bump map so the relief catches the light.
  const texLoader = new THREE.TextureLoader();
  const pickupTex = (name, color = true) => {
    const t = texLoader.load(`assets/textures/pickups/${name}.jpg`);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const COIN = {
    1: { r: 0.32, t: 0.08, burst: 0xffffff, metal: 0.6 },
    5: { r: 0.38, t: 0.1, burst: 0xffd54f, metal: 0.7 },
  };
  for (const [v, c] of Object.entries(COIN)) {
    const face = (name) => {
      const map = pickupTex(name), bumpMap = pickupTex(name + '_bump', false);
      for (const t of [map, bumpMap]) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; } // cap UVs come out sideways after rotateX
      return mat(0xffffff, { map, bumpMap, bumpScale: 2, metalness: c.metal, roughness: 0.35, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.25 });
    };
    const edge = pickupTex(`coin${v}_edge`);
    edge.wrapS = THREE.RepeatWrapping;
    edge.repeat.x = 3; // ~27 ridges round the rim
    c.geo = new THREE.CylinderGeometry(c.r, c.r, c.t, 48).rotateX(Math.PI / 2);
    c.mats = [mat(0xffffff, { map: edge, metalness: c.metal, roughness: 0.3, emissive: 0xffffff, emissiveMap: edge, emissiveIntensity: 0.2 }), face(`coin${v}_tails`), face(`coin${v}_heads`)];
  }
  function makeCoin(value) {
    if (value === 'puff') return makePuff();
    const def = COIN[value];
    const spin = new THREE.Group();
    const m = new THREE.Mesh(def.geo, def.mats);
    m.castShadow = true;
    spin.add(m);
    return spin;
  }

  // ---------- legendary motta puffs, built from the user's turnaround sheet: a squarish stack of flaky pastry layers,
  // topped by a dome whose four corners fold into a knot at the centre (diagonal creases), on a warm glow halo.
  const puffTop = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 40, 40).rotateX(-Math.PI / 2);
    const p = g.attributes.position, W = 0.95, H = 0.27;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      const m = Math.max(Math.abs(x), Math.abs(z)) * 2, sq = Math.pow(x ** 4 + z ** 4, 0.25) * 2;
      if (sq > 0) { x *= m / sq; z *= m / sq; } // square grid → rounded square (keeps the plane's top-down UVs)
      const d = Math.min(Math.abs(x - z), Math.abs(x + z)) / Math.SQRT2; // distance to a diagonal fold
      let y = H * Math.pow(Math.max(0, 1 - m ** 2.4), 0.55); // soft dome, rounded at the rim
      y -= 0.05 * Math.exp(-((d / 0.04) ** 2)) * Math.sin(Math.PI * Math.min(1, m / 0.85)); // creases where the corners fold in
      y += 0.06 * Math.exp(-(x * x + z * z) / 0.004); // the pinched knot in the middle
      p.setXYZ(i, x * W, y, z * W);
    }
    g.computeVertexNormals();
    return g;
  })();
  const PUFF = {
    top: (() => {
      const map = pickupTex('puff_top'), bumpMap = pickupTex('puff_top_bump', false);
      return mat(0xffffff, { map, bumpMap, bumpScale: 2, roughness: 0.5, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    })(),
    layers: (() => {
      const map = pickupTex('puff_layers');
      return mat(0xffffff, { map, roughness: 0.55, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.15 });
    })(),
    halo: new THREE.SpriteMaterial({
      map: canvasTex(128, 128, (g, w) => {
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, 'rgba(255,220,120,0.9)'); r.addColorStop(0.5, 'rgba(255,170,40,0.35)'); r.addColorStop(1, 'rgba(255,150,0,0)');
        g.fillStyle = r; g.fillRect(0, 0, w, w);
      }),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  };
  function makePuff() {
    const spin = new THREE.Group(), body = new THREE.Group();
    // Three pastry layers, each slightly different in size so the flaky edges show.
    [[0.9, 0.04], [0.96, 0.12], [0.92, 0.2]].forEach(([w, y]) => body.add(box(w, 0.09, w, PUFF.layers, 0, y, 0, { r: 0.04, shadow: true })));
    const top = new THREE.Mesh(puffTop, PUFF.top);
    top.position.y = 0.24;
    top.castShadow = true;
    body.add(top);
    body.position.y = -0.25;
    body.rotation.x = 0.45; // tilt the folded top toward the runner
    const halo = new THREE.Sprite(PUFF.halo);
    halo.scale.setScalar(1.9);
    spin.add(halo, body);
    return spin;
  }

  // ---------- life: crows that take off as you run up, chai steam, monsoon rain
  const crowMat = mat(0x18171c, { roughness: 0.55 }), beakMat = mat(0x3d3a36, { roughness: 0.5 });
  function crowTemplate() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6).scale(1, 0.85, 1.6), crowMat));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6).translate(0, 0.1, -0.2), crowMat));
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 6).rotateX(-Math.PI / 2).translate(0, 0.09, -0.32), beakMat));
    g.add(box(0.12, 0.025, 0.2, crowMat, 0, 0.03, 0.25, { r: 0.01 }));
    const wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.08, 0.06, 0);
      pivot.add(new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.17).rotateX(-Math.PI / 2).translate(s * 0.18, 0, 0.02), mat(0x18171c, { side: THREE.DoubleSide, roughness: 0.6 })));
      g.add(pivot);
      return pivot;
    });
    g.scale.setScalar(1.3);
    return { g, wings };
  }
  const crows = Array.from({ length: 6 }, () => {
    const c = crowTemplate();
    c.g.visible = false;
    scene.add(c.g);
    return { ...c, state: 'off', v: new THREE.Vector3(), ph: Math.random() * 6 };
  });
  let crowT = 2, steamT = 0, lowGfx = false;

  const RAIN_N = 600, rainPos = new Float32Array(RAIN_N * 6);
  const drops = Array.from({ length: RAIN_N }, () => [rnd(-14, 14), rnd(0, 16), rnd(-45, 8)]);
  const rainGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc9d3df, transparent: true, opacity: 0, depthWrite: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
  let moodKey = -1;

  return {
    sun, FACTORY, COIN, makeCoin,
    chai: () => chai.clone(), // the home screen's chaya kada
    glass: () => new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.036, 0.12, 12).translate(0, -0.06, 0), M.steel), // steel tumbler, origin at its rim

    // dusk 0..1 (golden hour → night lights), wet 0..1 (monsoon). Cheap per frame; the sky redraws only in 1/20 steps.
    setMood(dusk, wet) {
      const key = Math.round(dusk * 20) * 32 + Math.round(wet * 20);
      if (key !== moodKey) {
        moodKey = key;
        drawSky(sky.image.getContext('2d'), sky.image.width, sky.image.height, Math.round(dusk * 20) / 20, Math.round(wet * 20) / 20);
        sky.needsUpdate = true;
      }
      scene.fog.color.set(HORIZON).lerp(tmpC.set(0x5b4a6e), dusk).lerp(tmpC.set(0x8b9198), wet * 0.85);
      scene.fog.near = 38 - wet * 18;
      scene.fog.far = 115 - wet * 40;
      hemi.intensity = 0.7 - dusk * 0.35 - wet * 0.15;
      sun.intensity = 3.2 * (1 - dusk * 0.75) * (1 - wet * 0.6);
      sun.color.set(0xffb46b).lerp(tmpC.set(0xff7a50), dusk);
      renderer.toneMappingExposure = 1.05 - dusk * 0.2 - wet * 0.1;
      M.lamp.emissiveIntensity = 1.6 + dusk * 5;
      lampGlow.opacity = Math.max(dusk, wet * 0.5) * 0.85; // streetlights come on at dusk (and dimly in the rain)
      interiorMat.emissiveIntensity = 0.55 + dusk * 0.9;
      signMat.emissiveIntensity = 0.35 + dusk * 0.7;
      for (const m of hillMats) m.color.setScalar(1 - dusk * 0.5 - wet * 0.25);
      rain.visible = wet > 0.01;
      rain.material.opacity = wet * 0.6;
    },
    setLow(low) {
      lowGfx = low;
      sun.castShadow = !low;
      rainGeo.setDrawRange(0, (low ? 200 : RAIN_N) * 2);
    },
    // Per frame: crows (spawned only while running), kettle steam, backwater ripples, rain.
    ambient(dt, ds, t, running, fx) {
      waterTex.offset.x = (waterTex.offset.x + dt * 0.004) % 1;
      crowT -= dt;
      if (running && crowT <= 0) {
        crowT = rnd(1.5, 4);
        const c = crows.find((q) => q.state === 'off');
        if (c) {
          c.side = Math.random() < 0.5 ? -1 : 1;
          c.state = 'sit';
          c.g.visible = true;
          c.g.position.set(c.side * rnd(ROAD_W / 2 + 0.8, ROAD_W / 2 + 2.3), 0.37, SPAWN_Z + 20);
          c.g.rotation.set(0, rnd(0, Math.PI * 2), 0);
        }
      }
      for (const c of crows) {
        if (c.state === 'off') continue;
        c.g.position.z += ds;
        if (c.state === 'sit') {
          c.g.rotation.x = Math.max(0, Math.sin(t * 5 + c.ph)) * 0.45; // pecking
          c.wings[0].rotation.z = 0.08; c.wings[1].rotation.z = -0.08;
          if (c.g.position.z > -16) { // you're close: off it goes, away from the road
            c.state = 'fly';
            c.v.set(c.side * rnd(1.5, 3), rnd(3.5, 5), rnd(-3, -1));
            c.g.rotation.set(-0.35, Math.atan2(-c.v.x, -c.v.z), 0, 'YXZ');
          }
        } else {
          c.g.position.addScaledVector(c.v, dt);
          c.v.y += dt * 0.8;
          const flap = Math.sin(t * 26 + c.ph) * 0.9;
          c.wings[0].rotation.z = flap; c.wings[1].rotation.z = -flap;
          if (c.g.position.y > 18 || c.g.position.z > 15) { c.state = 'off'; c.g.visible = false; }
        }
        if (c.g.position.z > 15) { c.state = 'off'; c.g.visible = false; }
      }
      steamT -= dt;
      if (steamT <= 0) {
        steamT = lowGfx ? 0.3 : 0.14;
        for (const s of scenery) for (const p of s.userData.steam) {
          const z = s.position.z + p.z;
          if (z > -70 && z < 10) fx.steam(tmpV.set(p.x, p.y, z));
        }
      }
      if (rain.visible) {
        const n = lowGfx ? 200 : RAIN_N;
        for (let i = 0; i < n; i++) {
          const d = drops[i];
          d[1] -= dt * 22; d[0] -= dt * 2; d[2] += ds;
          if (d[1] < 0) { d[1] += 16; d[0] = rnd(-14, 14); }
          if (d[2] > 8) d[2] -= 53;
          rainPos.set([d[0], d[1], d[2], d[0] + 0.1, d[1] + 0.7, d[2] - 0.1], i * 6);
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
    },
    scroll(ds) {
      roadTex.offset.y = (roadTex.offset.y + ds / 20) % 1;
      kerbTex.offset.y = (kerbTex.offset.y + ds / 2.4) % 1;
      pathTex.offset.y = (pathTex.offset.y + ds / 1.6) % 1;
      grassTex.offset.y = (grassTex.offset.y + ds / 4) % 1;
      for (const s of scenery) {
        s.position.z += ds;
        if (s.position.z - CL > 15) s.position.z -= SPAN; // whole strip is behind the camera
      }
    },
    follow(px) {
      sun.position.set(px + 6, 10, -6); // low and ahead-right: long shadows reaching back toward the camera
      sun.target.position.set(px, 0, -4);
    },
  };
}
