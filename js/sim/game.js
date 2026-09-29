// Game engine: innings, plate appearances, pitches, bullpen management and stats.
import { RNG } from './rng.js';
import {
  BASES, BASE_DIST, DEFAULT_SPOTS, POSITIONS, ZONE_PLANE_Y, CATCHER_Y, RUBBER,
  describeDirection, FT, POS_NUM, pathPoint,
} from './field.js';
import { makeBall, stepBall } from './physics.js';
import {
  planPitch, swingDecision, resolveSwing, battedBallVector, battedType, batSide,
  ZONE, maxPitches, fatigueOf, buntDecision, resolveBunt, zoneDistance,
} from './atbat.js';
import { runnerVmax, armSpeed, runTime, RUNNER_ACCEL } from './entities.js';
import { Play } from './play.js';
import { PITCH_TYPES } from './pitches.js';

const FIXED_DT = 1 / 200;
const POS_NAME = { P: 'pitcher', C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right' };
const BASE_NAME = ['home', 'first', 'second', 'third', 'home'];
const ORD = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const STRETCH = 0.95; // time to release from the stretch (runners on)
const PAUSE = {
  pregame: 2.0, preAB: 1.0, windup: 1.15, afterPitch: 0.9, afterFoul: 1.2,
  afterPlay: 2.0, sideChange: 3.0, pitchingChange: 2.5,
};

function emptyBat() {
  return { pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sf: 0, sh: 0, sb: 0, cs: 0 };
}
function emptyPit() {
  return { outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pc: 0, strikes: 0 };
}

export function ordinal(n) {
  return ORD(n);
}

function lastName(p) {
  const parts = p.name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : p.name;
}

export class Game {
  constructor(away, home, opts = {}) {
    this.rng = new RNG(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.extraRunner = opts.extraRunner !== false;
    this.stealRate = opts.stealRate ?? 0.12;
    this.instant = false;
    this.sides = [this.makeSide(away, opts.awayStarter), this.makeSide(home, opts.homeStarter)];
    this.state = {
      inning: 1, half: 0, outs: 0, balls: 0, strikes: 0,
      bases: [null, null, null, null], score: [0, 0],
      line: [[], []], hits: [0, 0], errors: [0, 0], lob: [0, 0],
      batter: null, pitcher: null,
    };
    this.world = {
      fielders: [],
      runners: [],
      batter: null,
      ball: { phys: makeBall({ x: 0, y: 17, z: 1.5 }, { x: 0, y: 0, z: 0 }), visible: false, mode: 'none' },
    };
    this.phase = 'pregame';
    this.phaseT = 0;
    this.acc = 0;
    this.log = [];
    this.events = [];
    this.pitchLog = [];
    this.lastPitch = null;
    this.over = false;
    this.winner = null;
    this.play = null;
    this.message = 'Play ball!';
    this.metrics = { pitches: 0, zone: 0, swings: 0, zswing: 0, oswing: 0, whiff: 0, foulTip: 0, bip: 0, foulBip: 0, ev: 0 };
    this.setupHalf(true);
  }

  makeSide(team, starterId) {
    const lineup = team.lineup.slice(0, 9);
    const sp = team.pitchers.find((p) => p.id === starterId) ||
      team.pitchers.find((p) => p.role === 'SP') || team.pitchers[0];
    const side = {
      team, lineup, idx: 0, pitcher: sp, used: [sp], pc: new Map([[sp.id, 0]]),
      bat: new Map(lineup.map((p) => [p.id, emptyBat()])),
      pit: new Map([[sp.id, emptyPit()]]),
      runsThisOuting: 0, outsThisOuting: 0,
    };
    side.defense = this.assignDefense(lineup);
    return side;
  }

  // Map fielding positions to players (fills gaps if the roster is unusual).
  assignDefense(lineup) {
    const def = {};
    const pool = [...lineup];
    for (const pos of POSITIONS) {
      if (pos === 'P') continue;
      const i = pool.findIndex((p) => p.pos === pos);
      if (i >= 0) def[pos] = pool.splice(i, 1)[0];
    }
    // DH or leftover players fill any missing position, best fielder first
    const leftovers = pool.filter((p) => p.pos !== 'DH').concat(pool.filter((p) => p.pos === 'DH'));
    for (const pos of POSITIONS) {
      if (pos === 'P' || def[pos]) continue;
      def[pos] = leftovers.shift() || lineup[0];
    }
    return def;
  }

  get offense() { return this.sides[this.state.half]; }
  get defenseSide() { return this.sides[1 - this.state.half]; }

  // ---------- world setup ----------
  setupHalf(first = false) {
    const def = this.defenseSide;
    this.world.fielders = POSITIONS.map((pos) => {
      const player = pos === 'P' ? def.pitcher : def.defense[pos];
      const fp = pos === 'P' ? { ...player, speed: 45, fielding: 55, arm: 70 } : player;
      return {
        pos, player: fp, x: 0, y: 0, spd: 0, vx: 0, vy: 0, facing: Math.PI, role: 'hold',
        target: { x: 0, y: 0 }, anim: 'ready', animT: 0, team: 1 - this.state.half,
      };
    });
    this.state.pitcher = def.pitcher;
    this.resetPositions();
  }

  resetPositions() {
    const batter = this.state.batter;
    const side = batter ? batSide(batter, this.state.pitcher) : 'R';
    const shift = side === 'L' ? 1 : -1;
    for (const f of this.world.fielders) {
      const s = DEFAULT_SPOTS[f.pos];
      let x = s.x, y = s.y;
      if (!['P', 'C'].includes(f.pos)) x += shift * (['LF', 'CF', 'RF'].includes(f.pos) ? 4 : 1.5);
      // hold runners on first
      if (f.pos === '1B' && this.state.bases[1] && !this.state.bases[2]) { x = BASES[1].x + 0.8; y = BASES[1].y + 1.2; }
      f.x = x; f.y = y; f.spd = 0; f.vx = 0; f.vy = 0;
      f.facing = Math.atan2(-x, -y);
      f.home = { x, y };
      f.anim = f.pos === 'C' ? 'crouch' : f.pos === 'P' ? 'set' : 'ready';
      f.animT = 0;
      f.hasBall = f.pos === 'P';
    }
    this.world.runners = [];
    for (let k = 1; k <= 3; k++) {
      const p = this.state.bases[k];
      if (!p) continue;
      const lead = [0, 3.4, 4.6, 2.6][k];
      const a = BASES[k], b = BASES[(k + 1) % 4];
      const t = lead / BASE_DIST;
      this.world.runners.push({
        player: p, origin: k, s: k * BASE_DIST + lead, v: 0,
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        facing: Math.atan2(-(b.x - a.x), -(b.y - a.y)) + Math.PI, anim: 'lead', out: false, scored: false,
      });
    }
    this.world.ball.visible = false;
    this.world.ball.mode = 'held';
  }

  // ---------- time ----------
  advance(dt) {
    if (this.over) return;
    this.acc += Math.min(dt, 0.5);
    let n = 0;
    while (this.acc >= FIXED_DT && n < 400) {
      this.acc -= FIXED_DT;
      this.stepFixed(FIXED_DT);
      n++;
      if (this.over) break;
    }
  }

  simToEnd(maxSteps = 5e6) {
    const was = this.instant;
    this.instant = true;
    let n = 0;
    while (!this.over && n < maxSteps) {
      this.stepFixed(FIXED_DT);
      n++;
    }
    this.instant = was;
  }

  // Advance until the current half-inning (or PA) finishes, instantly.
  simUntil(pred, maxSteps = 2e6) {
    const was = this.instant;
    this.instant = true;
    let n = 0;
    while (!this.over && n < maxSteps && !pred()) {
      this.stepFixed(FIXED_DT);
      n++;
    }
    this.instant = was;
  }

  wait(name, secs) {
    this.phase = name;
    this.phaseT = this.instant ? 0 : secs ?? PAUSE[name] ?? 1;
  }

  onEvent(e) {
    this.events.push(e);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  addLog(text, kind = 'play') {
    const s = this.state;
    this.log.push({
      text, kind, inning: s.inning, half: s.half, outs: s.outs,
      score: [...s.score],
    });
  }

  stepFixed(dt) {
    if (this.over) return;
    // animate fielder anim timers even when idle
    for (const f of this.world.fielders) f.animT = (f.animT || 0) + (this.play ? 0 : dt);
    const wb = this.world.batter;
    if (wb) wb.animT += dt;

    switch (this.phase) {
      case 'pregame':
      case 'preAB':
      case 'afterPitch':
      case 'afterFoul':
      case 'afterPlay':
      case 'sideChange':
      case 'pitchingChange':
        this.phaseT -= dt;
        if (this.world.ball.mode === 'dead' && !this.instant) {
          const b = this.world.ball.phys;
          stepBall(b, dt, { walls: false });
          if (b.p.y < -16 || b.bounces > 2) this.world.ball.visible = false;
        }
        if (this.phaseT <= 0) this.nextFromPause();
        break;
      case 'windup':
        this.phaseT -= dt;
        this.pitcherEntity().anim = 'windup';
        this.pitcherEntity().animT = PAUSE.windup - Math.max(0, this.phaseT);
        this.stepStealers(dt);
        if (this.phaseT <= 0) this.releasePitch();
        break;
      case 'pitch':
        this.stepStealers(dt);
        this.stepPitch(dt);
        break;
      case 'play':
        this.play.step(dt);
        if (this.play.done) this.finishPlay();
        break;
      default:
        break;
    }
  }

  pitcherEntity() {
    return this.world.fielders.find((f) => f.pos === 'P');
  }

  nextFromPause() {
    const ph = this.phase;
    if (ph === 'pregame') {
      this.startHalfInning();
    } else if (ph === 'sideChange') {
      this.startHalfInning();
    } else if (ph === 'pitchingChange') {
      this.startPA(true);
    } else if (ph === 'preAB') {
      this.startWindup();
    } else if (ph === 'afterPitch' || ph === 'afterFoul') {
      if (this.paOver) this.nextPA();
      else {
        if (ph === 'afterFoul') this.resetPositions();
        this.startWindup();
      }
    } else if (ph === 'afterPlay') {
      this.nextPA();
    }
  }

  // ---------- innings ----------
  startHalfInning() {
    const s = this.state;
    s.outs = 0;
    s.bases = [null, null, null, null];
    s.line[s.half][s.inning - 1] = 0;
    if (this.extraRunner && s.inning >= 10) {
      const off = this.offense;
      const prev = off.lineup[(off.idx + 8) % 9];
      s.bases[2] = prev;
    }
    this.setupHalf();
    const off = this.offense.team;
    this.addLog(`${s.half === 0 ? 'Top' : 'Bottom'} of the ${ORD(s.inning)} — ${off.name} batting`, 'inning');
    if (s.bases[2]) this.addLog(`${s.bases[2].name} starts the inning on second base.`, 'info');
    this.inningStart = true;
    this.startPA();
  }

  endHalfInning() {
    const s = this.state;
    const runners = s.bases.filter(Boolean).length;
    s.lob[s.half] += runners;
    this.world.runners = [];
    // game over checks
    if (s.inning >= 9) {
      if (s.half === 0 && s.score[1] > s.score[0]) return this.endGame();
      if (s.half === 1 && s.score[0] !== s.score[1]) return this.endGame();
    }
    const [a, h] = s.score;
    this.addLog(`End of the ${s.half === 0 ? 'top' : 'bottom'} of the ${ORD(s.inning)}. ${this.sides[0].team.abbr} ${a}, ${this.sides[1].team.abbr} ${h}.`, 'summary');
    if (s.half === 1) s.inning++;
    s.half = 1 - s.half;
    s.bases = [null, null, null, null];
    this.message = `${s.half === 0 ? 'Top' : 'Bottom'} ${ORD(s.inning)}`;
    this.wait('sideChange');
  }

  endGame() {
    const s = this.state;
    this.over = true;
    this.phase = 'final';
    this.winner = s.score[1] > s.score[0] ? 1 : 0;
    const w = this.sides[this.winner].team, l = this.sides[1 - this.winner].team;
    const hi = Math.max(...s.score), lo = Math.min(...s.score);
    // fill in the home team's unplayed bottom half with an 'X'
    if (s.half === 0) s.line[1][s.inning - 1] = 'X';
    this.addLog(`Final: ${w.name} ${hi}, ${l.name} ${lo}${s.inning > 9 ? ` (${s.inning} innings)` : ''}.`, 'final');
    this.message = 'Final';
    this.onEvent({ type: 'final' });
  }

  // ---------- plate appearances ----------
  startPA(afterChange = false) {
    const s = this.state;
    const off = this.offense;
    s.batter = off.lineup[off.idx];
    if (!afterChange && this.checkPitchingChange()) return;
    s.pitcher = this.defenseSide.pitcher;
    s.balls = 0;
    s.strikes = 0;
    this.paOver = false;
    this.paSeq = (this.paSeq || 0) + 1;
    this.pitchLog = [];
    this.lastType = null;
    const side = batSide(s.batter, s.pitcher);
    this.world.batter = {
      player: s.batter, side, x: side === 'R' ? -0.78 : 0.78, y: 0.35, anim: 'stance', animT: 0,
      team: s.half, swing: false,
    };
    this.resetPositions();
    this.inningStart = false;
    this.message = '';
    this.onEvent({ type: 'pa', batter: s.batter });
    this.wait('preAB');
  }

  nextPA() {
    const s = this.state;
    if (this.over) return;
    if (s.outs >= 3) {
      this.endHalfInning();
      return;
    }
    this.startPA();
  }

  // ---------- bullpen ----------
  checkPitchingChange() {
    const s = this.state;
    const def = this.defenseSide;
    const p = def.pitcher;
    const pc = def.pc.get(p.id) || 0;
    const mx = maxPitches(p);
    const lead = def === this.sides[1] ? s.score[1] - s.score[0] : s.score[0] - s.score[1];
    const available = def.team.pitchers.filter((q) => !def.used.includes(q));
    if (!available.length) return false;
    const starter = def.used[0] === p;
    const runs = def.runsThisOuting;
    let reason = null;
    if (pc >= mx) reason = 'tired';
    else if (starter) {
      // starters go as deep as their stamina allows unless they get knocked around
      if (runs >= 6 || (runs >= 5 && pc > mx * 0.5) || (runs >= 4 && pc > mx * 0.75)) reason = 'chased';
      else if (this.inningStart) {
        if (pc > mx * 0.88) reason = 'tired';
        else if (s.inning >= 9 && lead > 0 && lead <= 3 && pc > mx * 0.75 && available.some((q) => q.role === 'CL')) reason = 'closer';
        else if (s.inning === 8 && lead >= 0 && lead <= 3 && pc > mx * 0.82 && available.some((q) => q.role === 'SU')) reason = 'setup';
      }
    } else if (this.inningStart) {
      const longMan = p.role === 'SP';
      if (!longMan && def.outsThisOuting >= 3 && p.role !== 'CL') reason = 'inning';
      else if (longMan && pc > mx * 0.8) reason = 'tired';
      else if (s.inning >= 9 && lead > 0 && lead <= 3 && p.role !== 'CL' && available.some((q) => q.role === 'CL')) reason = 'closer';
    } else if (runs >= 3 && pc > 12) reason = 'struggling';
    if (!reason) return false;

    const save = lead > 0 && lead <= 3;
    const pickRole = (roles) => available.find((q) => roles.includes(q.role));
    let next;
    if (s.inning >= 9 && save) next = pickRole(['CL']) || pickRole(['SU']) || pickRole(['RP']);
    else if (s.inning >= 8 && lead >= 0 && lead <= 3) next = pickRole(['SU']) || pickRole(['RP']);
    else if (s.inning <= 5) next = pickRole(['RP']) || pickRole(['SP']) || pickRole(['SU']);
    else next = pickRole(['RP']) || pickRole(['SU']) || pickRole(['SP']) || pickRole(['CL']);
    next = next || available[0];
    if (!next) return false;

    def.pitcher = next;
    def.used.push(next);
    def.pc.set(next.id, 0);
    def.pit.set(next.id, emptyPit());
    def.runsThisOuting = 0;
    def.outsThisOuting = 0;
    this.addLog(`Pitching change: ${next.name} (${next.role}) replaces ${p.name} (${pc} pitches).`, 'change');
    this.message = `Pitching change: ${next.name}`;
    this.setupHalf();
    this.resetPositions();
    this.onEvent({ type: 'pitchingChange', pitcher: next });
    this.wait('pitchingChange');
    return true;
  }

  // ---------- pitches ----------
  startWindup() {
    this.resetPositions();
    const pe = this.pitcherEntity();
    pe.anim = 'windup';
    pe.animT = 0;
    pe.hasBall = true;
    this.world.ball.visible = false;
    this.world.batter.anim = 'stance';
    this.world.batter.animT = 0;
    const s = this.state;
    const runnersOn = s.bases[1] || s.bases[2] || s.bases[3];
    this.stealers = this.decideSteal();
    this.bunting = this.stealers ? null : buntDecision(this.rng, s, this.scoreDiff());
    if (this.bunting === 'sac') this.buntDefense();
    // the delivery is game time (runners move during it), so it is never skipped
    this.phase = 'windup';
    this.phaseT = runnersOn ? STRETCH + this.rng.gauss(0, 0.06) : PAUSE.windup;
  }

  // obvious bunt: corners creep in, second baseman cheats toward first, batter shows it early
  buntDefense() {
    for (const f of this.world.fielders) {
      if (f.pos === '1B') { f.x = 14.5; f.y = 17; }
      if (f.pos === '3B') { f.x = -15; f.y = 17; }
      if (f.pos === '2B') { f.x = 16; f.y = 27; }
      if (f.pos === 'SS') { f.x = -5; f.y = 40; }
      f.home = { x: f.x, y: f.y };
    }
    this.world.batter.anim = 'bunt';
  }

  scoreDiff() {
    const s = this.state;
    return s.score[s.half] - s.score[1 - s.half];
  }

  // Offensive manager: send a runner? Returns stealing runners or null.
  decideSteal() {
    const s = this.state;
    const b = s.bases;
    const auto = s.outs === 2 && s.balls === 3 && s.strikes === 2;
    const list = [];
    if (auto) {
      // two outs, full count: forced runners go on the pitch
      if (b[1]) { list.push(1); if (b[2]) { list.push(2); if (b[3]) list.push(3); } }
      return list.length ? this.makeStealers(list, true) : null;
    }
    let lead = 0;
    if (b[2] && !b[3]) lead = 2;
    else if (b[1] && !b[2]) lead = 1;
    if (!lead) return null;
    const diff = this.scoreDiff();
    if (diff > 5 || (s.inning >= 7 && diff < -2) || diff < -4) return null;
    if (s.balls === 3 && s.outs < 2) return null;
    const runner = b[lead];
    const def = this.defenseSide;
    const catcher = def.defense.C;
    const margin = this.stealMargin(runner, lead, def.pitcher, catcher);
    const want = this.stealRate / (1 + Math.exp(-(margin + 0.05) / 0.06)) * (lead === 2 ? 0.45 : 1) * (s.outs === 2 && lead === 2 ? 0.3 : 1);
    if (!this.rng.chance(want)) return null;
    const bases = [lead];
    if (lead === 2 && b[1]) bases.push(1); // double steal
    return this.makeStealers(bases, false);
  }

  stealMargin(runner, from, pitcher, catcher) {
    const lead = from === 1 ? 4.4 : 5.8;
    const jump = 0.08 + (pitcher.throws === 'L' && from === 1 ? 0.14 : 0);
    const tRun = jump + runTime(BASE_DIST - lead, runnerVmax(runner), RUNNER_ACCEL, 3.0);
    const throwD = from === 1 ? 38.8 : 27.4;
    const tDef = STRETCH + 0.42 + 0.78 - (catcher.arm ?? 50) * 0.0018 - (catcher.fielding ?? 50) * 0.0012 +
      throwD / (armSpeed(catcher) * 0.9) + 0.12;
    return tDef - tRun;
  }

  makeStealers(bases, auto) {
    const s = this.state;
    const lefty = this.defenseSide.pitcher.throws === 'L';
    return bases.map((k) => {
      const e = this.world.runners.find((r) => r.origin === k);
      // a base stealer takes a bigger lead and goes on the pitcher's first move
      const lead = auto ? (k === 1 ? 3.4 : k === 2 ? 4.6 : 2.6) : k === 1 ? 4.4 : 5.8;
      return {
        player: s.bases[k], origin: k, entity: e, s: k * BASE_DIST + lead, v: 0, t: 0, auto,
        jump: auto ? 0.6 : 0.02 + (lefty && k === 1 ? 0.14 : 0) + this.rng.range(0, 0.12),
      };
    });
  }

  stepStealers(dt) {
    if (!this.stealers) return;
    for (const st of this.stealers) {
      st.t += dt;
      if (st.t < st.jump) continue;
      if (st.v === 0) st.v = 3.0;
      const vmax = runnerVmax(st.player);
      st.v = Math.min(vmax, st.v + RUNNER_ACCEL * dt);
      const goal = (st.origin + 1) * BASE_DIST;
      st.s = Math.min(goal, st.s + st.v * dt);
      const e = st.entity;
      if (e) {
        const p = pathPoint(st.s);
        const q = pathPoint(Math.min(goal, st.s + 0.5));
        e.x = p.x; e.y = p.y; e.s = st.s; e.v = st.v; e.anim = 'run';
        if (q.x !== p.x || q.y !== p.y) e.facing = Math.atan2(q.x - p.x, q.y - p.y);
      }
    }
  }

  stealState() {
    if (!this.stealers) return null;
    return new Map(this.stealers.map((st) => [st.player, { s: st.s, v: st.v }]));
  }

  releasePitch() {
    const s = this.state;
    const def = this.defenseSide;
    const p = def.pitcher;
    const pc = def.pc.get(p.id) || 0;
    const side = batSide(s.batter, p);
    const pitch = planPitch(this.rng, p, pc, { balls: s.balls, strikes: s.strikes }, side, this.lastType);
    this.lastType = pitch.type;
    this.curPitch = pitch;
    const b = this.world.ball.phys;
    Object.assign(b, makeBall(pitch.release, pitch.v, pitch.w));
    this.world.ball.visible = true;
    this.world.ball.mode = 'pitch';
    this.world.ball.trail = [];
    const pe = this.pitcherEntity();
    pe.hasBall = false;
    pe.anim = 'follow';
    pe.animT = 0;
    this.pitchT = 0;
    if (this.bunting) {
      // square around; pull the bat back on pitches well out of the zone
      this.world.batter.anim = 'bunt';
      this.world.batter.animT = 0;
      const seen = zoneDistance(pitch.plate.x + this.rng.gauss(0, 0.05), pitch.plate.z + this.rng.gauss(0, 0.05));
      this.swing = seen < 0.06 || (this.bunting === 'sac' && seen < 0.12 && this.rng.chance(0.5));
    } else {
      this.swing = swingDecision(this.rng, s.batter, pitch, { balls: s.balls, strikes: s.strikes });
    }
    this.swingStarted = false;
    this.crossed = false;
    this.phase = 'pitch';
    def.pc.set(p.id, pc + 1);
    def.pit.get(p.id).pc++;
    this.onEvent({ type: 'pitch', pitch });
  }

  stepPitch(dt) {
    const s = this.state;
    const ball = this.world.ball.phys;
    const pitch = this.curPitch;
    this.pitchT += dt;
    const wb = this.world.batter;
    if (this.swing && !this.swingStarted && this.pitchT >= pitch.flightTime - 0.16) {
      this.swingStarted = true;
      if (!this.bunting) {
        wb.anim = 'swing';
        wb.animT = 0;
      }
    }
    if (this.bunting && !this.swing && this.pitchT >= pitch.flightTime - 0.12) wb.anim = 'stance';
    stepBall(ball, dt, { walls: false });

    if (!this.crossed && ball.p.y <= ZONE_PLANE_Y) {
      this.crossed = true;
      this.resolveAtPlate();
      return;
    }
    if (this.crossed && (ball.p.y <= CATCHER_Y || ball.p.z <= 0.05 && ball.p.y < 0.2)) {
      // catcher receives
      const c = this.world.fielders.find((f) => f.pos === 'C');
      ball.p.x = c.x; ball.p.y = CATCHER_Y; ball.p.z = Math.max(0.3, Math.min(1.6, ball.p.z));
      ball.v = { x: 0, y: 0, z: 0 };
      this.world.ball.mode = 'held';
      c.anim = 'catchPitch';
      c.animT = 0;
      this.pitchCaught();
    }
  }

  resolveAtPlate() {
    const s = this.state;
    const pitch = this.curPitch;
    const ball = this.world.ball.phys;
    const def = this.defenseSide;
    const pl = def.pit.get(def.pitcher.id);
    const side = batSide(s.batter, s.pitcher);
    // actual location at the plane (use the ball's current position)
    pitch.plate = { x: ball.p.x, z: ball.p.z };
    const entry = { type: pitch.type, mph: pitch.mph, x: ball.p.x, z: ball.p.z, n: this.pitchLog.length + 1, result: '' };
    this.pitchLog.push(entry);
    this.lastPitch = entry;
    const m = this.metrics;
    const inZone = Math.abs(ball.p.x) <= ZONE.halfW && ball.p.z >= ZONE.bot - 0.037 && ball.p.z <= ZONE.top + 0.037;
    m.pitches++;
    if (inZone) m.zone++;
    if (this.swing) { m.swings++; if (inZone) m.zswing++; else m.oswing++; }
    if (this.swing) {
      const platoon = side === (s.pitcher.throws === 'R' ? 'R' : 'L');
      const res = this.bunting
        ? resolveBunt(this.rng, s.batter, pitch, side, this.bunting)
        : resolveSwing(this.rng, s.batter, s.pitcher, pitch, side, platoon);
      if (!res.contact) {
        m.whiff++;
        entry.result = 'Swinging strike';
        this.pitchOutcome = 'swinging';
        pl.strikes++;
        return;
      }
      if (res.foulTip || res.foulBack) {
        m.foulTip++;
        pl.strikes++;
        if (res.foulTip && s.strikes === 2 && this.rng.chance(0.3)) {
          entry.result = 'Foul tip (strike three)';
          this.pitchOutcome = 'foultipK';
          return;
        }
        if (this.bunting && s.strikes === 2) {
          // foul bunt with two strikes is a strikeout
          entry.result = 'Foul bunt (strike three)';
          this.pitchOutcome = 'foultipK';
          return;
        }
        this.stealers = null;
        entry.result = this.bunting ? 'Foul bunt' : 'Foul';
        this.pitchOutcome = 'foul';
        const side2 = res.foulBack ? this.rng.gauss(0, 14) : this.rng.gauss(0, 5);
        ball.v = { x: side2, y: -this.rng.range(12, 28), z: res.q > 0 ? this.rng.range(6, 22) : this.rng.range(-8, 2) };
        ball.w = { x: 0, y: 0, z: 0 };
        this.world.ball.mode = 'dead';
        this.state.strikes = Math.min(2, this.state.strikes + 1);
        this.message = 'Foul ball';
        this.onEvent({ type: 'foul' });
        this.wait('afterFoul', 1.0);
        return;
      }
      // Ball in play (or foul off the bat): launch it
      pl.strikes++;
      entry.result = 'In play';
      const bb = { ...res, type: battedType(res.la), bunt: !!this.bunting, buntKind: this.bunting };
      m.bip++; m.ev += res.ev; m[bb.type] = (m[bb.type] || 0) + 1;
      const { v, w } = battedBallVector(bb);
      ball.p = { x: ball.p.x, y: ZONE_PLANE_Y + 0.25, z: ball.p.z };
      ball.v = v;
      ball.w = w;
      ball.rolling = false;
      ball.bounces = 0;
      ball.stopped = false;
      this.world.ball.mode = 'play';
      this.world.ball.trail = [];
      this.batted = bb;
      this.world.batter.anim = 'run';
      this.play = new Play(this, bb, { runnerState: this.stealState() });
      this.stealers = null;
      this.phase = 'play';
      this.onEvent({ type: 'contact', bb });
      return;
    }
    // take: umpire call
    const hbpX = side === 'R' ? ball.p.x < -0.64 : ball.p.x > 0.64;
    if (hbpX && ball.p.z > 0.25 && ball.p.z < 1.7 && Math.abs(ball.p.x) < 1.1) {
      entry.result = 'Hit by pitch';
      this.pitchOutcome = 'hbp';
      return;
    }
    const nx = ball.p.x + this.rng.gauss(0, 0.018);
    const nz = ball.p.z + this.rng.gauss(0, 0.018);
    const strike = Math.abs(nx) <= ZONE.halfW && nz >= ZONE.bot - 0.037 && nz <= ZONE.top + 0.037;
    if (strike) {
      entry.result = 'Called strike';
      this.pitchOutcome = 'called';
      pl.strikes++;
    } else {
      entry.result = 'Ball';
      this.pitchOutcome = 'ball';
    }
  }

  pitchCaught() {
    const s = this.state;
    this.onEvent({ type: 'mitt' });
    const o = this.pitchOutcome;
    if (o === 'ball') {
      s.balls++;
      if (s.balls >= 4) { this.stealers = null; return this.walk('BB'); }
    } else if (o === 'called' || o === 'swinging' || o === 'foultipK') {
      s.strikes++;
      if (s.strikes >= 3) {
        this.strikeout(o === 'called' ? 'looking' : o === 'foultipK' && this.bunting ? 'bunt' : 'swinging');
        if (this.stealers && s.outs < 3 && !this.stealers[0].auto) this.startStealPlay();
        this.stealers = null;
        return;
      }
    } else if (o === 'hbp') {
      this.stealers = null;
      return this.walk('HBP');
    }
    if (this.stealers && !this.stealers[0].auto) {
      this.startStealPlay();
      return;
    }
    this.stealers = null;
    this.wait('afterPitch');
  }

  startStealPlay() {
    const side = this.world.batter ? this.world.batter.side : 'R';
    this.play = new Play(this, null, { steal: true, runnerState: this.stealState(), batterSide: side });
    this.stealers = null;
    this.phase = 'play';
    this.world.ball.mode = 'play';
    this.onEvent({ type: 'steal' });
  }

  // ---------- PA outcomes ----------
  batLine(p = this.state.batter) {
    const side = this.sides.find((sd) => sd.bat.has(p.id));
    return side ? side.bat.get(p.id) : emptyBat();
  }

  pitLine() {
    const def = this.defenseSide;
    return def.pit.get(def.pitcher.id);
  }

  strikeout(how) {
    const s = this.state;
    const bl = this.batLine();
    bl.pa++; bl.ab++; bl.so++;
    const pl = this.pitLine();
    pl.so++; pl.bf++;
    this.addOut(1);
    const how2 = { looking: 'strikes out looking', bunt: 'strikes out on a foul bunt', swinging: 'strikes out swinging' }[how];
    this.addLog(`${s.batter.name} ${how2}.`, 'k');
    this.message = how === 'looking' ? 'Strikeout (looking)' : 'Strikeout (swinging)';
    this.onEvent({ type: 'strikeout' });
    this.paOver = true;
    this.offense.idx = (this.offense.idx + 1) % 9;
    this.wait('afterPitch', this.instant ? 0 : 1.6);
  }

  walk(kind) {
    const s = this.state;
    const bl = this.batLine();
    bl.pa++;
    if (kind === 'BB') bl.bb++; else bl.hbp++;
    const pl = this.pitLine();
    pl.bf++;
    if (kind === 'BB') pl.bb++;
    // force runners
    const b = s.bases;
    const scored = [];
    if (b[1]) {
      if (b[2]) {
        if (b[3]) scored.push(b[3]);
        b[3] = b[2];
      }
      b[2] = b[1];
    }
    b[1] = s.batter;
    const txt = kind === 'BB' ? 'walks' : 'is hit by a pitch';
    this.addLog(`${s.batter.name} ${txt}.${scored.length ? ` ${scored[0].name} scores.` : ''}`, kind === 'BB' ? 'bb' : 'hbp');
    this.message = kind === 'BB' ? 'Ball four' : 'Hit by pitch';
    for (const r of scored) this.scoreRun(r, true);
    this.paOver = true;
    this.offense.idx = (this.offense.idx + 1) % 9;
    this.onEvent({ type: kind === 'BB' ? 'walk' : 'hbp' });
    if (this.checkWalkoff()) return;
    this.wait('afterPitch', this.instant ? 0 : 1.4);
  }

  addOut(n) {
    const s = this.state;
    s.outs += n;
    const def = this.defenseSide;
    def.pit.get(def.pitcher.id).outs += n;
    def.outsThisOuting += n;
  }

  scoreRun(runner, rbi) {
    const s = this.state;
    s.score[s.half]++;
    s.line[s.half][s.inning - 1] = (s.line[s.half][s.inning - 1] || 0) + 1;
    const rl = this.batLine(runner);
    rl.r++;
    if (rbi) this.batLine().rbi++;
    const def = this.defenseSide;
    const pl = def.pit.get(def.pitcher.id);
    pl.r++;
    pl.er++;
    def.runsThisOuting++;
  }

  checkWalkoff() {
    const s = this.state;
    if (s.half === 1 && s.inning >= 9 && s.score[1] > s.score[0]) {
      this.addLog(`Walk-off! ${this.sides[1].team.name} win it.`, 'final');
      this.endGame();
      return true;
    }
    return false;
  }

  // ---------- ball in play ----------
  finishPlay() {
    const s = this.state;
    const play = this.play;
    const res = play.result;
    const bb = this.batted;
    this.play = null;
    if (res.foul) {
      this.metrics.foulBip++;
      if (s.strikes < 2) s.strikes++;
      this.lastPitch.result = 'Foul';
      this.message = 'Foul ball';
      this.onEvent({ type: 'foul' });
      this.world.runners = [];
      this.wait('afterFoul');
      this.afterFoulReset = true;
      return;
    }
    if (res.steal) return this.finishSteal(res);
    const batter = s.batter;
    const bl = this.batLine();
    const def = this.defenseSide;
    const pl = def.pit.get(def.pitcher.id);
    bl.pa++;
    pl.bf++;

    const outs = res.outs.length;
    const batterOut = res.batterOut;
    const errs = res.errors;
    const sacFly = res.flyCaught && res.runs.length > 0 && s.outs + outs < 3;
    const otherForced = res.outs.some((o) => !o.runner.isBatter && (o.how === 'force'));
    const infieldErr = errs.length > 0 && (errs[0].throwing || ['P', 'C', '1B', '2B', '3B', 'SS'].includes(errs[0].pos));
    const roe = !batterOut && infieldErr && !otherForced && errs[0].t < (res.batterFirstT ?? Infinity);
    const fc = !batterOut && !roe && otherForced;
    let hitBases = 0;
    if (!batterOut && !roe && !fc) hitBases = res.hr ? 4 : Math.min(res.batterBase, res.groundRule ? 2 : 4);
    const dp = outs >= 2 && res.outs.some((o) => o.runner.isBatter);
    const advanced = res.runners.some((r) => !r.isBatter && !r.out && (r.scored || Math.round(r.s / BASE_DIST) > r.origin));
    const sacBunt = bb.bunt && batterOut && outs === 1 && !res.flyCaught && advanced && s.outs + outs < 3;

    if (sacBunt) bl.sh++;
    else if (!sacFly) bl.ab++; else bl.sf++;
    if (hitBases > 0) {
      bl.h++;
      pl.h++;
      s.hits[s.half]++;
      if (hitBases === 2) bl.d++;
      if (hitBases === 3) bl.t++;
      if (hitBases === 4) { bl.hr++; pl.hr++; }
    }
    s.errors[1 - s.half] += errs.length;

    // outs
    this.addOut(outs);
    // runs
    const rbiOK = !roe && !(dp && bb.type === 'ground');
    for (const r of res.runs) this.scoreRun(r.runner.player, rbiOK && !(errs.length && r.t > errs[0].t && hitBases === 0));
    s.bases = res.bases;

    // description
    const text = this.describe(batter, bb, res, { hitBases, roe, fc, dp, sacFly, sacBunt });
    this.addLog(text, hitBases === 4 ? 'hr' : hitBases > 0 ? 'hit' : batterOut ? 'out' : 'reach');
    this.message = this.shortResult(res, hitBases, { roe, fc, dp, sacFly, sacBunt });
    this.onEvent({ type: 'playResult', hitBases, res });
    this.paOver = true;
    this.offense.idx = (this.offense.idx + 1) % 9;
    if (this.checkWalkoff()) return;
    this.wait('afterPlay', res.hr ? 1.5 : PAUSE.afterPlay);
  }

  finishSteal(res) {
    const s = this.state;
    s.errors[1 - s.half] += res.errors.length;
    // the strikeout may already have ended the PA; outs on the bases still count
    this.addOut(res.outs.length);
    for (const r of res.runs) this.scoreRun(r.runner.player, false);
    s.bases = res.bases;
    const bits = [];
    const chain = res.chain.join('-');
    let msg = '';
    for (const r of res.runners) {
      if (!r.stealing) {
        if (r.scored) bits.push(`${r.player.name} scores on the throw.`);
        continue;
      }
      const target = BASE_NAME[r.origin + 1];
      const bl = this.batLine(r.player);
      if (r.out) {
        bl.cs++;
        bits.push(`${r.player.name} is caught stealing ${target}, ${chain}.`);
        msg = msg || 'Caught stealing';
      } else {
        bl.sb++;
        const end = r.scored ? 4 : Math.round(r.s / BASE_DIST);
        bits.push(`${r.player.name} steals ${target}${end > r.origin + 1 ? ` and takes ${BASE_NAME[end]} on the throw` : ''}.`);
        msg = msg || 'Stolen base';
      }
    }
    if (bits.length) this.addLog(bits.join(' '), 'steal');
    this.message = msg;
    this.onEvent({ type: 'stealResult', res });
    if (this.checkWalkoff()) return;
    if (this.paOver || s.outs >= 3) {
      this.paOver = true;
      this.wait('afterPlay', 1.6);
    } else {
      this.wait('afterPitch', 1.4);
    }
  }

  shortResult(res, hitBases, f) {
    if (hitBases === 4) return res.runs.length === 4 ? 'GRAND SLAM!' : 'HOME RUN!';
    if (f.sacBunt) return 'Sacrifice bunt';
    if (hitBases === 3) return 'Triple';
    if (hitBases === 2) return res.groundRule ? 'Ground-rule double' : 'Double';
    if (hitBases === 1) return 'Single';
    if (f.roe) return 'Error';
    if (f.dp) return res.outs.length >= 3 ? 'Triple play!' : 'Double play';
    if (f.fc) return "Fielder's choice";
    if (f.sacFly) return 'Sacrifice fly';
    const t = this.batted && this.batted.type;
    const pos = res.chain.length ? Object.keys(POS_NUM).find((k) => POS_NUM[k] === res.chain[0]) : '';
    if (res.flyCaught) return `${{ line: 'Lineout', fly: 'Flyout', popup: 'Popout', ground: 'Lineout' }[t]} to ${pos}`;
    return res.chain.length > 1 ? `Groundout ${res.chain.join('-')}` : `Groundout (${pos})`;
  }

  describe(batter, bb, res, f) {
    const typeWord = { ground: 'ground ball', line: 'line drive', fly: 'fly ball', popup: 'pop up' }[bb.type];
    const chainTxt = res.chain.join('-');
    const firstPos = res.chain.length ? Object.keys(POS_NUM).find((k) => POS_NUM[k] === res.chain[0]) : null;
    let dirTxt = '';
    if (bb.type === 'ground' && firstPos) dirTxt = { LF: 'left', CF: 'center', RF: 'right', SS: 'short', '2B': 'second', '3B': 'third', '1B': 'first', P: 'the pitcher', C: 'the catcher' }[firstPos];
    else if (res.firstLanding) dirTxt = describeDirection(res.firstLanding.x, res.firstLanding.y);
    else if (firstPos) dirTxt = POS_NAME[firstPos];
    const stat = `EV ${bb.ev.toFixed(1)} mph, LA ${Math.round(bb.la)}°${bb.type !== 'ground' ? `, ${Math.round(res.distance / FT)} ft` : ''}`;
    let t;
    const n = batter.name;
    if (f.hitBases === 4) {
      const runs = res.runs.length;
      const kind = runs === 4 ? 'grand slam' : runs === 1 ? 'solo home run' : `${runs}-run home run`;
      const where = res.hr ? describeDirection(Math.sin(bb.spray * Math.PI / 180), Math.cos(bb.spray * Math.PI / 180)) : dirTxt;
      t = res.hr ? `${n} hits a ${kind} to ${where === 'center' ? 'center field' : where === 'left' || where === 'right' ? where + ' field' : where}!` : `${n} circles the bases — an inside-the-park ${kind}!`;
    } else if (bb.bunt && f.hitBases > 0) {
      t = `${n} bunts for a ${['', 'single', 'double', 'triple'][f.hitBases]}${dirTxt ? ` toward ${dirTxt}` : ''}!`;
    } else if (f.sacBunt) {
      t = `${n} lays down a sacrifice bunt, ${chainTxt}.`;
    } else if (bb.bunt && res.flyCaught) {
      t = `${n} pops out to ${firstPos} on a bunt attempt.`;
    } else if (f.hitBases > 0) {
      const verb = ['', 'singles', 'doubles', 'triples'][f.hitBases];
      t = res.groundRule ? `${n} hits a ground-rule double to ${dirTxt}.` : `${n} ${verb} on a ${typeWord} to ${dirTxt}.`;
    } else if (f.roe) {
      t = `${n} reaches on an error by ${POS_NAME[res.errors[0].pos] === 'short' ? 'the shortstop' : `the ${res.errors[0].pos}`}.`;
    } else if (res.flyCaught) {
      const pos = firstPos || 'CF';
      const verb = { line: 'lines out', fly: 'flies out', popup: 'pops out', ground: 'lines out' }[bb.type];
      t = `${n} ${verb} to ${pos}${f.sacFly ? ' (sacrifice fly)' : ''}.`;
      const dbl = res.outs.filter((o) => o.how === 'doubled');
      if (dbl.length) t += ` ${dbl.map((o) => o.runner.player.name).join(', ')} doubled off — double play ${chainTxt}.`;
    } else if (f.dp) {
      t = `${n} grounds into a ${res.outs.length >= 3 ? 'triple' : 'double'} play, ${chainTxt}.`;
    } else if (f.fc) {
      t = `${n} reaches on a fielder's choice, ${chainTxt}.`;
    } else if (res.batterOut) {
      if (res.chain.length === 1) t = `${n} ${bb.type === 'ground' ? 'grounds out' : 'lines out'} to ${firstPos} unassisted.`;
      else t = `${n} ${bb.type === 'ground' ? 'grounds out' : bb.type === 'line' ? 'lines out' : 'is thrown out'}, ${chainTxt}.`;
    } else {
      t = `${n} reaches base.`;
    }
    const extras = [];
    for (const o of res.outs) {
      if (o.runner.isBatter || o.how === 'doubled') continue;
      if (f.dp && o.how === 'force') continue;
      extras.push(`${o.runner.player.name} out at ${BASE_NAME[o.base] || 'the base'}.`);
    }
    if (f.hitBases !== 4) for (const r of res.runs) extras.push(`${r.runner.player.name} scores.`);
    if (f.hitBases !== 4) {
      for (const r of res.runners) {
        if (r.isBatter || r.out || r.scored) continue;
        const end = Math.round(r.s / BASE_DIST);
        if (end > r.origin) extras.push(`${r.player.name} to ${BASE_NAME[end]}.`);
      }
    }
    return `${t}${extras.length ? ' ' + extras.join(' ') : ''} (${bb.bunt ? 'bunt' : stat})`;
  }
}

export { PITCH_TYPES };
