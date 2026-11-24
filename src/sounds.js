// Drop-in sound slots. Put a file named below into assets/sounds/ and the game uses it;
// a missing file falls back to the synth beep (see assets/sounds/README.md).
// An array of files means a random one each time. voice: true = meme line (one at a time, ducks music).
// Leading silence is skipped automatically. from: N = start N seconds into the file instead.
// max: N = stop after N seconds (quick fade). Voice lines default to 3 s.
export const SOUNDS = {
  coin1: { file: 'coin1.mp3', vol: 0.45, max: 0.45 }, // steel clink
  coin5: { file: 'coin5.mp3', vol: 0.5, max: 1 }, // cha-ching
  jump: { file: 'jump.mp3', vol: 0.5 },
  land: { file: 'land.mp3', vol: 0.35, max: 0.4 },
  slide: { file: 'slide.mp3', vol: 0.4, max: 0.7 },
  // Bus horns, a random one per passing bus: 7 cut from a Bus Simulator Indonesia horn compilation.
  // Played through spatial(): it swells as the bus nears and fades as it goes.
  horn: { file: ['horn1.mp3', 'horn2.mp3', 'horn3.mp3', 'horn4.mp3', 'horn5.mp3', 'horn6.mp3', 'horn7.mp3'], vol: 1 },
  auto_horn: { file: 'auto_horn.mp3', vol: 0.3, max: 1 }, // an auto starts swerving; air horn from a YouTube auto horn-fitting video (opening blast)
  bike_pass: { file: 'bike_pass.mp3', vol: 0.5 }, // a bike roars past in the next lane
  bus_brake: { file: 'bus_brake.mp3', vol: 0.6 }, // air-brake hiss when a bus hits you
  whistle: { file: 'whistle.mp3', vol: 0.45 }, // conductor's whistle as a run starts
  pothole_jump: { file: 'chath-chath-chath.mp3', vol: 1, voice: true, from: 1 }, // cleared a pothole in the air
  bus_dodge: { file: 'shivaneee.mp3', vol: 1, voice: true }, // a bus passes you (random, about half of them)
  coconut_land: { file: 'crash_coconut.mp3', vol: 1, voice: true, max: 0.5 }, // a falling coconut hits the road; first 0.5 s only
  puff: { file: 'puff.mp3', vol: 0.8 }, // legendary motta puffs picked up
  loose: { file: 'loose.mp3', vol: 0.9, voice: true, max: 2.5 },
  retie: { file: 'retie.mp3', vol: 0.9, voice: true, max: 2.5 },
  crash: { file: 'malayalam-actor-lal.mp3', vol: 1, voice: true }, // any crash without its own clip below
  crash_bus: { file: 'crash_bus.mp3', vol: 1, voice: true },
  crash_auto: { file: 'crash_auto.mp3', vol: 1, voice: true },
  crash_coconut: { file: 'crash_coconut.mp3', vol: 1, voice: true, max: 0.5 },
  gameover: { file: ['gameover1.mp3', 'gameover2.mp3', 'gameover3.mp3', 'gameover4.mp3'], vol: 1, voice: true, max: 4 },
  new_best: { file: 'new_best.mp3', vol: 1, voice: true },
  start: { file: 'start.mp3', vol: 0.9, voice: true, max: 2.5 },
  bgm: { file: 'bgm.mp3', vol: 0.25 },
  // Dog barks. Moments with no clip (chaya sip, glass clang, stumble, growl, bite, fold, pothole/flex crash lines)
  // play a synth beep or the generic crash line instead: see the play() calls in main.js.
  dog_bark: { file: ['dog_bark1.mp3', 'dog_bark3.mp3'], vol: 1, max: 1.5 }, // only at the intro, on a stumble or scrape, and once at the crash
};

const DIR = 'assets/sounds/';
const buffers = {}; // key -> AudioBuffer[]
const logged = new Set();
let ctx = null, isMuted = () => false, wantMusic = false, track = null;
let musicVol = 1, sfxVol = 1; // settings sliders, 0..1
let voice = null, pending = null, musicSrc = null, musicGain = null;

async function load(file) {
  track?.itemStart(DIR + file);
  try {
    const res = await fetch(DIR + file);
    if (!res.ok) return null;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const d = buf.getChannelData(0);
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < 0.02) i++; // first real sound
    buf.lead = i < d.length ? Math.max(0, i / buf.sampleRate - 0.02) : 0;
    return buf;
  } catch {
    return null; // unreadable file = empty slot
  } finally {
    track?.itemEnd(DIR + file);
  }
}

// Decodes on a suspended context; the Play tap resumes it. manager (optional): a three.js LoadingManager,
// so each file counts on the loading bar.
export async function loadSounds(ac, mutedFn, manager) {
  if (ctx || !ac) return;
  ctx = ac;
  isMuted = mutedFn;
  track = manager;
  await Promise.all(Object.entries(SOUNDS).map(async ([key, s]) => {
    const bufs = (await Promise.all([].concat(s.file).map(load))).filter(Boolean);
    if (bufs.length) buffers[key] = bufs;
  }));
  music(wantMusic);
}

function duck(on) {
  if (musicGain) musicGain.gain.setTargetAtTime(SOUNDS.bgm.vol * musicVol * (on ? 0.3 : 1), ctx.currentTime, 0.1);
}

// Plays the clip for `key`, or calls `fallback` (the synth beep) when the slot is empty.
export function play(key, fallback) {
  const bufs = buffers[key];
  if (!logged.has(key)) { logged.add(key); console.debug(`[sound] ${key}: ${bufs ? 'clip' : 'fallback'}`); }
  if (!bufs) return fallback?.();
  if (isMuted()) return;
  const s = SOUNDS[key];
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  const vol = s.vol * sfxVol;
  gain.gain.value = vol;
  src.connect(gain).connect(ctx.destination);
  if (s.voice) {
    stopVoice();
    voice = src;
    duck(true);
    src.onended = () => {
      if (voice !== src) return;
      voice = null;
      duck(false);
      if (pending) { const next = pending; pending = null; play(next); }
    };
  }
  const from = Math.min(s.from ?? src.buffer.lead, src.buffer.duration);
  const len = Math.min(s.max ?? (s.voice ? 3 : Infinity), src.buffer.duration - from);
  if (len < src.buffer.duration - from) {
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(vol, t + Math.max(0, len - 0.2));
    gain.gain.linearRampToValueAtTime(0, t + len); // fade instead of a click
  }
  src.start(0, from, len);
}

// A clip whose loudness and pitch the caller moves every frame via set(level 0..1, playbackRate), e.g. a horn
// that swells as a bus nears and fades as it goes. Returns null when the slot is empty or sound is muted.
export function spatial(key) {
  const bufs = buffers[key];
  if (!bufs || isMuted()) return null;
  const s = SOUNDS[key], src = ctx.createBufferSource(), fade = ctx.createGain(), gain = ctx.createGain();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  gain.gain.value = 0;
  src.connect(fade).connect(gain).connect(ctx.destination);
  const from = src.buffer.lead, len = Math.min(s.max ?? Infinity, src.buffer.duration - from), t = ctx.currentTime;
  fade.gain.setValueAtTime(1, t + Math.max(0, len - 0.2));
  fade.gain.linearRampToValueAtTime(0, t + len); // no click where max cuts a long clip
  src.start(0, from, len);
  const h = {
    done: false,
    set(level, rate = 1) {
      gain.gain.setTargetAtTime(level * s.vol * sfxVol, ctx.currentTime, 0.05);
      src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.05);
    },
    stop() { try { src.stop(); } catch {} },
  };
  src.onended = () => { h.done = true; };
  return h;
}

// Plays after the current meme line finishes (so the game-over line doesn't cut off the crash line).
export function queue(key) {
  if (voice) pending = key;
  else play(key);
}

export function stopVoice() {
  pending = null;
  if (!voice) return;
  const v = voice;
  voice = null;
  try { v.stop(); } catch {}
  duck(false);
}

export function music(on) {
  wantMusic = on;
  if (!ctx) return;
  if (on && !musicSrc && buffers.bgm && !isMuted()) {
    musicGain = ctx.createGain();
    musicGain.gain.value = SOUNDS.bgm.vol * musicVol;
    musicSrc = ctx.createBufferSource();
    musicSrc.buffer = buffers.bgm[0];
    musicSrc.loop = true;
    musicSrc.connect(musicGain).connect(ctx.destination);
    musicSrc.start();
  } else if (!on && musicSrc) {
    musicSrc.stop();
    musicSrc = musicGain = null;
  }
}

export function setVolume(m, s) {
  musicVol = m;
  sfxVol = s;
  if (musicGain) musicGain.gain.setTargetAtTime(SOUNDS.bgm.vol * musicVol * (voice ? 0.3 : 1), ctx.currentTime, 0.05);
}
