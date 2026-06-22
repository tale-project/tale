'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { useTranslation } from 'react-i18next';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format/number';

interface FeedbackSummaryCardsProps {
  helpful: number;
  notHelpful: number;
  /** When true, sentiment cell is greyed out — partial-sample percentages mislead. */
  capped: boolean;
  /** Prior-window sentiment counts (from the query's `previous`), for deltas. */
  previous?: { positive: number; negative: number; total: number };
}

function formatPercent(
  positive: number,
  total: number,
  locale: string,
): string {
  if (total === 0) return '—';
  const ratio = positive / total;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(ratio);
  } catch {
    return `${Math.round(ratio * 100)}%`;
  }
}

export function FeedbackSummaryCards({
  helpful,
  notHelpful,
  capped,
  previous,
}: FeedbackSummaryCardsProps) {
  const { t } = useT('analytics');
  const { i18n } = useTranslation();
  const loading = useSkeleton();
  const total = helpful + notHelpful;
  const positivePct = total === 0 ? 0 : helpful / total;
  const negativePct = total === 0 ? 0 : notHelpful / total;
  const sentimentLabel = formatPercent(helpful, total, i18n.language);

  // Sentiment delta compares the positive share across windows (higher = good).
  const prevTotal = previous ? previous.positive + previous.negative : 0;
  const prevPositivePct =
    previous && prevTotal > 0
      ? (previous.positive / prevTotal) * 100
      : undefined;

  return (
    <StatCardGrid className="overflow-hidden">
      {/* Bespoke sentiment cell: a percentage with an inline denominator and a
          positive/negative bar — too specialized for the plain StatCard, so it
          rides along as a `col-span-2` child of the same grid. */}
      <div className="col-span-2 flex flex-col gap-3 p-5">
        <Text className="text-fg-muted text-sm">
          {t('feedback.cards.sentiment')}
        </Text>
        <div className="flex items-baseline gap-2">
          <Text
            className={cn(
              'text-fg-base font-mono text-3xl font-semibold',
              capped && 'text-fg-muted opacity-60',
            )}
            aria-label={
              capped
                ? t('feedback.cards.sentimentCapped')
                : t('feedback.cards.sentimentAriaLabel', {
                    pct: sentimentLabel,
                    helpful: formatNumber(helpful, i18n.language),
                    total: formatNumber(total, i18n.language),
                  })
            }
          >
            {loading ? (
              <SkeletonBox>
                <span className="my-0.5 inline-block h-9 w-24" />
              </SkeletonBox>
            ) : capped ? (
              '—'
            ) : (
              sentimentLabel
            )}
          </Text>
          {!loading && !capped && total > 0 ? (
            <Text variant="caption">
              {t('feedback.cards.sentimentDenominator', {
                helpful: formatNumber(helpful, i18n.language),
                total: formatNumber(total, i18n.language),
              })}
            </Text>
          ) : null}
          {!loading && !capped && total > 0 && prevPositivePct !== undefined ? (
            <TrendIndicator
              value={positivePct * 100}
              previous={prevPositivePct}
            />
          ) : null}
        </div>
        {/* The sentiment bar only paints with data — reserve its exact 0.5rem
            height while loading so the sentiment cell doesn't grow on load. */}
        {loading ? (
          <SkeletonBox fullWidth>
            <div className="h-2 w-full rounded-full" />
          </SkeletonBox>
        ) : total > 0 ? (
          <div
            className="bg-bg-muted relative h-2 w-full overflow-hidden rounded-full"
            role="img"
            aria-hidden="true"
          >
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500"
              style={{ width: `${positivePct * 100}%` }}
            />
            <div
              className="absolute inset-y-0 bg-rose-500"
              style={{
                left: `${positivePct * 100}%`,
                width: `${negativePct * 100}%`,
              }}
            />
          </div>
        ) : null}
      </div>
      <StatCard
        label={t('feedback.cards.helpful')}
        value={formatNumber(helpful, i18n.language)}
        valueClassName="text-emerald-600 dark:text-emerald-400"
      >
        <div className="mt-0.5">
          <TrendIndicator value={helpful} previous={previous?.positive} />
        </div>
      </StatCard>
      <StatCard
        label={t('feedback.cards.notHelpful')}
        value={formatNumber(notHelpful, i18n.language)}
        valueClassName="text-rose-600 dark:text-rose-400"
      >
        <div className="mt-0.5">
          <TrendIndicator
            value={notHelpful}
            previous={previous?.negative}
            inverted
          />
        </div>
      </StatCard>
    </StatCardGrid>
  );
}
