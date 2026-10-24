const T = window.THREE;

// Union axis-aligned footprints before extrusion: no cell seams or internal
// transparent faces, including at wall junctions and adjacent floor holes.
export function solidGeometry(rectangles, height, { bevel = 0, fillet = 0, bevelOffset = 0, bevelSegments = 5, cornerFillet = fillet } = {}) {
  // All editor coordinates are decimal grid units. Canonicalize BEFORE union:
  // e.g. -100 + 103.8 and 0 + 3.8 must identify the same boundary.
  // Microscopic cells otherwise become concave spikes after bevel offsets.
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
      return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9;
    });
    corners.forEach((p, i) => {
      const a = corners[(i + corners.length - 1) % corners.length], b = corners[(i + 1) % corners.length];
      const shortEdge = Math.min(p.distanceTo(a), p.distanceTo(b));
      // Short cross-walls form U caps; keep those semicircular at every setting.
      const radius = shortEdge <= fillet * 2 + 1e-6 ? fillet : cornerFillet;
      const r = Math.min(radius, p.distanceTo(a) * 0.5, p.distanceTo(b) * 0.5);
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
    // At capsule ends the two quarter circles meet. Floating-point error can
    // leave almost identical vertices there (depending on the world position).
    // ExtrudeGeometry treats those as tiny edges and produces broken bevels
    // and zero-area faces. Use the same cleaned outline for extrusion and rims.
    const outline = path.getPoints(fillet ? 8 : 1).filter((p, i, all) =>
      !i || p.distanceTo(all[i - 1]) > 1e-7);
    if (outline.length > 1 && outline[0].distanceTo(outline.at(-1)) < 1e-7) outline.pop();
    const clean = path instanceof T.Shape ? new T.Shape() : new T.Path();
    outline.forEach((p, i) => i ? clean.lineTo(p.x, p.y) : clean.moveTo(p.x, p.y));
    clean.closePath();
    return clean;
  };
  const shapes = outers.map(points => {
    const shape = trace(new T.Shape(), points);
    for (const hole of holes) if (contains(points, hole[0])) shape.holes.push(trace(new T.Path(), hole));
    return shape;
  });
  const geometry = new T.ExtrudeGeometry(shapes, {
    depth: height - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelOffset, bevelSegments, curveSegments: fillet ? 8 : 1, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  if (bevel) smoothMoldedNormals(geometry);
  return geometry;
}

// Extrusion duplicates vertices at cap/bevel seams. Share their normals so the
// fillet reflects a continuous light strip instead of separate white facets.
export function smoothMoldedNormals(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const sums = new Map(), keys = [];
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join(':');
    keys.push(key);
    const normal = sums.get(key) || new T.Vector3();
    normal.add(new T.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
    sums.set(key, normal);
  }
  for (const normal of sums.values()) normal.normalize();
  for (let i = 0; i < p.count; i++) {
    const normal = sums.get(keys[i]);
    n.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return geometry;
}

// Straight footprint helper retained for geometry and junction diagnostics.
export function ribGeometry(rectangles, height = 1) {
  return setRibFaces(solidGeometry(rectangles.map(r => r.map(v => Math.round(v * 1e6) / 1e6)), height));
}

export const WALL_DEFAULTS = Object.freeze({
  edgeWidth: 0.25, edgeBrightness: 3, sideGloss: 1.2, bottomEdge: 0.35,
  centerOpacity: 0.04, taperAngle: 0.35, cornerRadius: 0.5,
});

// A single united extrusion preserves the rounded outline at all junctions.
export function wallGeometry(rectangles, settings = WALL_DEFAULTS) {
  const bevel = 0.002 + settings.cornerRadius * 0.004;
  return setRibFaces(solidGeometry(rectangles, 1, {
    bevel, bevelOffset: -bevel, bevelSegments: 5, fillet: 0.038,
    cornerFillet: settings.cornerRadius * 0.076,
  }));
}

export function curvedWallGeometry(rotation, settings = WALL_DEFAULTS) {
  const shape = new T.Shape(), bevel = 0.002 + settings.cornerRadius * 0.004;
  shape.absarc(0, 0, 0.418, 0, -Math.PI / 2, true);
  shape.absarc(0, -0.38, 0.038, -Math.PI / 2, Math.PI / 2, true);
  shape.absarc(0, 0, 0.342, -Math.PI / 2, 0, false);
  shape.absarc(0.38, 0, 0.038, Math.PI, 0, true);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 1 - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 5, curveSegments: 24,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(-rotation * Math.PI / 2);
  geometry.translate(0, bevel, 0);
  smoothMoldedNormals(geometry);
  return setRibFaces(geometry);
}

// Bake distance to the OUTER boundary of the united top footprint. Internal
// triangulation edges never enter this field, so L/T/cross joins have no rails.
export function prepareClearWall(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const padding = 0.02, spanX = max.x - min.x + padding * 2, spanZ = max.z - min.z + padding * 2;
  const scale = 1536 / Math.max(spanX, spanZ, 1);
  const width = Math.max(32, Math.ceil(spanX * scale)), height = Math.max(32, Math.ceil(spanZ * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  const p = geometry.attributes.position, normals = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2), heights = new Float32Array(p.count);
  const px = x => (x - min.x + padding) / spanX * width;
  const pz = z => (z - min.z + padding) / spanZ * height;
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = px(p.getX(i)) / width; uv[i * 2 + 1] = pz(p.getZ(i)) / height;
    heights[i] = (p.getY(i) - min.y) / (max.y - min.y);
  }
  ctx.beginPath();
  for (let i = 0; i < p.count; i += 3) {
    if (![0, 1, 2].every(j => Math.abs(p.getY(i + j) - max.y) < 1e-5)) continue;
    ctx.moveTo(px(p.getX(i)), pz(p.getZ(i)));
    for (const j of [1, 2]) ctx.lineTo(px(p.getX(i + j)), pz(p.getZ(i + j)));
    ctx.closePath();
  }
  // One fill avoids antialiased cracks between neighboring cap triangles.
  ctx.fill();
  const mask = ctx.getImageData(0, 0, width, height).data;
  const distance = new Float32Array(width * height), diagonal = Math.SQRT2;
  for (let i = 0; i < distance.length; i++) distance[i] = mask[i * 4 + 3] > 127 ? 1e5 : 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    distance[i] = Math.min(distance[i], distance[i - 1] + 1, distance[i - width] + 1,
      distance[i - width - 1] + diagonal, distance[i - width + 1] + diagonal);
  }
  for (let y = height - 2; y > 0; y--) for (let x = width - 2; x > 0; x--) {
    const i = y * width + x;
    distance[i] = Math.min(distance[i], distance[i + 1] + 1, distance[i + width] + 1,
      distance[i + width + 1] + diagonal, distance[i + width - 1] + diagonal);
  }
  const rgba = new Uint8Array(width * height * 4), worldPixel = Math.min(spanX / width, spanZ / height);
  for (let i = 0; i < distance.length; i++) {
    rgba[i * 4] = Math.min(255, Math.round(distance[i] * worldPixel / 0.06 * 255));
    rgba[i * 4 + 3] = 255;
  }
  const outward = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = Math.max(1, Math.min(width - 2, Math.round(uv[i * 2] * width)));
    const y = Math.max(1, Math.min(height - 2, Math.round(uv[i * 2 + 1] * height)));
    const at = y * width + x;
    let nx = distance[at - 1] - distance[at + 1], nz = distance[at - width] - distance[at + width];
    if (Math.hypot(nx, nz) < 1e-5) { nx = normals.getX(i); nz = normals.getZ(i); }
    const length = Math.hypot(nx, nz) || 1;
    outward[i * 2] = nx / length; outward[i * 2 + 1] = nz / length;
  }
  geometry.setAttribute('wallPlanar', new T.BufferAttribute(uv, 2));
  geometry.setAttribute('wallHeight', new T.BufferAttribute(heights, 1));
  geometry.setAttribute('wallOutward', new T.BufferAttribute(outward, 2));
  const texture = new T.DataTexture(rgba, width, height, T.RGBAFormat);
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export function applyWallSettings(material, settings) {
  for (const key of Object.keys(WALL_DEFAULTS)) material.userData.wallUniforms[key].value = settings[key];
}

export function ribMaterials(settings = WALL_DEFAULTS, geometry = null) {
  const material = new T.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    transmission: 0, roughness: 0.06, metalness: 0, ior: 1.5,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 3,
  });
  const uniforms = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, { value }]));
  material.userData.wallUniforms = uniforms;
  // Store the distance field as a material texture so the existing disposal
  // lifecycle releases it on retries and stage changes.
  material.alphaMap = geometry ? prepareClearWall(geometry) : null;
  material.userData.wallDistance = { value: material.alphaMap };
  material.onBeforeCompile = shader => {
    for (const key of Object.keys(WALL_DEFAULTS)) shader.uniforms[key] = uniforms[key];
    shader.uniforms.wallDistance = material.userData.wallDistance;
    shader.vertexShader = `attribute vec2 wallPlanar; attribute vec2 wallOutward; attribute float wallHeight;
      uniform float taperAngle; varying vec2 wallUV; varying float wallY; varying float wallSide;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      objectNormal.y += length(objectNormal.xz) * taperAngle * 0.0038;
      objectNormal = normalize(objectNormal);
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      transformed.xz -= wallOutward * taperAngle * 0.0038 * wallHeight;
      wallUV = wallPlanar; wallY = wallHeight;
      wallSide = 1.0 - abs(normal.y);
    `);
    shader.fragmentShader = `uniform sampler2D wallDistance;
      uniform float edgeWidth; uniform float edgeBrightness; uniform float sideGloss; uniform float bottomEdge; uniform float centerOpacity;
      varying vec2 wallUV; varying float wallY; varying float wallSide;\n` + shader.fragmentShader;
    // Alpha is determined by reflection coverage, never by diffuse illumination.
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', '');
    shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>', `
      float distanceToEdge = texture2D(wallDistance, wallUV).r * 0.06;
      float aa = max(fwidth(distanceToEdge), 0.0006);
      // Each band occupies this fraction of the 0.068-wide top face.
      // This is a polygon coverage ratio, independent of WebGL line width.
      float width = edgeWidth * 0.068;
      float edge = (1.0 - smoothstep(width - aa, width + aa, distanceToEdge))
        * smoothstep(0.97, 0.998, wallY) * step(0.001, edgeWidth);
      float fresnel = pow(1.0 - clamp(abs(dot(normal, geometry.viewDir)), 0.0, 1.0), 3.0);
      float reach = mix(0.22, 0.95, clamp(sideGloss / 3.0, 0.0, 1.0));
      float verticalGloss = smoothstep(1.0 - reach, 1.0, wallY);
      float glare = clamp(sideGloss * wallSide * verticalGloss * (0.12 + 0.3 * fresnel), 0.0, 0.9);
      float rootBand = wallSide * (1.0 - smoothstep(0.002, 0.015 + bottomEdge * 0.025, wallY));
      float rootAlpha = rootBand * bottomEdge;
      float edgeAlpha = clamp(edge * edgeBrightness * (0.48 + 0.25 * fresnel), 0.0, 1.0);
      float coverage = 1.0 - (1.0 - centerOpacity) * (1.0 - glare) * (1.0 - edgeAlpha) * (1.0 - rootAlpha);
      vec3 surfaceReflection = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      outgoingLight = vec3(1.0 + edge * edgeBrightness * 0.15) + surfaceReflection * sideGloss;
      diffuseColor.a = coverage;
      #include <output_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'clear-molded-wall-v2';
  material.extensions = { derivatives: true };
  return material;
}

export function setRibFaces(geometry) {
  geometry.clearGroups();
  geometry.addGroup(0, geometry.attributes.position.count, 0);
  return geometry;
}

export function studioEnvironment(renderer) {
  const room = new T.Scene();
  room.background = new T.Color(0x030507);
  const panel = (w, h, x, y, z, brightness) => {
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ color: new T.Color(brightness, brightness, brightness), side: T.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  // Broad studio softboxes reflect across flat acrylic side faces.
  // Dark flags between them retain contrast in the transparent volume.
  panel(18, 18, 0, -5, 0, 0.01);
  panel(18, 12, 0, 1, -9, 0.025);
  panel(18, 12, 0, 1, 9, 0.025);
  panel(18, 12, -9, 1, 0, 0.035);
  panel(18, 12, 9, 1, 0, 0.035);
  panel(8, 8, 0, 6, 0, 0.35);
  panel(2.0, 8, -2.8, 5, 0, 2.8);
  panel(2.0, 8, 2.8, 5, 0, 2.8);
  panel(4.0, 7, -7, 1, 2, 2);
  panel(4.0, 7, 7, 1, -2, 2);
  const generator = new T.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0.02, 0.1, 40);
  generator.dispose();
  room.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
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
  for (let i = 0; i < 1100; i++) {
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
        vec2 p = vUv - vec2(0.5) - tilt * 0.55;
        float band = exp(-pow((p.x + p.y * 0.32 - 0.30) / 0.075, 2.0));
        float second = exp(-pow((p.x + p.y * 0.32 + 0.40) / 0.025, 2.0));
        float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(0.0, 0.14, 1.0-vUv.y);
        gl_FragColor = vec4(0.84, 0.93, 1.0, (band * 0.065 + second * 0.025) * edge);
      }`,
  });
}
