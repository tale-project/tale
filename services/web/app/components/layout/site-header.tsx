import { Button } from '@tale/ui/button';
import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader as SiteHeaderShell } from '@tale/webui/layout/site-header';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { useT } from '@/lib/i18n/client';

// Vite injects VITE_DOCS_URL at build time. Defaults to the canonical
// docs.tale.dev origin; can be overridden (e.g. https://tale.dev/docs)
// for path-based deployments where docs ship under the marketing domain.
const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'https://docs.tale.dev';

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
      <Button
        asChild
        variant="secondary"
        size="sm"
        className="text-fg-muted hover:text-fg-base text-sm"
      >
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          {t('readDocs')}
        </a>
      </Button>
      <Button asChild size="sm" className="text-sm">
        <LocalizedLink to="/request-demo">{t('requestDemo')}</LocalizedLink>
      </Button>
    </>
  );

  const mobileNav = (
    <div className="flex flex-col gap-6">
      {NAV_ITEMS.map((item) => (
        <LocalizedLink
          key={item.key}
          to={item.to}
          hash={item.hash}
          className="text-fg-base text-2xl font-semibold tracking-tight transition-colors"
        >
          {t(item.key)}
        </LocalizedLink>
      ))}
      <Button asChild variant="secondary" fullWidth>
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          {t('readDocs')}
        </a>
      </Button>
      <Button asChild fullWidth>
        <LocalizedLink to="/request-demo">{t('requestDemo')}</LocalizedLink>
      </Button>
    </div>
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
