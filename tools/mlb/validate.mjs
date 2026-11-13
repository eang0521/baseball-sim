// Simulate games between the imported MLB clubs and compare the sim's output with reality:
// league slash line, and how well each regular's simulated rates track his real ones.
//
//   node tools/mlb/validate.mjs [season] [games=600] [workers=cpus-2] [--adjust]
//
// --adjust folds the league-wide sim/real gap into tools/mlb/league_adjust.json (half to hitters,
// half to pitchers); re-run import.mjs afterwards. Two or three rounds is plenty.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

if (isMainThread) {
  const adjust = process.argv.includes('--adjust');
  process.argv = process.argv.filter((a) => a !== '--adjust');
  const season = +process.argv[2] || JSON.parse(readFileSync(join(here, '../../js/data/mlb/index.json'), 'utf8')).seasons[0];
  const games = +process.argv[3] || 600;
  const nw = +process.argv[4] || Math.max(1, cpus().length - 2);
  const data = JSON.parse(readFileSync(join(here, `../../js/data/mlb/${season}.json`), 'utf8'));
  const per = Math.ceil(games / nw);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: nw }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { season, games: per, seed: 900 + w * 7919 } });
    wk.on('message', res); wk.on('error', rej);
  })));
  const bat = new Map(), pit = new Map(), team = {};
  let g = 0, runs = 0, sb = 0, cs = 0;
  for (const p of parts) {
    g += p.games; runs += p.runs; sb += p.sb; cs += p.cs;
    for (const [id, s] of p.bat) add(bat, id, s);
    for (const [id, s] of p.pit) add(pit, id, s);
    for (const [k, v] of Object.entries(p.team)) { team[k] ||= { w: 0, g: 0, rs: 0, ra: 0 }; for (const f in v) team[k][f] += v[f]; }
  }
  const T = [...bat.values()].reduce((t, s) => { for (const k in s) t[k] = (t[k] || 0) + s[k]; return t; }, {});
  const avg = T.h / T.ab, obp = (T.h + T.bb + T.hbp) / (T.ab + T.bb + T.hbp + T.sf), slg = (T.h + T.d + 2 * T.t + 3 * T.hr) / T.ab;
  console.log(`${g} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`SIM  R/G ${(runs / g / 2).toFixed(2)}  ${avg.toFixed(3)}/${obp.toFixed(3)}/${slg.toFixed(3)}  K% ${(100 * T.so / T.pa).toFixed(1)}  BB% ${(100 * T.bb / T.pa).toFixed(1)}  HR% ${(100 * T.hr / T.pa).toFixed(2)}  SB/G ${(sb / g / 2).toFixed(2)} SB% ${(100 * sb / (sb + cs)).toFixed(0)}`);

  // Real rates for each player from the cached Stats API pull.
  const cache = (f) => JSON.parse(readFileSync(join(here, 'cache', f), 'utf8')).stats[0].splits;
  const realH = new Map(cache(`hitting_${season}.json`).map((s) => [`mlb${s.player.id}`, s.stat]));
  const realP = new Map(cache(`pitching_${season}.json`).map((s) => [`mlb${s.player.id}`, s.stat]));
  const L = [...realH.values()].reduce((t, s) => { t.pa += s.plateAppearances; t.ab += s.atBats; t.h += s.hits; t.d += s.doubles; t.t += s.triples; t.hr += s.homeRuns; t.bb += s.baseOnBalls; t.hbp += s.hitByPitch; t.sf += s.sacFlies; t.so += s.strikeOuts; return t; }, { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hbp: 0, sf: 0, so: 0 });
  console.log(`REAL R/G ${(cache(`hitting_${season}.json`).reduce((a, s) => a + s.stat.runs, 0) / 4860).toFixed(2)}  ${(L.h / L.ab).toFixed(3)}/${((L.h + L.bb + L.hbp) / (L.ab + L.bb + L.hbp + L.sf)).toFixed(3)}/${((L.h + L.d + 2 * L.t + 3 * L.hr) / L.ab).toFixed(3)}  K% ${(100 * L.so / L.pa).toFixed(1)}  BB% ${(100 * L.bb / L.pa).toFixed(1)}  HR% ${(100 * L.hr / L.pa).toFixed(2)}`);

  const rate = (s) => ({ k: s.so / s.pa, bb: (s.bb + s.hbp) / s.pa, hr: s.hr / s.pa, h1: (s.h - s.d - s.t - s.hr) / s.pa, xbh: (s.d + s.t) / s.pa });
  const simR = rate(T), realR = rate(L);
  console.log('per-PA real/sim:', Object.keys(simR).map((o) => `${o} ${(realR[o] / simR[o]).toFixed(3)}`).join('  '));
  if (adjust) {
    const file = join(here, 'league_adjust.json');
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const a = all[season] ||= { hitter: {}, pitcher: {} };
    for (const o of Object.keys(simR)) {
      const f = Math.sqrt(realR[o] / simR[o]);
      a.hitter[o] = +((a.hitter[o] ?? 1) * f).toFixed(4);
      // pitchers' targets are rates *allowed*, so the same direction applies
      a.pitcher[o] = +((a.pitcher[o] ?? 1) * f).toFixed(4);
    }
    writeFileSync(file, JSON.stringify(all, null, 1));
    console.log('updated', file, JSON.stringify(a));
  }

  const corr = (xs, ys) => {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  const hitMetrics = {
    'K%': (s) => s.so / s.pa, 'BB%': (s) => (s.bb + s.hbp) / s.pa, 'HR%': (s) => s.hr / s.pa,
    AVG: (s) => s.h / s.ab, ISO: (s) => (s.d + 2 * s.t + 3 * s.hr) / s.ab,
    OPS: (s) => (s.h + s.bb + s.hbp) / (s.ab + s.bb + s.hbp + s.sf) + (s.h + s.d + 2 * s.t + 3 * s.hr) / s.ab,
  };
  const real2sim = (s) => ({ pa: s.plateAppearances, ab: s.atBats, h: s.hits, d: s.doubles, t: s.triples, hr: s.homeRuns, bb: s.baseOnBalls, hbp: s.hitByPitch, sf: s.sacFlies, so: s.strikeOuts });
  const regs = [...bat.entries()].filter(([id, s]) => s.pa >= 250 && realH.get(id)?.plateAppearances >= 300);
  console.log(`\nHitters with 300+ real PA (n=${regs.length}): correlation of sim vs real, and spread (sd) of each`);
  for (const [k, f] of Object.entries(hitMetrics)) {
    const xs = regs.map(([id]) => f(real2sim(realH.get(id)))), ys = regs.map(([, s]) => f(s));
    console.log(`  ${k.padEnd(4)} r=${corr(xs, ys).toFixed(2)}  real sd ${sd(xs).toFixed(3)}  sim sd ${sd(ys).toFixed(3)}  real mean ${mean(xs).toFixed(3)} sim mean ${mean(ys).toFixed(3)}`);
  }
  const pregs = [...pit.entries()].filter(([id, s]) => s.bf >= 150 && realP.get(id)?.battersFaced >= 250);
  console.log(`Pitchers with 250+ real BF (n=${pregs.length})`);
  const pm = { 'K%': (s) => s.so / s.bf, 'BB%': (s) => s.bb / s.bf, 'HR%': (s) => s.hr / s.bf, 'RA9': (s) => 27 * s.r / Math.max(1, s.outs) };
  for (const [k, f] of Object.entries(pm)) {
    const xs = pregs.map(([id]) => { const r = realP.get(id); return f({ so: r.strikeOuts, bb: r.baseOnBalls, hr: r.homeRuns, bf: r.battersFaced, r: r.runs, outs: r.outs }); });
    const ys = pregs.map(([, s]) => f(s));
    console.log(`  ${k.padEnd(4)} r=${corr(xs, ys).toFixed(2)}  real sd ${sd(xs).toFixed(3)}  sim sd ${sd(ys).toFixed(3)}  real mean ${mean(xs).toFixed(3)} sim mean ${mean(ys).toFixed(3)}`);
  }
  const names = new Map(data.teams.flatMap((t) => [...t.lineup, ...t.pitchers].map((p) => [p.id, p.name])));
  const top = regs.map(([id, s]) => [id, hitMetrics.OPS(s), hitMetrics.OPS(real2sim(realH.get(id)))]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('\nTop sim OPS (sim vs real):', top.map(([id, s, r]) => `${names.get(id)} ${s.toFixed(3)}/${r.toFixed(3)}`).join(', '));
  const standings = Object.entries(team).map(([k, v]) => [k, v.w / v.g, (v.rs - v.ra) / v.g]).sort((a, b) => b[1] - a[1]);
  console.log('Sim win%:', standings.map(([k, w, d]) => `${k} ${w.toFixed(3)}`).join(' '));
} else {
  const { Game } = await import('../../js/sim/game.js');
  const { normalizeTeam } = await import('../../js/data/teams.js');
  const { RNG } = await import('../../js/sim/rng.js');
  const data = JSON.parse(readFileSync(join(here, `../../js/data/mlb/${workerData.season}.json`), 'utf8'));
  const teams = data.teams.map(normalizeTeam);
  const rng = new RNG(workerData.seed);
  const bat = new Map(), pit = new Map(), team = {};
  let runs = 0, sb = 0, cs = 0;
  const rot = {};
  for (let i = 0; i < workerData.games; i++) {
    const a = rng.int(0, teams.length - 1);
    let h = rng.int(0, teams.length - 2); if (h >= a) h++;
    // cycle through each club's rotation
    const sp = (t) => { const s = t.pitchers.filter((p) => p.role === 'SP'); rot[t.id] = ((rot[t.id] ?? rng.int(0, 4)) + 1) % Math.max(1, s.length); return s[rot[t.id]]?.id; };
    const g = new Game(teams[a], teams[h], { seed: workerData.seed * 13 + i, awayStarter: sp(teams[a]), homeStarter: sp(teams[h]) });
    g.simToEnd();
    runs += g.state.score[0] + g.state.score[1];
    g.sides.forEach((sd, k) => {
      for (const [id, s] of sd.bat) { add(bat, id, s); sb += s.sb; cs += s.cs; }
      for (const [id, s] of sd.pit) add(pit, id, s);
      const t = team[sd.team.abbr] ||= { w: 0, g: 0, rs: 0, ra: 0 };
      t.g++; t.rs += g.state.score[k]; t.ra += g.state.score[1 - k]; if (g.state.score[k] > g.state.score[1 - k]) t.w++;
    });
  }
  parentPort.postMessage({ games: workerData.games, runs, sb, cs, bat: [...bat], pit: [...pit], team });
}

function add(m, id, s) {
  const t = m.get(id) || {};
  for (const k in s) t[k] = (t[k] || 0) + s[k];
  m.set(id, t);
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); }
