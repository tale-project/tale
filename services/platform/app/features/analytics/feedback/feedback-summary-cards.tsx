'use client';

import { useTranslation } from 'react-i18next';

import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format/number';

interface FeedbackSummaryCardsProps {
  helpful: number;
  notHelpful: number;
  /** When true, sentiment cell is greyed out — partial-sample percentages mislead. */
  capped: boolean;
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
}: FeedbackSummaryCardsProps) {
  const { t } = useT('analytics');
  const { i18n } = useTranslation();
  const total = helpful + notHelpful;
  const positivePct = total === 0 ? 0 : helpful / total;
  const negativePct = total === 0 ? 0 : notHelpful / total;
  const sentimentLabel = formatPercent(helpful, total, i18n.language);

  return (
    <div className="border-border grid grid-cols-2 overflow-hidden rounded-lg border md:grid-cols-4">
      <div className="border-border col-span-2 flex flex-col gap-3 border-b px-5 py-6 md:border-r md:border-b-0">
        <Text className="text-muted-foreground text-sm">
          {t('feedback.cards.sentiment')}
        </Text>
        <div className="flex items-baseline gap-2">
          <Text
            className={cn(
              'text-foreground font-mono text-3xl font-semibold',
              capped && 'text-muted-foreground opacity-60',
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
            {capped ? '—' : sentimentLabel}
          </Text>
          {!capped && total > 0 ? (
            <Text variant="caption">
              {t('feedback.cards.sentimentDenominator', {
                helpful: formatNumber(helpful, i18n.language),
                total: formatNumber(total, i18n.language),
              })}
            </Text>
          ) : null}
        </div>
        {total > 0 ? (
          <div
            className="bg-muted relative h-2 w-full overflow-hidden rounded-full"
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
      <Cell
        label={t('feedback.cards.helpful')}
        value={formatNumber(helpful, i18n.language)}
        accent="positive"
      />
      <Cell
        label={t('feedback.cards.notHelpful')}
        value={formatNumber(notHelpful, i18n.language)}
        accent="negative"
      />
    </div>
  );
}

function Cell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'positive' | 'negative';
}) {
  return (
    <Stack className="border-border border-b px-5 py-6 md:border-r md:border-b-0 last:md:border-r-0">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text
        className={cn(
          'text-foreground font-mono text-2xl font-semibold',
          accent === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          accent === 'negative' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {value}
      </Text>
    </Stack>
  );
}
