// Run: node test/logic.test.mjs
import assert from 'node:assert/strict';
import { rng, createChase, stumble, isClose, isScrape, lateJump, STUMBLE_LINE, makeRow, PUFF, ONCOMING, CRASH_LINE, hardLanes, createMundu, fold, slide, tap, tickMundu, canJump, KIND, rowGap } from '../src/logic.js';

// Every row leaves an escape lane, autos move to an adjacent lane, coins never sit in a blocked lane.
for (const d of [0, 0.3, 0.6, 1]) {
  const r = rng(42);
  for (let i = 0; i < 5000; i++) {
    const row = makeRow(r, d);
    const blocked = hardLanes(row);
    assert.ok(blocked.size < 3, `row has no escape: ${JSON.stringify(row)}`);
    for (const o of row.obstacles) {
      assert.ok(KIND[o.type], o.type);
      if (o.toLane != null) assert.equal(Math.abs(o.toLane - o.lane), 1);
    }
    for (const c of row.coins) assert.ok(!blocked.has(c.lane), `coin in blocked lane: ${JSON.stringify(row)}`);
    for (const c of row.coins) assert.ok([1, 5, 'puff'].includes(c.value), `only ₹1, ₹5 and puffs: ${c.value}`);
  }
}

// Motta puffs: never before PUFF.FROM, rare after, always in a free lane.
{
  const r = rng(7);
  let before = 0, after = 0;
  for (let i = 0; i < 20000; i++) {
    before += makeRow(r, 0.3, PUFF.FROM - 1).coins.filter((c) => c.value === 'puff').length;
    const row = makeRow(r, 0.3, PUFF.FROM);
    const puffs = row.coins.filter((c) => c.value === 'puff');
    after += puffs.length;
    for (const p of puffs) assert.ok(!hardLanes(row).has(p.lane) && !row.obstacles.some((o) => o.lane === p.lane));
  }
  assert.equal(before, 0, 'no puffs before 800 m');
  assert.ok(after > 0 && after / 20000 < 0.03, `puff rate ${after / 20000}`);
}

// Oncoming buses: some buses charge, and the row after one keeps that lane free of obstacles.
{
  const r = rng(11);
  let prev = null, oncoming = 0;
  for (let i = 0; i < 20000; i++) {
    const bus = prev?.obstacles.find((o) => o.oncoming);
    const row = makeRow(r, 0.7, 1000, bus ? bus.lane : -1);
    if (bus) assert.ok(!row.obstacles.some((o) => o.lane === bus.lane || o.toLane === bus.lane), 'lane after an oncoming bus is clear');
    oncoming += row.obstacles.filter((o) => o.oncoming).length;
    prev = row;
  }
  assert.ok(oncoming > 500, `oncoming buses: ${oncoming}`);
  assert.ok(ONCOMING.LEAD + 3.75 < 2 * 18, 'bus never reaches two rows ahead (min row gap 18 m, half a bus 3.75 m)');
}

// Every obstacle kind has a crash line for the game-over screen.
for (const k of Object.keys(KIND)) assert.ok(CRASH_LINE[k], `no crash line for ${k}`);

// Same seed, same road.
const a = rng(20261122), b = rng(20261122);
for (let i = 0; i < 50; i++) assert.deepEqual(makeRow(a, 0.5), makeRow(b, 0.5));

// Mundu: triple tap folds, 3 slides -> loose, can't jump, double tap -> re-tie -> normal.
const t3 = createMundu();
assert.equal(tap(t3, 0), null); assert.equal(tap(t3, 0.2), null);
assert.equal(t3.state, 'normal', 'two taps do not fold');
assert.equal(tap(t3, 0.4), 'fold');
assert.equal(t3.state, 'folded');
assert.equal(tap(t3, 0.5), null, 'taps while folded do nothing');
const m = createMundu();
assert.equal(slide(m), false, 'sliding unfolded costs nothing');
assert.equal(m.grip, 3);
assert.ok(fold(m));
assert.equal(fold(m), false, 'already folded');
slide(m); slide(m);
assert.equal(m.state, 'folded');
assert.ok(slide(m));
assert.equal(m.state, 'loose');
assert.equal(canJump(m), false);
tap(m, 0); tap(m, 1); // too slow, window resets
assert.equal(m.state, 'loose');
assert.equal(tap(m, 1.2), 'retie');
assert.equal(m.state, 'retie');
assert.equal(tickMundu(m, 0.5), false);
assert.ok(tickMundu(m, 0.6));
assert.equal(m.state, 'normal');
assert.equal(m.grip, 3);
// Cooldown after re-tie: triple tap is refused until it runs out.
assert.equal(tap(m, 10), null); assert.equal(tap(m, 10.1), null);
assert.equal(tap(m, 10.2), 'cooling');
assert.equal(m.state, 'normal');
tickMundu(m, 8);
assert.equal(m.cool, 0);
tap(m, 20); tap(m, 20.1);
assert.equal(tap(m, 20.2), 'fold');

// Grip does not refill while folded: the fold costs you, 3 slides and it comes loose.
const g = createMundu();
fold(g); slide(g);
for (let t = 0; t < 60; t += 0.1) tickMundu(g, 0.1);
assert.equal(g.grip, 2);

// Consecutive rows never need a two-lane dash: some open lane is within one lane of the previous row's open lanes.
for (const d of [0.3, 0.6, 1]) {
  const r = rng(99);
  let open = [0, 1, 2], clear = -1;
  for (let i = 0; i < 20000; i++) {
    const row = makeRow(r, d, 1000, clear, open);
    const next = [0, 1, 2].filter((l) => !hardLanes(row).has(l));
    assert.ok(next.some((l) => open.some((p) => Math.abs(p - l) <= 1)), `two-lane dash after ${open}: ${JSON.stringify(row)}`);
    clear = row.obstacles.filter((o) => o.oncoming).map((o) => o.lane);
    open = next;
  }
}

// Two oncoming buses in one row: the next row keeps BOTH lanes clear (each bus drives through its lane).
{
  const r = rng(7);
  let clear = -1, pairs = 0;
  for (let i = 0; i < 20000; i++) {
    const row = makeRow(r, 1, 1000, clear);
    const keep = [].concat(clear);
    assert.ok(!row.obstacles.some((o) => keep.includes(o.lane) || keep.includes(o.toLane)), `obstacle in a cleared lane ${keep}: ${JSON.stringify(row)}`);
    clear = row.obstacles.filter((o) => o.oncoming).map((o) => o.lane);
    if (clear.length === 2) pairs++;
  }
  assert.ok(pairs > 20, `two-oncoming rows happen (${pairs})`);
}

// Row gap: never below the 18 m the oncoming-bus timing needs, and tighter on long runs.
for (let m = 0; m < 20000; m += 50) assert.ok(rowGap(m) >= 18, `gap ${rowGap(m)} at ${m}`);
assert.ok(rowGap(6000) < rowGap(3500));

// Dog chase: two stumbles inside 2.5 s = caught; at 2.5 s or later the dog had dropped back.
{
  const c = createChase();
  assert.equal(isClose(c, 0), false);
  assert.equal(stumble(c, 10), 'close');
  assert.equal(isClose(c, 11), true);
  assert.equal(stumble(c, 11), 'caught');
  const d = createChase();
  stumble(d, 10);
  assert.equal(stumble(d, 12.5), 'close'); // exactly at the window edge
  assert.equal(isClose(d, 14.9), true);
  assert.equal(createChase().closeUntil, -Infinity); // retry starts fresh
  assert.ok(isScrape({ lateral: 0.8, overlap: 0.3 }), 'late dodge clipping the side');
  assert.ok(!isScrape({ lateral: 0.05, overlap: 1 }), 'head-on in the lane');
  assert.ok(!isScrape({ lateral: 0.8, overlap: 1 }), 'mid-change but deep into it');
  assert.equal(lateJump(0.1, false), 'wait');
  assert.equal(lateJump(0.2, true), 'stumble');
  assert.equal(lateJump(0.5, false), 'crash');
  assert.ok(CRASH_LINE.dog && STUMBLE_LINE.length);
}

console.log('logic tests passed');
