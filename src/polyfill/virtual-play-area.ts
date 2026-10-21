/** Authored developer-test region for assets/hall_empty.glb, in meters.
 * A 2 x 2 m rectangle on the clear central floor; clockwise viewed from +Y.
 * This is independent of sensed triangles and is never a physical guardian.
 * Revalidate tests/play-area.ts when replacing the room, or disable bounded-floor
 * in devices.json until a matching usable region has been authored.
 */
export const HALL_PLAY_AREA: readonly (readonly [number, number, number])[] = Object.freeze([
  Object.freeze([-1, 0, -1] as const),
  Object.freeze([1, 0, -1] as const),
  Object.freeze([1, 0, 1] as const),
  Object.freeze([-1, 0, 1] as const),
]);
