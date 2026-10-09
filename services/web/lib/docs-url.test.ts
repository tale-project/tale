import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCS_URL,
  GET_STARTED_URL,
  SELF_HOSTED_QUICKSTART_URL,
  getDocsUrl,
  getStartedUrl,
} from './docs-url';

describe('docs-url', () => {
  // Regression: the docs site moved to its own host. While the default was
  // still `https://tale.dev/docs`, every marketing page linked to a URL that
  // 308-redirects, which Ahrefs reports as "Page has links to redirect".
  it('links to the docs subdomain, not a /docs subpath', () => {
    expect(DOCS_URL).toBe('https://docs.tale.dev');
    expect(DOCS_URL).not.toContain('tale.dev/docs');
  });

  it('points Get started at the Start-tab quickstart, not self-hosted install', () => {
    expect(GET_STARTED_URL).toBe(`${DOCS_URL}/get-started/quickstart`);
    expect(GET_STARTED_URL).not.toContain('self-hosted/install');
  });

  it('points the homepage terminal at the self-hosted install quickstart', () => {
    expect(SELF_HOSTED_QUICKSTART_URL).toBe(
      `${DOCS_URL}/self-hosted/install/quickstart`,
    );
  });

  it.each(['en', 'de', 'fr'] as const)(
    'keeps $locale chrome links in the same language',
    (locale) => {
      const prefix = locale === 'en' ? '' : `/${locale}`;
      expect(getDocsUrl(locale)).toBe(`${DOCS_URL}${prefix || '/'}`);
      expect(getStartedUrl(locale)).toBe(
        `${DOCS_URL}${prefix}/get-started/quickstart`,
      );
    },
  );
});

describe.each([
  { base: 'https://example.com', mount: 'https://example.com' },
  { base: 'https://example.com/', mount: 'https://example.com' },
  { base: 'https://example.com/docs', mount: 'https://example.com/docs' },
  { base: 'https://example.com/docs/', mount: 'https://example.com/docs' },
])('docs mounted at $base', ({ base, mount }) => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    { locale: 'en', path: '/self-hosted/install/quickstart' },
    { locale: 'de', path: '/de/self-hosted/install/quickstart' },
    { locale: 'fr', path: '/fr/self-hosted/install/quickstart' },
  ] as const)(
    'keeps the mount before the $locale document path',
    async ({ locale, path }) => {
      vi.stubEnv('VITE_DOCS_URL', base);
      vi.resetModules();
      const urls = await import('./docs-url');

      expect(urls.getSelfHostedQuickstartUrl(locale)).toBe(`${mount}${path}`);
      const prefix = locale === 'en' ? '' : `/${locale}`;
      expect(urls.getDocsUrl(locale)).toBe(`${mount}${prefix || '/'}`);
      expect(urls.getStartedUrl(locale)).toBe(
        `${mount}${prefix}/get-started/quickstart`,
      );
      if (locale === 'en') {
        expect(urls.SELF_HOSTED_QUICKSTART_URL).toBe(`${mount}${path}`);
        expect(urls.GET_STARTED_URL).toBe(`${mount}/get-started/quickstart`);
      }
    },
  );
});
