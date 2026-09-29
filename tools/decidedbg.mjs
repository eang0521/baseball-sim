import { Play } from '../js/sim/play.js';
const orig = Play.prototype.holderDecide;
Play.prototype.holderDecide = function (h) {
  const r = this.runners.map((q) => `${q.origin}:s=${q.s.toFixed(1)} v=${q.v.toFixed(1)} eta2=${this.runnerETA(q, q.origin + 1).toFixed(2)}`).join(' | ');
  console.log(`t=${this.t.toFixed(2)} ${h.pos} at (${h.x.toFixed(1)},${h.y.toFixed(1)}) runners ${r}`);
  return orig.call(this, h);
};
await import('./trace.mjs');
