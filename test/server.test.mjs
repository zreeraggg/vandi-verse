import assert from 'node:assert/strict';
import { clean, merge, board, publicPath, weekOf } from '../server.mjs';

assert.equal(clean({ id: 'abc', name: 'x', best: 1 }), null, 'short id rejected');
assert.equal(clean({ id: 'abcdefgh', name: '   ', best: 1 }), null, 'blank name rejected');
assert.equal(clean({ id: 'abcdefgh', name: 'x', best: 1.5 }), null, 'non-integer score rejected');
assert.equal(clean({ id: 'abcdefgh', name: 'x', best: -1 }), null);
assert.deepEqual(clean({ id: 'abcdefgh', name: ' <b>Sahid</b>  mwone that is way too long ', best: 10 }), { id: 'abcdefgh', name: 'bSahid/b mwone t', best: 10 });

const db = {};
merge(db, { id: 'aaaaaaaa', name: 'A', best: 300 });
merge(db, { id: 'aaaaaaaa', name: 'A2', best: 100 }); // lower score keeps best, takes new name
merge(db, { id: 'bbbbbbbb', name: 'B', best: 500 });
assert.deepEqual(db.aaaaaaaa, { name: 'A2', best: 300 });
const b = board(db, 'aaaaaaaa');
assert.deepEqual(b.top.map((r) => r.name), ['B', 'A2']);
assert.deepEqual(b.me, { rank: 2, name: 'A2', best: 300 });
assert.equal(b.top[1].me, true);
assert.equal(JSON.stringify(b).includes('aaaaaaaa'), false, 'ids never leave the server');
// Weekly board: only this week's runs count; last week's runs drop off, the all-time best stays.
assert.equal(weekOf(Date.UTC(2026, 10, 23)), weekOf(Date.UTC(2026, 10, 29, 23)), 'Mon..Sun is one week');
assert.notEqual(weekOf(Date.UTC(2026, 10, 22, 23)), weekOf(Date.UTC(2026, 10, 23)), 'week starts Monday');
assert.equal(clean({ id: 'abcdefgh', name: 'x', best: 5, run: -1 }), null, 'bad run rejected');
assert.deepEqual(clean({ id: 'abcdefgh', name: 'x', best: 5, run: 3 }), { id: 'abcdefgh', name: 'x', best: 5, run: 3 });
const wdb = {};
merge(wdb, { id: 'cccccccc', name: 'C', best: 900, run: 900 }, 100); // last week
merge(wdb, { id: 'dddddddd', name: 'D', best: 400, run: 400 }, 101);
merge(wdb, { id: 'cccccccc', name: 'C', best: 900, run: 200 }, 101); // this week: a weaker run
merge(wdb, { id: 'cccccccc', name: 'C', best: 900 }, 101); // resend on page load (no run) keeps the weekly score
assert.deepEqual(wdb.cccccccc, { name: 'C', best: 900, wk: 101, wbest: 200 });
assert.deepEqual(board(wdb, 'cccccccc', 50, 'week', 101).top.map((r) => [r.name, r.best]), [['D', 400], ['C', 200]]);
assert.deepEqual(board(wdb, 'cccccccc', 50, 'week', 101).me, { rank: 2, name: 'C', best: 200 });
assert.deepEqual(board(wdb, 'cccccccc', 50, 'all', 101).top.map((r) => r.best), [900, 400]);
assert.equal(board(wdb, 'x', 50, 'week', 102).top.length, 0, 'a new week starts empty');
// Only game files are served; Windows path tricks can't reach the scores file or server code.
assert.ok(publicPath('/'), 'index served');
assert.ok(publicPath('/src/main.js'));
assert.ok(publicPath('/assets/models/hero.glb'));
for (const bad of ['/scores.json', '/SCORES.JSON', '/scores.json::$DATA', '/Server.mjs', '/skills-lock.json', '/test/server.test.mjs',
  '/src/..%5cscores.json', '/%2e%2e/x.html', '/.claude/settings.json', '/src/x.js::$DATA', '/assets/.hidden.png', '/%E0%A4%A']) {
  assert.equal(publicPath(bad), null, bad);
}
console.log('server tests ok');
