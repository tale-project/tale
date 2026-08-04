'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface FeedbackSummaryCardsProps {
  helpful: number;
  notHelpful: number;
  /** When true, sentiment cell is greyed out — partial-sample percentages mislead. */
  capped: boolean;
  /** Prior-window sentiment counts (from the query's `previous`), for deltas. */
  previous?: { positive: number; negative: number; total: number };
}

export function FeedbackSummaryCards({
  helpful,
  notHelpful,
  capped,
  previous,
}: FeedbackSummaryCardsProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatPercentShare } = useFormatNumber();
  const loading = useSkeleton();
  const total = helpful + notHelpful;
  const positivePct = total === 0 ? 0 : helpful / total;
  const negativePct = total === 0 ? 0 : notHelpful / total;
  const sentimentLabel = formatPercentShare(helpful, total);

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
      <div className="bg-bg-base col-span-2 flex flex-col gap-3 p-5">
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
                    helpful: formatNumber(helpful),
                    total: formatNumber(total),
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
                helpful: formatNumber(helpful),
                total: formatNumber(total),
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
              className="bg-chart-success absolute inset-y-0 left-0"
              style={{ width: `${positivePct * 100}%` }}
            />
            <div
              className="bg-chart-failure absolute inset-y-0"
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
        value={formatNumber(helpful)}
        valueClassName="text-chart-success"
      >
        <div className="mt-0.5">
          <TrendIndicator value={helpful} previous={previous?.positive} />
        </div>
      </StatCard>
      <StatCard
        label={t('feedback.cards.notHelpful')}
        value={formatNumber(notHelpful)}
        valueClassName="text-chart-failure"
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
