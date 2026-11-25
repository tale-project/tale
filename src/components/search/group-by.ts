import type { SearchResult } from './types';

export interface ResultGroupItem {
  result: SearchResult;
  /** Sequential index in group/DOM order. Keyboard navigation increments
   *  through these so the active row tracks what the user actually sees —
   *  the raw `results` array is score-sorted, which would jump around once
   *  the list is clustered into groups. */
  visualIndex: number;
}

export interface ResultGroup {
  key: string;
  label: string;
  items: ResultGroupItem[];
}

export const FALLBACK_GROUP = '__other';

/** Title-case a group key/path segment. Pure transform — it never emits a
 *  user-facing label of its own (the catch-all {@link FALLBACK_GROUP} is
 *  localised by the caller's `getGroupLabel`, e.g. the command's
 *  `resolveGroupLabel`), so no English copy is baked in here. */
export function humanizeGroupKey(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

const defaultGroupKey = (r: SearchResult): string => r.group ?? FALLBACK_GROUP;

/**
 * Cluster results into groups, preserving first-seen group order, and assign
 * each item a sequential `visualIndex` matching its DOM position. Single-pass
 * clustering + a second pass to number items in render order.
 */
export function groupResults(
  results: readonly SearchResult[],
  getGroupKey: (r: SearchResult) => string = defaultGroupKey,
  getGroupLabel: (key: string) => string = humanizeGroupKey,
): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const result of results) {
    const key = getGroupKey(result);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push({ result, visualIndex: 0 });
    } else {
      groups.set(key, {
        key,
        label: getGroupLabel(key),
        items: [{ result, visualIndex: 0 }],
      });
    }
  }
  let i = 0;
  for (const group of groups.values()) {
    for (const item of group.items) item.visualIndex = i++;
  }
  return Array.from(groups.values());
}

/** Flatten groups back to a flat array in DOM/visual order — the array
 *  keyboard navigation indexes into. */
export function flattenGroups(groups: readonly ResultGroup[]): SearchResult[] {
  return groups.flatMap((g) => g.items.map((it) => it.result));
}

/** Build a breadcrumb from a URL path. Drops the last segment (it duplicates
 *  the page title) and a leading locale prefix (e.g. `/de`) so users see
 *  context like `Self-hosted / Configuration` instead of a raw URL. Opt-in:
 *  surfaces whose `href` is a router path (not a doc URL) simply don't use it. */
export function urlToBreadcrumb(
  url: string | undefined,
  segmentLabel?: (key: string) => string,
): string[] {
  if (!url || url === '/') return [];
  const segments = url
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return [];
  const head = segments[0] ?? '';
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(head)) segments.shift();
  const trail = segments.length > 1 ? segments.slice(0, -1) : segments;
  return trail.map((seg, i) =>
    i === 0 && segmentLabel ? segmentLabel(seg) : humanizeGroupKey(seg),
  );
}
