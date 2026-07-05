/**
 * Merge the two notification streams — the org-wide bell (`notifications`) and
 * the per-user inbox (`userNotifications`) — into ONE chronologically sorted
 * list. The bell renders both, and the user reads them as a single stream, so
 * an old personal item must never outrank a newer org alert (or vice versa).
 *
 * Each element keeps a `kind` discriminant so the caller renders it against the
 * right i18n namespace and deep-link resolver; visual distinction between the
 * two sources stays an icon/badge concern, not a positional one.
 */
export type MergedNotification<Personal, Org> =
  | { kind: 'personal'; item: Personal }
  | { kind: 'org'; item: Org };

/**
 * Interleave `personal` and `org` items by `createdAt`, newest first. The sort
 * is stable (ES2019+), so items sharing a timestamp keep personal-before-org
 * order — deterministic for tests and render keys.
 */
export function mergeNotificationsByRecency<
  Personal extends { createdAt: number },
  Org extends { createdAt: number },
>(
  personal: readonly Personal[],
  org: readonly Org[],
): Array<MergedNotification<Personal, Org>> {
  const merged: Array<MergedNotification<Personal, Org>> = [
    ...personal.map((item) => ({ kind: 'personal' as const, item })),
    ...org.map((item) => ({ kind: 'org' as const, item })),
  ];
  return merged.sort((a, b) => b.item.createdAt - a.item.createdAt);
}
