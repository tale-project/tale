import { useMediaQuery } from '@tale/ui/use-media-query';

/**
 * Whether a chart may play its entry animation: never for a reader who asked
 * the system to reduce motion. Recharts animates its series in JavaScript, so
 * neither the stylesheet's reduced-motion rules nor a frozen CSS animation
 * stops it — each series takes this answer as `isAnimationActive`, and a
 * reduced-motion reader sees the final figures at once.
 */
export function useChartAnimation(): boolean {
  return !useMediaQuery('(prefers-reduced-motion: reduce)');
}
