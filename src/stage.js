export const COLS = 8,
  ROWS = 11,
  GAP = 3;
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
    b = floor(),
    c = floor();
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
    { x: 3, z: 3, type: 'door', rotation: 0 },
    { x: 2, z: 2, type: 'switch' },
  ];
  b.cells = [
    { x: 1, z: 7, type: 'hole' },
    { x: 2, z: 4, type: 'sticky' },
  ];
  b.walls.push(...[0, 1, 3, 4, 5].map((x) => ({ axis: 'h', x, z: 4 })));
  c.cells = [
    { x: 4, z: 7, type: 'goal' },
  ];
  return {
    version: 1,
    name: '光の通り道',
    author: 'marble_lab',
    limit: 180,
    size: 'M',
    balls: [
      { x: 1, z: 1 },
    ],
    floors: [a, b, c],
  };
}
const typeList = ['hole', 'goal', 'sticky', 'switch', 'door', 'robot', 'spider', 'slime', 'corner'];
const types = new Set(typeList);
export function validateStage(s) {
  if (
    !s ||
    s.version !== 1 ||
    typeof s.name !== 'string' ||
    s.name.length > 40 ||
    typeof s.author !== 'string' ||
    s.author.length > 24 ||
    !['S', 'M', 'L'].includes(s.size) ||
    !Number.isFinite(s.limit) ||
    s.limit < 10 ||
    s.limit > 3600 ||
    !Array.isArray(s.balls) ||
    s.balls.length < 1 ||
    s.balls.length > 3 ||
    !Array.isArray(s.floors) ||
    !s.floors.length ||
    s.floors.length > 12
  )
    throw Error('ステージ形式が正しくありません');
  const cell = (p) =>
    Number.isInteger(p.x) &&
    Number.isInteger(p.z) &&
    p.x >= 0 &&
    p.x < COLS &&
    p.z >= 0 &&
    p.z < ROWS;
  if (!s.balls.every(cell) || new Set(s.balls.map((p) => `${p.x},${p.z}`)).size !== s.balls.length)
    throw Error('玉の位置が正しくありません');
  let goals = 0;
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
    const occupied = new Map();
    for (const c of f.cells) {
      if (
        !cell(c) ||
        !types.has(c.type) ||
        (c.rotation !== undefined &&
          (!Number.isInteger(c.rotation) || c.rotation < 0 || c.rotation > 3)) ||
        (c.rule !== undefined && !['left', 'right', 'random'].includes(c.rule))
      )
        throw Error('素材が正しくありません');
      const k = `${c.x},${c.z}`,
        list = occupied.get(k) || [];
      if (
        list.length &&
        !(
          (list.every((t) => t === 'sticky') && c.type === 'door') ||
          (list.every((t) => t === 'door') && c.type === 'sticky')
        )
      )
        throw Error('共存できない素材があります');
      list.push(c.type);
      occupied.set(k, list);
      if (c.type === 'goal') goals++;
      if (c.type === 'hole' && i === s.floors.length - 1)
        throw Error('最下層には穴を配置できません');
    }
    if (i === 0)
      for (const p of s.balls)
        if (
          f.cells.some(
            (c) => c.x === p.x && c.z === p.z && c.type !== 'sticky' && c.type !== 'switch'
          )
        )
          throw Error('玉の開始位置に素材があります');
  });
  if (!goals) throw Error('ゴールを1つ以上配置してください');
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
    b: s.balls.map((b) => [b.x, b.z]),
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
        balls: d.b.map((b) => ({ x: b[0], z: b[1] })),
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
