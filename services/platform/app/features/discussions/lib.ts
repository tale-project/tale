/**
 * Discussion UI helpers shared across the feature's components (the board tab
 * and the thread view both render a status badge and category label). Kept
 * feature-local — these are presentation concerns, not backend contract.
 */

import {
  DEFAULT_DISCUSSION_CATEGORIES,
  type DiscussionCategory,
  type DiscussionStatus,
} from '@/lib/shared/constants/discussions';

export type { DiscussionStatus };

/** Badge variant per lifecycle status (open = active, locked = closed). */
export const DISCUSSION_STATUS_BADGE = {
  open: 'green',
  resolved: 'outline',
  locked: 'destructive',
} as const satisfies Record<
  DiscussionStatus,
  'green' | 'outline' | 'destructive'
>;

/**
 * Narrow a raw backend string to a `DiscussionStatus`, defaulting to `'open'`.
 * The backend persists a constrained union, but the wire value is typed as a
 * plain string, so guard rather than assert — an unexpected value renders as an
 * open discussion instead of breaking the UI.
 */
export function toDiscussionStatus(
  value: string | undefined,
): DiscussionStatus {
  switch (value) {
    case 'resolved':
    case 'locked':
      return value;
    default:
      return 'open';
  }
}

const KNOWN_CATEGORY_SET: ReadonlySet<string> = new Set(
  DEFAULT_DISCUSSION_CATEGORIES,
);

/** Type guard for the built-in categories that carry an i18n label. */
export function isKnownDiscussionCategory(
  value: string,
): value is DiscussionCategory {
  return KNOWN_CATEGORY_SET.has(value);
}

/**
 * Resolve the display label for a discussion category. Built-in categories are
 * localized via `categories.<id>`; custom/unknown categories render verbatim
 * (they carry no i18n key). The caller passes its bound `t` so this stays a
 * pure function and `lib.ts` keeps no i18n dependency.
 */
export function discussionCategoryLabel(
  category: string,
  translate: (key: string) => string,
): string {
  return isKnownDiscussionCategory(category)
    ? translate(`categories.${category}`)
    : category;
}
