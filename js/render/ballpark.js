// Builds the ballpark: painted field texture, mound, bases, walls, stands, lights.
import * as THREE from 'three';
import {
  BASE_DIST, BASES, RUBBER, MOUND_RADIUS, fenceDistance, FENCE_HEIGHT, FOUL_WALL_OFFSET,
  BACKSTOP_Y, FT, INCH, PLATE_HALF_WIDTH,
} from '../sim/field.js';

// sim (x, y, z) -> three (x, z, -y)
export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

const X0 = -95, X1 = 95, Y0 = -24, Y1 = 132;

const C = {
  grassA: '#3d8c3b', grassB: '#46993f', grassFoul: '#3b8537',
  dirt: '#b9825a', dirtDark: '#a8734d', mound: '#c38c61', track: '#9e6f4d',
  line: '#f5f5f0',
};

function paintField(size) {
  const w = size, h = Math.round((size * (Y1 - Y0)) / (X1 - X0));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const s = w / (X1 - X0);
  const P = (x, y) => [(x - X0) * s, (Y1 - y) * s];
  const path = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath();
  };
  const circle = (x, y, r) => { const [px, py] = P(x, y); ctx.beginPath(); ctx.arc(px, py, r * s, 0, Math.PI * 2); };

  // foul-ground grass
  ctx.fillStyle = C.grassFoul;
  ctx.fillRect(0, 0, w, h);

  // fair territory outline (to the fence)
  const fair = [[0, 0]];
  for (let a = -45; a <= 45; a += 1) {
    const d = fenceDistance(a), r = (a * Math.PI) / 180;
    fair.push([Math.sin(r) * d, Math.cos(r) * d]);
  }
  ctx.save();
  // mowing checkerboard over the whole playing surface
  ctx.fillStyle = C.grassA;
  ctx.fillRect(0, 0, w, h);
  const band = 4.6;
  ctx.save();
  const [ox, oy] = P(0, 0);
  ctx.translate(ox, oy);
  ctx.rotate(Math.PI / 4);
  for (let i = -40; i < 40; i++) {
    for (let j = -40; j < 40; j++) {
      if ((i + j) & 1) continue;
      ctx.fillStyle = C.grassB;
      ctx.fillRect(i * band * s, j * band * s, band * s, band * s);
    }
  }
  ctx.restore();
  ctx.restore();

  // warning track
  ctx.save();
  path(fair);
  ctx.clip();
  ctx.fillStyle = C.track;
  const trk = [];
  for (let a = -46; a <= 46; a += 1) {
    const d = fenceDistance(a) + 3, r = (a * Math.PI) / 180;
    trk.push([Math.sin(r) * d, Math.cos(r) * d]);
  }
  for (let a = 46; a >= -46; a -= 1) {
    const d = fenceDistance(a) - 4.6, r = (a * Math.PI) / 180;
    trk.push([Math.sin(r) * d, Math.cos(r) * d]);
  }
  path(trk);
  ctx.fill();
  ctx.restore();

  // infield dirt arc (95 ft from the rubber), clipped to a wedge a bit wider than fair ground
  ctx.save();
  path([[0, -6], [-60, 54], [60, 54]]);
  ctx.clip();
  ctx.fillStyle = C.dirt;
  circle(RUBBER.x, RUBBER.y - 0.3, 95 * FT);
  ctx.fill();
  ctx.restore();

  // infield grass
  const inset = 1.8, BD = BASE_DIST;
  const uv = (u, v) => [(u - v) / Math.SQRT2, (u + v) / Math.SQRT2];
  ctx.fillStyle = C.grassB;
  path([uv(inset, inset), uv(BD - inset, inset), uv(BD - inset, BD - inset), uv(inset, BD - inset)]);
  ctx.fill();
  // mow stripes inside the infield square
  ctx.save();
  path([uv(inset, inset), uv(BD - inset, inset), uv(BD - inset, BD - inset), uv(inset, BD - inset)]);
  ctx.clip();
  ctx.fillStyle = C.grassA;
  for (let k = 0; k < 12; k += 2) {
    const a = inset + ((BD - 2 * inset) / 12) * k, b = a + (BD - 2 * inset) / 12;
    path([uv(a, inset), uv(b, inset), uv(b, BD), uv(a, BD)]);
    ctx.fill();
  }
  ctx.restore();

  // home plate circle, mound, cutouts around bases
  ctx.fillStyle = C.dirt;
  circle(0, 0.2, 13 * FT);
  ctx.fill();
  ctx.fillStyle = C.mound;
  circle(RUBBER.x, RUBBER.y - 0.3, MOUND_RADIUS);
  ctx.fill();
  for (let b = 1; b <= 3; b++) {
    ctx.fillStyle = C.dirt;
    circle(BASES[b].x, BASES[b].y, 13 * FT * 0.55);
    ctx.fill();
  }
  // running lane dirt along base paths near home
  ctx.fillStyle = C.dirt;
  for (const sgn of [1, -1]) {
    const pts = sgn > 0
      ? [uv(0, -0.9), uv(BD, -0.9), uv(BD, 0.9), uv(0, 0.9)]
      : [uv(-0.9, 0), uv(-0.9, BD), uv(0.9, BD), uv(0.9, 0)];
    path(pts);
    ctx.fill();
  }

  // foul lines
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.5, 0.1 * s);
  for (const sgn of [1, -1]) {
    const d = fenceDistance(45 * sgn) / Math.SQRT2;
    const [ax, ay] = P(sgn * 0.3, 0.3), [bx, by] = P(sgn * d, d);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // batter's boxes (4 ft x 6 ft), catcher's box
  const bw = 4 * FT, bl = 6 * FT, gap = 6 * INCH + PLATE_HALF_WIDTH;
  for (const sgn of [1, -1]) {
    const x0 = sgn * gap, x1 = sgn * (gap + bw);
    path([[x0, -bl / 2 + 0.2], [x1, -bl / 2 + 0.2], [x1, bl / 2 + 0.2], [x0, bl / 2 + 0.2]]);
    ctx.stroke();
  }
  ctx.beginPath();
  { const [a, b] = P(-0.55, -bl / 2 + 0.2); const [c, d] = P(-0.55, -2.8); ctx.moveTo(a, b); ctx.lineTo(c, d); }
  { const [c, d] = P(0.55, -2.8); ctx.lineTo(c, d); const [e, f] = P(0.55, -bl / 2 + 0.2); ctx.lineTo(e, f); }
  ctx.stroke();
  // on-deck circles
  ctx.fillStyle = C.dirtDark;
  for (const sgn of [1, -1]) { circle(sgn * 12, -6.5, 0.8); ctx.fill(); }
  // coach's boxes
  ctx.lineWidth = Math.max(1, 0.06 * s);
  for (const sgn of [1, -1]) {
    const bx = sgn * (BD / Math.SQRT2 + 5), by = BD / Math.SQRT2 - 5;
    path([[bx, by], [bx + sgn * 1.5, by + 1.5], [bx + sgn * 0.1, by + 7.5], [bx - sgn * 1.4, by + 6]]);
    ctx.stroke();
  }
  return cv;
}

function crowdTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#23324a';
  ctx.fillRect(0, 0, 1024, 256);
  const cols = ['#e8e1d4', '#c0392b', '#2c3e50', '#f1c40f', '#ecf0f1', '#1f6fb2', '#7f8c8d', '#e67e22', '#27ae60', '#8e44ad', '#fdfdfd', '#d35400'];
  for (let row = 0; row < 32; row++) {
    ctx.fillStyle = row % 2 ? '#1c2a3f' : '#27374f';
    ctx.fillRect(0, row * 8, 1024, 2);
    for (let i = 0; i < 180; i++) {
      if (Math.random() < 0.18) continue;
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
      const x = i * 5.7 + Math.random() * 2;
      ctx.fillRect(x, row * 8 + 2, 3.2, 5);
      ctx.fillStyle = '#e0b894';
      if (Math.random() < 0.8) ctx.fillRect(x + 0.6, row * 8 + 1, 2, 1.6);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Closed boundary of the playing area (sim coords), with wall heights.
function boundary() {
  const pts = [];
  const d = (a) => fenceDistance(a);
  const s2 = Math.SQRT1_2;
  const off = FOUL_WALL_OFFSET;
  const cornerT = 330 * FT - 2;
  // LF foul wall from corner to backstop
  const lf = (t) => [(-t - off) * s2, (t - off) * s2];
  const rf = (t) => [(t + off) * s2, (t - off) * s2];
  const tBack = off - (-BACKSTOP_Y) * Math.SQRT2; // where foul wall meets backstop
  // outfield arc from LF corner (-45) to RF corner (+45)
  for (let a = -45; a <= 45; a += 1.5) {
    const r = (a * Math.PI) / 180;
    pts.push({ x: Math.sin(r) * d(a), y: Math.cos(r) * d(a), h: FENCE_HEIGHT, fence: true });
  }
  // RF corner down the RF foul wall
  for (let t = cornerT; t >= tBack; t -= 6) {
    const [x, y] = rf(t);
    pts.push({ x, y, h: 1.3 });
  }
  const [bx] = rf(tBack);
  pts.push({ x: bx, y: BACKSTOP_Y, h: 1.3 });
  pts.push({ x: 0, y: BACKSTOP_Y, h: 1.3, backstop: true });
  pts.push({ x: -bx, y: BACKSTOP_Y, h: 1.3 });
  for (let t = tBack; t <= cornerT; t += 6) {
    const [x, y] = lf(t);
    pts.push({ x, y, h: 1.3 });
  }
  const [cx, cy] = lf(cornerT);
  pts.push({ x: cx, y: cy, h: 1.3 });
  // outward normals
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    let nx = ty, ny = -tx;
    const p = pts[i];
    if (nx * p.x + ny * (p.y - 35) < 0) { nx = -nx; ny = -ny; }
    p.nx = nx; p.ny = ny;
  }
  return pts;
}

function ribbon(pts, inner, outer, mat, closed = true, uScale = 30, vRep = 1) {
  // pts: array of {x,y}; inner/outer: fn(p) -> {x,y,z}
  const pos = [], uvs = [], idx = [];
  let u = 0;
  const n = pts.length;
  const count = closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const p = pts[k % n];
    if (k > 0) {
      const q = pts[(k - 1) % n];
      u += Math.hypot(p.x - q.x, p.y - q.y);
    }
    const a = inner(p), b = outer(p);
    pos.push(a.x, a.z, -a.y, b.x, b.z, -b.y);
    uvs.push(u / uScale, 0, u / uScale, vRep);
    if (k > 0) {
      const i = (k - 1) * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  return m;
}

export function buildBallpark(renderer) {
  const group = new THREE.Group();
  const maxTex = renderer.capabilities.maxTextureSize;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const size = Math.min(maxTex, small ? 2048 : 4096);

  // ground
  const fieldCanvas = paintField(size);
  const tex = new THREE.CanvasTexture(fieldCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(X1 - X0, Y1 - Y0),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((X0 + X1) / 2, 0, -(Y0 + Y1) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // surrounding concourse ground
  const outer = new THREE.Mesh(new THREE.CircleGeometry(420, 48), new THREE.MeshLambertMaterial({ color: '#4b5563' }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(0, -0.05, -50);
  group.add(outer);

  // mound
  const moundGeo = new THREE.CylinderGeometry(MOUND_RADIUS * 0.35, MOUND_RADIUS, 0.25, 40, 1);
  const mound = new THREE.Mesh(moundGeo, new THREE.MeshLambertMaterial({ color: '#c38c61' }));
  mound.position.copy(V(RUBBER.x, RUBBER.y - 0.3, 0.12));
  mound.receiveShadow = true;
  group.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.15), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  rubber.position.copy(V(0, RUBBER.y, 0.255));
  group.add(rubber);

  // bases
  const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  for (let b = 1; b <= 3; b++) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), white);
    const p = BASES[b];
    bag.position.copy(V(p.x, p.y, 0.04));
    bag.rotation.y = Math.PI / 4;
    bag.castShadow = true;
    group.add(bag);
  }
  const shape = new THREE.Shape();
  const hw = PLATE_HALF_WIDTH, l = 8.5 * INCH;
  shape.moveTo(0, 0); shape.lineTo(hw, l); shape.lineTo(hw, 2 * l); shape.lineTo(-hw, 2 * l); shape.lineTo(-hw, l); shape.closePath();
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }), white);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.005;
  group.add(plate);

  // walls
  const pts = boundary();
  const wallMat = new THREE.MeshLambertMaterial({ color: '#1f4d33', side: THREE.DoubleSide });
  const padMat = new THREE.MeshLambertMaterial({ color: '#16324f', side: THREE.DoubleSide });
  const fencePts = pts.filter((p) => p.fence);
  const otherPts = pts.filter((p) => !p.fence);
  group.add(ribbon(fencePts, (p) => ({ x: p.x, y: p.y, z: 0 }), (p) => ({ x: p.x, y: p.y, z: p.h }), wallMat, false));
  const yellow = new THREE.MeshBasicMaterial({ color: '#f5c518', side: THREE.DoubleSide });
  group.add(ribbon(fencePts, (p) => ({ x: p.x, y: p.y, z: p.h - 0.12 }), (p) => ({ x: p.x, y: p.y, z: p.h }), yellow, false));
  const lastF = fencePts[fencePts.length - 1], firstF = fencePts[0];
  group.add(ribbon([lastF, ...otherPts, firstF], (p) => ({ x: p.x, y: p.y, z: 0 }), (p) => ({ x: p.x, y: p.y, z: p.fence ? FENCE_HEIGHT : 1.3 }), padMat, false));

  // backstop netting
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 9),
    new THREE.MeshBasicMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.position.copy(V(0, BACKSTOP_Y - 0.2, 5.8));
  group.add(net);

  // stands
  const crowd = crowdTexture();
  crowd.repeat.set(1, 1);
  const standMat = new THREE.MeshLambertMaterial({ map: crowd, side: THREE.DoubleSide });
  const depthOf = (p) => (p.fence ? (Math.abs(p.x) < 14 ? 0 : 20) : 34);
  const inner = (p) => ({ x: p.x + p.nx * 1.2, y: p.y + p.ny * 1.2, z: (p.fence ? FENCE_HEIGHT : 1.3) + 0.8 });
  const outerF = (p) => {
    const d = depthOf(p);
    return { x: p.x + p.nx * (1.2 + d), y: p.y + p.ny * (1.2 + d), z: (p.fence ? FENCE_HEIGHT : 1.3) + 0.8 + d * 0.55 };
  };
  const stands = ribbon(pts, inner, outerF, standMat, true, 90, 1.3);
  stands.receiveShadow = true;
  group.add(stands);
  // stand faces (front wall below first row)
  group.add(ribbon(pts, (p) => ({ x: p.x + p.nx * 1.2, y: p.y + p.ny * 1.2, z: 0 }), inner, padMat, true));
  // upper deck behind the infield
  const upper = otherPts.filter((p) => p.y < 60);
  const up = ribbon(upper,
    (p) => ({ x: p.x + p.nx * 30, y: p.y + p.ny * 30, z: 26 }),
    (p) => ({ x: p.x + p.nx * 52, y: p.y + p.ny * 52, z: 40 }), standMat, false, 90, 0.9);
  group.add(up);
  const fascia = ribbon(upper,
    (p) => ({ x: p.x + p.nx * 30, y: p.y + p.ny * 30, z: 23.5 }),
    (p) => ({ x: p.x + p.nx * 30, y: p.y + p.ny * 30, z: 26 }),
    new THREE.MeshLambertMaterial({ color: '#0f2744', side: THREE.DoubleSide }), false);
  group.add(fascia);

  // batter's eye
  const eye = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 3), new THREE.MeshLambertMaterial({ color: '#1b3a2a' }));
  eye.position.copy(V(0, fenceDistance(0) + 4, 4.5));
  group.add(eye);

  // foul poles
  const poleMat = new THREE.MeshLambertMaterial({ color: '#f5c518' });
  for (const sgn of [1, -1]) {
    const d = fenceDistance(45 * sgn) / Math.SQRT2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 26, 8), poleMat);
    pole.position.copy(V(sgn * d, d, 13));
    group.add(pole);
  }

  // light towers
  const towerMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });
  const panelMat = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
  for (const [x, y] of [[-80, 20], [80, 20], [-95, 90], [95, 90], [-40, 150], [40, 150]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 50, 8), towerMat);
    pole.position.copy(V(x, y, 25));
    group.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 1), panelMat);
    panel.position.copy(V(x, y, 52));
    panel.lookAt(V(0, 45, 0));
    group.add(panel);
  }

  // scoreboard in center field
  const sbCanvas = document.createElement('canvas');
  sbCanvas.width = 1024; sbCanvas.height = 384;
  const sbTex = new THREE.CanvasTexture(sbCanvas);
  sbTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(40, 15), new THREE.MeshBasicMaterial({ map: sbTex }));
  const bd = fenceDistance(0) + 30;
  board.position.copy(V(0, bd, 26));
  group.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(42, 17, 1), new THREE.MeshLambertMaterial({ color: '#111827' }));
  frame.position.copy(V(0, bd + 0.6, 26));
  group.add(frame);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(30, 18, 1), new THREE.MeshLambertMaterial({ color: '#1f2937' }));
  legs.position.copy(V(0, bd + 0.8, 9));
  group.add(legs);

  let lastBoard = '';
  function updateScoreboard(game) {
    const s = game.state;
    const key = JSON.stringify([s.line, s.score, s.hits, s.errors, s.inning, s.half, s.outs, s.balls, s.strikes, game.message]);
    if (key === lastBoard) return;
    lastBoard = key;
    const c = sbCanvas.getContext('2d');
    c.fillStyle = '#05080f';
    c.fillRect(0, 0, 1024, 384);
    c.font = 'bold 34px "Courier New", monospace';
    const inn = Math.max(9, s.inning);
    const start = inn - 9;
    const colW = 58, x0 = 250;
    c.fillStyle = '#fbbf24';
    for (let i = 0; i < 9; i++) c.fillText(String(start + i + 1), x0 + i * colW, 60);
    c.fillText('R', x0 + 9 * colW + 20, 60);
    c.fillText('H', x0 + 10 * colW + 20, 60);
    c.fillText('E', x0 + 11 * colW + 20, 60);
    for (let t = 0; t < 2; t++) {
      const y = 130 + t * 70;
      c.fillStyle = '#f8fafc';
      c.fillText(game.sides[t].team.abbr, 40, y);
      for (let i = 0; i < 9; i++) {
        const v = s.line[t][start + i];
        if (v !== undefined) c.fillText(String(v), x0 + i * colW, y);
      }
      c.fillStyle = '#fbbf24';
      c.fillText(String(s.score[t]), x0 + 9 * colW + 20, y);
      c.fillStyle = '#f8fafc';
      c.fillText(String(s.hits[t]), x0 + 10 * colW + 20, y);
      c.fillText(String(s.errors[t]), x0 + 11 * colW + 20, y);
    }
    c.fillStyle = '#22c55e';
    c.font = 'bold 30px "Courier New", monospace';
    c.fillText(`BALL ${s.balls}  STRIKE ${s.strikes}  OUT ${s.outs}`, 40, 300);
    c.fillStyle = '#fbbf24';
    const msg = (game.message || '').toUpperCase().slice(0, 30);
    c.fillText(msg, 40, 350);
    sbTex.needsUpdate = true;
  }

  return { group, updateScoreboard };
}
