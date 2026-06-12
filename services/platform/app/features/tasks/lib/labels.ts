/**
 * Label colour system. Labels are stored as plain lowercase strings (see
 * convex/tasks/mutations.ts normalization) — colour is purely presentational
 * and derived here so every surface (board card, modal, picker) agrees:
 * the predefined trio gets a fixed colour, everything else hashes into a
 * stable palette so a custom label keeps its colour across sessions.
 */

export type TaskLabelColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray';

/** Literal class strings so Tailwind's scanner picks them up. */
export const LABEL_DOT_CLASS: Record<TaskLabelColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  gray: 'bg-gray-400',
};

/** Labels offered out of the box in the picker, with their fixed colours. */
export const PREDEFINED_LABELS: ReadonlyArray<{
  name: string;
  color: TaskLabelColor;
}> = [
  { name: 'bug', color: 'red' },
  { name: 'feature', color: 'purple' },
  { name: 'improvement', color: 'blue' },
];

const PREDEFINED_COLOR = new Map(
  PREDEFINED_LABELS.map((l) => [l.name, l.color]),
);

/** Hash palette for custom labels — excludes the predefined trio's colours so
 *  a custom label is less likely to masquerade as Bug/Feature/Improvement. */
const CUSTOM_PALETTE: TaskLabelColor[] = [
  'orange',
  'amber',
  'green',
  'teal',
  'pink',
  'gray',
];

export function labelColor(label: string): TaskLabelColor {
  const predefined = PREDEFINED_COLOR.get(label);
  if (predefined) return predefined;
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  // Length bound above guarantees a non-empty palette index.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  return CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length]!;
}
