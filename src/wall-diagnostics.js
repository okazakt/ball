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
  };
}
