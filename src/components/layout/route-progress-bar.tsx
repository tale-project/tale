'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const REVEAL_DELAY_MS = 150;

/**
 * Indeterminate top-of-viewport progress bar shown during blocking route
 * transitions (awaited loaders). Wait before revealing it so instant/warm
 * navigations never flash it; hide immediately when the transition ends.
 *
 * a11y: `role=progressbar` with a translated label; under reduced motion the
 * sweep is replaced by a static full-width bar.
 */
export function RouteProgressBar() {
  const { t } = useT('common');
  const isNavigating = useRouterState({
    select: (state) => state.status === 'pending',
  });
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!isNavigating) {
      setDelayElapsed(false);
      return undefined;
    }

    const timer = setTimeout(() => setDelayElapsed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isNavigating]);

  const isVisible = isNavigating && delayElapsed;

  return (
    <div
      aria-hidden={!isVisible}
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5',
        'transition-opacity duration-150 motion-reduce:transition-none',
        isVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {isVisible && (
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
