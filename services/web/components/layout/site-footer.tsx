import { TaleLogo } from '@tale/ui/logo';
import {
  type FooterColumn,
  SiteFooter as SiteFooterShell,
} from '@tale/webui/layout/site-footer';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { GithubIcon } from '@/components/icons/github-icon';
import { ExternalLink } from '@/components/layout/external-link';
import {
  LocalizedLink,
  type LocalizedRoutePath,
} from '@/components/layout/localized-link';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import type { LegalSlug } from '@/lib/legal/slugs';

const linkClass = 'text-fg-muted hover:text-fg-base text-sm transition-colors';

function RouteLink({
  to,
  children,
}: {
  to: LocalizedRoutePath;
  children: ReactNode;
}) {
  return (
    <LocalizedLink to={to} className={linkClass}>
      {children}
    </LocalizedLink>
  );
}

function HashLink({
  to,
  hash,
  children,
}: {
  to: LocalizedRoutePath;
  hash: string;
  children: ReactNode;
}) {
  return (
    <LocalizedLink to={to} hash={hash} className={linkClass}>
      {children}
    </LocalizedLink>
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
      className={linkClass}
    >
      {children}
    </Link>
  );
}

export function SiteFooter() {
  const { t } = useT('footer');

  const columns: FooterColumn[] = [
    {
      heading: t('product'),
      links: [
        <HashLink key="features" to="/" hash="features">
          {t('features')}
        </HashLink>,
        <RouteLink key="pricing" to="/pricing">
          {t('pricing')}
        </RouteLink>,
        <RouteLink key="hardwarePricing" to="/hardware-pricing">
          {t('hardwarePricing')}
        </RouteLink>,
        <RouteLink key="contact" to="/contact">
          {t('contact')}
        </RouteLink>,
      ],
    },
    {
      heading: t('resources'),
      links: [
        <ExternalLink
          key="aiTraining"
          href="https://www.edoobox.com/de/Ruler/AI%20Training.html"
          className={linkClass}
        >
          {t('aiTraining')}
        </ExternalLink>,
      ],
    },
    {
      heading: t('legal'),
      links: [
        <ExternalLink
          key="serviceAgreement"
          href="https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDMsO0J9N-4RJtStv-1_IurAV_aXuHPQB5hfWnda5wSluA?e=cfXpDs"
          className={linkClass}
        >
          {t('serviceAgreement')}
        </ExternalLink>,
        <ExternalLink
          key="hardwareAgreement"
          href="https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDoJBWnXoqqQLlapn6eOPEcAUkySXRa3AUSrKFwYMl0VCU?e=JWmiZc"
          className={linkClass}
        >
          {t('hardwareAgreement')}
        </ExternalLink>,
        <LegalLink key="privacyPolicy" slug="privacy-policy">
          {t('privacyPolicy')}
        </LegalLink>,
        <LegalLink key="termsOfService" slug="terms-of-service">
          {t('termsOfService')}
        </LegalLink>,
        <LegalLink key="processingAgreement" slug="data-processing-agreement">
          {t('processingAgreement')}
        </LegalLink>,
      ],
    },
  ];

  return (
    <SiteFooterShell
      logo={
        <LocalizedLink
          to="/"
          aria-label={t('homeAriaLabel')}
          className="text-fg-base"
        >
          <TaleLogo />
        </LocalizedLink>
      }
      address={
        <address
          className="not-italic"
          style={{ lineHeight: 1.4286, letterSpacing: '-0.14px' }}
        >
          {t('address.company')}
          <br />
          {t('address.street')}
          <br />
          {t('address.city')}
          <br />
          {t('address.country')}
          <br />
          <ExternalLink
            href="https://www.uid.admin.ch/Detail.aspx?uid_id=CHE186532610"
            className="hover:text-fg-base underline transition-colors"
          >
            {t('address.vatId')}
          </ExternalLink>
        </address>
      }
      columns={columns}
      copyrightLines={[
        t('copyrightLine1', { year: new Date().getFullYear() }),
        t('copyrightLine2'),
      ]}
      llmsTxtUrl="/llms.txt"
      llmsTxtLabel={t('llmsTxtLabel')}
      llmsFullTxtUrl="/llms-full.txt"
      llmsFullTxtLabel={t('llmsFullTxtLabel')}
      bottomTrailing={
        <a
          href="https://github.com/tale-project/tale"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('githubAriaLabel')}
          className="text-fg-muted hover:text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base sm:hover:bg-bg-muted inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-10 sm:w-10 sm:rounded-md"
        >
          <GithubIcon className="h-6 w-6 sm:h-5 sm:w-5" />
        </a>
      }
    />
  );
}
