export const COLS = 8, ROWS = 11, FLOOR_THICKNESS = .24, GAP = 1 + FLOOR_THICKNESS;
export const DIRECTIONS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const direction = c => DIRECTIONS[c.rotation ?? 0];
export const cellCenter = (x, z) => ({ x: x - (COLS - 1) / 2, z: z - (ROWS - 1) / 2 });
export const HOLE_RADIUS = .48;
// Goals are outward-facing openings in the perimeter, one cell wide.
export function goalEdge(c) {
  const [dx,dz] = direction(c);
  const edge = sharedEdge(c,{x:c.x+dx,z:c.z+dz});
  return (edge.axis === 'h' ? edge.z === 0 || edge.z === ROWS : edge.x === 0 || edge.x === COLS) ? edge : null;
}
// A projecting threshold blends back into the wall over the neighbouring edge.
// This is geometry, not an extra occupied editor cell.
export function goalRevealAlong(across) {
  const t = Math.max(0,Math.min(1,(Math.abs(across)-.30)/.36));
  return .35+.125*t*t*(3-2*t);
}
export function insideGoal(p, radius, cell, fi) {
  if (!goalEdge(cell)) return false;
  const q = cellCenter(cell.x,cell.z), [dx,dz] = direction(cell);
  const along = (p.x-q.x)*dx+(p.z-q.z)*dz;
  const across = (p.x-q.x)*(-dz)+(p.z-q.z)*dx;
  return along > .5+radius && along < 1
    && Math.abs(across) < .45-radius
    && p.y > -fi*GAP-.55 && p.y < -fi*GAP+.9;
}
export function footprint(c) {
  const [dx, dz] = direction(c);
  return c.type === 'ramp' ? [{ x: c.x, z: c.z }, { x: c.x + dx, z: c.z + dz }] : [{ x: c.x, z: c.z }];
}
export function sharedEdge(a, b) {
  return a.x === b.x ? { axis: 'h', x: a.x, z: Math.max(a.z, b.z) } : { axis: 'v', x: Math.max(a.x, b.x), z: a.z };
}
export function doorEdge(c) {
  const [dx,dz] = direction(c);
  return sharedEdge(c,{x:c.x+dx,z:c.z+dz});
}
export function doorSpec(c, fi) {
  const [dx,dz] = direction(c), p = cellCenter(c.x,c.z), y = -fi*GAP;
  const x=p.x+dx*.5,z=p.z+dz*.5,halfLength=.397,halfThickness=.07;
  const halfX=dz ? halfLength : halfThickness,halfZ=dx ? halfLength : halfThickness;
  return { dx,dz,x,z,y,halfLength,halfThickness,halfX,halfZ,
    travel:1.10,postBottom:y-GAP+.08,
    groove:[x-halfX-.012,z-halfZ-.012,x+halfX+.012,z+halfZ+.012] };
}
export function doorPose(spec, retraction) {
  const panelY=spec.y+.5-spec.travel*retraction;
  const postTop=panelY-.46,postHeight=Math.max(.02,postTop-spec.postBottom);
  return {panelY,postHeight,postY:spec.postBottom+postHeight/2};
}
// Visible fraction of the sky hemisphere through a rectangular channel.
export function slotSkyVisibility(depth, halfLength, halfWidth) {
  if(depth<=0)return 1;
  return 2/Math.PI*Math.atan(halfLength*halfWidth/(depth*Math.sqrt(depth*depth+halfLength*halfLength+halfWidth*halfWidth)));
}
export function subtractRectangle(rect, cut) {
  const [x0, z0, x1, z1] = rect;
  const a = Math.max(x0, cut[0]), b = Math.max(z0, cut[1]), c = Math.min(x1, cut[2]), d = Math.min(z1, cut[3]);
  if (a >= c || b >= d) return [rect];
  return [[x0,z0,a,z1], [c,z0,x1,z1], [a,z0,c,b], [a,d,c,z1]].filter(r => r[2]-r[0] > 1e-7 && r[3]-r[1] > 1e-7);
}
export function floorRectangles(stage, fi) {
  const f = stage.floors[fi], ramps = stage.floors[0].cells.filter(c => c.type === 'ramp');
  const holes = new Set([...f.cells.filter(c => c.type === 'hole'), ...(fi === 0 ? ramps.flatMap(footprint) : [])].map(c => `${c.x}:${c.z}`));
  const grooves = f.cells.filter(c => c.type === 'door').map(c => doorSpec(c, fi).groove);
  const result = [];
  for (let x=0;x<COLS;x++) for (let z=0;z<ROWS;z++) {
    if (holes.has(`${x}:${z}`)) continue;
    let parts = [[x-COLS/2,z-ROWS/2,x+1-COLS/2,z+1-ROWS/2]];
    for (const groove of grooves) parts = parts.flatMap(rect => subtractRectangle(rect, groove));
    result.push(...parts);
  }
  return result;
}
// Eight hull vertices fill the entire underside, including a thin toe at the entrance.
export function rampHull(c) {
  const [dx,dz] = direction(c), p = cellCenter(c.x,c.z), px = -dz, pz = dx;
  const points = [];
  for (const top of [false,true]) for (const [along, across] of [[-.5,-.5],[-.5,.5],[1.5,.5],[1.5,-.5]])
    points.push(p.x+dx*along+px*across, top ? (along < 0 ? -GAP+.005 : .005) : -GAP-.025, p.z+dz*along+pz*across);
  return new Float32Array(points);
}
