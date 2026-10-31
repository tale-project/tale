import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DOCS_URL } from '@/lib/docs-url';
import { i18n } from '@/lib/i18n/i18n';
import type { SupportedLocale } from '@/lib/i18n/locales';

import { CtaDeploy } from './cta-deploy';

const page = vi.hoisted(() => ({ locale: 'en' as SupportedLocale }));

vi.mock('@/lib/i18n/use-current-locale', () => ({
  useCurrentLocale: () => page.locale,
}));

vi.mock('@/app/components/marketing', () => ({
  CtaPair: ({ primary }: { primary: { label: string; href: string } }) => (
    <a href={primary.href}>{primary.label}</a>
  ),
  PageSection: ({ children }: { children: ReactNode }) => children,
  Reveal: ({ children }: { children: ReactNode }) => children,
  SectionHeading: () => null,
}));

// #4127: the terminal's docs link went to the English quickstart from every
// page, while the hero beside it already kept the page's language.
describe('CtaDeploy', () => {
  it.each([
    ['en', ''],
    ['de', '/de'],
    ['fr', '/fr'],
  ] as const)(
    'links the %s docs in the language of the page',
    async (locale, prefix) => {
      page.locale = locale;
      await i18n.changeLanguage(locale);
      const html = renderToStaticMarkup(<CtaDeploy />);
      const document = new DOMParser().parseFromString(html, 'text/html');
      const hrefs = [...document.querySelectorAll('a')].map((link) =>
        link.getAttribute('href'),
      );

      expect(hrefs).toEqual([
        `${DOCS_URL}${prefix}/get-started/quickstart`,
        `${DOCS_URL}${prefix}/self-hosted/install/quickstart`,
      ]);
    },
  );
});
