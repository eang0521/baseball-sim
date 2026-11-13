// Background game simulator for season mode. Receives the season (rosters + seed) once, then
// sims scheduled games on request and posts back compact results.
import { simGame } from './season.js';

let season = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    season = m.season;
    return;
  }
  if (m.type === 'play') {
    try {
      const res = simGame(season, m.game);
      self.postMessage({ type: 'result', res });
    } catch (err) {
      self.postMessage({ type: 'error', id: m.game.id, message: String(err && err.message || err) });
    }
  }
};
