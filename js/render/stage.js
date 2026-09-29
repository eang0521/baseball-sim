// Three.js stage: renders the game world and drives the broadcast camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBallpark, V } from './ballpark.js';
import { Figure, randomSkin } from './figures.js';
import { BASES, RUBBER } from '../sim/field.js';

const PITCH_PHASES = new Set(['preAB', 'windup', 'pitch', 'afterPitch', 'afterFoul', 'pitchingChange']);

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

export class Stage {
  constructor(container) {
    this.container = container;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog('#b9d4ec', 260, 700);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);

    const hemi = new THREE.HemisphereLight('#dbeafe', '#3f6212', 1.1);
    scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#fff6e0', 2.1));
    sun.position.copy(V(-70, -40, 110));
    sun.target.position.copy(V(0, 40, 0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 400;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    const park = buildBallpark(renderer);
    scene.add(park.group);
    this.park = park;

    // ball + shadow + trail
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.0366, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.06, 12),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    scene.add(this.ballShadow);
    this.trailN = 40;
    this.trailPos = new Float32Array(this.trailN * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailPts = [];

    // figures: pools per team + umpires
    this.pools = [[], []];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 14; i++) {
        const f = new Figure();
        f.root.visible = false;
        scene.add(f.root);
        this.pools[t].push(f);
      }
    }
    this.umps = [];
    const umpSpots = [[0, -2.3, 0], [BASES[1].x + 4, BASES[1].y - 1, -2.4], [BASES[2].x - 5, BASES[2].y + 5, Math.PI], [BASES[3].x - 4, BASES[3].y - 1, 2.4]];
    for (const [x, y, f] of umpSpots) {
      const u = new Figure();
      u.setRole('umpire');
      u.setLook({ jersey: '#1e293b', pants: '#6b7280', cap: '#111827', skin: randomSkin(this.umps.length + 2) });
      u.root.position.copy(V(x, y, 0));
      u.root.rotation.y = Math.PI - f;
      u.pose(this.umps.length === 0 ? 'umpire' : 'ready', 0, 0, 0);
      scene.add(u.root);
      this.umps.push(u);
    }

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enabled = false;
    this.controls.target.copy(V(0, 30, 0));
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 400;
    this.mode = 'broadcast';
    this.shot = null;
    this.look = V(0, 30, 0);
    this.camPos = V(0, -30, 20);
    this.fov = 50;
    this.clock = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.controls.target.copy(V(0, 30, 0));
      this.camera.position.copy(V(-60, -60, 55));
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
    this.shot = null;
  }

  setTeams(game) {
    for (let t = 0; t < 2; t++) {
      const team = game.sides[t].team;
      const home = t === 1;
      for (const f of this.pools[t]) {
        f.setLook({
          jersey: home ? '#f8fafc' : team.primary,
          pants: home ? '#f1f5f9' : '#cbd5e1',
          cap: team.primary,
        });
      }
    }
  }

  // ---------- per-frame ----------
  update(game, dt) {
    this.clock += dt;
    const w = game.world;
    const half = game.state.half;
    const defPool = this.pools[1 - half];
    const offPool = this.pools[half];
    let di = 0, oi = 0;
    const place = (fig, e, role, hand, anim, animT, speed) => {
      fig.root.visible = true;
      fig.setRole(role);
      fig.setHand(hand);
      fig.root.position.copy(V(e.x, e.y, 0));
      fig.root.rotation.y = Math.PI - (e.facing ?? 0);
      fig.pose(anim, animT, speed, dt);
    };
    for (const f of w.fielders) {
      const fig = defPool[di++];
      const skin = randomSkin(hash(f.player.id || f.player.name || ''));
      fig.setLook({ skin });
      const sp = f.spd || 0;
      let anim = f.anim || 'ready';
      const t = f.animT || 0;
      if (game.play) {
        if (anim === 'throw' && t > 0.45) anim = sp > 1 ? 'run' : 'ready';
        if (anim === 'catch' && t > 0.4) anim = sp > 1 ? 'run' : 'ready';
        if (anim === 'dive' && !(f.stun > 0)) anim = sp > 1 ? 'run' : 'ready';
        if (anim === 'windup' || anim === 'set' || anim === 'crouch' || anim === 'catchPitch' || anim === 'follow') anim = sp > 0.4 ? 'run' : 'ready';
        if (anim === 'ready' && sp > 0.4) anim = 'run';
      } else if (anim === 'catchPitch' && t > 0.6) {
        anim = 'crouch';
      }
      const hand = f.pos === 'P' ? f.player.throws || 'R' : 'R';
      place(fig, f, f.pos === 'C' ? 'catcher' : 'fielder', hand, anim, t, sp);
      if (f.pos === 'C' && game.play) fig.mask.visible = false;
    }
    const stealPlay = game.play && game.play.steal;
    const showBatter = w.batter && (!game.play || stealPlay) && !(game.phase === 'afterPlay' && !stealPlay) &&
      game.phase !== 'sideChange' && !game.over;
    if (showBatter) {
      const b = w.batter;
      const fig = offPool[oi++];
      fig.setLook({ skin: randomSkin(hash(b.player.id || b.player.name)) });
      const e = { x: b.x, y: b.y, facing: b.side === 'R' ? Math.PI / 2 : -Math.PI / 2 };
      place(fig, e, 'batter', b.side, b.anim === 'swing' || b.anim === 'bunt' ? b.anim : 'stance', b.animT, 0);
    }
    for (const r of w.runners || []) {
      if (r.out && (r.outT || 0) > 1.2) continue;
      if (r.scored && !game.play) continue;
      const fig = offPool[oi++];
      if (!fig) break;
      fig.setLook({ skin: randomSkin(hash(r.player.id || r.player.name)) });
      const sp = r.v || 0;
      const anim = sp > 0.4 ? 'run' : r.anim === 'lead' ? 'lead' : 'idle';
      place(fig, r, 'runner', 'R', anim, 0, sp);
    }
    for (; di < defPool.length; di++) defPool[di].root.visible = false;
    for (; oi < offPool.length; oi++) offPool[oi].root.visible = false;

    this.updateBall(game, dt);
    this.park.updateScoreboard(game);
    this.updateCamera(game, dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateBall(game, dt) {
    const wb = game.world.ball;
    const p = wb.phys.p;
    const visible = wb.visible && !(wb.mode === 'held' && !game.play) && p.z > -0.5;
    this.ball.visible = visible;
    this.ballShadow.visible = visible && p.z > 0.1;
    if (!visible) {
      this.trailPts.length = 0;
    } else {
      this.ball.position.copy(V(p.x, p.y, p.z));
      const d = this.camera.position.distanceTo(this.ball.position);
      const sc = Math.max(1.3, d * (this.camera.fov / 50) / 22);
      this.ball.scale.setScalar(sc);
      this.ballShadow.position.copy(V(p.x, p.y, 0.02));
      this.ballShadow.scale.setScalar(Math.max(1, sc * 0.8));
      this.ballShadow.material.opacity = Math.max(0.08, 0.4 - p.z * 0.015);
      const held = game.play && game.play.holder;
      if (!held) this.trailPts.push(this.ball.position.clone());
      else this.trailPts.length = 0;
      if (this.trailPts.length > this.trailN) this.trailPts.shift();
    }
    const n = this.trailPts.length;
    for (let i = 0; i < this.trailN; i++) {
      const q = this.trailPts[Math.max(0, Math.min(n - 1, i - (this.trailN - n)))] || this.ball.position;
      this.trailPos[i * 3] = q.x; this.trailPos[i * 3 + 1] = q.y; this.trailPos[i * 3 + 2] = q.z;
    }
    this.trail.visible = n > 2 && game.world.ball.mode !== 'pitch';
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- camera ----------
  chooseShot(game) {
    const ph = game.phase;
    if (this.mode === 'overhead') return 'overhead';
    if (this.mode === 'plate') return game.play || ph === 'afterPlay' ? 'field' : 'plate';
    if (ph === 'pregame' || ph === 'sideChange' || game.over) return 'aerial';
    if (game.play || ph === 'afterPlay') return 'field';
    if (PITCH_PHASES.has(ph)) return 'pitch';
    return 'field';
  }

  updateCamera(game, dt) {
    if (this.mode === 'orbit') {
      this.controls.update();
      return;
    }
    const shot = this.chooseShot(game);
    const cut = shot !== this.shot;
    this.shot = shot;
    const cam = this.camera;
    let pos, look, fov;
    const k = cut ? 1 : 1 - Math.exp(-dt * 3.2);
    if (shot === 'pitch') {
      const lefty = game.state.batter && game.world.batter?.side === 'L';
      pos = V(lefty ? 1.5 : -1.5, 46, 5.2);
      look = V(0, 0.2, 0.9);
      fov = 8.5;
    } else if (shot === 'plate') {
      pos = V(0, -3.4, 1.75);
      look = V(0, 18, 1.2);
      fov = 42;
    } else if (shot === 'overhead') {
      pos = V(0, 38, 150);
      look = V(0, 40, 0);
      fov = 55;
    } else if (shot === 'aerial') {
      const a = this.clock * 0.08;
      pos = V(Math.sin(a) * 150, 45 - Math.cos(a) * 150, 70);
      look = V(0, 45, 0);
      fov = 45;
    } else {
      // high home camera following the ball
      const b = game.world.ball.phys.p;
      const bx = b.x, by = Math.max(0, b.y), bz = b.z;
      const depth = Math.hypot(bx, by);
      const tx = bx * 0.8, ty = 12 + (by - 12) * 0.8;
      look = V(tx, ty, Math.min(bz * 0.7, 28));
      const back = 22 + Math.max(0, depth - 60) * 0.25;
      pos = V(tx * 0.25, -back, 14 + depth * 0.12);
      fov = Math.max(34, Math.min(66, 30 + depth * 0.28 + Math.max(0, bz - 10) * 0.5));
    }
    // shots are framed for a 16:9 screen; widen the vertical FOV on narrow screens
    const aspect = cam.aspect;
    if (aspect < 1.6) {
      const h = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 1.6);
      fov = Math.min(95, (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI);
    }
    if (cut) {
      this.camPos.copy(pos);
      this.look.copy(look);
      this.fov = fov;
    } else {
      this.camPos.lerp(pos, k);
      this.look.lerp(look, shot === 'field' ? 1 - Math.exp(-dt * 5) : k);
      this.fov += (fov - this.fov) * k;
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
