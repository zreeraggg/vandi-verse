// Serves the game and a tiny shared leaderboard. Run: node server.mjs  (PORT env, default 5500)
// No dependencies. Scores live in scores.json next to this file.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.SCORES ? path.resolve(process.env.SCORES) : path.join(ROOT, 'scores.json'); // SCORES: test file
// Allowlist, not blocklist: Windows paths are case-insensitive and accept tricks like 'file::$DATA'
const PUBLIC_FILES = new Set(['index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']);
const PUBLIC_DIRS = ['src/', 'assets/'];
const MAX_PLAYERS = 5000;
const COMPRESS = /^(text\/|application\/(json|manifest)|image\/svg|model\/)/; // mp3/jpg/png are already compressed
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff2': 'font/woff2',
};

// Week number, weeks starting Monday 00:00 UTC (day 0 of the epoch was a Thursday, hence +3).
export const weekOf = (ms = Date.now()) => Math.floor((ms / 86400000 + 3) / 7);
const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 200000;

// Validates one submission from the browser (untrusted). Returns a clean record or null.
// best = the player's all-time best; run (optional) = the run just finished, for the weekly board.
export function clean(body) {
  if (!body || typeof body !== 'object') return null;
  const { id, name, best, run } = body;
  if (typeof id !== 'string' || !/^[a-z0-9]{8,32}$/.test(id)) return null;
  if (typeof name !== 'string') return null;
  const n = name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!n) return null;
  // shortcut: trusts the client's distance (anyone can POST a fake score); add server-side run checks if cheating shows up
  if (!isScore(best) || (run !== undefined && !isScore(run))) return null;
  return run === undefined ? { id, name: n, best } : { id, name: n, best, run };
}

// Keeps each player's highest score (all-time, plus this week's best run as wk/wbest); the name always updates.
export function merge(db, rec, wk = weekOf()) {
  const old = db[rec.id];
  const wbest = Math.max(old?.wk === wk ? old.wbest : 0, rec.run ?? 0);
  db[rec.id] = { name: rec.name, best: Math.max(old?.best ?? 0, rec.best), ...(wbest > 0 && { wk, wbest }) };
  const ids = Object.keys(db);
  if (ids.length > MAX_PLAYERS) { // drop the lowest scores
    ids.sort((a, b) => db[a].best - db[b].best).slice(0, ids.length - MAX_PLAYERS).forEach((k) => delete db[k]);
  }
  return db;
}

// period 'week': only this week's runs count, ranked by each player's best run this week.
export function board(db, id, limit = 50, period = 'all', wk = weekOf()) {
  const score = period === 'week' ? (v) => (v.wk === wk ? v.wbest : 0) : (v) => v.best;
  const all = Object.entries(db).map(([k, v]) => ({ k, name: v.name, best: score(v) })).filter((r) => r.best > 0).sort((a, b) => b.best - a.best);
  const rank = all.findIndex((r) => r.k === id);
  return {
    top: all.slice(0, limit).map((r) => ({ name: r.name, best: r.best, me: r.k === id })),
    me: rank < 0 ? null : { rank: rank + 1, name: all[rank].name, best: all[rank].best },
    players: all.length,
  };
}

function load() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; }
}
function save(db) { // write-then-rename so a crash mid-write can't wipe the file
  fs.writeFileSync(DB + '.tmp', JSON.stringify(db));
  fs.renameSync(DB + '.tmp', DB);
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

// Maps a URL path to a file the game may serve, or null.
export function publicPath(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return null;
  const r = path.relative(ROOT, file).split(path.sep).join('/');
  if (r.includes(':') || r.split('/').some((seg) => seg.startsWith('.'))) return null;
  if (!TYPES[path.extname(r).toLowerCase()]) return null;
  return PUBLIC_FILES.has(r) || PUBLIC_DIRS.some((d) => r.startsWith(d)) ? file : null;
}

function serveFile(req, res, url) {
  const file = publicPath(url.pathname);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    // no-cache = revalidate every time; Last-Modified makes that a tiny 304 instead of a full re-download
    const mtime = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === mtime) { res.writeHead(304); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()];
    // shortcut: gzips on every request (fine for a small game); pre-compress files if traffic grows
    const gz = COMPRESS.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': type, ...(gz ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': st.size }), Vary: 'Accept-Encoding', 'Last-Modified': mtime, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    (gz ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}

function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); } // e.g. "//" used to crash the server
  if (url.pathname !== '/api/scores') return req.method === 'GET' || req.method === 'HEAD' ? serveFile(req, res, url) : (res.writeHead(405), res.end());
  if (req.method === 'GET') return json(res, 200, board(load(), url.searchParams.get('id'), 50, url.searchParams.get('period') === 'week' ? 'week' : 'all'));
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 1024) { json(res, 413, { error: 'too big' }); req.destroy(); }
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let rec;
    try { rec = clean(JSON.parse(raw)); } catch { rec = null; }
    if (!rec) return json(res, 400, { error: 'bad score' });
    const db = merge(load(), rec);
    save(db);
    json(res, 200, board(db, rec.id));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 5500;
  const host = process.env.HOST || '127.0.0.1'; // same address the VS Code dev tunnel forwards to
  http.createServer(handle)
    .on('error', (e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Stop Live Server ("Port: ${port}" in the VS Code status bar), then run this again.` : e.message);
      process.exit(1);
    })
    .listen(port, host, () => console.log(`Vandi-Verse on http://localhost:${port}`));
}
