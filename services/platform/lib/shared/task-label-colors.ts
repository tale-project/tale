/**
 * Task-label colour palette shared by the Convex backend (validating
 * `setLabelColor` writes) and the app (rendering chips / the picker).
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
