import { CtaPair } from '@tale/marketing-ui/cta-group';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { Reveal } from '@tale/marketing-ui/reveal';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { SiteContainer } from '@tale/marketing-ui/site-container';
import { DocsToc, DocsTocOutline } from '@tale/ui/docs/docs-toc';
import { extractToc } from '@tale/ui/markdown/extract-toc';
import { buildBreadcrumbListJsonLd } from '@tale/ui/seo/builders/json-ld';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { absoluteSitePath } from '@tale/ui/seo/urls';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { RelatedUseCases } from '@/app/components/blocks/related-use-cases';
import { UseCaseIllustration } from '@/app/components/blocks/use-case-illustration';
import { MarketingProse } from '@/app/components/marketing/marketing-prose';
import { marketingContentHeading } from '@/lib/content/model';
import type { MarketingContentDocument } from '@/lib/content/model';
import { MARKETING_CONTENT_PATHS } from '@/lib/content/model';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n/locales';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const REVIEW_DATE_FORMATTERS = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }),
  ]),
) as Record<SupportedLocale, Intl.DateTimeFormat>;

/** One editorial reading surface for sourced comparisons and practical work guides. */
export function MarketingContentPage({
  document,
}: {
  document: MarketingContentDocument;
}) {
  const { t } = useT('contentPages');
  const { t: tNav } = useT('nav');
  const { frontmatter, category, locale, path, content, slug } = document;
  const hubPath = MARKETING_CONTENT_PATHS[category];
  const hubLabel = tNav(
    `resource.${category === 'comparisons' ? 'compare' : 'useCases'}.label`,
  );
  const isHub = slug === 'index';
  const hasIllustration = category === 'use-cases' && !isHub;
  const toc = useMemo(() => extractToc(content), [content]);
  const jsonLd = useMemo(() => {
    const url = absoluteSitePath(TALE_SITE_URL, document.url);
    const crumbs = [{ name: 'Tale', url: absoluteLocalizedUrl(locale, '/') }];
    if (!isHub)
      crumbs.push({
        name: hubLabel,
        url: absoluteLocalizedUrl(locale, hubPath),
      });
    crumbs.push({ name: frontmatter.title, url });
    return [
      buildBreadcrumbListJsonLd(crumbs),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': url,
        url,
        name: frontmatter.title,
        description: frontmatter.description,
        inLanguage: locale,
        lastReviewed: frontmatter.reviewed,
      }),
    ];
  }, [document.url, frontmatter, hubLabel, hubPath, isHub, locale]);

  useDocumentMeta({
    title: frontmatter.title,
    description: frontmatter.description,
    path,
    noindex: frontmatter.draft,
    jsonLd,
  });

  const reviewedDate = REVIEW_DATE_FORMATTERS[locale].format(
    new Date(`${frontmatter.reviewed}T00:00:00Z`),
  );

  return (
    <>
      <PageSection pad="lg" border="b">
        <nav
          aria-label={t('breadcrumb')}
          className="text-fg-muted mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:mb-12"
        >
          <MarketingLink
            to="/"
            tone="subtle"
            className="inline-flex min-h-11 items-center"
          >
            Tale
          </MarketingLink>
          <ChevronRight aria-hidden className="size-3" />
          {isHub ? (
            <span aria-current="page">{hubLabel}</span>
          ) : (
            <MarketingLink
              to={hubPath}
              tone="subtle"
              className="inline-flex min-h-11 items-center"
            >
              {hubLabel}
            </MarketingLink>
          )}
          {!isHub && frontmatter.competitor ? (
            <>
              <ChevronRight aria-hidden className="size-3" />
              <span aria-current="page">{frontmatter.competitor}</span>
            </>
          ) : null}
        </nav>
        <div
          className={
            hasIllustration
              ? 'grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16'
              : undefined
          }
        >
          <div className="min-w-0">
            <SectionHeading
              bare
              as="h1"
              size="section"
              align="start"
              className="max-w-5xl"
              title={marketingContentHeading(frontmatter.title)}
              description={frontmatter.description}
              descriptionClassName="max-w-3xl"
            />
            <p className="text-fg-subtle mt-7 font-mono text-xs">
              <time dateTime={frontmatter.reviewed}>
                {t('reviewed', { date: reviewedDate })}
              </time>
            </p>
          </div>
          {hasIllustration ? <UseCaseIllustration slug={slug} /> : null}
        </div>
      </PageSection>
      <SiteContainer>
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-16 py-10 sm:py-16 xl:gap-24">
          <article className="w-full max-w-3xl min-w-0 flex-1">
            <DocsTocOutline entries={toc} />
            <MarketingProse
              tableLabel={frontmatter.title}
              tableScrollHint={t('tableScrollHint')}
              className="text-base leading-relaxed [&_h2]:mt-12 [&_h2]:mb-5 [&_h2]:text-2xl [&_h2]:leading-tight [&_h2]:font-medium [&_h2]:tracking-[-0.03em] [&_h2]:text-balance sm:[&_h2]:text-3xl [&_p]:my-5 [&_p]:leading-[1.8]"
            >
              {content}
            </MarketingProse>
          </article>
          <DocsToc entries={toc} className="top-24 max-h-[calc(100dvh-6rem)]" />
        </div>
      </SiteContainer>
      {!isHub ? (
        <RelatedUseCases
          comparisonSlug={category === 'comparisons' ? slug : undefined}
          excludeSlug={category === 'use-cases' ? slug : undefined}
        />
      ) : null}
      <PageSection surface="soft" pad="lg" border="t">
        <Reveal className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center lg:gap-16">
          <SectionHeading
            bare
            align="start"
            size="subsection"
            className="max-w-2xl"
            title={t('nextTitle')}
            description={t('nextDescription')}
          />
          <CtaPair
            align="start"
            primary={{ label: tNav('requestDemo'), to: '/request-demo' }}
            secondary={{
              label: tNav('product.projects.label'),
              to: '/platform/projects',
            }}
            className="shrink-0"
          />
        </Reveal>
      </PageSection>
    </>
  );
}
