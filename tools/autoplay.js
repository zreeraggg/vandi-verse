// Autoplay check (dev only, not part of the game): a bot plays the real game in a browser, as fast as the CPU allows,
// and reports crashes, overlapping vehicles and "walls" (all three lanes blocked at once).
// Inject before the page loads, e.g. with Playwright: await page.addInitScript({ path: 'tools/autoplay.js' }), then
// read window.__auto (done, runs, issues). Needs window.__app.objs / .peek() from main.js.
(() => {
  localStorage.setItem('krb-name', 'Autoplay');
  localStorage.setItem('krb-muted', '1');
  localStorage.setItem('krb-tipped', '1');
  // Never post bot runs to the shared leaderboard, and leave nothing behind: a later normal visit in this browser
  // would otherwise re-send the bot's saved best under its name.
  addEventListener('pagehide', () => localStorage.clear());
  const realFetch = window.fetch;
  window.fetch = (url, opts) => (String(url).includes('api/scores') && opts?.method === 'POST' ? Promise.resolve(new Response('{}')) : realFetch(url, opts));
  const TARGET = +(localStorage.getItem('autoplay-target') || 3000), MAX_RUNS = 15, LANE_W = 2.4, laneX = (l) => (l - 1) * LANE_W;
  const HARD = new Set(['bus', 'auto', 'bike', 'coconut']), JUMP = new Set(['pothole', 'car']);
  const A = (window.__auto = { done: false, runs: [], issues: [], frames: 0, perf: { jsMs: [], samples: [] } });
  let realRender = null, nextSample = 0;
  const seen = new Set(), streak = new Map(); // overlap pair -> consecutive frames
  const issue = (kind, info) => {
    const key = kind + JSON.stringify(info.key ?? info);
    if (seen.has(key)) return;
    seen.add(key);
    delete info.key;
    A.issues.push({ kind, ...info });
  };

  // Fake animation frames: a fixed 60 fps clock, driven by MessageChannel (not throttled like timers in a hidden tab).
  let cbs = [], t = 0;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  const ch = new MessageChannel();
  // Capture mode (localStorage 'autoplay-capture' = metres): play fast to that distance, then hold with real rendering
  // on, so a recorder can call __auto.step(n) and screenshot between steps (that's how the README GIF is made).
  const CAPTURE = +(localStorage.getItem('autoplay-capture') || 0);
  function tick() {
    const run = cbs; cbs = [];
    t = t ? t + 1000 / 60 : performance.now() + 1000;
    try { bot(); } catch (e) { A.botError = String(e); }
    const t0 = performance.now();
    for (const cb of run) cb(t);
    if (window.__app?.peek?.().state === 'run') A.perf.jsMs.push(performance.now() - t0); // game logic only (render is stubbed)
    A.frames++;
  }
  A.step = (n = 1) => { for (let i = 0; i < n; i++) tick(); return window.__app.peek(); };
  ch.port1.onmessage = () => {
    if (A.done || A.capturing) return;
    tick();
    if (CAPTURE && window.__app?.peek?.().state === 'run' && window.__app.peek().dist >= CAPTURE) {
      A.capturing = true;
      window.__app.renderer.render = realRender;
      return;
    }
    ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);

  const key = (k) => dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const prevZ = new WeakMap();
  let lastState = '', started = false, waitT = 0, maxDist = 0;

  function snapshot() {
    return window.__app.objs.filter((o) => o.z > -40 && o.z < 10).map((o) => ({
      type: o.type, lane: o.lane, toLane: o.toLane, x: +o.x.toFixed(2), z: +o.z.toFixed(1), oncoming: !!o.oncoming, moveT: o.moveT,
    }));
  }

  function bot() {
    const app = window.__app;
    if (!app?.ready || !app.peek) return;
    if (!app.renderer.__stub) { realRender = app.renderer.render.bind(app.renderer); app.renderer.render = () => {}; app.renderer.__stub = true; }
    const p = app.peek();
    if (!started) { document.getElementById('play')?.click(); started = true; return; }
    if (p.state === 'intro') { if (A.frames % 30 === 0) key('Enter'); return; }
    if (p.state === 'dead' && lastState === 'run') {
      A.runs.push({ dist: Math.floor(p.dist), cause: p.cause, near: snapshot(), lane: p.lane, px: +p.px.toFixed(2), py: +p.py.toFixed(2) });
    }
    if (p.state === 'over') {
      if (A.runs.length >= MAX_RUNS || maxDist >= TARGET) { A.done = true; return; }
      if (++waitT > 20) { waitT = 0; document.getElementById('again')?.click(); }
    }
    lastState = p.state;
    if (p.state !== 'run') return;
    maxDist = Math.max(maxDist, p.dist);
    if (p.dist >= nextSample) { // one real frame every 500 m: draw calls, triangles, GPU+CPU render time
      nextSample += 500;
      const r = app.renderer, t1 = performance.now();
      realRender(app.scene, app.camera);
      r.getContext().finish();
      A.perf.samples.push({ dist: Math.floor(p.dist), calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures, ms: +(performance.now() - t1).toFixed(1) });
    }
    if (p.dist >= TARGET) { A.runs.push({ dist: Math.floor(p.dist), cause: 'reached target' }); A.done = true; return; }

    const objs = app.objs, dt = 1 / 60;
    // Closing speed of each obstacle (m/s toward the runner), measured from its motion.
    for (const o of objs) { o.__v = prevZ.has(o) ? (o.z - prevZ.get(o)) / dt : 14; prevZ.set(o, o.z); }

    // Logic checks: overlapping vehicles, and walls.
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i], b = objs[j];
      if (a.z < -110 || b.z < -110) continue; // still spawning far away
      const pair = [a.type, b.type];
      if (pair.includes('coconut') && (pair.includes('flex') || pair.includes('pothole'))) continue; // rolls under a banner / over a hole: fine
      const side = Math.abs(a.x - b.x) < (a.halfW ?? 0.5) + (b.halfW ?? 0.5);
      const along = Math.abs(a.z - b.z) < (a.len + b.len) / 2;
      const sk = a.mesh.uuid + b.mesh.uuid, n = side && along ? (streak.get(sk) ?? 0) + 1 : 0;
      streak.set(sk, n);
      if (n >= 4) issue('overlap', { key: [a.type, a.lane, b.type, b.lane, Math.round(a.z / 30)], dist: Math.floor(p.dist), a: { type: a.type, lane: a.lane, toLane: a.toLane, z: +a.z.toFixed(1), oncoming: !!a.oncoming }, b: { type: b.type, lane: b.lane, toLane: b.toLane, z: +b.z.toFixed(1), oncoming: !!b.oncoming } });
    }

    // Time until each lane is blocked by a hard obstacle (seconds); soft ones are passable with a jump/slide.
    const ttc = [Infinity, Infinity, Infinity];
    for (const o of objs) {
      if (!HARD.has(o.type)) continue;
      const near = o.z + o.len / 2, far = o.z - o.len / 2;
      if (far > 0.6) continue; // already behind
      const v = Math.max(1, o.__v);
      const tt = near > -0.6 ? 0 : -near / v;
      for (let L = 0; L < 3; L++) {
        let inLane = Math.abs(o.x - laneX(L)) < (o.halfW ?? 0.7) + 0.55;
        if (o.type === 'auto' && o.toLane === L && o.moveT < 1) inLane = true; // it will swerve in
        if (inLane) ttc[L] = Math.min(ttc[L], tt);
      }
    }
    if (ttc.every((x) => x < 0.45)) issue('wall', { key: [Math.round(p.dist / 10)], dist: Math.floor(p.dist), ttc: ttc.map((x) => +x.toFixed(2)), near: snapshot() });

    // Steer: stay unless the lane gets blocked within 1.6 s, then go to the lane that stays free longest.
    const cur = p.lane;
    if (ttc[cur] < 1.6) {
      let best = cur;
      for (const L of [cur - 1, cur + 1, cur - 2, cur + 2]) {
        if (L < 0 || L > 2) continue;
        if (Math.abs(L - cur) === 2 && ttc[1] < 0.5) continue; // can't dash through a blocked middle lane
        if (ttc[L] > ttc[best] + 0.15) best = L;
      }
      if (best < cur) key('ArrowLeft'); else if (best > cur) key('ArrowRight');
    }

    // Jump potholes / cars and slide under flex boards in the lane we're in or moving into.
    for (const o of objs) {
      if (Math.abs(o.x - p.px) > 1.2 && Math.abs(o.x - laneX(p.lane)) > 0.5) continue;
      const near = o.z + o.len / 2, v = Math.max(1, o.__v);
      if (JUMP.has(o.type) && p.py === 0 && near < 0 && -near < 0.35 + 0.12 * v) key('ArrowUp');
      if (o.type === 'flex' && p.py === 0 && p.slideT <= 0 && near < 0 && -near < 0.35 + 0.1 * v) key('ArrowDown');
    }
  }
})();
