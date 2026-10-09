import { SiteHeader as SiteHeaderShell } from '@tale/marketing-ui/site-header';
import { TaleLogo } from '@tale/ui/logo';
import { useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { GithubLink } from '@/app/components/layout/github-link';
import {
  NavMenu,
  type NavMenuItemView,
} from '@/app/components/layout/nav-menu';
import {
  MarketingButton,
  MarketingExternalLink,
  MarketingLink,
} from '@/app/components/marketing';
import {
  buildPlatformNavItems,
  buildResourcesNavItems,
} from '@/app/content/nav-items';
import { COMPARISON_NAV_ITEM, type NavMenuId } from '@/app/content/nav-menus';
import { getPlatformIcon, getPlatformPage } from '@/app/content/platform-pages';
import { HEADER_PRIMARY_CTA } from '@/app/content/site-ctas';
import { getStartedUrl } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

export function SiteHeader() {
  const { t } = useT('nav');
  const { t: tFooter } = useT('footer');
  const locale = useCurrentLocale();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [openMenu, setOpenMenu] = useState<NavMenuId | null>(null);

  const setMenuOpen = useCallback((id: NavMenuId, open: boolean) => {
    // Only clear when this menu is the one closing — a delayed hover-leave
    // must not wipe a sibling that already took focus.
    setOpenMenu((prev) => {
      if (open) return id;
      return prev === id ? null : prev;
    });
  }, []);

  const platformRows = useMemo(() => buildPlatformNavItems(), []);
  const resourcesRows = useMemo(() => buildResourcesNavItems(locale), [locale]);
  const platformPage = getPlatformPage('hub');
  const platformPath = localizedPath(locale, platformPage.path);
  const platformActive =
    pathname === platformPath || pathname.startsWith(`${platformPath}/`);
  const platformOverview: NavMenuItemView = {
    id: platformPage.id,
    path: platformPage.path,
    label: t('product.hub.label'),
    description: t('product.hub.description'),
    icon: getPlatformIcon('hub'),
  };

  const platformItems: NavMenuItemView[] = platformRows.map((row) => ({
    id: row.id,
    path: row.path,
    label: t(`product.${row.navKey}.label`),
    description: t(`product.${row.navKey}.description`),
    icon: row.icon,
  }));

  const resourcesItems: NavMenuItemView[] = resourcesRows.map((row) => ({
    id: row.id,
    path: row.path,
    href: row.href,
    label: t(row.labelKey),
    description: t(row.descriptionKey),
    icon: row.icon,
  }));

  const desktopNav = (
    <>
      <NavMenu
        label={t('platform')}
        open={openMenu === 'platform'}
        onOpenChange={(open) => setMenuOpen('platform', open)}
        active={platformActive}
        overview={platformOverview}
        items={platformItems}
      />
      {COMPARISON_NAV_ITEM ? (
        <MarketingLink
          to={COMPARISON_NAV_ITEM.path}
          tone="nav"
          active
          className="min-h-11"
        >
          {t(COMPARISON_NAV_ITEM.labelKey)}
        </MarketingLink>
      ) : null}
      <MarketingLink to="/pricing" tone="nav" active className="min-h-11">
        {t('pricing')}
      </MarketingLink>
      <NavMenu
        label={t('resources')}
        open={openMenu === 'resources'}
        onOpenChange={(open) => setMenuOpen('resources', open)}
        items={resourcesItems}
      />
    </>
  );

  const githubLabel = tFooter('githubAriaLabel');
  const getStartedLabel = t(HEADER_PRIMARY_CTA.labelKey);
  const getStartedHref = getStartedUrl(locale);

  return (
    <SiteHeaderShell
      surface="site"
      openMenuLabel={t('openMenu')}
      closeMenuLabel={t('closeMenu')}
      logo={
        <MarketingLink
          to="/"
          tone="plain"
          activeOptions={{ exact: true, includeSearch: false }}
          aria-label={t('homeAriaLabel')}
          className="text-fg-base"
        >
          <TaleLogo />
        </MarketingLink>
      }
      desktopNav={desktopNav}
      desktopActions={
        <HeaderActions
          layout="desktop"
          getStartedLabel={getStartedLabel}
          getStartedHref={getStartedHref}
          githubLabel={githubLabel}
        />
      }
      mobileNav={
        <div className="[&_a[aria-current=page]]:bg-surface-site-inset [&_a]:hover:bg-surface-site-inset/70 flex flex-col gap-5">
          <div className="border-border-base grid grid-cols-2 gap-1 border-b pb-3">
            {COMPARISON_NAV_ITEM ? (
              <MarketingLink
                to={COMPARISON_NAV_ITEM.path}
                tone="navMobile"
                active
                className="rounded-lg px-2 text-base"
              >
                {t(COMPARISON_NAV_ITEM.labelKey)}
              </MarketingLink>
            ) : null}
            <MarketingLink
              to="/pricing"
              tone="navMobile"
              active
              className="rounded-lg px-2 text-base"
            >
              {t('pricing')}
            </MarketingLink>
          </div>
          <MobileNavGroup label={t('platform')}>
            <li className="col-span-full">
              <MarketingLink
                to={platformPage.path}
                tone="navMobile"
                active
                activeOptions={{ exact: true, includeSearch: false }}
                className="rounded-lg px-2 text-base"
              >
                {t('product.hub.label')}
              </MarketingLink>
            </li>
            {platformRows.map((row) => (
              <li key={row.id}>
                <MarketingLink
                  to={row.path}
                  tone="navMobile"
                  active
                  className="rounded-lg px-2 text-base"
                >
                  {t(`product.${row.navKey}.label`)}
                </MarketingLink>
              </li>
            ))}
          </MobileNavGroup>

          <MobileNavGroup label={t('resources')}>
            {resourcesRows.map((row) => (
              <li key={row.id}>
                {'href' in row && row.href ? (
                  <MarketingExternalLink
                    href={row.href}
                    tone="navMobile"
                    showIcon={false}
                    className="rounded-lg px-2 text-base"
                  >
                    {t(row.labelKey)}
                  </MarketingExternalLink>
                ) : row.path ? (
                  <MarketingLink
                    to={row.path}
                    tone="navMobile"
                    active
                    className="rounded-lg px-2 text-base"
                  >
                    {t(row.labelKey)}
                  </MarketingLink>
                ) : null}
              </li>
            ))}
          </MobileNavGroup>

          <div className="border-border-base flex flex-col gap-3 border-t pt-5 pb-2">
            <HeaderActions
              layout="mobile"
              getStartedLabel={getStartedLabel}
              getStartedHref={getStartedHref}
              githubLabel={githubLabel}
            />
          </div>
        </div>
      }
    />
  );
}

function HeaderActions({
  layout,
  getStartedLabel,
  getStartedHref,
  githubLabel,
}: {
  layout: 'desktop' | 'mobile';
  getStartedLabel: string;
  getStartedHref: string;
  githubLabel: string;
}) {
  const isMobile = layout === 'mobile';

  return (
    <>
      {/* Slot `asChild` must wrap the link directly so button classes merge onto it. */}
      <MarketingButton
        asChild
        fullWidth={isMobile}
        size={isMobile ? 'lg' : 'default'}
      >
        <MarketingExternalLink
          href={getStartedHref}
          tone="plain"
          showIcon={false}
        >
          {getStartedLabel}
        </MarketingExternalLink>
      </MarketingButton>
      <GithubLink label={githubLabel} variant={isMobile ? 'labeled' : 'icon'} />
    </>
  );
}

/** Flat mobile group — always expanded; short lists don't need disclosure. */
function MobileNavGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-fg-muted mb-2 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <ul
        role="list"
        className="grid grid-cols-1 gap-1 min-[360px]:grid-cols-2"
      >
        {children}
      </ul>
    </div>
  );
}
