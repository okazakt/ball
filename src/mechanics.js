export const COLS = 8, ROWS = 11, FLOOR_THICKNESS = .24, GAP = 1 + FLOOR_THICKNESS;
export const DIRECTIONS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const direction = c => DIRECTIONS[c.rotation ?? 0];
export const cellCenter = (x, z) => ({ x: x - (COLS - 1) / 2, z: z - (ROWS - 1) / 2 });
export const MARKER_EDGE = .46, MARKER_BUMP_RADIUS = .035;
export const HOLE_RADIUS = .48;
export function insideGoal(p, radius, cell, fi) {
  const q = cellCenter(cell.x, cell.z);
  const inset = MARKER_EDGE - MARKER_BUMP_RADIUS;
  return Math.abs(p.x-q.x) < inset && Math.abs(p.z-q.z) < inset
    && Math.abs(p.y-(-fi*GAP+radius)) < .06;
}
export function footprint(c) {
  const [dx, dz] = direction(c);
  return ['door', 'ramp'].includes(c.type) ? [{ x: c.x, z: c.z }, { x: c.x + dx, z: c.z + dz }] : [{ x: c.x, z: c.z }];
}
export function sharedEdge(a, b) {
  return a.x === b.x ? { axis: 'h', x: a.x, z: Math.max(a.z, b.z) } : { axis: 'v', x: Math.max(a.x, b.x), z: a.z };
}
export function doorSpec(c, fi) {
  const [dx, dz] = direction(c), center = cellCenter(c.x, c.z), y = -fi * GAP;
  // Fixed wall half-width (.088), door half-width (.06), and .02 clearance.
  // Place the door along the left edge of its travel direction.
  const offset = .5 - .088 - .06 - .02;
  const p = { x: center.x + dz * offset, z: center.z - dx * offset };
  const postBottom = fi === 0 ? -GAP + .08 : y - .18, postTop = y + .12;
  return { dx, dz, x: p.x, z: p.z, y,
    postHeight: postTop - postBottom, postY: (postTop + postBottom) / 2,
    groove: [Math.min(p.x, p.x + dx) - (dx ? .1 : .08), Math.min(p.z, p.z + dz) - (dz ? .1 : .08),
      Math.max(p.x, p.x + dx) + (dx ? .1 : .08), Math.max(p.z, p.z + dz) + (dz ? .1 : .08)] };
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
