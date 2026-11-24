-- Leaderboard table for Cloudflare D1. Run once in the D1 console (or: wrangler d1 execute <db> --remote --file=db/schema.sql).
-- One row per player: all-time best, plus this week's best run (wk = week number, see weekOf in functions/_shared/score-rules.js).
CREATE TABLE IF NOT EXISTS players (
  id    TEXT PRIMARY KEY,   -- random id the browser keeps; never sent back to other players
  name  TEXT NOT NULL,
  best  INTEGER NOT NULL,
  wk    INTEGER,            -- week of wbest; NULL when the player has no run this week
  wbest INTEGER
);
CREATE INDEX IF NOT EXISTS players_best ON players (best DESC);
CREATE INDEX IF NOT EXISTS players_week ON players (wk, wbest DESC);
