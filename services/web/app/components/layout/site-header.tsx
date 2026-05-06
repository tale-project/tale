import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import { useRouterState } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

interface NavItem {
  key: 'features' | 'pricing';
  to: '/' | '/pricing';
  hash?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'features', to: '/', hash: 'features' },
  { key: 'pricing', to: '/pricing' },
] as const;

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

export function SiteHeader() {
  const { t } = useT('nav');
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
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
  }, [open]);

  // After client-side hash navigation, ensure smooth scroll to the target.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [pathname]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-300',
        open
          ? 'border-border-base bg-bg-base border-b'
          : scrolled
            ? 'border-border-base bg-bg-base/85 supports-[backdrop-filter]:bg-bg-base/65 border-b backdrop-blur'
            : 'border-b border-transparent bg-transparent',
      )}
    >
      <SiteContainer>
        <div className="flex h-16 items-center justify-between gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <LocalizedLink
            to="/"
            aria-label={t('homeAriaLabel')}
            className="text-fg-base lg:justify-self-start"
          >
            <TaleLogo />
          </LocalizedLink>

          <nav
            aria-label={t('ariaLabel')}
            className="hidden items-center gap-12 lg:flex lg:justify-self-center"
          >
            {NAV_ITEMS.map((item) => (
              <LocalizedLink
                key={item.key}
                to={item.to}
                hash={item.hash}
                className="text-fg-muted hover:text-fg-base text-sm transition-colors"
              >
                {t(item.key)}
              </LocalizedLink>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex lg:justify-self-end">
            <Button asChild variant="secondary" size="sm">
              <a
                href="https://docs.tale.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('readDocs')}
              </a>
            </Button>
            <Button asChild size="sm">
              <LocalizedLink to="/request-demo">
                {t('requestDemo')}
              </LocalizedLink>
            </Button>
          </div>

          <button
            type="button"
            aria-label={open ? t('closeMenu') : t('openMenu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="text-fg-base hover:bg-bg-muted inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors lg:hidden"
            onClick={() => setOpen((prev) => !prev)}
          >
            <BurgerIcon open={open} reduceMotion={reduceMotion} />
          </button>
        </div>
      </SiteContainer>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            id="mobile-nav"
            key="mobile-nav"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={
              reduceMotion
                ? { height: 'auto', opacity: 1 }
                : { height: 0, opacity: 0 }
            }
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.28, ease: easeOut }
            }
            aria-label={t('ariaLabel')}
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
              >
                {NAV_ITEMS.map((item) => (
                  <LocalizedLink
                    key={item.key}
                    to={item.to}
                    hash={item.hash}
                    onClick={() => setOpen(false)}
                    className="text-fg-base hover:bg-bg-muted rounded-md px-3 py-3 text-base font-medium transition-colors"
                  >
                    {t(item.key)}
                  </LocalizedLink>
                ))}
                <div className="mt-2 flex flex-col gap-2">
                  <Button asChild variant="secondary" fullWidth>
                    <a
                      href="https://docs.tale.dev"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpen(false)}
                    >
                      {t('readDocs')}
                    </a>
                  </Button>
                  <Button asChild fullWidth>
                    <LocalizedLink
                      to="/request-demo"
                      onClick={() => setOpen(false)}
                    >
                      {t('requestDemo')}
                    </LocalizedLink>
                  </Button>
                </div>
              </motion.div>
            </SiteContainer>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
