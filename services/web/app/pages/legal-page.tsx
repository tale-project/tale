import { Link } from '@tanstack/react-router';
import { Printer } from 'lucide-react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { MarketingButton } from '@/app/components/marketing';
import { MarketingProse } from '@/app/components/marketing/marketing-prose';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import type { SupportedLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { getLegalDocument } from '@/lib/legal/content';
import type { LegalSlug } from '@/lib/legal/slugs';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface LegalPageProps {
  slug: LegalSlug;
}

// Slugs that render as sibling tabs at the top of the page. The DPA and TOM
// are treated as a single contract surface: TOM is referenced from DPA § 7
// and most enterprise reviewers ask for both together.
const DPA_TAB_SLUGS = [
  'data-processing-agreement',
  'technical-organizational-measures',
] as const satisfies readonly LegalSlug[];

type DpaTabSlug = (typeof DPA_TAB_SLUGS)[number];

function isDpaTabSlug(slug: LegalSlug): slug is DpaTabSlug {
  return (DPA_TAB_SLUGS as readonly LegalSlug[]).includes(slug);
}

function legalPath(locale: SupportedLocale, slug: LegalSlug): string {
  return localizedPath(locale, `/legal/${slug}`);
}

interface DpaTabsProps {
  activeSlug: DpaTabSlug;
  locale: SupportedLocale;
}

function DpaTabs({ activeSlug, locale }: DpaTabsProps) {
  const { t } = useT('legal');
  return (
    <nav
      aria-label={t('documentTabsAria')}
      className="border-border-base flex gap-1 border-b print:hidden"
    >
      {DPA_TAB_SLUGS.map((tabSlug) => {
        const isActive = tabSlug === activeSlug;
        return (
          <Link
            key={tabSlug}
            to={locale === 'en' ? '/legal/$slug' : '/$lang/legal/$slug'}
            params={
              locale === 'en'
                ? { slug: tabSlug }
                : { lang: locale, slug: tabSlug }
            }
            aria-current={isActive ? 'page' : undefined}
            className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-fg-base text-fg-base'
                : 'text-fg-muted hover:text-fg-base border-transparent'
            }`}
          >
            {t(`tabs.${tabSlug}`)}
          </Link>
        );
      })}
    </nav>
  );
}

function printPage(): void {
  if (typeof window !== 'undefined') window.print();
}

export function LegalPage({ slug }: LegalPageProps) {
  const { t } = useT('legal');
  const locale = useCurrentLocale();
  const doc = getLegalDocument(locale, slug);

  const title = doc?.frontmatter.title ?? '';
  const description = doc?.frontmatter.description ?? '';

  useDocumentMeta({
    title,
    description,
    canonicalPath: legalPath(locale, slug),
    // Legal docs declare `noindex: true` in YAML frontmatter; pre-fix
    // this was parsed but never forwarded to the meta hook, so all
    // legal pages shipped indexable. Round-2 review CRITICAL #26.
    noindex: doc?.frontmatter.noindex,
  });

  if (!doc) {
    return (
      <section className="py-20">
        <SiteContainer>
          <p className="text-fg-muted">{t('notFound')}</p>
        </SiteContainer>
      </section>
    );
  }

  const showDpaTabs = isDpaTabSlug(slug);

  return (
    <article className="py-16">
      <SiteContainer>
        <div className="mx-auto max-w-280">
          {showDpaTabs ? (
            <div className="mb-6">
              <DpaTabs activeSlug={slug} locale={locale} />
            </div>
          ) : null}
          <header className="border-border-base flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <h1
                className="text-fg-base text-3xl font-semibold md:text-4xl"
                style={{ letterSpacing: '-0.8px', lineHeight: 1.15 }}
              >
                {title}
              </h1>
              {description ? (
                <p className="text-fg-muted text-base">{description}</p>
              ) : null}
            </div>
            <MarketingButton
              type="button"
              tone="secondary"
              size="lg"
              onClick={printPage}
              aria-label={t('downloadPdfAria', { title })}
              className="shrink-0 gap-2 print:hidden"
            >
              <Printer className="h-4 w-4" aria-hidden />
              {t('downloadPdf')}
            </MarketingButton>
          </header>
          <div className="mt-8 text-base">
            <MarketingProse tableLabel={title}>{doc.content}</MarketingProse>
          </div>
        </div>
      </SiteContainer>
    </article>
  );
}
