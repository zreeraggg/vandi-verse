// Cloudflare Pages Function for /api/scores: the same API as server.mjs, with scores in a D1 database.
// Needs a D1 binding named DB (Pages project > Settings > Bindings) and the table from db/schema.sql.
//   GET  /api/scores?id=<player id>&period=all|week  -> { top: [{ name, best, me }], me: { rank, name, best } | null, players }
//   POST /api/scores  { id, name, best, run? }        -> the all-time board for that player
import { weekOf, clean } from "../_shared/score-rules.js";

const LIMIT = 50;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

// Score column for a period: all-time best, or this week's best run (0 when the player's run is from another week).
// Both forms use ?1 (the week) so every query binds the same parameters; best + 0 * ?1 is just best.
const scoreSql = (period) =>
  period === "week"
    ? "CASE WHEN wk = ?1 THEN wbest ELSE 0 END"
    : "(best + 0 * ?1)";

export async function board(db, id, period = "all", wk = weekOf()) {
  const score = scoreSql(period);
  const top = await db
    .prepare(
      `SELECT id, name, ${score} AS s FROM players WHERE ${score} > 0 ORDER BY s DESC LIMIT ${LIMIT}`,
    )
    .bind(wk)
    .all();
  const { n } = await db
    .prepare(`SELECT COUNT(*) AS n FROM players WHERE ${score} > 0`)
    .bind(wk)
    .first();
  let me = null;
  if (id) {
    const row = await db
      .prepare(`SELECT name, ${score} AS s FROM players WHERE id = ?2`)
      .bind(wk, id)
      .first();
    if (row && row.s > 0) {
      const { above } = await db
        .prepare(`SELECT COUNT(*) AS above FROM players WHERE ${score} > ?2`)
        .bind(wk, row.s)
        .first();
      me = { rank: above + 1, name: row.name, best: row.s };
    }
  }
  // ids stay on the server: other players only ever see names
  return {
    top: top.results.map((r) => ({ name: r.name, best: r.s, me: r.id === id })),
    me,
    players: n,
  };
}

// Keeps each player's highest score (all-time, plus this week's best run as wk/wbest); the name always updates.
// In an UPDATE, SQLite reads every column's old value, so wk and wbest see the row as it was.
export function merge(db, rec, wk = weekOf()) {
  const run = rec.run ?? 0;
  return db
    .prepare(
      `
    INSERT INTO players (id, name, best, wk, wbest) VALUES (?1, ?2, ?3, CASE WHEN ?4 > 0 THEN ?5 END, CASE WHEN ?4 > 0 THEN ?4 END)
    ON CONFLICT (id) DO UPDATE SET
      name  = excluded.name,
      best  = MAX(players.best, excluded.best),
      wk    = CASE WHEN MAX(CASE WHEN players.wk = ?5 THEN players.wbest ELSE 0 END, ?4) > 0 THEN ?5 END,
      wbest = CASE WHEN MAX(CASE WHEN players.wk = ?5 THEN players.wbest ELSE 0 END, ?4) > 0
                   THEN MAX(CASE WHEN players.wk = ?5 THEN players.wbest ELSE 0 END, ?4) END`,
    )
    .bind(rec.id, rec.name, rec.best, run, wk)
    .run();
}

// Setup problems answer with a readable error instead of Cloudflare's bare "1101 Worker threw exception".
async function guarded(env, work) {
  if (!env.DB)
    return json(
      {
        error:
          'No D1 database bound as DB: Pages project > Settings > Bindings > add D1 "DB", then redeploy.',
      },
      500,
    );
  try {
    return await work();
  } catch (e) {
    const msg = String(e?.message ?? e);
    return json(
      {
        error: /no such table/i.test(msg)
          ? "The players table is missing: run db/schema.sql in the D1 console."
          : `Database error: ${msg}`,
      },
      500,
    );
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  return guarded(env, async () =>
    json(
      await board(
        env.DB,
        url.searchParams.get("id"),
        url.searchParams.get("period") === "week" ? "week" : "all",
      ),
    ),
  );
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (raw.length > 1024) return json({ error: "too big" }, 413);
  let rec;
  try {
    rec = clean(JSON.parse(raw));
  } catch {
    rec = null;
  }
  if (!rec) return json({ error: "bad score" }, 400);
  return guarded(env, async () => {
    await merge(env.DB, rec);
    return json(await board(env.DB, rec.id));
  });
}
