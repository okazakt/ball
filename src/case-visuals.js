const T = window.THREE;

// Union axis-aligned footprints before extrusion: no cell seams or internal
// transparent faces, including at wall junctions and adjacent floor holes.
export function solidGeometry(rectangles, height, { bevel = 0, fillet = 0, outlineOnly = false } = {}) {
  rectangles = rectangles.map(r => r.map(v => Math.round(v * 1e6) / 1e6));
  const xs = [...new Set(rectangles.flatMap(r => [r[0], r[2]]))].sort((a, b) => a - b);
  const zs = [...new Set(rectangles.flatMap(r => [r[1], r[3]]))].sort((a, b) => a - b);
  const filled = xs.slice(1).map((_, i) => zs.slice(1).map((_, j) => {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
    return rectangles.some(r => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
  }));
  const edges = new Map(), key = (x, z) => `${x}:${z}`;
  const add = (x, z, nx, nz) => {
    const k = key(x, z), list = edges.get(k) || [];
    list.push([nx, nz]);
    edges.set(k, list);
  };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (!filled[i][j]) continue;
    if (!filled[i]?.[j - 1]) add(i, j, i + 1, j);
    if (!filled[i + 1]?.[j]) add(i + 1, j, i + 1, j + 1);
    if (!filled[i]?.[j + 1]) add(i + 1, j + 1, i, j + 1);
    if (!filled[i - 1]?.[j]) add(i, j + 1, i, j);
  }
  const contours = [];
  while (edges.size) {
    const first = edges.keys().next().value;
    let at = first;
    const points = [];
    do {
      const [i, j] = at.split(':').map(Number);
      points.push(new T.Vector2(xs[i] / 100, -zs[j] / 100));
      const list = edges.get(at), next = list.pop();
      if (!list.length) edges.delete(at);
      at = key(...next);
    } while (at !== first);
    contours.push(points);
  }
  const outers = contours.filter(p => T.ShapeUtils.isClockWise(p));
  const holes = contours.filter(p => !T.ShapeUtils.isClockWise(p));
  const contains = (points, p) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  };
  const trace = (path, points) => {
    // Remove collinear grid vertices before rounding; every join is part of a
    // single outline, rather than overlapping individually rounded blocks.
    const corners = points.filter((p, i) => {
      const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
      return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-14;
    });
    corners.forEach((p, i) => {
      const a = corners[(i + corners.length - 1) % corners.length], b = corners[(i + 1) % corners.length];
      const r = Math.min(fillet, p.distanceTo(a) * 0.5, p.distanceTo(b) * 0.5);
      const before = p.clone().lerp(a, r / p.distanceTo(a));
      const after = p.clone().lerp(b, r / p.distanceTo(b));
      if (i === 0) path.moveTo(before.x, before.y);
      else path.lineTo(before.x, before.y);
      if (r > 1e-8) {
        const center = before.clone().add(after).sub(p);
        const turn = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
        path.absarc(center.x, center.y, r,
          Math.atan2(before.y - center.y, before.x - center.x),
          Math.atan2(after.y - center.y, after.x - center.x), turn < 0);
      } else path.lineTo(p.x, p.y);
    });
    path.closePath();
    return path;
  };
  const shapes = outers.map(points => {
    const shape = trace(new T.Shape(), points);
    for (const hole of holes) if (contains(points, hole[0])) shape.holes.push(trace(new T.Path(), hole));
    return shape;
  });
  if (outlineOnly) return shapes;
  const geometry = new T.ExtrudeGeometry(shapes, {
    depth: height - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 5, curveSegments: fillet ? 8 : 1, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  if (bevel) geometry.userData.rimContours = shapes.flatMap(shape =>
    [shape, ...shape.holes].map(path => path.getPoints(8).map(p => [p.x, -p.y])));
  return geometry;
}

export function ribMaterials() {
  return new T.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 1, ior: 1.52,
    thickness: 0.8, roughness: 0, metalness: 0,
    opacity: 1, transparent: false, depthWrite: false,
    clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 3.5,
  });
}

// Morph a united capsule footprint through a fully rounded vertical profile.
// The shoulder radius is half the physical thickness, not an attached tube.
export function moldedRibGeometry(rectangles, height = 1, thickness = 0.16) {
  const half = thickness / 2;
  const outline = width => solidGeometry(rectangles.map(r => {
    const inset = (half - width) * 100;
    return [r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset];
  }), height, { fillet: width, outlineOnly: true }).flatMap(shape => [shape, ...shape.holes]);
  return roundedVolume(outline, height, thickness, { rectangles });
}

export function moldedCurveGeometry(rotation = 0, height = 1, thickness = 0.16) {
  const outline = width => {
    const shape = new T.Shape();
    shape.absarc(0, 0, 0.38 + width, 0, -Math.PI / 2, true);
    shape.absarc(0, -0.38, width, -Math.PI / 2, Math.PI / 2, true);
    shape.absarc(0, 0, 0.38 - width, -Math.PI / 2, 0, false);
    shape.absarc(0.38, 0, width, Math.PI, 0, true);
    shape.closePath();
    const points = shape.getPoints(24).map(p => p.rotateAround(new T.Vector2(), -rotation));
    return [new T.Shape(points)];
  };
  return roundedVolume(outline, height, thickness, { curveRotation: rotation });
}

function roundedVolume(outline, height, thickness, metadata) {
  const half = thickness / 2, radius = Math.min(half, height / 2);
  const full = outline(half);
  const sample = path => {
    const points = [];
    for (const curve of path.curves) {
      if (curve.getLength() < 1e-7) continue;
      const divisions = curve.type === 'LineCurve' ? 1 : 12;
      for (let i = 0; i < divisions; i++) points.push(curve.getPoint(i / divisions));
    }
    return points;
  };
  // Concentrate triangles on the domes, not along long straight wall faces.
  const counts = full.map(path => sample(path).length);
  const levels = [];
  for (let i = 0; i <= 10; i++) {
    const angle = i / 10 * Math.PI / 2;
    levels.push({ y: radius * (1 - Math.cos(angle)), width: half - radius + Math.max(1e-4, radius * Math.sin(angle)) });
  }
  for (let i = 0; i <= 10; i++) {
    const angle = i / 10 * Math.PI / 2;
    levels.push({ y: height - radius + radius * Math.sin(angle), width: half - radius + Math.max(1e-4, radius * Math.cos(angle)) });
  }
  const positions = [], indices = [], seams = [], rings = levels
    .filter((level, i) => !i || Math.abs(level.y - levels[i - 1].y) + Math.abs(level.width - levels[i - 1].width) > 1e-8)
    .map(level => ({ ...level, paths: outline(Math.min(half, level.width)) }));
  for (let contour = 0; contour < full.length; contour++) {
    const offset = positions.length / 3, count = counts[contour];
    seams.push({ offset, count, rings: rings.length });
    rings.forEach(ring => {
      const samples = sample(ring.paths[contour]);
      for (let i = 0; i <= count; i++) {
        const p = samples.length === count ? samples[i % count] : ring.paths[contour].getPoint(i / count);
        positions.push(p.x, ring.y, -p.y);
      }
    });
    for (let ring = 0; ring < rings.length - 1; ring++) for (let i = 0; i < count; i++) {
      const a = offset + ring * (count + 1) + i, b = a + count + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const contains = (points, p) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  };
  for (const [ring, reverse] of [[rings[0], true], [rings.at(-1), false]]) {
    const loops = ring.paths.map(path => sample(path));
    const holes = loops.filter(p => !T.ShapeUtils.isClockWise(p));
    const shapes = loops.filter(p => T.ShapeUtils.isClockWise(p)).map(points => {
      const shape = new T.Shape(points);
      for (const hole of holes) if (contains(points, hole[0])) shape.holes.push(new T.Path(hole));
      return shape;
    });
    const cap = new T.ShapeGeometry(shapes);
    const p = cap.attributes.position, offset = positions.length / 3;
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), ring.y, -p.getY(i));
    const order = cap.index?.array || Array.from({ length: p.count }, (_, i) => i);
    for (let i = 0; i < order.length; i += 3) {
      const a = offset + order[i], b = offset + order[i + 1], c = offset + order[i + 2];
      indices.push(a, reverse ? c : b, reverse ? b : c);
    }
    cap.dispose();
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (const seam of seams) for (let ring = 0; ring < seam.rings; ring++) {
    const a = seam.offset + ring * (seam.count + 1), b = a + seam.count;
    const n = new T.Vector3().fromBufferAttribute(normals, a)
      .add(new T.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z);
    normals.setXYZ(b, n.x, n.y, n.z);
  }
  geometry.userData.fullContours = full.map(path => path.getPoints(12).map(p => [p.x, -p.y]));
  Object.assign(geometry.userData, metadata);
  geometry.userData.thickness = thickness;
  geometry.userData.shoulderRadius = radius;
  return geometry;
}

export function ribCore(body) {
  const thickness = body.userData.thickness * 0.7;
  let geometry;
  if (body.userData.curveRotation !== undefined) {
    geometry = moldedCurveGeometry(body.userData.curveRotation, 0.03, thickness);
  } else {
    const inset = (body.userData.thickness - thickness) * 50;
    const rectangles = body.userData.rectangles.map(r => [r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset]);
    geometry = moldedRibGeometry(rectangles, 0.03, thickness);
  }
  body.computeBoundingBox();
  geometry.translate(0, body.boundingBox.max.y - 0.064, 0);
  geometry.userData.coreWidth = thickness;
  return { geometry, material: new T.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 0.82, opacity: 1, transparent: false,
    ior: 1.52, thickness: 0.08, roughness: 0.025, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 3.5, depthWrite: false,
  }) };
}

export function contactShadow(body) {
  body.computeBoundingBox();
  const box = body.boundingBox, pad = 0.055;
  const width = box.max.x - box.min.x + pad * 2, depth = box.max.z - box.min.z + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.ceil(width * 128));
  canvas.height = Math.max(64, Math.ceil(depth * 128));
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / width, sz = canvas.height / depth;
  ctx.beginPath();
  for (const points of body.userData.fullContours || []) {
    points.forEach((p, i) => {
      const x = (p[0] - box.min.x + pad) * sx, z = (p[1] - box.min.z + pad) * sz;
      if (!i) ctx.moveTo(x, z); else ctx.lineTo(x, z);
    });
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6;
  ctx.fill('evenodd');
  const texture = new T.CanvasTexture(canvas);
  const geometry = new T.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((box.min.x + box.max.x) / 2, 0.003, (box.min.z + box.max.z) / 2);
  return { geometry, material: new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }) };
}

export function studioEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) ctx.fillRect(100 + i * 224, 100, 64, 824);
  const texture = new T.CanvasTexture(canvas);
  texture.encoding = T.sRGBEncoding;
  const room = new T.Scene();
  room.background = new T.Color(0x000000);
  const lights = new T.Mesh(new T.PlaneGeometry(16, 16), new T.MeshBasicMaterial({
    map: texture, color: new T.Color(20, 20, 20), side: T.DoubleSide, toneMapped: false,
  }));
  lights.position.set(0, 5, 0);
  lights.rotation.x = Math.PI / 2;
  room.add(lights);
  const generator = new T.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0.008, 0.1, 40);
  target.texture.userData.whiteBands = 4;
  generator.dispose();
  lights.geometry.dispose();
  lights.material.dispose();
  texture.dispose();
  return target;
}

export function spaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 1056;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#030713';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 71523;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const x = 130 + random() * 500, y = random() * 1056, r = 70 + random() * 240;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, i % 3 ? 'rgba(53,63,151,0.10)' : 'rgba(126,47,139,0.12)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 350; i++) {
    const x = random() * 768, y = random() * 1056, r = 0.25 + random() * 1.1;
    ctx.fillStyle = `rgba(208,225,255,${0.2 + random() * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (i % 90 === 0) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
      glow.addColorStop(0, 'rgba(170,208,255,0.5)');
      glow.addColorStop(1, 'rgba(170,208,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
  }
  // Printed dark toy board: continuous lines supply clear refraction cues.
  for (let x = 0; x < 8; x++) for (let z = 0; z < 11; z++) {
    if ((x + z) % 2 === 0) {
      ctx.fillStyle = 'rgba(62,112,142,0.07)';
      ctx.fillRect(x * 96, z * 96, 96, 96);
    }
  }
  for (let step of [24, 96]) {
    ctx.strokeStyle = step === 96 ? 'rgba(121,195,218,0.58)' : 'rgba(95,156,184,0.13)';
    ctx.lineWidth = step === 96 ? 2.2 : 0.8;
    ctx.beginPath();
    for (let x = 0; x <= 768; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, 1056); }
    for (let y = 0; y <= 1056; y += step) { ctx.moveTo(0, y); ctx.lineTo(768, y); }
    ctx.stroke();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.encoding = T.sRGBEncoding;
  return texture;
}

export function lidReflectionMaterial() {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { tilt: { value: new T.Vector2() } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform vec2 tilt;
      void main() {
        vec2 p = vUv - vec2(0.5) - tilt * 0.95;
        float slope = 0.35 + tilt.y * 0.3;
        float band = exp(-pow((p.x + p.y * slope - 0.30) / 0.085, 2.0));
        float second = exp(-pow((p.x + p.y * slope + 0.40) / 0.025, 2.0));
        float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(0.0, 0.14, 1.0-vUv.y);
        gl_FragColor = vec4(0.84, 0.93, 1.0, (band * 0.10 + second * 0.035) * edge);
      }`,
  });
}
