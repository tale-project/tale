/**
 * Task-label colour palette shared by the Convex backend (validating
 * label colour writes) and the app (rendering chips / the picker).
 * Values are palette NAMES, not CSS — the UI maps them to classes in
 * `app/features/tasks/lib/labels.ts`.
 */

export const TASK_LABEL_COLORS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'gray',
] as const;

export type TaskLabelColor = (typeof TASK_LABEL_COLORS)[number];

const COLOR_SET: ReadonlySet<string> = new Set(TASK_LABEL_COLORS);

export function isTaskLabelColor(value: string): value is TaskLabelColor {
  return COLOR_SET.has(value);
}

/** Labels offered out of the box in the picker, with their default colours. */
export const PREDEFINED_TASK_LABELS: ReadonlyArray<{
  name: string;
  color: TaskLabelColor;
}> = [
  { name: 'bug', color: 'red' },
  { name: 'feature', color: 'purple' },
  { name: 'improvement', color: 'blue' },
];

const PREDEFINED_COLOR = new Map(
  PREDEFINED_TASK_LABELS.map((l) => [l.name, l.color]),
);

/** Hash palette for custom labels — excludes the predefined trio's colours. */
const CUSTOM_PALETTE: TaskLabelColor[] = [
  'orange',
  'amber',
  'green',
  'teal',
  'pink',
  'gray',
];

/**
 * Default colour for a normalized label name when no catalog/override colour
 * is set: predefined trio first, else a stable hash into the custom palette.
 */
export function defaultTaskLabelColor(name: string): TaskLabelColor {
  const predefined = PREDEFINED_COLOR.get(name);
  if (predefined) return predefined;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length] ?? 'gray';
}
