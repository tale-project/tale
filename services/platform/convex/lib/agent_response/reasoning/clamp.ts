/** Clamp a number into the [0, 1] range. NaN passes through unchanged. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
