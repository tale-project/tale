/**
 * Label colour presentation. Catalogue colour lives on `taskLabels.color`;
 * this module maps palette names to Tailwind classes and resolves a
 * name's default colour before its catalog row loads.
 */

import {
  defaultTaskLabelColor,
  isTaskLabelColor,
  type TaskLabelColor,
} from '@/lib/shared/task-label-colors';

export type { TaskLabelColor };

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

/** Coerce a stored/wire colour string to a palette name. */
export function asLabelColor(color: string | undefined): TaskLabelColor {
  if (color && isTaskLabelColor(color)) return color;
  return 'gray';
}

/** Default colour for a name when the catalog row is not loaded yet. */
export function labelColor(name: string): TaskLabelColor {
  return defaultTaskLabelColor(name);
}
