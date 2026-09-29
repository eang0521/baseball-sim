// Movement helpers shared by fielders and runners.
export const FIELDER_ACCEL = 8.0;
export const RUNNER_ACCEL = 5.6;

export function fielderVmax(p) {
  return 6.1 + (p.speed ?? 50) * 0.023;
}

export function runnerVmax(p) {
  return 6.6 + (p.speed ?? 50) * 0.026;
}

export function armSpeed(p) {
  return 27 + (p.arm ?? 50) * 0.145; // m/s (arm 50 ~ 78 mph, 99 ~ 93 mph)
}

// Time to cover distance d starting at speed v0, accelerating at a up to vmax.
export function runTime(d, vmax, a, v0 = 0) {
  if (d <= 0) return 0;
  v0 = Math.min(Math.max(v0, 0), vmax);
  const tAcc = (vmax - v0) / a;
  const dAcc = (v0 + vmax) * 0.5 * tAcc;
  if (d <= dAcc) {
    // solve d = v0 t + a t^2 / 2
    return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
  }
  return tAcc + (d - dAcc) / vmax;
}

// Move an entity {x, y, spd} toward (tx, ty). Returns remaining distance.
export function moveToward(e, tx, ty, vmax, accel, dt, brake = 9) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.02) {
    e.spd = 0; e.vx = 0; e.vy = 0;
    return 0;
  }
  const want = Math.min(vmax, Math.sqrt(2 * brake * d));
  if (e.spd < want) e.spd = Math.min(want, e.spd + accel * dt);
  else e.spd = Math.max(want, e.spd - brake * dt);
  const step = Math.min(d, e.spd * dt);
  e.vx = (dx / d) * e.spd;
  e.vy = (dy / d) * e.spd;
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
  if (e.spd > 0.3) e.facing = Math.atan2(dx, dy);
  return d - step;
}
