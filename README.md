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
- **Managing:** whoever starts the game pitches as deep as his stamina allows unless he gets knocked around. After that, relievers, setup men and closers are used by situation. Games use the designated hitter and the extra-innings runner on second (the runner is optional).

In headless testing, the simulation lands close to real MLB league rates: about 4.3 runs per team per game, a .245/.315/.420 slash line, 22–23% strikeouts, 8.5% walks, about 3% home runs per plate appearance, and roughly 0.8 stolen bases per team per game at about 80% success.

## Controls

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| 1–4 | Speed ½× / 1× / 2× / 4× |
| N | Skip to the next batter |
| C | Cycle cameras (broadcast, umpire, overhead, free orbit) |
| L | Play-by-play log |
| B | Box score |

## Rosters

Click **Edit rosters** on the start screen to rename teams, change colors, reorder lineups and edit every rating and pitch. Rosters are saved in your browser's localStorage, and you can export them to or import them from JSON.

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
js/render/   Three.js ballpark, player figures, broadcast camera
js/ui/       HUD, box score, roster editor, sound
js/data/     default teams and storage
tools/       headless test scripts
```
