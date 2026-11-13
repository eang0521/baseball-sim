// Season mode: schedule, rotations, results, standings and stat leaders.
// Pure data + logic (no DOM), so it runs in the page, in workers and in Node.
import { Game } from '../sim/game.js';
import { RNG } from '../sim/rng.js';

export const SEASON_LENGTHS = [162, 81, 40, 15];
const SERIES = 3;

// ---------- schedule ----------
// Round-robin by the circle method; each pairing is a three-game series. Every club plays every
// day, home series alternate cycle to cycle, and the order of rounds is shuffled within a cycle.
export function makeSchedule(nTeams, games, seed = 1) {
  const rng = new RNG(seed);
  const ids = [...Array(nTeams).keys()];
  if (ids.length % 2) ids.push(-1); // bye
  const n = ids.length;
  const cycle = [];
  let arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const x = arr[i], y = arr[n - 1 - i];
      if (x < 0 || y < 0) continue;
      pairs.push([x, y]);
    }
    cycle.push(pairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  const days = [];
  const hosted = Array(nTeams).fill(0);
  let gid = 0;
  for (let k = 0; days.length < games; k++) {
    if (k % cycle.length === 0) shuffle(rng, cycle);
    // whoever has hosted fewer series so far is at home, so home/road stays even all season
    const series = cycle[k % cycle.length].map(([x, y]) => {
      const home = hosted[x] < hosted[y] || (hosted[x] === hosted[y] && rng.chance(0.5)) ? x : y;
      hosted[home]++;
      return home === x ? [y, x] : [x, y];
    });
    const len = Math.min(SERIES, games - days.length);
    for (let g = 0; g < len; g++) days.push(series.map(([a, h]) => ({ id: gid++, a, h })));
  }
  return days;
}

function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// ---------- season object ----------
export function createSeason({ league, leagueName, teams, games = 162, follow = null, seed = Date.now() % 1e9 }) {
  return {
    version: 1,
    league,
    name: `${leagueName || 'Season'} — ${games} games`,
    created: new Date().toISOString(),
    games,
    seed,
    follow, // index of the club the user follows, or null
    teams: JSON.parse(JSON.stringify(teams)), // roster snapshot so mid-season edits don't leak in
    days: makeSchedule(teams.length, games, seed),
    day: 0,
    rot: teams.map(() => 0),
    bat: {},
    pit: {},
  };
}

export const gameAt = (season, id) => season.days.flat().find((g) => g.id === id);
export const isOver = (season) => season.day >= season.days.length;

// Probable starters: assigned when a day comes up, walking each club's rotation in order.
export function prepareDay(season, day = season.day) {
  if (day >= season.days.length) return;
  for (let d = season.day; d <= day; d++) {
    for (const g of season.days[d]) {
      if (g.aSP) continue;
      g.aSP = nextStarter(season, g.a);
      g.hSP = nextStarter(season, g.h);
    }
  }
}

// Unplayed games from today through `count` days ahead, starters assigned.
export function upcomingGames(season, count = 1) {
  const last = Math.min(season.days.length, season.day + count) - 1;
  prepareDay(season, last);
  const out = [];
  for (let d = season.day; d <= last; d++) for (const g of season.days[d]) if (!g.score) out.push(g);
  return out;
}

export function teamRecord(season, t) {
  let w = 0, l = 0;
  for (const day of season.days) for (const g of day) {
    if (!g.score || (g.a !== t && g.h !== t)) continue;
    const won = g.a === t ? g.score[0] > g.score[1] : g.score[1] > g.score[0];
    if (won) w++; else l++;
  }
  return { w, l };
}

function nextStarter(season, t) {
  const sps = season.teams[t].pitchers.filter((p) => p.role === 'SP');
  const pool = sps.length ? sps : season.teams[t].pitchers;
  const p = pool[season.rot[t] % pool.length];
  season.rot[t]++;
  return p.id;
}

// ---------- playing ----------
export function gameSeed(season, g) {
  return (season.seed * 7919 + g.id * 104729) % 2147483647;
}

// Sim one scheduled game to the end and boil it down to what the season keeps.
export function simGame(season, g) {
  const game = new Game(season.teams[g.a], season.teams[g.h], {
    awayStarter: g.aSP, homeStarter: g.hSP, seed: gameSeed(season, g),
  });
  game.simToEnd();
  return summarize(game, g.id);
}

export function summarize(game, id) {
  const s = game.state;
  const sides = game.sides.map((sd, k) => ({
    bat: [...sd.bat].map(([pid, b]) => [pid, b]),
    pit: sd.used.map((p) => [p.id, sd.pit.get(p.id)]),
    runs: s.score[k],
  }));
  return { id, score: [...s.score], innings: s.inning, hits: [...s.hits], sides, ...decisions(game) };
}

// Pitching decisions, simplified: the starter gets the win with 5+ innings, otherwise the winning
// club's reliever who got the most outs; the loss goes to whoever allowed the most runs for the
// loser; a save goes to the winner's last pitcher if he finished a game won by three or fewer.
function decisions(game) {
  const s = game.state;
  const w = s.score[1] > s.score[0] ? 1 : 0;
  const ws = game.sides[w], ls = game.sides[1 - w];
  const line = (sd, p) => sd.pit.get(p.id);
  let wp = ws.used[0];
  if (line(ws, wp).outs < 15 && ws.used.length > 1) {
    wp = ws.used.slice(1).reduce((b, p) => (line(ws, p).outs > line(ws, b).outs ? p : b));
  }
  const lp = ls.used.reduce((b, p) => (line(ls, p).r > line(ls, b).r ? p : b), ls.used[0]);
  const last = ws.used[ws.used.length - 1];
  const margin = s.score[w] - s.score[1 - w];
  const sv = last !== wp && margin <= 3 && line(ws, last).outs >= 3 ? last.id : null;
  return { wp: wp.id, lp: lp.id, sv };
}

const BAT_KEYS = ['pa', 'ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'bb', 'so', 'hbp', 'sf', 'sh', 'sb', 'cs'];
const PIT_KEYS = ['outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr', 'pc'];

export function recordResult(season, res) {
  const g = gameAt(season, res.id);
  if (!g || g.score) return;
  g.score = res.score;
  if (res.innings !== 9) g.inn = res.innings;
  res.sides.forEach((sd, k) => {
    const team = k === 0 ? g.a : g.h;
    for (const [pid, b] of sd.bat) {
      if (!b.pa && !b.sb && !b.cs && !b.r) continue;
      const t = (season.bat[pid] ||= { team, g: 0 });
      t.team = team;
      t.g++;
      for (const key of BAT_KEYS) t[key] = (t[key] || 0) + (b[key] || 0);
    }
    sd.pit.forEach(([pid, l], i) => {
      const t = (season.pit[pid] ||= { team, g: 0, gs: 0, w: 0, l: 0, sv: 0 });
      t.team = team;
      t.g++;
      if (i === 0) t.gs++;
      for (const key of PIT_KEYS) t[key] = (t[key] || 0) + (l[key] || 0);
    });
  });
  if (season.pit[res.wp]) season.pit[res.wp].w++;
  if (season.pit[res.lp]) season.pit[res.lp].l++;
  if (res.sv && season.pit[res.sv]) season.pit[res.sv].sv++;
}

// Move to the next day once every game today has a result.
export function advanceIfDone(season) {
  while (!isOver(season) && season.days[season.day].every((g) => g.score)) {
    season.day++;
    prepareDay(season);
  }
}

// ---------- standings ----------
export function standings(season) {
  const rows = season.teams.map((t, i) => ({
    i, team: t, w: 0, l: 0, rs: 0, ra: 0, home: [0, 0], away: [0, 0], last: [],
  }));
  for (const day of season.days) {
    for (const g of day) {
      if (!g.score) continue;
      const [a, h] = g.score;
      const A = rows[g.a], H = rows[g.h];
      A.rs += a; A.ra += h; H.rs += h; H.ra += a;
      const homeWon = h > a;
      (homeWon ? H : A).w++;
      (homeWon ? A : H).l++;
      H.home[homeWon ? 0 : 1]++;
      A.away[homeWon ? 1 : 0]++;
      H.last.push(homeWon ? 'W' : 'L');
      A.last.push(homeWon ? 'L' : 'W');
    }
  }
  for (const r of rows) {
    r.pct = r.w + r.l ? r.w / (r.w + r.l) : 0;
    const l10 = r.last.slice(-10);
    r.l10 = `${l10.filter((x) => x === 'W').length}-${l10.filter((x) => x === 'L').length}`;
    let n = 0;
    const lastR = r.last[r.last.length - 1];
    for (let k = r.last.length - 1; k >= 0 && r.last[k] === lastR; k--) n++;
    r.strk = lastR ? `${lastR}${n}` : '-';
  }
  return rows;
}

// Standings grouped by division (or league, or one table), sorted, with games behind.
export function groupedStandings(season) {
  const rows = standings(season);
  const key = (r) => r.team.division || r.team.league || 'League';
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(key(r))) groups.set(key(r), []);
    groups.get(key(r)).push(r);
  }
  const out = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => {
    list.sort((a, b) => b.pct - a.pct || (b.rs - b.ra) - (a.rs - a.ra));
    const top = list[0];
    for (const r of list) r.gb = ((top.w - r.w) + (r.l - top.l)) / 2;
    return { name, rows: list };
  });
  return out;
}

// ---------- leaders ----------
const fmt3 = (x) => (Number.isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '-');
export const ipStr = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

export function playerIndex(season) {
  const m = new Map();
  season.teams.forEach((t, i) => {
    for (const p of [...t.lineup, ...(t.bench || [])]) m.set(p.id, { p, team: i, kind: 'bat' });
    for (const p of t.pitchers) m.set(p.id, { p, team: i, kind: 'pit' });
  });
  return m;
}

export function batRates(b) {
  const avg = b.ab ? b.h / b.ab : 0;
  const obpD = b.ab + b.bb + b.hbp + b.sf;
  const obp = obpD ? (b.h + b.bb + b.hbp) / obpD : 0;
  const slg = b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0;
  return { avg, obp, slg, ops: obp + slg };
}

export function pitRates(p) {
  const ip = p.outs / 3;
  return { ip, era: ip ? (9 * p.er) / ip : Infinity, whip: ip ? (p.h + p.bb) / ip : Infinity, k9: ip ? (9 * p.so) / ip : 0 };
}

export function leaders(season, n = 8) {
  const idx = playerIndex(season);
  const teamGames = season.teams.map(() => 0);
  for (const day of season.days) for (const g of day) if (g.score) { teamGames[g.a]++; teamGames[g.h]++; }
  const name = (id) => idx.get(id)?.p.name || id;
  const abbr = (t) => season.teams[t]?.abbr || '';
  const bats = Object.entries(season.bat).map(([id, b]) => ({ id, ...b, ...batRates(b) }));
  const pits = Object.entries(season.pit).map(([id, p]) => ({ id, ...p, ...pitRates(p) }));
  const qualB = (b) => b.pa >= 3.1 * Math.max(1, teamGames[b.team]);
  const qualP = (p) => p.ip >= 1.0 * Math.max(1, teamGames[p.team]);
  const top = (list, key, dir, show, filter = () => true) => list.filter(filter)
    .sort((a, b) => (dir > 0 ? b[key] - a[key] : a[key] - b[key])).slice(0, n)
    .map((x) => ({ id: x.id, name: name(x.id), team: abbr(x.team), value: show(x) }));
  return {
    batting: [
      { label: 'AVG', list: top(bats, 'avg', 1, (x) => fmt3(x.avg), qualB) },
      { label: 'HR', list: top(bats, 'hr', 1, (x) => x.hr) },
      { label: 'RBI', list: top(bats, 'rbi', 1, (x) => x.rbi) },
      { label: 'OPS', list: top(bats, 'ops', 1, (x) => fmt3(x.ops), qualB) },
      { label: 'SB', list: top(bats, 'sb', 1, (x) => x.sb) },
      { label: 'H', list: top(bats, 'h', 1, (x) => x.h) },
    ],
    pitching: [
      { label: 'ERA', list: top(pits, 'era', -1, (x) => x.era.toFixed(2), qualP) },
      { label: 'W', list: top(pits, 'w', 1, (x) => x.w) },
      { label: 'SO', list: top(pits, 'so', 1, (x) => x.so) },
      { label: 'SV', list: top(pits, 'sv', 1, (x) => x.sv) },
      { label: 'WHIP', list: top(pits, 'whip', -1, (x) => x.whip.toFixed(2), qualP) },
      { label: 'IP', list: top(pits, 'ip', 1, (x) => ipStr(x.outs)) },
    ],
    qualified: { pa: '3.1 PA per team game', ip: '1 IP per team game' },
  };
}

export { fmt3 };
