// Pitcher vs batter: pitch selection, location, swing decisions and bat-ball contact.
import { MPH, PLATE_HALF_WIDTH, ZONE_PLANE_Y } from './field.js';
import { BALL_R, RPM, aimPitch } from './physics.js';
import { PITCH_TYPES, FASTBALLS, BREAKING, OFFSPEED } from './pitches.js';

export const ZONE = { halfW: PLATE_HALF_WIDTH + BALL_R, bot: 0.47, top: 1.07 };
ZONE.mid = (ZONE.bot + ZONE.top) / 2;

export function maxPitches(p) {
  return 15 + (p.stamina ?? 50) * 1.0;
}

export function fatigueOf(p, pc) {
  const mx = maxPitches(p);
  return Math.max(0, (pc - 0.6 * mx) / (0.4 * mx));
}

// Which side of the plate the batter stands on: 'R' = right-handed batter (3B side, x < 0).
export function batSide(batter, pitcher) {
  if (batter.bats === 'S') return pitcher.throws === 'R' ? 'L' : 'R';
  return batter.bats;
}

// Signed distance outside the strike zone (negative = inside by that much).
export function zoneDistance(x, z) {
  const dx = Math.abs(x) - ZONE.halfW;
  const dz = Math.max(ZONE.bot - z, z - ZONE.top);
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

export function choosePitch(rng, pitcher, count, lastType) {
  const { balls, strikes } = count;
  const ahead = strikes > balls;
  const behind = balls > strikes && balls >= 2;
  return rng.weighted(pitcher.pitches, (p, i) => {
    let w = (FASTBALLS.has(p.type) ? 1.35 : 1.0) * (0.55 + p.rating / 100);
    if (behind && FASTBALLS.has(p.type)) w *= 2.0;
    if (ahead && !FASTBALLS.has(p.type)) w *= 1.6;
    if (strikes === 2 && (BREAKING.has(p.type) || OFFSPEED.has(p.type))) w *= 1.25;
    if (p.type === lastType) w *= 0.75;
    return w;
  }).type;
}

function intent(rng, count) {
  const { balls: b, strikes: s } = count;
  const key = `${b}-${s}`;
  const table = {
    '3-0': [0.7, 0.3, 0.0], '3-1': [0.45, 0.5, 0.05], '2-0': [0.4, 0.55, 0.05],
    '0-2': [0.04, 0.4, 0.56], '1-2': [0.08, 0.5, 0.42], '2-2': [0.14, 0.58, 0.28],
    '3-2': [0.3, 0.6, 0.1],
  };
  const [heart, edge] = table[key] || [0.24, 0.62, 0.14];
  const r = rng.next();
  return r < heart ? 'heart' : r < heart + edge ? 'edge' : 'chase';
}

// Decide pitch type and intended location, then compute the actual release velocity/spin.
export function planPitch(rng, pitcher, pc, count, batterSide, lastType) {
  const f = fatigueOf(pitcher, pc);
  const type = choosePitch(rng, pitcher, count, lastType);
  const def = PITCH_TYPES[type];
  const rep = pitcher.pitches.find((p) => p.type === type) || { rating: 50 };
  const rating = rep.rating - f * 10;
  const lefty = pitcher.throws === 'L';
  const hand = batterSide === 'R' ? 1 : -1; // inside for RHB is x < 0
  const kind = intent(rng, count);
  const W = ZONE.halfW;
  let tx, tz;
  if (kind === 'heart') {
    tx = rng.gauss(0, 0.07);
    tz = ZONE.mid + rng.gauss(0, 0.07);
  } else if (kind === 'edge') {
    const side = rng.next();
    if (side < 0.5) {
      tx = (rng.chance(0.5) ? 1 : -1) * (W - 0.02);
      tz = rng.range(ZONE.bot + 0.05, ZONE.top - 0.08);
    } else {
      tx = rng.range(-W + 0.05, W - 0.05);
      tz = FASTBALLS.has(type) && rng.chance(0.45) ? ZONE.top - 0.03 : ZONE.bot + 0.03;
    }
  } else {
    if (FASTBALLS.has(type)) {
      if (rng.chance(0.55)) { tx = rng.gauss(0, 0.12); tz = ZONE.top + 0.13; } else { tx = -hand * (W + 0.07); tz = ZONE.mid + rng.gauss(0, 0.12); }
    } else {
      // breaking stuff down and away
      tz = ZONE.bot - 0.14;
      tx = (BREAKING.has(type) ? (lefty ? -1 : 1) * 0.1 : -hand * 0.08) + rng.gauss(0, 0.08);
    }
  }
  const control = pitcher.control ?? 50;
  let sig = (0.1 + (100 - control) * 0.0015) * (1 + 0.55 * f) * (BREAKING.has(type) ? 1.12 : 1);
  const ax = tx + rng.gauss(0, sig);
  const az = tz + rng.gauss(0, sig * 0.9);

  const mph = pitcher.velo * def.speed - 2.8 * f + rng.gauss(0, 0.7) + (rating - 50) * 0.02;
  const spinScale = 0.84 + rating * 0.0032;
  const rpm = def.rpm * spinScale * (1 + rng.gauss(0, 0.03));
  let [sx, sy, sz] = def.axis;
  if (lefty) { sy = -sy; sz = -sz; }
  const w = { x: sx * rpm * RPM, y: sy * rpm * RPM, z: sz * rpm * RPM };
  const rel = { x: lefty ? 0.55 : -0.55, y: 16.75, z: 1.83 };
  const aim = aimPitch(rel, mph * MPH, w, ax, az, ZONE_PLANE_Y);
  return {
    type, def, rating, mph, rpm, w, v: aim.v, release: rel, plate: { x: aim.hit.x, z: aim.hit.z },
    flightTime: aim.hit.t, intended: { x: tx, z: tz }, kind,
  };
}

// Batter decides whether to swing, based on a noisy read of where the pitch will cross.
export function swingDecision(rng, batter, pitch, count) {
  const eye = batter.eye ?? 50;
  const stuff = (pitch.rating - 50) / 150;
  const sp = (0.05 + (100 - eye) * 0.0011) * pitch.def.perceive * (1 + stuff);
  const px = pitch.plate.x + rng.gauss(0, sp);
  const pz = pitch.plate.z + rng.gauss(0, sp);
  const d = zoneDistance(px, pz);
  const { balls, strikes } = count;
  let maxS = 0.87, c = 0.055;
  if (balls === 0 && strikes === 0) { maxS = 0.62; c = 0.02; }
  if (strikes === 2) { maxS = 0.95; c = 0.08; }
  if (balls === 3 && strikes === 0) { maxS = 0.12; c = -0.05; }
  if (balls === 3 && strikes === 1) maxS = 0.88;
  if (balls === 2 && strikes === 0) maxS = 0.8;
  // aggressive hitters (low eye, high power) chase a bit more
  c += ((batter.power ?? 50) - (eye)) * 0.0003;
  const p = maxS / (1 + Math.exp((d - c) / 0.05));
  return rng.chance(p);
}

// Resolve a swing at the plate. Returns { contact:false } for a whiff, or batted-ball data.
export function resolveSwing(rng, batter, pitcher, pitch, side, platoon) {
  const contact = (batter.contact ?? 50) - (platoon ? 4 : 0);
  const power = batter.power ?? 50;
  const { x, z } = pitch.plate;
  const t = pitch.type;
  const speedTerm = (pitch.mph - 88) / 10;
  const stuffTerm = ((pitch.rating - 50) / 50) * (FASTBALLS.has(t) ? 0.35 : 0.6);
  const dx = Math.abs(x) / ZONE.halfW;
  const dz = Math.abs(z - ZONE.mid) / ((ZONE.top - ZONE.bot) / 2);
  const edge = Math.max(dx, dz);
  const locPen = Math.max(0, edge - 0.45) * 0.55 + Math.max(0, edge - 1) * 1.3;

  const difficulty = Math.max(0.55, 1 + 0.16 * speedTerm + stuffTerm * 0.45 + locPen);
  const sigV = 0.0525 * (1.42 - contact / 100) * difficulty;
  const bias = { FF: 0.012, SI: -0.012, FC: -0.004, SL: -0.009, CU: -0.017, CH: -0.012, FS: -0.02 }[t] || 0;
  const muV = bias * (0.5 + pitch.rating / 100) + (z - ZONE.mid) * 0.045;
  const v = rng.gauss(muV, sigV);

  const sigT = 0.0105 * (1.4 - contact / 100) * Math.max(0.6, 1 + 0.12 * speedTerm + stuffTerm * 0.3);
  const muTb = { FF: pitch.mph > 96 ? -0.004 : 0, SI: 0, FC: -0.002, SL: 0.004, CU: 0.007, CH: 0.011, FS: 0.009 }[t] || 0;
  const tErr = rng.gauss(muTb * (0.5 + pitch.rating / 100), sigT);

  const R = 0.07;
  if (Math.abs(v) > R || Math.abs(tErr) > 0.034) return { contact: false };

  const q = v / R;
  if (Math.abs(q) > 0.93) return { contact: true, foulTip: true, q };
  if (Math.abs(q) > 0.62) return { contact: true, foulBack: true, q, tErr };
  const qn = q / 0.62;
  const batSpeed = 71 + power * 0.155;
  const eMax = 0.2 * pitch.mph + 1.2 * batSpeed;
  const timingF = 1 - Math.min(0.45, (tErr / 0.03) ** 2 * 0.35);
  let ev = eMax * (1 - 0.5 * Math.abs(qn + 0.08) ** 1.5) * timingF + rng.gauss(0, 3);
  ev = Math.max(25, ev);
  const attack = 14 + (power - 50) * 0.12;
  const la = attack + qn * 45 + rng.gauss(0, 6);
  const hand = side === 'R' ? 1 : -1;
  const spray = -hand * (tErr / 0.01) * 27 - hand * 5 + x * 55 + rng.gauss(0, 17);
  return { contact: true, ev, la, spray, q, tErr };
}

// Build launch velocity + spin (sim coords) for a batted ball.
export function battedBallVector(bb) {
  const s = bb.ev * MPH;
  const la = (bb.la * Math.PI) / 180;
  const ph = (bb.spray * Math.PI) / 180;
  const v = { x: s * Math.cos(la) * Math.sin(ph), y: s * Math.cos(la) * Math.cos(ph), z: s * Math.sin(la) };
  let spin;
  if (bb.la > 0) spin = Math.min(2600, 340 + bb.la * 42);
  else spin = -Math.min(1800, 600 + -bb.la * 25);
  spin *= RPM;
  const w = {
    x: Math.cos(ph) * spin,
    y: -Math.sin(ph) * spin,
    z: -(bb.spray / 45) * 0.28 * Math.abs(spin),
  };
  return { v, w };
}

export function battedType(la) {
  if (la < 10) return 'ground';
  if (la < 25) return 'line';
  if (la < 50) return 'fly';
  return 'popup';
}

// ---------- bunts ----------
// Returns 'sac', 'hit' or null. Called before each pitch.
export function buntDecision(rng, state, diff) {
  const { bases: b, outs, strikes, inning } = state;
  const bat = state.batter;
  if (strikes >= 2 || outs >= 2) return null;
  const weak = ((bat.contact ?? 50) + (bat.power ?? 50)) / 2 < 44;
  const close = Math.abs(diff) <= 1;
  // sacrifice: runner(s) on first and/or second, nobody on third, no outs
  if (outs === 0 && (b[1] || b[2]) && !b[3] && diff > -3) {
    let p = 0;
    if (weak && close && inning >= 7) p = 0.55;
    else if (close && inning >= 8) p = 0.12;
    else if (weak) p = 0.05;
    if (inning >= 10 && b[2] && !b[1] && close) p = Math.max(p, 0.3);
    if (rng.chance(p)) return 'sac';
  }
  // bunt for a hit: speedy slap hitters, bases open ahead
  const speed = bat.speed ?? 50;
  if (!b[3] && speed >= 72 && (bat.power ?? 50) < 58 && strikes === 0) {
    if (rng.chance(0.0035 * (speed - 70))) return 'hit';
  }
  return null;
}

export function resolveBunt(rng, batter, pitch, side, kind) {
  const contact = batter.contact ?? 50;
  const { x, z } = pitch.plate;
  const out = Math.max(0, zoneDistance(x, z));
  const breaking = !FASTBALLS.has(pitch.type);
  const miss = 0.06 + (100 - contact) * 0.0012 + out * 1.5 + (breaking ? 0.04 : 0) + Math.max(0, pitch.mph - 94) * 0.006;
  const r = rng.next();
  if (r < miss) return { contact: false };
  if (r < miss + 0.24) return { contact: true, foulBack: true, bunt: true, q: rng.range(-0.8, 0.8), tErr: 0 };
  if (r < miss + 0.24 + 0.035 + (100 - contact) * 0.0004) {
    // popped up
    return { contact: true, bunt: true, ev: rng.range(22, 38), la: rng.range(40, 70), spray: rng.gauss(0, 25), q: 0.9, tErr: 0 };
  }
  const hand = side === 'R' ? 1 : -1;
  const skill = contact / 100;
  let spray;
  if (kind === 'hit') {
    // drag toward first (lefty) or push down the third-base line
    spray = hand > 0 ? rng.gauss(-37, 4) : rng.gauss(24, 6);
  } else {
    spray = (rng.chance(0.55) ? -1 : 1) * rng.range(24, 40) * (0.8 + skill * 0.25);
  }
  const ev = kind === 'hit' ? rng.range(18, 29) : rng.range(15, 26) - skill * 2;
  const la = rng.gauss(-7, 5);
  return { contact: true, bunt: true, ev, la, spray, q: 0, tErr: 0 };
}
