// Season engine check: schedule balance, a few simulated days, standings and leaders.
//   node tools/seasontest.mjs [days=2]
import { readFileSync } from 'node:fs';
import * as S from '../js/season/season.js';
import { normalizeTeam } from '../js/data/teams.js';

for (const [n, g] of [[30, 162], [30, 40], [4, 162], [5, 30]]) {
  const days = S.makeSchedule(n, g, 7);
  const c = Array(n).fill(0), h = Array(n).fill(0);
  for (const day of days) for (const x of day) { c[x.a]++; c[x.h]++; h[x.h]++; }
  console.log(`${n} teams, ${g} games: ${days.length} days, games/team ${Math.min(...c)}-${Math.max(...c)}, home ${Math.min(...h)}-${Math.max(...h)}`);
}

const data = JSON.parse(readFileSync(new URL('../js/data/mlb/2026.json', import.meta.url)));
const teams = data.teams.map(normalizeTeam);
const s = S.createSeason({ league: 'mlb-2026', leagueName: 'MLB 2026', teams, games: 15, follow: 0, seed: 5 });
S.prepareDay(s);
const want = +process.argv[2] || 2;
const t0 = Date.now();
let n = 0;
while (!S.isOver(s) && s.day < want) {
  for (const g of s.days[s.day]) { S.recordResult(s, S.simGame(s, g)); n++; }
  S.advanceIfDone(s);
}
console.log(`${n} games, ${((Date.now() - t0) / n).toFixed(0)} ms/game; now day ${s.day}; save size ${(JSON.stringify(s).length / 1024).toFixed(0)} KB`);
for (const div of S.groupedStandings(s).slice(0, 2)) console.log(div.name, div.rows.map((r) => `${r.team.abbr} ${r.w}-${r.l} GB ${r.gb}`).join(', '));
const L = S.leaders(s, 3);
for (const c of [...L.batting.slice(1, 3), ...L.pitching.slice(1, 4)]) console.log(c.label, c.list.map((x) => `${x.name} (${x.team}) ${x.value}`).join(', '));
console.log('rotation check, day 2 starters for', teams[0].abbr, s.days[1].find((g) => g.a === 0 || g.h === 0));
