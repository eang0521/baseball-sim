import { Play } from '../js/sim/play.js';
let n = 0;
const orig = Play.prototype.holderDecide;
Play.prototype.holderDecide = function (h) {
  if (this.bunt && !this._dbg && n < 8) {
    this._dbg = true; n++;
    const by = this.fielderByPos;
    const cov = this.plan.covers;
    console.log(`t=${this.t.toFixed(2)} ${h.pos} (${h.x.toFixed(1)},${h.y.toFixed(1)}) ball ev ${this.batted.ev.toFixed(0)} spray ${this.batted.spray.toFixed(0)} | cover1 ${cov[1]?.pos} at (${cov[1]?.x.toFixed(1)},${cov[1]?.y.toFixed(1)}) cover2 ${cov[2]?.pos} | ` +
      this.runners.map((q) => `${q.origin}: s=${q.s.toFixed(1)} eta=${this.runnerETA(q, q.origin + 1).toFixed(2)}`).join(' ; ') +
      ` | throw1 ${this.throwTime(h, {x:19.4,y:19.4}, h).toFixed(2)} throw2 ${this.throwTime(h, {x:0,y:38.8}, h).toFixed(2)}`);
  }
  return orig.call(this, h);
};
process.argv[2] = 'sac';
await import('./buntcal.mjs');
