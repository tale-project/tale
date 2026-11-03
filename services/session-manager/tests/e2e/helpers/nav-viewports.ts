/**
 * The window sizes the layout is checked at. The shell has one breakpoint,
 * Tailwind's `md` (768 px): from it the rail and the section panels show, below
 * it the tab bar replaces them and a section's pages are reached one screen at
 * a time.
 */

/** A small phone, a phone, a tablet right at the breakpoint, a laptop, a large monitor. */
export const WIDTHS = [320, 390, 768, 1280, 1920] as const;

/** The first width with the rail (`md`). */
export const MD_BREAKPOINT = 768;

export interface Viewport {
  width: number;
  height: number;
}

export const DESKTOP: Viewport = { width: 1280, height: 800 };
export const PHONE: Viewport = { width: 390, height: 844 };
/**
 * A phone held sideways (an iPhone 14): wide enough for the rail, the list of
 * sessions and the page side by side, and only 390 px tall, so that a menu, a
 * dialog or the viewer's toolbar has to fit the little height there is.
 */
const LANDSCAPE: Viewport = { width: 844, height: 390 };

/** A window of this width, as tall as a phone or a laptop usually is. */
export function viewportAt(width: number): Viewport {
  return {
    width,
    height: width < MD_BREAKPOINT ? PHONE.height : DESKTOP.height,
  };
}

/** The two layouts the audits run in. */
export const LAYOUTS = [
  { name: 'desktop', viewport: DESKTOP },
  { name: 'phone', viewport: PHONE },
] as const;

/** The phone held sideways, which the session screens and the viewer are audited in as well. */
export const SIDEWAYS = { name: 'landscape', viewport: LANDSCAPE } as const;

export type Layout = (typeof LAYOUTS)[number] | typeof SIDEWAYS;

export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];
