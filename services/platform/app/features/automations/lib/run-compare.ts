/**
 * Two runs compared, in words: what differs between them, most telling
 * first — the versions they ran, their input, the step where they split
 * and why, how each ended, their output and their writes. Two runs that
 * differ in nothing but time say so.
 *
 * Words come from the caller (`automationRuns`), so this stays a pure
 * mapping of the engine's comparison (`lib/engine/core/record/compare.ts`).
 */

import type { RunDiff } from '@/app/lib/backend/contract/automations';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The top-level step a path belongs to: `enrich[0:-1]/fetch` → `enrich`. */
export function topLevelStep(path: string): string {
  const first = path.split('/')[0] ?? path;
  const bracket = first.indexOf('[');
  return bracket === -1 ? first : first.slice(0, bracket);
}

/** At most this many sentences: the summary leads, the tabs hold the rest. */
const SUMMARY_LINES = 6;

/** What differs between the two runs of `diff`, as sentences. */
export function compareSummary(
  diff: RunDiff,
  ctx: { t: Translate; stepLabel: (nodeId: string) => string },
): string[] {
  const { t } = ctx;
  const lines: string[] = [];
  if (!diff.version.same) {
    lines.push(
      t('compare.differs.version', {
        a: String(diff.a.version),
        b: String(diff.b.version),
        count:
          diff.version.changed.length +
          diff.version.added.length +
          diff.version.removed.length,
      }),
    );
  }
  if (diff.input.equal === false) {
    lines.push(
      t('compare.differs.input', { count: Math.max(1, diff.input.total) }),
    );
  }
  if (diff.firstDivergence !== undefined) {
    lines.push(
      t('compare.differs.split', {
        step: ctx.stepLabel(topLevelStep(diff.firstDivergence.path)),
        why: diff.firstDivergence.why,
      }),
    );
  }
  if (diff.a.status !== diff.b.status) {
    lines.push(
      t('compare.differs.outcome', { a: diff.a.status, b: diff.b.status }),
    );
  }
  if (diff.output.equal === false) {
    lines.push(
      t('compare.differs.output', { count: Math.max(1, diff.output.total) }),
    );
  }
  const { effects } = diff;
  if (
    effects.count.a !== effects.count.b ||
    effects.onlyA.length > 0 ||
    effects.onlyB.length > 0 ||
    effects.changed.length > 0
  ) {
    lines.push(
      t('compare.differs.effects', {
        a: effects.count.a,
        b: effects.count.b,
      }),
    );
  }
  return lines.length === 0
    ? [t('compare.differs.nothing')]
    : lines.slice(0, SUMMARY_LINES);
}
