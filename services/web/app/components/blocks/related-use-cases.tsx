import { MarketingCard } from '@tale/marketing-ui/card';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { cn } from '@tale/ui/cn';
import { ArrowRight } from 'lucide-react';

import {
  COMPARISON_USE_CASES,
  PLATFORM_USE_CASES,
} from '@/app/content/content-relationships';
import type { PlatformPageId } from '@/app/content/platform-pages';
import { listMarketingContent } from '@/lib/content/client';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

export function RelatedUseCases({
  comparisonSlug,
  excludeSlug,
  pageId,
}: {
  comparisonSlug?: string;
  excludeSlug?: string;
  pageId?: PlatformPageId;
}) {
  const { t } = useT('contentPages');
  const locale = useCurrentLocale();
  const desired = comparisonSlug
    ? [COMPARISON_USE_CASES[comparisonSlug]]
    : pageId
      ? PLATFORM_USE_CASES[pageId]
      : undefined;
  const pages = listMarketingContent('use-cases', locale)
    .filter(
      (page) =>
        page.slug !== 'index' &&
        page.slug !== excludeSlug &&
        (!desired || desired.some((slug) => slug === page.slug)),
    )
    .slice(0, 3);
  if (pages.length === 0) return null;

  return (
    <PageSection pad="lg" border="t">
      <div className="mb-8 flex flex-col items-start justify-between gap-5 sm:mb-10 lg:flex-row lg:items-end lg:gap-12">
        <SectionHeading
          size="subsection"
          align="start"
          className="max-w-2xl"
          title={t('relatedTitle')}
          description={t('relatedDescription')}
        />
        <MarketingLink
          to="/use-cases"
          tone="inline"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm"
        >
          {t('allUseCases')}
          <ArrowRight aria-hidden className="size-4" />
        </MarketingLink>
      </div>
      <div
        className={cn(
          'grid gap-4',
          pages.length === 1
            ? 'max-w-3xl'
            : pages.length === 2
              ? 'sm:grid-cols-2'
              : 'md:grid-cols-3',
        )}
      >
        {pages.map((page) => (
          <MarketingCard
            key={page.slug}
            to={page.path}
            title={page.frontmatter.title}
            description={page.frontmatter.description}
            surface="raised"
          />
        ))}
      </div>
    </PageSection>
  );
}
