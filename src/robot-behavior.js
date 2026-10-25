import { COLS, ROWS, footprint } from './mechanics.js';
export const STRONG_SHAKE_ACCELERATION = 26;
export const STRONG_SHAKE_TILT_RATE = 6;
export const STRONG_SHAKE_DURATION = 1.2;
export const ROBOT_STUN_RELEASE = .5;
export function robotShakeCharge(charge, strong, dt) {
  return Math.max(0, Math.min(STRONG_SHAKE_DURATION, charge + (strong ? dt : -2 * dt)));
}
// Direction indices rotate counterclockwise: south, east, north, west.
export const rightWallOrder = heading => [3,0,1,2].map(offset => (heading+offset)%4);

function rectangle(segments,x0,z0,x1,z1) {
  segments.push([x0,z0,x1,z0],[x1,z0,x1,z1],[x1,z1,x0,z1],[x0,z1,x0,z0]);
}
export function visionObstacles(stage, fi, halfThickness=.05, extension=.05, doors=[]) {
  const segments=[];
  for(const w of stage.floors[fi].walls) {
    const x=w.x-COLS/2,z=w.z-ROWS/2;
    if(w.axis==='h') rectangle(segments,x-extension,z-halfThickness,x+1+extension,z+halfThickness);
    else rectangle(segments,x-halfThickness,z-extension,x+halfThickness,z+1+extension);
  }
  const blocked=new Map();
  for(const c of stage.floors[fi].cells)
    if(['corner','hole'].includes(c.type))blocked.set(`${c.x}:${c.z}`,c);
  for(const c of stage.floors[0].cells.filter(c=>c.type==='ramp'))
    for(const p of footprint(c))blocked.set(`${p.x}:${p.z}`,p);
  for(const c of blocked.values())rectangle(segments,c.x-COLS/2,c.z-ROWS/2,c.x+1-COLS/2,c.z+1-ROWS/2);
  for(const d of doors) {
    if(fi===d.fi&&!d.open)rectangle(segments,d.x-d.halfX,d.z-d.halfZ,d.x+d.halfX,d.z+d.halfZ);
    else if(fi===1&&d.fi===0)rectangle(segments,d.x-.055,d.z-.055,d.x+.055,d.z+.055);
  }
  return segments;
}
const cross=(ax,az,bx,bz)=>ax*bz-az*bx;
export function sightDistance(origin, angle, segments, range=2) {
  const dx=Math.sin(angle),dz=Math.cos(angle);
  let nearest=range;
  for(const [x0,z0,x1,z1] of segments) {
    const sx=x1-x0,sz=z1-z0,den=cross(dx,dz,sx,sz);
    if(Math.abs(den)<1e-10)continue;
    const qx=x0-origin.x,qz=z0-origin.z;
    const t=cross(qx,qz,sx,sz)/den,u=cross(qx,qz,dx,dz)/den;
    if(t>=0&&u>=-1e-9&&u<=1+1e-9)nearest=Math.min(nearest,t);
  }
  return nearest;
}
export function visionPolygon(origin, heading, segments, range=2, halfAngle=.5) {
  const nearby=segments.filter(([x0,z0,x1,z1])=>
    origin.x>=Math.min(x0,x1)-range&&origin.x<=Math.max(x0,x1)+range&&
    origin.z>=Math.min(z0,z1)-range&&origin.z<=Math.max(z0,z1)+range);
  const angles=Array.from({length:49},(_,i)=>-halfAngle+2*halfAngle*i/48);
  // Rays either side of obstacle corners preserve narrow silhouettes.
  for(const segment of nearby) for(let i=0;i<4;i+=2) {
    const a=Math.atan2(segment[i]-origin.x,segment[i+1]-origin.z)-heading;
    const relative=Math.atan2(Math.sin(a),Math.cos(a));
    for(const offset of [-1e-5,0,1e-5])if(Math.abs(relative+offset)<halfAngle)angles.push(relative+offset);
  }
  return [...new Set(angles)].sort((a,b)=>a-b).map(relative=>{
    const angle=heading+relative,distance=Math.max(0,sightDistance(origin,angle,nearby,range)-.002);
    return {x:origin.x+Math.sin(angle)*distance,z:origin.z+Math.cos(angle)*distance};
  });
}
