// Seeded pseudo-random number generator (mulberry32) with helpers.
export class RNG {
  constructor(seed = Date.now()) {
    this.seed(seed);
  }

  seed(seed) {
    this.state = (seed >>> 0) || 0x9e3779b9;
    this._spare = null;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // Standard normal via Box-Muller.
  gauss(mean = 0, sd = 1) {
    if (this._spare !== null) {
      const s = this._spare;
      this._spare = null;
      return mean + sd * s;
    }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this._spare = mag * Math.sin(2 * Math.PI * v);
    return mean + sd * mag * Math.cos(2 * Math.PI * v);
  }

  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}
