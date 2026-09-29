// Force bunt attempts to check outcomes.
import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const kind = process.argv[2] || 'sac';
const out = {};
const inc = (k) => (out[k] = (out[k] || 0) + 1);
for (let i = 0; i < 30; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 300 + i });
  g.decideSteal = () => null;
  let paBunt = false;
  const sw = g.startWindup.bind(g);
  g.startWindup = function () {
    sw();
    const b = this.state.bases;
    const ok = kind === 'sac' ? (b[1] || b[2]) && !b[3] && this.state.outs === 0 : !b[3];
    this.bunting = ok && this.state.strikes < 2 ? kind : null;
    if (this.bunting) paBunt = true;
    if (this.bunting === 'sac') this.buntDefense();
  };
  const fp = g.finishPlay.bind(g);
  g.finishPlay = function () {
    const res = this.play.result;
    if (this.batted && this.batted.bunt && !this.play.steal) {
      if (res.foul) inc('foul (in play)');
      else {
        const before = this.log.length;
        fp();
        const t = this.log[before]?.text || '';
        if (/sacrifice bunt/.test(t)) inc(kind === 'hit' ? 'groundout (runner adv)' : 'sacrifice');
        else if (/bunts for/.test(t)) inc('bunt hit');
        else if (/pops out/.test(t)) inc('popout ' + t.split(' to ')[1]?.slice(0, 3) + ' LA' + Math.round(this.batted.la / 10) * 10);
        else if (/double play/.test(t)) inc('DP');
        else if (/fielder's choice/.test(t)) inc('FC (lead runner out)');
        else if (/error/.test(t)) inc('error');
        else if (/grounds out/.test(t)) inc('groundout'); else inc('other: ' + t.slice(0, 60));
        return;
      }
    }
    return fp();
  };
  const so = g.strikeout.bind(g);
  g.strikeout = function (how) { if (this.bunting) inc('strikeout'); return so(how); };
  g.simToEnd();
}
console.log(kind, out);
