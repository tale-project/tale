import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import { motion, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';

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
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: easeOut };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <motion.line
        initial={false}
        animate={
          open
            ? { x1: 6, y1: 6, x2: 18, y2: 18 }
            : { x1: 4, y1: 8, x2: 20, y2: 8 }
        }
        transition={transition}
      />
      <motion.line
        initial={false}
        animate={
          open
            ? { x1: 4, y1: 12, x2: 20, y2: 12, opacity: 0 }
            : { x1: 4, y1: 12, x2: 20, y2: 12, opacity: 1 }
        }
        transition={transition}
      />
      <motion.line
        initial={false}
        animate={
          open
            ? { x1: 6, y1: 18, x2: 18, y2: 6 }
            : { x1: 4, y1: 16, x2: 20, y2: 16 }
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
  /**
   * Override the inner content-width container. The default `SiteContainer`
   * uses the marketing-site frame (max-w-[1280px], px-20 on desktop); docs
   * pages need a wider, less-padded frame to align with the sidebar. Pass a
   * custom className to opt out of the marketing defaults.
   */
  containerClassName?: string;
  /**
   * Scrolled / open surface token. Marketing uses `site` so the sticky bar
   * matches cool stone `surface-site` heroes; docs keeps the default `base`.
   */
  surface?: 'base' | 'site';
}

/**
 * Sticky top navigation shell shared by the marketing site and the docs.
 *
 * Owns scroll-based transparent → tinted blur transition, mobile burger
 * animation, drawer state with scroll-lock, and Esc-to-close. The slots
 * (`logo`, `desktopNav`, `desktopActions`, `mobileNav`) are pure render
 * input — routing, link components and i18n stay in the caller so this
 * shell is framework-neutral.
 *
 * Mobile drawer uses CSS `grid-template-rows` (0fr → 1fr) instead of
 * animating `height: auto`, which avoids measure jank. At the top of the
 * page the bar is transparent with a light bottom border; scroll adds the
 * tinted blur surface. The marketing root paints `bg-gradient-site-hero`
 * behind the header so the wash is continuous (no flat `surface-site` seam).
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
  containerClassName,
  surface = 'base',
}: SiteHeaderProps) {
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);

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

  // Close the drawer when a link inside it is activated. Attached via
  // addEventListener so the nav stays a landmark without a React onClick
  // (jsx-a11y treats click-on-nav as a non-interactive control).
  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return undefined;
    const onClick = (event: MouseEvent) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- event.target is an Element inside the drawer
      const target = event.target as Element | null;
      if (target?.closest('a')) setOpen(false);
    };
    nav.addEventListener('click', onClick);
    return () => nav.removeEventListener('click', onClick);
  }, []);

  const hasMobileNav = Boolean(mobileNav);
  // Marketing pages paint `surface-site` (cool stone paper); docs stay on `bg-base`.
  // Using the wrong token makes the sticky bar read as a cold strip over the hero.
  // Top of page stays transparent so the hero shows through; scroll adds tint + blur.
  const solidBg = surface === 'site' ? 'bg-surface-site' : 'bg-bg-base';
  const scrolledBg =
    surface === 'site'
      ? 'bg-surface-site/90 supports-[backdrop-filter]:bg-surface-site/75'
      : 'bg-bg-base/85 supports-[backdrop-filter]:bg-bg-base/65';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-200 print:hidden',
        open
          ? cn('border-border-base border-b', solidBg)
          : scrolled
            ? cn('border-border-base border-b backdrop-blur', scrolledBg)
            : 'border-border-base/40 border-b bg-transparent',
      )}
    >
      <SiteContainer className={containerClassName}>
        <div className="flex h-16 items-center justify-between gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div className="lg:justify-self-start">{logo}</div>

          {desktopNav ? (
            <nav className="hidden items-center gap-8 lg:flex lg:justify-self-center">
              {desktopNav}
            </nav>
          ) : (
            <div className="hidden lg:block lg:justify-self-center" />
          )}

          <div className="flex items-center justify-end gap-3 lg:justify-self-end">
            {desktopActions ? (
              <div className="hidden items-center gap-3 lg:flex">
                {desktopActions}
              </div>
            ) : null}
            {hasMobileNav ? (
              <button
                type="button"
                aria-label={open ? closeMenuLabel : openMenuLabel}
                aria-expanded={open}
                aria-controls={mobileNavId}
                className="text-fg-muted hover:text-fg-base -mr-2.5 inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors lg:hidden"
                onClick={() => setOpen((prev) => !prev)}
              >
                <BurgerIcon open={open} reduceMotion={reduceMotion} />
              </button>
            ) : null}
          </div>
        </div>
      </SiteContainer>

      {hasMobileNav ? (
        <div
          className={cn(
            'grid lg:hidden',
            'transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <nav
              ref={mobileNavRef}
              id={mobileNavId}
              aria-hidden={!open}
              inert={!open ? true : undefined}
              className={cn(
                'border-border-base max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t',
                'transition-opacity duration-200 ease-out motion-reduce:transition-none',
                open ? 'opacity-100' : 'opacity-0',
                solidBg,
              )}
            >
              <SiteContainer className={containerClassName}>
                <div className="flex flex-col gap-2 py-6">{mobileNav}</div>
              </SiteContainer>
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export { TaleLogo };
