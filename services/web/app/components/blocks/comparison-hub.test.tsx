import {
  MarketingRouterProvider,
  type MarketingLinkComponentProps,
} from '@tale/marketing-ui/routing';
import { localizedPath } from '@tale/ui/i18n/locales';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { listMarketingContent } from '@/lib/content/client';
import { readMarketingContent } from '@/lib/content/server';
import { i18n } from '@/lib/i18n/i18n';
import type { SupportedLocale } from '@/lib/i18n/locales';

import { ComparisonHub } from './comparison-hub';
import { ComparisonDecisionIllustration } from './comparison-illustration';

function renderHub(locale: SupportedLocale) {
  function Link({
    to,
    activeProps: _activeProps,
    activeOptions: _activeOptions,
    children,
    ...props
  }: MarketingLinkComponentProps) {
    return (
      <a href={localizedPath(locale, to)} {...props}>
        {children}
      </a>
    );
  }
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      <MarketingRouterProvider link={Link}>
        <ComparisonHub locale={locale} />
      </MarketingRouterProvider>,
    ),
    'text/html',
  );
}

describe('comparison discovery', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'server-renders every published guide once in %s with localized names and controls',
    async (locale) => {
      await i18n.changeLanguage(locale);
      const document = renderHub(locale);
      const pages = listMarketingContent('comparisons', locale).filter(
        (page) => page.slug !== 'index',
      );
      const links = Array.from(document.querySelectorAll('li a'));
      expect(
        links
          .map((link) => link.getAttribute('href'))
          .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
      ).toEqual(pages.map((page) => page.url).sort());
      expect(new Set(links.map((link) => link.getAttribute('href'))).size).toBe(
        pages.length,
      );
      for (const page of pages) {
        expect(
          links.find((link) => link.getAttribute('href') === page.url)
            ?.textContent,
        ).toContain(page.frontmatter.competitor);
      }
      const t = i18n.getFixedT(locale, 'contentPages');
      const input = document.querySelector('input');
      expect(
        document.querySelector(`label[for="${input?.id}"]`)?.textContent,
      ).toBe(t('comparisons.searchLabel'));
      expect(input?.getAttribute('aria-controls')).toBe(
        document.querySelector('ul')?.id,
      );
      expect(
        document.querySelectorAll('button[aria-pressed="true"]'),
      ).toHaveLength(1);
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
        t('comparisons.resultCount', {
          count: pages.length,
          total: pages.length,
        }),
      );
    },
  );

  it('uses each article’s source criteria and competitor identity in its decision sketch without adding a second table', () => {
    for (const page of readMarketingContent().filter(
      (entry) => entry.category === 'comparisons' && entry.slug !== 'index',
    )) {
      const html = renderToStaticMarkup(
        <ComparisonDecisionIllustration document={page} />,
      );
      const document = new DOMParser().parseFromString(html, 'text/html');
      const criteria = page.content
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .slice(2)
        .map((line) => line.split('|')[1]!.trim());
      for (const criterion of criteria)
        expect(document.body.textContent, page.url).toContain(criterion);
      expect(document.body.textContent, page.url).toContain(
        page.frontmatter.competitor,
      );
      expect(document.querySelectorAll('table'), page.url).toHaveLength(0);
      expect(
        document.querySelector('[aria-hidden="true"]'),
        page.url,
      ).not.toBeNull();
    }
  }, 15_000);
});
