'use client';

import { useRouterState } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Indeterminate top-of-viewport progress bar shown during blocking route
 * transitions (awaited loaders). Renders nothing when idle, so instant/warm
 * navigations never flash it; fades in only when a transition is pending.
 *
 * a11y: `role=progressbar` with a translated label; under reduced motion the
 * sweep is replaced by a static full-width bar.
 */
export function RouteProgressBar() {
  const { t } = useT('common');
  const isNavigating = useRouterState({
    select: (state) => state.status === 'pending',
  });

  return (
    <div
      aria-hidden={!isNavigating}
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5',
        'transition-opacity duration-150 motion-reduce:transition-none',
        isNavigating ? 'opacity-100' : 'opacity-0',
      )}
    >
      {isNavigating && (
        <div
          role="progressbar"
          aria-busy="true"
          aria-label={t('loading.navigating')}
          className="animate-route-progress bg-primary h-full w-2/5 motion-reduce:w-full"
        />
      )}
    </div>
  );
}
