import { Button } from '@tale/ui/button';
import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader as SiteHeaderShell } from '@tale/ui/site-header';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { DOCS_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';

interface NavItem {
  key: 'platform' | 'pricing' | 'hardware';
  to: '/' | '/pricing' | '/hardware-pricing';
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'platform', to: '/' },
  { key: 'pricing', to: '/pricing' },
  { key: 'hardware', to: '/hardware-pricing' },
] as const;

export function SiteHeader() {
  const { t } = useT('nav');

  const desktopNav = NAV_ITEMS.map((item) => (
    <LocalizedLink
      key={item.key}
      to={item.to}
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
        className="text-fg-muted hover:text-fg-base text-sm"
      >
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          {t('readDocs')}
        </a>
      </Button>
      <Button asChild className="text-sm">
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
