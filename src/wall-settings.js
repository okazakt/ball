// Intentionally independent of release/cache versions: updates retain user tuning.
export const WALL_SETTINGS_KEY = 'toukan.wall-settings';
export const FIXED_WALL_SETTINGS = Object.freeze({
  edgeWidth: .35, edgeBrightness: 3.82, sideGloss: 2.23, bottomEdge: .91,
  centerOpacity: .34, taperAngle: .4, cornerRadius: 1, lightAngle: 0,
  specularSharpness: 10.58, resinTint: .81, topFusion: .51,
  wallThickness: 2, bottomFusion: .89, resinDensity: .25,
});
const limits = {
  edgeWidth: [.05, .5], edgeBrightness: [0, 5], sideGloss: [0, 3],
  bottomEdge: [0, 1], centerOpacity: [0, .5], taperAngle: [0, .8],
  cornerRadius: [0, 1], lightAngle: [0, 3.14], specularSharpness: [1, 20],
  resinTint: [0, 1], topFusion: [0, 1], wallThickness: [.5, 2],
  bottomFusion: [0, 1], resinDensity: [0, 1],
};
export function loadWallSettings(defaults, storage) {
  const settings = { ...defaults };
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(WALL_SETTINGS_KEY));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return settings;
    for (const key of Object.keys(defaults)) {
      if (typeof saved[key] !== 'number' || !Number.isFinite(saved[key])) continue;
      const [min, max] = limits[key] ?? [-Infinity, Infinity];
      settings[key] = Math.min(max, Math.max(min, saved[key]));
    }
  } catch { /* Storage may be unavailable; tuning remains usable for the session. */ }
  return settings;
}
export function saveWallSettings(settings, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    let previous;
    try { previous = JSON.parse(target.getItem(WALL_SETTINGS_KEY)); } catch { /* Repair invalid JSON. */ }
    // Keep unrecognized fields so a rollback does not erase newer controls.
    const saved = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    target.setItem(WALL_SETTINGS_KEY, JSON.stringify({ ...saved, ...settings }));
    return true;
  } catch { return false; }
}
