import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DOCS_URL } from '@/lib/docs-url';
import { i18n } from '@/lib/i18n/i18n';
import type { SupportedLocale } from '@/lib/i18n/locales';

import { useFeaturePageContent } from './use-feature-page-content';

const page = vi.hoisted(() => ({ locale: 'en' as SupportedLocale }));

vi.mock('@/lib/i18n/use-current-locale', () => ({
  useCurrentLocale: () => page.locale,
}));

const PAGES = [
  ['agents', 'platformAgents'],
  ['chat', 'platformChat'],
  ['projects', 'platformProjects'],
  ['automations', 'platformAutomations'],
  ['knowledge', 'platformKnowledge'],
  ['governance', 'platformGovernance'],
] as const;

/** Every docs link one feature page renders, in the order it renders them. */
function docsHrefs(
  pageId: (typeof PAGES)[number][0],
  namespace: (typeof PAGES)[number][1],
): string[] {
  const { result } = renderHook(() => useFeaturePageContent(pageId, namespace));
  return [
    ...result.current.capabilities.flatMap((item) =>
      item.docsHref ? [item.docsHref] : [],
    ),
    ...result.current.docsLinks.map((item) => item.href),
  ];
}

// #4127: the feature pages linked the English docs from German and French
// pages.
describe('useFeaturePageContent docs links', () => {
  it.each([
    ['en', ''],
    ['de', '/de'],
    ['fr', '/fr'],
  ] as const)(
    'opens the %s docs from the pages of that language',
    async (locale, prefix) => {
      page.locale = locale;
      await i18n.changeLanguage(locale);

      for (const [pageId, namespace] of PAGES) {
        const hrefs = docsHrefs(pageId, namespace);
        expect(hrefs.length, pageId).toBeGreaterThan(0);
        for (const href of hrefs) {
          expect(href.startsWith(`${DOCS_URL}${prefix}/`), href).toBe(true);
          expect(href.slice(DOCS_URL.length + prefix.length), href).not.toMatch(
            /^\/(?:de|fr)\//,
          );
        }
      }
    },
  );
});
