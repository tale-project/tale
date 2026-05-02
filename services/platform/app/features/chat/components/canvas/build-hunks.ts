/**
 * Pure helper for the Canvas patch-stream view: turn a full source string and
 * a list of `{search, replace}` patches into focused hunks (the patch regions
 * surrounded by ±`contextLines` lines), so the renderer never has to walk the
 * entire document on every Convex push.
 *
 * No React imports here on purpose — keep this trivially testable from node.
 */

export const HUNK_CONTEXT_LINES = 3;

export type HunkSegment =
  | { readonly kind: 'context'; readonly text: string }
  | {
      readonly kind: 'patch';
      readonly search: string;
      readonly replace: string;
    };

export interface Hunk {
  /** 1-based line number of the first context line in the hunk. */
  readonly startLine: number;
  /** 1-based line number of the last context line in the hunk. */
  readonly endLine: number;
  /**
   * Alternating context/patch segments. Always starts and ends with a context
   * segment (possibly empty when the patch sits at file start/end), and never
   * has two adjacent segments of the same kind.
   */
  readonly segments: readonly HunkSegment[];
}

interface LocatedPatch {
  readonly matchStart: number;
  readonly matchEnd: number;
  readonly search: string;
  readonly replace: string;
  readonly startLine: number;
  readonly endLine: number;
}

function computeLineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line containing `offset`. Binary search over lineStarts. */
function lineOfOffset(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Build hunks for the canvas patch-diff view.
 *
 * Patches with empty `search`, or whose `search` is not found in `code`, are
 * skipped. Two patches whose match ranges overlap are resolved first-write-
 * wins (matches the prior behaviour of `renderWithDiff`). Patches whose
 * context windows touch or overlap are merged into a single hunk so the user
 * sees one continuous stretch of code instead of two near-duplicate hunks.
 */
export function buildHunks(
  code: string,
  patches: readonly { search: string; replace: string }[],
  contextLines: number = HUNK_CONTEXT_LINES,
): Hunk[] {
  if (patches.length === 0) return [];

  const lineStarts = computeLineStarts(code);
  const totalLines = lineStarts.length;
  const ctx = Math.max(0, Math.floor(contextLines));

  const located: LocatedPatch[] = [];
  for (const patch of patches) {
    if (!patch.search) continue;
    const matchStart = code.indexOf(patch.search);
    if (matchStart === -1) continue;
    const matchEnd = matchStart + patch.search.length;
    const overlaps = located.some(
      (existing) =>
        !(matchEnd <= existing.matchStart || matchStart >= existing.matchEnd),
    );
    if (overlaps) continue;
    const startLine = lineOfOffset(lineStarts, matchStart);
    // For a non-empty search, endLine is the line containing the last
    // matched character (matchEnd - 1). When search ends exactly on a `\n`,
    // that newline still lives on `startLine`, so endLine collapses back.
    const endLine = lineOfOffset(lineStarts, matchEnd - 1);
    located.push({
      matchStart,
      matchEnd,
      search: patch.search,
      replace: patch.replace,
      startLine,
      endLine,
    });
  }

  if (located.length === 0) return [];

  located.sort((a, b) => a.matchStart - b.matchStart);

  // Group adjacent patches whose context windows touch (gap of ≤ 1 line).
  const groups: LocatedPatch[][] = [];
  let current: LocatedPatch[] = [located[0]];
  for (let i = 1; i < located.length; i += 1) {
    const prev = current[current.length - 1];
    const next = located[i];
    const prevLastCtxLine = Math.min(totalLines, prev.endLine + ctx);
    const nextFirstCtxLine = Math.max(1, next.startLine - ctx);
    if (nextFirstCtxLine <= prevLastCtxLine + 1) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);

  const hunks: Hunk[] = [];
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const firstCtxLine = Math.max(1, first.startLine - ctx);
    const lastCtxLine = Math.min(totalLines, last.endLine + ctx);

    // Char range of the hunk's outer envelope: from start of firstCtxLine to
    // end of lastCtxLine (excluding the trailing `\n` between lastCtxLine and
    // the next line, so we don't render an extra blank line).
    const envelopeStart = lineStarts[firstCtxLine - 1];
    const envelopeEnd =
      lastCtxLine < lineStarts.length
        ? lineStarts[lastCtxLine] - 1
        : code.length;

    const segments: HunkSegment[] = [];
    segments.push({
      kind: 'context',
      text: code.slice(envelopeStart, first.matchStart),
    });
    for (let i = 0; i < group.length; i += 1) {
      const cur = group[i];
      segments.push({
        kind: 'patch',
        search: cur.search,
        replace: cur.replace,
      });
      const next = group[i + 1];
      if (next) {
        segments.push({
          kind: 'context',
          text: code.slice(cur.matchEnd, next.matchStart),
        });
      }
    }
    segments.push({
      kind: 'context',
      text: code.slice(last.matchEnd, Math.max(envelopeEnd, last.matchEnd)),
    });

    hunks.push({
      startLine: firstCtxLine,
      endLine: lastCtxLine,
      segments,
    });
  }

  return hunks;
}
