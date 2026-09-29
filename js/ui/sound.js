// Tiny synthesized sound effects (no audio files): bat crack, mitt pop, crowd.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('bbsim.muted') === '1'; } catch (e) { /* ignore */ }
    const btn = document.getElementById('btn-sound');
    if (btn) {
      const sync = () => { btn.textContent = this.muted ? '🔇' : '🔊'; };
      sync();
      btn.addEventListener('click', () => {
        this.muted = !this.muted;
        try { localStorage.setItem('bbsim.muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
        sync();
        this.unlock();
      });
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  burst({ dur = 0.08, freq = 2000, q = 1, gain = 0.8, type = 'bandpass', attack = 0.002 }) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  crowd(level, dur) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.5;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  onEvent(ev, speed) {
    if (this.muted || !this.ctx || speed > 4) return;
    switch (ev.type) {
      case 'contact': {
        const hard = ev.bb.ev > 95;
        this.burst({ dur: hard ? 0.12 : 0.07, freq: hard ? 2600 : 1800, q: 2, gain: hard ? 1 : 0.5 });
        this.burst({ dur: 0.05, freq: 5200, q: 3, gain: 0.4 });
        if (hard && ev.bb.la > 15 && ev.bb.la < 40) this.crowd(0.25, 2.5);
        break;
      }
      case 'foul':
        this.burst({ dur: 0.05, freq: 2200, q: 2, gain: 0.3 });
        break;
      case 'mitt':
        this.burst({ dur: 0.05, freq: 700, q: 1.5, gain: 0.4 });
        break;
      case 'homerun':
        this.crowd(0.6, 5);
        break;
      case 'playResult':
        if (ev.hitBases > 0 && ev.hitBases < 4) this.crowd(0.3, 2.2);
        else if (ev.res && ev.res.runs && ev.res.runs.length) this.crowd(0.35, 2.5);
        break;
      case 'strikeout':
        this.crowd(0.15, 1.5);
        break;
      case 'final':
        this.crowd(0.5, 4);
        break;
      default:
        break;
    }
  }
}
