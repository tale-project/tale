import { useMediaQuery } from './use-media-query';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Mobile-first breakpoint hook keyed to the Tailwind 4 default scale:
 *   mobile  : `< 768px`  (below `md`)
 *   tablet  : `768px – 1024px` (`md` up to but not including `lg`)
 *   desktop : `≥ 1024px` (from `lg` up)
 */
export function useBreakpoint(): Breakpoint {
  const isTabletOrUp = useMediaQuery('(min-width: 768px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  if (isDesktop) return 'desktop';
  if (isTabletOrUp) return 'tablet';
  return 'mobile';
}
