// Shared look: toon materials, ink outlines, the curved-world bend, canvas textures, particles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// One GLTF loader for every model; the .glb files are Draco-compressed (originals in asset-backup/).
export const gltfLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/'));

// Curved world: everything bends down (and sideways) with distance from the camera. Visual only.
export const CURVE = { value: new THREE.Vector2(0, 0.0018) };
const BEND = `
  mvPosition.y -= uCurve.y * mvPosition.z * mvPosition.z;
  mvPosition.x += uCurve.x * mvPosition.z * mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;`;
function bend(shader, extra = '') {
  shader.uniforms.uCurve = CURVE;
  shader.vertexShader = 'uniform vec2 uCurve;\n' + shader.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + extra)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + BEND);
}

// Seconds, set every frame by main.js; drives the palm sway.
export const TIME = { value: 0 };
// Breeze: sway grows with height above 2.5 m so trunks stay planted; phase from the vertex's own spot,
// so neighbouring palms move out of step (strip-local coords, not world, or scrolling would speed it up).
const SWAY = `{ float h = max(transformed.y - 2.5, 0.0);
  float ph = transformed.z * 0.21 + transformed.x * 0.37;
  transformed.x += sin(uTime * 1.3 + ph) * h * h * 0.005;
  transformed.z += cos(uTime * 1.0 + ph) * h * h * 0.0025; }`;
export function swayMat(src) {
  const m = src.clone();
  m.onBeforeCompile = (s) => { s.uniforms.uTime = TIME; s.vertexShader = 'uniform float uTime;\n' + s.vertexShader; bend(s, SWAY); };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

const gradient = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

export function toon(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...opts });
  m.onBeforeCompile = (s) => bend(s);
  return m;
}
// Smooth lit material (for the sculpted hero, where toon bands look blotchy).
export function lit(opts) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...opts });
  m.onBeforeCompile = (s) => bend(s);
  return m;
}
// Matte lit material for the world (stylised 3D, same shading model as the hero).
export const mat = (color, opts = {}) => lit({ color, roughness: 0.85, ...opts });
export function basic(opts) {
  const m = new THREE.MeshBasicMaterial(opts);
  m.onBeforeCompile = (s) => bend(s);
  return m;
}
function outlineMat(w) {
  const m = new THREE.MeshBasicMaterial({ color: 0x2b1a14, side: THREE.BackSide }); // warm ink suits sunset light
  m.onBeforeCompile = (s) => bend(s, `transformed += normalize(normal) * ${w.toFixed(3)};`);
  m.customProgramCacheKey = () => 'outline' + w;
  return m;
}
export const OUTLINE = outlineMat(0.018), OUTLINE_THICK = outlineMat(0.04);

// Inverted-hull ink outline as a child, so it follows every pose.
export function outline(mesh, mat = OUTLINE) {
  mesh.add(new THREE.Mesh(mesh.geometry, mat));
  return mesh;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const FONT = '"Baloo Chettan 2", system-ui, sans-serif';

// --- Particles: pooled sprites (coin sparkles, landing dust, crash stars)
export function createFx(scene) {
  const dot = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const star = canvasTex(64, 64, (g) => {
    g.fillStyle = '#ffd54f';
    g.strokeStyle = '#1d1a1b';
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 28, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  });
  const pool = [];
  function spawn(map, color, pos, vel, life, size, { grav = 0, world = false, blend = THREE.AdditiveBlending } = {}) {
    let p = pool.find((q) => !q.alive);
    if (!p) {
      p = { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })) };
      scene.add(p.sprite);
      pool.push(p);
    }
    Object.assign(p, { alive: true, t: 0, life, size, grav, world, vel: vel.clone(), pos: pos.clone() });
    p.sprite.material.map = map;
    p.sprite.material.color.set(color);
    p.sprite.material.blending = blend;
    p.sprite.material.needsUpdate = true;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
  }
  const v = new THREE.Vector3();
  return {
    coin(pos, color) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spawn(dot, color, pos, v.set(Math.cos(a) * 2.5, 1.5 + Math.sin(a) * 2.5, 0), 0.35, 0.35);
      }
    },
    dust(pos, n = 6) {
      for (let i = 0; i < n; i++) {
        spawn(dot, 0xd9c7a8, pos, v.set((Math.random() - 0.5) * 3, 0.6 + Math.random(), 1 + Math.random() * 2), 0.5, 0.6, { world: true, blend: THREE.NormalBlending });
      }
    },
    // Diesel exhaust: dark puffs that drift up and grow (world: true, so they stay where the bus left them).
    smoke(pos) {
      for (let i = 0; i < 2; i++) spawn(dot, 0x3f3a35, pos, v.set((Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 0.8, -0.5 - i), 1.2, 1.6, { world: true, blend: THREE.NormalBlending });
    },
    // Chai kettle steam: soft white wisps that rise, drift and swell.
    steam(pos) {
      spawn(dot, 0xf4f1ea, pos, v.set((Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.4, 0), 1.4, 0.5, { world: true, blend: THREE.NormalBlending });
    },
    stars(pos) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        spawn(star, 0xffffff, pos, v.set(Math.cos(a) * 1.8, 2 + Math.random(), Math.sin(a) * 1.8), 1.2, 0.45, { grav: 3, blend: THREE.NormalBlending });
      }
    },
    // camZ: sprites skip the material bend, so world particles get the same curved-world offset here.
    update(dt, ds, camZ = 0) {
      for (const p of pool) {
        if (!p.alive) continue;
        p.t += dt;
        if (p.t >= p.life) { p.alive = false; p.sprite.visible = false; continue; }
        p.vel.y -= p.grav * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.world) p.pos.z += ds;
        p.sprite.position.copy(p.pos);
        if (p.world) {
          const dz = p.pos.z - camZ;
          p.sprite.position.y -= CURVE.value.y * dz * dz;
          p.sprite.position.x += CURVE.value.x * dz * dz;
        }
        const k = p.t / p.life;
        p.sprite.material.opacity = 1 - k;
        p.sprite.scale.setScalar(p.size * (p.world ? 1 + k * 1.5 : 1 - k * 0.5));
      }
    },
  };
}
