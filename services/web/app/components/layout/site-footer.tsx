import {
  type FooterColumn,
  SiteFooter as SiteFooterShell,
} from '@tale/marketing-ui/site-footer';
import { TaleLogo } from '@tale/ui/logo';
import { useSiteCopyright } from '@tale/ui/use-site-copyright';
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
import { listMarketingContent } from '@/lib/content/client';
import { getDocsUrl } from '@/lib/docs-url';
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
    <MarketingLink
      to={to}
      tone="footer"
      activeOptions={{ exact: true, includeSearch: false }}
    >
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
 * Marketing footer — four compact destination groups, with the company
 * address and GitHub in the bottom bar.
 */
export function SiteFooter() {
  const copyright = useSiteCopyright();
  const { t } = useT('footer');
  const { t: tNav } = useT('nav');
  const { t: tAddress } = useT('address');
  const locale = useCurrentLocale();

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
        <MarketingExternalLink
          key="docs"
          href={getDocsUrl(locale)}
          tone="footer"
        >
          {tNav('resource.docs.label')}
        </MarketingExternalLink>,
        <MarketingExternalLink
          key="uiDocs"
          href={EXTERNAL_LINKS.uiDocs}
          tone="footer"
        >
          {t('taleUi')}
        </MarketingExternalLink>,
        ...(['comparisons', 'use-cases'] as const).flatMap((category) => {
          if (
            !listMarketingContent(category, 'en').some(
              (page) => page.slug === 'index',
            )
          )
            return [];
          const compare = category === 'comparisons';
          return [
            <RouteLink key={category} to={compare ? '/compare' : '/use-cases'}>
              {tNav(`resource.${compare ? 'compare' : 'useCases'}.label`)}
            </RouteLink>,
          ];
        }),
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
  ];

  return (
    <SiteFooterShell
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
      columns={columns}
      address={
        <address className="flex flex-wrap items-baseline gap-x-2 gap-y-1 not-italic">
          <span>{tAddress('company')}</span>
          <span>
            {tAddress('street')} · {tAddress('city')} · {tAddress('country')}
          </span>
          <MarketingExternalLink
            href={EXTERNAL_LINKS.vatCheck}
            tone="subtle"
            className="underline"
          >
            {tAddress('vatId')}
          </MarketingExternalLink>
        </address>
      }
      copyrightLines={[copyright]}
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
