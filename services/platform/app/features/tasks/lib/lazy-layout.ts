/**
 * How the rows of a task's conversation skip layout and paint until they near
 * the viewport, so a long history opens and scrolls at the cost of what is on
 * screen. A row keeps the height it last had (`auto`) and stands in at a first
 * guess until it is drawn.
 *
 * Only where the browser anchors scrolling (`overflow-anchor`: Chromium and
 * Firefox). A row drawn for the first time rarely has the height that was
 * guessed, and everything under it moves; an anchoring browser holds what the
 * reader is reading still. Safari does not anchor, so it would show every such
 * row as a jump, and the thread would have to move the scrollport by script
 * while a flick is under way. There every row is laid out in full.
 */

/** A comment's row; the guess is a short one. */
export const LAZY_COMMENT_LAYOUT =
  '[contain-intrinsic-block-size:auto_8rem] supports-[overflow-anchor:auto]:[content-visibility:auto]';

/** An event's line: one line of text. */
export const LAZY_EVENT_LAYOUT =
  '[contain-intrinsic-block-size:auto_1.5rem] supports-[overflow-anchor:auto]:[content-visibility:auto]';
