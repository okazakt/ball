import { solidGeometry } from './case-visuals.js';
const T = window.THREE;
export const FRAME_CONTROLS = [
  ['frameBevel', '角の丸み・エッジの太さ', 0, 1, .96],
  ['frameEdgeHighlight', '角ハイライトの輝度', 0, 5, 4.12],
  ['frameGloss', '表面のツヤ・光沢の鋭さ', 1, 30, 2.20],
  ['frameSSS', '樹脂の柔らかさ・光の回り込み', 0, 1, .79],
  ['frameCornerRadius', '四隅コーナーの内R・一体感', 0, 1, .92],
  ['frameAO', '内側の影の濃さ・立体感', 0, 1, .93],
];
export const FRAME_DEFAULTS = Object.freeze(Object.fromEntries(FRAME_CONTROLS.map(([key,,,, value]) => [key, value])));

export function frameGeometry(rects, height, settings, door = false) {
  const bevel = settings.frameBevel * (door ? .035 : .044);
  const radius = settings.frameCornerRadius * (door ? .045 : .18);
  const g = solidGeometry(rects, height, { bevel, bevelOffset: -bevel,
    fillet: radius, cornerFillet: radius, bevelSegments: 10, outlineSegments: 16 });
  // Angle weighting makes the normal independent of cap triangulation. An
  // unweighted average creates diagonal lighting seams on mitered corners.
  const p = g.attributes.position, n = g.attributes.normal, sums = new Map(), keys = [];
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    const face = new T.Vector3().subVectors(b.fromBufferAttribute(p, i + 1), a.fromBufferAttribute(p, i))
      .cross(c.fromBufferAttribute(p, i + 2).sub(a)).normalize();
    for (let j = 0; j < 3; j++) {
      a.fromBufferAttribute(p, i + j);
      b.fromBufferAttribute(p, i + (j + 1) % 3).sub(a).normalize();
      c.fromBufferAttribute(p, i + (j + 2) % 3).sub(a).normalize();
      const key = [a.x,a.y,a.z].map(v => Math.round(v * 1e6)).join(':');
      keys[i + j] = key;
      if (!sums.has(key)) sums.set(key, new T.Vector3());
      sums.get(key).addScaledVector(face, Math.acos(Math.max(-1, Math.min(1, b.dot(c)))));
    }
  }
  for (const sum of sums.values()) sum.normalize();
  keys.forEach((key, i) => { const v = sums.get(key); n.setXYZ(i, v.x, v.y, v.z); });
  if (door) g.translate(0, -height / 2, 0);
  return g;
}

export function prepareFramePlastic(material, settings, height, bottom = 0) {
  const uniforms = Object.fromEntries(Object.keys(FRAME_DEFAULTS).map(key => [key, { value: settings[key] }]));
  uniforms.frameHeight = { value: height }; uniforms.frameBottom = { value: bottom };
  material.userData.frameUniforms = uniforms;
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vPlasticLocal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlasticLocal = position;');
    shader.fragmentShader = `varying vec3 vPlasticLocal;
      uniform float frameBevel, frameEdgeHighlight, frameGloss, frameSSS, frameCornerRadius, frameAO, frameHeight, frameBottom;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>', `
      vec3 plasticNormal = inverseTransformDirection(normal, viewMatrix);
      float roundedEdge = 4.0 * abs(plasticNormal.y) * (1.0 - abs(plasticNormal.y));
      vec3 plasticView = normalize(vViewPosition);
      float grazing = pow(1.0 - max(dot(normal, plasticView), 0.0), 3.0);
      float softLight = clamp(dot(outgoingLight, vec3(.2126,.7152,.0722)), 0.0, 1.0);
      outgoingLight += diffuseColor.rgb * frameSSS * (.10 + .18 * grazing) * softLight;
      outgoingLight += vec3(1.0,.98,.92) * frameEdgeHighlight * roundedEdge
        * (.08 + .12 * grazing) * softLight;
      float foot = 1.0 - smoothstep(0.0, .22, vPlasticLocal.y - frameBottom);
      float rim = smoothstep(.8, 1.0, abs(plasticNormal.y));
      float corner = 4.0 * abs(plasticNormal.x * plasticNormal.z);
      outgoingLight *= 1.0 - frameAO * (.38 * foot + .10 * (1.0-rim) + .12 * corner);
      #include <output_fragment>
    `);
  };
  material.customProgramCacheKey = () => previousKey + '-molded-abs-v1';
  applyFrameSettings(material, settings);
  return material;
}
export function applyFrameSettings(material, settings) {
  const u = material.userData.frameUniforms;
  for (const key of Object.keys(FRAME_DEFAULTS)) u[key].value = settings[key];
  material.roughness = Math.sqrt(2 / (settings.frameGloss * 8 + 2));
  material.clearcoatRoughness = material.roughness * .65;
  material.clearcoat = Math.min(1, .3 + settings.frameEdgeHighlight * .14);
}
