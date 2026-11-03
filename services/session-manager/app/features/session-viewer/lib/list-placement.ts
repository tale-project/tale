import type { Placement, Size, ViewSize } from './fit-view';

/** The narrowest a list is drawn, whatever the `<select>` under it measures. */
const MIN_LIST_WIDTH = 120;
/** Air between the list and the edge of the screen, and between it and the `<select>`. */
const EDGE = 8;
const GAP = 2;

export interface ListPlacementInput {
  /** The `<select>`'s rectangle, in the pixels of the page. */
  anchor: { x: number; y: number; width: number; height: number };
  view: ViewSize;
  /** Where the picture of the page sits in the screen. */
  picture: Placement;
  screen: Size;
  /** The size of the list itself once it is drawn (zero before). */
  list: Size;
}

export interface ListPlacement {
  left: number;
  top: number;
  minWidth: number;
  /** The list scrolls beyond this height: it never grows past the room it has. */
  maxHeight: number;
}

/** The tallest a list is drawn: a longer one scrolls. */
const MAX_LIST_HEIGHT = 320;
/** The shortest room a list is squeezed into, however little there is. */
const MIN_LIST_HEIGHT = 96;

/**
 * Where to draw the list of a `<select>` so that it opens over the one in the
 * picture: as wide as the `<select>` is shown, below it, and kept inside the
 * screen. When it does not fit below it opens upwards if it fits there or
 * there is more room there; when it fits on neither side it takes the larger
 * and scrolls.
 */
export function placeList({
  anchor,
  view,
  picture,
  screen,
  list,
}: ListPlacementInput): ListPlacement {
  const scale = picture.width / view.w;
  const left = picture.left + anchor.x * scale;
  const above = picture.top + anchor.y * scale;
  const below = picture.top + (anchor.y + anchor.height) * scale + GAP;
  const roomBelow = screen.height - below - EDGE;
  const roomAbove = above - GAP - EDGE;
  const opensUp =
    list.height > roomBelow &&
    (list.height <= roomAbove || roomAbove > roomBelow);
  const maxHeight = Math.min(
    MAX_LIST_HEIGHT,
    Math.max(opensUp ? roomAbove : roomBelow, MIN_LIST_HEIGHT),
  );
  const height = Math.min(list.height, maxHeight);
  return {
    left: Math.max(EDGE, Math.min(left, screen.width - list.width - EDGE)),
    top: opensUp ? Math.max(EDGE, above - height - GAP) : below,
    minWidth: Math.max(anchor.width * scale, MIN_LIST_WIDTH),
    maxHeight,
  };
}
