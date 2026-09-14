import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

const SCROLL_THRESHOLD_PX = 600;

/**
 * Floating "back to top" control. Appears (fades in) once the page has been
 * scrolled more than {@link SCROLL_THRESHOLD_PX}px. Clicking smooth-scrolls
 * the window back to the top.
 *
 * Mounted once at the root layout (outside `<main>`) so it stays available on
 * every docs page. Uses `z-30`, which sits below the drawer / search dialog
 * (`z-50`) — those overlays cover it naturally without extra hide logic.
 */
export function ScrollToTop() {
  const { t } = useT('docs');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > SCROLL_THRESHOLD_PX);
    };
    // Initialise on mount in case the page loads already scrolled (e.g. on
    // hash navigation or browser-restored scroll position).
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <IconButton
      icon={ArrowUp}
      variant="secondary"
      aria-label={t('backToTop')}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: reducedMotion ? 'instant' : 'smooth',
        })
      }
      className={cn(
        'fixed right-6 bottom-6 z-30 rounded-full transition-opacity duration-200 motion-reduce:transition-none print:hidden',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    />
  );
}
