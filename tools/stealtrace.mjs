import { Game } from '../js/sim/game.js';
import { defaultTeams } from '../js/data/teams.js';
const teams = defaultTeams();
const g = new Game(teams[0], teams[1], { seed: 9 });
g.simUntil(() => g.phase === 'preAB');
g.state.bases[1] = g.offense.lineup[(g.offense.idx + 3) % 9];
const r = g.state.bases[1];
g.decideSteal = function () { return this.makeStealers([1], false); };
g.swingOverride = true;
const origRel = g.releasePitch.bind(g);
g.releasePitch = function () { origRel(); this.swing = false; console.log('release at stealer s=', this.stealers?.[0].s.toFixed(2)); };
g.onEvent = (e) => { if (['steal','out','throw','stealResult'].includes(e.type)) console.log(`[${g.play ? g.play.t.toFixed(2) : '-'}] ${e.type} ${e.from||''}->${e.to||''} ${e.how||''}`); };
console.log('runner', r.name, 'speed', r.speed, 'catcher arm', g.defenseSide.defense.C.arm, 'margin est', g.stealMargin(r, 1, g.defenseSide.pitcher, g.defenseSide.defense.C).toFixed(2));
g.simUntil(() => g.phase === 'play');
const p = g.play;
const run = p.runners[0];
console.log('at catch: runner s', run.s.toFixed(2), 'v', run.v.toFixed(2), 'goal', run.goalS.toFixed(1), 'catcher transfer', p.holder.transfer.toFixed(2));
let next = 0;
while (!p.done && p.t < 10) { p.step(1/200); if (p.t >= next) { next += 0.25; const cov = p.plan.covers[2]; console.log(`t=${p.t.toFixed(2)} run s=${run.s.toFixed(1)} goal=${run.goalS.toFixed(1)} out=${run.out} holder=${p.holder?.pos||'-'} thr=${p.throwInfo?p.throwInfo.base:'-'} cover ${cov.pos} d2B=${Math.hypot(cov.x-0, cov.y-38.79).toFixed(1)} ball=(${p.ball.p.x.toFixed(1)},${p.ball.p.y.toFixed(1)},${p.ball.p.z.toFixed(1)})`); } }
