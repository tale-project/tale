import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import { Sheet } from '@tale/ui/sheet';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useReducedMotion } from '../../lib/entrance';
import { SiteContainer } from './site-container';

const easeOut = [0.22, 1, 0.36, 1] as const;

const MENU_BUTTON_CLASS =
  'text-fg-base border-border-base/70 hover:bg-surface-site-inset focus-visible:ring-accent-base inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none';

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
    <motion.span
      aria-hidden
      initial={false}
      animate={{ rotate: open ? 90 : 0 }}
      transition={transition}
      className="relative size-5"
    >
      <Menu
        className={cn('absolute inset-0 size-5', open && 'opacity-0')}
        strokeWidth={1.5}
      />
      <X
        className={cn('absolute inset-0 size-5', !open && 'opacity-0')}
        strokeWidth={1.5}
      />
    </motion.span>
  );
}

/** Mount inside the Sheet portal so its link listener follows that lifecycle. */
function MobileMenuContents({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a')) {
        onNavigate();
      }
    };
    content.addEventListener('click', onClick);
    return () => content.removeEventListener('click', onClick);
  }, [onNavigate]);

  return (
    <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

interface SiteHeaderProps {
  /** The logo link element. Caller wires routing — this slot just renders. */
  logo: ReactNode;
  /** Centered nav (desktop). Hidden on mobile; the drawer carries its own. */
  desktopNav?: ReactNode;
  /** Trailing slot on desktop (CTAs, search button, etc.). */
  desktopActions?: ReactNode;
  /** Actions beside the mobile menu button, such as documentation search. */
  mobileActions?: ReactNode;
  /** Body of the mobile navigation sheet. */
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
   * uses the marketing-site frame; docs
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
 * Sticky top navigation shell of the marketing site.
 *
 * Owns scroll-based transparent → tinted blur transition, mobile burger
 * animation and mobile sheet state. The shared Sheet owns focus containment,
 * scroll-lock, Escape/outside dismissal and focus restoration. The slots
 * (`logo`, `desktopNav`, `desktopActions`, `mobileNav`) are pure render
 * input — routing, link components and i18n stay in the caller so this
 * shell is framework-neutral.
 *
 * The mobile sheet enters with a short transform/fade and closes when the
 * desktop navigation appears. At the top of the page the bar is transparent
 * with a light bottom border; scroll adds the
 * tinted blur surface. The marketing root paints `bg-gradient-site-hero`
 * behind the header so the wash is continuous (no flat `surface-site` seam).
 */
export function SiteHeader({
  logo,
  desktopNav,
  desktopActions,
  mobileActions,
  mobileNav,
  openMenuLabel,
  closeMenuLabel,
  mobileNavId = 'mobile-nav',
  onOpenChange,
  containerClassName,
  surface = 'base',
}: SiteHeaderProps) {
  const reduceMotion = useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const desktopFocusRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasMobileNav = Boolean(mobileNav);
  const menuOpen = open && !isDesktop && hasMobileNav;
  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    onOpenChange?.(menuOpen);
  }, [menuOpen, onOpenChange]);

  // Unmounting the now-hidden opener lets Sheet restore focus to the visible
  // logo link. Reset state too, so returning to phone width cannot reopen it.
  useEffect(() => {
    desktopFocusRef.current =
      logoRef.current?.querySelector<HTMLElement>('a, button') ?? null;
    if (isDesktop || !hasMobileNav) setOpen(false);
  }, [isDesktop, hasMobileNav]);

  // Marketing pages paint `surface-site` (cool stone paper); docs stay on `bg-base`.
  // Using the wrong token makes the sticky bar read as a cold strip over the hero.
  // Top of page stays transparent so the hero shows through; scroll adds tint + blur.
  const solidBg = surface === 'site' ? 'bg-surface-site' : 'bg-bg-base';
  const scrolledBg =
    surface === 'site'
      ? 'bg-surface-site/95 supports-[backdrop-filter]:bg-surface-site/85'
      : 'bg-bg-base/95 supports-[backdrop-filter]:bg-bg-base/85';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b pt-(--safe-top) pr-(--safe-right) pl-(--safe-left) transition-colors duration-200 motion-reduce:transition-none print:hidden',
        scrolled
          ? cn('border-border-base/70 backdrop-blur-xl', scrolledBg)
          : 'border-border-base/40 bg-transparent',
      )}
    >
      <SiteContainer className={containerClassName}>
        <div className="flex h-16 items-center justify-between gap-4 lg:grid lg:h-18 lg:grid-cols-[1fr_auto_1fr]">
          <div ref={logoRef} className="lg:justify-self-start">
            {logo}
          </div>

          {desktopNav ? (
            <nav className="hidden items-center gap-1 lg:flex lg:justify-self-center">
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
            {mobileActions ? (
              <div className="flex items-center gap-2 lg:hidden">
                {mobileActions}
              </div>
            ) : null}
            {hasMobileNav && !isDesktop ? (
              <button
                type="button"
                aria-label={menuOpen ? closeMenuLabel : openMenuLabel}
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                aria-controls={menuOpen ? mobileNavId : undefined}
                className={cn(MENU_BUTTON_CLASS, 'lg:hidden')}
                onClick={() => setOpen((prev) => !prev)}
              >
                <BurgerIcon open={menuOpen} reduceMotion={reduceMotion} />
              </button>
            ) : null}
          </div>
        </div>
      </SiteContainer>

      {/* Unmount the portal at the breakpoint. CSS-hiding an exiting Sheet
          can cancel animationend and leave Radix Presence holding aria-hidden
          on the rest of the page indefinitely. */}
      {hasMobileNav && !isDesktop ? (
        <Sheet
          open={menuOpen}
          onOpenChange={setOpen}
          side="top"
          title={openMenuLabel}
          hideClose
          restoreFocusRef={desktopFocusRef}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
          className={cn(
            'border-border-base/70 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 flex h-auto max-h-dvh flex-col gap-0 overflow-hidden rounded-b-2xl p-0 pt-(--safe-top) pr-(--safe-right) pl-(--safe-left) data-[state=closed]:duration-150 data-[state=open]:duration-200',
            solidBg,
          )}
        >
          <MobileMenuContents onNavigate={closeMenu}>
            <div className="border-border-base/70 shrink-0 border-b">
              <SiteContainer className={containerClassName}>
                <div className="flex h-16 items-center justify-between gap-4">
                  {logo}
                  <button
                    ref={closeRef}
                    type="button"
                    aria-label={closeMenuLabel}
                    className={MENU_BUTTON_CLASS}
                    onClick={closeMenu}
                  >
                    <BurgerIcon open reduceMotion={reduceMotion} />
                  </button>
                </div>
              </SiteContainer>
            </div>
            <nav
              id={mobileNavId}
              className="min-h-0 overflow-y-auto overscroll-contain pb-(--safe-bottom)"
            >
              <SiteContainer className={containerClassName}>
                <div className="flex flex-col gap-2 py-5">{mobileNav}</div>
              </SiteContainer>
            </nav>
          </MobileMenuContents>
        </Sheet>
      ) : null}
    </header>
  );
}

export { TaleLogo };
