'use client';

import { useSkeleton } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

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
  const { formatNumber } = useFormatNumber();
  const loading = useSkeleton();

  // Loaded-and-empty: no arena votes → nothing to summarize. While LOADING we
  // still render the full card (masked) so it reserves its height and doesn't
  // pop in once stats arrive (`total` is 0 during load too).
  if (!loading && total === 0) return null;

  const cells: ArenaSummaryCell[] = [
    {
      key: 'decisive',
      count: (byVerdict.a_better ?? 0) + (byVerdict.b_better ?? 0),
    },
    { key: 'tie', count: byVerdict.tie ?? 0 },
    { key: 'bothBad', count: byVerdict.both_bad ?? 0 },
  ];

  return (
    <MetricsSection title={tAnalytics('feedback.arena.title')}>
      <StatCardGrid cols={3}>
        {cells.map((cell) => (
          <StatCard
            key={cell.key}
            label={tAnalytics(`feedback.arena.cells.${cell.key}`)}
            value={formatNumber(cell.count)}
          />
        ))}
      </StatCardGrid>
    </MetricsSection>
  );
}
