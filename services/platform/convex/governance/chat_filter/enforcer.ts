import type { ChatFilterCategory } from '../../../lib/shared/schemas/governance';
import type { ChatFilterMatch } from './detector';

type CategoryMode = 'block' | 'mask' | 'flag';

export interface EnforcementResult {
  kind: 'pass' | 'modified' | 'flagged' | 'blocked';
  text: string;
  blockedCategories: string[];
  maskedCategories: string[];
  flaggedCategories: string[];
  matchCount: number;
}

function modeByCategory(
  categories: readonly ChatFilterCategory[],
): Map<string, CategoryMode> {
  const map = new Map<string, CategoryMode>();
  for (const c of categories) map.set(c.id, c.mode);
  return map;
}

/**
 * Resolve detected matches through per-category modes.
 *
 * Precedence (highest to lowest): block > mask > flag.
 * - If any category in block mode has matches, we return `blocked` with the
 *   set of blocking categories (the dispatcher converts to ConvexError).
 * - Otherwise we build the masked text in a single pass (sorted spans, no
 *   repeated replace — O(n) in text length).
 * - `flag` categories pass through unchanged but appear in `flaggedCategories`
 *   so audit can record them.
 *
 * Overlapping spans from different categories are coalesced by taking the
 * first match in document order; downstream spans starting inside a mask
 * region are dropped (prevents double-mask on overlapping regex + word).
 */
export function applyEnforcement(
  originalText: string,
  matches: readonly ChatFilterMatch[],
  categories: readonly ChatFilterCategory[],
  maskReplacement: string,
): EnforcementResult {
  if (matches.length === 0) {
    return {
      kind: 'pass',
      text: originalText,
      blockedCategories: [],
      maskedCategories: [],
      flaggedCategories: [],
      matchCount: 0,
    };
  }

  const modes = modeByCategory(categories);

  const blockedSet = new Set<string>();
  const maskedSet = new Set<string>();
  const flaggedSet = new Set<string>();

  // Partition matches by terminal resolution. `block` is collected separately
  // so a single pass over all matches tells us whether to short-circuit.
  const maskSpans: Array<{ start: number; end: number }> = [];
  for (const m of matches) {
    const mode = modes.get(m.categoryId);
    if (mode === 'block') {
      blockedSet.add(m.categoryId);
      continue;
    }
    if (mode === 'mask') {
      maskedSet.add(m.categoryId);
      maskSpans.push({ start: m.start, end: m.end });
      continue;
    }
    if (mode === 'flag') {
      flaggedSet.add(m.categoryId);
    }
  }

  if (blockedSet.size > 0) {
    return {
      kind: 'blocked',
      text: originalText,
      blockedCategories: [...blockedSet],
      maskedCategories: [...maskedSet],
      flaggedCategories: [...flaggedSet],
      matchCount: matches.length,
    };
  }

  if (maskSpans.length === 0) {
    return {
      kind: flaggedSet.size > 0 ? 'flagged' : 'pass',
      text: originalText,
      blockedCategories: [],
      maskedCategories: [],
      flaggedCategories: [...flaggedSet],
      matchCount: matches.length,
    };
  }

  // Single-pass mask: sort by start, merge overlaps, then concatenate.
  maskSpans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of maskSpans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) parts.push(originalText.slice(cursor, span.start));
    parts.push(maskReplacement);
    cursor = span.end;
  }
  if (cursor < originalText.length) parts.push(originalText.slice(cursor));

  return {
    kind: 'modified',
    text: parts.join(''),
    blockedCategories: [],
    maskedCategories: [...maskedSet],
    flaggedCategories: [...flaggedSet],
    matchCount: matches.length,
  };
}
