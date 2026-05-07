import { TaleLogo } from '@tale/ui/logo';
import { Link } from '@tanstack/react-router';

import { GithubIcon } from '@/app/components/icons/github-icon';
import { ExternalLink } from '@/app/components/layout/external-link';
import { LanguageSwitcher } from '@/app/components/layout/language-switcher';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import type { LocalizedRoutePath } from '@/lib/i18n/localized-paths';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import type { LegalSlug } from '@/lib/legal/slugs';

type LinkSpec =
  | {
      kind: 'route';
      label: string;
      to: LocalizedRoutePath;
    }
  | { kind: 'hash'; label: string; to: '/'; hash: string }
  | { kind: 'legal'; label: string; slug: LegalSlug }
  | { kind: 'external'; label: string; href: string };

interface FooterColumn {
  heading: string;
  links: LinkSpec[];
}

export function SiteFooter() {
  const { t } = useT('footer');
  const locale = useCurrentLocale();

  const columns: FooterColumn[] = [
    {
      heading: t('product'),
      links: [
        { kind: 'hash', label: t('features'), to: '/', hash: 'features' },
        { kind: 'route', label: t('pricing'), to: '/pricing' },
        {
          kind: 'route',
          label: t('hardwarePricing'),
          to: '/hardware-pricing',
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
          kind: 'legal',
          label: t('privacyPolicy'),
          slug: 'privacy-policy',
        },
        {
          kind: 'legal',
          label: t('termsOfService'),
          slug: 'terms-of-service',
        },
        {
          kind: 'legal',
          label: t('processingAgreement'),
          slug: 'data-processing-agreement',
        },
      ],
    },
  ];

  return (
    <footer className="border-border-base bg-bg-base border-t print:hidden">
      <SiteContainer>
        <div className="grid grid-cols-1 gap-12 py-16 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(0,1fr))]">
          <div className="text-fg-muted flex flex-col gap-4 text-sm sm:col-span-2 lg:col-span-1">
            <LocalizedLink
              to="/"
              aria-label={t('homeAriaLabel')}
              className="text-fg-base"
            >
              <TaleLogo />
            </LocalizedLink>
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
              >
                {t('address.vatId')}
              </ExternalLink>
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
                        <ExternalLink href={link.href} className={className}>
                          {link.label}
                        </ExternalLink>
                      </li>
                    );
                  }
                  if (link.kind === 'hash') {
                    return (
                      <li key={link.label}>
                        <LocalizedLink
                          to={link.to}
                          hash={link.hash}
                          className={className}
                        >
                          {link.label}
                        </LocalizedLink>
                      </li>
                    );
                  }
                  if (link.kind === 'legal') {
                    return (
                      <li key={link.label}>
                        <Link
                          to={
                            locale === 'en'
                              ? '/legal/$slug'
                              : '/$lang/legal/$slug'
                          }
                          params={
                            locale === 'en'
                              ? { slug: link.slug }
                              : { lang: locale, slug: link.slug }
                          }
                          className={className}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={link.label}>
                      <LocalizedLink to={link.to} className={className}>
                        {link.label}
                      </LocalizedLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-border-base flex flex-col gap-4 border-t py-6 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="text-fg-muted text-sm"
            style={{ letterSpacing: '-0.084px', lineHeight: 1.4286 }}
          >
            <p>{t('copyrightLine1', { year: new Date().getFullYear() })}</p>
            <p>{t('copyrightLine2')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <a
              href="https://github.com/tale-project/tale"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('githubAriaLabel')}
              className="text-fg-muted hover:bg-bg-muted hover:text-fg-base inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
          </div>
        </div>
      </SiteContainer>
    </footer>
  );
}
