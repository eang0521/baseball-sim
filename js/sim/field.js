// Field geometry. Simulation coordinates (meters):
//   origin = tip of home plate, +x toward first base side, +y toward center field, +z up.
export const FT = 0.3048;
export const INCH = 0.0254;
export const MPH = 0.44704;
export const G = 9.81;

export const BASE_DIST = 90 * FT;
const D = BASE_DIST / Math.SQRT2;

// Index 0 = home, 1 = first, 2 = second, 3 = third.
export const BASES = [
  { x: 0, y: 0 },
  { x: D, y: D },
  { x: 0, y: 2 * D },
  { x: -D, y: D },
];

export const RUBBER = { x: 0, y: 60.5 * FT };
export const MOUND_RADIUS = 9 * FT;
export const MOUND_HEIGHT = 10 * INCH;

export const PLATE_HALF_WIDTH = 8.5 * INCH;
export const PLATE_FRONT_Y = 17 * INCH; // pitcher-side edge of home plate
export const ZONE_PLANE_Y = 0.3; // plane where strike zone is judged / contact happens
export const CATCHER_Y = -0.9;

// Outfield wall distances by spray angle (degrees from CF line, + toward RF).
const FENCE_PTS = [
  [-45, 330], [-30, 360], [-15, 385], [0, 402], [15, 385], [30, 360], [45, 330],
];
export const FENCE_HEIGHT = 10 * FT;
export const FOUL_WALL_OFFSET = 16; // meters from foul line to the side stands
export const BACKSTOP_Y = -17;

export function sprayAngleDeg(x, y) {
  return (Math.atan2(x, y) * 180) / Math.PI;
}

export function fenceDistance(angleDeg) {
  const a = Math.max(-45, Math.min(45, angleDeg));
  for (let i = 0; i < FENCE_PTS.length - 1; i++) {
    const [a0, d0] = FENCE_PTS[i];
    const [a1, d1] = FENCE_PTS[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      // cosine ease for a rounded wall
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return (d0 + (d1 - d0) * s) * FT;
    }
  }
  return 330 * FT;
}

export function isFairAngle(x, y) {
  return y >= -0.01 && Math.abs(x) <= y + 0.01;
}

// Perpendicular distance into foul territory past the nearest foul line (0 if fair).
export function foulDistance(x, y) {
  // foul lines are x = y and x = -y (for y >= 0)
  const dR = (x - y) / Math.SQRT2; // >0 past the right field line
  const dL = (-x - y) / Math.SQRT2; // >0 past the left field line
  return Math.max(dR, dL, 0);
}

// True if a point on the ground is inside the playing area (fair or foul ground).
export function inPlayArea(x, y) {
  if (y < BACKSTOP_Y) return false;
  const r = Math.hypot(x, y);
  if (isFairAngle(x, y)) return r < fenceDistance(sprayAngleDeg(x, y));
  if (foulDistance(x, y) > FOUL_WALL_OFFSET) return false;
  // foul ground ends where the side wall meets the outfield wall
  const along = (Math.abs(x) + y) / Math.SQRT2;
  return along < 330 * FT - 2;
}

// Surface type for ball bounce / roll behavior.
export function surfaceAt(x, y) {
  const r = Math.hypot(x, y);
  if (isFairAngle(x, y)) {
    const fd = fenceDistance(sprayAngleDeg(x, y));
    if (r > fd - 4.6) return 'track';
  }
  const dm = Math.hypot(x - RUBBER.x, y - (RUBBER.y - 0.3));
  if (dm < MOUND_RADIUS) return 'dirt';
  if (r < 13 * FT) return 'dirt';
  // infield dirt arc (95 ft around the rubber) excluding the infield grass square
  if (dm < 95 * FT && y > -1) {
    // infield grass: diamond inset from the base paths
    const inset = 1.8;
    const u = (x + y) / Math.SQRT2; // along 1B line
    const v = (y - x) / Math.SQRT2; // along 3B line
    if (u > inset && v > inset && u < BASE_DIST - inset && v < BASE_DIST - inset) return 'grass';
    return 'dirt';
  }
  return 'grass';
}

export function basePos(i) {
  return BASES[((i % 4) + 4) % 4];
}

// Point along the base path, s in meters from home (0..4*BASE_DIST).
export function pathPoint(s) {
  const seg = Math.min(3, Math.max(0, Math.floor(s / BASE_DIST)));
  const t = Math.min(1, Math.max(0, (s - seg * BASE_DIST) / BASE_DIST));
  const a = BASES[seg];
  const b = BASES[(seg + 1) % 4];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const POS_NUM = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };

// Default defensive alignment (meters).
export const DEFAULT_SPOTS = {
  P: { x: 0, y: 17.6 },
  C: { x: 0, y: -1.0 },
  '1B': { x: 20.5, y: 27.0 },
  '2B': { x: 9.8, y: 42.0 },
  SS: { x: -9.8, y: 42.5 },
  '3B': { x: -20.0, y: 26.0 },
  LF: { x: -34, y: 84 },
  CF: { x: 0, y: 97 },
  RF: { x: 34, y: 84 },
};

export function describeDirection(x, y) {
  const a = sprayAngleDeg(x, y);
  const r = Math.hypot(x, y);
  if (r < 40) {
    if (r < 12 && Math.abs(a) < 30) return a < -10 ? 'third base side' : a > 10 ? 'first base side' : 'the mound';
    if (a < -27) return 'third';
    if (a < -6) return 'short';
    if (a < 8) return 'the middle';
    if (a < 28) return 'second';
    return 'first';
  }
  if (a < -30) return 'left';
  if (a < -12) return 'left-center';
  if (a < 12) return 'center';
  if (a < 30) return 'right-center';
  return 'right';
}
