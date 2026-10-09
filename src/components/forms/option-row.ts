/**
 * The shape of one choice in a picker's list — full width, text on the left,
 * a trailing check or badge on the right. `SearchableSelect` rows and the
 * recurrence picker's preset rows share it, so every list of choices in a
 * popover reads the same.
 */
export const OPTION_ROW_CLASSES =
  'group/option relative flex w-full cursor-default gap-2 text-left text-sm';

/**
 * The inset row: 8px of padding and rounded corners inside a list that has
 * its own `p-1` gutter. One line of `text-sm` makes it 36px tall, a
 * comfortable pointer target.
 */
export const OPTION_ROW_INSET = 'rounded-md p-2';
