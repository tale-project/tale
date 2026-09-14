import { MarketingExternalLink } from '@tale/marketing-ui/external-link';
import { MarketingLink } from '@tale/marketing-ui/link';
import { SiteContainer } from '@tale/marketing-ui/site-container';
import { SiteHeader } from '@tale/marketing-ui/site-header';
import { TaleLogo } from '@tale/ui/logo';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';
import { Link } from '@tanstack/react-router';

import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { TALE_REPO_URL } from '@/lib/site-url';

const COMPONENTS_SLUG = 'components/button';

/**
 * The marketing chrome for the front page. `SiteHeader` is slot-driven, so
 * routing and copy stay here; `SiteFooter` is deliberately NOT used — it
 * always renders the shared `LanguageSwitcher`, whose links go to `/de` and
 * `/fr`, and this site ships English only. A compact bar built on
 * `SiteContainer` keeps the same frame without the dead links.
 */
export function SiteHeaderBar() {
  const { t } = useT('nav');
  const docsHref = docPath(firstNavSlug());

  return (
    <SiteHeader
      surface="site"
      openMenuLabel={t('openMenu')}
      closeMenuLabel={t('closeMenu')}
      logo={
        <Link
          to="/"
          aria-label={t('homeAriaLabel')}
          className="text-fg-base focus-visible:ring-fg-base/60 inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
      }
      desktopNav={
        <>
          <MarketingLink to={docsHref} tone="nav">
            {t('docs')}
          </MarketingLink>
          <MarketingLink to={docPath(COMPONENTS_SLUG)} tone="nav">
            {t('components')}
          </MarketingLink>
          <MarketingExternalLink
            href={TALE_REPO_URL}
            tone="nav"
            showIcon={false}
          >
            {t('github')}
          </MarketingExternalLink>
        </>
      }
      desktopActions={<ThemeSwitcher variant="segmented" />}
      mobileNav={
        <>
          <MarketingLink to={docsHref} tone="navMobile">
            {t('docs')}
          </MarketingLink>
          <MarketingLink to={docPath(COMPONENTS_SLUG)} tone="navMobile">
            {t('components')}
          </MarketingLink>
          <MarketingExternalLink
            href={TALE_REPO_URL}
            tone="navMobile"
            showIcon={false}
          >
            {t('github')}
          </MarketingExternalLink>
        </>
      }
    />
  );
}

/** The compact bottom bar: copyright, the llms.txt pointer, the repository. */
export function SiteFooterBar() {
  const { t } = useT('footer');
  const year = String(new Date().getFullYear());

  return (
    <footer className="border-border-base bg-surface-site border-t print:hidden">
      <SiteContainer>
        <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-fg-muted text-sm">
            <p>{t('copyrightLine1', { year })}</p>
            <p>{t('copyrightLine2')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <MarketingExternalLink
              href="/llms.txt"
              tone="footer"
              showIcon={false}
            >
              {t('llmsTxt')}
            </MarketingExternalLink>
            <MarketingExternalLink
              href={TALE_REPO_URL}
              tone="footer"
              showIcon={false}
            >
              {t('github')}
            </MarketingExternalLink>
          </div>
        </div>
      </SiteContainer>
    </footer>
  );
}
