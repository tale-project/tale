import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { ArrowUpRight } from 'lucide-react';

import { BLOG_RELATED_TOPICS } from '@/app/content/blog-relationships';
import { listMarketingContent } from '@/lib/content/client';
import type { MarketingContentMetadata } from '@/lib/content/model';
import { useT } from '@/lib/i18n/client';

import { BlogCover } from './blog-cover';

/** Index and related reading share the same publication-filtered card source. */
export function BlogCollection({
  locale,
  topicId,
}: {
  locale: string;
  topicId?: string;
}) {
  const { t } = useT('blog');
  const articles = listMarketingContent('blog', locale).filter(
    (page) => page.slug !== 'index',
  );
  const related = BLOG_RELATED_TOPICS[topicId ?? ''] ?? [];
  const pages = topicId
    ? related.flatMap((id) =>
        articles.filter(
          (page) => page.frontmatter.topicId === id && id !== topicId,
        ),
      )
    : articles;
  if (pages.length === 0) return null;
  return (
    <PageSection pad="lg" border="t">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
        <SectionHeading
          size="subsection"
          align="start"
          title={topicId ? t('relatedTitle') : t('allArticles')}
        />
        {topicId ? (
          <MarketingLink to="/blog" tone="inline">
            {t('allArticles')}
          </MarketingLink>
        ) : null}
      </div>
      <BlogArticles pages={pages} />
    </PageSection>
  );
}

export function BlogArticles({
  pages,
}: {
  pages: readonly MarketingContentMetadata[];
}) {
  return (
    <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => (
        <MarketingLink
          key={page.slug}
          to={page.path}
          tone="plain"
          className="group block min-w-0 rounded-xl"
        >
          <BlogCover topicId={page.frontmatter.topicId} alt="" />
          <div className="mt-5 flex items-start justify-between gap-4">
            <h3 className="text-fg-base text-xl leading-tight font-medium tracking-tight">
              {page.frontmatter.title}
            </h3>
            <ArrowUpRight
              aria-hidden
              className="text-fg-subtle mt-1 size-4 shrink-0"
            />
          </div>
          <p className="text-fg-muted mt-3 text-sm leading-relaxed">
            {page.frontmatter.description}
          </p>
        </MarketingLink>
      ))}
    </div>
  );
}
