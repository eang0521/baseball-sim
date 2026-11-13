# Diamond Sim — 3D Baseball Simulator

A physics-driven, 9-on-9 baseball simulation that plays itself in the browser, rendered in 3D with Three.js. Everything runs client-side with no build step. It is hosted on GitHub Pages.

**Play it:** https://eang0521.github.io/baseball-sim/

## What's simulated

- **Ball physics:** gravity, quadratic drag and Magnus lift from spin, integrated at 200 Hz. Pitches break according to their spin axis, fly balls carry, and batted balls bounce and roll differently on grass, dirt and the warning track. The ball also caroms off the outfield wall.
- **Pitching:** each pitcher has fastball velocity, control, stamina and a repertoire of up to five pitch types (4-seam, sinker, cutter, slider, curve, changeup, splitter), each rated. Pitchers choose a pitch and a target based on the count, and control determines how far they miss it. Fatigue lowers velocity, command and stuff as the pitch count climbs.
- **Hitting:** batters have contact, power, eye, speed, fielding and arm ratings. They read the pitch with noise that depends on their eye and the pitch's deception, and then decide whether to swing. Bat-to-ball contact is modeled as a vertical miss distance plus a timing error, which produce exit velocity, launch angle and spray direction. Foul balls, pop-ups, grounders and home runs all come out of the same model.
- **Fielding:** fielders predict the ball's path and work out where they can intercept it. One chases, the others cover bases, back up plays or act as the cutoff. Fielders can dive or bobble the ball, and throws have arm strength and accuracy, so they can sail.
- **Baserunning:** runners take leads and weigh their time to the next base against the ball's time there. They tag up, freeze on line drives, get doubled off, and are forced out or tagged out. Double plays happen on their own.
- **Stolen bases:** the manager sends runners when the runner's speed, the pitcher's handedness and the catcher's arm and exchange time give a good chance. Pitchers deliver from the stretch with runners on. The runner's jump, the pitch, the catcher's throw and the tag all play out physically, so there are steals of second and third, double steals, caught stealings (including strike-'em-out, throw-'em-out) and extra bases on bad throws. With two outs and a full count, runners go on the pitch.
- **Bunts:** weak hitters sacrifice in close, late games (and in extra innings with the runner on second). The corner infielders charge and the second baseman cheats toward first, and the defense takes the sure out unless the lead runner is clearly beaten. Fast slap hitters sometimes bunt for a hit. Foul bunts with two strikes are strikeouts.
- **Managing:** whoever starts the game pitches as deep as his stamina allows unless he gets knocked around. After that, relievers, setup men and closers are used by situation. Each club carries a four-man bench. Late in close games the manager pinch-hits (mostly for a platoon edge), pinch-runs for a slow tying or go-ahead runner, and brings in a better glove to protect a lead. Subs who end up out of position cost fielding, so a manager who pinch-hits with an outfielder for the second baseman will usually bring in a real infielder next inning. Games use the designated hitter and the extra-innings runner on second (the runner is optional).

In headless testing, the simulation lands close to real MLB league rates: about 4.3 runs per team per game, a .245/.315/.420 slash line, 22–23% strikeouts, 8.5% walks, about 3% home runs per plate appearance, and roughly 0.8 stolen bases per team per game at about 80% success.

## Last-pitch mode

Tick **Watch only the last pitch of each at-bat** on the start screen (or pick *Last pitch only* in the control bar) to see only the pitch that decides each plate appearance: ball four, strike three, a hit batter or the swing that puts the ball in play. The other pitches are simmed instantly. The sim decides each pitch's outcome at the start of the windup, so it knows in advance which pitch to show. **Hide the count** blanks the balls and strikes, the pitcher's pitch count and the earlier pitches on the strike-zone plot, so you can't tell from the screen whether a walk or a strikeout is coming. Stolen-base attempts are shown as well, even when the pitch doesn't end the at-bat.

## Season mode

Click **Season mode** on the start screen. Pick a league (fictional or MLB), a length (162, 81, 40 or 15 games) and, if you like, a team to follow. Every club plays every day in three-game series with home and road split evenly, and starters follow each club's rotation.

- **Watch** any of today's games in 3D. The rest of that day's games sim in the background while you watch.
- **Sim day / week / month / to end** runs games in parallel Web Workers. A full 162-game MLB season (2,430 games) takes several minutes on a typical 8-core machine.
- **Standings** by division (MLB) or as one table, with games behind, run differential, last 10 and streak. **Schedule** shows any day's results and probable pitchers. **Leaders** covers AVG, HR, RBI, OPS, SB, H, ERA, W, SO, SV, WHIP and IP. **Team stats** shows season lines for any club.
- The season, including a roster snapshot taken when it starts, is saved in your browser. Wins, losses and saves use simplified scoring rules.

## Controls

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| 1–4 | Speed ½× / 1× / 2× / 4× |
| N | Skip to the next batter |
| W | Toggle last-pitch-only mode |
| C | Cycle cameras (broadcast, umpire, overhead, free orbit) |
| L | Play-by-play log |
| B | Box score |

## Rosters

Click **Edit rosters** on the start screen to rename teams, change colors, reorder lineups and edit every rating and pitch. Rosters are saved in your browser's localStorage, and you can export them to or import them from JSON.

## Real MLB teams

Pick **MLB 2026** under *League* on the start screen to play with all 30 real clubs: each club's most-used starter at every position, five-man rotation, closer, setup men and bullpen, with real handedness, jersey numbers and pitch mixes. Hover a batter or pitcher in the matchup panel (or a name in the roster editor) to see his real season line. Edits to MLB rosters are saved separately from the fictional league.

Ratings come from real data, not guesses:

1. **Calibration** (`tools/mlb/calibrate.mjs`): simulates ~2,800 games with random ratings and fits how the sim turns contact/power/eye/speed and velocity/control/stuff into K%, BB%, HR%, singles and extra-base hits.
2. **Import** (`tools/mlb/import.mjs`): pulls stat lines from the MLB Stats API and Statcast leaderboards from Baseball Savant. It blends three seasons (5/4/3 weights), regresses small samples toward average, and searches for the ratings that make the sim reproduce each player's rates relative to league average. Speed comes from sprint speed, fielding from Outs Above Average (pop time for catchers), arm from throw velocity, velo from the average fastball, stamina from pitches per outing, and the spread of each pitcher's pitch ratings from per-pitch whiff% and xwOBA.
3. **Validation** (`tools/mlb/validate.mjs`): plays the real clubs against each other and compares the results with reality. `--adjust` folds any league-wide gap back into the import.

In 1,260 validation games the sim hit .242/.318/.403 (real 2026: .244/.318/.400), and each regular's simulated K% correlated r=0.91 with his real K% (BB% 0.76, HR% 0.73, ISO 0.70).

To rebuild for a new season:

```bash
node tools/mlb/import.mjs 2027
```

## Running locally

ES modules need a web server, so opening the file directly won't work:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

To batch-simulate games and print league stats:

```bash
node tools/simtest.mjs 40
```

## Project layout

```
js/sim/      simulation engine (no DOM, runs in Node too)
  physics.js   ball flight, bounces, walls, pitch & throw aiming
  atbat.js     pitch selection, swing decisions, contact model
  play.js      live-ball fielding and baserunning
  game.js      innings, plate appearances, bullpen, stats, play-by-play
  coach.js     pinch hitters, pinch runners, defensive replacements
js/season/   schedule, standings, leaders; worker pool for background sims
js/render/   Three.js ballpark, player figures, broadcast camera
js/ui/       HUD, box score, roster editor, season screen, sound
js/data/     default teams and storage; mlb/ holds imported MLB rosters
tools/       headless test scripts; tools/mlb/ builds the MLB rosters
```
