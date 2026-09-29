// Default teams and random player generation.
import { RNG } from '../sim/rng.js';

const FIRST = ['Jake', 'Luis', 'Marcus', 'Tyler', 'Kenji', 'Diego', 'Owen', 'Andre', 'Cole', 'Mateo', 'Ryan', 'Eli',
  'Victor', 'Sam', 'Nolan', 'Hector', 'Jordan', 'Miles', 'Caleb', 'Rafael', 'Wes', 'Tomas', 'Dante', 'Brody',
  'Shohei', 'Ivan', 'Gavin', 'Julio', 'Aaron', 'Chase', 'Felix', 'Reggie', 'Isaac', 'Mason', 'Yuki', 'Carlos',
  'Derek', 'Nico', 'Trey', 'Emilio', 'Grant', 'Bo', 'Kyle', 'Omar', 'Pete', 'Zack', 'Ramon', 'Jalen'];
const LAST = ['Ramirez', 'Walker', 'Sato', 'Bennett', 'Ortiz', 'Hayes', 'Castillo', 'Brooks', 'Nakamura', 'Price',
  'Delgado', 'Foster', 'Morales', 'Kim', 'Sullivan', 'Reyes', 'Coleman', 'Vargas', 'Fletcher', 'Mendoza', 'Hart',
  'Alvarez', 'Donovan', 'Suzuki', 'Pena', 'Whitaker', 'Cruz', 'Lindqvist', 'Moreno', 'Grady', 'Santos', 'Keller',
  'Okafor', 'Rivera', 'Tanaka', 'Boone', 'Espinoza', 'McCall', 'Herrera', 'Dunn', 'Quinn', 'Ibarra', 'Maddox',
  'Soto', 'Pruitt', 'Velez', 'Lawson', 'Cabrera', 'Holt', 'Acosta'];

const FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

const clamp = (v, a = 20, b = 99) => Math.max(a, Math.min(b, Math.round(v)));

let uid = 0;
export function newId(prefix = 'p') {
  uid++;
  return `${prefix}${Date.now().toString(36)}${uid.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function name(rng, used) {
  for (let i = 0; i < 50; i++) {
    const n = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

// Position archetypes shape the ratings a bit.
const ARCH = {
  C: { contact: -4, power: 2, speed: -12, fielding: 6, arm: 8 },
  '1B': { contact: 0, power: 10, speed: -8, fielding: -4, arm: -8 },
  '2B': { contact: 5, power: -6, speed: 4, fielding: 6, arm: -2 },
  '3B': { contact: 0, power: 5, speed: -2, fielding: 4, arm: 10 },
  SS: { contact: 2, power: -4, speed: 6, fielding: 10, arm: 8 },
  LF: { contact: 2, power: 5, speed: 2, fielding: -4, arm: -2 },
  CF: { contact: 3, power: -2, speed: 12, fielding: 8, arm: 2 },
  RF: { contact: 0, power: 6, speed: 0, fielding: 0, arm: 10 },
  DH: { contact: 3, power: 12, speed: -10, fielding: -20, arm: -15 },
};

export function randomHitter(rng, pos, quality = 55, used = new Set()) {
  const a = ARCH[pos] || {};
  const r = (k) => clamp(rng.gauss(quality + (a[k] || 0), 11));
  const hand = rng.next();
  return {
    id: newId('h'),
    name: name(rng, used),
    num: rng.int(1, 99),
    pos,
    bats: hand < 0.58 ? 'R' : hand < 0.9 ? 'L' : 'S',
    contact: r('contact'),
    power: r('power'),
    eye: r('eye'),
    speed: r('speed'),
    fielding: r('fielding'),
    arm: r('arm'),
  };
}

const REPS = [
  ['FF', 'SL', 'CH'], ['FF', 'CU', 'CH'], ['SI', 'SL', 'CH'], ['FF', 'SL', 'CU', 'CH'],
  ['FF', 'FC', 'CU'], ['SI', 'FC', 'SL'], ['FF', 'FS', 'SL'], ['FF', 'SL'], ['SI', 'CH', 'CU'],
];

export function randomPitcher(rng, role, quality = 55, used = new Set()) {
  const starter = role === 'SP';
  const rep = rng.pick(REPS);
  const velo = Math.round(Math.max(86, Math.min(101, rng.gauss(93.5 + (quality - 55) * 0.08 + (starter ? -0.5 : 1), 2))));
  return {
    id: newId('pp'),
    name: name(rng, used),
    num: rng.int(1, 99),
    throws: rng.chance(0.3) ? 'L' : 'R',
    role,
    velo,
    control: clamp(rng.gauss(quality, 11)),
    stamina: starter ? clamp(rng.gauss(85, 6), 65, 99) : clamp(rng.gauss(32, 7), 15, 55),
    pitches: rep.map((t, i) => ({ type: t, rating: clamp(rng.gauss(quality + (i === 0 ? 3 : 0), 12)) })),
  };
}

export function randomTeam(seed, meta = {}) {
  const rng = new RNG(seed);
  const used = new Set();
  const q = meta.quality ?? 55;
  const hitters = FIELD_POS.map((p) => randomHitter(rng, p, q + rng.gauss(0, 3), used));
  // Batting order: sort roughly by a blend so the lineup looks sensible.
  const score = (h) => h.contact * 0.5 + h.power * 0.5 + h.eye * 0.3;
  const sorted = [...hitters].sort((a, b) => score(b) - score(a));
  const best = sorted.slice(0, 4);
  const lead = [...hitters].sort((a, b) => (b.speed + b.eye + b.contact) - (a.speed + a.eye + a.contact))
    .find((h) => !best.includes(h)) || sorted[4];
  const order = [lead, best[1], best[0], best[2], best[3]];
  for (const h of sorted) if (!order.includes(h)) order.push(h);

  const pitchers = [
    randomPitcher(rng, 'SP', q + 4, used),
    randomPitcher(rng, 'SP', q, used),
    randomPitcher(rng, 'RP', q - 4, used),
    randomPitcher(rng, 'RP', q - 3, used),
    randomPitcher(rng, 'RP', q - 1, used),
    randomPitcher(rng, 'SU', q + 2, used),
    randomPitcher(rng, 'CL', q + 5, used),
  ];
  return {
    id: meta.id || newId('t'),
    name: meta.name || 'Team',
    abbr: meta.abbr || 'TMS',
    primary: meta.primary || '#1d4ed8',
    secondary: meta.secondary || '#f8fafc',
    lineup: order,
    pitchers,
  };
}

export function defaultTeams() {
  return [
    randomTeam(1101, { id: 'gulls', name: 'Harbor City Gulls', abbr: 'HCG', primary: '#0f4c81', secondary: '#f2b134', quality: 57 }),
    randomTeam(2202, { id: 'coyotes', name: 'Red Rock Coyotes', abbr: 'RRC', primary: '#b3261e', secondary: '#f4e3c1', quality: 55 }),
    randomTeam(3303, { id: 'lumberjacks', name: 'Maple Valley Lumberjacks', abbr: 'MVL', primary: '#1f6f43', secondary: '#e9e1c8', quality: 54 }),
    randomTeam(4404, { id: 'comets', name: 'Neon Bay Comets', abbr: 'NBC', primary: '#6d28d9', secondary: '#22d3ee', quality: 56 }),
  ];
}

// Fill in anything missing from a team loaded from storage / import.
export function normalizeTeam(t) {
  const rng = new RNG(Math.floor(Math.random() * 1e9));
  const team = { ...t };
  team.id = team.id || newId('t');
  team.name = String(team.name || 'Team');
  team.abbr = String(team.abbr || team.name.slice(0, 3)).toUpperCase().slice(0, 4);
  team.primary = team.primary || '#1d4ed8';
  team.secondary = team.secondary || '#f8fafc';
  const num = (v, d) => clamp(Number.isFinite(+v) ? +v : d, 1, 99);
  team.lineup = (team.lineup || []).slice(0, 9).map((h) => ({
    id: h.id || newId('h'), name: String(h.name || 'Player'), num: h.num ?? 0, pos: h.pos || 'DH',
    bats: ['R', 'L', 'S'].includes(h.bats) ? h.bats : 'R',
    contact: num(h.contact, 50), power: num(h.power, 50), eye: num(h.eye, 50),
    speed: num(h.speed, 50), fielding: num(h.fielding, 50), arm: num(h.arm, 50),
  }));
  while (team.lineup.length < 9) {
    const have = new Set(team.lineup.map((h) => h.pos));
    const pos = FIELD_POS.find((p) => !have.has(p)) || 'DH';
    team.lineup.push(randomHitter(rng, pos));
  }
  team.pitchers = (team.pitchers || []).map((p) => ({
    id: p.id || newId('pp'), name: String(p.name || 'Pitcher'), num: p.num ?? 0,
    throws: p.throws === 'L' ? 'L' : 'R',
    role: ['SP', 'RP', 'SU', 'CL'].includes(p.role) ? p.role : 'RP',
    velo: Math.max(70, Math.min(105, +p.velo || 92)),
    control: num(p.control, 50), stamina: num(p.stamina, 40),
    pitches: (p.pitches && p.pitches.length ? p.pitches : [{ type: 'FF', rating: 50 }])
      .map((x) => ({ type: x.type, rating: num(x.rating, 50) })),
  }));
  if (!team.pitchers.some((p) => p.role === 'SP')) team.pitchers.unshift(randomPitcher(rng, 'SP'));
  return team;
}

export { FIELD_POS };
