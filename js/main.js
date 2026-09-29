// App controller: setup screen, main loop, controls.
import { Game } from './sim/game.js';
import { loadTeams, loadPrefs, savePrefs } from './data/storage.js';
import { Stage } from './render/stage.js';
import { Hud, renderBoxScore } from './ui/hud.js';
import { Editor } from './ui/editor.js';
import { Sound } from './ui/sound.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let teams = loadTeams();
const prefs = Object.assign({ speed: 1, camera: 'broadcast', log: true, away: 0, home: 1 }, loadPrefs());
let stage;
let game = null;
let paused = false;
let speed = prefs.speed;
const hud = new Hud();
const sound = new Sound();
const editor = new Editor((t) => {
  teams = t;
  fillSetup();
});

try {
  stage = new Stage($('view'));
  $('loading').remove();
} catch (err) {
  const l = $('loading');
  l.classList.add('error');
  l.textContent = `Could not start WebGL (${err.message}). Try a different browser or enable hardware acceleration.`;
  throw err;
}

// ---------- setup screen ----------
function fillSetup() {
  const opts = teams.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  $('away-team').innerHTML = opts;
  $('home-team').innerHTML = opts;
  const a = Math.min(prefs.away, teams.length - 1);
  let h = Math.min(prefs.home, teams.length - 1);
  if (h === a) h = (a + 1) % teams.length;
  $('away-team').value = a;
  $('home-team').value = h;
  fillPitchers('away');
  fillPitchers('home');
}

function fillPitchers(side) {
  const t = teams[+$(`${side}-team`).value];
  const sps = [...t.pitchers].sort((x, y) => (y.role === 'SP') - (x.role === 'SP'));
  $(`${side}-sp`).innerHTML = sps.map((p) =>
    `<option value="${p.id}">${esc(p.name)} (${p.throws}HP ${p.role}, ${p.velo} mph)</option>`).join('');
}

$('away-team').addEventListener('change', () => fillPitchers('away'));
$('home-team').addEventListener('change', () => fillPitchers('home'));
$('btn-edit').addEventListener('click', () => editor.open(teams));

$('btn-start').addEventListener('click', () => {
  const a = +$('away-team').value, h = +$('home-team').value;
  if (a === h) {
    alert('Pick two different teams.');
    return;
  }
  prefs.away = a; prefs.home = h;
  savePrefs(prefs);
  startGame(teams[a], teams[h], $('away-sp').value, $('home-sp').value, $('opt-ghost').checked);
  sound.unlock();
});

function startGame(away, home, awaySP, homeSP, ghost) {
  game = new Game(away, home, { awayStarter: awaySP, homeStarter: homeSP, extraRunner: ghost });
  stage.setTeams(game);
  hud.setGame(game);
  $('setup').classList.add('hidden');
  $('app').classList.remove('nogame');
  $('boxscore').classList.add('hidden');
  $('box-new').classList.add('hidden');
  paused = false;
  $('btn-play').textContent = '⏸';
  finalShown = false;
}

// ---------- controls ----------
function setSpeed(v) {
  speed = v;
  prefs.speed = v;
  savePrefs(prefs);
  document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v));
}
document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
setSpeed(speed);

function togglePause() {
  paused = !paused;
  $('btn-play').textContent = paused ? '▶' : '⏸';
}
$('btn-play').addEventListener('click', togglePause);

function skip(pred) {
  if (!game || game.over) return;
  game.simUntil(pred);
  game.events.length = 0;
}
$('btn-next').addEventListener('click', () => {
  if (!game) return;
  const n = game.log.length;
  const pa = game.paSeq;
  skip(() => game.paSeq !== pa && game.phase === 'preAB' || game.log.length > n + 3);
});
$('btn-inning').addEventListener('click', () => {
  if (!game) return;
  const key = `${game.state.inning}-${game.state.half}`;
  skip(() => `${game.state.inning}-${game.state.half}` !== key && game.phase !== 'sideChange');
});
$('btn-end').addEventListener('click', () => {
  if (!game || game.over) return;
  if (!confirm('Simulate the rest of the game instantly?')) return;
  game.simToEnd();
});

const camSel = $('camera');
camSel.value = prefs.camera;
stage.setMode(prefs.camera);
camSel.addEventListener('change', () => {
  stage.setMode(camSel.value);
  prefs.camera = camSel.value;
  savePrefs(prefs);
  camSel.blur();
});

const pbp = $('pbp');
function setLog(open, persist = true) {
  pbp.classList.toggle('closed', !open);
  if (!persist) return;
  prefs.log = open;
  savePrefs(prefs);
}
setLog(prefs.log && window.innerWidth > 760, false);
$('btn-log').addEventListener('click', () => setLog(pbp.classList.contains('closed')));
$('pbp-close').addEventListener('click', () => setLog(false));

function openBox() {
  if (!game) return;
  $('box-body').innerHTML = renderBoxScore(game);
  $('box-new').classList.toggle('hidden', !game.over);
  $('boxscore').classList.remove('hidden');
}
$('btn-box').addEventListener('click', openBox);
$('box-new').addEventListener('click', newGame);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));

function newGame() {
  $('boxscore').classList.add('hidden');
  fillSetup();
  $('setup').classList.remove('hidden');
}
$('btn-new').addEventListener('click', newGame);

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (!$('editor').classList.contains('hidden')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.key === 'n' || e.key === 'N') $('btn-next').click();
  else if (e.key === 'b' || e.key === 'B') openBox();
  else if (e.key === 'l' || e.key === 'L') $('btn-log').click();
  else if (e.key === 'c' || e.key === 'C') {
    const opts = [...camSel.options].map((o) => o.value);
    camSel.value = opts[(opts.indexOf(camSel.value) + 1) % opts.length];
    camSel.dispatchEvent(new Event('change'));
  } else if (e.key >= '1' && e.key <= '4') setSpeed([0.5, 1, 2, 4][+e.key - 1]);
  else if (e.key === 'Escape') document.querySelectorAll('.modal:not(#setup)').forEach((m) => m.classList.add('hidden'));
});

// ---------- loop ----------
let last = performance.now();
let finalShown = false;
let idleClock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) {
    if (!paused) game.advance(dt * speed);
    for (const ev of game.events) sound.onEvent(ev, speed);
    game.events.length = 0;
    stage.update(game, paused ? 0 : dt * Math.min(speed, 2));
    hud.update(game, dt);
    if (game.over && !finalShown) {
      finalShown = true;
      setTimeout(openBox, 2500);
    }
  } else {
    idleClock += dt;
    stage.update(idleGame, dt);
  }
  requestAnimationFrame(frame);
}

// A quiet game in the background behind the setup screen.
const idleGame = new Game(teams[0], teams[1 % teams.length], { seed: 42 });
idleGame.phase = 'pregame';
idleGame.phaseT = 1e9;
idleGame.resetPositions();
stage.setTeams(idleGame);

// handy for tinkering from the console
window.bbsim = { get game() { return game; }, stage, setSpeed, togglePause };

fillSetup();
requestAnimationFrame(frame);
