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
    // like MLB, no automatic runner on second in postseason extra innings
    extraRunner: g.id < PO_BASE,
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

// Record any finished game: regular season or postseason.
export function recordResult(season, res) {
  if (res.id >= PO_BASE) return recordPlayoffResult(season, res);
  const g = gameAt(season, res.id);
  if (!g || g.score) return;
  g.score = res.score;
  if (res.innings !== 9) g.inn = res.innings;
  addStats(season.bat, season.pit, g, res);
}

function addStats(bat, pit, g, res) {
  res.sides.forEach((sd, k) => {
    const team = k === 0 ? g.a : g.h;
    for (const [pid, b] of sd.bat) {
      if (!b.pa && !b.sb && !b.cs && !b.r) continue;
      const t = (bat[pid] ||= { team, g: 0 });
      t.team = team;
      t.g++;
      for (const key of BAT_KEYS) t[key] = (t[key] || 0) + (b[key] || 0);
    }
    sd.pit.forEach(([pid, l], i) => {
      const t = (pit[pid] ||= { team, g: 0, gs: 0, w: 0, l: 0, sv: 0 });
      t.team = team;
      t.g++;
      if (i === 0) t.gs++;
      for (const key of PIT_KEYS) t[key] = (t[key] || 0) + (l[key] || 0);
    });
  });
  if (pit[res.wp]) pit[res.wp].w++;
  if (pit[res.lp]) pit[res.lp].l++;
  if (res.sv && pit[res.sv]) pit[res.sv].sv++;
}

// Move to the next day once every game today has a result; when the regular season ends,
// the postseason field is set.
export function advanceIfDone(season) {
  while (!isOver(season) && season.days[season.day].every((g) => g.score)) {
    season.day++;
    prepareDay(season);
  }
  if (isOver(season) && !season.playoffs) startPlayoffs(season);
}

// ---------- postseason ----------
// MLB format (2022 on), used whenever the league has two leagues split into divisions:
// six clubs per league (three division winners seeded 1-3 by record, three wild cards 4-6).
// Seeds 1 and 2 get byes. Wild Card Series, best of 3, all at the higher seed: 3 v 6, 4 v 5.
// Division Series, best of 5 (2-2-1): 1 v the 4/5 winner, 2 v the 3/6 winner. League
// Championship Series and World Series, best of 7 (2-3-2); the World Series host is the club
// with the better regular-season record. Other leagues get a simpler top-four bracket.
export const PO_BASE = 100000;

const PATTERN = {
  3: [1, 1, 1],
  5: [1, 1, 0, 0, 1],
  7: [1, 1, 0, 0, 0, 1, 1],
};

export function startPlayoffs(season) {
  const rows = standings(season);
  const h2h = headToHead(season);
  // record, then head-to-head, then run differential, then a coin flip (seeded)
  const rng = new RNG(season.seed + 17);
  const tie = new Map(rows.map((r) => [r.i, rng.next()]));
  const cmp = (a, b) => b.pct - a.pct || (h2h(b.i, a.i) - h2h(a.i, b.i)) || ((b.rs - b.ra) - (a.rs - a.ra)) || tie.get(a.i) - tie.get(b.i);
  const leagues = [...new Set(season.teams.map((t) => t.league).filter(Boolean))];
  const mlb = leagues.length === 2 && season.teams.every((t) => t.league && t.division) &&
    leagues.every((l) => rows.filter((r) => r.team.league === l).length >= 6);
  const po = { format: mlb ? 'mlb' : 'simple', rounds: [], seeds: {}, day: 0, nextId: PO_BASE, prot: {}, champion: null, bat: {}, pit: {} };
  const mk = (best, hi, lo, hiSeed, loSeed, league) => ({ best, hi, lo, hiSeed, loSeed, league, wins: [0, 0], games: [], winner: null });

  if (mlb) {
    const byLeague = {};
    for (const lg of leagues.sort()) {
      const lr = rows.filter((r) => r.team.league === lg);
      const divs = [...new Set(lr.map((r) => r.team.division))];
      const winners = divs.map((d) => lr.filter((r) => r.team.division === d).sort(cmp)[0]).sort(cmp);
      const wild = lr.filter((r) => !winners.includes(r)).sort(cmp).slice(0, 3);
      const seeds = [...winners, ...wild].map((r) => r.i);
      po.seeds[lg] = seeds;
      byLeague[lg] = seeds;
    }
    const short = (lg) => (/American/.test(lg) ? 'AL' : /National/.test(lg) ? 'NL' : lg);
    const wc = [], ds = [], lcs = [];
    for (const lg of Object.keys(byLeague)) {
      const s = byLeague[lg];
      wc.push(mk(3, s[2], s[5], 3, 6, lg), mk(3, s[3], s[4], 4, 5, lg));
      ds.push(mk(5, s[0], null, 1, null, lg), mk(5, s[1], null, 2, null, lg));
      lcs.push(mk(7, null, null, null, null, lg));
    }
    // where each winner goes: [round, series, slot] (slot 'lo' = lower seed side)
    wc.forEach((sr, k) => { sr.to = [1, k % 2 === 0 ? Math.floor(k / 2) * 2 + 1 : Math.floor(k / 2) * 2, 'lo']; });
    ds.forEach((sr, k) => { sr.to = [2, Math.floor(k / 2), null]; });
    lcs.forEach((sr, k) => { sr.to = [3, 0, null]; });
    po.rounds = [
      { name: 'Wild Card Series', short: 'WC', series: wc },
      { name: 'Division Series', short: 'DS', series: ds },
      { name: 'League Championship Series', short: 'CS', series: lcs },
      { name: 'World Series', short: 'WS', series: [mk(7, null, null, null, null, 'World Series')] },
    ];
    for (const sr of lcs) sr.label = `${short(sr.league)}CS`;
    for (const sr of ds) sr.label = `${short(sr.league)}DS`;
    for (const sr of wc) sr.label = `${short(sr.league)} Wild Card`;
    po.rounds[3].series[0].label = 'World Series';
  } else {
    const order = [...rows].sort(cmp).map((r) => r.i);
    po.seeds.League = order.slice(0, Math.min(4, order.length));
    if (order.length >= 4) {
      const semis = [mk(7, order[0], order[3], 1, 4, 'League'), mk(7, order[1], order[2], 2, 3, 'League')];
      semis.forEach((sr, k) => { sr.to = [1, 0, null]; sr.label = 'Semifinal'; });
      po.rounds = [
        { name: 'Semifinals', short: 'SF', series: semis },
        { name: 'Championship Series', short: 'F', series: [{ ...mk(7, null, null, null, null, 'League'), label: 'Championship' }] },
      ];
    } else {
      po.rounds = [{ name: 'Championship Series', short: 'F', series: [{ ...mk(7, order[0], order[1], 1, 2, 'League'), label: 'Championship' }] }];
    }
  }
  // rotations reset for October: aces first
  season.playoffs = po;
  return po;
}

function headToHead(season) {
  const w = new Map();
  for (const day of season.days) for (const g of day) {
    if (!g.score) continue;
    const win = g.score[1] > g.score[0] ? g.h : g.a, loss = win === g.h ? g.a : g.h;
    const k = `${win}-${loss}`;
    w.set(k, (w.get(k) || 0) + 1);
  }
  return (a, b) => w.get(`${a}-${b}`) || 0;
}

const needed = (sr) => Math.floor(sr.best / 2) + 1;

// The round being played: the first with an undecided series.
export function activeRound(season) {
  const po = season.playoffs;
  if (!po) return -1;
  return po.rounds.findIndex((r) => r.series.some((s) => s.winner == null));
}

// Today's postseason games (created on demand): the next game of every live series in the
// active round. Empty once there's a champion.
export function playoffToday(season) {
  const po = season.playoffs;
  const r = activeRound(season);
  if (!po || r < 0) return [];
  const out = [];
  for (const sr of po.rounds[r].series) {
    if (sr.winner != null || sr.hi == null || sr.lo == null) continue;
    let g = sr.games[sr.games.length - 1];
    if (!g || g.score) {
      const n = sr.games.length;
      const hiHome = PATTERN[sr.best][n] === 1;
      g = { id: po.nextId++, a: hiHome ? sr.lo : sr.hi, h: hiHome ? sr.hi : sr.lo, n: n + 1 };
      g.aSP = playoffStarter(season, g.a);
      g.hSP = playoffStarter(season, g.h);
      sr.games.push(g);
    }
    out.push(g);
  }
  return out;
}

// Four-man playoff rotation in rotation order.
function playoffStarter(season, t) {
  const po = season.playoffs;
  const sps = season.teams[t].pitchers.filter((p) => p.role === 'SP').slice(0, 4);
  const pool = sps.length ? sps : season.teams[t].pitchers;
  const k = po.prot[t] || 0;
  po.prot[t] = k + 1;
  return pool[k % pool.length].id;
}

export function findSeries(season, id) {
  for (const [ri, round] of (season.playoffs?.rounds || []).entries()) {
    for (const sr of round.series) {
      const g = sr.games.find((x) => x.id === id);
      if (g) return { ri, sr, g };
    }
  }
  return null;
}

function recordPlayoffResult(season, res) {
  const po = season.playoffs;
  const f = findSeries(season, res.id);
  if (!f || f.g.score) return;
  const { sr, g } = f;
  g.score = res.score;
  if (res.innings !== 9) g.inn = res.innings;
  addStats(po.bat, po.pit, g, res);
  const winner = res.score[1] > res.score[0] ? g.h : g.a;
  sr.wins[winner === sr.hi ? 0 : 1]++;
  if (sr.wins[0] >= needed(sr) || sr.wins[1] >= needed(sr)) {
    sr.winner = sr.wins[0] > sr.wins[1] ? sr.hi : sr.lo;
    advanceWinner(season, sr);
  }
}

function advanceWinner(season, sr) {
  const po = season.playoffs;
  if (!sr.to) { po.champion = sr.winner; return; }
  const [ri, si, slot] = sr.to;
  const next = po.rounds[ri].series[si];
  const seedOf = (t) => {
    for (const s of Object.values(po.seeds)) { const k = s.indexOf(t); if (k >= 0) return k + 1; }
    return 99;
  };
  if (slot === 'lo') { next.lo = sr.winner; next.loSeed = seedOf(sr.winner); return; }
  // fill an open side, then make the better seed (or, across leagues, the better record) the host
  if (next.hi == null) next.hi = sr.winner; else next.lo = sr.winner;
  if (next.hi != null && next.lo != null) {
    const rec = standings(season);
    const better = next.league === 'World Series'
      ? (rec[next.hi].pct !== rec[next.lo].pct ? rec[next.hi].pct > rec[next.lo].pct : (rec[next.hi].rs - rec[next.hi].ra) >= (rec[next.lo].rs - rec[next.lo].ra))
      : seedOf(next.hi) <= seedOf(next.lo);
    if (!better) [next.hi, next.lo] = [next.lo, next.hi];
    next.hiSeed = seedOf(next.hi);
    next.loSeed = seedOf(next.lo);
  }
}

export const seasonDone = (season) => isOver(season) && season.playoffs && season.playoffs.champion != null;

// One status line per series: "NYY lead 2-1", "SEA win 3-1", "Game 1 today".
export function seriesStatus(season, sr) {
  const ab = (t) => season.teams[t]?.abbr;
  if (sr.hi == null || sr.lo == null) return 'Waiting';
  const [a, b] = sr.wins;
  if (sr.winner != null) return `${ab(sr.winner)} win ${Math.max(a, b)}-${Math.min(a, b)}`;
  if (a === b) return a === 0 ? 'Not started' : `Tied ${a}-${b}`;
  return `${ab(a > b ? sr.hi : sr.lo)} lead ${Math.max(a, b)}-${Math.min(a, b)}`;
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
