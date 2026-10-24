const T = window.THREE;

// Union axis-aligned footprints before extrusion: no cell seams or internal
// transparent faces, including at wall junctions and adjacent floor holes.
export function solidGeometry(rectangles, height, { bevel = 0, fillet = 0, bevelOffset = 0, bevelSegments = 5, cornerFillet = fillet, outlineSegments = 8 } = {}) {
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
      const isEndCap = shortEdge <= fillet * 2 + 1e-6;
      // Force the radius from the actual cross-wall diameter, independently of
      // cornerRadius. The two quarter-arcs meet as one complete semicircle.
      const radius = isEndCap ? shortEdge * 0.5 : cornerFillet;
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
    const outline = path.getPoints(fillet ? outlineSegments : 1).filter((p, i, all) =>
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
  lightAngle: 0.78, specularSharpness: 8, resinTint: 0.2,
  topFusion: 0.4, wallThickness: 1, bottomFusion: 0.4, resinDensity: 0.5,
});

// The off-axis camera always looks straight down (Game.updateCamera), so
// camera-space depth depends only on height, even while the board appears tilted.
// Transparent meshes are sorted as objects by Three.js, not as triangles.
// Draw their far/lower faces first, leaving the near roof/bevel/weld edges last.
// This changes only the index order: positions, normals and collision faces stay intact.
export function orderWallFacesByHeight(geometry) {
  const positions = geometry.attributes.position;
  const triangles = Array.from({ length: positions.count / 3 }, (_, i) => i);
  const height = triangles.map(i => positions.getY(i * 3) + positions.getY(i * 3 + 1) + positions.getY(i * 3 + 2));
  triangles.sort((a, b) => height[a] - height[b] || a - b);
  const order = [];
  for (const triangle of triangles) order.push(triangle * 3, triangle * 3 + 1, triangle * 3 + 2);
  geometry.setIndex(order);
  geometry.userData.wallTriangleOrder = 'bottom-to-top';
  return geometry;
}

// A single united extrusion preserves the rounded outline at all junctions.
export function wallGeometry(rectangles, settings = WALL_DEFAULTS) {
  const thickness = settings.wallThickness ?? 1;
  const bevel = (0.002 + settings.cornerRadius * 0.004) * thickness;
  // Expand the segment footprints before union: centerlines and U-cap centers
  // stay fixed, and thick L/T/cross junctions still have no overlapping faces.
  const offset = (thickness - 1) * 3.8;
  const expanded = rectangles.map(([x0, z0, x1, z1]) => [x0 - offset, z0 - offset, x1 + offset, z1 + offset]);
  const geometry = solidGeometry(expanded, 1, {
    bevel, bevelOffset: -bevel, bevelSegments: 5, fillet: 0.038 * thickness,
    cornerFillet: settings.cornerRadius * 0.076 * thickness, outlineSegments: 16,
  });
  geometry.userData.wallThickness = thickness;
  return setRibFaces(orderWallFacesByHeight(geometry));
}

export function curvedWallGeometry(rotation, settings = WALL_DEFAULTS) {
  const thickness = settings.wallThickness ?? 1, radius = 0.038 * thickness;
  const shape = new T.Shape(), bevel = (0.002 + settings.cornerRadius * 0.004) * thickness;
  shape.absarc(0, 0, 0.38 + radius, 0, -Math.PI / 2, true);
  shape.absarc(0, -0.38, radius, -Math.PI / 2, Math.PI / 2, true);
  shape.absarc(0, 0, 0.38 - radius, -Math.PI / 2, 0, false);
  shape.absarc(0.38, 0, radius, Math.PI, 0, true);
  shape.closePath();
  const points = shape.getPoints(24).filter((point, i, all) =>
    !i || point.distanceTo(all[i - 1]) > 1e-7);
  if (points[0].distanceTo(points.at(-1)) < 1e-7) points.pop();
  const cleanShape = new T.Shape(points);
  cleanShape.closePath();
  const geometry = new T.ExtrudeGeometry(cleanShape, {
    depth: 1 - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 5, curveSegments: 24,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(-rotation * Math.PI / 2);
  geometry.translate(0, bevel, 0);
  smoothMoldedNormals(geometry);
  geometry.userData.wallThickness = thickness;
  return setRibFaces(orderWallFacesByHeight(geometry));
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
    rgba[i * 4] = Math.min(255, Math.round(distance[i] * worldPixel / 0.12 * 255));
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
  for (const key of Object.keys(WALL_DEFAULTS)) {
    const uniform = material.userData.wallUniforms[key];
    uniform.value = settings[key];
    uniform.needsUpdate = true;
    // Keep every compiled light/layer variant attached to the same live values.
    for (const shader of material.userData.wallShaders) shader.uniforms[key] = uniform;
  }
}

export function ribMaterials(settings = WALL_DEFAULTS, geometry = null) {
  const material = new T.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    transmission: 0, roughness: 0.06, metalness: 0, ior: 1.5,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 3,
  });
  const uniforms = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, { value }]));
  material.userData.wallUniforms = uniforms;
  material.userData.wallShaders = new Set();
  // Store the distance field as a material texture so the existing disposal
  // lifecycle releases it on retries and stage changes.
  material.alphaMap = geometry ? prepareClearWall(geometry) : null;
  material.userData.wallDistance = { value: material.alphaMap };
  material.userData.wallShapeThickness = { value: geometry?.userData.wallThickness ?? settings.wallThickness };
  material.userData.wallContact = { value: 1 };
  material.userData.wallDiagnosticMode = { value: 0 };
  material.userData.wallBottomContact = { value: 1 };
  material.userData.wallBackground = { value: null };
  material.userData.wallResolution = { value: new T.Vector2(1, 1) };
  material.userData.wallTexel = { value: new T.Vector2(
    1 / (material.alphaMap?.image.width || 1), 1 / (material.alphaMap?.image.height || 1)) };
  material.onBeforeCompile = shader => {
    material.userData.wallShaders.add(shader);
    for (const key of Object.keys(WALL_DEFAULTS)) shader.uniforms[key] = uniforms[key];
    shader.uniforms.wallDistance = material.userData.wallDistance;
    shader.uniforms.wallTexel = material.userData.wallTexel;
    shader.uniforms.wallShapeThickness = material.userData.wallShapeThickness;
    shader.uniforms.wallContact = material.userData.wallContact;
    shader.uniforms.wallDiagnosticMode = material.userData.wallDiagnosticMode;
    for (const key of ['wallBottomContact', 'wallBackground', 'wallResolution']) shader.uniforms[key] = material.userData[key];
    shader.vertexShader = `attribute vec2 wallPlanar; attribute vec2 wallOutward; attribute float wallHeight;
      uniform float taperAngle; uniform float wallThickness; uniform float wallShapeThickness; varying vec2 wallUV; varying vec2 wallDir; varying float wallY; varying float wallSide;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      objectNormal.y += length(objectNormal.xz) * taperAngle * 0.0038 * wallThickness;
      objectNormal = normalize(objectNormal);
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      // Immediate geometric preview while the united extrusion is rebuilt.
      transformed.xz += wallOutward * (wallThickness - wallShapeThickness) * 0.038;
      transformed.xz -= wallOutward * taperAngle * 0.0038 * wallThickness * wallHeight;
      wallUV = wallPlanar; wallY = wallHeight; wallDir = wallOutward;
      wallSide = 1.0 - abs(normal.y);
    `);
    shader.fragmentShader = `precision highp sampler2D; precision highp samplerCube;
      uniform highp sampler2D wallDistance; uniform vec2 wallTexel;
      uniform highp sampler2D wallBackground; uniform vec2 wallResolution;
      uniform float wallDiagnosticMode;
      bool wallValidRadiance(vec3 v) {
        return all(greaterThanEqual(v, vec3(0.0))) && all(lessThanEqual(v, vec3(65504.0)));
      }
      float wallSafeChannel(float v) { return v >= 0.0 && v <= 65504.0 ? v : 0.0; }
      vec3 wallSafeRadiance(vec3 v) { return vec3(wallSafeChannel(v.r), wallSafeChannel(v.g), wallSafeChannel(v.b)); }
      vec3 wallBackgroundColor(vec2 uv, inout bool invalid) {
        vec3 radiance = texture2D(wallBackground, uv).rgb;
        invalid = invalid || !wallValidRadiance(radiance);
        radiance = wallSafeRadiance(radiance);
        #if defined(TONE_MAPPING)
          radiance = toneMapping(radiance);
        #endif
        return linearToOutputTexel(vec4(radiance, 1.0)).rgb;
      }
      uniform float bottomFusion; uniform float resinDensity; uniform float wallBottomContact;
      uniform float lightAngle; uniform float specularSharpness; uniform float resinTint; uniform float cornerRadius;
      uniform float topFusion; uniform float wallThickness; uniform float wallShapeThickness; uniform float wallContact;
      uniform float edgeWidth; uniform float edgeBrightness; uniform float sideGloss; uniform float bottomEdge; uniform float centerOpacity;
      varying vec2 wallUV; varying vec2 wallDir; varying float wallY; varying float wallSide;\n` + shader.fragmentShader;
    // Alpha is determined by reflection coverage, never by diffuse illumination.
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', '');
    shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>', `
      float distanceToEdge = texture2D(wallDistance, wallUV).r * 0.12;
      vec2 gradient = vec2(
        texture2D(wallDistance, wallUV - vec2(wallTexel.x, 0.0)).r - texture2D(wallDistance, wallUV + vec2(wallTexel.x, 0.0)).r,
        texture2D(wallDistance, wallUV - vec2(0.0, wallTexel.y)).r - texture2D(wallDistance, wallUV + vec2(0.0, wallTexel.y)).r);
      vec2 outward = length(gradient) > 0.0001 ? normalize(gradient) : normalize(wallDir + vec2(0.00001));
      vec2 lightDirection = vec2(-cos(lightAngle), -sin(lightAngle));
      float facing = clamp(0.5 + 0.5 * dot(outward, lightDirection), 0.0, 1.0);
      // Broad reflected volume remains visible even on the shaded rail.
      // The directional lobe adds a glint instead of erasing the whole band.
      float glint = pow(facing, specularSharpness * 0.75);
      float directionalGain = 0.55 + 0.3 * facing + 0.85 * glint;
      float aa = max(fwidth(distanceToEdge), 0.0006);
      // Each band occupies this fraction of the top face; the backlit edge
      // fades more softly while the lit edge follows the sharpness control.
      float width = edgeWidth * 0.068 * wallShapeThickness;
      float softness = mix(0.35, 0.06, (specularSharpness - 1.0) / 19.0);
      float feather = width * mix(0.38, softness, facing);
      float edge = (1.0 - smoothstep(width - feather - aa, width + aa, distanceToEdge))
        * smoothstep(0.97, 0.998, wallY) * step(0.001, edgeWidth);
      float fresnel = pow(1.0 - clamp(abs(dot(normal, geometry.viewDir)), 0.0, 1.0), 3.0);
      float reach = mix(0.22, 0.95, clamp(sideGloss / 3.0, 0.0, 1.0));
      float verticalGloss = smoothstep(1.0 - reach, 1.0, wallY);
      float glare = clamp(sideGloss * wallSide * verticalGloss * pow(wallThickness, 0.35) * (0.12 + 0.3 * fresnel) * (0.3 + 0.7 * facing), 0.0, 0.9);
      float rootBand = wallSide * (1.0 - smoothstep(0.002, 0.015 + bottomEdge * 0.025, wallY));
      float rootAlpha = rootBand * bottomEdge * (0.45 + 0.55 * facing);
      float crown = pow(clamp(1.0 - distanceToEdge / max(width, 0.0001), 0.0, 1.0), mix(0.85, 0.35, cornerRadius));
      float bandVolume = edge * (0.88 + 0.12 * crown);
      float edgeAlpha = bandVolume * (1.0 - exp(-edgeBrightness * directionalGain * (0.65 + 0.2 * fresnel)));
      // Density controls only the transmitted background diffusion.
      float density = 1.0 - exp(-resinDensity * wallThickness * (0.8 + 0.6 * wallSide));
      float bodyAlpha = centerOpacity;
      float fusionWidth = max(width * 1.3, 0.012 * wallShapeThickness);
      float fusionBand = (1.0 - smoothstep(fusionWidth * 0.6, fusionWidth + aa, distanceToEdge))
        * smoothstep(0.95, 0.998, wallY);
      float fusionAlpha = clamp(topFusion * wallContact * fusionBand * (0.2 + 0.55 * facing), 0.0, 0.9);
      float bottomBand = wallSide * (1.0 - smoothstep(0.008, 0.065 + bottomFusion * 0.035, wallY));
      float bottomAlpha = clamp(bottomFusion * wallBottomContact * bottomBand * (0.3 + 0.55 * facing), 0.0, 0.9);
      float reflectionCoverage = 1.0 - (1.0 - glare) * (1.0 - edgeAlpha) * (1.0 - rootAlpha) * (1.0 - fusionAlpha) * (1.0 - bottomAlpha);
      float coverage = bodyAlpha + (1.0 - bodyAlpha) * reflectionCoverage;
      vec3 surfaceReflection = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      bool wallBadReflection = !wallValidRadiance(surfaceReflection);
      surfaceReflection = wallSafeRadiance(surfaceReflection);
      vec3 resinColor = mix(vec3(1.0), vec3(0.6, 0.91, 1.0), resinTint);
      vec3 reflectionColor = mix(vec3(1.0), resinColor, 0.25);
      outgoingLight = (resinColor * bodyAlpha * (1.0 - reflectionCoverage) + reflectionColor * reflectionCoverage) / max(coverage, 0.00001)
        + vec3(bandVolume * edgeBrightness * (0.12 + 0.18 * glint)) + surfaceReflection * sideGloss
        + fusionAlpha * (vec3(0.18 + 0.42 * glint) + surfaceReflection * 0.5);
      // Average display-space samples: HDR averaging would brighten fine detail.
      vec2 screenUV = gl_FragCoord.xy / wallResolution;
      float radius = resinDensity * (2.0 + 8.0 * resinDensity) * sqrt(wallThickness);
      vec2 spread = vec2(radius) / wallResolution;
      vec3 blurred = vec3(0.0);
      bool wallBackgroundInvalid = false;
      // A disabled density must never read an old/uninitialized HDR texture:
      // multiplying its result by zero would still propagate NaN on the GPU.
      if (resinDensity > 0.0) {
      blurred = wallBackgroundColor(screenUV, wallBackgroundInvalid) * 0.25;
      blurred += (wallBackgroundColor(screenUV + vec2(spread.x, 0.0), wallBackgroundInvalid)
        + wallBackgroundColor(screenUV - vec2(spread.x, 0.0), wallBackgroundInvalid)
        + wallBackgroundColor(screenUV + vec2(0.0, spread.y), wallBackgroundInvalid)
        + wallBackgroundColor(screenUV - vec2(0.0, spread.y), wallBackgroundInvalid)) * 0.125;
      blurred += (wallBackgroundColor(screenUV + spread, wallBackgroundInvalid)
        + wallBackgroundColor(screenUV - spread, wallBackgroundInvalid)
        + wallBackgroundColor(screenUV + spread * vec2(1.0, -1.0), wallBackgroundInvalid)
        + wallBackgroundColor(screenUV + spread * vec2(-1.0, 1.0), wallBackgroundInvalid)) * 0.0625;
      }
      bool wallBadBackground = wallBackgroundInvalid || !wallValidRadiance(blurred);
      float scattering = wallBadBackground ? 0.0 : density * 0.75;
      blurred = wallSafeRadiance(blurred);
      float finalCoverage = coverage + (1.0 - coverage) * scattering;
      outgoingLight += bottomAlpha * vec3(0.2 + 0.35 * glint);
      diffuseColor.a = coverage;
      #include <output_fragment>
    `);
    // The canvas blends in output color space. Transform the background and
    // reflected/body colors independently before compositing; otherwise tone
    // mapping a pre-mixed HDR color makes density brighten the wall again.
    shader.fragmentShader = shader.fragmentShader.replace('#include <encodings_fragment>', `
      #include <encodings_fragment>
      gl_FragColor.rgb = (gl_FragColor.rgb * coverage + blurred * scattering * (1.0 - coverage)) / max(finalCoverage, 0.00001);
      gl_FragColor.a = finalCoverage;
    `);
    // Diagnostic colors are written after tone mapping, with other surfaces
    // hidden in an offscreen pass. Green marks a wall; red/blue mark bad math.
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
      #include <dithering_fragment>
      if (wallDiagnosticMode > 0.5)
        gl_FragColor = vec4(wallBadReflection ? 1.0 : 0.0, 1.0, wallBadBackground ? 1.0 : 0.0, 1.0);
    `);
  };
  material.customProgramCacheKey = () => 'clear-molded-wall-v8';
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
