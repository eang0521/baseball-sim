// Team persistence in localStorage, one saved set per league.
// 'custom' is the fictional league; 'mlb-YYYY' leagues start from js/data/mlb/YYYY.json.
import { defaultTeams, normalizeTeam } from './teams.js';

const KEY = 'bbsim.teams.v1';
const PREFS = 'bbsim.prefs.v1';

const keyFor = (league) => (league === 'custom' ? KEY : `${KEY}.${league}`);
const mlbSeason = (league) => +String(league).replace('mlb-', '');

// Leagues available to pick from: the fictional one plus every imported MLB season.
export async function listLeagues() {
  const leagues = [{ id: 'custom', name: 'Diamond League (fictional)' }];
  try {
    const r = await fetch('js/data/mlb/index.json');
    if (r.ok) {
      const { seasons } = await r.json();
      for (const y of [...seasons].sort((a, b) => b - a)) leagues.push({ id: `mlb-${y}`, name: `MLB ${y}` });
    }
  } catch (e) { /* offline or not imported yet */ }
  return leagues;
}

function loadSaved(league) {
  try {
    const raw = localStorage.getItem(keyFor(league));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length >= 2) return arr.map(normalizeTeam);
    }
  } catch (e) {
    console.warn('Could not load teams', e);
  }
  return null;
}

async function freshTeams(league) {
  if (league === 'custom') return defaultTeams();
  const r = await fetch(`js/data/mlb/${mlbSeason(league)}.json`);
  if (!r.ok) throw new Error(`Could not load ${league} rosters (${r.status})`);
  const data = await r.json();
  return data.teams.map(normalizeTeam);
}

export async function loadTeams(league = 'custom') {
  return loadSaved(league) || freshTeams(league);
}

export function saveTeams(teams, league = 'custom') {
  try {
    localStorage.setItem(keyFor(league), JSON.stringify(teams));
    return true;
  } catch (e) {
    console.warn('Could not save teams', e);
    return false;
  }
}

export async function resetTeams(league = 'custom') {
  try { localStorage.removeItem(keyFor(league)); } catch (e) { /* ignore */ }
  return freshTeams(league);
}

// ---------- season ----------
const SEASON = 'bbsim.season.v1';

export function loadSeason() {
  try {
    const s = JSON.parse(localStorage.getItem(SEASON));
    return s && s.version === 1 && Array.isArray(s.days) ? s : null;
  } catch (e) {
    return null;
  }
}

export function saveSeason(season) {
  try {
    localStorage.setItem(SEASON, JSON.stringify(season));
    return true;
  } catch (e) {
    console.warn('Could not save season', e);
    return false;
  }
}

export function clearSeason() {
  try { localStorage.removeItem(SEASON); } catch (e) { /* ignore */ }
}

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS)) || {};
  } catch (e) {
    return {};
  }
}

export function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) { /* ignore */ }
}
