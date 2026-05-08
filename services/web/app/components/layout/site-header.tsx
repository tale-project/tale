import { Button } from '@tale/ui/button';
import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader as SiteHeaderShell } from '@tale/webui/layout/site-header';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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

  const desktopNav = NAV_ITEMS.map((item) => (
    <LocalizedLink
      key={item.key}
      to={item.to}
      hash={item.hash}
      className="text-fg-muted hover:text-fg-base text-sm transition-colors"
    >
      {t(item.key)}
    </LocalizedLink>
  ));

  const desktopActions = (
    <>
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
        <LocalizedLink to="/request-demo">{t('requestDemo')}</LocalizedLink>
      </Button>
    </>
  );

  const mobileNav = (
    <>
      {NAV_ITEMS.map((item) => (
        <LocalizedLink
          key={item.key}
          to={item.to}
          hash={item.hash}
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
          >
            {t('readDocs')}
          </a>
        </Button>
        <Button asChild fullWidth>
          <LocalizedLink to="/request-demo">{t('requestDemo')}</LocalizedLink>
        </Button>
      </div>
    </>
  );

  return (
    <SiteHeaderShell
      openMenuLabel={t('openMenu')}
      closeMenuLabel={t('closeMenu')}
      logo={
        <LocalizedLink
          to="/"
          aria-label={t('homeAriaLabel')}
          className="text-fg-base"
        >
          <TaleLogo />
        </LocalizedLink>
      }
      desktopNav={desktopNav}
      desktopActions={desktopActions}
      mobileNav={mobileNav}
    />
  );
}
