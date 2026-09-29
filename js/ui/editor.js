// Roster editor: edit team info, lineups, ratings and pitching staffs.
import { PITCH_TYPES, PITCH_ORDER } from '../sim/pitches.js';
import { RNG } from '../sim/rng.js';
import { randomHitter, randomPitcher, randomTeam, normalizeTeam, FIELD_POS } from '../data/teams.js';
import { saveTeams, resetTeams } from '../data/storage.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HIT_KEYS = [['contact', 'Con'], ['power', 'Pow'], ['eye', 'Eye'], ['speed', 'Spd'], ['fielding', 'Fld'], ['arm', 'Arm']];
const ROLES = ['SP', 'RP', 'SU', 'CL'];

function clampNum(v, lo, hi) {
  const n = Math.round(+v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

export class Editor {
  constructor(onSave) {
    this.onSave = onSave;
    this.teams = [];
    this.cur = 0;
    this.rng = new RNG(Date.now());
    $('ed-team').addEventListener('change', (e) => { this.cur = +e.target.value; this.render(); });
    $('ed-add').addEventListener('click', () => this.addTeam());
    $('ed-del').addEventListener('click', () => this.deleteTeam());
    $('ed-export').addEventListener('click', () => this.exportJSON());
    $('ed-import').addEventListener('change', (e) => this.importJSON(e));
    $('ed-reset').addEventListener('click', () => {
      if (!confirm('Reset all teams to the defaults? Your edits will be lost.')) return;
      this.teams = resetTeams();
      this.cur = 0;
      this.render();
      this.status('Teams reset to defaults.');
    });
    $('ed-save').addEventListener('click', () => this.save());
    $('ed-body').addEventListener('input', (e) => this.onInput(e));
    $('ed-body').addEventListener('change', (e) => this.onInput(e));
    $('ed-body').addEventListener('click', (e) => this.onClick(e));
  }

  open(teams) {
    this.teams = JSON.parse(JSON.stringify(teams));
    this.cur = Math.min(this.cur, this.teams.length - 1);
    this.render();
    this.status('');
    $('editor').classList.remove('hidden');
  }

  close() {
    $('editor').classList.add('hidden');
  }

  status(msg) {
    $('ed-status').textContent = msg;
  }

  get team() {
    return this.teams[this.cur];
  }

  render() {
    const sel = $('ed-team');
    sel.innerHTML = this.teams.map((t, i) => `<option value="${i}" ${i === this.cur ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const t = this.team;
    let h = `<div class="ed-meta">
      <label>Team name<input data-f="name" value="${esc(t.name)}" maxlength="40"></label>
      <label>Abbreviation<input data-f="abbr" value="${esc(t.abbr)}" maxlength="4"></label>
      <label>Primary<input type="color" data-f="primary" value="${t.primary}"></label>
      <label>Secondary<input type="color" data-f="secondary" value="${t.secondary}"></label>
    </div>`;
    h += '<div class="ed-sec"><h3>Lineup (batting order)</h3><div class="box-scroll"><table class="ed-table"><thead><tr><th></th><th>Name</th><th>Pos</th><th>Bats</th>';
    for (const [, l] of HIT_KEYS) h += `<th>${l}</th>`;
    h += '<th>OVR</th><th></th></tr></thead><tbody>';
    t.lineup.forEach((p, i) => {
      const ovr = Math.round((p.contact + p.power + p.eye + p.speed * 0.6 + p.fielding * 0.7 + p.arm * 0.5) / 4.8);
      h += `<tr data-h="${i}"><td class="ord">${i + 1}</td>
        <td><input class="name" data-k="name" value="${esc(p.name)}" maxlength="32"></td>
        <td><select data-k="pos">${FIELD_POS.map((x) => `<option ${x === p.pos ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><select data-k="bats">${['R', 'L', 'S'].map((x) => `<option ${x === p.bats ? 'selected' : ''}>${x}</option>`).join('')}</select></td>`;
      for (const [k] of HIT_KEYS) h += `<td><input class="num" type="number" min="1" max="99" data-k="${k}" value="${p[k]}"></td>`;
      h += `<td class="ovr">${ovr}</td><td style="white-space:nowrap">
        <button data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button data-act="down" title="Move down" ${i === 8 ? 'disabled' : ''}>▼</button>
        <button data-act="rand" title="Replace with a random player">🎲</button></td></tr>`;
    });
    h += '</tbody></table></div>';
    const counts = {};
    t.lineup.forEach((p) => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
    const missing = FIELD_POS.filter((p) => p !== 'DH' && !counts[p]);
    const dupes = Object.keys(counts).filter((p) => counts[p] > 1);
    if (missing.length || dupes.length) {
      h += `<div class="warn">${missing.length ? `Missing: ${missing.join(', ')}. ` : ''}${dupes.length ? `Duplicate: ${dupes.join(', ')}. ` : ''}Extra players will fill empty positions automatically.</div>`;
    }
    h += '</div>';

    h += '<div class="ed-sec"><h3>Pitching staff</h3><div class="box-scroll"><table class="ed-table"><thead><tr><th>Name</th><th>Throws</th><th>Role</th><th>Velo</th><th>Ctrl</th><th>Stam</th><th>Pitches (type · rating)</th><th></th></tr></thead><tbody>';
    t.pitchers.forEach((p, i) => {
      h += `<tr data-p="${i}">
        <td><input class="name" data-k="name" value="${esc(p.name)}" maxlength="32"></td>
        <td><select data-k="throws">${['R', 'L'].map((x) => `<option ${x === p.throws ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><select data-k="role">${ROLES.map((x) => `<option ${x === p.role ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><input class="num" type="number" min="70" max="105" data-k="velo" value="${p.velo}" title="Fastball velocity (mph)"></td>
        <td><input class="num" type="number" min="1" max="99" data-k="control" value="${p.control}"></td>
        <td><input class="num" type="number" min="1" max="99" data-k="stamina" value="${p.stamina}"></td>
        <td><div class="pitch-list">${p.pitches.map((x, j) => `<span class="pitch-chip" data-j="${j}">
            <select data-pk="type">${PITCH_ORDER.map((ty) => `<option value="${ty}" ${ty === x.type ? 'selected' : ''}>${PITCH_TYPES[ty].short}</option>`).join('')}</select>
            <input class="num" type="number" min="1" max="99" data-pk="rating" value="${x.rating}">
            <button data-act="delpitch" title="Remove pitch" ${p.pitches.length <= 1 ? 'disabled' : ''}>✕</button></span>`).join('')}
            ${p.pitches.length < 5 ? '<button data-act="addpitch" title="Add pitch">+ pitch</button>' : ''}</div></td>
        <td style="white-space:nowrap"><button data-act="prand" title="Replace with a random pitcher">🎲</button><button data-act="pdel" title="Remove pitcher" ${t.pitchers.length <= 2 ? 'disabled' : ''}>✕</button></td></tr>`;
    });
    h += '</tbody></table></div>';
    if (t.pitchers.length < 10) h += '<button data-act="padd" style="margin-top:6px">+ Add pitcher</button>';
    h += '<p class="fine">Starters (SP) need high stamina; relievers (RP), setup men (SU) and closers (CL) pitch in shorter bursts. Stamina roughly equals the pitch count a pitcher can handle before tiring.</p></div>';
    $('ed-body').innerHTML = h;
  }

  onInput(e) {
    const el = e.target;
    const t = this.team;
    if (el.dataset.f) {
      t[el.dataset.f] = el.dataset.f === 'abbr' ? el.value.toUpperCase().slice(0, 4) : el.value;
      if (el.dataset.f === 'name' && e.type === 'change') this.render();
      return;
    }
    const hr = el.closest('tr[data-h]');
    const pr = el.closest('tr[data-p]');
    if (hr && el.dataset.k) {
      const p = t.lineup[+hr.dataset.h];
      const k = el.dataset.k;
      p[k] = ['name', 'pos', 'bats'].includes(k) ? el.value : clampNum(el.value, 1, 99);
      if (e.type === 'change' && k !== 'name') this.render();
    } else if (pr) {
      const p = t.pitchers[+pr.dataset.p];
      if (el.dataset.k) {
        const k = el.dataset.k;
        if (['name', 'throws', 'role'].includes(k)) p[k] = el.value;
        else p[k] = k === 'velo' ? clampNum(el.value, 70, 105) : clampNum(el.value, 1, 99);
      } else if (el.dataset.pk) {
        const j = +el.closest('[data-j]').dataset.j;
        p.pitches[j][el.dataset.pk] = el.dataset.pk === 'type' ? el.value : clampNum(el.value, 1, 99);
      }
    }
  }

  onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const t = this.team;
    const act = b.dataset.act;
    const hr = b.closest('tr[data-h]');
    const pr = b.closest('tr[data-p]');
    const used = new Set();
    if (hr) {
      const i = +hr.dataset.h;
      if (act === 'up' && i > 0) [t.lineup[i - 1], t.lineup[i]] = [t.lineup[i], t.lineup[i - 1]];
      if (act === 'down' && i < 8) [t.lineup[i + 1], t.lineup[i]] = [t.lineup[i], t.lineup[i + 1]];
      if (act === 'rand') t.lineup[i] = randomHitter(this.rng, t.lineup[i].pos, 55, used);
    } else if (pr) {
      const i = +pr.dataset.p;
      const p = t.pitchers[i];
      if (act === 'prand') t.pitchers[i] = randomPitcher(this.rng, p.role, 55, used);
      if (act === 'pdel') t.pitchers.splice(i, 1);
      if (act === 'addpitch') {
        const have = new Set(p.pitches.map((x) => x.type));
        p.pitches.push({ type: PITCH_ORDER.find((x) => !have.has(x)) || 'CH', rating: 50 });
      }
      if (act === 'delpitch') {
        const j = +b.closest('[data-j]').dataset.j;
        p.pitches.splice(j, 1);
      }
    } else if (act === 'padd') {
      t.pitchers.push(randomPitcher(this.rng, 'RP', 55, used));
    }
    this.render();
  }

  addTeam() {
    const n = this.teams.length + 1;
    const hue = Math.floor(Math.random() * 360);
    const t = randomTeam(Math.floor(Math.random() * 1e9), {
      name: `Expansion Club ${n}`, abbr: `EX${n}`.slice(0, 4),
      primary: `hsl(${hue} 60% 38%)`, quality: 55,
    });
    t.primary = hslToHex(hue, 60, 38);
    t.secondary = '#f8fafc';
    this.teams.push(t);
    this.cur = this.teams.length - 1;
    this.render();
  }

  deleteTeam() {
    if (this.teams.length <= 2) {
      this.status('You need at least two teams.');
      return;
    }
    if (!confirm(`Delete ${this.team.name}?`)) return;
    this.teams.splice(this.cur, 1);
    this.cur = 0;
    this.render();
  }

  exportJSON() {
    const blob = new Blob([JSON.stringify(this.teams, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'baseball-sim-teams.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const arr = Array.isArray(data) ? data : [data];
        const teams = arr.map(normalizeTeam);
        if (!teams.length) throw new Error('No teams found');
        if (Array.isArray(data) && teams.length >= 2) {
          this.teams = teams;
          this.cur = 0;
        } else {
          this.teams.push(...teams);
          this.cur = this.teams.length - 1;
        }
        this.render();
        this.status(`Imported ${teams.length} team(s).`);
      } catch (err) {
        this.status(`Import failed: ${err.message}`);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  save() {
    this.teams = this.teams.map(normalizeTeam);
    const ok = saveTeams(this.teams);
    this.onSave(this.teams);
    if (!ok) alert('Could not save to browser storage; changes apply to this session only.');
    this.close();
  }
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}
