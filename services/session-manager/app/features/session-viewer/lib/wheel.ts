/** `WheelEvent.deltaMode`: pixels, lines or pages. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** What a browser counts as a line when it scrolls by lines (Firefox does). */
export const LINE_HEIGHT = 16;

/**
 * The scroll of a wheel event in pixels of the page. A wheel that turns by
 * lines or by pages (Firefox, some mice) says so in `deltaMode`; the page
 * wants pixels. A page is the height of the viewport.
 */
export function wheelPixels(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  viewHeight: number,
): { dx: number; dy: number } {
  const unit =
    event.deltaMode === DOM_DELTA_LINE
      ? LINE_HEIGHT
      : event.deltaMode === DOM_DELTA_PAGE
        ? viewHeight
        : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

export interface WheelTotal {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Adds up the wheel events of one frame. A trackpad sends dozens of events a
 * second and the page only needs the sum, at the place the pointer was last.
 */
export class WheelAccumulator {
  private total: WheelTotal | null = null;

  /** Whether anything waits to be sent. */
  get pending(): boolean {
    return this.total !== null;
  }

  add(x: number, y: number, dx: number, dy: number): void {
    this.total = {
      x,
      y,
      dx: (this.total?.dx ?? 0) + dx,
      dy: (this.total?.dy ?? 0) + dy,
    };
  }

  /** The sum so far, and a fresh start. Null when nothing came. */
  take(): WheelTotal | null {
    const total = this.total;
    this.total = null;
    return total;
  }
}
