// Pure game rules: no DOM, no three.js. Tested by test/logic.test.mjs.

export const LANES = 3;

// Seeded RNG (mulberry32) so the daily road is identical for everyone.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailySeed(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// Obstacle kinds. hard = must change lane. jump/slide = passable with the right move.
export const KIND = {
  pothole: { pass: 'jump', len: 1.8 },
  flex: { pass: 'slide', len: 0.6 },
  auto: { pass: null, len: 2.6 },
  bus: { pass: null, len: 7.5 },
  coconut: { pass: null, len: 1.0 },
  bike: { pass: null, len: 2.0 },
  car: { pass: 'jump', len: 3.4 }, // Maruti 800 riding away from you: low enough to jump over
};

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Lanes a row makes impassable (an auto blocks where it is and where it will move).
export function hardLanes(row) {
  const s = new Set();
  for (const o of row.obstacles) {
    if (KIND[o.type].pass) continue;
    s.add(o.lane);
    if (o.toLane != null) s.add(o.toLane);
  }
  return s;
}

// Legendary motta puffs: only from PUFF_FROM metres, PUFF_CHANCE per row (rows are ~25 m apart, so ~1 per 1.7 km).
export const PUFF = { FROM: 800, CHANCE: 0.015, BONUS: 25 };

// Oncoming KSRTC: starts charging at START metres out at (1 + BOOST) x road speed. It spawns LEAD metres
// behind its row so both reach the runner together; on the way it crosses the next row's lane, so that lane is kept clear.
export const ONCOMING = { CHANCE: 0.5, START: 45, BOOST: 0.6 };
ONCOMING.LEAD = (ONCOMING.START * ONCOMING.BOOST) / (1 + ONCOMING.BOOST);

// One row of obstacles + chillara. d = difficulty 0..1, m = the row's distance in metres,
// clear = lane(s) to keep free of obstacles (each oncoming bus from the previous row drives through its lane): a number or an array.
// prevOpen = lanes the previous row left without a hard obstacle.
// Every row leaves at least one open lane, at most one lane-change from an open lane of the previous row (asserted in tests).
export function makeRow(r, d, m = 0, clear = -1, prevOpen = [0, 1, 2]) {
  const keep = [].concat(clear);
  const notCleared = (o) => !keep.includes(o.lane) && !keep.includes(o.toLane);
  const [a, b, c] = shuffle(r, [0, 1, 2]);
  const hard = () => pick(r, d < 0.2 ? ['bus', 'coconut', 'bike'] : ['bus', 'coconut', 'coconut', 'bike']);
  const soft = () => pick(r, ['pothole', 'flex', 'car']);
  const patterns = [
    () => [{ type: hard(), lane: a }],
    () => [{ type: soft(), lane: a }],
    () => [{ type: hard(), lane: a }, { type: soft(), lane: b }],
    () => {
      // Auto rickshaw: changes lane into an adjacent one, so it rides alone.
      const lane = Math.floor(r() * 3);
      const toLane = lane === 1 ? pick(r, [0, 2]) : 1;
      return [{ type: 'auto', lane, toLane }];
    },
  ];
  if (d > 0.25) patterns.push(() => [{ type: hard(), lane: a }, { type: hard(), lane: b }]);
  if (d > 0.4) patterns.push(() => [0, 1, 2].map((lane) => ({ type: 'pothole', lane })));
  if (d > 0.5) patterns.push(() => [{ type: hard(), lane: a }, { type: hard(), lane: b }, { type: soft(), lane: c }]);

  const row = { obstacles: [], coins: [] };
  // Re-roll a pattern that would need a two-lane dash (e.g. only lane 0 open, then only lane 2); a single soft obstacle always fits.
  const reachable = () => [0, 1, 2].some((l) => !hardLanes(row).has(l) && prevOpen.some((p) => Math.abs(p - l) <= 1));
  for (let tries = 0; tries < 8 && (tries === 0 || !reachable()); tries++) row.obstacles = pick(r, patterns)().filter(notCleared);
  if (!reachable()) row.obstacles = [{ type: soft(), lane: a }].filter(notCleared);
  for (const o of row.obstacles) {
    if (o.type === 'bus') o.oncoming = r() < ONCOMING.CHANCE;
    if (o.type === 'coconut') o.roll = (r() < 0.5 ? -1 : 1) * (3 + r() * 2); // which way it rolls after landing: seeded, so the same road plays the same
  }
  const blocked = hardLanes(row);
  const at = (lane) => row.obstacles.find((o) => o.lane === lane);

  for (let lane = 0; lane < LANES; lane++) {
    if (blocked.has(lane)) continue;
    const o = at(lane);
    if (o?.type === 'pothole' && r() < 0.6) {
      // ₹1 arc over the pothole: you must jump for it.
      for (let i = -2; i <= 2; i++) row.coins.push({ lane, dz: i * 1.4, y: 1.1 + 1.0 * (1 - (i / 2.5) ** 2), value: 1 });
    } else if (!o && r() < 0.5) {
      for (let i = 0; i < 5; i++) row.coins.push({ lane, dz: 4 + i * 2, y: 0.8, value: 1 });
    }
  }
  const free = [0, 1, 2].filter((l) => !blocked.has(l) && !at(l));
  if (m >= PUFF.FROM && free.length && r() < PUFF.CHANCE) row.coins.push({ lane: pick(r, free), dz: 0, y: 1.0, value: 'puff' });
  // ₹5 in a risky spot: right beside a hard obstacle.
  else if (blocked.size && free.length && r() < 0.35) row.coins.push({ lane: pick(r, free), dz: 0, y: 0.8, value: 5 });
  // ₹5 up high: grab it with a jump (needs py >= y - 1.7; a normal jump peaks at JUMP_H 1.25).
  else if (free.length && r() < 0.12) row.coins.push({ lane: pick(r, free), dz: 0, y: 2.4, value: 5 });
  return row;
}

// Metres between obstacle rows: grows with speed up to 30 m, then from 4 km tightens to 24 m so long runs keep getting harder.
export const rowGap = (m) => Math.min(30, Math.max(18, (14 + m * 0.0035) * 1.15)) - Math.min(6, Math.max(0, (m - 4000) / 500));

// --- Mundu: normal -> folded (madakki kuthu) -> loose (azhinju) -> re-tie -> normal
export const MUNDU = { GRIP: 3, FOLD_TAPS: 3, RETIE_TAPS: 2, TAP_WINDOW: 0.7, RETIE_TIME: 1.0, COOLDOWN: 8 };

export function createMundu() {
  return { state: 'normal', grip: MUNDU.GRIP, taps: [], retie: 0, cool: 0 };
}

export function fold(m) {
  if (m.state !== 'normal') return false;
  m.state = 'folded';
  return true;
}

// Called when the player slides. Returns true if the mundu just came loose.
export function slide(m) {
  if (m.state !== 'folded') return false;
  m.grip -= 1;
  if (m.grip > 0) return false;
  m.state = 'loose';
  m.grip = 0;
  return true;
}

// Called on each tap with the current time (s). Triple tap folds a normal mundu, double tap re-ties a loose one.
// Returns 'fold' or 'retie' when that happens, 'cooling' for a triple tap during the cooldown, otherwise null.
export function tap(m, now) {
  const need = m.state === 'normal' ? MUNDU.FOLD_TAPS : m.state === 'loose' ? MUNDU.RETIE_TAPS : 0;
  if (!need) { m.taps = []; return null; }
  m.taps = m.taps.filter((t) => now - t < MUNDU.TAP_WINDOW);
  m.taps.push(now);
  if (m.taps.length < need) return null;
  m.taps = [];
  if (m.state === 'normal') return m.cool > 0 ? 'cooling' : fold(m) && 'fold';
  m.state = 'retie';
  m.retie = MUNDU.RETIE_TIME;
  return 'retie';
}

// Returns true when re-tying finishes this tick.
export function tickMundu(m, dt) {
  if (m.state === 'retie') {
    m.retie -= dt;
    if (m.retie > 0) return false;
    m.state = 'normal';
    m.grip = MUNDU.GRIP;
    m.cool = MUNDU.COOLDOWN; // can't madakki kuthu again straight away
    return true;
  }
  if (m.cool > 0) m.cool = Math.max(0, m.cool - dt);
  return false; // no grip refill: a fold lasts GRIP slides, then it comes loose. That is its price for the boost.
}

export const speedMul = (m) => (m.state === 'folded' ? 1.15 : m.state === 'loose' || m.state === 'retie' ? 0.8 : 1);
export const jumpMul = (m) => (m.state === 'folded' ? 1.3 : 1);
export const canJump = (m) => m.state === 'normal' || m.state === 'folded';

// --- Dog chase (Subway Surfers' cop): a stumble brings the dog to your heels for WINDOW seconds;
// a second stumble inside that window and it catches you. t is game time (pause doesn't count).
export const CHASE = { WINDOW: 2.5, LATE_JUMP: 1 / 3, SCRAPE_LATERAL: 0.25, SCRAPE_OVERLAP: 0.6 };
export const createChase = () => ({ closeUntil: -Infinity });
export const isClose = (chase, t) => t < chase.closeUntil;
export function stumble(chase, t) {
  if (isClose(chase, t)) return 'caught';
  chase.closeUntil = t + CHASE.WINDOW;
  return 'close';
}
// A side hit while still changing lanes, only clipping the edge, is a scrape (stumble), not a head-on crash.
// lateral = how far the player still is from their target lane's centre; overlap = how deep the bodies overlap sideways.
export const isScrape = ({ lateral, overlap }) => lateral > CHASE.SCRAPE_LATERAL && overlap < CHASE.SCRAPE_OVERLAP;
// Reaching a pothole on the ground: progress = 0 at its near edge, 1 at the far edge.
// Still on the ground in the first third = 'wait' (a late jump can save you), airborne by then = 'stumble', later = 'crash'.
export const lateJump = (progress, air) => (progress > CHASE.LATE_JUMP ? (air ? 'ok' : 'crash') : air ? 'stumble' : 'wait');
export const STUMBLE_LINE = ['Patti aduthethi! 🐕', 'Sookshicho, patti pinnil!', 'Ayyo, kadikkan varunnu!'];

// --- Manglish lines
export const CRASH_LINE = {
  dog: 'Pattikk ishtaayi 🐕',
  bus: 'KSRTC alle, mone!',
  auto: 'Njan kandilla!',
  coconut: 'Thenga tax adachirunno?',
  pothole: 'Road pani kazhinjille?',
  flex: 'Flex vechavan aara?!',
  bike: 'Bike-il ninnu nokkiyittu poyo?',
  car: '800-nte back-il keri, ini EMI adakkam!',
};
export const GAME_OVER = [
  'Insurance undo?',
  'Veettil parayanda.',
  'License eduthittu vaa.',
  'Nammal pinneyum thottu.',
  'Speed kurakkan paranjathalle!',
  'Ithu NH66 alla, survival test aanu.',
];
export const LOOSE_DEATH = 'Mundu azhinjappo thanne theernnu.';

export function titleFor(metres) {
  if (metres >= 5000) return 'NH66 LEGEND';
  if (metres >= 2500) return 'NH66 SURVIVOR';
  if (metres >= 1000) return 'KSRTC REGULAR';
  if (metres >= 400) return 'POTHOLE PRO';
  return 'L BOARD';
}
