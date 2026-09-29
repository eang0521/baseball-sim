// Live-ball play simulation: fielders chase, catch and throw; runners run the bases.
import {
  BASE_DIST, BASES, inPlayArea, isFairAngle, POS_NUM,
} from './field.js';
import { stepBall, predictTrajectory, aimThrow, carryDistance } from './physics.js';
import {
  fielderVmax, runnerVmax, armSpeed, runTime, moveToward, FIELDER_ACCEL, RUNNER_ACCEL,
} from './entities.js';

const BD = BASE_DIST;
const LEADS = [0, 4.2, 5.8, 3.6]; // secondary leads at contact
const INFIELD = new Set(['P', 'C', '1B', '2B', '3B', 'SS']);
const accOf = (f) => (INFIELD.has(f.pos) ? FIELDER_ACCEL : 5.8);

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function baseDist(ax, ay, b) {
  const p = BASES[b % 4];
  return Math.hypot(ax - p.x, ay - p.y);
}

export class Play {
  // opts.steal: runners are stealing and the catcher has the ball (no batted ball)
  // opts.runnerState: Map(player -> { s, v }) for runners already moving at contact
  constructor(game, batted, opts = {}) {
    this.g = game;
    this.rng = game.rng;
    this.ball = game.world.ball.phys;
    this.steal = !!opts.steal;
    this.batted = batted || { ev: 0, la: 0, spray: 0, type: 'steal' };
    batted = this.batted;
    this.bunt = !!batted.bunt;
    this.t = 0;
    this.fielders = game.world.fielders;
    this.outsBefore = game.state.outs;
    this.outs = [];
    this.runs = [];
    this.errors = [];
    this.chain = [];
    this.holder = null;
    this.throwInfo = null;
    this.fair = null;
    this.touched = false;
    this.batAir = true; // batted ball hasn't touched the ground yet
    this.ballAir = true; // ball hasn't bounced since last hit/throw
    this.flyCaught = false;
    this.hr = false;
    this.groundRule = false;
    this.done = false;
    this.ending = null;
    this.quiet = 0;
    this.replanT = 0;
    this.reevalT = 0;
    this.plan = null;
    this.firstLanding = null;
    this.trot = false;
    this.maxDepth = 0;

    for (const f of this.fielders) {
      f.role = 'hold';
      f.target = { x: f.x, y: f.y };
      f.react = 0.06 + (100 - (f.player.fielding ?? 50)) * 0.002 + (f.pos === 'P' && !this.bunt ? 0.3 : 0) +
        (INFIELD.has(f.pos) ? 0 : 0.35 + (batted.la < 25 ? 0.22 : 0.1));
      if (this.bunt && ['1B', '3B', 'P', 'C'].includes(f.pos)) {
        // a sacrifice is expected; a bunt for a hit catches the defense by surprise
        f.react = batted.buntKind === 'sac' ? 0.08 : f.pos === 'P' ? 0.38 : 0.28;
      }
      f.cool = 0;
      f.stun = 0;
      f.dived = false;
      f.transfer = 0;
      f.carryTo = null;
      f.hasBall = false;
      f.prevBallDist = Infinity;
      f.spd = 0;
    }

    // Runners: batter + those on base
    this.runners = [];
    const bases = game.state.bases;
    for (let k = 3; k >= 1; k--) {
      if (bases[k]) this.runners.push(this.makeRunner(bases[k], k));
    }
    for (const r of this.runners) {
      // on a bunt, runners wait to see the ball go down
      r.v = this.bunt ? 1.0 : 2.0;
      if (this.bunt) r.delay = 0.1;
      const st = opts.runnerState && opts.runnerState.get(r.player);
      if (st) {
        r.s = st.s;
        r.v = st.v;
        r.stealing = true;
        this.placeRunner(r);
      }
    }
    if (!this.steal) {
      this.batterRunner = this.makeRunner(game.state.batter, 0);
      this.batterRunner.delay = this.bunt ? (batted.buntKind === 'hit' ? 0 : 0.12) : 0.3;
      if (batted.buntKind === 'hit') this.batterRunner.v = 2.5; // already moving out of the box
      this.runners.push(this.batterRunner);
    } else {
      this.batterRunner = null;
    }
    // order: most advanced first
    this.runners.sort((a, b) => b.origin - a.origin);
    game.world.runners = this.runners;

    if (this.steal) {
      this.setupSteal(opts);
      return;
    }
    this.distance = carryDistance(this.ball);
    this.replan();
    this.initialRunnerDecisions();
  }

  setupSteal(opts) {
    this.distance = 0;
    this.touched = true;
    this.batAir = false;
    this.ballAir = false;
    this.fair = 'fair';
    const by = this.fielderByPos;
    const c = by.C;
    this.holder = c;
    c.hasBall = true;
    c.react = 0;
    // exchange time: glove to hand, set and throw
    c.transfer = 0.78 - (c.player.arm ?? 50) * 0.0018 - (c.player.fielding ?? 50) * 0.0012 + this.rng.gauss(0, 0.08);
    c.decideAt = this.t + c.transfer;
    const lefty = opts.batterSide === 'L';
    const covers = { 1: by['1B'], 2: lefty ? by.SS : by['2B'], 3: by['3B'], 4: c };
    this.plan = { chaser: null, ci: null, covers, icpts: new Map() };
    for (const f of this.fielders) {
      f.react = 0.15;
      const cov = Object.entries(covers).find(([, cf]) => cf === f);
      if (cov && f !== c) {
        const bp = BASES[+cov[0] % 4];
        f.role = 'cover';
        f.target = { x: bp.x - bp.x * 0.012, y: bp.y - bp.y * 0.012 };
      } else if (f.pos === 'SS' || f.pos === '2B') {
        // the other middle infielder backs up the throw
        f.role = 'backup';
        f.target = { x: BASES[2].x + (f.pos === 'SS' ? -3 : 3), y: BASES[2].y + 5 };
      } else if (f.pos === 'CF') {
        f.role = 'backup';
        f.target = { x: 0, y: 60 };
      } else {
        f.role = 'hold';
        f.target = { x: f.x, y: f.y };
      }
    }
    for (const r of this.runners) {
      if (r.stealing) r.goalS = (r.origin + 1) * BD;
      else r.goalS = r.origin * BD;
    }
    this.enforceSpacing();
  }

  makeRunner(player, origin) {
    const s = origin * BD + (origin > 0 ? LEADS[origin] : 0);
    const e = {
      player, origin, s, v: 0, goalS: origin === 0 ? BD : origin * BD, vmax: runnerVmax(player),
      delay: 0, out: false, scored: false, mustRetouch: false, touched: origin, lastDir: 1,
      decided: {}, isBatter: origin === 0, x: 0, y: 0, facing: 0, anim: 'run', outT: 0,
    };
    this.placeRunner(e);
    return e;
  }

  placeRunner(r) {
    const s = Math.max(0, Math.min(4 * BD, r.s));
    const seg = Math.min(3, Math.floor(s / BD));
    const t = (s - seg * BD) / BD;
    const a = BASES[seg], b = BASES[(seg + 1) % 4];
    r.x = a.x + (b.x - a.x) * t;
    r.y = a.y + (b.y - a.y) * t;
    const dir = r.goalS >= r.s ? 1 : -1;
    r.facing = Math.atan2((b.x - a.x) * dir, (b.y - a.y) * dir);
  }

  get fielderByPos() {
    const m = {};
    for (const f of this.fielders) m[f.pos] = f;
    return m;
  }

  active(r) {
    return !r.out && !r.scored;
  }

  // ---- forced runners ----
  isForced(r) {
    if (this.flyCaught) return false;
    if (r.isBatter) return true;
    // forced if the runner behind (origin - 1) exists, is forced, and not out
    const behind = this.runners.find((q) => q.origin === r.origin - 1);
    if (!behind || behind.out) return false;
    return this.isForced(behind);
  }

  runnerAhead(r) {
    let best = null;
    for (const q of this.runners) {
      if (q.origin > r.origin && this.active(q) && (!best || q.origin < best.origin)) best = q;
    }
    return best;
  }

  maxGoalBase(r) {
    const a = this.runnerAhead(r);
    if (!a) return 4;
    return Math.ceil(a.goalS / BD - 0.001) - 1;
  }

  setGoal(r, base) {
    const mx = this.maxGoalBase(r);
    const b = Math.min(base, mx);
    r.goalS = Math.max(b, r.mustRetouch ? r.origin : 0) * BD;
    if (b < base) return false;
    return true;
  }

  // ---- estimates ----
  throwTime(from, to, f) {
    const d = dist(from, to);
    return d / (armSpeed(f.player) * (d > 45 ? 0.78 : 0.88)) + 0.1;
  }

  ballETA(b) {
    const bp = BASES[b % 4];
    if (this.holder) {
      const h = this.holder;
      const base = Math.max(0, h.transfer);
      if (dist(h, bp) < 1) return base;
      const rt = runTime(dist(h, bp), fielderVmax(h.player), FIELDER_ACCEL);
      return base + Math.min(rt, this.throwTime(h, bp, h));
    }
    if (this.throwInfo) {
      const ti = this.throwInfo;
      const remain = Math.max(0, ti.eta - this.t);
      if (ti.base === b) return remain;
      return remain + 0.6 + this.throwTime(BASES[ti.base % 4], bp, ti.rec);
    }
    const p = this.plan;
    if (!p || !p.chaser) return 99;
    const tInt = Math.max(0, p.ci.tAbs - this.t);
    return tInt + 0.3 + 0.55 + this.throwTime(p.ci, bp, p.chaser);
  }

  runnerETA(r, b) {
    const d = Math.abs(b * BD - r.s);
    const forward = b * BD >= r.s;
    const v0 = forward === (r.goalS >= r.s) ? r.v : 0;
    return r.delay + runTime(d, r.vmax, RUNNER_ACCEL, v0);
  }

  decideAdvance(r, nb, extra = 0) {
    if (nb > 4) return false;
    if (nb > this.maxGoalBase(r)) return false;
    if (this.isForced(r) && nb === r.origin + 1) return true;
    const margin = this.ballETA(nb) - this.runnerETA(r, nb);
    const outs = this.outsBefore + this.outs.length;
    let thr = 0.35 + (nb === 4 ? 0.2 : 0) + (nb === 3 ? 1.1 : 0) + (nb === 2 ? 0.55 : 0) - (outs === 2 ? 0.3 : 0);
    thr -= ((r.player.speed ?? 50) - 50) * 0.004;
    thr += this.rng.gauss(0, 0.22) + extra;
    return margin > thr;
  }

  // ---- fielding plan ----
  intercept(f, traj) {
    const vmax = fielderVmax(f.player);
    let last = null;
    for (const s of traj.samples) {
      if (!inPlayArea(s.x, s.y)) continue;
      last = s;
      if (s.air ? s.z > 2.75 : s.z > 1.6) continue;
      const reach = s.air ? 0.95 : INFIELD.has(f.pos) ? 0.9 : 0.7;
      const d = Math.max(0, Math.hypot(s.x - f.x, s.y - f.y) - reach);
      const tr = Math.max(0, f.react) + runTime(d, vmax, accOf(f), f.spd);
      if (tr <= s.t) return { t: s.t, x: s.x, y: s.y, air: s.air, margin: s.t - tr };
    }
    if (!last) return null;
    // can't cut it off: go to where the ball ends up
    const d = Math.max(0, Math.hypot(last.x - f.x, last.y - f.y) - 0.7);
    const tr = Math.max(0, f.react) + runTime(d, vmax, accOf(f), f.spd * 0.5);
    return { t: Math.max(last.t, tr), x: last.x, y: last.y, air: false, margin: last.t - tr };
  }

  replan() {
    const traj = predictTrajectory(this.ball, { maxT: 12 });
    this.traj = traj;
    const byPos = this.fielderByPos;
    let chaser = null, ci = null, best = Infinity;
    const icpts = new Map();
    for (const f of this.fielders) {
      if (f.stun > 0.6) continue;
      const it = this.intercept(f, traj);
      if (!it) continue;
      icpts.set(f, it);
      let pen = 0;
      if (f.pos === 'P' && !this.bunt) pen += 0.45;
      if (f.pos === 'C' && Math.hypot(it.x, it.y) > 14) pen += 0.4;
      // outfielders call off infielders on catchable flies
      if (it.air && !INFIELD.has(f.pos) && Math.hypot(it.x, it.y) > 45) pen -= 0.3;
      // stick with the current chaser unless someone is clearly better
      if (this.plan && this.plan.chaser === f && it.margin > -0.15) pen -= 0.45;
      if (it.t + pen < best) {
        best = it.t + pen;
        chaser = f;
        ci = it;
      }
    }
    if (ci) ci.tAbs = this.t + ci.t;

    const covers = {};
    const taken = new Set();
    if (chaser) taken.add(chaser);
    const pickCover = (...cands) => {
      for (const p of cands) {
        const f = byPos[p];
        if (f && !taken.has(f) && f !== this.holder) {
          taken.add(f);
          return f;
        }
      }
      return null;
    };
    const left = ci ? ci.x < 0 : true;
    if (this.bunt && this.batted.buntKind === 'sac') {
      covers[1] = pickCover('2B', '1B');
      covers[2] = pickCover('SS', '2B');
      covers[3] = pickCover('3B', 'SS', 'P');
      covers[4] = pickCover('C', 'P');
    } else {
      covers[1] = pickCover('1B', 'P', '2B');
      covers[2] = left ? pickCover('2B', 'SS') : pickCover('SS', '2B');
      covers[3] = pickCover('3B', 'SS', 'P');
      covers[4] = pickCover('C', 'P');
    }
    this.plan = { chaser, ci, covers, icpts };

    for (const f of this.fielders) {
      if (f === this.holder) continue;
      if (f === chaser) {
        f.role = 'chase';
        f.target = { x: ci.x, y: ci.y };
        continue;
      }
      const cov = Object.entries(covers).find(([, cf]) => cf === f);
      if (cov) {
        const b = +cov[0];
        f.role = 'cover';
        f.coverBase = b;
        const bp = BASES[b % 4];
        // stand just off the bag on the side the ball will come from
        const from = ci || { x: 0, y: 40 };
        const dx = from.x - bp.x, dy = from.y - bp.y;
        const d = Math.hypot(dx, dy) || 1;
        f.target = { x: bp.x + (dx / d) * 0.5, y: bp.y + (dy / d) * 0.5 };
        continue;
      }
      if (!INFIELD.has(f.pos) && chaser && ci) {
        const it = icpts.get(f);
        if (it && it.t < ci.t + 2.2) {
          // back up the play
          const r = Math.hypot(ci.x, ci.y) || 1;
          f.role = 'backup';
          f.target = { x: ci.x + (ci.x / r) * 7, y: ci.y + (ci.y / r) * 7 };
          continue;
        }
      }
      if (f.pos === 'P') {
        f.role = 'backup';
        f.target = { x: 0, y: 10 };
        continue;
      }
      if (f.pos === 'SS' || f.pos === '2B') {
        // cutoff man on balls to the outfield
        if (ci && Math.hypot(ci.x, ci.y) > 50) {
          f.role = 'cutoff';
          f.target = { x: ci.x * 0.55, y: ci.y * 0.55 };
          continue;
        }
      }
      f.role = 'hold';
      f.target = { x: f.x, y: f.y };
    }
  }

  // ---- initial runner behavior ----
  initialRunnerDecisions() {
    const ci = this.plan.ci;
    const catchable = ci && ci.air && ci.margin > -0.05;
    const la = this.batted.la;
    const twoOuts = this.outsBefore === 2;
    this.catchableAtStart = catchable;
    for (const r of this.runners) {
      if (r.isBatter) continue;
      const forced = this.isForced(r);
      if (twoOuts) {
        this.setGoal(r, r.origin + 1);
        continue;
      }
      if (catchable) {
        if (la < 18) {
          r.goalS = r.s; // freeze on a liner
          r.freeze = true;
        } else {
          const depth = Math.hypot(ci.x, ci.y);
          if (r.origin === 3 || (r.origin === 2 && depth > 78 && ci.x > -20)) {
            r.goalS = r.origin * BD; // tag up
            r.tagging = true;
          } else {
            const depth2 = Math.hypot(ci.x, ci.y);
            const easy = ci.margin > 1.2 || depth2 < 50;
            const off = easy ? 2.0 : Math.min(forced ? 12 : 9, Math.max(3, depth2 * 0.1));
            r.goalS = r.origin * BD + off;
            r.halfway = true;
          }
        }
        continue;
      }
      if (forced || r.stealing) {
        this.setGoal(r, r.origin + 1);
        continue;
      }
      if (this.bunt) {
        if (r.origin < 3) this.setGoal(r, r.origin + 1);
        else r.goalS = r.origin * BD;
        continue;
      }
      const grounder = la < 10 && ci && INFIELD.has(this.plan.chaser.pos);
      if (grounder) {
        if (r.origin === 2 && ci.x > 3) this.setGoal(r, 3);
        else if (r.origin === 3 && this.decideAdvance(r, 4, 0.2)) this.setGoal(r, 4);
        else r.goalS = r.origin * BD;
      } else {
        this.setGoal(r, r.origin + 1);
      }
    }
    // runners behind must respect those ahead
    this.enforceSpacing();
  }

  enforceSpacing() {
    for (const r of this.runners) {
      if (!this.active(r)) continue;
      const mx = this.maxGoalBase(r);
      if (r.goalS > mx * BD + 0.01) r.goalS = Math.max(mx, 0) * BD;
    }
  }

  ballLanded() {
    // uncaught batted ball: everyone re-evaluates
    for (const r of this.runners) {
      if (!this.active(r) || r.isBatter) continue;
      r.freeze = false; r.halfway = false; r.tagging = false;
      const forced = this.isForced(r);
      const nb = Math.max(r.origin + 1, Math.ceil(r.goalS / BD - 0.001));
      if (forced || this.decideAdvance(r, nb, -0.1)) this.setGoal(r, nb);
      else if (r.goalS % BD !== 0) this.setGoal(r, Math.round(r.s / BD));
    }
    this.enforceSpacing();
  }

  flyCaughtBy(f) {
    this.flyCaught = true;
    this.recordOut(this.batterRunner, 'fly', f);
    if (this.done) return;
    for (const r of this.runners) {
      if (!this.active(r) || r.isBatter) continue;
      r.freeze = false; r.halfway = false;
      if (r.scored) continue;
      if (r.s > r.origin * BD + 0.3 || r.touched > r.origin) {
        r.mustRetouch = true;
        r.goalS = r.origin * BD;
      } else {
        r.goalS = r.origin * BD;
        r.tagging = true;
        r.tagDecideT = this.t + 0.05;
      }
    }
  }

  // ---- outs / runs ----
  recordOut(r, how, f) {
    if (r.out || r.scored) return;
    r.out = true;
    r.outT = 0;
    r.v = 0;
    const beforeFirst = r.isBatter && r.touched < 1;
    this.outs.push({ runner: r, how, t: this.t, fielder: f ? f.pos : null, base: how === 'fly' ? null : this.outBase(r), beforeFirst });
    if (f) this.pushChain(f);
    this.g.onEvent({ type: 'out', how, runner: r.player });
    if (this.outsBefore + this.outs.length >= 3) this.finish('threeOuts');
    this.enforceSpacing();
  }

  outBase(r) {
    return Math.round(r.goalS / BD);
  }

  pushChain(f) {
    const n = POS_NUM[f.pos];
    if (this.chain[this.chain.length - 1] !== n) this.chain.push(n);
  }

  // ---- ball possession ----
  gainBall(f, wasAir) {
    this.touchCheckFair();
    if (this.done) return;
    const isThrow = !!this.throwInfo;
    this.holder = f;
    f.hasBall = true;
    f.heldT = 0;
    this.throwInfo = null;
    this.pushChain(f);
    f.anim = 'catch';
    f.animT = 0;
    if (!isThrow && wasAir && this.batAir && !this.touched) {
      this.touched = true;
      this.flyCaughtBy(f);
      f.transfer = 0.75;
    } else {
      if (!this.touched && this.batAir === false && !this.firstLanding) this.firstLanding = { x: this.ball.p.x, y: this.ball.p.y };
      this.touched = true;
      const fld = f.player.fielding ?? 50;
      f.transfer = isThrow ? 0.32 - fld * 0.0012 : INFIELD.has(f.pos) ? 0.62 - fld * 0.0028 : 0.85 - fld * 0.002;
    }
    f.decideAt = this.t + Math.max(0, f.transfer - 0.05);
    this.checkBaseOuts();
  }

  touchCheckFair() {
    if (this.fair || this.touched || this.throwInfo) return;
    const { x, y } = this.ball.p;
    this.fair = isFairAngle(x, y) || y > 0.3 && Math.abs(x) <= y + 0.3 ? 'fair' : 'foul';
    if (this.fair === 'foul' && !this.batAir) this.finish('foul');
  }

  attempt(f, kind, air) {
    const fld = f.player.fielding ?? 50;
    const b = this.ball;
    const sp = Math.hypot(b.v.x, b.v.y, b.v.z);
    let p;
    let runPen = 0;
    if (this.throwInfo) p = kind === 'dive' ? 0.4 : 0.992;
    else if (kind === 'dive') p = 0.32 + fld * 0.0042;
    else if (air) {
      p = 0.993 + fld * 0.00005 - Math.max(0, sp - 34) * 0.006;
      // catches made on a full sprint are far from automatic
      runPen = Math.min(0.6, Math.max(0, f.spd - 3) * 0.15) * (1.25 - fld / 200);
      p -= runPen;
    }
    else p = 0.977 + fld * 0.0002 - Math.max(0, sp - 30) * 0.007;
    if (this.rng.chance(p)) {
      if (kind === 'dive') f.stun = 0.8;
      f.anim = kind === 'dive' ? 'dive' : 'catch';
      f.animT = 0;
      this.gainBall(f, air);
      return true;
    }
    this.touchCheckFair();
    if (kind === 'dive') {
      f.stun = 1.3;
      f.anim = 'dive';
      f.animT = 0;
      f.dived = true;
      return false;
    }
    // bobble
    const wasThrow = !!this.throwInfo;
    const tough = !wasThrow && (air ? sp > 30 || runPen > 0.08 : sp > 29);
    if (!tough) this.errors.push({ pos: f.pos, player: f.player, t: this.t });
    if (!this.touched) this.touched = true;
    const a = this.rng.range(0, Math.PI * 2);
    const s = this.rng.range(1.5, 4.5);
    b.v = { x: Math.sin(a) * s, y: Math.cos(a) * s, z: this.rng.range(0.5, 2) };
    b.w = { x: 0, y: 0, z: 0 };
    b.rolling = false;
    b.stopped = false;
    b.p.z = Math.max(b.p.z, 0.4);
    this.throwInfo = null;
    this.ballAir = false;
    this.batAir = false;
    f.cool = 0.5;
    this.replan();
    return false;
  }

  // ---- throwing ----
  coverer(b, exclude) {
    const c = this.plan && this.plan.covers[b];
    if (c && c !== exclude && !c.hasBall) return c;
    let best = null, bd = Infinity;
    for (const f of this.fielders) {
      if (f === exclude) continue;
      const d = baseDist(f.x, f.y, b);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  holderDecide(h) {
    const cands = [];
    const hv = fielderVmax(h.player);
    for (const r of this.runners) {
      if (!this.active(r)) continue;
      let b;
      if (r.mustRetouch && r.s > r.origin * BD + 0.05) b = r.origin;
      else if (Math.abs(r.goalS - r.s) > 0.05) b = Math.round(r.goalS / BD);
      else continue;
      if (Math.abs(b * BD - r.goalS) > 0.5 && !r.mustRetouch) continue; // heading to a waiting spot
      const forcedHere = (r.mustRetouch && b === r.origin) || (this.isForced(r) && b === r.origin + 1 && r.goalS >= r.s);
      const bp = BASES[b % 4];
      const rETA = this.runnerETA(r, b);
      const dSelf = dist(h, bp);
      const tSelf = runTime(Math.max(0, dSelf - 0.4), hv, FIELDER_ACCEL);
      const rec = this.coverer(b, h);
      let tThrow = Infinity;
      if (rec) {
        const recT = runTime(Math.max(0, dist(rec, bp) - 0.6), fielderVmax(rec.player), FIELDER_ACCEL);
        tThrow = Math.max(this.throwTime(h, bp, h), recT) + 0.05;
      }
      const self = tSelf < tThrow && (dSelf < 14 || !rec);
      const tBall = self ? tSelf : tThrow;
      const need = forcedHere ? 0.02 : 0.25;
      const margin = rETA - tBall - need;
      cands.push({ r, b, self, rec, margin });
    }
    let best = null, bv = -Infinity;
    const minMargin = this.steal && h.pos === 'C' ? -0.7 : 0.08;
    for (const c of cands) {
      if (c.margin < minMargin) continue;
      // take the sure out unless the lead runner is clearly beaten
      const v = (c.margin > 0.3 ? c.b : 0) + Math.min(c.margin, 1) * 2;
      if (v > bv) { bv = v; best = c; }
    }
    if (best) {
      if (best.self) {
        h.carryTo = best.b;
      } else {
        this.doThrow(h, best.b, best.rec);
      }
      return;
    }
    // nobody to get: keep runners honest
    const moving = this.runners.filter((r) => this.active(r) && Math.abs(r.goalS - r.s) > 0.3 && r.goalS > r.s);
    const far = Math.hypot(h.x, h.y) > 40;
    if (moving.length && far) {
      moving.sort((a, b2) => b2.goalS - a.goalS);
      let b = Math.round(moving[0].goalS / BD);
      if (b >= 4 && this.runnerETA(moving[0], 4) < 1.0) b = moving.length > 1 ? Math.round(moving[1].goalS / BD) : 2;
      b = Math.max(2, Math.min(4, b));
      const rec = this.coverer(b, h);
      if (rec) {
        this.doThrow(h, b, rec, true);
        return;
      }
    }
    if (far && !moving.length) {
      // lob it back to the cutoff man
      const rec = this.coverer(2, h);
      if (rec) this.doThrow(h, 2, rec, true);
    }
  }

  doThrow(h, b, rec, soft = false) {
    const bp = BASES[b % 4];
    const tgt = { x: bp.x + (h.x - bp.x) * 0.02, y: bp.y + (h.y - bp.y) * 0.02, z: b === 4 ? 0.9 : 1.3 };
    const d = dist(h, tgt);
    const fld = h.player.fielding ?? 50;
    let speed = Math.min(armSpeed(h.player), 14 + d * 0.8);
    if (soft) speed *= 0.8;
    const sig = 0.1 + d * 0.009 * (1.35 - fld / 100);
    let ex = this.rng.gauss(0, sig), ey = this.rng.gauss(0, sig * 0.5), ez = this.rng.gauss(0, sig * 0.6);
    if (!soft && this.rng.chance(0.012 * (1.4 - fld / 100))) {
      const a = this.rng.range(0, Math.PI * 2);
      ex += Math.cos(a) * 2.6; ez += Math.abs(Math.sin(a)) * 1.6;
    }
    const aimed = { x: tgt.x + ex, y: tgt.y + ey, z: Math.max(0.2, tgt.z + ez) };
    const p0 = { x: h.x + Math.sin(h.facing) * 0.2, y: h.y + Math.cos(h.facing) * 0.2, z: 1.9 };
    const { v, t: flight } = aimThrow(p0, aimed, speed);
    const ball = this.ball;
    ball.p = p0;
    ball.v = v;
    ball.w = { x: 0, y: 0, z: 0 };
    ball.rolling = false;
    ball.bounces = 0;
    ball.stopped = false;
    this.ballAir = true;
    h.hasBall = false;
    h.cool = 0.45;
    h.anim = 'throw';
    h.animT = 0;
    h.facing = Math.atan2(tgt.x - h.x, tgt.y - h.y);
    this.holder = null;
    this.throwInfo = {
      from: h, rec, base: b, eta: this.t + flight, t0: this.t, target: tgt,
      bad: Math.hypot(ex, ez) > 1.1, dir: { x: (tgt.x - p0.x) / d, y: (tgt.y - p0.y) / d },
    };
    rec.role = 'receive';
    rec.target = { x: tgt.x, y: tgt.y };
    this.g.onEvent({ type: 'throw', from: h.pos, to: rec.pos, base: b });
  }

  // ---- outs at bases / tags ----
  checkBaseOuts() {
    const h = this.holder;
    if (!h) return;
    for (const r of this.runners) {
      if (!this.active(r)) continue;
      // force / retouch outs at a base
      for (let b = 1; b <= 4; b++) {
        if (baseDist(h.x, h.y, b) > 0.9) continue;
        const forcedHere = this.isForced(r) && b === r.origin + 1 && r.s < b * BD - 0.02;
        const retouch = r.mustRetouch && b === r.origin && r.s > b * BD + 0.02;
        if (forcedHere || retouch) {
          this.recordOut(r, retouch ? 'doubled' : 'force', h);
          if (this.done) return;
        }
      }
      // tag outs
      if (!this.active(r)) continue;
      const onBase = Math.abs(r.s - Math.round(r.s / BD) * BD) < 0.35 && Math.round(r.s / BD) > 0;
      const overrun = r.isBatter && r.s >= BD - 0.1 && r.goalS <= BD + 0.01;
      if (onBase || overrun || r.delay > 0) continue;
      if (r.s < 0.5) continue;
      // applying a tag takes a moment after the catch
      if ((h.heldT || 0) >= 0.12 && Math.hypot(r.x - h.x, r.y - h.y) < 1.25) {
        this.recordOut(r, 'tag', h);
        if (this.done) return;
      }
    }
  }

  // ---- main step ----
  step(dt) {
    if (this.done) return;
    this.t += dt;
    const ball = this.ball;

    // Ball
    if (this.holder) {
      const h = this.holder;
      ball.p.x = h.x + Math.sin(h.facing + 0.6) * 0.35;
      ball.p.y = h.y + Math.cos(h.facing + 0.6) * 0.35;
      ball.p.z = 1.2;
    } else if (!this.ending || this.ending === 'hrFlight') {
      const ev = stepBall(ball, dt, { walls: !this.hr });
      if (this.hr) {
        if (ball.p.z < 1.5 || this.t > 30) ball.stopped = true;
      } else {
        this.maxDepth = Math.max(this.maxDepth, Math.hypot(ball.p.x, ball.p.y));
        this.handleBallEvent(ev);
        if (this.done) return;
      }
    }

    // Fair/foul when rolling past the bases
    if (!this.fair && !this.touched && !this.batAir && !this.hr) {
      const { x, y } = ball.p;
      const along = Math.max((x + y) / Math.SQRT2, (y - x) / Math.SQRT2);
      if (along > BD || ball.stopped) {
        this.fair = isFairAngle(x, y) ? 'fair' : 'foul';
        if (this.fair === 'foul') { this.finish('foul'); return; }
      }
    }

    this.stepFielders(dt);
    if (this.done) return;
    this.stepRunners(dt);
    if (this.done) return;

    // replan while loose
    if (!this.holder && !this.throwInfo && !this.hr) {
      this.replanT -= dt;
      if (this.replanT <= 0) {
        this.replan();
        this.replanT = 0.35;
      }
    }

    // throw missed its target?
    if (this.throwInfo && !this.holder) {
      const ti = this.throwInfo;
      const past = (ball.p.x - ti.target.x) * ti.dir.x + (ball.p.y - ti.target.y) * ti.dir.y;
      if (ball.rolling || ball.bounces > 2 || past > 2.0 || this.t > ti.eta + 1.5) {
        if (ti.bad) this.errors.push({ pos: ti.from.pos, player: ti.from.player, t: this.t, throwing: true });
        this.throwInfo = null;
        this.replan();
      }
    }

    this.checkBaseOuts();
    if (this.done) return;
    this.checkEnd(dt);
  }

  handleBallEvent(ev) {
    if (!ev) return;
    const ball = this.ball;
    if (ev === 'bounce') {
      this.ballAir = false;
      if (this.batAir && !this.throwInfo) {
        this.batAir = false;
        this.firstLanding = { x: ball.p.x, y: ball.p.y };
        const { x, y } = ball.p;
        const along = Math.max((x + y) / Math.SQRT2, (y - x) / Math.SQRT2);
        if (!this.touched && along > BD) {
          this.fair = isFairAngle(x, y) ? 'fair' : 'foul';
          if (this.fair === 'foul') { this.finish('foul'); return; }
        }
        if (this.fair !== 'foul') this.ballLanded();
      }
    } else if (ev === 'homerun') {
      if (this.batAir && !this.touched) {
        this.hr = true;
        this.fair = 'fair';
        this.startTrot();
      } else {
        this.groundRuleDouble();
      }
    } else if (ev === 'dead') {
      if (this.fair === 'fair' || this.touched) {
        this.groundRuleDouble();
      } else {
        this.fair = 'foul';
        this.finish('foul');
      }
    } else if (ev === 'wall') {
      if (this.batAir && !this.touched) {
        this.batAir = false;
        this.fair = 'fair';
        this.firstLanding = { x: ball.p.x, y: ball.p.y };
        this.ballLanded();
      }
    }
  }

  startTrot() {
    this.trot = true;
    this.ending = 'hrFlight';
    for (const r of this.runners) {
      if (!this.active(r)) continue;
      r.goalS = 4 * BD;
      r.freeze = r.halfway = r.tagging = r.mustRetouch = false;
      r.vmax = 6.2;
      r.delay = r.isBatter ? 0.8 : 0;
    }
    for (const f of this.fielders) {
      f.role = 'hold';
      f.target = { x: f.x, y: f.y };
    }
    this.g.onEvent({ type: 'homerun' });
  }

  groundRuleDouble() {
    this.groundRule = true;
    this.ending = 'groundRule';
    // award two bases from time of pitch
    const order = [...this.runners].sort((a, b) => b.origin - a.origin);
    for (const r of order) {
      if (!this.active(r)) continue;
      r.goalS = Math.min(4, r.origin + 2) * BD;
      r.freeze = r.halfway = r.tagging = r.mustRetouch = false;
    }
    this.ball.stopped = true;
    this.g.onEvent({ type: 'groundrule' });
  }

  stepFielders(dt) {
    const ball = this.ball;
    const loose = !this.holder && !this.hr && !this.groundRule;
    let attempted = false;
    for (const f of this.fielders) {
      f.animT = (f.animT || 0) + dt;
      if (f.cool > 0) f.cool -= dt;
      if (f.react > 0) { f.react -= dt; f.spd = 0; continue; }
      if (f.stun > 0) { f.stun -= dt; f.spd = 0; continue; }
      const vmax = fielderVmax(f.player);

      if (f === this.holder) {
        f.heldT = (f.heldT || 0) + dt;
        if (f.carryTo != null) {
          const bp = BASES[f.carryTo % 4];
          const rem = moveToward(f, bp.x, bp.y, vmax, FIELDER_ACCEL, dt, 20);
          if (rem < 0.3) {
            f.carryTo = null;
            f.decideAt = this.t + 0.15;
          }
        } else {
          f.spd = 0;
          f.transfer -= dt;
          if (f.transfer <= 0 && this.t >= (f.decideAt ?? 0)) {
            f.decideAt = this.t + 0.2;
            this.holderDecide(f);
          }
        }
        continue;
      }

      // movement
      let tx = f.target.x, ty = f.target.y;
      if (f.role === 'receive' && this.throwInfo) {
        // shade toward the incoming throw near the bag
        const ti = this.throwInfo;
        const bp = BASES[ti.base % 4];
        const px = ball.p.x + ball.v.x * 0.15, py = ball.p.y + ball.v.y * 0.15;
        const dx = px - bp.x, dy = py - bp.y;
        const d = Math.hypot(dx, dy);
        const lim = 1.4;
        tx = bp.x + (d > lim ? (dx / d) * lim : dx) * 0.5;
        ty = bp.y + (d > lim ? (dy / d) * lim : dy) * 0.5;
      }
      if (f.role === 'chase' && loose && !ball.stopped && this.ballAir === false) {
        // track the rolling ball
        // step into the ball's path
        const d = Math.hypot(ball.p.x - f.x, ball.p.y - f.y);
        const v2 = ball.v.x * ball.v.x + ball.v.y * ball.v.y;
        if (v2 < 64) {
          // slow roller: charge it
          tx = ball.p.x + ball.v.x * 0.25; ty = ball.p.y + ball.v.y * 0.25;
        } else if (d < 8) {
          const tt = ((f.x - ball.p.x) * ball.v.x + (f.y - ball.p.y) * ball.v.y) / v2;
          if (tt > 0) { tx = ball.p.x + ball.v.x * tt; ty = ball.p.y + ball.v.y * tt; } else { tx = ball.p.x; ty = ball.p.y; }
        }
      }
      if (f.role === 'chase' && ball.stopped) { tx = ball.p.x; ty = ball.p.y; }
      moveToward(f, tx, ty, vmax, accOf(f), dt, f.role === 'chase' ? 30 : 9);

      // try to catch / field
      if (!loose || attempted || f.cool > 0) continue;
      const dxy = Math.hypot(ball.p.x - f.x, ball.p.y - f.y);
      const z = ball.p.z;
      const air = this.ballAir;
      const bsp = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
      let reach = (air ? 1.0 : INFIELD.has(f.pos) ? 1.0 : 0.8) *
        (this.throwInfo ? 1.2 : Math.max(0.55, Math.min(1, 1.35 - bsp / 75)));
      if (f.pos === 'P' && !this.throwInfo && !this.bunt) reach *= 0.6;
      const zOk = air ? z > 0.05 && z < 2.9 : z < 1.5;
      if (this.throwInfo && this.throwInfo.from === f) { f.prevBallDist = dxy; continue; }
      // a bunt pushed down into the ground can't be caught on the fly
      if (this.bunt && this.batAir && this.batted.la < 15) { f.prevBallDist = dxy; continue; }
      if (dxy < reach && zOk) {
        attempted = true;
        this.attempt(f, 'normal', air);
      } else if (f.role === 'chase' && !this.throwInfo && !f.dived && dxy < 2.3 && z < 2.3 &&
        dxy > f.prevBallDist && f.prevBallDist < 2.3) {
        attempted = true;
        this.attempt(f, 'dive', air);
      }
      f.prevBallDist = dxy;
      if (this.done) return;
    }
  }

  stepRunners(dt) {
    this.reevalT -= dt;
    const reeval = this.reevalT <= 0;
    if (reeval) this.reevalT = 0.3;
    for (const r of this.runners) {
      if (r.out) {
        r.outT += dt;
        continue;
      }
      if (r.scored) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }

      // tag-up decision right after a catch
      if (r.tagging && this.flyCaught && r.tagDecideT != null && this.t >= r.tagDecideT && Math.abs(r.s - r.origin * BD) < 0.2) {
        r.tagDecideT = null;
        r.tagging = false;
        if (this.decideAdvance(r, r.origin + 1, 0.1)) this.setGoal(r, r.origin + 1);
      }
      if (r.mustRetouch && Math.abs(r.s - r.origin * BD) < 0.05) {
        r.mustRetouch = false;
        // back safely; maybe advance now if the ball is far away
        if (this.decideAdvance(r, r.origin + 1, 0.3)) this.setGoal(r, r.origin + 1);
      }

      const dir = r.goalS > r.s ? 1 : -1;
      const d = Math.abs(r.goalS - r.s);
      if (d > 0.005) {
        if (r.lastDir && r.lastDir !== dir) r.v = 0;
        r.lastDir = dir;
        const noBrake = r.isBatter && dir > 0 && r.goalS === BD;
        let want = noBrake ? r.vmax : Math.min(r.vmax, Math.sqrt(2 * 9 * d));
        // rounding a base
        const nextBase = dir > 0 ? Math.ceil(r.s / BD + 1e-6) : null;
        if (nextBase && r.goalS > nextBase * BD + 0.1 && nextBase * BD - r.s < 3) want = Math.min(want, r.vmax * 0.86);
        if (r.v < want) r.v = Math.min(want, r.v + RUNNER_ACCEL * dt);
        else r.v = Math.max(want, r.v - 12 * dt);
        const prev = r.s;
        const stepS = Math.max(r.v, 0.3) * dt;
        r.s = d - stepS < 0.006 ? r.goalS : r.s + dir * stepS;
        // touching bases
        if (dir > 0) {
          for (let k = 1; k <= 4; k++) {
            const bs = k * BD;
            if (prev < bs - 0.001 && r.s >= bs - 0.001) {
              r.touched = Math.max(r.touched, k);
              if (r.isBatter && k === 1 && this.batterFirstT == null) this.batterFirstT = this.t;
              if (k === 4) {
                r.scored = true;
                this.runs.push({ runner: r, t: this.t });
                this.g.onEvent({ type: 'run', runner: r.player });
                this.enforceSpacing();
              }
            }
          }
          // decide whether to keep going as we approach the goal base
          const gb = Math.round(r.goalS / BD);
          if (!r.scored && Math.abs(r.goalS - gb * BD) < 0.01 && gb < 4 && gb * BD - r.s < 5 && !r.decided[gb] &&
            !this.trot && !this.groundRule && !r.freeze && !r.halfway && !r.tagging) {
            r.decided[gb] = true;
            if (this.decideAdvance(r, gb + 1)) this.setGoal(r, gb + 1);
          }
        }
      } else {
        r.v = 0;
        // re-evaluate while standing on a base
        if (reeval && !this.trot && !this.groundRule && !r.freeze && !r.tagging && !r.mustRetouch) {
          const k = Math.round(r.s / BD);
          if (Math.abs(r.s - k * BD) < 0.05 && k < 4 && (this.batAir === false || this.flyCaught || this.touched)) {
            if (!r.halfway && this.decideAdvance(r, k + 1, 0.25)) this.setGoal(r, k + 1);
          }
        }
      }

      // retreat if the ball is waiting for us at an unforced base
      if (!this.trot && !this.groundRule && dir > 0 && !this.isForced(r) && this.holder) {
        const gb = Math.round(r.goalS / BD);
        const prevB = gb - 1;
        const frac = (r.s - prevB * BD) / BD;
        if (gb <= 4 && frac < 0.45 && baseDist(this.holder.x, this.holder.y, gb) < 3 && prevB >= r.origin) {
          r.goalS = prevB * BD;
        }
      }
      this.placeRunner(r);
      r.anim = r.v > 0.5 ? 'run' : 'idle';
    }
  }

  checkEnd(dt) {
    if (this.done) return;
    if (this.trot || this.groundRule) {
      const moving = this.runners.some((r) => this.active(r) && Math.abs(r.goalS - r.s) > 0.01);
      if (!moving) {
        this.quiet += dt;
        if (this.quiet > (this.trot ? 0.6 : 0.8)) this.finish(this.trot ? 'hr' : 'groundRule');
      }
      return;
    }
    const allSettled = this.runners.every((r) => !this.active(r) || (Math.abs(r.goalS - r.s) < 0.01 && Math.abs(r.s / BD - Math.round(r.s / BD)) < 0.01 && !r.mustRetouch));
    const h = this.holder;
    if (allSettled && h && (h.transfer <= 0 || h.carryTo == null)) {
      this.quiet += dt;
      if (this.quiet > 0.5) this.finish('settled');
    } else {
      this.quiet = 0;
    }
    if (this.t > 45) this.finish('timeout');
  }

  finish(reason) {
    if (this.done) return;
    this.done = true;
    this.reason = reason;
    if (reason === 'foul') {
      this.result = { foul: true };
      return;
    }
    // Runs: apply third-out rules
    let runs = this.runs.slice();
    const totalOuts = this.outsBefore + this.outs.length;
    if (totalOuts >= 3) {
      const third = this.outs[this.outs.length - 1];
      if (third.how === 'force' || third.beforeFirst || third.how === 'fly' && third.runner.isBatter) {
        runs = [];
      } else {
        runs = runs.filter((x) => x.t < third.t);
      }
    }
    // a runner who must retouch doesn't score
    const br = this.batterRunner;
    let batterBase = 0;
    if (br && !br.out) {
      if (this.trot) batterBase = 4;
      else if (br.scored) batterBase = 4;
      else batterBase = Math.max(1, Math.round(br.s / BD));
    }
    const bases = [null, null, null, null];
    {
      for (const r of this.runners) {
        if (!this.active(r)) continue;
        const k = Math.max(1, Math.min(3, Math.round(r.s / BD)));
        bases[k] = r.player;
      }
    }
    this.result = {
      foul: false,
      hr: this.trot,
      groundRule: this.groundRule,
      flyCaught: this.flyCaught,
      outs: this.outs,
      runs,
      errors: this.errors,
      chain: this.chain,
      batterOut: br ? br.out : false,
      runners: this.runners,
      steal: this.steal,
      batterBase,
      bases,
      firstLanding: this.firstLanding,
      distance: this.distance,
      batterFirstT: this.batterFirstT,
      reason,
    };
  }
}
