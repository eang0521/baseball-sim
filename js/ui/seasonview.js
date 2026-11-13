// Season screen: create a season, sim days, watch games, standings, schedule, leaders, team stats.
import {
  createSeason, prepareDay, upcomingGames, recordResult, advanceIfDone, isOver, groupedStandings,
  leaders, playerIndex, batRates, pitRates, ipStr, fmt3, teamRecord, SEASON_LENGTHS,
  activeRound, playoffToday, seriesStatus, startPlayoffs,
} from '../season/season.js';
import { SimPool } from '../season/pool.js';
import { loadSeason, saveSeason, clearSeason, listLeagues, loadTeams } from '../data/storage.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = (t) => `<i class="tchip" style="background:${esc(t.primary)}"></i>`;

export class SeasonView {
  // onWatch(season, game) starts a scheduled game in the 3D view.
  constructor({ onWatch, getLeague }) {
    this.onWatch = onWatch;
    this.getLeague = getLeague;
    this.season = loadSeason();
    this.pool = null;
    this.running = false;
    this.tab = 'standings';
    this.viewDay = null;
    this.teamTab = null;
    $('season-body').addEventListener('click', (e) => this.onClick(e));
    $('season-body').addEventListener('change', (e) => this.onChange(e));
  }

  get open() { return !$('season').classList.contains('hidden'); }

  show() {
    $('season').classList.remove('hidden');
    this.render();
  }

  hide() {
    $('season').classList.add('hidden');
  }

  save() {
    if (this.season && !saveSeason(this.season)) this.status('Could not save the season to browser storage.');
  }

  status(msg) {
    const el = $('season-status');
    if (el) el.textContent = msg;
  }

  // ---------- creating ----------
  async renderCreate() {
    const leagues = await listLeagues();
    const cur = this.getLeague();
    $('season-title').textContent = 'New season';
    $('season-body').innerHTML = `
      <div class="season-new">
        <label>League<select id="sn-league">${leagues.map((l) => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label>Length<select id="sn-games">${SEASON_LENGTHS.map((n) => `<option value="${n}">${n} games</option>`).join('')}</select></label>
        <label>Your team<select id="sn-follow"></select></label>
      </div>
      <p class="fine">Every club plays every day in three-game series, with home and road split evenly. Starters follow each club's rotation. Watch any game in 3D, or sim days at a time in the background. A full 162-game MLB season takes several minutes to sim.</p>
      <div class="actions"><button id="sn-start" class="primary big" data-act="create">Start season</button></div>`;
    await this.fillFollow();
  }

  async fillFollow() {
    const league = $('sn-league').value;
    this.newTeams = await loadTeams(league);
    $('sn-follow').innerHTML = '<option value="">(none)</option>' +
      this.newTeams.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  }

  async create() {
    const sel = $('sn-league');
    const league = sel.value;
    const leagueName = sel.selectedOptions[0].text;
    const games = +$('sn-games').value;
    const f = $('sn-follow').value;
    this.season = createSeason({ league, leagueName, teams: this.newTeams, games, follow: f === '' ? null : +f });
    prepareDay(this.season);
    this.viewDay = null;
    this.save();
    this.render();
  }

  // ---------- simming ----------
  inPostseason() {
    return !!(this.season && isOver(this.season) && this.season.playoffs);
  }

  // Regular season: sim up to `days` days (stops at the end of the regular season).
  async sim(days) {
    if (this.running || !this.season || isOver(this.season)) return;
    this.running = true;
    this.pool ||= new SimPool();
    const s = this.season;
    const target = Math.min(s.days.length, s.day + days);
    const t0 = performance.now();
    let done = 0;
    this.render();
    try {
      while (this.running && s.day < target) {
        // batch up to a week of games at a time so every worker stays busy
        const games = upcomingGames(s, Math.min(7, target - s.day));
        const total = games.length;
        let n = 0;
        await this.pool.run(s, games, (res) => {
          recordResult(s, res);
          n++; done++;
          if (n % 5 === 0 || n === total) {
            const rate = done / ((performance.now() - t0) / 1000);
            this.progress(`Simming… day ${s.day + 1} of ${s.days.length} · ${rate.toFixed(1)} games/s`);
          }
        });
        advanceIfDone(s);
        this.save();
        this.render();
      }
    } catch (err) {
      console.error(err);
      this.status(`Simulation error: ${err.message}`);
    }
    this.running = false;
    advanceIfDone(s);
    if (this.inPostseason()) this.tab = 'playoffs';
    this.save();
    this.render();
  }

  // Postseason: 'day' = one game in every live series, 'round' = finish the current round,
  // 'all' = play through to a champion.
  async simPlayoffs(mode) {
    const s = this.season;
    if (this.running || !this.inPostseason() || s.playoffs.champion != null) return;
    this.running = true;
    this.pool ||= new SimPool();
    const startRound = activeRound(s);
    this.render();
    try {
      while (this.running && s.playoffs.champion == null) {
        const games = playoffToday(s);
        if (!games.length) break;
        this.progress(`Simming ${s.playoffs.rounds[activeRound(s)].name}…`);
        await this.pool.run(s, games, (res) => recordResult(s, res));
        this.save();
        this.render();
        if (mode === 'day') break;
        if (mode === 'round' && activeRound(s) !== startRound) break;
      }
    } catch (err) {
      console.error(err);
      this.status(`Simulation error: ${err.message}`);
    }
    this.running = false;
    this.save();
    this.render();
  }

  stop() {
    this.running = false;
    this.pool?.cancel();
  }

  progress(msg) {
    const el = $('season-progress');
    if (el) el.textContent = msg;
  }

  todaysGames() {
    const s = this.season;
    if (!s) return [];
    if (this.inPostseason()) return playoffToday(s);
    return isOver(s) ? [] : upcomingGames(s, 1);
  }

  // The other games on the day of a watched game sim in the background meanwhile.
  simRestOfDay(skipId) {
    const s = this.season;
    if (!s || this.running) return;
    const games = this.todaysGames().filter((g) => g.id !== skipId && !g.score);
    if (!games.length) return;
    this.pool ||= new SimPool();
    this.running = true;
    this.pool.run(s, games, (res) => recordResult(s, res)).then(() => {
      this.running = false;
      advanceIfDone(s);
      this.save();
      if (this.open) this.render();
    }).catch((err) => { this.running = false; console.error(err); });
  }

  // A watched game finished: record it.
  recordWatched(res) {
    const s = this.season;
    if (!s) return;
    const wasRegular = !isOver(s);
    recordResult(s, res);
    advanceIfDone(s);
    if (wasRegular && this.inPostseason()) this.tab = 'playoffs';
    this.save();
  }

  // ---------- rendering ----------
  render() {
    if (!this.season) { this.renderCreate(); return; }
    const s = this.season;
    // seasons saved before playoffs existed: set the field up now
    if (isOver(s) && !s.playoffs) { startPlayoffs(s); this.save(); }
    $('season-title').textContent = s.name;
    const post = this.inPostseason();
    const po = s.playoffs;
    const fol = s.follow != null ? s.teams[s.follow] : null;
    const rec = fol ? teamRecord(s, s.follow) : null;
    const today = this.todaysGames();
    const myGame = fol && today.find((g) => !g.score && (g.a === s.follow || g.h === s.follow));
    let status;
    if (!post) status = `Day <b>${s.day + 1}</b> of ${s.days.length}`;
    else if (po.champion != null) status = `🏆 <b>${esc(s.teams[po.champion].name)}</b> are champions`;
    else status = `<b>${esc(po.rounds[activeRound(s)].name)}</b>`;
    let follow = '';
    if (fol) {
      follow = ` · ${chip(fol)}${esc(fol.name)} <b>${rec.w}-${rec.l}</b>`;
      if (post) follow += ` <span class="fine">${esc(this.followNote())}</span>`;
    }
    let buttons;
    if (this.running) buttons = '<button data-act="stop" class="danger">Stop</button>';
    else if (!post) {
      buttons = `<button data-act="sim" data-days="1">Sim day</button>
        <button data-act="sim" data-days="7">Sim week</button>
        <button data-act="sim" data-days="30">Sim month</button>
        <button data-act="sim" data-days="100000">Sim to end</button>`;
    } else if (po.champion == null) {
      buttons = `<button data-act="po" data-mode="day">Sim day</button>
        <button data-act="po" data-mode="round">Sim round</button>
        <button data-act="po" data-mode="all">Sim to champion</button>`;
    } else buttons = '';
    let h = `<div class="season-top">
      <div class="season-day">${status}${follow}</div>
      <div class="season-actions">
        ${myGame && !this.running ? `<button class="primary" data-act="watch" data-g="${myGame.id}">Watch ${esc(s.teams[myGame.a].abbr)} @ ${esc(s.teams[myGame.h].abbr)}${myGame.n ? ` (G${myGame.n})` : ''}</button>` : ''}
        ${buttons}
      </div>
    </div>
    <div class="fine" id="season-progress">${this.running ? 'Simming…' : ''}</div>`;
    const tabs = [['standings', 'Standings'], ['schedule', 'Schedule'], ['leaders', 'Leaders'], ['team', 'Team stats']];
    if (po) tabs.unshift(['playoffs', 'Playoffs']);
    if (this.tab === 'playoffs' && !po) this.tab = 'standings';
    h += `<nav class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>`;
    h += `<div class="season-pane">${this[`render_${this.tab}`]()}</div>`;
    h += `<div class="actions"><span id="season-status" class="fine"></span><button data-act="reset" class="danger">New season</button></div>`;
    $('season-body').innerHTML = h;
  }

  // Where the followed club stands in October.
  followNote() {
    const s = this.season;
    const po = s.playoffs;
    const t = s.follow;
    if (!po.rounds.some((r) => r.series.some((sr) => sr.hi === t || sr.lo === t))) return 'missed the postseason';
    if (po.champion === t) return 'won it all';
    for (const r of po.rounds) {
      for (const sr of r.series) {
        if (sr.hi !== t && sr.lo !== t) continue;
        if (sr.winner != null && sr.winner !== t) return `out in the ${sr.label}`;
        if (sr.winner == null) return `${sr.label}: ${seriesStatus(s, sr)}`;
      }
    }
    return 'waiting for the next round';
  }

  render_playoffs() {
    const s = this.season;
    const po = s.playoffs;
    const ab = (t) => (t == null ? 'TBD' : esc(s.teams[t].abbr));
    const side = (sr, t, seed, wins) => {
      if (t == null) return '<div class="br-team tbd">TBD</div>';
      const won = sr.winner === t, lost = sr.winner != null && !won;
      return `<div class="br-team ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${t === s.follow ? 'me' : ''}">
        <span class="seed">${seed ?? ''}</span>${chip(s.teams[t])}<span class="ab">${ab(t)}</span><b>${wins}</b></div>`;
    };
    // today's games
    let h = '';
    const today = this.todaysGames();
    if (po.champion != null) {
      const c = s.teams[po.champion];
      h += `<div class="champ" style="border-color:${esc(c.primary)}">🏆 ${chip(c)}<b>${esc(c.name)}</b> win the ${esc(po.rounds[po.rounds.length - 1].series[0].label)}</div>`;
    } else if (today.length) {
      h += `<h3>Today</h3><div class="box-scroll"><table class="box-table sched">${today.map((g) => {
        const f = po.rounds[activeRound(s)].series.find((x) => x.games.includes(g));
        return `<tr class="${g.a === s.follow || g.h === s.follow ? 'me' : ''}"><td class="fine">${esc(f?.label || '')} G${g.n}</td><td>${chip(s.teams[g.a])}${ab(g.a)}</td><td class="at">@</td><td>${chip(s.teams[g.h])}${ab(g.h)}</td><td class="fine">${esc(f ? seriesStatus(s, f) : '')}</td><td class="r">${this.running ? '' : `<button data-act="watch" data-g="${g.id}">Watch</button>`}</td></tr>`;
      }).join('')}</table></div>`;
    }
    // bracket: one column per round
    h += `<div class="bracket" style="--cols:${po.rounds.length}">`;
    for (const r of po.rounds) {
      h += `<div class="br-round"><h4>${esc(r.name)}${r.series[0].best ? ` <span class="fine">· best of ${r.series[0].best}</span>` : ''}</h4>`;
      for (const sr of r.series) {
        const games = sr.games.filter((g) => g.score).map((g) => `${ab(g.a)} ${g.score[0]}, ${ab(g.h)} ${g.score[1]}${g.inn ? ` (${g.inn})` : ''}`);
        h += `<div class="br-series"><div class="br-label">${esc(sr.label)}</div>
          ${side(sr, sr.hi, sr.hiSeed, sr.wins[0])}${side(sr, sr.lo, sr.loSeed, sr.wins[1])}
          <div class="br-status fine">${esc(seriesStatus(s, sr))}</div>
          ${games.length ? `<details><summary class="fine">Games</summary><ol class="fine">${games.map((x) => `<li>${x}</li>`).join('')}</ol></details>` : ''}</div>`;
      }
      h += '</div>';
    }
    h += '</div>';
    // seeds
    h += `<div class="seeds">${Object.entries(po.seeds).map(([lg, seeds]) => `<div><h4>${esc(lg)} seeds</h4><ol class="fine">${seeds.map((t) => {
      const r = teamRecord(s, t);
      return `<li>${chip(s.teams[t])}${esc(s.teams[t].name)} (${r.w}-${r.l})</li>`;
    }).join('')}</ol></div>`).join('')}</div>`;
    h += `<p class="fine">${po.format === 'mlb'
      ? 'MLB format: three division winners and three wild cards per league; the top two division winners get byes. Wild Card Series best of 3 (all at the higher seed), Division Series best of 5 (2-2-1), LCS and World Series best of 7 (2-3-2). The World Series opens at the club with the better record. Ties are broken by head-to-head record, then run differential.'
      : 'Top four clubs: semifinals and a final, each best of 7 (2-3-2), higher seed at home first.'} Clubs use a four-man rotation in October.</p>`;
    return h;
  }

  render_standings() {
    const s = this.season;
    return `<div class="standings">${groupedStandings(s).map((g) => `
      <div><h3>${esc(g.name)}</h3><div class="box-scroll"><table class="box-table"><thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>RS</th><th>RA</th><th>DIFF</th><th>L10</th><th>STRK</th></tr></thead><tbody>
      ${g.rows.map((r) => `<tr class="${r.i === s.follow ? 'me' : ''}"><td>${chip(r.team)}${esc(r.team.abbr)} <span class="tname">${esc(r.team.name)}</span></td><td>${r.w}</td><td>${r.l}</td><td>${fmt3(r.pct)}</td><td>${r.gb ? r.gb : '-'}</td><td>${r.rs}</td><td>${r.ra}</td><td>${r.rs - r.ra > 0 ? '+' : ''}${r.rs - r.ra}</td><td>${r.l10}</td><td>${r.strk}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('')}</div>`;
  }

  render_schedule() {
    const s = this.season;
    const d = Math.max(0, Math.min(s.days.length - 1, this.viewDay ?? s.day));
    if (d >= s.day) prepareDay(s, d);
    const idx = playerIndex(s);
    const nm = (id) => esc(idx.get(id)?.p.name.split(' ').slice(-1)[0] || '');
    const rows = s.days[d].map((g) => {
      const A = s.teams[g.a], H = s.teams[g.h];
      const me = g.a === s.follow || g.h === s.follow;
      let right;
      if (g.score) {
        const [a, hh] = g.score;
        right = `<b>${a}–${hh}</b>${g.inn ? ` <span class="fine">(${g.inn})</span>` : ''}`;
      } else {
        right = `<span class="fine">${nm(g.aSP)} vs ${nm(g.hSP)}</span>${d === s.day && !this.running ? ` <button data-act="watch" data-g="${g.id}">Watch</button>` : ''}`;
      }
      return `<tr class="${me ? 'me' : ''}"><td>${chip(A)}${esc(A.abbr)}</td><td class="at">@</td><td>${chip(H)}${esc(H.abbr)}</td><td class="r">${right}</td></tr>`;
    }).join('');
    let mine = '';
    if (s.follow != null) {
      const list = [];
      for (let k = Math.max(0, s.day - 6); k < Math.min(s.days.length, s.day + 6); k++) {
        const g = s.days[k].find((x) => x.a === s.follow || x.h === s.follow);
        if (!g) continue;
        const home = g.h === s.follow;
        const opp = s.teams[home ? g.a : g.h];
        let res = '';
        if (g.score) {
          const us = home ? g.score[1] : g.score[0], them = home ? g.score[0] : g.score[1];
          res = `<b class="${us > them ? 'win' : 'loss'}">${us > them ? 'W' : 'L'} ${us}–${them}</b>`;
        }
        list.push(`<button class="sched-chip ${k === d ? 'on' : ''}" data-day="${k}"><span>Day ${k + 1}</span>${home ? 'vs' : '@'} ${esc(opp.abbr)} ${res}</button>`);
      }
      mine = `<div class="sched-mine">${list.join('')}</div>`;
    }
    return `${mine}<div class="day-nav"><button data-day="${d - 1}" ${d <= 0 ? 'disabled' : ''}>◀</button><b>Day ${d + 1}</b>${d === s.day ? ' <span class="fine">(today)</span>' : ''}<button data-day="${d + 1}" ${d >= s.days.length - 1 ? 'disabled' : ''}>▶</button><button data-day="${s.day}">Today</button></div>
      <div class="box-scroll"><table class="box-table sched">${rows}</table></div>`;
  }

  render_leaders() {
    const L = leaders(this.season, 8);
    const block = (c) => `<div class="leader"><h4>${c.label}</h4><ol>${c.list.map((x) => `<li><span>${esc(x.name)} <small>${esc(x.team)}</small></span><b>${x.value}</b></li>`).join('') || '<li class="fine">—</li>'}</ol></div>`;
    return `<h3>Batting</h3><div class="leaders">${L.batting.map(block).join('')}</div>
      <h3>Pitching</h3><div class="leaders">${L.pitching.map(block).join('')}</div>
      <p class="fine">Rate stats need ${L.qualified.pa} (batters) or ${L.qualified.ip} (pitchers). Wins, losses and saves use simplified scoring rules.</p>`;
  }

  render_team() {
    const s = this.season;
    const t = this.teamTab ?? s.follow ?? 0;
    const team = s.teams[t];
    const opts = s.teams.map((x, i) => `<option value="${i}" ${i === t ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const rec = teamRecord(s, t);
    const hitters = [...team.lineup, ...(team.bench || [])];
    const postStats = !!(this.postStats && s.playoffs);
    const bat = postStats ? s.playoffs.bat : s.bat;
    const pit = postStats ? s.playoffs.pit : s.pit;
    const toggle = s.playoffs ? `<div class="seg"><button data-stats="reg" class="${postStats ? '' : 'on'}">Regular season</button><button data-stats="post" class="${postStats ? 'on' : ''}">Postseason</button></div>` : '';
    let h = `<div class="team-pick"><select id="season-team">${opts}</select> <b>${rec.w}-${rec.l}</b>${toggle}</div>`;
    h += '<div class="box-scroll"><table class="box-table"><thead><tr><th>Batting</th><th>G</th><th>PA</th><th>AVG</th><th>OBP</th><th>SLG</th><th>HR</th><th>RBI</th><th>R</th><th>SB</th><th>BB</th><th>K</th></tr></thead><tbody>';
    for (const p of hitters) {
      const b = bat[p.id];
      if (!b) { h += `<tr><td>${esc(p.name)}<span class="pos">${p.pos}</span></td><td colspan="11" class="fine">no games yet</td></tr>`; continue; }
      const r = batRates(b);
      h += `<tr><td>${esc(p.name)}<span class="pos">${p.pos}</span></td><td>${b.g}</td><td>${b.pa}</td><td>${fmt3(r.avg)}</td><td>${fmt3(r.obp)}</td><td>${fmt3(r.slg)}</td><td>${b.hr}</td><td>${b.rbi}</td><td>${b.r}</td><td>${b.sb}</td><td>${b.bb}</td><td>${b.so}</td></tr>`;
    }
    h += '</tbody></table></div><div class="box-scroll"><table class="box-table"><thead><tr><th>Pitching</th><th>G</th><th>GS</th><th>W-L</th><th>SV</th><th>IP</th><th>ERA</th><th>SO</th><th>BB</th><th>HR</th><th>WHIP</th></tr></thead><tbody>';
    for (const p of team.pitchers) {
      const l = pit[p.id];
      if (!l) { h += `<tr><td>${esc(p.name)}<span class="pos">${p.role}</span></td><td colspan="10" class="fine">no games yet</td></tr>`; continue; }
      const r = pitRates(l);
      h += `<tr><td>${esc(p.name)}<span class="pos">${p.role}</span></td><td>${l.g}</td><td>${l.gs}</td><td>${l.w}-${l.l}</td><td>${l.sv}</td><td>${ipStr(l.outs)}</td><td>${Number.isFinite(r.era) ? r.era.toFixed(2) : '-'}</td><td>${l.so}</td><td>${l.bb}</td><td>${l.hr}</td><td>${Number.isFinite(r.whip) ? r.whip.toFixed(2) : '-'}</td></tr>`;
    }
    h += '</tbody></table></div>';
    return h;
  }

  // ---------- events ----------
  onClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab) { this.tab = tab.dataset.tab; this.render(); return; }
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn && !dayBtn.disabled) { this.viewDay = +dayBtn.dataset.day; this.render(); return; }
    const st = e.target.closest('[data-stats]');
    if (st) { this.postStats = st.dataset.stats === 'post'; this.render(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'create') this.create();
    else if (act === 'sim') this.sim(+b.dataset.days);
    else if (act === 'po') this.simPlayoffs(b.dataset.mode);
    else if (act === 'stop') this.stop();
    else if (act === 'watch') {
      const s = this.season;
      const g = this.todaysGames().find((x) => x.id === +b.dataset.g);
      if (!g || g.score) return;
      this.hide();
      this.onWatch(s, g);
      this.simRestOfDay(g.id);
    } else if (act === 'reset') {
      if (this.running) return;
      if (!confirm('Abandon this season and start a new one? Its results and stats will be deleted.')) return;
      clearSeason();
      this.season = null;
      this.render();
    }
  }

  onChange(e) {
    if (e.target.id === 'sn-league') this.fillFollow();
    if (e.target.id === 'season-team') { this.teamTab = +e.target.value; this.render(); }
  }
}
