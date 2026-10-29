// @vitest-environment node
/**
 * Prerendering and the dev artifacts server render each page through
 * `render()`. A page whose loader fails there renders the site's own error
 * page as well — localized, inside the site chrome, kept out of the index —
 * never TanStack's English "Something went wrong!" or the error itself.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  listMarketingContent,
  loadMarketingContent,
} from '@/lib/content/client';
import { i18n } from '@/lib/i18n/i18n';

import { render } from './entry-server';

vi.mock('@/lib/content/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/client')>();
  return {
    ...actual,
    loadMarketingContent: vi.fn(actual.loadMarketingContent),
  };
});

/** `text` as React writes it into the markup. */
function markup(text: string): string {
  return renderToStaticMarkup(<>{text}</>);
}

afterEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('server rendering a page that fails to load', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'renders the %s error page in the site chrome',
    async (locale) => {
      const page = listMarketingContent('use-cases', locale).find(
        (entry) => entry.slug !== 'index',
      );
      if (!page) throw new Error(`no ${locale} use case to render`);
      vi.mocked(loadMarketingContent).mockRejectedValueOnce(
        new TypeError('Failed to fetch'),
      );
      const t = i18n.getFixedT(locale, 'pageError');

      const { html, head } = await render(page.url);

      const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
      expect(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(main)?.[1]).toBe(
        markup(t('title')),
      );
      expect(main).toContain(markup(t('body')));
      expect(main).toContain('role="alert"');
      expect(html).toMatch(/<header\b/);
      expect(html).toMatch(/<footer\b/);
      expect(html).not.toContain('Something went wrong');
      expect(html).not.toContain('Failed to fetch');
      expect(head).toMatch(/<meta name="robots" content="noindex/);
    },
  );
});
