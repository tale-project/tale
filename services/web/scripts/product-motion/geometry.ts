/** The proof region is the visible native ink, including scrollable sheets. */
export function visibleInkRegion(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  encoded: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(
    0,
    Math.round((box.x * encoded.width) / viewport.width),
  );
  const top = Math.max(
    0,
    Math.round((box.y * encoded.height) / viewport.height),
  );
  const right = Math.min(
    encoded.width,
    Math.round(((box.x + box.width) * encoded.width) / viewport.width),
  );
  const bottom = Math.min(
    encoded.height,
    Math.round(((box.y + box.height) * encoded.height) / viewport.height),
  );
  if (right <= left || bottom <= top)
    throw new Error('Native action result is outside the captured viewport');
  return { left, top, width: right - left, height: bottom - top };
}
