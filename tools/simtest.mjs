import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const N = +process.argv[2] || 20;
const teams = defaultTeams();
const tot = { pa:0, ab:0, h:0, d:0, t:0, hr:0, bb:0, so:0, hbp:0, sf:0, sh:0, sb:0, cs:0, r:0, games:0, pitches:0, e:0, innings:0, spIP:0 };
const kinds = {};
const M = {};
const BT = {}; const ERR = {}; const GH = {};
const t0 = Date.now();
const reasons = {};
for (let i = 0; i < N; i++) {
  const g = new Game(teams[i % 4], teams[(i + 1) % 4], { seed: 1000 + i });
  const origFinish = g.finishPlay.bind(g);
  g.finishPlay = function () {
    const r = this.play.reason; reasons[r] = (reasons[r]||0)+1;
    const res = this.play.result; const t = this.batted.type;
    if (!res.foul && !res.hr) {
      BT[t] = BT[t] || { n: 0, h: 0, e: 0 };
      BT[t].n++;
      if (!res.batterOut && !res.errors.length && !res.outs.some(o=>o.how==='force')) { BT[t].h++; const k=t+'-'+(res.chain[0]||'none')+(res.chain.length>1?'-thrown':''); GH[k]=(GH[k]||0)+1; const evb=t+'-ev'+Math.floor(this.batted.ev/10)*10; GH[evb]=(GH[evb]||0)+1; }
      if (res.batterOut) { const ko='OUT-'+t+'-'+(res.chain[0]||'x')+(res.flyCaught?'-air':''); GH[ko]=(GH[ko]||0)+1; }
      const evn=t+'-n-ev'+Math.floor(this.batted.ev/10)*10; GH[evn]=(GH[evn]||0)+1;
      if (res.errors.length) { BT[t].e++; for (const e of res.errors) ERR[e.pos + (e.throwing?'-thr':'')] = (ERR[e.pos + (e.throwing?'-thr':'')]||0)+1; }
    }
    return origFinish();
  };
  g.simToEnd();
  if (!g.over) { console.log('game did not finish', i, g.phase, g.state); continue; }
  tot.games++;
  tot.innings += g.state.inning;
  for (const sd of g.sides) {
    for (const b of sd.bat.values()) for (const k of ['pa','ab','h','d','t','hr','bb','so','hbp','sf','sh','sb','cs','r']) tot[k] += b[k];
    for (const p of sd.pit.values()) tot.pitches += p.pc;
    tot.spIP += sd.pit.get(sd.used[0].id).outs / 3;
  }
  tot.e += g.state.errors[0] + g.state.errors[1];
  for (const [k,v] of Object.entries(g.metrics)) M[k]=(M[k]||0)+v;
  for (const l of g.log) kinds[l.kind] = (kinds[l.kind]||0)+1;
  if (i === 0 && process.argv[3]) console.log(g.log.slice(0, 60).map(l => l.text).join('\n'));
}
const ms = Date.now() - t0;
const avg = tot.h / tot.ab, obp = (tot.h + tot.bb + tot.hbp) / (tot.ab + tot.bb + tot.hbp + tot.sf);
const slg = (tot.h + tot.d + 2 * tot.t + 3 * tot.hr) / tot.ab;
console.log(`\n${tot.games} games in ${ms}ms`);
console.log(`R/G/team ${(tot.r / tot.games / 2).toFixed(2)}  AVG ${avg.toFixed(3)} OBP ${obp.toFixed(3)} SLG ${slg.toFixed(3)}`);
console.log(`K% ${(100*tot.so/tot.pa).toFixed(1)} BB% ${(100*tot.bb/tot.pa).toFixed(1)} HR% ${(100*tot.hr/tot.pa).toFixed(2)} HBP% ${(100*tot.hbp/tot.pa).toFixed(2)}`);
console.log(`SB/G ${(tot.sb/tot.games/2).toFixed(2)} CS/G ${(tot.cs/tot.games/2).toFixed(2)} SB% ${(100*tot.sb/Math.max(1,tot.sb+tot.cs)).toFixed(0)} SH/G ${(tot.sh/tot.games/2).toFixed(2)} SP IP ${(tot.spIP/tot.games/2).toFixed(2)}`);
console.log(`2B/G ${(tot.d/tot.games/2).toFixed(2)} 3B/G ${(tot.t/tot.games/2).toFixed(2)} E/G ${(tot.e/tot.games/2).toFixed(2)} P/PA ${(tot.pitches/tot.pa).toFixed(2)} PA/G ${(tot.pa/tot.games/2).toFixed(1)}`);
const fair = M.bip - M.foulBip;
console.log(`Zone% ${(100*M.zone/M.pitches).toFixed(1)} Swing% ${(100*M.swings/M.pitches).toFixed(1)} Z-Swing% ${(100*M.zswing/M.zone).toFixed(1)} O-Swing% ${(100*M.oswing/(M.pitches-M.zone)).toFixed(1)} Whiff/Swing ${(100*M.whiff/M.swings).toFixed(1)} Foul/contact ${(100*(M.foulBip+M.foulTip)/(M.swings-M.whiff)).toFixed(1)}`);
console.log(`avgEV ${(M.ev/M.bip).toFixed(1)} GB ${(100*M.ground/M.bip).toFixed(1)} LD ${(100*M.line/M.bip).toFixed(1)} FB ${(100*M.fly/M.bip).toFixed(1)} PU ${(100*M.popup/M.bip).toFixed(1)} BABIP ${((tot.h-tot.hr)/(tot.ab-tot.so-tot.hr+tot.sf)).toFixed(3)} innings/G ${(tot.innings/tot.games).toFixed(1)}`);
if (process.argv[3]) console.log('kinds', kinds, 'reasons', reasons);
console.log('BABIP by type', Object.entries(BT).map(([k,v])=>`${k}: ${(v.h/v.n).toFixed(3)} (n=${v.n}, err ${v.e})`).join('  '));
console.log('errors', ERR);
console.log(Object.entries(GH).sort().map(e=>e.join(':')).join('  '));
