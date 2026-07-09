import { Button } from '@tale/ui/button';
import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader as SiteHeaderShell } from '@tale/ui/site-header';

import { GithubIcon } from '@/app/components/icons/github-icon';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { DOCS_URL } from '@/lib/docs-url';
import { EXTERNAL_LINKS } from '@/lib/external-links';
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
  const { t: tFooter } = useT('footer');

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
      {/* Open source up front — the repo is a primary destination. */}
      <a
        href={EXTERNAL_LINKS.github}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={tFooter('githubAriaLabel')}
        className="text-fg-muted hover:text-fg-base flex size-8 items-center justify-center rounded-md transition-colors"
      >
        <GithubIcon className="size-4.5" />
      </a>
      <Button
        asChild
        variant="secondary"
        className="text-fg-muted hover:text-fg-base text-sm"
      >
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          {t('readDocs')}
        </a>
      </Button>
      <Button
        asChild
        className="bg-brand-base hover:bg-brand-strong text-brand-fg border-transparent text-sm"
      >
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
