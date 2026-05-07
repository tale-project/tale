import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useState } from 'react';

import { SiteContainer } from './site-container';

const easeOut = [0.22, 1, 0.36, 1] as const;

function getScrollbarWidth(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerWidth - document.documentElement.clientWidth;
}

function BurgerIcon({
  open,
  reduceMotion,
}: {
  open: boolean;
  reduceMotion: boolean | null;
}) {
  const duration = reduceMotion ? 0 : 0.25;
  const transition = { duration, ease: easeOut };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
    >
      <motion.line
        initial={{ x1: 3, y1: 6, x2: 17, y2: 6 }}
        animate={
          open
            ? { x1: 4.5, y1: 4.5, x2: 15.5, y2: 15.5 }
            : { x1: 3, y1: 6, x2: 17, y2: 6 }
        }
        transition={transition}
      />
      <motion.line
        initial={{ x1: 3, y1: 10, x2: 17, y2: 10, opacity: 1 }}
        animate={
          open
            ? { x1: 3, y1: 10, x2: 17, y2: 10, opacity: 0 }
            : { x1: 3, y1: 10, x2: 17, y2: 10, opacity: 1 }
        }
        transition={transition}
      />
      <motion.line
        initial={{ x1: 3, y1: 14, x2: 17, y2: 14 }}
        animate={
          open
            ? { x1: 4.5, y1: 15.5, x2: 15.5, y2: 4.5 }
            : { x1: 3, y1: 14, x2: 17, y2: 14 }
        }
        transition={transition}
      />
    </svg>
  );
}

interface SiteHeaderProps {
  /** The logo link element. Caller wires routing — this slot just renders. */
  logo: ReactNode;
  /** Centered nav (desktop). Hidden on mobile; the drawer carries its own. */
  desktopNav?: ReactNode;
  /** Trailing slot on desktop (CTAs, search button, etc.). */
  desktopActions?: ReactNode;
  /** Body of the mobile drawer that slides under the header when open. */
  mobileNav?: ReactNode;
  /** Localized label for the burger button when the drawer is closed. */
  openMenuLabel: string;
  /** Localized label for the burger button when the drawer is open. */
  closeMenuLabel: string;
  /** Optional id for the mobile drawer (aria-controls target). */
  mobileNavId?: string;
  /** Callback fired when the user opens or closes the drawer. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Sticky top navigation shell shared by the marketing site and the docs.
 *
 * Owns scroll-based transparent → blurred transition, mobile burger
 * animation, drawer state with scroll-lock, and Esc-to-close. The slots
 * (`logo`, `desktopNav`, `desktopActions`, `mobileNav`) are pure render
 * input — routing, link components and i18n stay in the caller so this
 * shell is framework-neutral.
 */
export function SiteHeader({
  logo,
  desktopNav,
  desktopActions,
  mobileNav,
  openMenuLabel,
  closeMenuLabel,
  mobileNavId = 'mobile-nav',
  onOpenChange,
}: SiteHeaderProps) {
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    if (open) {
      const scrollbarWidth = getScrollbarWidth();
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [open, onOpenChange]);

  const hasMobileNav = Boolean(mobileNav);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-300 print:hidden',
        open
          ? 'border-border-base bg-bg-base border-b'
          : scrolled
            ? 'border-border-base bg-bg-base/85 supports-[backdrop-filter]:bg-bg-base/65 border-b backdrop-blur'
            : 'border-b border-transparent bg-transparent',
      )}
    >
      <SiteContainer>
        <div className="flex h-16 items-center justify-between gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div className="lg:justify-self-start">{logo}</div>

          {desktopNav ? (
            <nav className="hidden items-center gap-12 lg:flex lg:justify-self-center">
              {desktopNav}
            </nav>
          ) : (
            <div className="hidden lg:block lg:justify-self-center" />
          )}

          {desktopActions ? (
            <div className="hidden items-center gap-2 lg:flex lg:justify-self-end">
              {desktopActions}
            </div>
          ) : (
            <div className="hidden lg:block lg:justify-self-end" />
          )}

          {hasMobileNav ? (
            <button
              type="button"
              aria-label={open ? closeMenuLabel : openMenuLabel}
              aria-expanded={open}
              aria-controls={mobileNavId}
              className="text-fg-base hover:bg-bg-muted inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors lg:hidden"
              onClick={() => setOpen((prev) => !prev)}
            >
              <BurgerIcon open={open} reduceMotion={reduceMotion} />
            </button>
          ) : null}
        </div>
      </SiteContainer>

      {hasMobileNav ? (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.nav
              id={mobileNavId}
              key="mobile-nav"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={
                reduceMotion
                  ? { height: 'auto', opacity: 1 }
                  : { height: 0, opacity: 0 }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: easeOut }
              }
              className="border-border-base bg-bg-base overflow-hidden border-t lg:hidden"
            >
              <SiteContainer>
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }
                  }
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.2, ease: easeOut, delay: 0.05 }
                  }
                  className="flex flex-col gap-2 py-6"
                  onClick={(event) => {
                    // Auto-close on link click. Bubbles up from any anchor in
                    // the drawer body so callers don't need to wire it.
                    const target = event.target as HTMLElement | null;
                    if (target?.closest('a')) setOpen(false);
                  }}
                >
                  {mobileNav}
                </motion.div>
              </SiteContainer>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      ) : null}
    </header>
  );
}

export { TaleLogo };
