/** A size in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** The viewport of the page in the session's browser, as its `view` message says. */
export interface ViewSize {
  w: number;
  h: number;
}

/** Where the picture sits in its room, in CSS pixels from the room's top left. */
export interface Placement extends Size {
  left: number;
  top: number;
  /** Shown size over the page's size, at most 1. */
  scale: number;
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Where to draw the picture of a page of `view` size in a room of `room` size:
 * scaled down to fit and centred, never enlarged. The browser's window stays
 * the size its fingerprint says, so a page cannot tell it is looked at through
 * a smaller one; enlarging a picture would only blur it.
 *
 * The size is cut down to whole pixels so that the edges stay sharp, and
 * `null` says there is nothing to draw yet: no picture size, or no room.
 */
export function fitView(view: ViewSize, room: Size): Placement | null {
  if (
    !usable(view.w) ||
    !usable(view.h) ||
    !usable(room.width) ||
    !usable(room.height)
  ) {
    return null;
  }
  const scale = Math.min(room.width / view.w, room.height / view.h, 1);
  // At least one pixel: a room a few pixels wide must not make a zero-sized
  // canvas that mouse positions divide by.
  const width = Math.max(1, Math.floor(view.w * scale));
  const height = Math.max(1, Math.floor(view.h * scale));
  return {
    width,
    height,
    left: Math.max(0, Math.floor((room.width - width) / 2)),
    top: Math.max(0, Math.floor((room.height - height) / 2)),
    scale,
  };
}
