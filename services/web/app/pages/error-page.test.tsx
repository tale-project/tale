/**
 * A page that cannot load shows the site's own error page — localized,
 * inside the header and footer, without the error — instead of TanStack's
 * English "Something went wrong!". Each case renders the real route tree with
 * the options of `app/router.tsx`, and makes the use-case loader's content
 * fail the way a dropped connection or a deploy makes it fail.
 */

import { AppShell } from '@tale/ui/app-shell';
import { reportBrowserError } from '@tale/ui/monitoring/browser';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  listMarketingContent,
  loadMarketingContent,
} from '@/lib/content/client';
import { marketingContentHeading } from '@/lib/content/model';
import { i18n } from '@/lib/i18n/i18n';
import { localizedPath, type SupportedLocale } from '@/lib/i18n/locales';
import { reloadPage } from '@/lib/stale-bundle-reload';

import { router as siteRouter } from '../router';
import { ErrorPage } from './error-page';

vi.mock('@tale/ui/monitoring/browser', () => ({
  initBrowserMonitoring: vi.fn(),
  reportBrowserError: vi.fn(),
}));
vi.mock('@/lib/content/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/client')>();
  return {
    ...actual,
    loadMarketingContent: vi.fn(actual.loadMarketingContent),
  };
});
vi.mock('@/lib/stale-bundle-reload', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/stale-bundle-reload')>();
  return { ...actual, reloadPage: vi.fn() };
});

const PREFIX: Record<SupportedLocale, string> = {
  en: '',
  de: '/de',
  fr: '/fr',
};

/** A published use case of `locale`, and the address that opens it. */
function useCase(locale: SupportedLocale) {
  const page = listMarketingContent('use-cases', locale).find(
    (entry) => entry.slug !== 'index',
  );
  if (!page) throw new Error(`no ${locale} use case to open`);
  return {
    path: `${PREFIX[locale]}/use-cases/${page.slug}`,
    heading: marketingContentHeading(page.frontmatter.title),
  };
}

/** The site at `path`, routed as `app/router.tsx` routes it. */
function renderSite(path: string) {
  const router = createRouter({
    ...siteRouter.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <AppShell i18n={i18n} theme>
      <RouterProvider router={router} />
    </AppShell>,
  );
  return router;
}

/** jsdom scrolls nothing into view, so a guide's product capture stays still. */
class StillIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly scrollMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeAll(() => {
  // The theme follows the system, which jsdom has no media queries to ask.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('IntersectionObserver', StillIntersectionObserver);
  // The router resets the scroll position after each navigation.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the page a failed load leaves', () => {
  it('is the router-wide error page', () => {
    expect(siteRouter.options.defaultErrorComponent).toBe(ErrorPage);
  });

  it.each(['en', 'de', 'fr'] as const)(
    'reads in %s inside the site chrome, hides the error and loads the page on Try again',
    async (locale) => {
      const user = userEvent.setup();
      const { path, heading } = useCase(locale);
      const failure = new TypeError('Failed to fetch');
      vi.mocked(loadMarketingContent).mockRejectedValueOnce(failure);
      const t = i18n.getFixedT(locale, 'pageError');

      renderSite(path);

      const title = await screen.findByRole('heading', {
        level: 1,
        name: t('title'),
      });
      const alert = screen.getByRole('alert');
      expect(alert.contains(title)).toBe(true);
      expect(alert.textContent).toContain(t('body'));
      // The page sits where the guide would, between the site's header and
      // footer.
      expect(screen.getByRole('main').contains(alert)).toBe(true);
      expect(screen.getByRole('banner')).toBeTruthy();
      expect(screen.getByRole('contentinfo')).toBeTruthy();
      // What failed goes to the error reporter, never onto the page.
      expect(document.body.textContent).not.toContain(failure.message);
      expect(document.body.textContent).not.toContain('Something went wrong');
      expect(reportBrowserError).toHaveBeenCalledWith(
        failure,
        expect.anything(),
      );
      expect(
        screen
          .getByRole('link', {
            name: i18n.getFixedT(locale, 'notFound')('backHome'),
          })
          .getAttribute('href'),
      ).toBe(localizedPath(locale, '/'));

      await user.click(screen.getByRole('button', { name: t('retry') }));

      expect(
        await screen.findByRole('heading', { level: 1, name: heading }),
      ).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(loadMarketingContent).toHaveBeenCalledTimes(2);
      expect(reloadPage).not.toHaveBeenCalled();
    },
  );

  it('reloads on Try again after a chunk the page could not fetch', async () => {
    const user = userEvent.setup();
    const { path } = useCase('en');
    vi.mocked(loadMarketingContent).mockRejectedValueOnce(
      new TypeError(
        'Failed to fetch dynamically imported module: https://tale.dev/assets/operations-C4h9kQ2x.js',
      ),
    );
    const t = i18n.getFixedT('en', 'pageError');

    renderSite(path);

    await user.click(await screen.findByRole('button', { name: t('retry') }));

    // A failed dynamic import stays failed for the page's lifetime: only a
    // new page fetches the current build.
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(loadMarketingContent).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole('alert')).getByRole('heading', { level: 1 }),
    ).toBeTruthy();
  });
});
