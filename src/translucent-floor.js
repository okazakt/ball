// Printed translucent floor: alpha controls visibility, transmitted daylight
// uses the complementary fraction. This approximates an area source with a
// soft spotlight; Three.js alpha blending alone never transmits illumination.
export const FLOOR_WINDOW_OPACITY = .6;
export const FLOOR_WINDOW_SIDE_OPACITY = .22;
export function windowDaylight(opacity = FLOOR_WINDOW_OPACITY) {
  const transmission = Math.max(0, Math.min(1, 1 - opacity));
  return { transmission, intensity: 1.2 * transmission, angle: .85, penumbra: 1, decay: 2 };
}
