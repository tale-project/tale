import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import { Link, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
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
        scrolled
          ? 'border-border-base bg-bg-base/85 supports-[backdrop-filter]:bg-bg-base/65 border-b backdrop-blur'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <SiteContainer>
        <div className="flex h-16 items-center justify-between gap-4 md:grid md:grid-cols-[1fr_auto_1fr]">
          <Link
            to="/"
            aria-label={t('homeAriaLabel')}
            className="text-fg-base md:justify-self-start"
          >
            <TaleLogo />
          </Link>

          <nav
            aria-label={t('ariaLabel')}
            className="hidden items-center gap-12 md:flex md:justify-self-center"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                hash={item.hash}
                className="text-fg-muted hover:text-fg-base text-sm transition-colors"
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex md:justify-self-end">
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
              <Link to="/request-demo">{t('requestDemo')}</Link>
            </Button>
          </div>

          <button
            type="button"
            aria-label={open ? t('closeMenu') : t('openMenu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="text-fg-base hover:bg-bg-elevated inline-flex h-11 w-11 items-center justify-center rounded-lg md:hidden"
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </SiteContainer>

      <AnimatePresence>
        {open ? (
          <motion.nav
            id="mobile-nav"
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
            }
            aria-label={t('ariaLabel')}
            className="border-border-base bg-bg-base border-t md:hidden"
          >
            <SiteContainer>
              <div className="flex flex-col gap-2 py-6">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.key}
                    to={item.to}
                    hash={item.hash}
                    onClick={() => setOpen(false)}
                    className="text-fg-base hover:bg-bg-elevated rounded-md px-3 py-3 text-base font-medium"
                  >
                    {t(item.key)}
                  </Link>
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
                    <Link to="/request-demo" onClick={() => setOpen(false)}>
                      {t('requestDemo')}
                    </Link>
                  </Button>
                </div>
              </div>
            </SiteContainer>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
