import { TaleLogo } from '@tale/ui/logo';
import { ExternalLink } from '@tale/webui/layout/external-link';
import { type FooterColumn, SiteFooter } from '@tale/webui/layout/site-footer';
import type { ReactNode } from 'react';

import { GithubIcon } from '@/app/components/icons/github-icon';
import { useT } from '@/lib/i18n/client';

const linkClass = 'text-fg-muted hover:text-fg-base text-sm transition-colors';

const MARKETING_ORIGIN = 'https://tale.dev';

function MarketingLink({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`${MARKETING_ORIGIN}${path}`}
      className={linkClass}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export function DocsFooter() {
  const { t } = useT('footer');

  const columns: FooterColumn[] = [
    {
      heading: t('product'),
      links: [
        <MarketingLink key="features" path="/#features">
          {t('features')}
        </MarketingLink>,
        <MarketingLink key="pricing" path="/pricing">
          {t('pricing')}
        </MarketingLink>,
        <MarketingLink key="hardwarePricing" path="/hardware-pricing">
          {t('hardwarePricing')}
        </MarketingLink>,
        <MarketingLink key="contact" path="/contact">
          {t('contact')}
        </MarketingLink>,
      ],
    },
    {
      heading: t('resources'),
      links: [
        <ExternalLink
          key="aiTraining"
          href="https://www.edoobox.com/de/Ruler/AI%20Training.html"
          className={linkClass}
          showIcon={false}
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
          showIcon={false}
        >
          {t('serviceAgreement')}
        </ExternalLink>,
        <ExternalLink
          key="hardwareAgreement"
          href="https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDoJBWnXoqqQLlapn6eOPEcAUkySXRa3AUSrKFwYMl0VCU?e=JWmiZc"
          className={linkClass}
          showIcon={false}
        >
          {t('hardwareAgreement')}
        </ExternalLink>,
        <MarketingLink key="privacyPolicy" path="/legal/privacy-policy">
          {t('privacyPolicy')}
        </MarketingLink>,
        <MarketingLink key="termsOfService" path="/legal/terms-of-service">
          {t('termsOfService')}
        </MarketingLink>,
        <MarketingLink
          key="processingAgreement"
          path="/legal/data-processing-agreement"
        >
          {t('processingAgreement')}
        </MarketingLink>,
      ],
    },
  ];

  return (
    <SiteFooter
      containerClassName="max-w-[1400px] px-4 sm:px-5 md:px-8"
      logo={
        <a
          href={MARKETING_ORIGIN}
          aria-label={t('homeAriaLabel')}
          className="text-fg-base"
          target="_blank"
          rel="noopener noreferrer"
        >
          <TaleLogo />
        </a>
      }
      address={
        <address className="leading-relaxed not-italic">
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
            showIcon={false}
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
      bottomTrailing={
        <a
          href="https://github.com/tale-project/tale"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('githubAriaLabel')}
          className="text-fg-muted hover:bg-bg-muted hover:text-fg-base inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <GithubIcon className="h-5 w-5" />
        </a>
      }
    />
  );
}
