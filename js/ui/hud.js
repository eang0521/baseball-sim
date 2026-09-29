// Heads-up display: scorebug, pitch info, matchup, strike zone, play-by-play and box score.
import { PITCH_TYPES } from '../sim/pitches.js';
import { ZONE, batSide } from '../sim/atbat.js';
import { ordinal } from '../sim/game.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function ip(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function batToday(b) {
  if (!b || !b.pa) return 'First PA today';
  const bits = [`${b.h}-for-${b.ab}`];
  if (b.hr) bits.push(b.hr > 1 ? `${b.hr} HR` : 'HR');
  if (b.t) bits.push(b.t > 1 ? `${b.t} 3B` : '3B');
  if (b.d) bits.push(b.d > 1 ? `${b.d} 2B` : '2B');
  if (b.rbi) bits.push(`${b.rbi} RBI`);
  if (b.bb) bits.push(b.bb > 1 ? `${b.bb} BB` : 'BB');
  if (b.so) bits.push(b.so > 1 ? `${b.so} K` : 'K');
  return bits.join(', ');
}

export class Hud {
  constructor() {
    this.cache = {};
    this.logIndex = 0;
    this.bannerT = 0;
    this.lastMessage = '';
    this.game = null;
  }

  setGame(game) {
    this.game = game;
    this.cache = {};
    this.logIndex = 0;
    this.lastMessage = '';
    $('pbp-list').innerHTML = '';
    const [a, h] = game.sides;
    document.querySelector('#sb-away .chip').style.background = a.team.primary;
    document.querySelector('#sb-home .chip').style.background = h.team.primary;
    document.querySelector('#sb-away .abbr').textContent = a.team.abbr;
    document.querySelector('#sb-home .abbr').textContent = h.team.abbr;
    $('pitchinfo').classList.add('hidden');
  }

  set(id, key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn($(id), value);
  }

  update(game, dt) {
    const s = game.state;
    this.set('sb-away', 'aw', s.score[0], (el, v) => { el.querySelector('.runs').textContent = v; });
    this.set('sb-home', 'hm', s.score[1], (el, v) => { el.querySelector('.runs').textContent = v; });
    this.set('sb-away', 'bat', s.half, () => {
      $('sb-away').classList.toggle('batting', s.half === 0);
      $('sb-home').classList.toggle('batting', s.half === 1);
    });
    this.set('sb-inning', 'inn', game.over ? 'F' : `${s.inning}`, (el, v) => { el.textContent = v === 'F' ? 'FINAL' : v; });
    this.set('sb-arrow', 'arr', game.over ? '' : s.half === 0 ? '▲' : '▼', (el, v) => { el.textContent = v; });
    const bases = s.bases.map((b) => (b ? 1 : 0)).join('');
    this.set('sb-bases', 'bases', bases, (el) => {
      el.querySelectorAll('rect').forEach((r) => r.classList.toggle('on', !!s.bases[+r.dataset.b]));
    });
    this.set('sb-count', 'count', `${s.balls}-${s.strikes}`, (el, v) => { el.textContent = v; });
    this.set('sb-outs', 'outs', s.outs, (el, v) => {
      el.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < v));
    });

    // pitch info
    const lp = game.lastPitch;
    const pk = lp ? `${lp.n}-${lp.type}-${lp.result}-${game.pitchLog.length}` : '';
    this.set('pitchinfo', 'pitch', pk, (el) => {
      if (!lp) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      $('pi-mph').textContent = lp.mph.toFixed(1);
      $('pi-type').textContent = PITCH_TYPES[lp.type].name;
      $('pi-result').textContent = lp.result || '';
    });

    // matchup
    const def = game.defenseSide;
    const b = s.batter;
    if (b) {
      const bl = game.batLine(b);
      const idx = game.offense.lineup.indexOf(b) + 1;
      const side = s.pitcher ? batSide(b, s.pitcher) : b.bats;
      this.set('mu-batter', 'mub', `${b.id}`, (el) => { el.textContent = b.name; });
      this.set('mu-batter-sub', 'mubs', `${b.id}|${bl.pa}|${bl.h}|${bl.rbi}|${s.pitcher?.id}`, (el) => {
        el.textContent = `${idx}. ${b.pos} · Bats ${b.bats === 'S' ? `S (${side})` : b.bats} · ${batToday(bl)}`;
      });
    }
    const p = def.pitcher;
    const pl = def.pit.get(p.id) || { outs: 0, r: 0, so: 0, pc: 0 };
    this.set('mu-pitcher', 'mup', p.id, (el) => { el.textContent = p.name; });
    this.set('mu-pitcher-sub', 'mups', `${p.id}|${pl.pc}|${pl.outs}|${pl.r}|${pl.so}`, (el) => {
      el.textContent = `${p.throws}HP ${p.role} · ${pl.pc} pitches · ${ip(pl.outs)} IP, ${pl.r} R, ${pl.so} K`;
    });

    // strike zone
    this.set('zone-svg', 'zone', `${b?.id}|${game.pitchLog.length}|${s.half}`, (el) => this.drawZone(el, game));

    // banner
    if (game.message && game.message !== this.lastMessage) {
      const el = $('banner');
      el.textContent = game.message;
      el.classList.remove('hidden');
      el.classList.toggle('big', /HOME RUN|GRAND SLAM|Walk-off|Final/i.test(game.message));
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      this.bannerT = game.over ? 1e9 : /Foul/.test(game.message) ? 1.0 : 2.4;
    }
    this.lastMessage = game.message;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) $('banner').classList.add('hidden');
    }

    this.updateLog(game);
  }

  drawZone(svg, game) {
    const X = (x) => 60 - x * 88;
    const Y = (z) => 132 - z * 84;
    let h = '';
    h += `<rect x="4" y="4" width="112" height="132" rx="6" fill="rgba(255,255,255,0.03)"/>`;
    const zx = X(ZONE.halfW), zw = X(-ZONE.halfW) - zx;
    h += `<rect x="${zx}" y="${Y(ZONE.top)}" width="${zw}" height="${Y(ZONE.bot) - Y(ZONE.top)}" fill="none" stroke="#e2e8f0" stroke-width="1.2"/>`;
    for (let i = 1; i < 3; i++) {
      const gx = zx + (zw * i) / 3, gy = Y(ZONE.top) + ((Y(ZONE.bot) - Y(ZONE.top)) * i) / 3;
      h += `<line x1="${gx}" y1="${Y(ZONE.top)}" x2="${gx}" y2="${Y(ZONE.bot)}" stroke="rgba(226,232,240,.25)"/>`;
      h += `<line x1="${zx}" y1="${gy}" x2="${zx + zw}" y2="${gy}" stroke="rgba(226,232,240,.25)"/>`;
    }
    // home plate
    h += `<path d="M${X(0.216)} 128 L${X(-0.216)} 128 L${X(-0.216)} 131 L60 135 L${X(0.216)} 131 Z" fill="#e2e8f0" opacity=".6"/>`;
    for (const p of game.pitchLog) {
      const cx = Math.max(8, Math.min(112, X(p.x))), cy = Math.max(8, Math.min(132, Y(p.z)));
      const col = PITCH_TYPES[p.type].color;
      const swung = /Swing|Foul|play/i.test(p.result);
      h += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${col}" stroke="${swung ? '#fff' : 'none'}" stroke-width="1.3"/>`;
      h += `<text x="${cx.toFixed(1)}" y="${(cy + 2.8).toFixed(1)}" text-anchor="middle">${p.n}</text>`;
    }
    svg.innerHTML = h;
  }

  updateLog(game) {
    const list = $('pbp-list');
    while (this.logIndex < game.log.length) {
      const e = game.log[this.logIndex++];
      const li = document.createElement('li');
      li.className = e.kind;
      const m = e.text.match(/^(.*?)(\s\((EV [^)]*)\))?$/);
      const main = m ? m[1] : e.text;
      const meta = m && m[3] ? `<div class="meta">${esc(m[3])}</div>` : '';
      const scoring = ['hr', 'hit', 'out', 'reach', 'bb', 'hbp', 'k'].includes(e.kind);
      const sc = scoring ? `<span class="sc">${game.sides[0].team.abbr} ${e.score[0]}–${e.score[1]} ${game.sides[1].team.abbr}</span>` : '';
      li.innerHTML = `${sc}${esc(main)}${meta}`;
      list.prepend(li);
    }
  }
}

export function renderBoxScore(game) {
  const s = game.state;
  const n = Math.max(9, s.line[0].length, s.line[1].length);
  let h = '<div class="box-scroll"><table class="box-line"><thead><tr><th></th>';
  for (let i = 1; i <= n; i++) h += `<th>${i}</th>`;
  h += '<th>R</th><th>H</th><th>E</th></tr></thead><tbody>';
  for (let t = 0; t < 2; t++) {
    h += `<tr><td><b>${esc(game.sides[t].team.name)}</b></td>`;
    for (let i = 0; i < n; i++) {
      const v = s.line[t][i];
      h += `<td>${v === undefined ? '' : v}</td>`;
    }
    h += `<td class="tot">${s.score[t]}</td><td class="tot">${s.hits[t]}</td><td class="tot">${s.errors[t]}</td></tr>`;
  }
  h += '</tbody></table></div><div class="box-grid">';
  for (let t = 0; t < 2; t++) {
    const side = game.sides[t];
    h += `<div><h3><i style="background:${side.team.primary}"></i>${esc(side.team.name)}</h3>`;
    h += '<div class="box-scroll"><table class="box-table"><thead><tr><th>Batting</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead><tbody>';
    const tot = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, hr: 0 };
    for (const p of side.lineup) {
      const b = side.bat.get(p.id);
      for (const k in tot) tot[k] += b[k];
      h += `<tr><td>${esc(p.name)}<span class="pos">${p.pos}</span></td><td>${b.ab}</td><td>${b.r}</td><td>${b.h}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.so}</td><td>${b.hr}</td></tr>`;
    }
    h += `<tr class="tot"><td>Totals</td><td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.bb}</td><td>${tot.so}</td><td>${tot.hr}</td></tr></tbody></table></div>`;
    h += '<div class="box-scroll"><table class="box-table"><thead><tr><th>Pitching</th><th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>HR</th><th>PC-S</th></tr></thead><tbody>';
    for (const p of side.used) {
      const l = side.pit.get(p.id);
      h += `<tr><td>${esc(p.name)}<span class="pos">${p.role}</span></td><td>${ip(l.outs)}</td><td>${l.h}</td><td>${l.r}</td><td>${l.bb}</td><td>${l.so}</td><td>${l.hr}</td><td>${l.pc}-${l.strikes}</td></tr>`;
    }
    h += '</tbody></table></div>';
    const xb = side.lineup.map((p) => [p, side.bat.get(p.id)]);
    const list = (k, label) => {
      const arr = xb.filter(([, b]) => b[k] > 0).map(([p, b]) => `${esc(p.name.split(' ').slice(-1)[0])}${b[k] > 1 ? ` ${b[k]}` : ''}`);
      return arr.length ? `<div class="fine"><b>${label}:</b> ${arr.join(', ')}</div>` : '';
    };
    h += list('d', '2B') + list('t', '3B') + list('hr', 'HR');
    h += `<div class="fine"><b>LOB:</b> ${s.lob[t]}</div>`;
    h += '</div>';
  }
  h += '</div>';
  const status = game.over ? 'Final' : `${s.half === 0 ? 'Top' : 'Bottom'} ${ordinal(s.inning)}`;
  return `<p class="fine" style="margin-top:0">${status}</p>${h}`;
}
