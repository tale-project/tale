'use client';

import { cn } from '../../lib/cn';

interface SparklineProps {
  /** Series of values, oldest → newest. */
  data: number[];
  width?: number;
  height?: number;
  /** Stroke color — defaults to the categorical chart-1 token. */
  color?: string;
  /** Fill the area under the line with a faint tint of the stroke color. */
  filled?: boolean;
  /**
   * Accessible label. When provided the SVG is exposed to screen readers as an
   * image; otherwise it is decorative (`aria-hidden`) — pair it with a visible
   * value (e.g. inside a `MetricCard`).
   */
  'aria-label'?: string;
  className?: string;
}

/**
 * A tiny inline trend line — pure SVG, no charting dependency, so it stays
 * cheap and embeddable (e.g. in a `MetricCard`). Normalizes the series to its
 * own min/max and draws a single polyline; with `filled` it adds a soft area.
 */
export function Sparkline({
  data,
  width = 72,
  height = 22,
  color = 'var(--color-chart-1)',
  filled = false,
  'aria-label': ariaLabel,
  className,
}: SparklineProps) {
  const pad = 1.5; // keep the stroke off the edges
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  // Need at least two points to draw a line.
  const points =
    data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [];
  const min = points.length ? Math.min(...points) : 0;
  const max = points.length ? Math.max(...points) : 0;
  const range = max - min || 1; // avoid /0 on a flat series

  const coords = points.map((v, i) => {
    const x =
      pad + (points.length === 1 ? 0 : (i / (points.length - 1)) * usableW);
    // Invert Y so larger values sit higher.
    const y = pad + (1 - (v - min) / range) * usableH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = coords.join(' ');
  const areaPath = coords.length
    ? `${pad},${height - pad} ${linePath} ${width - pad},${height - pad}`
    : '';

  const decorative = !ariaLabel;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role={decorative ? undefined : 'img'}
      aria-label={ariaLabel}
      aria-hidden={decorative || undefined}
      preserveAspectRatio="none"
    >
      {coords.length > 0 && (
        <>
          {filled && (
            <polygon
              points={areaPath}
              fill={color}
              fillOpacity={0.12}
              stroke="none"
            />
          )}
          <polyline
            points={linePath}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
