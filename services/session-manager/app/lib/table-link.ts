/**
 * The name of a row as a link or a button, the way the platform's tables draw
 * theirs (`projects-table.tsx`): the library's sizes, no touch enlargement of
 * its own; it underlines on hover and rings on keyboard focus. A cell adds its
 * layout to it (`block`, `truncate`, `text-sm`) with `cn`.
 */
export const TABLE_LINK_CLASS =
  'focus-visible:ring-ring min-w-0 rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none';
