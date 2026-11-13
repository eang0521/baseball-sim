// Build real MLB rosters for the sim from public data.
//
//   node tools/mlb/import.mjs [season]      (default: the most recent completed regular season)
//
// Sources: MLB Stats API (season stat lines, handedness, jersey numbers, games by position) and
// Baseball Savant leaderboards (sprint speed, outs above average, arm strength, catcher pop time,
// pitch velocity and per-pitch whiff / xwOBA). Raw downloads are cached in tools/mlb/cache/.
//
// How stat lines become ratings:
//   1. Each player's rates (K%, BB+HBP%, HR%, singles%, XBH% per PA) are blended over three seasons
//      with 5/4/3 weights, expressed relative to that season's league, and regressed toward
//      average with stat-specific stabilization constants (so a hot 80 PA doesn't make an MVP).
//   2. tools/mlb/calibrate.mjs measured how the sim's ratings produce those same rates. We search
//      for the contact / power / eye (hitters) or control / stuff (pitchers) that make the sim
//      reproduce the player's rates relative to the sim's own league average.
//   3. Physical tools come from Statcast directly: sprint speed -> speed, OAA -> fielding,
//      throw velocity -> arm, fastball velocity -> velo, pitches per outing -> stamina,
//      per-pitch whiff and xwOBA -> the spread of ratings across a pitcher's arsenal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { terms } from './model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, 'cache');
const OUTDIR = join(here, '..', '..', 'js', 'data', 'mlb');
const CAL = JSON.parse(readFileSync(join(OUTDIR, 'calibration.json'), 'utf8'));
// League-wide correction factors written by validate.mjs --adjust (closes the gap between the
// sim's league totals and the real ones once real rosters face each other).
const ADJ_FILE = join(here, 'league_adjust.json');
const ADJ_ALL = existsSync(ADJ_FILE) ? JSON.parse(readFileSync(ADJ_FILE, 'utf8')) : {};
mkdirSync(CACHE, { recursive: true });

const API = 'https://statsapi.mlb.com/api/v1';
const SAV = 'https://baseballsavant.mlb.com/leaderboard';
const UA = { 'User-Agent': 'baseball-sim-roster-import/1.0' };

// ---------- fetching ----------
async function get(url, file, text = false) {
  const path = join(CACHE, file);
  if (existsSync(path)) return text ? readFileSync(path, 'utf8') : JSON.parse(readFileSync(path, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const body = await r.text();
      writeFileSync(path, body);
      return text ? body : JSON.parse(body);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const csv = async (path, file) => parseCSV(await get(`${SAV}/${path}`, file, true));
const statSplits = async (group, season) =>
  (await get(`${API}/stats?stats=season&group=${group}&season=${season}&sportId=1&playerPool=All&limit=5000`, `${group}_${season}.json`)).stats[0]?.splits || [];
const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);
const clamp = (v, a = 20, b = 99) => Math.max(a, Math.min(b, Math.round(v)));

// ---------- team colors (primary, secondary) ----------
const COLORS = {
  AZ: ['#a71930', '#e3d4ad'], ATL: ['#13274f', '#ce1141'], BAL: ['#df4601', '#000000'], BOS: ['#bd3039', '#0c2340'],
  CHC: ['#0e3386', '#cc3433'], CWS: ['#27251f', '#c4ced4'], CIN: ['#c6011f', '#ffffff'], CLE: ['#00385d', '#e50022'],
  COL: ['#33006f', '#c4ced4'], DET: ['#0c2340', '#fa4616'], HOU: ['#002d62', '#eb6e1f'], KC: ['#004687', '#bd9b60'],
  LAA: ['#ba0021', '#003263'], LAD: ['#005a9c', '#ffffff'], MIA: ['#00a3e0', '#ef3340'], MIL: ['#12284b', '#ffc52f'],
  MIN: ['#002b5c', '#d31145'], NYM: ['#002d72', '#ff5910'], NYY: ['#0c2340', '#c4ced3'], ATH: ['#003831', '#efb21e'],
  PHI: ['#e81828', '#002d72'], PIT: ['#27251f', '#fdb827'], SD: ['#2f241d', '#ffc425'], SF: ['#fd5a1e', '#27251f'],
  SEA: ['#0c2c56', '#005c5c'], STL: ['#c41e3a', '#0c2340'], TB: ['#092c5c', '#8fbce6'], TEX: ['#003278', '#c0111f'],
  TOR: ['#134a8e', '#e8291c'], WSH: ['#ab0003', '#14225a'],
};

// Same positional shape as the fictional teams (js/data/teams.js), so 55 stays "average".
const ARCH_FLD = { C: 6, '1B': -4, '2B': 6, '3B': 4, SS: 10, LF: -4, CF: 8, RF: 0, DH: -20 };
const ARCH_ARM = { C: 8, '1B': -8, '2B': -2, '3B': 10, SS: 8, LF: -2, CF: 2, RF: 10, DH: -15 };
const POS_CODE = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };
const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

// ---------- rate helpers ----------
const OUT = ['k', 'bb', 'hr', 'h1', 'xbh'];
function rates(s, pa) {
  const xbh = (s.doubles || 0) + (s.triples || 0);
  return {
    pa,
    k: s.strikeOuts || 0, bb: (s.baseOnBalls || 0) + (s.hitByPitch || 0), hr: s.homeRuns || 0,
    h1: (s.hits || 0) - (s.homeRuns || 0) - xbh, xbh,
  };
}
function addTo(t, r) { for (const k of ['pa', ...OUT]) t[k] = (t[k] || 0) + r[k]; return t; }
const leagueRate = (tot) => Object.fromEntries(OUT.map((o) => [o, tot[o] / tot.pa]));

// Stabilization constants (PA / BF of league-average performance mixed in).
const REG_HIT = { k: 70, bb: 130, hr: 200, h1: 500, xbh: 450 };
const REG_PIT = { k: 90, bb: 190, hr: 700, h1: 1100, xbh: 1100 };
const YEAR_W = [5, 4, 3];

// Blend a player's seasons into "rate relative to league" multipliers, regressed toward 1.
function relRates(lines, reg) {
  const out = {};
  for (const o of OUT) {
    let num = 0, den = 0;
    for (const { r, lg, w } of lines) {
      if (!r.pa) continue;
      num += w * r[o] / lg[o];
      den += w * r.pa;
    }
    out[o] = (num + reg[o]) / (den + reg[o]);
  }
  return out;
}

// ---------- calibration model ----------
function model(side, o, x) {
  const m = CAL[side].models[o];
  const t = terms(x);
  let s = 0;
  for (let i = 0; i < t.length; i++) s += m.coef[i] * t[i];
  return Math.max(0.0005, s);
}
// How much each rate matters when fitting, roughly 1 / (spread among MLB regulars).
const SIG = { k: 0.045, bb: 0.025, hr: 0.011, h1: 0.025, xbh: 0.014 };

// Coarse-to-fine search over integer ratings. free: indices of x that are searched.
function search(side, base, free, target, weights) {
  const loss = (x) => {
    let L = 0;
    for (const o of OUT) {
      if (!weights[o]) continue;
      L += weights[o] * ((model(side, o, x) - target[o]) / SIG[o]) ** 2;
    }
    for (const i of free) L += ((x[i] - 55) / 45) ** 2; // mild pull toward average
    return L;
  };
  let best = [...base], bestL = loss(best);
  const scan = (lo, hi, step, center) => {
    const ranges = free.map((i) => {
      const a = center ? Math.max(20, center[i] - lo) : 20, b = center ? Math.min(99, center[i] + hi) : 99;
      const vals = [];
      for (let v = a; v <= b; v += step) vals.push(v);
      return vals;
    });
    const x = [...best];
    const rec = (d) => {
      if (d === free.length) {
        const L = loss(x);
        if (L < bestL) { bestL = L; best = [...x]; }
        return;
      }
      for (const v of ranges[d]) { x[free[d]] = v; rec(d + 1); }
    };
    rec(0);
  };
  scan(0, 0, 4, null);
  scan(4, 4, 1, best);
  return best;
}

// ---------- main ----------
async function main() {
  let season = +process.argv[2];
  if (!season) {
    const now = new Date();
    for (let y = now.getFullYear(); y > 2015; y--) {
      const s = (await get(`${API}/seasons/${y}?sportId=1`, `season_${y}.json`)).seasons?.[0];
      if (s && new Date(s.regularSeasonEndDate) < now) { season = y; break; }
    }
  }
  const years = [season, season - 1, season - 2];
  const ADJ = ADJ_ALL[season] || { hitter: {}, pitcher: {} };
  console.log(`Importing ${season} (blending ${years.join(', ')})`);

  const [teamsRes, peopleRes] = await Promise.all([
    get(`${API}/teams?sportId=1&season=${season}`, `teams_${season}.json`),
    get(`${API}/sports/1/players?season=${season}`, `players_${season}.json`),
  ]);
  const people = new Map(peopleRes.people.map((p) => [p.id, p]));
  const hitting = {}, pitching = {};
  for (const y of years) {
    hitting[y] = await statSplits('hitting', y);
    pitching[y] = await statSplits('pitching', y);
  }
  const fielding = await statSplits('fielding', season);

  const sprint = new Map();
  for (const y of [season - 1, season]) {
    for (const r of await csv(`sprint_speed?year=${y}&position=&team=&min=0&csv=true`, `sprint_${y}.csv`)) {
      const v = num(r.sprint_speed), n = num(r.competitive_runs) || 1;
      if (v == null) continue;
      const prev = sprint.get(r.player_id);
      // weight current season more; a few runs is enough for sprint speed to stabilize
      const w = n * (y === season ? 2 : 1);
      sprint.set(r.player_id, prev ? { v: (prev.v * prev.w + v * w) / (prev.w + w), w: prev.w + w } : { v, w });
    }
  }
  const oaa = new Map((await csv(`outs_above_average?type=Fielder&startYear=${season}&endYear=${season}&min=0&csv=true`, `oaa_${season}.csv`))
    .map((r) => [r.player_id, { pos: r.primary_pos_formatted, oaa: num(r.outs_above_average) }]));
  const arm = new Map((await csv(`arm-strength?type=player&year=${season}&minThrows=0&csv=true`, `arm_${season}.csv`))
    .map((r) => [r.player_id, r]));
  const pop = new Map((await csv(`poptime?year=${season}&team=&min2b=1&min3b=0&csv=true`, `pop_${season}.csv`))
    .map((r) => [r.entity_id, r]));
  const speeds = new Map((await csv(`pitch-arsenals?year=${season}&min=1&type=avg_speed&hand=&csv=true`, `velo_${season}.csv`))
    .map((r) => [r.pitcher, r]));
  const arsenal = new Map();
  for (const r of await csv(`pitch-arsenal-stats?type=pitcher&pitchType=&year=${season}&team=&min=1&csv=true`, `arsenal_${season}.csv`)) {
    if (!arsenal.has(r.player_id)) arsenal.set(r.player_id, []);
    arsenal.get(r.player_id).push(r);
  }

  // League rates per season (position players only for hitting; everyone for pitching).
  const lgHit = {}, lgPit = {};
  for (const y of years) {
    const th = {}, tp = {};
    for (const s of hitting[y]) if (s.position?.abbreviation !== 'P') addTo(th, rates(s.stat, s.stat.plateAppearances || 0));
    for (const s of pitching[y]) addTo(tp, rates(s.stat, s.stat.battersFaced || 0));
    lgHit[y] = leagueRate(th);
    lgPit[y] = leagueRate(tp);
  }
  const hitByYear = Object.fromEntries(years.map((y) => [y, new Map(hitting[y].map((s) => [s.player.id, s]))]));
  const pitByYear = Object.fromEntries(years.map((y) => [y, new Map(pitching[y].map((s) => [s.player.id, s]))]));

  // Games started by position (whole season, all teams).
  const posGames = new Map();
  for (const f of fielding) {
    const pos = f.position?.abbreviation;
    if (!FIELD.includes(pos)) continue;
    if (!posGames.has(f.player.id)) posGames.set(f.player.id, {});
    const g = posGames.get(f.player.id);
    g[pos] = (g[pos] || 0) + (f.stat.gamesStarted || 0) + 0.25 * ((f.stat.games || 0) - (f.stat.gamesStarted || 0));
    g[`${pos}_inn`] = (g[`${pos}_inn`] || 0) + (+f.stat.innings || 0);
  }

  // Arm-strength spread by position, for z-scores.
  const armCol = { '1B': 'arm_1b', '2B': 'arm_2b', '3B': 'arm_3b', SS: 'arm_ss', LF: 'arm_lf', CF: 'arm_cf', RF: 'arm_rf' };
  const armStats = {};
  for (const [pos, col] of Object.entries(armCol)) {
    const v = [...arm.values()].map((r) => num(r[col])).filter((x) => x != null);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    armStats[pos] = { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 2 };
  }
  const popVals = [...pop.values()].filter((r) => num(r.pop_2b_sba_count) >= 5);
  const meanOf = (arr, k) => arr.reduce((a, r) => a + num(r[k]), 0) / arr.length;
  const popM = meanOf(popVals, 'pop_2b_sba'), cArmM = meanOf(popVals, 'maxeff_arm_2b_3b_sba');

  const hitSim55 = Object.fromEntries(OUT.map((o) => [o, model('hitter', o, [55, 55, 55, 55])]));
  const pitSim55 = Object.fromEntries(OUT.map((o) => [o, model('pitcher', o, [55, 55, 55])]));

  // ---------- hitters ----------
  function speedOf(id, s) {
    const sp = sprint.get(String(id));
    if (sp) return clamp(55 + (sp.v - 27.0) * 9);
    // no Statcast runs: lean on stolen bases and triples
    const pa = Math.max(1, s.plateAppearances || 1);
    return clamp(48 + ((s.stolenBases || 0) * 600) / (pa + 300) * 2.2 + ((s.triples || 0) * 600) / (pa + 300) * 3);
  }

  function makeHitter(id, pos) {
    const p = people.get(id) || {};
    const cur = hitByYear[season].get(id);
    const lines = years.map((y, i) => {
      const s = hitByYear[y].get(id);
      return s ? { r: rates(s.stat, s.stat.plateAppearances || 0), lg: lgHit[y], w: YEAR_W[i] } : null;
    }).filter(Boolean);
    const rel = relRates(lines, REG_HIT);
    const speed = speedOf(id, cur.stat);
    const target = Object.fromEntries(OUT.map((o) => [o, hitSim55[o] * rel[o] * (ADJ.hitter[o] ?? 1)]));
    const w = { k: 1.2, bb: 1, hr: 1.1, h1: 0.6, xbh: 0.7 };
    const [contact, power, eye] = search('hitter', [55, 55, 55, speed], [0, 1, 2], target, w);

    // fielding: OAA per ~1200 innings, regressed; catchers use pop time instead
    const g = posGames.get(id) || {};
    let fielding = 55 + ARCH_FLD[pos], armR = 55 + ARCH_ARM[pos];
    if (pos === 'C') {
      const pr = pop.get(String(id));
      if (pr && num(pr.pop_2b_sba) != null) {
        const n = num(pr.pop_2b_sba_count) || 0;
        const k = n / (n + 10);
        fielding += k * ((popM - num(pr.pop_2b_sba)) / 0.05) * 6;
        armR += k * (num(pr.maxeff_arm_2b_3b_sba) - cArmM) * 3;
        const ex = num(pr.exchange_2b_3b_sba);
        if (ex != null) fielding += k * ((0.68 - ex) / 0.05) * 3;
      }
    } else if (pos !== 'DH') {
      const o = oaa.get(String(id));
      const inn = g[`${pos}_inn`] || 0;
      if (o && o.oaa != null) fielding += (o.oaa * 1200) / (Math.max(inn, 300) + 500) * 1.6;
      const a = arm.get(String(id));
      const v = a && num(a[armCol[pos]]) != null ? num(a[armCol[pos]]) : a && num(a.arm_overall);
      if (v != null) {
        const n = num(a.total_throws) || 0;
        armR += (n / (n + 30)) * ((v - armStats[pos].m) / armStats[pos].sd) * 10;
      }
    } else {
      // a DH still needs ratings if he's ever pressed into the field
      fielding = 32; armR = 40;
    }
    const s = cur.stat;
    return {
      id: `mlb${id}`, name: p.fullName || cur.player.fullName, num: +(p.primaryNumber ?? 0) || 0, pos,
      bats: p.batSide?.code === 'L' ? 'L' : p.batSide?.code === 'S' ? 'S' : 'R',
      contact, power, eye, speed, fielding: clamp(fielding), arm: clamp(armR),
      // other spots he played this season (at least ~8 starts' worth), so the coach can move him
      alt: FIELD.filter((x) => x !== pos && (g[x] || 0) >= 8),
      real: `${s.avg}/${s.obp}/${s.slg}, ${s.homeRuns} HR, ${s.stolenBases} SB in ${s.plateAppearances} PA`,
    };
  }

  // ---------- pitchers ----------
  const PMAP = { FF: 'FF', SI: 'SI', FC: 'FC', SL: 'SL', ST: 'SL', SV: 'CU', CU: 'CU', KC: 'CU', CS: 'CU', CH: 'CH', SC: 'CH', FS: 'FS', FO: 'FS', KN: 'CH', EP: 'CU' };
  // per-pitch-type means for whiff% and xwOBA, to judge each pitch against its peers
  const pitchNorm = {};
  for (const rows of arsenal.values()) for (const r of rows) {
    const t = PMAP[r.pitch_type]; if (!t) continue;
    const n = num(r.pitches) || 0; if (n < 150) continue;
    const pn = (pitchNorm[t] ||= { n: 0, wh: 0, wh2: 0, xw: 0, xw2: 0 });
    const wh = num(r.whiff_percent) ?? 0, xw = num(r.est_woba) ?? 0.32;
    pn.n += n; pn.wh += n * wh; pn.wh2 += n * wh * wh; pn.xw += n * xw; pn.xw2 += n * xw * xw;
  }
  for (const pn of Object.values(pitchNorm)) {
    pn.whM = pn.wh / pn.n; pn.whS = Math.sqrt(pn.wh2 / pn.n - pn.whM ** 2);
    pn.xwM = pn.xw / pn.n; pn.xwS = Math.sqrt(pn.xw2 / pn.n - pn.xwM ** 2);
  }

  function repertoire(id) {
    const rows = arsenal.get(String(id)) || [];
    const merged = {};
    for (const r of rows) {
      const t = PMAP[r.pitch_type]; if (!t) continue;
      const n = num(r.pitches) || 0;
      const m = (merged[t] ||= { type: t, n: 0, use: 0, wh: 0, xw: 0 });
      m.n += n; m.use += num(r.pitch_usage) || 0;
      m.wh += n * (num(r.whiff_percent) ?? pitchNorm[t].whM);
      m.xw += n * (num(r.est_woba) ?? pitchNorm[t].xwM);
    }
    const list = Object.values(merged).filter((m) => m.n > 0 && m.use >= 4).sort((a, b) => b.use - a.use).slice(0, 5);
    for (const m of list) {
      const pn = pitchNorm[m.type];
      const k = m.n / (m.n + 250);
      const zW = ((m.wh / m.n - pn.whM) / pn.whS) * k;
      const zX = ((pn.xwM - m.xw / m.n) / pn.xwS) * k;
      m.q = 0.6 * zW + 0.4 * zX;
    }
    return list;
  }

  function veloOf(id) {
    const r = speeds.get(String(id));
    if (!r) return null;
    const ff = num(r.ff_avg_speed), si = num(r.si_avg_speed), fc = num(r.fc_avg_speed);
    if (ff) return ff;
    if (si) return si / 0.975;
    if (fc) return fc / 0.94;
    return null;
  }

  function makePitcher(id, role) {
    const p = people.get(id) || {};
    const cur = pitByYear[season].get(id);
    const lines = years.map((y, i) => {
      const s = pitByYear[y].get(id);
      return s ? { r: rates(s.stat, s.stat.battersFaced || 0), lg: lgPit[y], w: YEAR_W[i] } : null;
    }).filter(Boolean);
    const rel = relRates(lines, REG_PIT);
    const velo = Math.max(80, Math.min(103, Math.round(veloOf(id) ?? 93.5)));
    const veloF = 55 + (velo - 94) * 4; // same scale used in calibration
    const target = Object.fromEntries(OUT.map((o) => [o, pitSim55[o] * rel[o] * (ADJ.pitcher[o] ?? 1)]));
    const [, control, stuff] = search('pitcher', [veloF, 55, 55], [1, 2], target, { k: 1.2, bb: 1.2, hr: 0.6, h1: 0.2, xbh: 0.2 });

    let rep = repertoire(id);
    if (!rep.length) rep = [{ type: 'FF', use: 55, q: 0 }, { type: 'SL', use: 30, q: 0 }, { type: 'CH', use: 15, q: 0 }];
    const qm = rep.reduce((a, m) => a + m.q, 0) / rep.length;
    const pitches = rep.map((m) => ({ type: m.type, rating: clamp(stuff + (m.q - qm) * 7, 15, 99), usage: Math.round(m.use) }));

    const s = cur.stat;
    const g = s.gamesPlayed || 1, gs = s.gamesStarted || 0, np = s.numberOfPitches || 0;
    let stamina;
    if (role === 'SP') {
      const perStart = gs ? (np - (g - gs) * 17) / gs : 85;
      stamina = clamp(Math.max(60, perStart) / 0.86 - 15, 55, 99);
    } else {
      const perApp = gs ? 17 : np / g;
      stamina = clamp(perApp * 2.9 - 15, 18, 55);
    }
    const kp = s.battersFaced ? ((100 * s.strikeOuts) / s.battersFaced).toFixed(1) : '0.0';
    const bp = s.battersFaced ? ((100 * s.baseOnBalls) / s.battersFaced).toFixed(1) : '0.0';
    return {
      id: `mlb${id}`, name: p.fullName || cur.player.fullName, num: +(p.primaryNumber ?? 0) || 0,
      throws: p.pitchHand?.code === 'L' ? 'L' : 'R', role, velo, control, stamina, pitches,
      real: `${s.era} ERA, ${s.inningsPitched} IP, ${kp}% K, ${bp}% BB${s.saves ? `, ${s.saves} SV` : ''}${s.holds ? `, ${s.holds} HLD` : ''}`,
    };
  }

  // ---------- teams ----------
  const teams = [];
  const sorted = [...teamsRes.teams].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of sorted) {
    const abbr = t.abbreviation;
    const onTeam = (s) => s.team?.id === t.id;
    const hitters = hitting[season].filter((s) => onTeam(s) && s.position?.abbreviation !== 'P' && (s.stat.plateAppearances || 0) > 0);
    const arms = pitching[season].filter((s) => onTeam(s) && (s.stat.battersFaced || 0) > 0);

    // Lineup: greedily give each position to whoever started there most, then DH = most PA left.
    const cand = [];
    for (const h of hitters) {
      const g = posGames.get(h.player.id) || {};
      for (const pos of FIELD) if (g[pos]) cand.push({ id: h.player.id, pos, g: g[pos] + h.stat.plateAppearances / 1000 });
    }
    cand.sort((a, b) => b.g - a.g);
    const chosen = new Map(), filled = new Set();
    for (const c of cand) {
      if (filled.has(c.pos) || chosen.has(c.id)) continue;
      chosen.set(c.id, c.pos); filled.add(c.pos);
    }
    const byPA = [...hitters].sort((a, b) => b.stat.plateAppearances - a.stat.plateAppearances);
    for (const pos of FIELD) {
      if (filled.has(pos)) continue;
      const h = byPA.find((x) => !chosen.has(x.player.id));
      if (h) { chosen.set(h.player.id, pos); filled.add(pos); }
    }
    const dh = byPA.find((x) => !chosen.has(x.player.id));
    if (dh) chosen.set(dh.player.id, 'DH');
    const lineup = [...chosen].map(([id, pos]) => makeHitter(id, pos));
    orderLineup(lineup, hitByYear[season]);

    // Bench: the backup catcher with the most starts behind the plate, then the most-used others.
    const mainPos = (id) => {
      const g = posGames.get(id) || {};
      const best = FIELD.filter((x) => g[x]).sort((a, b) => g[b] - g[a])[0];
      return best || 'DH';
    };
    const left = byPA.filter((x) => !chosen.has(x.player.id));
    const benchIds = [];
    const bc = [...left].filter((x) => (posGames.get(x.player.id)?.C || 0) > 0)
      .sort((a, b) => (posGames.get(b.player.id).C) - (posGames.get(a.player.id).C))[0];
    if (bc) benchIds.push(bc.player.id);
    for (const x of left) if (benchIds.length < 4 && !benchIds.includes(x.player.id)) benchIds.push(x.player.id);
    const bench = benchIds.map((id) => makeHitter(id, id === bc?.player.id ? 'C' : mainPos(id)));

    // Staff: five starters by games started, closer by saves, setup men by holds, then relievers.
    const used = new Set();
    const take = (arr, n) => arr.filter((s) => !used.has(s.player.id)).slice(0, n).map((s) => { used.add(s.player.id); return s; });
    const sps = take([...arms].filter((s) => s.stat.gamesStarted >= 3).sort((a, b) => b.stat.gamesStarted - a.stat.gamesStarted || b.stat.outs - a.stat.outs), 5);
    const rel = arms.filter((s) => s.stat.gamesStarted < Math.max(3, s.stat.gamesPlayed / 2));
    const cl = take([...rel].sort((a, b) => b.stat.saves - a.stat.saves || b.stat.gamesFinished - a.stat.gamesFinished), 1);
    const su = take([...rel].sort((a, b) => b.stat.holds - a.stat.holds || b.stat.outs - a.stat.outs), 2);
    const rp = take([...rel].sort((a, b) => b.stat.outs - a.stat.outs), 6);
    const pitchers = [
      ...sps.map((s) => makePitcher(s.player.id, 'SP')),
      ...rp.map((s) => makePitcher(s.player.id, 'RP')),
      ...su.map((s) => makePitcher(s.player.id, 'SU')),
      ...cl.map((s) => makePitcher(s.player.id, 'CL')),
    ];
    const [primary, secondary] = COLORS[abbr] || ['#1d4ed8', '#f8fafc'];
    // "American League West" -> "AL West"
    const division = (t.division?.name || '').replace(/^American League/, 'AL').replace(/^National League/, 'NL') || undefined;
    teams.push({ id: `mlb-${abbr.toLowerCase()}`, name: t.name, abbr, primary, secondary, league: t.league?.name, division, lineup, bench, pitchers });
    console.log(`${abbr.padEnd(4)} ${lineup.map((h) => `${h.pos}:${h.name.split(' ').slice(-1)[0]}`).join(' ')} | bench ${bench.map((h) => `${h.pos}:${h.name.split(' ').slice(-1)[0]}`).join(' ')}`);
  }

  const out = {
    season,
    generated: new Date().toISOString().slice(0, 10),
    source: 'MLB Stats API and Baseball Savant (MLB Advanced Media). Ratings derived by tools/mlb/import.mjs.',
    teams,
  };
  const file = join(OUTDIR, `${season}.json`);
  writeFileSync(file, JSON.stringify(out));
  writeFileSync(join(OUTDIR, 'index.json'), JSON.stringify({ seasons: [season] }));
  console.log(`\nwrote ${file} (${teams.length} teams)`);
}

// The Book-style order: best three bat 1/2/4 (most OBP-heavy leads off, most power cleans up),
// next two bat 3 and 5, the rest in descending order.
function orderLineup(lineup, stats) {
  const st = (h) => stats.get(+h.id.slice(3))?.stat || {};
  const obp = (h) => +st(h).obp || 0.3, slg = (h) => +st(h).slg || 0.38;
  const pa = (h) => st(h).plateAppearances || 0;
  const val = (h) => (1.8 * obp(h) + slg(h)) * (pa(h) / (pa(h) + 150)) + 0.95 * (150 / (pa(h) + 150));
  const s = [...lineup].sort((a, b) => val(b) - val(a));
  const top = s.slice(0, 3);
  const lead = [...top].sort((a, b) => (obp(b) - slg(b) / 3 + b.speed / 400) - (obp(a) - slg(a) / 3 + a.speed / 400))[0];
  const rest = top.filter((h) => h !== lead);
  const clean = rest.sort((a, b) => slg(b) - slg(a))[0];
  const two = rest.find((h) => h !== clean);
  const order = [lead, two, s[3], clean, s[4], ...s.slice(5)];
  lineup.splice(0, lineup.length, ...order);
}

await main();
