'use client';

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { DiffResult } from '../../../data/value-diff';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';

/**
 * A diff's counts in words, the kinds that occurred only: "3 added,
 * 1 removed, 2 changed"; "No changes" when there are none.
 */
export function diffSummaryText(
  t: TFunction,
  counts: DiffResult['counts'],
  locale = 'en',
): string {
  const parts = [
    counts.added > 0 ? t('count.added', { count: counts.added }) : null,
    counts.removed > 0 ? t('count.removed', { count: counts.removed }) : null,
    counts.changed > 0 ? t('count.changed', { count: counts.changed }) : null,
    counts['type-changed'] > 0
      ? t('count.typeChanged', { count: counts['type-changed'] })
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
  className?: string;
}

/** The one-line account of a diff that heads a list of changes or names a
 *  section: "3 added, 1 removed, 2 changed, 1 changed type". */
export function DataDiffSummary({ counts, className }: DataDiffSummaryProps) {
  const { t } = useT('dataDiff');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  return (
    <p className={cn('text-muted-foreground text-xs', className)}>
      {diffSummaryText(t, counts, locale)}
    </p>
  );
}
