import { Game } from '../js/sim/game.js';
import { Play } from '../js/sim/play.js';
import { defaultTeams } from '../js/data/teams.js';
import { battedBallVector } from '../js/sim/atbat.js';
import { makeBall } from '../js/sim/physics.js';
const [ev, la, spray, b1, b2, b3, outs] = process.argv.slice(2).map(Number);
const teams = defaultTeams();
const g = new Game(teams[0], teams[1], { seed: 5 });
g.stepFixed = g.stepFixed; // noop
g.startHalfInning();
const s = g.state;
const L = g.offense.lineup;
s.bases = [null, b1 ? L[5] : null, b2 ? L[6] : null, b3 ? L[7] : null];
s.outs = outs || 0;
s.batter = L[0];
g.resetPositions();
const bb = { ev, la, spray, type: la < 10 ? 'ground' : 'line' };
const { v, w } = battedBallVector(bb);
Object.assign(g.world.ball.phys, makeBall({ x: 0, y: 0.55, z: 0.9 }, v, w));
g.onEvent = (e) => { if (e.type !== 'pitch') console.log(`  [${p.t.toFixed(2)}] event`, e.type, e.how || '', e.runner?.name || '', e.from||'', e.to||'', e.base ?? ''); };
const p = new Play(g, bb);
console.log('chaser', p.plan.chaser?.pos, 'ci', p.plan.ci && { t: p.plan.ci.t.toFixed(2), x: p.plan.ci.x.toFixed(1), y: p.plan.ci.y.toFixed(1), air: p.plan.ci.air, m: p.plan.ci.margin.toFixed(2) });
let next = 0;
while (!p.done && p.t < 30) {
  p.step(1 / 200);
  if (p.t >= next) {
    next += 0.5;
    const rs = p.runners.map((r) => `${r.origin}:s=${r.s.toFixed(1)}->${r.goalS.toFixed(1)}${r.out ? 'OUT' : ''}${r.scored ? 'SC' : ''}`).join(' ');
    const b = p.ball.p;
    console.log(`t=${p.t.toFixed(2)} ball(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}) holder=${p.holder?.pos || '-'} thr=${p.throwInfo ? p.throwInfo.base : '-'} | ${rs}`);
  }
}
console.log('reason', p.reason, 'runs', p.result?.runs?.length, 'outs', p.result?.outs?.map(o => o.how), 'batterBase', p.result?.batterBase, 'chain', p.result?.chain);
