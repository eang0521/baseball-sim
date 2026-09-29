import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const D = {};
const inc = (k) => (D[k] = (D[k] || 0) + 1);
for (let i = 0; i < 30; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 900 + i });
  const fp = g.finishPlay.bind(g);
  g.finishPlay = function () {
    const res = this.play.result;
    if (!res.foul && !res.steal && !res.batterOut && res.batterBase === 2 && !res.groundRule) {
      const br = res.runners.find((r) => r.isBatter);
      const f = res.chain[0];
      const depth = res.firstLanding ? Math.hypot(res.firstLanding.x, res.firstLanding.y) : 0;
      inc(`${this.batted.type} first=${f} ${depth > 80 ? 'deep' : depth > 55 ? 'mid' : 'short'} ${res.throwsTo2 ? '' : ''}`);
    }
    return fp();
  };
  g.simToEnd();
}
console.log(Object.entries(D).sort((a, b) => b[1] - a[1]).slice(0, 20));
