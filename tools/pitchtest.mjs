import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const N = +process.argv[2] || 30;
let early = 0, spIP = 0, spN = 0;
for (let i = 0; i < N; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 500 + i });
  g.simToEnd();
  for (const sd of g.sides) {
    const sp = sd.used[0]; const l = sd.pit.get(sp.id);
    spIP += l.outs / 3; spN++;
    if (l.outs < 12 && l.r < 4) { early++; console.log(`game ${i}: ${sp.name} (${sp.role}, stam ${sp.stamina}) pulled after ${l.outs} outs, ${l.r} R, ${l.pc} pitches`); }
  }
  if (i < 2) console.log(g.log.filter(x => x.kind === 'change').map(x => `inn ${x.inning}: ${x.text}`).join('\n'));
}
console.log(`starter avg IP ${(spIP / spN).toFixed(2)}, suspicious early hooks ${early}/${spN}`);
