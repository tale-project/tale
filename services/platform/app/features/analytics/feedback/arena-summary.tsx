'use client';

import { useTranslation } from 'react-i18next';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import type { ArenaVerdict } from './types';

interface ArenaSummaryProps {
  byVerdict: Record<ArenaVerdict, number>;
  total: number;
}

// A vs B is a user-picked position (model selector), not random — so
// aggregating "A wins" / "B wins" across rows mixes different model
// pairs and yields no actionable signal. We surface a position-agnostic
// triple instead: decisive votes, ties, and both-bad. Per-pair
// matchups live in `top-matchups-feedback-table.tsx`.
type ArenaSummaryCell = {
  key: 'decisive' | 'tie' | 'bothBad';
  count: number;
};

export function ArenaSummary({ byVerdict, total }: ArenaSummaryProps) {
  const { t: tAnalytics } = useT('analytics');
  const { i18n } = useTranslation();

  if (total === 0) return null;

  const cells: ArenaSummaryCell[] = [
    {
      key: 'decisive',
      count: (byVerdict.a_better ?? 0) + (byVerdict.b_better ?? 0),
    },
    { key: 'tie', count: byVerdict.tie ?? 0 },
    { key: 'bothBad', count: byVerdict.both_bad ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {tAnalytics('feedback.arena.title')}
      </Text>
      <div className="border-border grid grid-cols-3 overflow-hidden rounded-lg border">
        {cells.map((cell, idx) => (
          <div
            key={cell.key}
            className={
              'flex flex-col gap-1 px-5 py-6 ' +
              (idx === cells.length - 1 ? '' : 'border-border border-r')
            }
          >
            <Text className="text-muted-foreground text-sm">
              {tAnalytics(`feedback.arena.cells.${cell.key}`)}
            </Text>
            <Text className="text-foreground font-mono text-2xl font-semibold">
              {formatNumber(cell.count, i18n.language)}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
