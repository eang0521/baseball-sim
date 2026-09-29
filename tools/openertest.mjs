// A pitcher listed as a reliever (or setup man) who starts should go as long as his stamina allows.
import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
for (const role of ['SP', 'RP', 'SU']) {
  let outs = 0, pcs = 0, n = 0, oneAndDone = 0;
  for (let i = 0; i < 20; i++) {
    const home = teams[1];
    const sp = home.pitchers.find((p) => p.role === role);
    const g = new Game(teams[0], home, { seed: 40 + i, homeStarter: sp.id });
    g.simToEnd();
    const l = g.sides[1].pit.get(sp.id);
    outs += l.outs; pcs += l.pc; n++;
    if (l.outs <= 3 && l.r === 0) oneAndDone++;
  }
  const sp = teams[1].pitchers.find((p) => p.role === role);
  console.log(`${role} starter (stamina ${sp.stamina}): avg ${(outs / n / 3).toFixed(1)} IP, ${(pcs / n).toFixed(0)} pitches; pulled after <=1 scoreless inning: ${oneAndDone}/${n}`);
}
