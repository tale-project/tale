import { MarketingButton } from '@tale/marketing-ui/button';
import { MarketingLink } from '@tale/marketing-ui/link';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { SearchInput } from '@tale/ui/search-input';
import { ArrowRight } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

import { listMarketingContent } from '@/lib/content/client';
import type { MarketingContentFrontmatter } from '@/lib/content/model';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

type ComparisonFilter =
  | 'all'
  | NonNullable<MarketingContentFrontmatter['relationship']>;

const FILTERS = ['all', 'direct', 'adjacent', 'framework', 'runtime'] as const;

/** Discovery uses published metadata, so searching never downloads guide bodies. */
export function ComparisonHub({ locale }: { locale: SupportedLocale }) {
  const { t } = useT('contentPages');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ComparisonFilter>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const headingId = useId();
  const pages = useMemo(
    () =>
      listMarketingContent('comparisons', locale)
        .filter((page) => page.slug !== 'index')
        .sort((left, right) =>
          (left.frontmatter.competitor ?? '').localeCompare(
            right.frontmatter.competitor ?? '',
            locale,
            { sensitivity: 'base' },
          ),
        ),
    [locale],
  );
  const terms = query
    .trim()
    .toLocaleLowerCase(locale)
    .split(/\s+/)
    .filter(Boolean);
  const results = pages.filter((page) => {
    if (filter !== 'all' && page.frontmatter.relationship !== filter)
      return false;
    const text = [
      page.frontmatter.competitor,
      page.frontmatter.description,
      page.frontmatter.title,
    ]
      .join(' ')
      .toLocaleLowerCase(locale);
    return terms.every((term) => text.includes(term));
  });
  const reset = () => {
    setQuery('');
    setFilter('all');
    searchRef.current?.focus();
  };

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-6 flex flex-col gap-5 sm:mb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div>
          <h2
            id={headingId}
            className="text-fg-base text-2xl font-medium tracking-tight"
          >
            {t('comparisons.directoryTitle')}
          </h2>
          <p className="text-fg-muted mt-2 max-w-2xl text-sm leading-relaxed">
            {t('comparisons.directoryDescription')}
          </p>
        </div>
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          label={t('comparisons.searchLabel')}
          placeholder={t('comparisons.searchPlaceholder')}
          aria-controls={resultsId}
          className="bg-surface-site-raised h-11 max-w-none"
          wrapperClassName="w-full shrink-0 lg:w-80"
        />
      </div>
      <div
        role="group"
        aria-label={t('comparisons.filterLabel')}
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((value) => (
          <MarketingButton
            key={value}
            tone={filter === value ? 'primary' : 'secondary'}
            aria-pressed={filter === value}
            aria-controls={resultsId}
            onClick={() => setFilter(value)}
            className="min-h-11 px-3"
          >
            {t(`comparisons.types.${value}.label`)}
          </MarketingButton>
        ))}
      </div>
      <div className="mt-4 mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <p className="text-fg-muted max-w-2xl text-sm leading-relaxed">
          {t(`comparisons.types.${filter}.description`)}
        </p>
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-fg-subtle shrink-0 text-xs leading-6 tabular-nums"
        >
          {t('comparisons.resultCount', {
            count: results.length,
            total: pages.length,
          })}
        </p>
      </div>
      <MarketingPanel>
        {results.length ? (
          <ul id={resultsId} className="divide-border-base/60 divide-y">
            {results.map((page) => (
              <li key={page.slug}>
                <MarketingLink
                  to={page.path}
                  tone="plain"
                  className="group hover:bg-surface-site-inset/50 relative grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-5 transition-colors focus-visible:z-10 focus-visible:outline-offset-[-4px] sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_auto] lg:gap-8"
                >
                  <span className="min-w-0">
                    <span className="text-fg-base block text-base font-medium tracking-tight">
                      {page.frontmatter.competitor}{' '}
                    </span>
                    <span className="text-fg-subtle mt-1 block text-xs">
                      {t(
                        `comparisons.types.${page.frontmatter.relationship}.label`,
                      )}{' '}
                    </span>
                  </span>
                  <span className="text-fg-muted col-span-2 row-start-2 text-sm leading-relaxed lg:col-span-1 lg:row-start-auto">
                    {page.frontmatter.description}
                  </span>
                  <ArrowRight
                    aria-hidden
                    strokeWidth={1.5}
                    className="text-fg-subtle group-hover:text-fg-base col-start-2 row-start-1 size-5 shrink-0 lg:col-start-3"
                  />
                </MarketingLink>
              </li>
            ))}
          </ul>
        ) : (
          <div
            id={resultsId}
            className="flex flex-col items-start gap-3 px-5 py-10 sm:px-6"
          >
            <h3 className="text-fg-base text-lg font-medium">
              {t('comparisons.emptyTitle')}
            </h3>
            <p className="text-fg-muted max-w-xl text-sm leading-relaxed">
              {t('comparisons.emptyDescription')}
            </p>
            <MarketingButton
              tone="secondary"
              onClick={reset}
              className="mt-2 min-h-11"
            >
              {t('comparisons.reset')}
            </MarketingButton>
          </div>
        )}
      </MarketingPanel>
      {results.length > 0 && (query || filter !== 'all') ? (
        <div className="mt-4">
          <MarketingButton
            tone="secondary"
            onClick={reset}
            className="min-h-11"
          >
            {t('comparisons.reset')}
          </MarketingButton>
        </div>
      ) : null}
    </section>
  );
}
