import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

const SCROLL_THRESHOLD_PX = 600;

/**
 * Floating "back to top" button. Appears (fades in) once the page has been
 * scrolled more than {@link SCROLL_THRESHOLD_PX}px. Clicking smooth-scrolls
 * the window back to the top.
 *
 * Mounted once at the root layout (outside `<main>` / `<article>`) so it
 * stays visible across all docs pages. Uses `z-30`, which sits below the
 * mobile drawer / search dialog (`z-50`) — those overlays cover this button
 * naturally without any extra hide logic.
 */
export function ScrollToTop() {
  const { t } = useT('docs');
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

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      aria-label={t('backToTop')}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={handleClick}
      className={`border-border-base bg-bg-base/85 text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/40 fixed right-6 bottom-6 z-30 inline-flex size-10 items-center justify-center rounded-full border shadow-md backdrop-blur transition-opacity duration-200 focus-visible:ring-2 focus-visible:outline-none ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <ArrowUp aria-hidden className="size-4" />
    </button>
  );
}
