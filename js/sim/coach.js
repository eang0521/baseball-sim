// In-game managers: pinch hitters, pinch runners and defensive replacements.
// Pitching changes live in game.js (checkPitchingChange).
import { batSide } from './atbat.js';

const IF = ['2B', '3B', 'SS'];
const OF = ['LF', 'CF', 'RF'];
const BASE_NAME = ['home', 'first', 'second', 'third'];
const POS_LONG = {
  C: 'catcher', '1B': 'first base', '2B': 'second base', '3B': 'third base', SS: 'shortstop',
  LF: 'left field', CF: 'center field', RF: 'right field', DH: 'designated hitter',
};

// Fielding lost by playing somewhere other than a player's usual spots.
export function fitPenalty(p, pos) {
  if (pos === 'DH' || pos === 'P' || pos === p.pos || (p.alt && p.alt.includes(pos))) return 0;
  if (p.pos === 'DH') return 0; // a DH's fielding rating already assumes he's a liability
  if (pos === 'C') return 30;
  if (pos === '1B') return p.pos === 'C' ? 6 : 4;
  if (pos === 'LF' || pos === 'RF') return OF.includes(p.pos) ? 2 : 8;
  if (pos === 'CF') return OF.includes(p.pos) ? 6 : 15;
  if (IF.includes(pos)) return IF.includes(p.pos) ? 5 : p.pos === '1B' ? 12 : 18;
  return 10;
}

export const fieldingAt = (p, pos) => (p.fielding ?? 50) - fitPenalty(p, pos);

// Rough run value of a hitter against this pitcher (same-side matchups hurt).
export function batValue(p, pitcher) {
  const base = 0.35 * (p.contact ?? 50) + 0.45 * (p.power ?? 50) + 0.25 * (p.eye ?? 50);
  const sameSide = batSide(p, pitcher) === (pitcher.throws === 'L' ? 'L' : 'R');
  return base - (sameSide ? 7 : 0);
}

const catchers = (list) => list.filter((p) => p.pos === 'C' || (p.alt && p.alt.includes('C')));

// Called before each plate appearance for the batting side.
export function coachOffense(game) {
  const s = game.state;
  const off = game.offense;
  if (!off.bench.length) return;
  const diff = game.scoreDiff();
  const pitcher = game.defenseSide.pitcher;
  // keep the last spare catcher unless it's extra innings
  const spareC = catchers(off.bench);
  const usable = (c) => !(spareC.length === 1 && spareC[0] === c && s.inning < 10);

  // Pinch runner: a slow runner who is the tying or go-ahead run, late.
  if (s.inning >= 8 && diff >= -2 && diff <= 0) {
    for (const k of [3, 2, 1]) {
      const r = s.bases[k];
      if (!r || (r.speed ?? 50) > 52) continue;
      let ahead = 0;
      for (let b = k; b <= 3; b++) if (s.bases[b]) ahead++;
      if (diff + ahead < 0) continue; // even scoring him wouldn't tie it
      const cand = off.bench.filter((c) => usable(c) && c.pos !== 'C').sort((a, b) => b.speed - a.speed)[0];
      if (!cand || cand.speed < Math.max(62, (r.speed ?? 50) + 15)) continue;
      if (!game.rng.chance(0.8)) break;
      game.substitute(off, r, cand, 'PR');
      game.addLog(`${cand.name} pinch-runs for ${r.name} at ${BASE_NAME[k]}.`, 'change');
      game.message = `Pinch runner: ${cand.name}`;
      break;
    }
  }

  // Pinch hitter: late and close, when the bench offers a clear upgrade (often a platoon edge).
  if (s.inning >= 7 && diff >= -4 && diff <= 1 && off.bench.length) {
    const b = off.lineup[off.idx];
    const pos = off.posOf.get(b.id);
    // nobody hits for a bench player who just came in, or for one of the club's real bats
    if (off.entered.has(b.id)) return;
    if (batValue(b, { throws: b.bats === 'L' ? 'R' : 'L' }) >= 62) return;
    // pinch-hitting for the catcher needs another catcher to take over behind the plate
    if (pos === 'C' && (s.inning < 8 || spareC.length < 2)) return;
    let thr = s.inning === 7 ? 15 : s.inning === 8 ? 13 : 10;
    if (s.bases[2] || s.bases[3]) thr -= 2;
    if (diff > 0) thr += 3;
    const cands = off.bench.filter((c) => usable(c) && !(pos === 'C' && c.pos === 'C' && spareC.length < 2));
    let best = null, bestV = -1e9;
    for (const c of cands) {
      const v = batValue(c, pitcher);
      if (v > bestV) { bestV = v; best = c; }
    }
    if (!best || bestV - batValue(b, pitcher) < thr) return;
    if (!game.rng.chance(0.65)) return;
    game.substitute(off, b, best, 'PH');
    game.addLog(`Pinch-hitting for ${b.name}: ${best.name}.`, 'change');
    game.message = `Pinch hitter: ${best.name}`;
  }
}

// Called at the start of each half-inning for the fielding side.
export function coachDefense(game, side) {
  const s = game.state;
  const me = game.sides.indexOf(side);
  const lead = s.score[me] - s.score[1 - me];
  const benchFor = (pos) => side.bench
    .filter((c) => fitPenalty(c, pos) <= 5 && !(c.pos === 'C' && pos !== 'C' && catchers(side.bench).length < 2))
    .sort((a, b) => fieldingAt(b, pos) - fieldingAt(a, pos))[0];

  // 1) A pinch hitter or runner left somewhere he can't really play.
  for (const pos of ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B']) {
    const p = side.defense[pos];
    if (!p || fitPenalty(p, pos) < 12) continue;
    const c = benchFor(pos);
    if (!c) continue;
    game.substitute(side, p, c, 'DEF');
    game.addLog(`Defensive change: ${c.name} takes over at ${POS_LONG[pos]} for ${p.name}.`, 'change');
  }

  // 2) Protecting a late lead: bring in a glove for a weak fielder.
  if (s.inning >= 8 && lead >= 1 && lead <= 3 && (s.inning >= 9 || game.rng.chance(0.5))) {
    let pick = null, gain = 0;
    for (const pos of ['LF', 'RF', '1B', '3B', 'CF', '2B', 'SS']) {
      const p = side.defense[pos];
      if (!p) continue;
      const cur = fieldingAt(p, pos);
      if (cur > 52) continue;
      const c = benchFor(pos);
      if (!c) continue;
      const g = fieldingAt(c, pos) - cur;
      if (g > gain) { gain = g; pick = { pos, p, c }; }
    }
    if (pick && gain >= 12 && game.rng.chance(0.75)) {
      game.substitute(side, pick.p, pick.c, 'DEF');
      game.addLog(`Defensive replacement: ${pick.c.name} in at ${POS_LONG[pick.pos]} for ${pick.p.name}.`, 'change');
    }
  }
}
