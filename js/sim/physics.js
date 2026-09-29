// Ball physics: gravity, quadratic drag, Magnus lift, bounces, rolling and walls.
import {
  G, fenceDistance, sprayAngleDeg, isFairAngle, FENCE_HEIGHT, foulDistance,
  FOUL_WALL_OFFSET, BACKSTOP_Y, surfaceAt, FT,
} from './field.js';

export const BALL_R = 0.0366;
const RHO = 1.2;
const AREA = Math.PI * BALL_R * BALL_R;
const MASS = 0.145;
const K = (0.5 * RHO * AREA) / MASS; // ~0.0174
const CD = 0.39;

export const RPM = (2 * Math.PI) / 60;

const SURFACES = {
  grass: { e: 0.46, fric: 0.24, roll: 4.6 },
  dirt: { e: 0.52, fric: 0.18, roll: 3.0 },
  track: { e: 0.45, fric: 0.3, roll: 5.0 },
};

export function makeBall(p, v, w = { x: 0, y: 0, z: 0 }) {
  return {
    p: { ...p }, v: { ...v }, w: { ...w },
    rolling: false, bounces: 0, stopped: false,
  };
}

export function cloneBall(b) {
  return {
    p: { ...b.p }, v: { ...b.v }, w: { ...b.w },
    rolling: b.rolling, bounces: b.bounces, stopped: b.stopped,
  };
}

function accel(v, w, out) {
  const sp = Math.hypot(v.x, v.y, v.z);
  let ax = 0, ay = 0, az = -G;
  if (sp > 0.01) {
    const drag = K * CD * sp;
    ax -= drag * v.x; ay -= drag * v.y; az -= drag * v.z;
    const wm = Math.hypot(w.x, w.y, w.z);
    if (wm > 0.1) {
      const S = (BALL_R * wm) / sp;
      const cl = Math.min(0.72 * S, 0.3);
      // (w_hat x v) * |v| * cl * K
      const f = (K * cl * sp) / wm;
      ax += f * (w.y * v.z - w.z * v.y);
      ay += f * (w.z * v.x - w.x * v.z);
      az += f * (w.x * v.y - w.y * v.x);
    }
  }
  out.x = ax; out.y = ay; out.z = az;
}

const _a1 = { x: 0, y: 0, z: 0 };
const _a2 = { x: 0, y: 0, z: 0 };
const _vm = { x: 0, y: 0, z: 0 };

// Advance the ball by dt. Returns an event string or null.
// opts.walls (default true): collide with fence / detect leaving the park.
export function stepBall(b, dt, opts = {}) {
  if (b.stopped) return null;
  const walls = opts.walls !== false;
  const prevX = b.p.x, prevY = b.p.y;
  let event = null;

  if (b.rolling) {
    const sp = Math.hypot(b.v.x, b.v.y);
    const surf = SURFACES[surfaceAt(b.p.x, b.p.y)];
    const dec = surf.roll + K * CD * 0.6 * sp * sp;
    const nsp = sp - dec * dt;
    if (nsp <= 0.15) {
      b.v.x = 0; b.v.y = 0; b.v.z = 0;
      b.stopped = true;
      return 'stopped';
    }
    const f = nsp / sp;
    b.v.x *= f; b.v.y *= f; b.v.z = 0;
    b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z = BALL_R;
  } else {
    // midpoint (RK2)
    accel(b.v, b.w, _a1);
    _vm.x = b.v.x + _a1.x * dt * 0.5;
    _vm.y = b.v.y + _a1.y * dt * 0.5;
    _vm.z = b.v.z + _a1.z * dt * 0.5;
    accel(_vm, b.w, _a2);
    b.p.x += _vm.x * dt; b.p.y += _vm.y * dt; b.p.z += _vm.z * dt;
    b.v.x += _a2.x * dt; b.v.y += _a2.y * dt; b.v.z += _a2.z * dt;

    if (b.p.z <= BALL_R && b.v.z < 0) {
      const surf = SURFACES[surfaceAt(b.p.x, b.p.y)];
      b.p.z = BALL_R;
      const vzIn = -b.v.z;
      b.v.z = vzIn * surf.e;
      // friction impulse proportional to normal impulse, capped
      const hs = Math.hypot(b.v.x, b.v.y);
      if (hs > 0) {
        const loss = Math.min(hs * 0.45, surf.fric * vzIn * (1 + surf.e) + hs * 0.06);
        const f = (hs - loss) / hs;
        b.v.x *= f; b.v.y *= f;
      }
      b.w.x *= 0.3; b.w.y *= 0.3; b.w.z *= 0.3;
      b.bounces++;
      event = 'bounce';
      if (b.v.z < 1.0) {
        b.v.z = 0;
        b.rolling = true;
        b.w.x = 0; b.w.y = 0; b.w.z = 0;
      }
    }
  }

  if (walls) {
    const wev = checkWalls(b, prevX, prevY);
    if (wev) event = wev;
  }
  return event;
}

function checkWalls(b, px, py) {
  const { x, y } = b.p;
  if (y < BACKSTOP_Y) return 'dead';
  if (isFairAngle(x, y)) {
    const r = Math.hypot(x, y);
    const fd = fenceDistance(sprayAngleDeg(x, y));
    if (r >= fd) {
      if (b.p.z > FENCE_HEIGHT + BALL_R) return 'homerun';
      // bounce off the wall: reflect radial component
      const nx = x / r, ny = y / r;
      const vr = b.v.x * nx + b.v.y * ny;
      if (vr > 0) {
        b.v.x -= (1 + 0.35) * vr * nx;
        b.v.y -= (1 + 0.35) * vr * ny;
        b.v.x *= 0.7; b.v.y *= 0.7;
        b.p.x = nx * (fd - 0.05);
        b.p.y = ny * (fd - 0.05);
        return 'wall';
      }
    }
    return null;
  }
  const fdist = foulDistance(x, y);
  if (fdist > FOUL_WALL_OFFSET) return 'dead';
  const along = (Math.abs(x) + y) / Math.SQRT2;
  if (along > 330 * FT - 2 && !isFairAngle(px, py)) return 'dead';
  return null;
}

// Simulate forward, recording samples for fielders to plan with.
export function predictTrajectory(ball, { dt = 1 / 120, maxT = 14, sampleEvery = 2 } = {}) {
  const b = cloneBall(ball);
  const samples = [];
  let t = 0, i = 0;
  let firstBounce = null;
  let end = null;
  let landing = null;
  samples.push({ t: 0, x: b.p.x, y: b.p.y, z: b.p.z, air: !b.rolling && b.bounces === 0, g: b.rolling });
  while (t < maxT) {
    const ev = stepBall(b, dt);
    t += dt; i++;
    if (ev === 'bounce' && firstBounce === null) {
      firstBounce = t;
      landing = { x: b.p.x, y: b.p.y, t };
    }
    if (i % sampleEvery === 0 || ev) {
      samples.push({ t, x: b.p.x, y: b.p.y, z: b.p.z, air: b.bounces === 0, g: b.rolling });
    }
    if (ev === 'homerun' || ev === 'dead') { end = ev; break; }
    if (ev === 'stopped') { end = 'stopped'; break; }
  }
  return { samples, firstBounce, landing, end, endT: t };
}

// Distance the ball would carry (ground level) ignoring the fence.
export function carryDistance(ball) {
  const b = cloneBall(ball);
  const dt = 1 / 120;
  for (let t = 0; t < 12; t += dt) {
    stepBall(b, dt, { walls: false });
    if (b.bounces > 0) break;
  }
  return Math.hypot(b.p.x, b.p.y);
}

// Find a launch velocity from p0 with given speed and spin so the ball
// crosses the plane y = planeY at (tx, tz).
export function aimPitch(p0, speed, w, tx, tz, planeY) {
  const dist = p0.y - planeY;
  let ax = tx, az = tz + 0.5 * G * (dist / speed) ** 2 * 1.1;
  let result = null;
  for (let iter = 0; iter < 5; iter++) {
    const dx = ax - p0.x, dy = planeY - p0.y, dz = az - p0.z;
    const m = Math.hypot(dx, dy, dz);
    const v = { x: (dx / m) * speed, y: (dy / m) * speed, z: (dz / m) * speed };
    const hit = flyToPlane(p0, v, w, planeY);
    result = { v, hit };
    const ex = tx - hit.x, ez = tz - hit.z;
    if (Math.abs(ex) < 0.003 && Math.abs(ez) < 0.003) break;
    ax += ex; az += ez;
  }
  return result;
}

function flyToPlane(p0, v, w, planeY) {
  const b = makeBall(p0, v, w);
  const dt = 1 / 240;
  let t = 0;
  while (b.p.y > planeY && t < 3) {
    const py = b.p.y, px = b.p.x, pz = b.p.z;
    stepBall(b, dt, { walls: false });
    t += dt;
    if (b.p.y <= planeY) {
      const f = (py - planeY) / (py - b.p.y);
      return { x: px + (b.p.x - px) * f, z: pz + (b.p.z - pz) * f, t: t - dt + dt * f };
    }
  }
  return { x: b.p.x, z: b.p.z, t };
}

// Launch velocity for a throw from p0 to target point (tx, ty, tz) at a given speed.
// Picks the low arc; if the target is out of range, uses a 30 degree arc (ball will bounce).
// Returns { v, t } where t is the flight time to the target distance.
export function aimThrow(p0, target, speed) {
  const dx = target.x - p0.x, dy = target.y - p0.y;
  const dh = Math.hypot(dx, dy) || 0.01;
  const ux = dx / dh, uy = dy / dh;
  let lo = -0.35, hi = 0.6;
  let best = 0.1, bt = dh / speed;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const r = heightAtDistance(p0, ux, uy, speed, mid, dh);
    if (r === null || r.z < target.z) lo = mid; else hi = mid;
    best = mid;
    if (r) bt = r.t;
  }
  const r = heightAtDistance(p0, ux, uy, speed, best, dh);
  if (!r || Math.abs(r.z - target.z) > 1.0) {
    best = 0.5;
    bt = dh / (speed * 0.7);
  } else bt = r.t;
  const c = Math.cos(best), s = Math.sin(best);
  return { v: { x: ux * c * speed, y: uy * c * speed, z: s * speed }, t: bt };
}

function heightAtDistance(p0, ux, uy, speed, ang, dh) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const b = makeBall(p0, { x: ux * c * speed, y: uy * c * speed, z: s * speed });
  const dt = dh > 40 ? 1 / 60 : 1 / 120;
  for (let t = 0; t < 6; t += dt) {
    stepBall(b, dt, { walls: false });
    const d = (b.p.x - p0.x) * ux + (b.p.y - p0.y) * uy;
    if (d >= dh) return { z: b.p.z, t: t + dt };
    if (b.bounces > 0) return null;
  }
  return null;
}
