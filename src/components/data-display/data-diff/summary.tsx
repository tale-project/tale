'use client';

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { DiffResult } from '../../../data/value-diff';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';

/**
 * How a diff speaks of its two sides: as a change from `before` to
 * `after` ("2 changed"), or as an expectation `before` that `after` did
 * not meet — a test's expected output against the one it got ("2
 * different, 1 missing").
 */
export type DataDiffWording = 'change' | 'expectation';

/** The words of each count, of changes or against an expectation. */
const COUNT_KEYS = {
  change: {
    added: 'count.added',
    removed: 'count.removed',
    changed: 'count.changed',
    typeChanged: 'count.typeChanged',
  },
  expectation: {
    added: 'expect.count.added',
    removed: 'expect.count.removed',
    changed: 'expect.count.changed',
    typeChanged: 'expect.count.typeChanged',
  },
} as const;

/**
 * A diff's counts in words, the kinds that occurred only: "3 added,
 * 1 removed, 2 changed" — or, against an expectation, "1 unexpected,
 * 1 missing, 2 different"; "No changes" when there are none.
 */
export function diffSummaryText(
  t: TFunction,
  counts: DiffResult['counts'],
  locale = 'en',
  wording: DataDiffWording = 'change',
): string {
  const keys = COUNT_KEYS[wording];
  const parts = [
    counts.added > 0 ? t(keys.added, { count: counts.added }) : null,
    counts.removed > 0 ? t(keys.removed, { count: counts.removed }) : null,
    counts.changed > 0 ? t(keys.changed, { count: counts.changed }) : null,
    counts['type-changed'] > 0
      ? t(keys.typeChanged, { count: counts['type-changed'] })
      : null,
    counts.reordered > 0
      ? t('count.reordered', { count: counts.reordered })
      : null,
    counts.unknown > 0 ? t('count.unknown', { count: counts.unknown }) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return t('none');
  return new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(
    parts,
  );
}

export interface DataDiffSummaryProps {
  counts: DiffResult['counts'];
  /** `expectation`: the counts against what was expected. */
  wording?: DataDiffWording;
  className?: string;
}

/** The one-line account of a diff that heads a list of changes or names a
 *  section: "3 added, 1 removed, 2 changed, 1 changed type". */
export function DataDiffSummary({
  counts,
  wording = 'change',
  className,
}: DataDiffSummaryProps) {
  const { t } = useT('dataDiff');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  return (
    <p className={cn('text-muted-foreground text-xs', className)}>
      {diffSummaryText(t, counts, locale, wording)}
    </p>
  );
}
