// The Cloudflare Pages Function (functions/api/scores.js) against a real SQLite database (D1 is SQLite),
// through a tiny stand-in for the D1 API. Mirrors the scenarios in server.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { board, merge, onRequestGet, onRequestPost } from '../functions/api/scores.js';

function d1() { // prepare(sql).bind(...).all() / .first() / .run(), like env.DB
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async all() { return { results: st.all(...args) }; },
        async first() { return st.get(...args) ?? null; },
        async run() { st.run(...args); return { success: true }; },
      };
      return api;
    },
  };
}

const db = d1();
await merge(db, { id: 'aaaaaaaa', name: 'A', best: 300 }, 101);
await merge(db, { id: 'aaaaaaaa', name: 'A2', best: 100 }, 101); // lower score keeps best, takes new name
await merge(db, { id: 'bbbbbbbb', name: 'B', best: 500 }, 101);
let b = await board(db, 'aaaaaaaa', 'all', 101);
assert.deepEqual(b.top.map((r) => [r.name, r.best]), [['B', 500], ['A2', 300]]);
assert.deepEqual(b.me, { rank: 2, name: 'A2', best: 300 });
assert.equal(b.top[1].me, true);
assert.equal(b.players, 2);
assert.equal(JSON.stringify(b).includes('aaaaaaaa'), false, 'ids never leave the server');

// Weekly board: only this week's runs count; last week's runs drop off, the all-time best stays.
const w = d1();
await merge(w, { id: 'cccccccc', name: 'C', best: 900, run: 900 }, 100); // last week
await merge(w, { id: 'dddddddd', name: 'D', best: 400, run: 400 }, 101);
await merge(w, { id: 'cccccccc', name: 'C', best: 900, run: 200 }, 101); // this week: a weaker run
await merge(w, { id: 'cccccccc', name: 'C', best: 900 }, 101); // resend on page load (no run) keeps the weekly score
await merge(w, { id: 'cccccccc', name: 'C', best: 900, run: 150 }, 101); // a weaker run later keeps the week's best
assert.deepEqual((await board(w, 'cccccccc', 'week', 101)).top.map((r) => [r.name, r.best]), [['D', 400], ['C', 200]]);
assert.deepEqual((await board(w, 'cccccccc', 'week', 101)).me, { rank: 2, name: 'C', best: 200 });
assert.deepEqual((await board(w, 'cccccccc', 'all', 101)).top.map((r) => r.best), [900, 400]);
const next = await board(w, 'cccccccc', 'week', 102);
assert.equal(next.top.length, 0, 'a new week starts empty');
assert.equal(next.me, null);
await merge(w, { id: 'eeeeeeee', name: 'E', best: 50 }, 101); // never ran this week: not on the weekly board
assert.equal((await board(w, 'eeeeeeee', 'week', 101)).me, null);

// The HTTP handlers: validation, size limit, and the response shape the game reads.
const env = { DB: d1() };
const post = (body) => onRequestPost({ env, request: new Request('https://x/api/scores', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) });
assert.equal((await post({ id: 'abc', name: 'x', best: 1 })).status, 400, 'bad id rejected');
assert.equal((await post('not json')).status, 400);
assert.equal((await post('x'.repeat(2000))).status, 413);
let r = await post({ id: 'ffffffff', name: ' <b>Sahid</b> ', best: 77, run: 77 });
assert.equal(r.status, 200);
assert.equal(r.headers.get('Cache-Control'), 'no-store');
assert.deepEqual(await r.json(), { top: [{ name: 'bSahid/b', best: 77, me: true }], me: { rank: 1, name: 'bSahid/b', best: 77 }, players: 1 });
r = await onRequestGet({ env, request: new Request('https://x/api/scores?id=ffffffff&period=week') });
assert.deepEqual((await r.json()).me, { rank: 1, name: 'bSahid/b', best: 77 });
r = await onRequestGet({ env, request: new Request('https://x/api/scores') }); // no id: board only
assert.equal((await r.json()).me, null);
// Setup mistakes answer with a readable error, not a crash.
let e = await onRequestGet({ env: {}, request: new Request('https://x/api/scores') });
assert.equal(e.status, 500);
assert.match((await e.json()).error, /No D1 database bound as DB/);
const bare = { DB: { prepare() { return { bind() { return this; }, async all() { throw new Error('D1_ERROR: no such table: players: SQLITE_ERROR'); }, async first() { throw new Error('no such table: players'); }, async run() { throw new Error('no such table: players'); } }; } } };
e = await onRequestGet({ env: bare, request: new Request('https://x/api/scores') });
assert.match((await e.json()).error, /players table is missing/);
console.log('scores function tests ok');
