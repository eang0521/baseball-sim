import { makeBall, carryDistance, aimPitch, RPM, predictTrajectory } from '../js/sim/physics.js';
import { MPH, FT, INCH } from '../js/sim/field.js';
for (const [ev, la, rpm] of [[95,28,2200],[100,28,2400],[105,28,2400],[110,30,2400],[100,15,1500],[90,40,2800],[80,60,3000]]) {
  const s = ev*MPH, a = la*Math.PI/180;
  const b = makeBall({x:0,y:0.3,z:1}, {x:0,y:s*Math.cos(a),z:s*Math.sin(a)}, {x:rpm*RPM,y:0,z:0});
  const tr = predictTrajectory(b);
  console.log(ev, la, 'carry ft', (carryDistance(b)/FT).toFixed(0), 'hang', tr.firstBounce?.toFixed(2));
}
// grounder
for (const [ev,la] of [[90,-5],[100,2],[70,-10]]) {
  const s = ev*MPH, a = la*Math.PI/180;
  const b = makeBall({x:0,y:0.3,z:0.8}, {x:0,y:s*Math.cos(a),z:s*Math.sin(a)}, {x:-1200*RPM,y:0,z:0});
  const tr = predictTrajectory(b);
  const at = (d)=> tr.samples.find(q=>q.y>d)?.t;
  console.log('grounder', ev, la, 't@40m', at(40)?.toFixed(2), 'end', tr.end, (tr.samples.at(-1).y/FT).toFixed(0),'ft', tr.endT.toFixed(1));
}
// pitch: fastball no spin vs spin
const rel = {x:-0.5, y:17.0, z:1.8};
for (const [name, mph, w] of [['none',95,{x:0,y:0,z:0}],['FF',95,{x:-0.9*2300*RPM,y:0,z:-0.35*2300*RPM}],['CU',80,{x:0.85*2500*RPM,y:0,z:0.4*2500*RPM}]]) {
  const r0 = aimPitch(rel, mph*MPH, {x:0,y:0,z:0}, 0, 0.75, 0.3);
  const b = aimPitch(rel, mph*MPH, w, 0, 0.75, 0.3);
  // movement: fly r0.v with spin w and compare to no-spin
  console.log(name, 'time', b.hit.t.toFixed(3));
}
