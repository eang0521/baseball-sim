// Postseason check: fills a short regular season with random scores (fast), then sims the real
// playoff games and prints seeds, every series and the champion.
//   node tools/playofftest.mjs [mlb|custom]
import { readFileSync } from 'node:fs';
import * as S from '../js/season/season.js';
import { normalizeTeam, defaultTeams } from '../js/data/teams.js';
import { RNG } from '../js/sim/rng.js';

const custom = process.argv[2] === 'custom';
const teams = custom ? defaultTeams().map(normalizeTeam)
  : JSON.parse(readFileSync(new URL('../js/data/mlb/2026.json', import.meta.url))).teams.map(normalizeTeam);
const s = S.createSeason({ league: 'x', leagueName: 'Test', teams, games: 40, follow: 0, seed: 9 });
const rng = new RNG(3);
const fake = (g) => ({ id: g.id, score: rng.chance(0.5) ? [rng.int(0, 4), rng.int(5, 9)] : [rng.int(5, 9), rng.int(0, 4)], innings: 9, sides: [{ bat: [], pit: [] }, { bat: [], pit: [] }], wp: null, lp: null, sv: null });
while (!S.isOver(s)) {
  for (const g of S.upcomingGames(s, 1)) S.recordResult(s, fake(g));
  S.advanceIfDone(s);
}
const po = s.playoffs;
const ab = (t) => s.teams[t].abbr;
console.log(`format ${po.format}`);
for (const [lg, seeds] of Object.entries(po.seeds)) {
  const st = S.standings(s);
  console.log(`${lg}: ${seeds.map((t, k) => `${k + 1}.${ab(t)} ${st[t].w}-${st[t].l} ${s.teams[t].division || ''}`).join('  ')}`);
}
let days = 0, games = 0;
while (po.champion == null && days < 80) {
  const today = S.playoffToday(s);
  for (const g of today) { S.recordResult(s, S.simGame(s, g)); games++; }
  days++;
}
for (const r of po.rounds) {
  console.log(`\n${r.name}`);
  for (const sr of r.series) {
    console.log(`  ${sr.label}: (${sr.hiSeed}) ${ab(sr.hi)} vs (${sr.loSeed}) ${ab(sr.lo)} — ${S.seriesStatus(s, sr)}  [${sr.games.map((g) => `${ab(g.a)}@${ab(g.h)} ${g.score.join('-')}`).join(', ')}]`);
  }
}
console.log(`\nChampion: ${s.teams[po.champion].name} after ${games} postseason games over ${days} days`);
const sp = Object.entries(po.pit).sort((a, b) => b[1].gs - a[1].gs).slice(0, 3).map(([id, p]) => `${id} GS ${p.gs} W ${p.w}`);
console.log('most postseason starts:', sp.join(', '));
