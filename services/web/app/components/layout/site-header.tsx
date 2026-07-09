import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader as SiteHeaderShell } from '@tale/ui/site-header';
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
import type { NavMenuId } from '@/app/content/nav-menus';
import { HEADER_PRIMARY_CTA } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

export function SiteHeader() {
  const { t } = useT('nav');
  const { t: tFooter } = useT('footer');
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
  const resourcesRows = useMemo(() => buildResourcesNavItems(), []);

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
        items={platformItems}
        columns={1}
      />
      <MarketingLink to="/pricing" tone="nav" active>
        {t('pricing')}
      </MarketingLink>
      <NavMenu
        label={t('resources')}
        open={openMenu === 'resources'}
        onOpenChange={(open) => setMenuOpen('resources', open)}
        items={resourcesItems}
        columns={1}
      />
    </>
  );

  const githubLabel = tFooter('githubAriaLabel');
  const getStartedLabel = t(HEADER_PRIMARY_CTA.labelKey);

  return (
    <SiteHeaderShell
      surface="site"
      openMenuLabel={t('openMenu')}
      closeMenuLabel={t('closeMenu')}
      logo={
        <MarketingLink
          to="/"
          tone="plain"
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
          githubLabel={githubLabel}
        />
      }
      mobileNav={
        <div className="flex flex-col gap-6">
          <MobileNavGroup label={t('platform')}>
            {platformRows.map((row) => (
              <li key={row.id}>
                <MarketingLink to={row.path} tone="navMobile">
                  {t(`product.${row.navKey}.label`)}
                </MarketingLink>
              </li>
            ))}
          </MobileNavGroup>

          <MarketingLink to="/pricing" tone="navMobile">
            {t('pricing')}
          </MarketingLink>

          <MobileNavGroup label={t('resources')}>
            {resourcesRows.map((row) => (
              <li key={row.id}>
                {'href' in row && row.href ? (
                  <MarketingExternalLink
                    href={row.href}
                    tone="navMobile"
                    showIcon={false}
                  >
                    {t(row.labelKey)}
                  </MarketingExternalLink>
                ) : row.path ? (
                  <MarketingLink to={row.path} tone="navMobile">
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
  githubLabel,
}: {
  layout: 'desktop' | 'mobile';
  getStartedLabel: string;
  githubLabel: string;
}) {
  const isMobile = layout === 'mobile';

  return (
    <>
      {/* Slot `asChild` must wrap the link directly so button classes merge onto it. */}
      <MarketingButton asChild fullWidth={isMobile}>
        <MarketingExternalLink
          href={HEADER_PRIMARY_CTA.href}
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
      <ul role="list" className="flex flex-col gap-3">
        {children}
      </ul>
    </div>
  );
}
