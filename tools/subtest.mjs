// Substitution rates and last-pitch mode check.
//   node tools/subtest.mjs [games=60] [mlb|custom]
import { readFileSync } from 'node:fs';
import { Game } from '../js/sim/game.js';
import { defaultTeams, normalizeTeam } from '../js/data/teams.js';

const N = +process.argv[2] || 60;
const teams = process.argv[3] === 'custom' ? defaultTeams().map(normalizeTeam)
  : JSON.parse(readFileSync(new URL('../js/data/mlb/2026.json', import.meta.url))).teams.map(normalizeTeam);
const tally = { PH: 0, PR: 0, DEF: 0 };
const tot = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, so: 0, r: 0 };
let shown = 0, shownBad = 0, pas = 0, pitches = 0;
const sample = [];
for (let i = 0; i < N; i++) {
  const a = teams[(i * 7) % teams.length], h = teams[(i * 7 + 3) % teams.length];
  const last = i % 2 === 1;
  const g = new Game(a, h, { seed: 300 + i, lastPitchOnly: last });
  if (last) {
    // play it like the browser does: advance in frame-sized steps, watch which pitches are on screen
    let guard = 0, prevSeq = g.paSeq;
    let shownThisPA = 0;
    while (!g.over && guard++ < 2e6) {
      g.advance(1 / 30);
      for (const e of g.events) {
        if (e.type === 'pitch') shownThisPA++;
        if (e.type === 'substitution') tally[e.how]++;
      }
      g.events.length = 0;
      if (g.paSeq !== prevSeq) {
        if (shownThisPA > 1) shownBad++; // more than one pitch shown in one PA (a foul ball in play, then the decider)
        shown += shownThisPA; pas++; shownThisPA = 0; prevSeq = g.paSeq;
      }
    }
  } else {
    const orig = g.onEvent.bind(g);
    g.onEvent = (e) => { if (e.type === 'substitution') tally[e.how]++; orig(e); };
    g.simToEnd();
  }
  for (const sd of g.sides) {
    for (const b of sd.bat.values()) for (const k in tot) tot[k] += b[k];
    for (const p of sd.pit.values()) pitches += p.pc;
  }
  if (i < 3) sample.push(...g.log.filter((l) => l.kind === 'change' && !/Pitching/.test(l.text)).map((l) => `  ${l.half ? 'B' : 'T'}${l.inning}: ${l.text}`));
}
const tg = N * 2;
console.log(`${N} games. Per team-game: PH ${(tally.PH / tg).toFixed(2)}  PR ${(tally.PR / tg).toFixed(2)}  DEF ${(tally.DEF / tg).toFixed(2)}`);
console.log(`R/G ${(tot.r / tg).toFixed(2)}  AVG ${(tot.h / tot.ab).toFixed(3)}  K% ${(100 * tot.so / tot.pa).toFixed(1)}  BB% ${(100 * tot.bb / tot.pa).toFixed(1)}  HR% ${(100 * tot.hr / tot.pa).toFixed(2)}  P/PA ${(pitches / tot.pa).toFixed(2)}`);
console.log(`last-pitch games: ${pas} PAs watched, ${(shown / pas).toFixed(2)} pitches shown per PA, ${shownBad} PAs showed more than one pitch`);
console.log('sample subs:\n' + sample.slice(0, 14).join('\n'));
