import { useLocale } from '@tale/ui/i18n/locale-provider';
import { ThemeProvider } from '@tale/ui/theme';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi, list } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { createTestQueryClient, renderApp } from '@/tests/utils/render';

import { createAppRouter } from './router';

/*
 * The router as the app has it, over the real route tree and root route: what
 * an address that no route knows shows, what a page that fails to render shows,
 * and the title the document gets.
 */

/** The failure the Proxies page throws while a test sets one: a page that cannot render. */
const page = vi.hoisted(() => ({ failure: null as Error | null }));

function isComponent(value: unknown): value is ComponentType {
  return typeof value === 'function';
}

vi.mock('@/app/features/proxies/components/proxies-page', async () => {
  const real = await vi.importActual(
    '@/app/features/proxies/components/proxies-page',
  );
  const Real = real.ProxiesPage;
  return {
    ...real,
    ProxiesPage: () => {
      if (page.failure !== null) throw page.failure;
      return isComponent(Real) ? createElement(Real) : null;
    },
  };
});

// The page of a session brings a header of its own; what is in it is the
// business of its own tests.
vi.mock('@/app/features/session-viewer/components/session-page', () => ({
  SessionPage: ({ sessionId }: { sessionId: number | null }) =>
    createElement('h1', null, `Session ${String(sessionId)}`),
}));

/** What a page that offers the language does: picks it through the locale provider, as the app does. */
function PickGerman() {
  const { setLocale } = useLocale();
  return (
    <button type="button" onClick={() => setLocale('de')}>
      Pick German
    </button>
  );
}

function renderAt(
  path: string,
  routes: Parameters<typeof installFakeApi>[0] = {},
) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const api = installFakeApi({
    'GET /meta': meta(),
    'GET /sessions': list([]),
    'GET /proxies': list([]),
    'GET /secrets': list([]),
    ...routes,
  });
  // The client the router's loaders fill is the one the page reads.
  const queryClient = createTestQueryClient();
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    queryClient,
  });
  const view = renderApp(
    <ThemeProvider>
      <RouterProvider router={router} />
      <PickGerman />
    </ThemeProvider>,
    { queryClient },
  );
  return { ...view, router, api };
}

beforeEach(() => {
  document.title = '';
});

afterEach(async () => {
  vi.restoreAllMocks();
  page.failure = null;
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/**
 * Every loading state the page shows from now on: masked rows (the status of a
 * table or a list that loads) or the search box of a list's toolbar.
 */
function watchLoadingStates() {
  const seen = new Set<string>();
  const look = () => {
    if (screen.queryByRole('status', { name: 'Loading content' })) {
      seen.add('masked rows');
    }
    if (screen.queryByRole('textbox', { name: /^Search/ })) {
      seen.add('a search box');
    }
  };
  const observer = new MutationObserver(look);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  return {
    seen: () => {
      observer.disconnect();
      return [...seen];
    },
  };
}

describe('opening a page', () => {
  it.each([
    ['/proxies', 'GET /proxies', 'No proxies yet'],
    ['/secrets', 'GET /secrets', 'No secrets yet'],
    ['/sessions', 'GET /sessions', 'No sessions yet'],
  ])(
    '%s with nothing in it shows its empty state from the first frame, never masked rows or a toolbar that vanish',
    async (path, read, empty) => {
      const states = watchLoadingStates();
      // The list never answers: the counts the root route waits for decide.
      renderAt(path, { [read]: () => new Promise<never>(() => {}) });

      expect(await screen.findByRole('heading', { name: empty })).toBeVisible();
      expect(states.seen()).toEqual([]);
    },
  );

  it('shows the page when the state of the app cannot be read: the page says so itself', async () => {
    renderAt('/proxies', { 'GET /meta': failure(500, 'internal', 'Boom') });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Proxies' }),
    ).toBeVisible();
  });
});

describe('an address that no route knows', () => {
  it('shows the page not found, in the frame of the app, under its one heading', async () => {
    renderAt('/nowhere/at/all');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    // One title, as on the platform: no second heading says the same again.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByText(
        "The page you're looking for doesn't exist or may have been moved.",
      ),
    ).toBeVisible();
    // The rail is there to leave by, with the way back beside it.
    const rail = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(rail).getByRole('link', { name: 'Sessions' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to sessions' }),
    ).toHaveAttribute('href', '/sessions');
  });

  it('titles the document with what it is, then the name of the app', async () => {
    renderAt('/nowhere/at/all');
    await waitFor(() =>
      expect(document.title).toBe('Page not found - Session Manager'),
    );
  });

  it.each([
    ['/settings/nowhere'],
    ['/sessions/5/nowhere'],
    ['/proxies/nowhere'],
    ['/secrets/nowhere'],
  ])(
    'shows the same page for %s, not inside the layout of the section',
    async (path) => {
      renderAt(path);

      await screen.findByRole('heading', { level: 1, name: 'Page not found' });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      // The pages of Settings are no part of it.
      expect(
        screen.queryByRole('navigation', { name: 'Settings pages' }),
      ).toBeNull();
      await waitFor(() =>
        expect(document.title).toBe('Page not found - Session Manager'),
      );
    },
  );

  it('leads back to the sessions, which title the document as they always do', async () => {
    const { router, user } = renderAt('/nowhere');

    await user.click(
      await screen.findByRole('link', { name: 'Back to sessions' }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/sessions'),
    );
    await screen.findByRole('heading', { level: 1, name: 'Sessions' });
    expect(document.title).toBe('Sessions - Session Manager');
    expect(
      screen.queryByRole('heading', { name: 'Page not found' }),
    ).toBeNull();
  });

  it('is said in the language shown', async () => {
    localStorage.setItem('user-locale', 'de');
    await i18n.changeLanguage('de');
    renderAt('/nowhere');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Seite nicht gefunden',
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(document.title).toBe('Seite nicht gefunden - Session Manager'),
    );
  });

  it('has no accessibility violations in the frame of the app', async () => {
    const view = renderAt('/nowhere');
    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    await checkAccessibility(view);
  });
});

describe('an address that a route knows', () => {
  it.each([
    ['/sessions', 'Sessions'],
    ['/proxies', 'Proxies'],
    ['/secrets', 'Secrets'],
  ])(
    'shows %s, titles the document with it, and no page not found',
    async (path, name) => {
      renderAt(path);

      await screen.findByRole('heading', { level: 1, name });
      expect(
        screen.queryByRole('heading', { name: 'Page not found' }),
      ).toBeNull();
      await waitFor(() =>
        expect(document.title).toBe(`${name} - Session Manager`),
      );
    },
  );

  it('opens on the sessions at the root address, which names no page of its own', async () => {
    const { router } = renderAt('/');

    await screen.findByRole('heading', { level: 1, name: 'Sessions' });
    expect(router.state.location.pathname).toBe('/sessions');
    await waitFor(() =>
      expect(document.title).toBe('Sessions - Session Manager'),
    );
  });

  it('words the title again when the language changes, wherever the person is', async () => {
    const { user } = renderAt('/sessions');
    await waitFor(() =>
      expect(document.title).toBe('Sessions - Session Manager'),
    );

    await user.click(screen.getByRole('button', { name: 'Pick German' }));

    await waitFor(() =>
      expect(document.title).toBe('Sitzungen - Session Manager'),
    );
  });
});

describe('a page that fails to render', () => {
  const MESSAGE = 'boom: render failed at /secret/internal/path.ts:12';

  beforeEach(() => {
    // React and the router both log a caught render error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    page.failure = new Error(MESSAGE);
  });

  it('shows the error page of the platform, with a way on and none of the words of the error', async () => {
    renderAt('/proxies');

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', {
        level: 1,
        name: 'Something went wrong. Try again.',
      }),
    ).toBeVisible();
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toBeVisible();
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.queryByText(/internal\/path/)).toBeNull();
  });

  it('shows the error behind Show details, and hides it again', async () => {
    const { user } = renderAt('/proxies');

    await user.click(
      await screen.findByRole('button', { name: 'Show details' }),
    );
    expect(screen.getByText(/boom: render failed/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it('tries the page again, and shows it once it renders', async () => {
    const { user } = renderAt('/proxies');
    const retry = await screen.findByRole('button', { name: 'Try again' });

    page.failure = null;
    await user.click(retry);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Proxies' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reloads the page, not the route, when the page could not fetch its chunk', async () => {
    // A tab that outlived an update: the route keeps the failed import for the
    // page's lifetime, so rendering it again would fail again.
    page.failure = new TypeError(
      'Failed to fetch dynamically imported module: http://127.0.0.1:3004/assets/proxies-C4h9kQ2x.js',
    );
    // jsdom does not navigate: the reload is the test's own.
    const reload = vi.fn();
    const { href, origin, pathname, search, hash } = window.location;
    vi.stubGlobal('location', { href, origin, pathname, search, hash, reload });
    const { user } = renderAt('/proxies');
    const retry = await screen.findByRole('button', { name: 'Try again' });

    page.failure = null;
    await user.click(retry);

    expect(reload).toHaveBeenCalledTimes(1);
    // Rendering the route again would show the page now that it can render.
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Proxies' }),
    ).toBeNull();
    expect(screen.getByRole('alert')).toBeVisible();
    vi.unstubAllGlobals();
  });

  it('is said in the language shown', async () => {
    localStorage.setItem('user-locale', 'de');
    await i18n.changeLanguage('de');
    renderAt('/proxies');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Etwas ist schiefgelaufen. Versuch es erneut.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' }),
    ).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderAt('/proxies');
    await screen.findByRole('alert');
    await checkAccessibility(view);
  });
});

/*
 * The bar above the page on a phone holds the title a page puts in the adaptive
 * header (`AppFrame`). A `header` inside `main` has no landmark role, so the
 * element is the only handle there is.
 */
describe('the bar of the frame, on a phone', () => {
  const bar = () => screen.getByRole('main').querySelector('header');

  it('is drawn for a section, whose page puts its title in it', async () => {
    renderAt('/proxies');
    await screen.findByRole('heading', { level: 1, name: 'Proxies' });
    expect(bar()).not.toBeNull();
  });

  it('is left out for the page of a session, which brings a header of its own', async () => {
    renderAt('/sessions/5');
    await screen.findByRole('heading', { level: 1, name: 'Session 5' });
    expect(bar()).toBeNull();
  });

  it.each([['/nowhere/at/all'], ['/sessions/5/nowhere']])(
    'is left out for the page that says there is no page, at %s',
    async (path) => {
      renderAt(path);
      await screen.findByRole('heading', { level: 1, name: 'Page not found' });
      expect(bar()).toBeNull();
    },
  );

  it('is drawn again when the person goes from there to a section', async () => {
    const { user } = renderAt('/nowhere');
    await user.click(
      await screen.findByRole('link', { name: 'Back to sessions' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Sessions' });
    expect(bar()).not.toBeNull();
  });
});
