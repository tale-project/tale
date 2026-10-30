import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

/**
 * What's new reads the person's changelog state, then the release feed back
 * to the version they last saw. A state that cannot be read must not leave
 * the page on a bare spinner, and a feed that lists nothing is not "You're
 * up to date" (#4900).
 */

const h = vi.hoisted(() => ({ search: {} as { from?: string; to?: string } }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => h.search,
  }),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, values?: Record<string, unknown>) =>
      [`${ns}.${key}`, ...Object.values(values ?? {})].join(' '),
  }),
}));
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));
vi.mock('@/app/features/changelog/components/changelog-back-button', () => ({
  ChangelogBackButton: () => null,
}));

import { Route } from './changelog';

const ChangelogPage = (Route as unknown as { component: () => ReactNode })
  .component;

const CURRENT_VERSION = '0.5.9';

function release(version: string) {
  return {
    tag: `v${version}`,
    version,
    name: null,
    body: `<p>Notes for ${version}</p>`,
    htmlUrl: `https://github.com/tale-project/tale/releases/tag/v${version}`,
    publishedAt: null,
  };
}

let queryClient: QueryClient;
let fetch: MockInstance<typeof globalThis.fetch>;
let stateAnswer: () => Response;
let releasesAnswer: () => Response;

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): URL {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, 'http://tale.test');
}

/** The `from` each read of the release feed asked for (`null`: none). */
const feedReads = () =>
  fetch.mock.calls
    .map(([input]) => urlOf(input))
    .filter(({ pathname }) => pathname === '/api/app/changelog/releases')
    .map(({ searchParams }) => searchParams.get('from'));

function renderPage() {
  return render(<ChangelogPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  // The state read keeps its own retry policy; only the pause between
  // attempts is cut short here.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  h.search = {};
  window.__ENV__ = { TALE_VERSION: CURRENT_VERSION };
  stateAnswer = () =>
    Response.json({
      state: {
        userId: 'u-mia',
        lastSeenChangelogVersion: '0.5.7',
        lastToastedVersion: CURRENT_VERSION,
        updatedAt: 0,
      },
    });
  releasesAnswer = () =>
    Response.json({
      releases: [release('0.5.9'), release('0.5.8'), release('0.5.7')],
    });
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { pathname } = urlOf(input);
    if (pathname === '/api/app/users/notification-state') return stateAnswer();
    if (pathname === '/api/app/users/notification-state/changelog-seen') {
      return Response.json({ ok: true });
    }
    if (pathname === '/api/app/changelog/releases') return releasesAnswer();
    throw new Error(`Unexpected request to ${pathname}`);
  });
});
afterEach(() => {
  cleanup();
  // Clearing cancels a read still retrying, before `fetch` is real again.
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('What’s new', () => {
  it('reads the feed back to the version the person last saw', async () => {
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'v0.5.9' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v0.5.8' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'v0.5.7' })).toBeNull();
    expect(feedReads()).toEqual(['0.5.7']);
  });

  it('reads the current release’s notes when the person’s changelog state cannot be read', async () => {
    stateAnswer = () => Response.json({ error: 'INTERNAL' }, { status: 500 });

    renderPage();

    expect(
      await screen.findByRole('button', { name: 'v0.5.9' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(feedReads()).toEqual([null]);
  });

  it('says the notes could not be loaded, not that the person is up to date, when the feed lists no release', async () => {
    releasesAnswer = () => Response.json({ releases: [] });

    renderPage();

    expect(
      await screen.findByText('changelog.viewer.error'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'changelog.viewer.githubLink' }),
    ).toHaveAttribute('href', 'https://github.com/tale-project/tale/releases');
    expect(screen.queryByText('changelog.viewer.upToDate')).toBeNull();
  });
});
