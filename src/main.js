import * as THREE from 'three';
import { buildCharacter } from './character.js';
import { createDog } from './dog.js';
import { createWorld, loadModels, laneX, ROAD_W, SPAWN_Z, LANE_W, CROWN_Y } from './world.js';
import { createFx, CURVE, basic, TIME } from './fx.js';
import * as G from './logic.js';
import { share, distLabel } from './share.js';
import { loadSounds, play, queue, stopVoice, music, setVolume, spatial } from './sounds.js';

const $ = (id) => document.getElementById(id);
const GRAVITY = 32, JUMP_H = 1.25, SLIDE_TIME = 0.65, JUMP_BUFFER = 0.15;
const NUT_G = 14; // falling coconut gravity
const SOLID = new Set(['bus', 'auto', 'bike', 'car']); // a rolling coconut bounces off these
const SCRAPE = new Set(['bus', 'auto', 'bike', 'car', 'coconut']); // side-clipping these is a stumble, not a crash
const lerp = (a, b, k) => a + (b - a) * k;
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- renderer, scene, world
// Settings (menu gear): reduce = no shake / zoom / speed lines / crash push-in; low = 1x pixels, no shadows, less rain.
// Everyone starts on full graphics and motion; only the player turns them down (settings, or the lag question).
// Reduce still follows the phone's own "reduce motion" accessibility switch, since the player set that themselves.
// One-time reset: older builds switched low on by themselves, so those saved values aren't the player's choice.
if (store.get('krb-gfx-reset', '0') !== '1') { store.set('krb-low', '0'); store.set('krb-gfx-reset', '1'); }
const settings = {
  reduce: store.get('krb-reduce', matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0') === '1',
  low: store.get('krb-low', '0') === '1',
  music: +store.get('krb-music', '0.8'),
  sfx: +store.get('krb-sfx', '1'),
};
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: devicePixelRatio < 2, powerPreference: 'high-performance' }); // dense phone screens don't need MSAA; it costs a lot of fill there
const pixelRatio = () => (settings.low ? 1 : Math.min(devicePixelRatio, 1.5)); // phones: 1.5x looks the same at this size and shades ~45% fewer pixels than 2x
renderer.setPixelRatio(pixelRatio());
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
// Loading screen: every GLTF/texture loader reports to three's default manager. The bar only moves forward,
// because late items (hero textures) grow the total.
const fill = $('bar-fill');
let loadPct = 0, loadIdle = false;
THREE.DefaultLoadingManager.onStart = () => { loadIdle = false; };
THREE.DefaultLoadingManager.onProgress = (url, n, total) => { loadIdle = n === total; loadPct = Math.max(loadPct, n / total); fill.style.width = `${8 + loadPct * 87}%`; };
const texturesLoaded = () => new Promise(function check(done) { loadIdle ? done() : setTimeout(() => check(done), 100); });
const char = buildCharacter(); // starts hero.glb now, in parallel with the scenery models
const dog = createDog(scene); // dog.glb, in parallel too
// Sounds download and decode from the start too (a suspended AudioContext can decode before any tap); the Play tap resumes it.
let ac = null;
try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
const soundsReady = loadSounds(ac, () => muted, THREE.DefaultLoadingManager); // each file counts on the loading bar
const world = createWorld(scene, renderer, await loadModels());
window.__app = { renderer, scene, world, camera }; // read by the perf check (draw calls, triangles) and the visual checks
const fx = createFx(scene);
let baseFov = 62;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  baseFov = camera.aspect < 0.7 ? 68 : 56; // portrait phones need a wider view of the lanes
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- player
scene.add(char.root);
// Home-screen key light from the camera side, so the hero reads like his studio concept art; fades out in a run.
const heroFill = new THREE.DirectionalLight(0xfff0e0, 0);
scene.add(heroFill, heroFill.target);
// After every light exists (light count is part of each shader). Compile every shader a run can need (obstacles, coins, particles, their shadow passes) by drawing one
// hidden frame with them all in view, so the first bike, coconut or coin sparkle doesn't stall the game.
{
  const warm = [...['bus', 'auto', 'bike', 'car', 'pothole', 'flex', 'coconut'].map((type) => world.FACTORY[type]({ lane: 1, toLane: 2 }).mesh), world.FACTORY.bus({ oncoming: true }).mesh, ...[1, 5, 'puff'].map((v) => world.makeCoin(v))];
  warm.forEach((m, i) => { m.position.set((i % 3) - 1, 0, -6 - i); scene.add(m); });
  const at = new THREE.Vector3(0, 1, -6);
  fx.coin(at, 0xffffff); fx.dust(at); fx.stars(at); fx.smoke(at);
  renderer.compile(scene, camera); // everything, not just what the home-screen camera can see
  renderer.render(scene, camera); // and the shadow pass
  for (const m of warm) scene.remove(m);
  fx.update(10, 0); // retire the warm-up particles
}
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18).rotateX(-Math.PI / 2), basic({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
blob.position.y = 0.03;
scene.add(blob);

// ---------- chaya kada (home screen) + the dog chase
// Home: he sips chaya at the stall. ODU plays the intro (dog walks in, barks, glass drops, he bolts); the dog then chases
// behind him. A stumble brings it to his heels (G.CHASE.WINDOW s); a second one inside that = caught (crash 'dog').
const stall = world.chai();
const STALL_AT = new THREE.Vector3(4.8, 0, 2.2); // on the left footpath (seen from the home camera), past the kerb at ROAD_W/2
stall.rotation.y = -0.5; // counter faces the road, turned a little toward the camera
const HERO_AT = new THREE.Vector3(3.15, 0, 1.75); // road edge, in front of the counter
const HERO_FACE = Math.atan2(STALL_AT.x - HERO_AT.x, STALL_AT.z - HERO_AT.z); // facing the stall, back half to the camera
scene.add(stall);
const glass = world.glass();
glass.castShadow = true;
const GLASS_IN_HAND = { pos: new THREE.Vector3(0, 0.06, 0.06), rot: new THREE.Euler(0, 0, 0), scale: 1.7 }; // hand-bone space (hero.glb is in metres)
function glassToHand() {
  const hand = char.hand();
  if (!hand) return;
  hand.add(glass);
  glass.position.copy(GLASS_IN_HAND.pos);
  glass.rotation.copy(GLASS_IN_HAND.rot);
  glass.scale.setScalar(GLASS_IN_HAND.scale);
}
let glassFree = false;
function dropGlass() {
  if (!glass.parent || glassFree) return;
  const ws = glass.getWorldScale(new THREE.Vector3()).x;
  scene.attach(glass);
  glass.scale.setScalar(ws);
  glassFree = true;
  glass.userData.v = new THREE.Vector3(0.6, 1.5, -0.8);
}
function updateGlass(dt, ds = 0) {
  if (!glassFree) return;
  glass.position.z += ds; // left behind on the road once he runs
  if (glass.position.z > 14) glass.visible = false;
  const v = glass.userData.v;
  if (v.lengthSq() === 0) return;
  v.y -= GRAVITY * 0.6 * dt;
  glass.position.addScaledVector(v, dt);
  glass.rotation.z += 9 * dt;
  if (glass.position.y <= 0.05) { // hits the road: clang, chaya splashes, it lies there
    glass.position.y = 0.05;
    glass.rotation.set(0, 0.4, Math.PI / 2);
    v.set(0, 0, 0);
    play('glass_clang', () => sfx([1800, 2400, 1500], { dur: 0.25, type: 'triangle', vol: 0.08, gap: 0.05 }));
    fx.dust(glass.position.clone(), 8);
    fx.coin(glass.position.clone().setY(0.2), 0x8a5a2b); // brown splash
  }
}
function resetStall() {
  stall.position.copy(STALL_AT);
  stall.visible = true;
  glassFree = false;
  glassToHand();
}
char.ready.then(resetStall);
resetStall();

const DOG_FAR = 4.6, DOG_CLOSE = 1.5; // metres behind the hero (the run camera is at +6.6)
const STUMBLE_TIME = 0.75; // matches the stumble clip's play time in character.js
let chase = G.createChase(), runT = 0, dogX = 0, dogZ = DOG_FAR, nextBark = 0, stumbleT = 0, introT = 0, dogLeapT = -1;
const dogFrom = new THREE.Vector3();
// Off stage: behind the menu camera, still drawn so its shaders compile with everything else.
function dogHome() { dog.root.position.set(-2.5, 0, -14); dog.root.rotation.set(0, 0, 0); dog.bite(false); dogLeapT = -1; }
dogHome();
dog.root.visible = true;
function barkNow() {
  dog.bark();
  play('dog_bark', () => sfx([520, 380], { dur: 0.09, type: 'sawtooth', vol: 0.06, gap: 0.11 }));
}
// Returns true when this stumble got him caught (the run is over).
function stumbleHit() {
  if (G.stumble(chase, runT) === 'caught') { crash('dog'); return true; }
  stumbleT = STUMBLE_TIME;
  play('stumble', () => sfx([180], { dur: 0.18, type: 'square', vol: 0.06, to: 90 }));
  play('dog_growl', () => sfx([90, 80], { dur: 0.35, type: 'sawtooth', vol: 0.06, gap: 0.2 }));
  barkNow(); // the dog closes in on a scrape or trip
  say(G.STUMBLE_LINE[Math.floor(Math.random() * G.STUMBLE_LINE.length)]);
  if (!settings.reduce) shake = Math.max(shake, 0.3);
  navigator.vibrate?.(60);
  return false;
}
// The dog runs in his lane a beat behind him; right at his heels while the chase window is open.
function updateDog(dt, v) {
  const close = G.isClose(chase, runT);
  dogZ = lerp(dogZ, close ? DOG_CLOSE : DOG_FAR, Math.min(1, dt * (close ? 6 : 1.2)));
  const pdx = dogX;
  dogX = lerp(dogX, px, Math.min(1, dt * 5));
  const side = (dogX - pdx) / Math.max(dt, 1e-4);
  dog.root.position.set(dogX, 0, dogZ);
  dog.root.rotation.set(0, side * -0.04, 0);
  dog.update(dt, side < -1.5 ? 'leanL' : side > 1.5 ? 'leanR' : 'run', Math.min(1.6, Math.max(1, v / 14)));
}

// Bus horns only as a bus passes: a random horn starts HORN_LEAD s before the bus reaches you (so the 1.6-3 s clip
// peaks as it goes by), fades in as it nears and out as it goes behind, pitched up then down (Doppler). Charging KSRTCs always honk, other buses 2 in 3.
const HORN_LEAD = 1.0, HORN_FALLOFF = 12; // metres at which the horn is at half volume
function busHorn(o, dt) {
  const vz = o.lastZ === undefined ? 0 : (o.z - o.lastZ) / Math.max(dt, 1e-4); // closing speed along the road
  o.lastZ = o.z;
  const d = Math.hypot(o.x - px, o.z);
  if (!o.honked && vz > 0 && o.z < 0 && -o.z < vz * HORN_LEAD) { o.honked = true; if (o.oncoming || Math.random() < 2 / 3) o.horn = spatial('horn'); }
  if (!o.horn) return;
  if (o.horn.done || o.z > 40) { o.horn.stop(); o.horn = null; return; }
  const closing = Math.max(-60, Math.min(60, (vz * -o.z) / Math.max(d, 1))); // m/s toward you
  o.horn.set(1 / (1 + (d / HORN_FALLOFF) ** 2), 343 / (343 - closing));
}

// Intro (~3.5 s, any tap or key skips): dog walks in behind him, barks twice, he drops the glass, bolts; camera swings behind.
const INTRO = { BARK: 1.0, DROP: 1.8, BOLT: 2.3, END: 3.5 };
const ORIGIN = new THREE.Vector3();
const DOG_IN = [new THREE.Vector3(0.4, 0, 6.2), new THREE.Vector3(2.3, 0, 2.9)];
let introDaily = false;
function updateIntro(dt, t) {
  const prev = introT;
  introT += dt;
  const at = (k) => prev < k && introT >= k;
  if (prev === 0) play('chaya_sip'); // last sip before the dog shows up
  const d = dog.root.position;
  if (introT < INTRO.BARK) { // walking in from the road behind him
    d.lerpVectors(DOG_IN[0], DOG_IN[1], introT / INTRO.BARK);
    dog.root.rotation.set(0, Math.atan2(-(DOG_IN[1].x - DOG_IN[0].x), -(DOG_IN[1].z - DOG_IN[0].z)), 0);
    dog.update(dt, 'walk', 1.4);
  } else if (introT < INTRO.BOLT) dog.update(dt, 'idle');
  if (at(INTRO.BARK) || at(INTRO.BARK + 0.4)) barkNow();
  if (at(INTRO.DROP)) dropGlass();
  if (introT < INTRO.BOLT) {
    const toDog = Math.atan2(d.x - HERO_AT.x, d.z - HERO_AT.z);
    char.root.position.copy(HERO_AT);
    char.root.rotation.y = lerp(char.root.rotation.y, introT < INTRO.DROP ? HERO_FACE : toDog, Math.min(1, dt * 8)); // looks round at the dog
    char.animate(introT < INTRO.DROP ? 'drink' : 'idle', 'normal', dt);
    updateGlass(dt);
  } else { // running: the road starts moving, the stall and the glass fall behind; he cuts across to the middle lane
    if (at(INTRO.BOLT)) { play('start'); barkNow(); }
    const v = 14 * Math.min(1, (introT - INTRO.BOLT) / 0.6), ds = v * dt;
    char.root.position.lerp(ORIGIN, Math.min(1, dt * 5));
    char.root.rotation.y = Math.PI + char.root.position.x * 0.15; // angled toward the centre while crossing
    char.animate('run', 'normal', dt, Math.max(v, 8));
    world.scroll(ds);
    stall.position.z += ds;
    updateGlass(dt, ds);
    dogX = lerp(d.x, 0, Math.min(1, dt * 4));
    dogZ = lerp(d.z, DOG_FAR, Math.min(1, dt * 2));
    d.set(dogX, 0, dogZ);
    dog.root.rotation.set(0, 0, 0);
    dog.update(dt, 'run', 1.2);
  }
  blob.position.set(char.root.position.x, 0.03, char.root.position.z);
  world.follow(0);
  world.ambient(dt, 0, t, false, fx);
  fx.update(dt, 0, camera.position.z);
  if (introT >= INTRO.END) begin(introDaily, false);
}
const skipIntro = () => { if (state === 'intro' && introT < INTRO.END) introT = INTRO.END - 1e-3; };

// ---------- audio (synthesised, no files)
let muted = store.get('krb-muted', '0') === '1';
function sfx(notes, { dur = 0.12, type = 'triangle', vol = 0.14, to, gap = 0.07 } = {}) {
  if (!ac || muted) return;
  const t = ac.currentTime;
  notes.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), s = t + i * gap;
    o.type = type;
    o.frequency.setValueAtTime(f, s);
    if (to) o.frequency.exponentialRampToValueAtTime(to, s + dur);
    g.gain.setValueAtTime(Math.max(0.001, vol * settings.sfx), s);
    g.gain.exponentialRampToValueAtTime(0.001, s + dur);
    o.connect(g).connect(ac.destination);
    o.start(s);
    o.stop(s + dur);
  });
}
function crashSound() {
  if (!ac || muted) return;
  const len = ac.sampleRate * 0.4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.6 * settings.sfx;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
  sfx([110], { dur: 0.35, type: 'square', vol: 0.12, to: 40 });
}
const COIN_SFX = { 1: [880], 5: [1568, 2093] };

// ---------- game state
let state = 'menu'; // menu | run | paused | dead | over
let dist = 0, puffs = 0, collected, lane = 1, px = 0, py = 0, vy = 0, slideT = 0, slideQueued, mundu = G.createMundu();
let nextRowDist, clearLane = -1, rowRng, deadT, cause, daily, shake = 0;
let jumpAt = -9, openLanes = [0, 1, 2]; // jumpAt: when 'up' was pressed in the air, replayed on landing
let streak = 0, lastCoinT = -9, passedBest = false, rainAt = Infinity, overAt = 0;
const objs = [], coins = [];
window.__app.objs = objs; // read by the autoplay check (tools/autoplay)
window.__app.peek = () => ({ dist, lane, px, py, state, slideT, cause, mundu: mundu.state });
let best = +store.get('krb-best', '0');
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Time of day and weather follow the distance run: dusk with streetlights from 2 km, and on about 1 run in 7 a
// monsoon shower somewhere between 600 m and 2.4 km that lasts ~450 m. The daily road gets the same weather for everyone.
function mood() {
  const wet = Math.min(clamp01((dist - rainAt) / 60), clamp01((rainAt + 450 - dist) / 60));
  world.setMood(clamp01((dist - 2000) / 800), wet);
}

function clearWorld() {
  for (const o of objs) { scene.remove(o.mesh); o.horn?.stop(); }
  for (const c of coins) scene.remove(c.mesh);
  objs.length = coins.length = 0;
}

function reset(isDaily) {
  clearWorld();
  daily = isDaily;
  rowRng = G.rng(isDaily ? G.dailySeed() : (Math.random() * 2 ** 32) >>> 0);
  dist = collected = puffs = 0;
  lane = 1; px = py = vy = slideT = 0;
  slideQueued = false;
  jumpAt = -9;
  openLanes = [0, 1, 2];
  mundu = G.createMundu();
  nextRowDist = 60;
  clearLane = -1;
  streak = 0;
  passedBest = best <= 0; // nothing to beat on a first run
  const wr = isDaily ? G.rng(G.dailySeed() ^ 0x5eed) : Math.random; // own stream: never shifts the daily obstacles
  rainAt = wr() < 0.15 ? 600 + wr() * 1800 : Infinity;
  char.reset();
}

function spawnRow(row, z) {
  for (const o of row.obstacles) {
    const made = world.FACTORY[o.type](o);
    const ob = { ...o, ...made, x: laneX(o.lane), z: o.oncoming ? z - G.ONCOMING.LEAD : z, len: G.KIND[o.type].len };
    made.mesh.position.set(ob.x, 0, ob.z);
    scene.add(made.mesh);
    objs.push(ob);
  }
  for (const c of row.coins) {
    const mesh = world.makeCoin(c.value);
    const coin = { ...c, x: laneX(c.lane), z: z + c.dz, mesh, bob: Math.random() * 6 };
    mesh.position.set(coin.x, c.y, coin.z);
    scene.add(mesh);
    coins.push(coin);
  }
}

// ---------- HUD
const ui = { wallet: $('wallet'), coinNum: $('coin-num'), dist: $('dist'), mundu: $('mundu'), label: $('mundu-label'), grip: $('grip'), caption: $('caption'), toBest: $('to-best'), speed: $('speed') };
const shown = {};
function setText(el, key, text) {
  if (shown[key] === text) return;
  shown[key] = text;
  el.textContent = text;
}
function restartAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}
function say(text) {
  ui.caption.textContent = text;
  restartAnim(ui.caption, 'show');
}
const MUNDU_LABEL = { normal: 'Mundu', folded: 'Madakki kuthi!', loose: 'Azhinju! 2 tap', retie: 'Kuthunnu…' };
function hud() {
  setText(ui.coinNum, 'w', String(collected));
  setText(ui.dist, 'd', `${Math.floor(dist)} m`);
  setText(ui.label, 'm', mundu.state === 'normal' && mundu.cool > 0 ? `Kaathiri ${Math.ceil(mundu.cool)}s` : MUNDU_LABEL[mundu.state]);
  const pips = mundu.state === 'loose' || mundu.state === 'retie' ? 0 : mundu.grip;
  if (shown.g !== pips) {
    shown.g = pips;
    ui.grip.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < pips));
  }
  ui.mundu.className = `mundu-pill ${mundu.state}`;
  // How far to your best; one "NEW BEST" shout the moment you pass it.
  if (!passedBest && dist > best) { passedBest = true; say('NEW BEST! 🔥 Odu odu!'); }
  setText(ui.toBest, 'b', passedBest ? '' : `Best-inu ${Math.ceil(best - dist)} m koode`);
  ui.speed.classList.toggle('on', mundu.state === 'folded' && !settings.reduce); // speed lines while the fold boosts you
}

// ---------- actions
function startSlide() {
  slideT = SLIDE_TIME;
  fx.dust(new THREE.Vector3(px, 0.2, 0.4), 5);
  if (G.slide(mundu)) {
    play('loose', () => sfx([520], { dur: 0.35, type: 'sawtooth', vol: 0.08, to: 140 }));
    say('Ayyo mundu poyi!');
  } else play('slide');
}
function jump() {
  vy = Math.sqrt(2 * GRAVITY * JUMP_H * G.jumpMul(mundu));
  slideT = 0;
  char.root.scale.set(0.85, 1.2, 0.85); // stretch on take-off
  play('jump', () => sfx([400], { dur: 0.12, type: 'sine', vol: 0.06, to: 800 }));
}
function act(a) {
  if (state !== 'run') return;
  const now = performance.now() / 1000;
  if (a === 'left') lane = Math.max(0, lane - 1);
  else if (a === 'right') lane = Math.min(2, lane + 1);
  else if (a === 'up') {
    if (!G.canJump(mundu)) return say('Mundu azhinju! 2 tap cheyyu');
    if (py === 0) jump(); else jumpAt = now;
  } else if (a === 'down') {
    if (py > 0) { vy = -26; slideQueued = true; } else startSlide();
  } else if (a === 'tap') {
    const t = G.tap(mundu, now);
    if (t === 'retie') say('Onnu kuthatte…');
    else if (t === 'cooling') say(`Mundu settle aavatte, ${Math.ceil(mundu.cool)} second`);
    else if (t === 'fold') {
      if (py > 0) vy = Math.max(vy, Math.sqrt(2 * GRAVITY * Math.max(0, JUMP_H * G.jumpMul(mundu) - py))); // the fold kicks you up to the high-jump height
      play('fold', () => sfx([300], { dur: 0.25, type: 'sawtooth', vol: 0.07, to: 1100 }));
      say('Madakki kuthi, ini scene maarum!');
    }
  }
}

// Touch + mouse swipes via pointer events; a short press without movement is a tap.
let ptr = null;
addEventListener('pointerdown', (e) => {
  if (state === 'intro') return skipIntro(); // no ptr: this tap never becomes a move
  if (state !== 'run' || e.target.closest('button')) return;
  ptr = { x: e.clientX, y: e.clientY, used: false };
});
addEventListener('pointermove', (e) => {
  if (!ptr || ptr.used) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  if (Math.hypot(dx, dy) < 28) return;
  ptr.used = true;
  act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down');
});
addEventListener('pointerup', () => {
  if (ptr && !ptr.used) act('tap');
  ptr = null;
});
addEventListener('pointercancel', () => (ptr = null));
const KEYS = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ' ': 'tap' };
addEventListener('keydown', (e) => {
  if (e.repeat || e.target.closest?.('input')) return; // let the name field type a/d/w/s/space
  if (state === 'intro') return skipIntro();
  if ((e.key === 'Escape' || e.key === 'p') && (state === 'run' || state === 'paused')) return state === 'run' ? pause() : resume();
  if (KEYS[e.key]) { e.preventDefault(); act(KEYS[e.key]); }
});
document.addEventListener('visibilitychange', () => document.hidden && state === 'run' && pause());

// ---------- update
function hits(o, h) {
  switch (o.type) {
    case 'pothole': return false; // handled in update(): late jumps and loose-mundu stumbles
    case 'car': return py < 0.7; // forgiving: the 800's roof is ~1.3 m, the jump peaks at 1.25 m
    case 'flex': return py + h > 1.32;
    case 'coconut': return o.cy - 0.3 < py + h && o.cy + 0.3 > py;
    default: return py < o.top;
  }
}

function update(dt, t) {
  runT += dt;
  const base = Math.min(30, 14 + dist * 0.0035);
  const v = base * G.speedMul(mundu);
  const ds = v * dt;
  dist += ds;
  world.scroll(ds);
  world.ambient(dt, ds, t, true, fx);
  mood();
  CURVE.value.x = Math.sin(dist / 160) * 0.0011; // the road gently winds left and right

  // Rows are spaced by distance only, so the daily road is the same for everyone.
  while (nextRowDist - dist < -SPAWN_Z) {
    const row = G.makeRow(rowRng, Math.min(1, nextRowDist / 3000), nextRowDist, clearLane, openLanes);
    clearLane = row.obstacles.filter((o) => o.oncoming).map((o) => o.lane); // every oncoming bus's lane, not just the first
    openLanes = [0, 1, 2].filter((l) => !G.hardLanes(row).has(l));
    spawnRow(row, -(nextRowDist - dist));
    nextRowDist += G.rowGap(nextRowDist);
  }


  // Player
  const prevX = px;
  px = lerp(px, laneX(lane), Math.min(1, dt * 14));
  if (py > 0 || vy > 0) {
    vy -= GRAVITY * dt;
    py += vy * dt;
    if (py <= 0) {
      py = vy = 0;
      char.root.scale.set(1.2, 0.8, 1.2); // squash on landing
      fx.dust(new THREE.Vector3(px, 0.2, 0.3), 4);
      play('land');
      if (slideQueued) { slideQueued = false; startSlide(); }
      else if (performance.now() / 1000 - jumpAt < JUMP_BUFFER && G.canJump(mundu)) { jumpAt = -9; jump(); } // swiped up just before landing
    }
  }
  slideT = Math.max(0, slideT - dt);
  if (G.tickMundu(mundu, dt)) { say('Ready! Mundu set 👍'); play('retie'); }
  const sliding = slideT > 0;
  const h = sliding ? 0.9 : 2.0;
  char.root.position.set(px, py, 0);
  char.root.rotation.z = (prevX - px) * 0.9; // lean into lane changes
  char.root.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 10));
  stumbleT = Math.max(0, stumbleT - dt);
  char.animate(py > 0.01 ? 'jump' : sliding ? 'slide' : stumbleT > 0 ? 'stumble' : 'run', mundu.state, dt, v);
  updateDog(dt, v);
  updateGlass(dt, ds);
  blob.position.x = px;
  blob.scale.setScalar(Math.max(0.4, 1 - py * 0.25));
  world.follow(px);

  // Obstacles
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    o.z += ds;
    if (o.oncoming) {
      // Charging KSRTC: honks as it starts, rocks on its springs, belches smoke, and shakes the camera as it nears your lane.
      if (o.z > -G.ONCOMING.START) {
        o.charging = true;
        o.z += ds * G.ONCOMING.BOOST;
        o.smokeT -= dt;
        if (o.smokeT <= 0) { o.smokeT = 0.07; fx.smoke(new THREE.Vector3(o.x + 0.7, 3.1, o.z - 3.4)); }
        if (Math.abs(o.x - px) < LANE_W * 0.6 && o.z > -25 && !settings.reduce) shake = Math.max(shake, 0.05 + (1 + o.z / 25) * 0.1);
      }
      o.body.position.y = Math.abs(Math.sin(t * 11 + o.wob)) * 0.06;
      o.body.rotation.z = Math.sin(t * 5.3 + o.wob) * 0.025;
      for (const w of o.wheels) w.rotation.x += dt * 16;
    }
    if (o.type === 'bus') busHorn(o, dt);
    o.mesh.position.z = o.z;
    if (o.type === 'auto') {
      if (o.z > -60) o.blinker.material.emissive.setHex(Math.floor(t * 6) % 2 ? 0xff8800 : 0x000000);
      if (o.z > -34 && o.moveT < 1) {
        if (o.moveT === 0) play('auto_horn'); // swerve warning
        o.moveT = Math.min(1, o.moveT + dt / 0.7);
        const e = o.moveT * o.moveT * (3 - 2 * o.moveT);
        o.x = lerp(laneX(o.lane), laneX(o.toLane), e);
        o.mesh.position.x = o.x;
        o.mesh.rotation.y = Math.sin(o.moveT * Math.PI) * 0.3 * Math.sign(o.lane - o.toLane);
      }
      // two-stroke shudder: a quick buzz on its springs plus a slow rock, so it reads as running even before it swerves
      o.wob ??= Math.random() * 6;
      o.mesh.position.y = Math.abs(Math.sin(t * 34 + o.wob)) * 0.025 + (1 + Math.sin(t * 3.1 + o.wob)) * 0.01; // never dips into the road
      o.mesh.rotation.z = Math.sin(t * 21 + o.wob) * 0.01 + Math.sin(t * 2.3 + o.wob) * 0.018;
    } else if (o.type === 'bike') {
      for (const w of o.wheels) w.rotation.x -= dt * 14; // riding away from you
      o.mesh.rotation.z = Math.sin(t * 1.7 + o.wob) * 0.045; // rider balancing
      o.mesh.position.y = Math.abs(Math.sin(t * 27 + o.wob)) * 0.018; // engine buzz
      o.riders.position.y = Math.abs(Math.sin(t * 9 + o.wob)) * 0.025; // road bumps
    } else if (o.type === 'coconut') {
      // hang → shake (tree warns you) → fall with gravity → land at the player's z with a bounce and squash.
      const H = CROWN_Y - 0.3, tFall = Math.sqrt((2 * H) / NUT_G), tReach = -o.z / v;
      if (o.phase === 'hang' && tReach < tFall + 0.75) { o.phase = 'shake'; o.t = 0; }
      if (o.phase === 'shake' && tReach <= tFall) { o.phase = 'fall'; o.z0 = Math.min(o.z, -0.01); }
      if (o.phase === 'fall' && o.z >= 0) {
        o.phase = 'land'; o.t = 0; fx.dust(new THREE.Vector3(o.x, 0.2, o.z), 6); play('coconut_land');
      }
      o.t += dt;
      let sway = 0;
      if (o.phase === 'shake') sway = Math.sin(o.t * 28) * 0.045 * Math.min(1, o.t / 0.3);
      else if (o.phase !== 'hang') sway = Math.sin((o.t + (o.phase === 'fall' ? 0 : 0.6)) * 18) * 0.05 * Math.exp(-o.t * 2.5); // springs back after letting go
      o.palm.rotation.z = sway;
      if (o.phase === 'hang' || o.phase === 'shake') {
        o.cy = CROWN_Y;
        o.nut.position.x = -sway * CROWN_Y; // rides along with the crown
      } else if (o.phase === 'fall') {
        const f = 1 - o.z / o.z0; // 0 at release → 1 at the ground; constant speed makes this gravity
        o.cy = 0.3 + H * (1 - f * f);
        o.nut.position.x *= 0.9;
        o.nut.rotation.x += dt * 9;
        o.nut.rotation.z += dt * 5;
      } else {
        o.cy = 0.3 + Math.abs(Math.sin(o.t * 7)) * 0.7 * Math.exp(-o.t * 3); // bouncing hops that die down
        const sq = Math.exp(-o.t * 9) * 0.35; // squash on impact, springs back
        o.nut.scale.set(1 + sq, 1.1 - sq, 1 + sq);
        // Roll sideways with friction, spinning as it goes; knocks back off the kerb instead of leaving the road.
        o.roll *= Math.exp(-dt * 1.2);
        o.nut.position.x += o.roll * dt;
        const wx = laneX(o.lane) + o.nut.position.x, edge = ROAD_W / 2 - 0.5;
        if (Math.abs(wx) > edge) { o.nut.position.x = Math.sign(wx) * edge - laneX(o.lane); o.roll *= -0.4; }
        // ...and off a vehicle or another landed coconut in the next lane instead of rolling through it
        const hit = objs.find((b) => (SOLID.has(b.type) || (b.type === 'coconut' && b !== o && b.phase === 'land')) && Math.abs(b.z - o.z) < b.len / 2 + 0.3 && Math.abs(b.x - wx) < b.halfW + 0.3);
        if (hit) { o.nut.position.x = hit.x - Math.sign(o.roll) * (hit.halfW + 0.3) - laneX(o.lane); o.roll *= -0.4; }
        o.nut.rotation.z -= (o.roll * dt) / 0.3;
        o.nut.rotation.x += dt * 2 * Math.exp(-o.t * 2);
        o.x = laneX(o.lane) + o.nut.position.x; // a rolling nut still trips you
        o.shadow.position.x = o.nut.position.x;
      }
      o.nut.position.y = o.cy;
      const show = o.phase === 'hang' ? 0 : o.phase === 'shake' ? Math.min(1, o.t / 0.5) : 1; // landing spot appears as the tree shakes
      o.shadow.scale.setScalar(Math.max(0.5, 1.6 - o.cy * 0.12));
      o.shadow.material.opacity = show * Math.min(0.55, 0.15 + 4 / (o.cy + 4));
    }
    const alongside = o.z + o.len / 2 > -0.35 && o.z - o.len / 2 < 0.35;
    const gap = Math.abs(o.x - px) - (o.halfW + 0.3);
    const over = alongside && gap < 0;
    if (over && hits(o, h) && !o.scraped) {
      // Clipping the side while still changing lanes = a scrape: bounce away from it and stumble. Anything else = crash.
      if (SCRAPE.has(o.type) && G.isScrape({ lateral: Math.abs(px - laneX(lane)), overlap: -gap })) {
        o.scraped = true;
        const oLane = Math.round(o.x / LANE_W) + 1;
        lane = Math.min(2, Math.max(0, oLane + (Math.sign(px - o.x) || 1)));
        if (stumbleHit()) return;
      } else return crash(o.type);
    }
    if (over && o.type === 'pothole' && !o.cleared) {
      const air = py >= 0.15;
      if (!air && !G.canJump(mundu)) { // a loose mundu can't jump: stumble through (counts as a stumble)
        o.cleared = true;
        fx.dust(new THREE.Vector3(px, 0.2, 0.3), 6); play('land'); say('Kuzhiyil veenu, mundu kuthu!');
        if (stumbleHit()) return;
      } else if (!air || o.late) {
        const r = G.lateJump((o.z + o.len / 2 + 0.35) / (o.len + 0.7), air);
        if (r === 'crash') return crash('pothole');
        if (r === 'wait') o.late = true;
        else if (r === 'stumble') { o.cleared = true; fx.dust(new THREE.Vector3(px, 0.2, 0.3), 6); if (stumbleHit()) return; }
      }
    }
    if (over && (o.type === 'pothole' || o.type === 'car') && !o.cleared && py >= 0.15) { o.cleared = true; play('pothole_jump'); } // in the air above it, so jumped clean
    if (alongside && !o.cleared && gap >= 0 && o.type === 'bus') { o.cleared = true; if (Math.random() < 0.5) play('bus_dodge'); } // "Shivaneee!" on about half the buses that pass
    if (alongside && !o.cleared && gap >= 0 && gap < LANE_W && o.type === 'bike') { o.cleared = true; play('bike_pass'); }
    if (o.z - o.len / 2 > 14) {
      o.horn?.stop();
      scene.remove(o.mesh);
      objs.splice(i, 1);
    }
  }

  // Chillara
  const reachX = mundu.state === 'folded' ? 1.0 : 0.7;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.z += ds;
    c.mesh.position.set(c.x, c.y + Math.sin(t * 4 + c.bob) * 0.08, c.z);
    if (Math.abs(c.z) < (c.y > 2.2 ? 1.2 : 0.65) && Math.abs(c.x - px) < reachX && c.y <= py + (sliding ? 1.0 : 1.7) && c.y >= py - 0.3) {
      if (c.value === 'puff') {
        puffs++;
        collected += G.PUFF.BONUS;
        fx.coin(c.mesh.position, 0xffb300); fx.stars(c.mesh.position);
        play('puff', () => sfx([784, 988, 1175, 1568], { dur: 0.16, vol: 0.13, gap: 0.09 }));
        say(`🥚 LEGENDARY! Motta puffs kitti! +₹${G.PUFF.BONUS}`);
        navigator.vibrate?.([40, 40, 80]);
      } else {
        collected += c.value;
        fx.coin(c.mesh.position, world.COIN[c.value].burst);
        play('coin' + c.value, () => sfx(COIN_SFX[c.value], { dur: c.value === 5 ? 0.2 : 0.1, vol: c.value === 5 ? 0.12 : 0.09 }));
      }
      // Coin streak: pickups less than 1.5 s apart; a buzz + shout only at milestones (50, 100, 150…).
      streak = t - lastCoinT < 1.5 ? streak + 1 : 1;
      lastCoinT = t;
      if (streak % 50 === 0) { navigator.vibrate?.(25); say(`${streak} chillara streak! 💰`); }
      restartAnim(ui.wallet, 'bump');
    } else if (c.z < 14) continue;
    scene.remove(c.mesh);
    coins.splice(i, 1);
  }
  fx.update(dt, ds, camera.position.z);
  hud();
}

function crash(why) {
  state = 'dead';
  cause = why;
  deadT = 0;
  shake = settings.reduce ? 0 : 0.5;
  ui.speed.classList.remove('on');
  crashSound(); // the thud always plays; the meme line goes on top
  nextBark = 0.5; // one bark as the dog reaches him (frame())
  if (why === 'bus') play('bus_brake');
  if (why === 'dog') { // the leap plays in frame() (dogLeapT)
    dogLeapT = 0;
    dogFrom.copy(dog.root.position);
    play('dog_snarl', () => sfx([140, 110], { dur: 0.3, type: 'sawtooth', vol: 0.07, gap: 0.15 }));
    play('hero_yelp');
  } else play('crash_' + why, () => play('crash'));
  fx.stars(new THREE.Vector3(px, 2.2, 0));
  navigator.vibrate?.(180);
  say(G.CRASH_LINE[why]);
}

// ---------- camera
const CRASH_SLOW = 0.9, CRASH_PUSH = 1.1; // seconds of 30% slow motion, and of the camera push-in, after a crash
const camPos = new THREE.Vector3(1.0, 1.9, -4.6), look = new THREE.Vector3(0, 1.25, 0), camTo = new THREE.Vector3(), lookTo = new THREE.Vector3();
let roll = 0;
function updateCamera(dt) {
  const atStall = state === 'menu' || (state === 'intro' && introT < INTRO.BOLT);
  heroFill.intensity = lerp(heroFill.intensity, atStall ? 1.1 : 0, Math.min(1, dt * 3));
  heroFill.position.set(camPos.x + 1, camPos.y + 1.5, camPos.z);
  heroFill.target.position.set(char.root.position.x, 1.2, char.root.position.z);
  if (atStall) { // hero + stall framed below the logo + LED board; portrait phones aim further at the shop so it isn't cut off
    if (camera.aspect < 0.8) { camTo.set(1.6, 2.4, -5.2); lookTo.set(3.9, 1.6, 1.8); } else { camTo.set(0.2, 2.2, -4.4); lookTo.set(2.5, 1.75, 1.8); }
  }
  else if (state === 'dead' && deadT < CRASH_PUSH && !settings.reduce) { // slow-mo push-in on the crash (beside and above a bus, so it never clips)
    const bus = cause === 'bus';
    camTo.set(px + (bus ? 2.8 : 1.6), bus ? 2.9 : 1.9, 3.4); lookTo.set(px, 1.0, -0.5);
  }
  else if (state === 'dead' || state === 'over') { camTo.set(px * 0.5 + 1.5, 5.4, 6); lookTo.set(px, 0.4, -1); } // above the buses (3.2 m) and below the bunting (5.6 m+)
  else if (state === 'intro') { camTo.set(0, 5.4, 6.6); lookTo.set(0, 1.1, -12); } // swing high over his head; the run view then settles lower
  else { camTo.set(px * 0.6, 3.7, 6.6); lookTo.set(px * 0.6, 1.1, -12); }
  const k = Math.min(1, dt * (state === 'run' ? 8 : state === 'dead' && deadT < CRASH_PUSH ? 5 : 3));
  camPos.lerp(camTo, k);
  look.lerp(lookTo, k);
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.2);
  }
  camera.lookAt(look);
  roll = lerp(roll, state === 'run' && !settings.reduce ? (laneX(lane) - px) * -0.025 : 0, Math.min(1, dt * 6));
  camera.rotateZ(roll);
  const fov = baseFov + (state === 'run' && mundu.state === 'folded' && !settings.reduce ? 8 : 0); // speed feel when folded
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, dt * 4));
    camera.updateProjectionMatrix();
  }
}

// ---------- screens
const screens = { menu: $('menu'), paused: $('paused'), over: $('over'), hud: $('hud'), name: $('name'), board: $('board'), settings: $('settings') };
function show(...names) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', !names.includes(k));
}
function menuBest() {
  $('best').textContent = `${playerName || 'Peru set cheyyu'}  ${best ? `${Math.floor(best)} m` : ''}`.trim();
}

// ---------- player name + shared leaderboard (server.mjs). Name and id live in this browser only.
const pid = store.get('krb-id', '') || ((v) => (store.set('krb-id', v), v))((Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24));
let playerName = store.get('krb-name', '');
let afterName = null;
// run: the run just finished (for the weekly board); omitted on the page-load resend.
function submitScore(run) {
  if (!playerName || best <= 0) return;
  fetch('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid, name: playerName, best: Math.floor(best), ...(run > 0 && { run }) }) }).catch(() => {});
}
function askName(then) {
  afterName = then;
  $('name-input').value = playerName;
  $('name-err').textContent = '';
  show('name');
  $('name-input').focus();
}
$('name-form').onsubmit = (e) => {
  e.preventDefault();
  const v = $('name-input').value.replace(/\s+/g, ' ').trim();
  if (!v) { $('name-err').textContent = 'Oru peru type cheyyu.'; return; }
  playerName = v.slice(0, 16);
  store.set('krb-name', playerName);
  menuBest();
  submitScore();
  const then = afterName;
  afterName = null;
  then ? then() : show('menu');
};
$('name-input').oninput = () => ($('name-err').textContent = '');
$('name-back').onclick = () => { afterName = null; show('menu'); };
$('best').onclick = () => askName(null);
// period: 'all' (all-time) or 'week' (this week's runs, so newer players have a shot at the top).
let boardPeriod = 'all', boardReq = 0;
async function openBoard(period = boardPeriod) {
  boardPeriod = period;
  for (const [id, p] of [['tab-all', 'all'], ['tab-week', 'week']]) $(id).setAttribute('aria-selected', String(p === period));
  show('board');
  const list = $('board-list'), me = $('board-me'), req = ++boardReq;
  list.replaceChildren();
  me.textContent = 'Loading…';
  try {
    const r = await fetch(`api/scores?id=${pid}&period=${period}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (req !== boardReq) return; // a tab switch started a newer request
    const week = period === 'week';
    me.textContent = d.me ? `Ninte rank #${d.me.rank} (${d.me.best} m), ${d.players} peril` : week ? 'Ee aazhcha nee odiyittilla. Oru run odu!' : best > 0 ? 'Ninte score ivide ethiyilla. Oru run koode odu.' : 'Aadyam oru run odu, appo ninte peru ivide varum.';
    if (!d.top.length) me.textContent = week ? 'Ee aazhcha aarum odiyittilla. Number 1 aakaan chance!' : 'Aarum odiyittilla. Aadyam nee odu.';
    for (const [i, row] of d.top.entries()) {
      const li = document.createElement('li');
      if (row.me) li.className = 'me';
      const [n, name, m] = ['span', 'span', 'b'].map((t) => document.createElement(t));
      n.textContent = i + 1;
      name.textContent = row.name; // textContent: names come from other players
      m.textContent = `${row.best} m`;
      li.append(n, name, m);
      list.append(li);
    }
  } catch {
    if (req === boardReq) me.textContent = 'Leaderboard load aayilla. Net check cheythu veendum nokku.';
  }
}
$('board-btn').onclick = () => openBoard();
$('tab-all').onclick = () => openBoard('all');
$('tab-week').onclick = () => openBoard('week');
$('board-home').onclick = () => show('menu');
$('board-rename').onclick = () => askName(() => openBoard());

// ---------- settings
function applySettings() {
  renderer.setPixelRatio(pixelRatio());
  resize();
  world.setLow(settings.low);
  setVolume(settings.music, settings.sfx);
}
const setIn = { music: $('set-music'), sfx: $('set-sfx'), reduce: $('set-reduce'), low: $('set-low') };
for (const [k, el] of Object.entries(setIn)) {
  if (el.type === 'checkbox') el.checked = settings[k]; else el.value = settings[k];
  el.oninput = () => {
    settings[k] = el.type === 'checkbox' ? el.checked : +el.value;
    store.set(`krb-${k}`, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
    applySettings();
    if (k === 'sfx') play('coin1', () => sfx(COIN_SFX[1], { dur: 0.1, vol: 0.09 })); // hear the new level
  };
}
$('settings-btn').onclick = () => show('settings');
$('settings-back').onclick = () => show('menu');
applySettings();
// Loading screen rule: the home page appears only once the WHOLE game is ready. Models, the real hero, every
// texture, every sound and the fonts are loaded; all shaders are compiled; textures are on the GPU; and a
// finished frame has been drawn. Nothing on the home page can show half-loaded (no stand-in body, no black hero).
// No timeout on purpose: on slow net it keeps loading and says so, rather than showing an unfinished game.
const slowNote = setTimeout(() => { const m = $('loader-msg'); if (m) m.textContent = 'Net slow aanu, load aakunnu…'; }, 12000); // only if the loader has a message line
const frames = (n) => new Promise((done) => { const tick = () => (--n ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick); });
Promise.all([char.ready, dog.ready, soundsReady, document.fonts.ready])
  .then(texturesLoaded) // textures that start after their model (hero, coins) and any straggler
  .then(() => (performance.mark('load:files'), renderer.compileAsync(scene, camera)))
  .then(() => {
    performance.mark('load:shaders');
    scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture && v.image) renderer.initTexture(v); });
    return frames(3); // the game loop draws these behind the loader
  })
  .catch((e) => console.warn('loading step failed, showing the game anyway', e))
  .finally(() => {
    clearTimeout(slowNote);
    fill.style.width = '100%';
    $('loader').classList.add('done');
    window.__app.ready = true; // for the slow-network check
  });
// intro: from the home screen (tea stall scene first); retry skips it and starts with the dog already chasing.
function start(isDaily, intro = false) {
  ac?.resume?.();
  reset(isDaily);
  chase = G.createChase();
  runT = stumbleT = 0;
  dogX = 0; dogZ = DOG_FAR;
  dog.bite(false); dogLeapT = -1;
  if (intro) {
    state = 'intro';
    introT = 0;
    introDaily = isDaily;
    resetStall();
    glass.visible = true;
    dog.root.position.copy(DOG_IN[0]);
    show();
    return;
  }
  dog.root.position.set(dogX, 0, dogZ);
  dog.root.rotation.set(0, 0, 0);
  begin(isDaily, true);
}
function begin(isDaily, retry) {
  stall.visible = false;
  if (!glassFree) glass.visible = false; // skipped before the drop: it just vanishes with the stall
  dogX = dog.root.position.x; dogZ = dog.root.position.z;
  char.root.rotation.y = Math.PI;
  blob.position.set(0, 0.03, 0); // the intro left it wherever he was crossing
  music(true);
  if (retry) soundsReady.then(() => { play('whistle'); play('start'); barkNow(); }); // conductor's whistle: bus is leaving
  state = 'run';
  show('hud');
  // First run: a ghost hand acts out the controls (~3 s, before the first obstacle arrives).
  // Later runs: the madakki kuthu reminder now and then.
  const tip = $('tip'), fresh = !store.get('krb-tipped', '');
  store.set('krb-tipped', '1');
  clearTimeout(tip.t);
  tip.classList.toggle('hidden', fresh || Math.random() >= 0.35);
  tip.t = setTimeout(() => tip.classList.add('hidden'), 3000);
  if (fresh) ghostTutorial();
  else say(isDaily ? 'Innathe Road! Ellarkkum ithe road.' : 'ODU!');
}
const GHOST = [['side', 'Swipe ← → : lane maaru'], ['up', 'Mele swipe: chaadu'], ['down', 'Thazhe swipe: slide'], ['tap', 'Tap ×3 : madakki kuthu']];
function ghostTutorial() {
  const el = $('ghost');
  clearTimeout(el.t);
  el.classList.remove('hidden');
  const step = (i) => {
    if (i === GHOST.length || state !== 'run') { el.classList.add('hidden'); return; }
    el.dataset.move = GHOST[i][0];
    $('ghost-text').textContent = GHOST[i][1];
    restartAnim(el, 'go');
    el.t = setTimeout(() => step(i + 1), 850);
  };
  step(0);
}
function pause() { state = 'paused'; music(false); ui.speed.classList.remove('on'); show('hud', 'paused'); }
function resume() { state = 'run'; music(true); show('hud'); }
function home() { clearWorld(); char.reset(); resetStall(); glass.visible = true; dogHome(); state = 'menu'; music(false); stopVoice(); menuBest(); world.setMood(0, 0); ui.speed.classList.remove('on'); show('menu'); }

function showOver() {
  state = 'over';
  const m = Math.floor(dist);
  const isBest = m > best;
  if (isBest) { best = m; store.set('krb-best', String(best)); }
  submitScore(m); // every run: the weekly board counts this week's best run even when it isn't an all-time best
  overAt = performance.now();
  const loose = mundu.state === 'loose';
  const caption = loose ? G.LOOSE_DEATH : G.GAME_OVER[Math.floor(Math.random() * G.GAME_OVER.length)];
  $('reaction').textContent = G.CRASH_LINE[cause];
  $('over-dist').textContent = `${m} m`;
  $('over-title').textContent = isBest && m > 0 ? `NEW BEST · ${G.titleFor(m)}` : G.titleFor(m);
  $('over-coins').textContent = `₹${collected}${puffs ? ` · 🥚×${puffs}` : ''}`;
  $('over-best').textContent = `${Math.floor(best)} m`;
  $('over-caption').textContent = `“${caption}”`;
  queue(isBest && m > 0 ? 'new_best' : 'gameover');
  screens.over.dataset.caption = caption;
  askLag();
  show('over');
}

const go = (isDaily) => (playerName ? start(isDaily, true) : askName(() => start(isDaily, true)));
$('play').onclick = () => go(false);
$('again').onclick = () => start(daily);
// Instant retry: a tap anywhere on the game-over screen except its buttons. The short guard stops a swipe
// that was still in flight when you crashed from skipping the result.
screens.over.addEventListener('click', (e) => { if (!e.target.closest('button, .lag-ask') && performance.now() - overAt > 700) start(daily); });
$('home').onclick = home;
$('quit').onclick = home;
$('pause').onclick = pause;
$('resume').onclick = resume;
const muteBtn = $('mute');
const muteLabel = () => (muteBtn.classList.toggle('muted', muted), muteBtn.setAttribute('aria-pressed', String(!muted)));
muteBtn.onclick = () => {
  muted = !muted;
  store.set('krb-muted', muted ? '1' : '0');
  muteLabel();
  if (muted) { music(false); stopVoice(); }
  else if (state === 'run') music(true);
};
muteLabel();
// shortcut: hardcoded dev-tunnel URL, swap when the game gets a real domain
const GAME_URL = 'https://vandi-verse.pages.dev/';
$('share').onclick = () => {
  const m = Math.floor(dist);
  share(`njan ${distLabel(m)} odi, Ninakku ${m + 1} m odaan pattuo? 😏 ${GAME_URL}`);
};
menuBest();
submitScore(); // resend on load in case the last post failed; the server keeps the max

// ---------- loop
let last = performance.now();
// Lag check: if a run can't hold ~40 fps over 4 s, the game-over screen asks once whether to lower graphics.
// Never switches by itself: full graphics stay unless the player says yes here or in settings.
let fpsT = 0, fpsN = 0, laggy = false;
function watchFps(real) {
  if (laggy || settings.low || state !== 'run' || real > 0.5) return; // pauses and tab switches don't count
  fpsT += real;
  fpsN++;
  if (fpsT < 4) return;
  if (fpsN / fpsT < 40) laggy = true;
  fpsT = fpsN = 0;
}
const lagAsk = $('lag-ask');
function askLag() { lagAsk.classList.toggle('hidden', !(laggy && !settings.low && store.get('krb-lag-asked', '0') !== '1')); }
function answerLag(low) {
  store.set('krb-lag-asked', '1');
  lagAsk.classList.add('hidden');
  if (!low) return;
  setIn.low.checked = true;
  setIn.low.oninput();
}
$('lag-yes').onclick = () => answerLag(true);
$('lag-no').onclick = () => answerLag(false);
function frame(now) {
  watchFps((now - last) / 1000);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  TIME.value = now / 1000;
  if (state === 'run') update(dt, now / 1000);
  else if (state === 'intro') updateIntro(dt, now / 1000);
  else if (state === 'dead') {
    deadT += dt;
    const sdt = deadT < CRASH_SLOW ? dt * 0.3 : dt; // slow-motion beat on impact
    if (nextBark > 0 && (nextBark -= sdt) <= 0) barkNow();
    char.animate('crash', mundu.state, sdt, 0, cause === 'pothole' || cause === 'dog' ? 'fall' : 'sweep');
    if (dogLeapT >= 0) { // caught: the dog leaps onto his back, jaws open
      const k0 = Math.min(1, dogLeapT / 0.45);
      dogLeapT += sdt;
      const k = Math.min(1, dogLeapT / 0.45);
      dog.root.position.set(lerp(dogFrom.x, px, k), Math.sin(k * Math.PI) * 1.1 + k * 0.35, lerp(dogFrom.z, 0.55, k));
      dog.root.rotation.set(-Math.sin(k * Math.PI) * 0.5 - k * 0.25, 0, 0);
      dog.bite(true);
      if (k0 < 1 && k >= 1) { play('dog_bite', () => crashSound()); fx.dust(new THREE.Vector3(px, 0.3, 0.3), 10); }
      dog.update(sdt, k < 1 ? 'run' : 'idle', k < 1 ? 0.6 : 1);
    } else { // any other crash: the dog trots up and stands over him
      dogZ = lerp(dogZ, DOG_CLOSE + 0.6, Math.min(1, sdt * 2));
      dog.root.position.set(dogX, 0, dogZ);
      dog.update(sdt, 'idle');
    }
    fx.update(sdt, 0, camera.position.z);
    world.ambient(sdt, 0, now / 1000, false, fx);
    if (deadT > CRASH_SLOW + 1.45) showOver(); // the fall animation needs ~1.7 s of game time to land
  } else if (state === 'menu') {
    char.root.position.copy(HERO_AT);
    char.root.rotation.z = 0;
    char.root.rotation.y = HERO_FACE; // at the tea shop, facing the counter
    char.animate('drink', 'normal', dt);
    blob.position.set(HERO_AT.x, 0.03, HERO_AT.z);
    world.follow(0);
    world.ambient(dt, 0, now / 1000, false, fx); // steam behind the title (the road stands still: he's at the stall)
    CURVE.value.x = 0;
  }
  for (const c of coins) c.mesh.rotation.y += dt * 4;
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
