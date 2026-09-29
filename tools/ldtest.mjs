import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const B = {};
for (let i = 0; i < 40; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 1300 + i });
  const fp = g.finishPlay.bind(g);
  g.finishPlay = function () {
    const res = this.play.result; const bb = this.batted;
    if (!res.foul && !res.steal && !res.hr && bb.la >= 5 && bb.la < 35) {
      const k = `LA${Math.floor(bb.la / 5) * 5} EV${bb.ev < 85 ? '<85' : bb.ev < 95 ? '85-95' : '95+'}`;
      B[k] = B[k] || [0, 0, []];
      B[k][0]++;
      if (!res.batterOut && !res.errors.length) B[k][1]++;
      else if (res.chain[0]) B[k][2].push(res.chain[0]);
    }
    return fp();
  };
  g.simToEnd();
}
for (const k of Object.keys(B).sort()) {
  const [n, h, outs] = B[k];
  const by = {}; outs.forEach((p) => (by[p] = (by[p] || 0) + 1));
  console.log(k.padEnd(16), `n=${String(n).padStart(3)} BA=${(h / n).toFixed(2)} outsBy=${JSON.stringify(by)}`);
}
