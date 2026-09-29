// Team persistence in localStorage.
import { defaultTeams, normalizeTeam } from './teams.js';

const KEY = 'bbsim.teams.v1';
const PREFS = 'bbsim.prefs.v1';

export function loadTeams() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length >= 2) return arr.map(normalizeTeam);
    }
  } catch (e) {
    console.warn('Could not load teams', e);
  }
  return defaultTeams();
}

export function saveTeams(teams) {
  try {
    localStorage.setItem(KEY, JSON.stringify(teams));
    return true;
  } catch (e) {
    console.warn('Could not save teams', e);
    return false;
  }
}

export function resetTeams() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return defaultTeams();
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
