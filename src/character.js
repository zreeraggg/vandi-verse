// The main character from the concept sheet: big curly hair, goatee, black shirt with rolled sleeves,
// white mundu with dark border + vertical kara, white sneakers, watch. Toon-shaded with ink outlines.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, outline, canvasTex } from './fx.js';
import { loadHero } from './hero.js';

const M = {
  shirt: toon(0x2b2729), cuff: toon(0x45403f), skin: toon(0xc98a5a), skinDark: toon(0xb0744a), hair: toon(0x1d1a1b),
  shoe: toon(0xf4f2ef), sole: toon(0xbdb7b4), white: toon(0xffffff), black: toon(0x111111), watch: toon(0x222222),
};
M.mundu = toon(0xffffff, {
  side: THREE.DoubleSide,
  map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f6f1ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4e4648';
    g.fillRect(0, h - 22, w, 9); // double border near the hem
    g.fillRect(0, h - 40, w, 6);
    g.fillRect(w * 0.04, 0, 8, h); // vertical kara at the front fold
  }),
});

function mesh(geo, m, x = 0, y = 0, z = 0, ink = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return ink ? outline(o) : o;
}
const pivot = (x, y, z, ...kids) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  kids.forEach((k) => g.add(k));
  return g;
};

const HIP = 0.92, WAIST = 1.02, MUNDU_H = 0.74;

function leg(side) {
  const shoeGeo = new THREE.CapsuleGeometry(0.095, 0.16, 4, 10);
  shoeGeo.rotateX(Math.PI / 2);
  shoeGeo.scale(1, 0.8, 1);
  const shoe = pivot(0, -0.46, 0.04, mesh(shoeGeo, M.shoe), mesh(new THREE.BoxGeometry(0.19, 0.04, 0.36), M.sole, 0, -0.07, 0, false));
  const shin = mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), M.skin, 0, -0.22, 0);
  const knee = pivot(0, -0.46, 0, shin, shoe);
  const thigh = mesh(new THREE.CapsuleGeometry(0.08, 0.32, 4, 8), M.skin, 0, -0.23, 0, false);
  return { hip: pivot(side * 0.12, HIP, 0, thigh, knee), knee, ankle: shoe, thigh };
}

function arm(side) {
  const hand = mesh(new THREE.SphereGeometry(0.078, 12, 10), M.skin, 0, -0.29, 0);
  const forearm = mesh(new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), M.skin, 0, -0.14, 0);
  const elbow = pivot(0, -0.27, 0, forearm, hand);
  if (side < 0) {
    const watch = mesh(new THREE.TorusGeometry(0.062, 0.025, 6, 14), M.watch, 0, -0.22, 0, false);
    watch.rotation.x = Math.PI / 2;
    elbow.add(watch);
  }
  const sleeve = mesh(new THREE.CapsuleGeometry(0.092, 0.16, 4, 10), M.shirt, 0, -0.12, 0);
  const cuff = mesh(new THREE.TorusGeometry(0.085, 0.035, 6, 14), M.cuff, 0, -0.25, 0, false);
  cuff.rotation.x = Math.PI / 2;
  return { shoulder: pivot(side * 0.34, 1.56, 0, sleeve, cuff, elbow), elbow };
}

function head() {
  const h = new THREE.Group();
  h.position.y = 1.97;
  const skull = mesh(new THREE.SphereGeometry(0.26, 20, 16), M.skin);
  skull.scale.set(0.93, 1.05, 0.98);
  h.add(skull);
  // Big curly hair: one merged mesh of chunky blobs over the top, sides and back.
  let s = 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = [];
  for (let i = 0; i < 60; i++) {
    const theta = rand() * Math.PI * 2, phi = rand() * 1.45;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    if (dir.z > 0.45 && dir.y < 0.6) continue; // keep the face clear
    if (dir.y < -0.05) continue;
    const b = new THREE.IcosahedronGeometry(0.085 + rand() * 0.05, 1);
    b.translate(dir.x * 0.25, 0.06 + dir.y * 0.25, dir.z * 0.24 - 0.01);
    blobs.push(b);
  }
  h.add(mesh(mergeGeometries(blobs), M.hair));
  // Face (+z)
  const face = new THREE.Group();
  face.position.z = 0.215;
  for (const x of [-0.085, 0.085]) {
    const eye = mesh(new THREE.SphereGeometry(0.05, 12, 10), M.white, x, 0.035, 0, false);
    eye.scale.set(0.9, 1.15, 0.5);
    const pupil = mesh(new THREE.SphereGeometry(0.03, 10, 8), M.black, x, 0.03, 0.03, false);
    pupil.scale.set(1, 1.15, 0.5);
    const glint = mesh(new THREE.SphereGeometry(0.009, 6, 4), M.white, x + 0.01, 0.045, 0.045, false);
    const brow = mesh(new THREE.BoxGeometry(0.1, 0.026, 0.03), M.hair, x, 0.115, 0.01, false);
    brow.rotation.z = -x * 1.6;
    face.add(eye, pupil, glint, brow);
    h.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), M.skin, x * 3, 0, -0.02));
  }
  face.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), M.skinDark, 0, -0.03, 0.03, false)); // nose
  const smile = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), M.black, 0, -0.085, 0.0, false);
  smile.rotation.z = Math.PI;
  const open = mesh(new THREE.SphereGeometry(0.045, 10, 8), M.black, 0, -0.1, 0, false);
  open.scale.set(0.9, 1.1, 0.4);
  open.visible = false;
  face.add(smile, open);
  // Goatee + stubble along the jaw
  const beard = mesh(new THREE.SphereGeometry(0.075, 12, 10), M.hair, 0, -0.17, -0.06, false);
  beard.scale.set(1.1, 0.7, 0.6);
  const stache = mesh(new THREE.BoxGeometry(0.1, 0.018, 0.02), M.hair, 0, -0.06, 0.012, false);
  face.add(beard, stache);
  h.add(face);
  return { head: h, smile, open };
}

export function buildCharacter() {
  const root = new THREE.Group(); // positioned by the game (lane x, jump y), scaled for squash/stretch
  const rig = new THREE.Group(); // posed: lean, slide, crash
  root.add(rig);

  const L = leg(-1), R = leg(1);
  rig.add(L.hip, R.hip);

  // Shirt: lathe profile, untucked over the mundu.
  const shirtGeo = new THREE.LatheGeometry([[0.285, 0], [0.3, 0.14], [0.32, 0.36], [0.31, 0.5], [0.22, 0.6], [0.09, 0.65]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const shirt = mesh(shirtGeo, M.shirt, 0, 0.96, 0);
  shirt.scale.set(1.08, 1, 0.78);
  const collar = mesh(new THREE.TorusGeometry(0.1, 0.04, 6, 14), M.shirt, 0, 1.61, 0.01, false);
  collar.rotation.x = Math.PI / 2;
  rig.add(shirt, collar, mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.14, 10), M.skin, 0, 1.68, 0, false));

  // Mundu hangs from the waist; scaling its pivot shortens (folded) or drops (loose) it.
  const mundu = pivot(0, WAIST, 0);
  const clothGeo = new THREE.LatheGeometry([[0.36, -MUNDU_H], [0.335, -0.45], [0.3, -0.15], [0.28, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 22);
  const cloth = mesh(clothGeo, M.mundu);
  cloth.scale.z = 0.82;
  mundu.add(cloth);
  rig.add(mundu);
  const roll = mesh(new THREE.TorusGeometry(0.31, 0.055, 8, 20), M.mundu, 0, WAIST - MUNDU_H * 0.5, 0);
  roll.rotation.x = Math.PI / 2;
  roll.scale.y = 0.82;
  roll.visible = false;
  rig.add(roll);

  const LA = arm(-1), RA = arm(1);
  rig.add(LA.shoulder, RA.shoulder);
  const H = head();
  rig.add(H.head);

  root.rotation.y = Math.PI; // face away from the camera (down -z)

  // Swap in the rigged hero (Mixamo run cycle) when it loads; the code-built body stays as the fallback.
  let waistY = WAIST, munduLen = MUNDU_H, hero = null;
  // Ground each clip on the part we play; the falls on the pose he ends up lying in.
  const GROUND = { slide: [0.12, 0.95], fall: [2.2, 2.2], sweep: [1.75, 1.75] };
  const ready = loadHero('assets/models/hero.glb', GROUND).then((h) => {
    rig.traverse((o) => { if (o.isMesh) o.visible = false; });
    rig.add(h.scene);
    hero = h;
  }).catch((e) => console.warn('hero model not loaded, using the built-in character', e));

  let phase = 0, munduY = 1;
  const lerp = (a, b, k) => a + (b - a) * k;

  // pose: 'idle' | 'run' | 'jump' | 'slide' | 'crash'; mundu: normal | folded | loose | retie
  function posePuppet(pose, munduState, dt, speed = 14) {
    const k = Math.min(1, dt * 12);
    const target = munduState === 'folded' ? 0.5 : munduState === 'loose' ? 1.3 : 1;
    munduY = lerp(munduY, target, Math.min(1, dt * 8));
    mundu.scale.y = munduY;
    roll.visible = munduY < 0.75;
    roll.position.y = waistY - munduLen * munduY;
    mundu.rotation.x = lerp(mundu.rotation.x, munduState === 'loose' ? -0.2 : 0, k);
    const shocked = pose === 'crash' || munduState === 'loose';
    H.smile.visible = !shocked;
    H.open.visible = shocked;

    let lean = 0.14, y = 0, rx = 0;
    const stride = munduState === 'folded' ? 1.0 : munduState === 'loose' || munduState === 'retie' ? 0.35 : 0.62;
    H.head.rotation.set(0, 0, 0);
    if (pose === 'run') {
      phase += dt * speed * 0.6;
      const s = Math.sin(phase);
      L.hip.rotation.x = -stride * s;
      R.hip.rotation.x = stride * s;
      L.knee.rotation.x = Math.max(0, Math.sin(phase - 1.2)) * 1.1 * stride + 0.15;
      L.ankle.rotation.x = -L.knee.rotation.x * 0.6;
      R.knee.rotation.x = Math.max(0, -Math.sin(phase - 1.2)) * 1.1 * stride + 0.15;
      R.ankle.rotation.x = -R.knee.rotation.x * 0.6;
      LA.shoulder.rotation.set(stride * s, 0, 0.12);
      RA.shoulder.rotation.set(-stride * s, 0, -0.12);
      LA.elbow.rotation.set(-1.3, 0, 0);
      RA.elbow.rotation.set(-1.3, 0, 0);
      mundu.rotation.z = s * 0.05;
      y = Math.abs(Math.cos(phase)) * 0.07;
      H.head.rotation.z = s * 0.04;
      if (munduState === 'retie') {
        LA.shoulder.rotation.set(-0.5, 0, 0.2);
        RA.shoulder.rotation.set(-0.5, 0, -0.2);
        LA.elbow.rotation.set(-1.7, 0, 0);
        RA.elbow.rotation.set(-1.7, 0, 0);
        H.head.rotation.x = 0.35; // looking down at the knot
      }
    } else if (pose === 'jump') {
      L.hip.rotation.x = lerp(L.hip.rotation.x, -1.1, k);
      R.hip.rotation.x = lerp(R.hip.rotation.x, 0.25, k);
      L.knee.rotation.x = lerp(L.knee.rotation.x, 1.5, k);
      R.knee.rotation.x = lerp(R.knee.rotation.x, 1.1, k);
      LA.shoulder.rotation.x = lerp(LA.shoulder.rotation.x, -2.7, k);
      RA.shoulder.rotation.x = lerp(RA.shoulder.rotation.x, 0.7, k);
      LA.shoulder.rotation.z = lerp(LA.shoulder.rotation.z, 0.3, k);
      RA.shoulder.rotation.z = lerp(RA.shoulder.rotation.z, -0.4, k);
    } else if (pose === 'slide') {
      lean = 0;
      rx = -1.15;
      y = 0.32;
      L.hip.rotation.x = R.hip.rotation.x = -0.35;
      L.knee.rotation.x = 0.2;
      R.knee.rotation.x = 1.2;
      LA.shoulder.rotation.set(0.5, 0, 0.5);
      RA.shoulder.rotation.set(-1.3, 0, -0.2);
      H.head.rotation.x = 0.6; // chin tucked, looking ahead
    } else if (pose === 'crash') {
      rig.rotation.x = lerp(rig.rotation.x, -1.45, Math.min(1, dt * 5));
      rig.position.y = lerp(rig.position.y, 0.3, Math.min(1, dt * 5));
      LA.shoulder.rotation.z = lerp(LA.shoulder.rotation.z, 2.2, k);
      RA.shoulder.rotation.z = lerp(RA.shoulder.rotation.z, -2.2, k);
      L.hip.rotation.x = lerp(L.hip.rotation.x, -0.8, k);
      return;
    } else {
      // idle: hands on hips, gentle breathing
      lean = 0;
      L.hip.rotation.x = R.hip.rotation.x = 0;
      L.knee.rotation.x = R.knee.rotation.x = 0;
      LA.shoulder.rotation.set(0, 0, -0.5);
      RA.shoulder.rotation.set(0, 0, 0.5);
      LA.elbow.rotation.set(0, 0, 1.35);
      RA.elbow.rotation.set(0, 0, -1.35);
      phase += dt * 2;
      y = Math.sin(phase) * 0.012;
      H.head.rotation.z = Math.sin(phase * 0.5) * 0.06;
    }
    rig.rotation.x = lerp(rig.rotation.x, rx || lean, k); // +x leans forward (rig faces +z)
    rig.position.y = lerp(rig.position.y, y, k);
  }

  function reset() {
    rig.rotation.set(0, 0, 0);
    rig.position.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.rotation.y = Math.PI;
    munduY = 1;
  }

  // With the rigged hero, Mixamo clips drive the body:
  //  run   - loops, faster as he runs faster
  //  jump  - only the airborne part of the clip (crouch and landing cut), fitted to the game's air time
  //  slide - the feet-first slide part, fitted to the game's slide time (the rig no longer tilts for it)
  //  idle  - breathing loop (fallback for the home screen)
  //  fall  - pothole crash (trips onto his face); sweep - every other crash (legs knocked out, lands on his back)
  const CLIP = {
    jump: { from: 0.45, to: 1.2, time: 0.6 }, slide: { from: 0.12, to: 0.95, time: 0.65 },
    fall: { from: 0.55, to: 2.2, time: 1.4 }, sweep: { from: 0.25, to: 1.75, time: 1.35 },
    stumble: { from: 0, to: 1.17, time: 0.75 }, // Jogging Stumble: the dog catches up (see main.js STUMBLE_TIME)
  };
  // drink: the home screen's chaya loop (no entry = plays whole, looping)
  let current = null, currentName = null, clipPose = null;
  function playClip(name) {
    const next = hero.actions[name];
    if (!next || next === current) return;
    const c = CLIP[name];
    next.reset();
    next.setLoop(c ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = true;
    next.setEffectiveTimeScale(c ? (c.to - c.from) / c.time : 1);
    if (c) next.time = c.from;
    next.play();
    if (current) current.crossFadeTo(next, name === 'run' ? 0.15 : 0.08, false);
    current = next;
    currentName = name;
  }
  // crashKind: 'fall' (pothole) or 'sweep' (everything else)
  function animate(pose, munduState, dt, speed = 14, crashKind = 'sweep') {
    posePuppet(pose, munduState, dt, speed);
    if (!hero) return;
    H.smile.visible = H.open.visible = roll.visible = false; // the puppet re-shows these every frame
    hero.setFold(munduY);
    if (pose === 'idle' && !hero.actions.idle) { // no idle clip: his standing bind pose
      if (current) { hero.mixer.stopAllAction(); current = currentName = null; hero.mesh.skeleton.pose(); }
      hero.scene.position.y = hero.standY;
      clipPose = pose;
      return;
    }
    const want = pose === 'crash' ? crashKind : pose;
    if (want !== clipPose) {
      clipPose = want;
      playClip(hero.actions[want] ? want : 'run');
    }
    const clipDrives = hero.actions[want] && (pose === 'slide' || pose === 'crash' || pose === 'stumble');
    if (clipDrives) { rig.rotation.x = 0; rig.position.y = 0; } // the clip lies him down, not the rig tilt
    if (pose === 'run') current.setEffectiveTimeScale(Math.min(1.8, Math.max(1, speed / 14)));
    if (pose !== 'crash' || hero.actions[want]) hero.mixer.update(dt);
    // Keep his lowest point on the road for whichever clip is playing (blended through cross-fades).
    const target = hero.standY - (hero.lift[currentName] ?? 0);
    hero.scene.position.y += (target - hero.scene.position.y) * Math.min(1, dt * 12);
  }

  // The bone a held prop (the chaya glass) is parented to, once the rigged hero is in.
  const hand = () => hero?.scene.getObjectByName('mixamorigLeftHand') ?? null; // the Drinking clip lifts the left hand
  return { root, animate, reset, ready, hand }; // ready: resolves once the hero (or the fallback) is in
}
