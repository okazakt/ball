import { WALL_SETTINGS_KEY } from './wall-settings.js';

// Read the uniforms immediately AFTER each wall draw. Programs are shared, so
// reading all materials later would mistakenly report the last wall's values.
export function inspectDraw(renderer, mesh) {
  const gl = renderer.getContext();
  const program = renderer.properties.get(mesh.material).currentProgram?.program;
  const values = {};
  for (const key of Object.keys(mesh.material.userData.wallUniforms)) {
    const location = program ? gl.getUniformLocation(program, key) : null;
    values[key] = location === null ? null : gl.getUniform(program, location);
  }
  const sources = program ? (gl.getAttachedShaders(program) || []).map(shader => gl.getShaderSource(shader) || '') : [];
  const source = sources.join('\n');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return {
    floor: mesh.userData.wallFloor + 1,
    surface: mesh.userData.surface || 'door',
    linked: !!program && gl.getProgramParameter(program, gl.LINK_STATUS),
    shader: mesh.material.customProgramCacheKey(),
    sourceHash: (hash >>> 0).toString(16),
    hasDensityCode: source.includes('float density ='),
    hasOpacityCode: source.includes('float bodyAlpha ='),
    gpuValues: values,
  };
}

// A separate unsigned-byte target reads the shader's validity flags, without
// changing the displayed frame, user settings, or the scene's shadow maps.
function probeWallPixels(game) {
  const T = window.THREE, renderer = game.renderer;
  const size = renderer.getDrawingBufferSize(new T.Vector2());
  const target = new T.WebGLRenderTarget(size.x, size.y);
  const previousTarget = renderer.getRenderTarget(), cameraMask = game.camera.layers.mask;
  const shadowUpdate = renderer.shadowMap.autoUpdate, hidden = [];
  game.scene.traverse(mesh => {
    if ((mesh.isMesh || mesh.isSprite) && mesh.visible && !game.wallMaterials.has(mesh.material)) {
      hidden.push(mesh); mesh.visible = false;
    }
  });
  const pixels = new Uint8Array(size.x * size.y * 4);
  try {
    for (const material of game.wallMaterials) material.userData.wallDiagnosticMode.value = 1;
    renderer.shadowMap.autoUpdate = false;
    game.camera.layers.set(game.viewFloor + 1);
    renderer.setRenderTarget(target); renderer.clear();
    renderer.render(game.scene, game.camera);
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
  } finally {
    for (const material of game.wallMaterials) material.userData.wallDiagnosticMode.value = 0;
    hidden.forEach(mesh => { mesh.visible = true; });
    game.camera.layers.mask = cameraMask;
    renderer.shadowMap.autoUpdate = shadowUpdate;
    renderer.setRenderTarget(previousTarget); target.dispose();
  }
  let sampledWallPixels = 0, reflectionInvalidPixels = 0, backgroundInvalidPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 250 && pixels[i + 3] > 250) {
    sampledWallPixels++;
    if (pixels[i] > 250) reflectionInvalidPixels++;
    if (pixels[i + 2] > 250) backgroundInvalidPixels++;
  }
  return { floor: game.viewFloor + 1, sampledWallPixels, reflectionInvalidPixels, backgroundInvalidPixels };
}

export function wallDiagnostics(game, version) {
  const draws = [];
  game.wallDiagnosticCapture = draws;
  try { game.renderScene(); } finally { game.wallDiagnosticCapture = null; }
  const gl = game.renderer.getContext();
  let saved;
  try { saved = JSON.parse(localStorage.getItem(WALL_SETTINGS_KEY)); } catch { saved = 'unavailable'; }
  return {
    version,
    webgl: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    contextLost: gl.isContextLost(),
    framebuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    tilt: { ...game.tilt },
    settings: { ...game.wallSettings },
    saved,
    draws,
    pixelProbe: probeWallPixels(game),
  };
}
