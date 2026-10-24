import { COLS, ROWS, GAP, footprint, sharedEdge, direction, doorEdge } from './mechanics.js';
export { COLS, ROWS, GAP };
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const wallKey = (axis, x, z) => `${axis}:${x}:${z}`;
export function floor(dark = false) {
  const walls = [];
  for (let x = 0; x < COLS; x++) walls.push({ axis: 'h', x, z: 0 }, { axis: 'h', x, z: ROWS });
  for (let z = 0; z < ROWS; z++) walls.push({ axis: 'v', x: 0, z }, { axis: 'v', x: COLS, z });
  return { dark, walls, cells: [] };
}
export function defaultStage() {
  const a = floor(),
    b = floor();
  a.walls.push(
    ...[0, 1, 2, 4, 5].map((x) => ({ axis: 'h', x, z: 3 })),
    ...[1, 2, 3, 4].map((x) => ({ axis: 'h', x, z: 6 })),
    ...[5, 6, 7].map((x) => ({ axis: 'h', x, z: 1 })),
    ...[4, 6, 7].map((x) => ({ axis: 'h', x, z: 2 })),
    { axis: 'h', x: 7, z: 3 },
    ...[5, 6].map((x) => ({ axis: 'h', x, z: 4 })),
    ...[2, 3, 4].map((x) => ({ axis: 'v', x, z: 0 })),
    { axis: 'v', x: 5, z: 2 },
    { axis: 'v', x: 7, z: 2 },
    { axis: 'v', x: 5, z: 4 }
  );
  a.cells = [
    { x: 4, z: 7, type: 'hole' },
    { x: 1, z: 4, type: 'sticky' },
    { x: 3, z: 2, type: 'door', rotation: 0 },
    { x: 2, z: 2, type: 'switch' },
    { x: 0, z: 9, type: 'ramp', rotation: 2 },
    { x: 6, z: 9, type: 'goal' },
  ];
  b.cells = [{ x: 2, z: 5, type: 'sticky' }];
  b.walls.push(...[2, 3, 4, 5].map(x => ({ axis: 'h', x, z: 4 })));
  return {
    version: 1,
    name: '光の通り道',
    author: 'marble_lab',
    limit: 180,
    size: 'M',
    balls: [
      { x: 1, z: 1 },
    ],
    floors: [a, b],
  };
}
const typeList = ['hole', 'goal', 'sticky', 'switch', 'door', 'robot', 'spider', 'slime', 'corner', 'ramp'];
const types = new Set(typeList);
export function validateStage(s, { allowIncomplete = false } = {}) {
  if (
    !s ||
    s.version !== 1 ||
    typeof s.name !== 'string' ||
    s.name.length > 40 ||
    typeof s.author !== 'string' ||
    s.author.length > 24 ||
    !['S', 'M'].includes(s.size) ||
    !Number.isFinite(s.limit) ||
    s.limit < 10 ||
    s.limit > 3600 ||
    !Array.isArray(s.balls) ||
    s.balls.length < (allowIncomplete ? 0 : 1) ||
    s.balls.length > 3 ||
    !Array.isArray(s.floors) ||
    s.floors.length !== 2
  )
    throw Error('ステージ形式が正しくありません');
  const cell = (p) =>
    Number.isInteger(p.x) &&
    Number.isInteger(p.z) &&
    p.x >= 0 &&
    p.x < COLS &&
    p.z >= 0 &&
    p.z < ROWS;
  if (!s.balls.every(p => cell(p) && [0, 1].includes(p.floor ?? 0)) || new Set(s.balls.map(p => `${p.floor ?? 0}:${p.x},${p.z}`)).size !== s.balls.length)
    throw Error('玉の位置が正しくありません');
  let goals = 0;
  const doorEdges=new Set();
  const occupiedLayers = [new Map(), new Map()];
  s.floors.forEach((f, i) => {
    if (
      !Array.isArray(f.walls) ||
      f.walls.length > COLS * (ROWS + 1) + (COLS + 1) * ROWS ||
      !Array.isArray(f.cells) ||
      f.cells.length > COLS * ROWS * 2 ||
      typeof f.dark !== 'boolean'
    )
      throw Error('フロア形式が正しくありません');
    const keys = new Set();
    for (const w of f.walls) {
      if (
        !['h', 'v'].includes(w.axis) ||
        !Number.isInteger(w.x) ||
        !Number.isInteger(w.z) ||
        w.x < 0 ||
        w.z < 0 ||
        w.x > (w.axis === 'h' ? COLS - 1 : COLS) ||
        w.z > (w.axis === 'h' ? ROWS : ROWS - 1)
      )
        throw Error('壁の位置が正しくありません');
      const k = wallKey(w.axis, w.x, w.z);
      if (keys.has(k)) throw Error('壁が重複しています');
      keys.add(k);
    }
    for (const c of f.cells) {
      if (
        !cell(c) ||
        !types.has(c.type) ||
        (c.rotation !== undefined &&
          (!Number.isInteger(c.rotation) || c.rotation < 0 || c.rotation > 3)) ||
        (c.rule !== undefined && !['left', 'right', 'random'].includes(c.rule))
      )
        throw Error('素材が正しくありません');
      if(c.type === 'door') {
        if(i !== 0) throw Error('昇降ドアは上段に配置してください');
        const edge=doorEdge(c),key=wallKey(edge.axis,edge.x,edge.z);
        if(doorEdges.has(key))throw Error('昇降ドアの辺が重複しています');
        doorEdges.add(key);
        if(s.floors.some(f=>f.walls.some(w=>wallKey(w.axis,w.x,w.z)===wallKey(edge.axis,edge.x,edge.z))))
          throw Error('昇降ドアの位置に固定壁があります');
      }
      if (c.type === 'ramp' && i !== 0) throw Error('坂道は上下を結ぶ上段素材として配置してください');
      const cells = footprint(c);
      if (!cells.every(cell)) throw Error('2マス素材が盤面からはみ出しています');
      const layers = c.type === 'ramp' || (c.type === 'door' && i === 0) ? [0, 1] : [i];
      for (const layer of layers) for (const tile of cells) {
        const key = `${tile.x},${tile.z}`;
        if (occupiedLayers[layer].has(key)) throw Error('素材の占有範囲・可動域が重なっています');
        occupiedLayers[layer].set(key, c);
      }
      if (cells.length === 2) {
        const edge = sharedEdge(cells[0], cells[1]);
        for (const layer of layers)
          if (s.floors[layer].walls.some(w => wallKey(w.axis,w.x,w.z) === wallKey(edge.axis,edge.x,edge.z)))
            throw Error('2マス素材の途中に仕切り壁があります');
        if (c.type === 'ramp') {
          const [dx,dz] = direction(c), exit = { x: c.x + 2*dx, z: c.z + 2*dz };
          if (!cell(exit)) throw Error('坂道の上側出口を盤面内へ向けてください');
          const exitEdge = sharedEdge(cells[1], exit);
          if (s.floors[0].walls.some(w => wallKey(w.axis,w.x,w.z) === wallKey(exitEdge.axis,exitEdge.x,exitEdge.z)))
            throw Error('坂道の上側出口に仕切り壁があります');
        }
      }
      if (c.type === 'goal') goals++;
      if (c.type === 'hole' && i === s.floors.length - 1)
        throw Error('下段には穴を配置できません');
    }
  });
  for (const p of s.balls) {
    const material = occupiedLayers[p.floor ?? 0].get(`${p.x},${p.z}`);
    if (material && !['sticky','switch'].includes(material.type)) throw Error('玉の開始位置に素材・可動域があります');
  }
  if (!goals && !allowIncomplete) throw Error('ゴールを1つ以上配置してください');
  return clone(s);
}
export function encodeStage(s) {
  s = validateStage(s);
  const compact = {
    v: 1,
    n: s.name,
    a: s.author,
    t: s.limit,
    s: s.size,
    b: s.balls.map(b => [b.x, b.z, b.floor ?? 0]),
    f: s.floors.map((f) => [
      f.dark ? 1 : 0,
      f.walls.map((w) => [w.axis === 'h' ? 0 : 1, w.x, w.z]),
      f.cells.map((c) => [
        c.x,
        c.z,
        typeList.indexOf(c.type),
        c.rotation ?? 0,
        ['right', 'left', 'random'].indexOf(c.rule ?? 'right'),
      ]),
    ]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function decodeStage(input) {
  const raw = input.trim();
  const code = raw.includes('#stage=') ? raw.split('#stage=')[1] : raw.replace(/^stage=/, '');
  if (code.length > 60000) throw Error('ステージデータが大きすぎます');
  try {
    const bin = atob(code.replaceAll('-', '+').replaceAll('_', '/'));
    const d = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    );
    if (d.v === 1) {
      if (
        !Array.isArray(d.f) ||
        d.f.some(
          (f) =>
            ![0, 1].includes(f[0]) ||
            !Array.isArray(f[1]) ||
            f[1].some((w) => ![0, 1].includes(w[0]))
        )
      )
        throw Error('圧縮データが正しくありません');
      return validateStage({
        version: 1,
        name: d.n,
        author: d.a,
        limit: d.t,
        size: d.s,
        balls: d.b.map(b => ({ x: b[0], z: b[1], floor: b[2] ?? 0 })),
        floors: d.f.map((f) => ({
          dark: !!f[0],
          walls: f[1].map((w) => ({ axis: w[0] === 0 ? 'h' : 'v', x: w[1], z: w[2] })),
          cells: f[2].map((c) => ({
            x: c[0],
            z: c[1],
            type: typeList[c[2]],
            rotation: c[3],
            rule: ['right', 'left', 'random'][c[4]],
          })),
        })),
      });
    }
    return validateStage(d);
  } catch (e) {
    throw Error('ステージを読み込めません：' + e.message);
  }
}
export function stageURL(s) {
  return `${location.href.split('#')[0]}#stage=${encodeStage(s)}`;
}
