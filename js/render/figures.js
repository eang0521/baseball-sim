// Low-poly player figures with procedural animation.
// Local space: +z = forward, +y = up. A person's right side is -x.
import * as THREE from 'three';

const SKINS = ['#f1c7a3', '#e0ac85', '#c68863', '#9a6344', '#6f452c', '#f5d2b8'];

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

const GEO = {
  thigh: new THREE.CylinderGeometry(0.085, 0.07, 0.46, 8).translate(0, -0.23, 0),
  shin: new THREE.CylinderGeometry(0.068, 0.055, 0.46, 8).translate(0, -0.23, 0),
  shoe: new THREE.BoxGeometry(0.11, 0.07, 0.26).translate(0, -0.47, 0.05),
  torso: new THREE.CapsuleGeometry(0.17, 0.34, 4, 10).scale(1.05, 1, 0.72).translate(0, 0.3, 0),
  arm: new THREE.CapsuleGeometry(0.048, 0.46, 3, 8).translate(0, -0.27, 0),
  hand: new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.56, 0),
  glove: new THREE.BoxGeometry(0.15, 0.2, 0.08).translate(0, -0.6, 0.03),
  head: new THREE.SphereGeometry(0.115, 14, 10),
  capTop: new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.1, 0.1, 0.012, 12, 1, false).scale(1, 1, 1.1),
  bat: new THREE.CylinderGeometry(0.033, 0.014, 0.86, 8).translate(0, 0.43, 0),
  helmet: new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
  mask: new THREE.BoxGeometry(0.2, 0.2, 0.05),
};

export class Figure {
  constructor(opts = {}) {
    const g = (this.root = new THREE.Group());
    this.body = new THREE.Group();
    g.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.mats = {
      jersey: mat('#ffffff'), pants: mat('#e5e7eb'), cap: mat('#1f2937'),
      skin: mat(SKINS[0]), shoe: mat('#111111'), glove: mat('#6b3f1d'), bat: mat('#c8a26a'),
    };
    const M = this.mats;
    const leg = (side) => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, 0, 0);
      thigh.add(new THREE.Mesh(GEO.thigh, M.pants));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      knee.add(new THREE.Mesh(GEO.shin, M.pants));
      knee.add(new THREE.Mesh(GEO.shoe, M.shoe));
      thigh.add(knee);
      this.hips.add(thigh);
      return { thigh, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(new THREE.Mesh(GEO.torso, M.jersey));
    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.235, 0.54, 0);
      sh.add(new THREE.Mesh(GEO.arm, M.jersey));
      const hand = new THREE.Mesh(GEO.hand, M.skin);
      sh.add(hand);
      this.torso.add(sh);
      return sh;
    };
    this.armL = arm(1);
    this.armR = arm(-1);
    this.gloveMesh = new THREE.Mesh(GEO.glove, M.glove);
    this.head = new THREE.Group();
    this.head.position.y = 0.76;
    this.torso.add(this.head);
    this.head.add(new THREE.Mesh(GEO.head, M.skin));
    this.cap = new THREE.Group();
    const capTop = new THREE.Mesh(GEO.capTop, M.cap);
    capTop.position.y = 0.02;
    this.cap.add(capTop);
    const brim = new THREE.Mesh(GEO.brim, M.cap);
    brim.position.set(0, 0.03, 0.11);
    this.cap.add(brim);
    this.head.add(this.cap);
    this.helmet = new THREE.Mesh(GEO.helmet, M.cap);
    this.helmet.position.y = 0.0;
    this.head.add(this.helmet);
    this.mask = new THREE.Mesh(GEO.mask, mat('#111827'));
    this.mask.position.set(0, 0, 0.12);
    this.head.add(this.mask);
    this.bat = new THREE.Mesh(GEO.bat, M.bat);
    this.batPivot = new THREE.Group();
    this.batPivot.add(this.bat);
    this.torso.add(this.batPivot);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.setRole('fielder');
    this.hand = 'R';
    this.phase = Math.random() * 6;
  }

  setLook({ jersey, pants, cap, skin }) {
    if (jersey) this.mats.jersey.color.set(jersey);
    if (pants) this.mats.pants.color.set(pants);
    if (cap) this.mats.cap.color.set(cap);
    if (skin) this.mats.skin.color.set(skin);
  }

  setHand(h) {
    if (h === this.hand) return;
    this.hand = h;
    this.placeGlove();
  }

  placeGlove() {
    const gloveArm = this.hand === 'L' ? this.armR : this.armL;
    gloveArm.add(this.gloveMesh);
  }

  setRole(role) {
    if (this.role === role) return;
    this.role = role;
    const batter = role === 'batter';
    const runner = role === 'runner';
    this.bat.visible = batter;
    this.helmet.visible = batter || runner;
    this.cap.visible = !(batter || runner);
    this.mask.visible = role === 'catcher';
    this.gloveMesh.visible = !(batter || runner || role === 'umpire');
    this.placeGlove();
  }

  reset() {
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.hips.position.y = 0.95;
    this.torso.rotation.set(0, 0, 0);
    for (const l of [this.legL, this.legR]) { l.thigh.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); }
    this.armL.rotation.set(0, 0, 0.12);
    this.armR.rotation.set(0, 0, -0.12);
    this.head.rotation.set(0, 0, 0);
  }

  // throwing arm / glove arm helpers
  get tArm() { return this.hand === 'L' ? this.armL : this.armR; }
  get gArm() { return this.hand === 'L' ? this.armR : this.armL; }
  get side() { return this.hand === 'L' ? 1 : -1; } // x of throwing side

  crouch(depth) {
    // depth 0..1: bend knees keeping feet on the ground
    const a = depth * 1.1;
    for (const l of [this.legL, this.legR]) { l.thigh.rotation.x = -a; l.knee.rotation.x = a * 1.8; }
    this.hips.position.y = 0.95 - (0.46 * (1 - Math.cos(a)) + 0.46 * (1 - Math.cos(a * 0.8)));
    this.torso.rotation.x = a * 0.45;
  }

  run(speed, dt) {
    this.phase += dt * (3 + speed * 1.15);
    const p = this.phase;
    const amp = Math.min(1, 0.3 + speed / 8) * 0.95;
    this.legL.thigh.rotation.x = -Math.sin(p) * amp;
    this.legR.thigh.rotation.x = Math.sin(p) * amp;
    this.legL.knee.rotation.x = 0.35 + Math.max(0, Math.cos(p)) * amp * 1.3;
    this.legR.knee.rotation.x = 0.35 + Math.max(0, -Math.cos(p)) * amp * 1.3;
    this.armL.rotation.x = Math.sin(p) * amp * 1.1;
    this.armR.rotation.x = -Math.sin(p) * amp * 1.1;
    this.armL.rotation.z = 0.15; this.armR.rotation.z = -0.15;
    this.torso.rotation.x = 0.15 + speed * 0.015;
    this.body.position.y = Math.abs(Math.sin(p)) * 0.05 * amp;
  }

  pose(anim, t, speed, dt) {
    this.reset();
    const s = this.side;
    switch (anim) {
      case 'run':
        this.run(speed, dt);
        break;
      case 'ready':
        this.crouch(0.45);
        this.armL.rotation.x = -0.7; this.armR.rotation.x = -0.7;
        this.armL.rotation.z = -0.25; this.armR.rotation.z = 0.25;
        break;
      case 'crouch':
        this.crouch(1.05);
        this.legL.thigh.rotation.z = 0.35; this.legR.thigh.rotation.z = -0.35;
        this.gArm.rotation.x = -1.3;
        this.tArm.rotation.x = -0.3;
        break;
      case 'catchPitch':
        this.crouch(1.05);
        this.legL.thigh.rotation.z = 0.35; this.legR.thigh.rotation.z = -0.35;
        this.gArm.rotation.x = -1.5;
        break;
      case 'set':
        this.armL.rotation.x = -0.9; this.armR.rotation.x = -0.9;
        this.armL.rotation.z = -0.5; this.armR.rotation.z = 0.5;
        this.torso.rotation.y = s * -0.2;
        break;
      case 'windup': this.windup(t); break;
      case 'follow': this.followThrough(t); break;
      case 'stance': this.stance(t); break;
      case 'swing': this.swing(t); break;
      case 'bunt': this.buntPose(t); break;
      case 'throw': this.throwAnim(t, speed, dt); break;
      case 'catch':
        if (speed > 1) this.run(speed, dt); else this.crouch(0.25);
        this.gArm.rotation.x = -2.2 + Math.min(1, t * 2);
        break;
      case 'dive': {
        const k = Math.min(1, t * 4);
        this.body.rotation.x = 1.35 * k;
        this.body.position.y = 0.25 * k;
        this.armL.rotation.x = -2.9; this.armR.rotation.x = -2.9;
        this.legL.thigh.rotation.x = 0.2; this.legR.thigh.rotation.x = 0.3;
        break;
      }
      case 'lead':
        this.crouch(0.5);
        this.legL.thigh.rotation.z = 0.35; this.legR.thigh.rotation.z = -0.35;
        this.armL.rotation.z = 0.5; this.armR.rotation.z = -0.5;
        this.armL.rotation.x = -0.3; this.armR.rotation.x = -0.3;
        break;
      case 'umpire':
        this.crouch(0.7);
        this.torso.rotation.x = 0.5;
        this.armL.rotation.x = -0.3; this.armR.rotation.x = -0.3;
        break;
      case 'idle':
      default:
        this.armL.rotation.z = 0.1; this.armR.rotation.z = -0.1;
        break;
    }
  }

  windup(t) {
    const s = this.side;
    const front = this.hand === 'L' ? this.legR : this.legL;
    const back = this.hand === 'L' ? this.legL : this.legR;
    const k = (a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
    const lift = k(0.3, 0.65) * (1 - k(0.72, 0.95));
    const stride = k(0.72, 0.98);
    const whip = k(0.98, 1.15);
    // body turns sideways during the lift
    const turn = k(0.15, 0.4) * (1 - whip);
    this.torso.rotation.y = s * 1.3 * turn;
    front.thigh.rotation.x = -1.5 * lift - 0.5 * stride * (1 - whip) - 0.4 * whip;
    front.knee.rotation.x = 1.7 * lift + 0.2 * stride;
    back.knee.rotation.x = 0.3 * stride;
    back.thigh.rotation.x = 0.35 * stride;
    this.hips.position.y = 0.95 - 0.12 * stride;
    // hands together, then separate
    const sep = k(0.6, 0.9);
    this.armL.rotation.x = -1.0 * (1 - sep);
    this.armR.rotation.x = -1.0 * (1 - sep);
    this.gArm.rotation.x = -1.0 * (1 - sep) - 1.2 * sep * (1 - whip);
    this.tArm.rotation.x = -1.0 * (1 - sep) + 2.6 * sep * (1 - whip) - 1.6 * whip;
    this.tArm.rotation.z = -s * 0.5 * sep;
    this.torso.rotation.x = 0.55 * whip;
  }

  followThrough(t) {
    const k = Math.min(1, t / 0.7);
    const front = this.hand === 'L' ? this.legR : this.legL;
    const back = this.hand === 'L' ? this.legL : this.legR;
    this.torso.rotation.x = 0.55 * (1 - k) + 0.2 * k;
    this.tArm.rotation.x = -1.6 * (1 - k) - 0.5 * k;
    this.tArm.rotation.z = this.side * 0.6 * (1 - k);
    front.thigh.rotation.x = -0.4 * (1 - k) - 0.3 * k;
    front.knee.rotation.x = 0.3 + 0.3 * k;
    back.thigh.rotation.x = 0.6 * (1 - k);
    back.knee.rotation.x = 1.2 * (1 - k) + 0.3 * k;
    this.hips.position.y = 0.95 - 0.1;
    this.gArm.rotation.x = -0.8;
  }

  // Batter: root faces the plate; bat held over the back shoulder.
  stance(t) {
    this.crouch(0.3);
    this.legL.thigh.rotation.z = 0.25; this.legR.thigh.rotation.z = -0.25;
    const back = this.hand === 'L' ? 1 : -1; // back shoulder side (catcher side)
    this.torso.rotation.y = back * 0.25 + Math.sin(t * 3) * 0.03;
    this.armL.rotation.set(-1.0, 0, back * 0.5);
    this.armR.rotation.set(-1.0, 0, back * 0.5);
    this.batPivot.position.set(back * 0.15, 0.45, 0.2);
    this.batPivot.rotation.set(-0.5, 0, back * 0.55);
  }

  // Squared around, bat level over the plate
  buntPose(t) {
    const back = this.hand === 'L' ? 1 : -1;
    const k = Math.min(1, t / 0.25);
    this.crouch(0.45);
    this.legL.thigh.rotation.z = 0.2; this.legR.thigh.rotation.z = -0.2;
    this.torso.rotation.y = -back * 1.35 * k;
    this.armL.rotation.set(-1.25, 0, 0);
    this.armR.rotation.set(-1.25, 0, 0);
    this.batPivot.position.set(back * 0.12, 0.42, 0.42);
    this.batPivot.rotation.set(0.15, 0, -back * Math.PI / 2 * k);
  }

  swing(t) {
    const k = Math.min(1, t / 0.24);
    const e = k * k * (3 - 2 * k);
    this.crouch(0.3);
    const back = this.hand === 'L' ? 1 : -1;
    this.legL.thigh.rotation.z = 0.25; this.legR.thigh.rotation.z = -0.25;
    this.torso.rotation.y = back * 0.25 - back * 2.9 * e;
    this.armL.rotation.set(-1.4 + 0.3 * e, 0, back * 0.3 * (1 - e));
    this.armR.rotation.set(-1.4 + 0.3 * e, 0, back * 0.3 * (1 - e));
    // bat flattens and sweeps through the zone
    this.batPivot.position.set(back * 0.15 * (1 - e), 0.4, 0.35);
    this.batPivot.rotation.set(-0.5 - 1.0 * Math.min(1, e * 1.6), 0, back * (0.55 + 1.1 * Math.min(1, e * 1.4)));
  }

  throwAnim(t, speed, dt) {
    if (speed > 1.5) this.run(speed, dt);
    const k = Math.min(1, t / 0.32);
    this.tArm.rotation.x = k < 0.5 ? 2.6 * (k / 0.5) : 2.6 - 4.2 * ((k - 0.5) / 0.5);
    this.torso.rotation.y = this.side * 0.8 * (1 - k) - this.side * 0.3 * k;
    this.gArm.rotation.x = -1.2 * (1 - k);
  }
}

export function randomSkin(seed) {
  return SKINS[Math.abs(seed) % SKINS.length];
}
