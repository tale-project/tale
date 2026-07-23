/**
 * Container-relative MiniMap size for the workflow canvas.
 *
 * Sized from the canvas container (not the window) so a chat-squeezed or
 * phone-width canvas does not keep a desktop-sized MiniMap. Returns `null`
 * only when the container has not been measured yet (non-positive size).
 */

const MINIMAP_WIDTH_RATIO = 0.18;
const MINIMAP_MIN_WIDTH = 64;
const MINIMAP_MAX_WIDTH = 192;
const MINIMAP_MIN_HEIGHT = 64;
const MINIMAP_MAX_HEIGHT = 160;
const MINIMAP_HEIGHT_RATIO = 0.28;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type MinimapDimensions = { width: number; height: number };

export function computeMinimapDimensions(
  containerWidth: number,
  containerHeight: number,
): MinimapDimensions | null {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }

  const width = clamp(
    Math.round(containerWidth * MINIMAP_WIDTH_RATIO),
    MINIMAP_MIN_WIDTH,
    MINIMAP_MAX_WIDTH,
  );
  const aspectRatio = containerWidth / containerHeight;
  const heightCap = Math.min(
    MINIMAP_MAX_HEIGHT,
    Math.round(containerHeight * MINIMAP_HEIGHT_RATIO),
  );
  const height = clamp(
    Math.round(width / aspectRatio),
    MINIMAP_MIN_HEIGHT,
    heightCap,
  );

  return { width, height };
}
