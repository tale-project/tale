import { TaleLogo } from '@tale/ui/logo';
import { Link } from '@tanstack/react-router';

import { GithubIcon } from '@/app/components/icons/github-icon';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

type LinkSpec =
  | { kind: 'route'; label: string; to: '/' | '/pricing' | '/contact' }
  | { kind: 'hash'; label: string; to: '/'; hash: string }
  | { kind: 'external'; label: string; href: string };

interface FooterColumn {
  heading: string;
  links: LinkSpec[];
}

export function SiteFooter() {
  const { t } = useT('footer');

  const columns: FooterColumn[] = [
    {
      heading: t('product'),
      links: [
        { kind: 'hash', label: t('features'), to: '/', hash: 'features' },
        { kind: 'route', label: t('pricing'), to: '/pricing' },
        {
          kind: 'external',
          label: t('hardwarePricing'),
          href: 'https://tale.dev/hardware-pricing',
        },
        { kind: 'route', label: t('contact'), to: '/contact' },
      ],
    },
    {
      heading: t('resources'),
      links: [
        {
          kind: 'external',
          label: t('aiTraining'),
          href: 'https://www.edoobox.com/de/Ruler/AI%20Training.html',
        },
      ],
    },
    {
      heading: t('legal'),
      links: [
        {
          kind: 'external',
          label: t('serviceAgreement'),
          href: 'https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDMsO0J9N-4RJtStv-1_IurAV_aXuHPQB5hfWnda5wSluA?e=cfXpDs',
        },
        {
          kind: 'external',
          label: t('hardwareAgreement'),
          href: 'https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDoJBWnXoqqQLlapn6eOPEcAUkySXRa3AUSrKFwYMl0VCU?e=JWmiZc',
        },
        {
          kind: 'external',
          label: t('privacyPolicy'),
          href: 'https://docs.tale.dev/legal/privacy-policy',
        },
        {
          kind: 'external',
          label: t('termsOfService'),
          href: 'https://docs.tale.dev/legal/terms-of-service',
        },
        {
          kind: 'external',
          label: t('processingAgreement'),
          href: 'https://docs.tale.dev/legal/data-processing-agreement',
        },
      ],
    },
  ];

  return (
    <footer className="border-border-base bg-bg-base border-t">
      <SiteContainer>
        <div className="grid grid-cols-1 gap-12 py-16 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(0,1fr))]">
          <div className="text-fg-muted flex flex-col gap-4 text-sm">
            <Link
              to="/"
              aria-label={t('homeAriaLabel')}
              className="text-fg-base"
            >
              <TaleLogo />
            </Link>
            <address className="leading-relaxed not-italic">
              {t('address.company')}
              <br />
              {t('address.street')}
              <br />
              {t('address.city')}
              <br />
              {t('address.country')}
              <br />
              <a
                href="https://www.uid.admin.ch/Detail.aspx?uid_id=CHE186532610"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-fg-base transition-colors"
              >
                {t('address.vatId')}
              </a>
            </address>
          </div>

          {columns.map((col) => (
            <nav
              key={col.heading}
              aria-label={col.heading}
              className="flex flex-col gap-3"
            >
              <h3 className="text-fg-base text-sm font-semibold">
                {col.heading}
              </h3>
              <ul role="list" className="flex flex-col gap-2">
                {col.links.map((link) => {
                  const className =
                    'text-fg-muted hover:text-fg-base text-sm transition-colors';
                  if (link.kind === 'external') {
                    return (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={className}
                        >
                          {link.label}
                        </a>
                      </li>
                    );
                  }
                  if (link.kind === 'hash') {
                    return (
                      <li key={link.label}>
                        <Link
                          to={link.to}
                          hash={link.hash}
                          className={className}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={link.label}>
                      <Link to={link.to} className={className}>
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-border-base flex flex-col gap-4 border-t py-6 md:flex-row md:items-center md:justify-between">
          <p
            className="text-fg-muted text-sm"
            style={{ letterSpacing: '-0.084px', lineHeight: 1.4286 }}
          >
            {t('copyright', { year: new Date().getFullYear() })}
          </p>
          <a
            href="https://github.com/tale-project/tale"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('githubAriaLabel')}
            className="text-fg-muted hover:bg-bg-elevated hover:text-fg-base inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
          >
            <GithubIcon className="h-4 w-4" />
          </a>
        </div>
      </SiteContainer>
    </footer>
  );
}
