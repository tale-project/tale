import { TaleLogo } from '@tale/ui/logo';
import {
  type FooterColumn,
  SiteFooter as SiteFooterShell,
} from '@tale/ui/site-footer';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { GithubLink } from '@/app/components/layout/github-link';
import type { LocalizedRoutePath } from '@/app/components/layout/localized-link';
import {
  MarketingExternalLink,
  MarketingLink,
} from '@/app/components/marketing';
import { FOOTER_PLATFORM_PAGES } from '@/app/content/platform-pages';
import { FOOTER_COMPANY_CTAS } from '@/app/content/site-ctas';
import { DOCS_URL } from '@/lib/docs-url';
import { EXTERNAL_LINKS } from '@/lib/external-links';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import type { LegalSlug } from '@/lib/legal/slugs';

function RouteLink({
  to,
  children,
}: {
  to: LocalizedRoutePath;
  children: ReactNode;
}) {
  return (
    <MarketingLink to={to} tone="footer">
      {children}
    </MarketingLink>
  );
}

function LegalLink({
  slug,
  children,
}: {
  slug: LegalSlug;
  children: ReactNode;
}) {
  const locale = useCurrentLocale();
  return (
    <Link
      to={locale === 'en' ? '/legal/$slug' : '/$lang/legal/$slug'}
      params={locale === 'en' ? { slug } : { lang: locale, slug }}
      className="text-fg-muted hover:text-fg-base text-sm transition-colors"
    >
      {children}
    </Link>
  );
}

/**
 * Marketing footer — Platform · Resources · Company · Legal, with the
 * company address as a fifth column that wraps under Platform. GitHub
 * sits in the bottom bar after the theme picker.
 */
export function SiteFooter() {
  const { t } = useT('footer');
  const { t: tNav } = useT('nav');
  const { t: tAddress } = useT('address');

  const columns: FooterColumn[] = [
    {
      heading: t('platform'),
      links: [
        <RouteLink key="hub" to="/platform">
          {tNav('product.hub.label')}
        </RouteLink>,
        ...FOOTER_PLATFORM_PAGES.filter((p) => p.id !== 'hub').map((page) => (
          <RouteLink key={page.id} to={page.path}>
            {tNav(`product.${page.navKey}.label`)}
          </RouteLink>
        )),
      ],
    },
    {
      heading: t('resources'),
      links: [
        <MarketingExternalLink key="docs" href={DOCS_URL} tone="footer">
          {tNav('resource.docs.label')}
        </MarketingExternalLink>,
        <RouteLink key="changelog" to="/changelog">
          {t('changelog')}
        </RouteLink>,
        <RouteLink key="hardware" to="/hardware-pricing">
          {t('hardwarePricing')}
        </RouteLink>,
        <RouteLink key="pricing" to="/pricing">
          {t('pricing')}
        </RouteLink>,
      ],
    },
    {
      heading: t('company'),
      links: FOOTER_COMPANY_CTAS.map((cta) => (
        <RouteLink key={cta.id} to={cta.path}>
          {tNav(cta.labelKey)}
        </RouteLink>
      )),
    },
    {
      heading: t('legal'),
      links: [
        <MarketingExternalLink
          key="serviceAgreement"
          href={EXTERNAL_LINKS.softwareTerms}
          tone="footer"
        >
          {t('serviceAgreement')}
        </MarketingExternalLink>,
        <MarketingExternalLink
          key="hardwareAgreement"
          href={EXTERNAL_LINKS.hardwareTerms}
          tone="footer"
        >
          {t('hardwareAgreement')}
        </MarketingExternalLink>,
        <LegalLink key="privacyPolicy" slug="privacy-policy">
          {t('privacyPolicy')}
        </LegalLink>,
        <LegalLink key="termsOfService" slug="terms-of-service">
          {t('termsOfService')}
        </LegalLink>,
        <LegalLink key="processingAgreement" slug="data-processing-agreement">
          {t('processingAgreement')}
        </LegalLink>,
        <LegalLink
          key="technicalOrganizationalMeasures"
          slug="technical-organizational-measures"
        >
          {t('technicalOrganizationalMeasures')}
        </LegalLink>,
      ],
    },
    // Fifth column wraps under Platform (col 1) on both 2-up and 4-up grids.
    {
      heading: tAddress('company'),
      links: [],
      className: 'col-start-1',
      body: (
        <address
          className="not-italic"
          style={{ lineHeight: 1.5, letterSpacing: '-0.14px' }}
        >
          <span className="text-fg-muted">
            {tAddress('street')}
            {' · '}
            {tAddress('city')}
            {' · '}
            {tAddress('country')}
            {' · '}
          </span>
          <MarketingExternalLink
            href={EXTERNAL_LINKS.vatCheck}
            tone="subtle"
            className="underline"
          >
            {tAddress('vatId')}
          </MarketingExternalLink>
        </address>
      ),
    },
  ];

  return (
    <SiteFooterShell
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
      columns={columns}
      copyrightLines={[t('copyright', { year: new Date().getFullYear() })]}
      bottomTrailing={<GithubLink label={t('githubAriaLabel')} />}
      llmsTxtUrl="/llms.txt"
      llmsTxtLabel={t('llmsTxtLabel')}
      llmsFullTxtUrl="/llms-full.txt"
      llmsFullTxtLabel={t('llmsFullTxtLabel')}
      themeSwitcherVariant="segmented"
      languageSwitcherShowFlag={false}
    />
  );
}
