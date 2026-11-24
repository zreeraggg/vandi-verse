// Leaderboard rules shared by server.mjs (local) and the Cloudflare Pages Function (functions/api/scores.js).
// Folders starting with "_" inside functions/ are not routes, so this file is never served as an endpoint.

// Week number, weeks starting Monday 00:00 UTC (day 0 of the epoch was a Thursday, hence +3).
export const weekOf = (ms = Date.now()) => Math.floor((ms / 86400000 + 3) / 7);
export const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 200000;

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
