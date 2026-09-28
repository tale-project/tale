/**
 * The rendered text rows of `el`, top to bottom: each row's top and the left
 * edge of its leftmost glyph, in viewport pixels. For `*.browser.test.tsx`
 * specs that judge where text lands (jsdom lays nothing out).
 */
export function textRows(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rows = new Map<number, number>();
  for (const rect of range.getClientRects()) {
    if (rect.width === 0) continue;
    const top = Math.round(rect.top);
    rows.set(top, Math.min(rows.get(top) ?? Infinity, rect.left));
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([top, left]) => ({ top, left }));
}
