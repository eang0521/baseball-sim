import { Game } from '../js/sim/game.js';
import { Play } from '../js/sim/play.js';
import { defaultTeams } from '../js/data/teams.js';
import { battedBallVector } from '../js/sim/atbat.js';
import { makeBall } from '../js/sim/physics.js';
const [ev, la, spray, pos] = [+process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const teams = defaultTeams();
const g = new Game(teams[0], teams[1], { seed: 5 });
g.startHalfInning();
g.state.batter = g.offense.lineup[0];
g.resetPositions();
const bb = { ev, la, spray, type: 'ground', bunt: !!process.env.BUNT };
const { v, w } = battedBallVector(bb);
Object.assign(g.world.ball.phys, makeBall({ x: 0, y: 0.55, z: 0.9 }, v, w));
g.onEvent = () => {};
const p = new Play(g, bb);
const f = p.fielders.find(q => q.pos === pos);
console.log('start', f.x.toFixed(2), f.y.toFixed(2), 'react', f.react.toFixed(2), 'chaser', p.plan.chaser.pos);
let next = 0;
while (!p.done && p.t < 3.2) {
  p.step(1/200);
  if (p.t >= next) { next += 0.2;
    const b = p.ball.p; const d = Math.hypot(b.x-f.x, b.y-f.y);
    console.log(`t=${p.t.toFixed(2)} f=(${f.x.toFixed(2)},${f.y.toFixed(2)}) role=${f.role} tgt=(${f.target.x.toFixed(1)},${f.target.y.toFixed(1)}) spd=${f.spd.toFixed(1)} ball=(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(2)}) v=${Math.hypot(p.ball.v.x,p.ball.v.y).toFixed(1)} d=${d.toFixed(2)} holder=${p.holder?.pos} stun=${f.stun.toFixed(2)} cool=${f.cool.toFixed(2)}`);
  }
}
