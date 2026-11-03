/**
 * The tab that a key of the tab strip moves to: the arrow keys go to the
 * neighbour and round the end, Home and End go to the ends. Null when the key
 * is none of those.
 */
export function tabTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
