import { cn } from '@tale/ui/cn';

export interface ProgressBarProps {
  /** Current value, expressed in the range `[min, max]`. */
  value: number;
  /** Lower bound of the value range. Defaults to `0`. */
  min?: number;
  /** Upper bound of the value range. Defaults to `100`. */
  max?: number;
  /**
   * Accessible label describing what the bar represents. If omitted,
   * the consumer is expected to label the bar via `aria-labelledby`
   * on the wrapping element.
   */
  ariaLabel?: string;
  /** Tailwind class for the track (background). Default `bg-gray-200`. */
  trackClassName?: string;
  /** Tailwind class for the fill. Default `bg-blue-600`. */
  fillClassName?: string;
  /** Extra className applied to the outer track element. */
  className?: string;
}

/**
 * Linear progress bar with proper `role="progressbar"` ARIA wiring.
 *
 * The component is purely visual — pass `value` between `min` and `max`,
 * and the fill is rendered as a percentage. Out-of-range values are
 * clamped so a bad input never overflows the track.
 */
export function ProgressBar({
  value,
  min = 0,
  max = 100,
  ariaLabel,
  trackClassName = 'bg-gray-200',
  fillClassName = 'bg-blue-600',
  className,
}: ProgressBarProps) {
  const clamped = Math.max(min, Math.min(max, value));
  const span = max - min;
  const percent = span > 0 ? ((clamped - min) / span) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={ariaLabel}
      className={cn(
        'h-2 overflow-hidden rounded-full',
        trackClassName,
        className,
      )}
    >
      <div
        className={cn('h-full rounded-full', fillClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
