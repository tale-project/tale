'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendResult {
  /** Signed percentage change, or `null` when it can't be computed. */
  deltaPct: number | null;
  /** Direction of the change relative to the previous value. */
  direction: TrendDirection;
  /**
   * Whether a meaningful percentage is available. False when there is no prior
   * period to compare against (new org / first period) — the indicator renders
   * a neutral dash rather than a misleading "+100%" / "−100%".
   */
  isComputable: boolean;
}

/**
 * Pure period-over-period delta. The single place this math lives, so the
 * "no prior data → neutral, not ±100%" rule is enforced once and unit-tested.
 *
 * - `previous` undefined/null → not computable (no comparison exists yet).
 * - `previous === 0`: a 0→0 move is flat; a 0→n move is real growth but has no
 *   finite percentage, so it's reported as `up` + not computable.
 */
export function computeTrend(
  value: number,
  previous: number | null | undefined,
): TrendResult {
  if (previous === null || previous === undefined) {
    return { deltaPct: null, direction: 'flat', isComputable: false };
  }
  if (previous === 0) {
    if (value === 0)
      return { deltaPct: 0, direction: 'flat', isComputable: true };
    return { deltaPct: null, direction: 'up', isComputable: false };
  }
  const deltaPct = ((value - previous) / previous) * 100;
  const direction: TrendDirection =
    deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  return { deltaPct, direction, isComputable: true };
}

/** Format a signed percentage: whole numbers ≥10, one decimal below. */
function formatDeltaPct(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  const abs = Math.abs(pct);
  const rounded = abs >= 10 ? Math.round(abs) : Math.round(abs * 10) / 10;
  return `${sign}${rounded}%`;
}

interface TrendIndicatorProps {
  /** Current-period value. */
  value: number;
  /** Previous-period value to compare against. */
  previous: number | null | undefined;
  /**
   * When true, a DECREASE is good (cost, failures, latency, intervention rate):
   * down → success color, up → failure color. The arrow still points with the
   * raw direction; only the sentiment color flips.
   */
  inverted?: boolean;
  /** Trailing context, e.g. "vs last period". Rendered muted. */
  comparisonLabel?: string;
  className?: string;
}

const DIRECTION_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
} as const;

/**
 * A compact period-over-period delta badge: a direction arrow + signed
 * percentage, sentiment-colored (green = good, red = bad) with `inverted` for
 * metrics where down is good. Skeleton-aware — masks itself inside a
 * `<Skeletonize loading>`.
 */
export function TrendIndicator({
  value,
  previous,
  inverted = false,
  comparisonLabel,
  className,
}: TrendIndicatorProps) {
  const { deltaPct, direction, isComputable } = computeTrend(value, previous);

  // Sentiment: up is good unless inverted; flat/indeterminate is neutral.
  const sentiment: 'good' | 'bad' | 'neutral' =
    direction === 'flat' || !isComputable
      ? 'neutral'
      : (direction === 'up') !== inverted
        ? 'good'
        : 'bad';

  const Icon = DIRECTION_ICON[isComputable ? direction : 'flat'];

  const colorClass =
    sentiment === 'good'
      ? 'text-chart-success'
      : sentiment === 'bad'
        ? 'text-chart-failure'
        : 'text-muted-foreground';

  return (
    <SkeletonBox>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
          className,
        )}
      >
        <span className={cn('inline-flex items-center gap-0.5', colorClass)}>
          <Icon className="size-3" aria-hidden />
          {isComputable && deltaPct !== null ? formatDeltaPct(deltaPct) : '—'}
        </span>
        {comparisonLabel ? (
          <span className="text-muted-foreground font-normal">
            {comparisonLabel}
          </span>
        ) : null}
      </span>
    </SkeletonBox>
  );
}
