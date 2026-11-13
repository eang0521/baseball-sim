// A small pool of module workers that sim season games in parallel.
// Falls back to simming on the main thread (in small slices) if workers aren't available.
import { simGame } from './season.js';

export class SimPool {
  constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
    this.size = size;
    this.workers = [];
    this.ok = typeof Worker !== 'undefined';
    this.seasonKey = null;
  }

  ensure(season) {
    if (!this.ok) return;
    try {
      while (this.workers.length < this.size) {
        this.workers.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
      }
    } catch (e) {
      console.warn('Workers unavailable, simming on the main thread', e);
      this.ok = false;
      return;
    }
    // rosters only change when a new season starts
    const key = `${season.created}|${season.seed}`;
    if (key !== this.seasonKey) {
      const lite = { seed: season.seed, teams: season.teams };
      for (const w of this.workers) w.postMessage({ type: 'init', season: lite });
      this.seasonKey = key;
    }
  }

  // Sim the given scheduled games. onResult(res) fires as each finishes. Returns a promise that
  // resolves when all are done or the run is cancelled.
  run(season, games, onResult) {
    this.cancelled = false;
    this.ensure(season);
    const queue = [...games];
    if (!this.ok) return this.runLocal(season, queue, onResult);
    return new Promise((resolve, reject) => {
      let active = 0;
      const feed = (w) => {
        if (this.cancelled || !queue.length) {
          if (active === 0) resolve();
          return;
        }
        const g = queue.shift();
        active++;
        w.onmessage = (e) => {
          active--;
          const m = e.data;
          if (m.type === 'error') { this.cancel(); reject(new Error(m.message)); return; }
          onResult(m.res); // a game that finished still counts, even after Stop
          feed(w);
        };
        w.onerror = (err) => { this.cancel(); reject(err); };
        w.postMessage({ type: 'play', game: { id: g.id, a: g.a, h: g.h, aSP: g.aSP, hSP: g.hSP } });
      };
      for (const w of this.workers) feed(w);
    });
  }

  async runLocal(season, queue, onResult) {
    while (queue.length && !this.cancelled) {
      onResult(simGame(season, queue.shift()));
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive between games
    }
  }

  cancel() {
    this.cancelled = true;
  }
}
