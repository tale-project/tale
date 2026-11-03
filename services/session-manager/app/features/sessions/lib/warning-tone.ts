// The library has no soft warning token (`text-warning` is 2.2:1 on white), so
// a warning that is read as text spells the amber of its `Alert variant="warning"`
// in both themes. One place for it, so the row's second line, the header's
// context line and the identity chip stay one colour.

/** Warning words (a row's second line, the header's context line). */
export const WARNING_TEXT_CLASS = 'text-amber-700 dark:text-amber-400';

/** The glyph of a warning (a triangle beside the words). */
export const WARNING_ICON_CLASS = 'text-amber-600 dark:text-amber-500';

/** A chip that warns: the tint and edge of `Alert variant="warning"`. */
export const WARNING_CHIP_CLASS =
  'border-amber-500/40 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50';
