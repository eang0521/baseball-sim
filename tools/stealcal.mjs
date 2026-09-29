// Force steal attempts and compare the manager's estimated margin with outcomes.
import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const buckets = {};
for (let i = 0; i < 40; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 70 + i });
  let pending = null;
  g.decideSteal = function () {
    const b = this.state.bases;
    if (!(b[1] && !b[2]) || this.state.outs >= 2 || this.rng.next() > 0.5) return null;
    const m = this.stealMargin(b[1], 1, this.defenseSide.pitcher, this.defenseSide.defense.C);
    pending = { m, p: b[1] };
    return this.makeStealers([1], false);
  };
  const fs = g.finishSteal.bind(g);
  g.finishSteal = function (res) {
    if (pending) {
      const r = res.runners.find((q) => q.player === pending.p);
      const k = (Math.round(pending.m * 10) / 10).toFixed(1);
      buckets[k] = buckets[k] || [0, 0];
      buckets[k][0]++; if (r && !r.out) buckets[k][1]++;
      pending = null;
    }
    return fs(res);
  };
  const fp = g.finishPlay.bind(g);
  g.finishPlay = function () { if (!this.play.steal) pending = null; return fp(); };
  g.simToEnd();
}
for (const k of Object.keys(buckets).sort((a, b) => a - b)) console.log(`margin ${k}: ${buckets[k][1]}/${buckets[k][0]} = ${(buckets[k][1] / buckets[k][0]).toFixed(2)}`);
