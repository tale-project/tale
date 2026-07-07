import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AppSummary } from '../hooks/use-apps';
import { AppsGrid } from './apps-grid';

/**
 * Regression net for #1979 (the heart of gap #1, in-UI discovery): the hub
 * renders the UNION of the org's installed apps and the built-in catalog, keyed
 * by slug, with the installed entry winning a same-slug collision (it carries
 * the full per-install data) and the result sorted by name. A loop-order or
 * precedence regression here would silently drop installed apps' data, so the
 * union/precedence/sort is asserted directly.
 */

const { useAppsMock, useAppCatalogMock, useAppInstallStatesMock } = vi.hoisted(
  () => ({
    useAppsMock: vi.fn(),
    useAppCatalogMock: vi.fn(),
    useAppInstallStatesMock: vi.fn(),
  }),
);

vi.mock('../hooks/use-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-apps')>()),
  useApps: useAppsMock,
  useAppCatalog: useAppCatalogMock,
}));

vi.mock('../hooks/use-install-state', () => ({
  // Defaults to an empty install-state map (see beforeEach) so every card
  // renders the catalog (not-installed) Install branch; the union tests come
  // from useApps (installed list) vs useAppCatalog, independent of install
  // state. The #2554 navigation tests override it to reach the installed
  // (Open) branch.
  useAppInstallStates: useAppInstallStatesMock,
  useAppInstallActions: () => ({ install: vi.fn(), isPending: false }),
}));

// The delete affordance's mutation hook needs a Convex client the test harness
// doesn't provide — stub it (the behaviour under test is which cards render the
// Private badge + Delete menu, not the delete call itself).
vi.mock('../hooks/upload-mutations', () => ({
  useDeleteApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Render the card Link as a plain anchor (no router needed); aria-label carries
// the app name so we can assert the rendered set and its order.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    ...props
  }: Record<string, unknown>) =>
    // href gives the anchor its implicit "link" role for getByRole queries.
    createElement(
      'a',
      { href: '#', ...(props as Record<string, unknown>) },
      children as never,
    ),
}));

function app(overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    slug: 'sample-app',
    name: 'Sample App',
    description: 'A discoverable app.',
    scope: 'org',
    workflows: [],
    agents: [],
    functions: [],
    requiredIntegrations: [],
    requiredConfig: [],
    views: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppInstallStatesMock.mockReturnValue({
    bySlug: new Map(),
    isLoading: false,
  });
});

describe('AppsGrid catalog/installed union (#1979)', () => {
  it('renders a card-grid skeleton while the union loads', () => {
    useAppsMock.mockReturnValue({
      apps: [],
      isLoading: true,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [],
      isLoading: true,
      error: null,
    });

    const { container } = render(<AppsGrid organizationId="org_1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Apps');
    // Six icon tiles — one per placeholder card in the loading grid.
    expect(container.getElementsByClassName('size-9')).toHaveLength(6);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // The card title is the union's identity: CatalogCard renders the app name
  // as the card's title text, in DOM order = the sorted union. Assert against
  // those titles rather than card-level links (covered separately by the
  // #2554 navigation tests below) so the union/precedence/sort invariant
  // stays independent of the card's link markup.
  it('renders the union of installed and catalog apps, keyed by slug', () => {
    useAppsMock.mockReturnValue({
      apps: [app({ slug: 'installed-only', name: 'Installed Only' })],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [app({ slug: 'catalog-only', name: 'Catalog Only' })],
      isLoading: false,
      error: null,
    });

    render(<AppsGrid organizationId="org_1" />);

    expect(
      screen
        .getAllByText(/Catalog Only|Installed Only/)
        .map((el) => el.textContent),
    ).toStrictEqual(['Catalog Only', 'Installed Only']);
  });

  it('lets an installed entry win a same-slug catalog collision', () => {
    useAppsMock.mockReturnValue({
      apps: [
        app({
          slug: 'shared',
          name: 'Installed Shared',
          description: 'From the org install.',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [
        app({
          slug: 'shared',
          name: 'Catalog Shared',
          description: 'From the built-in catalog.',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<AppsGrid organizationId="org_1" />);

    // One card for the slug, carrying the installed entry's data.
    expect(screen.getAllByText(/Shared/)).toHaveLength(1);
    expect(screen.getByText('Installed Shared')).toBeInTheDocument();
    expect(screen.getByText('From the org install.')).toBeInTheDocument();
    expect(screen.queryByText('Catalog Shared')).not.toBeInTheDocument();
  });

  // #2355: a private (uploaded) app lives in the org install list but not the
  // built-in catalog. It must be distinguishable (a "Private" badge) and
  // deletable (a Delete ⋯ menu) — a built-in catalog card gets neither.
  it('badges + offers Delete only for a private (uploaded) app', () => {
    useAppsMock.mockReturnValue({
      apps: [app({ slug: 'my-upload', name: 'My Upload' })],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [app({ slug: 'builtin', name: 'Builtin App' })],
      isLoading: false,
      error: null,
    });

    render(<AppsGrid organizationId="org_1" />);

    // Exactly one Private badge — on the uploaded app, not the built-in one.
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete My Upload' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete Builtin App' }),
    ).not.toBeInTheDocument();
  });

  it('sorts the union by name', () => {
    useAppsMock.mockReturnValue({
      apps: [app({ slug: 'zebra', name: 'Zebra' })],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [
        app({ slug: 'mango', name: 'Mango' }),
        app({ slug: 'apple', name: 'Apple' }),
      ],
      isLoading: false,
      error: null,
    });

    render(<AppsGrid organizationId="org_1" />);

    expect(
      screen.getAllByText(/Apple|Mango|Zebra/).map((el) => el.textContent),
    ).toStrictEqual(['Apple', 'Mango', 'Zebra']);
  });
});

/**
 * Regression net for #2554: every hub card — including an AVAILABLE
 * (uninstalled) one, whose only footer action is the Install button — must be
 * a real link to the app's detail page with accessible name = the app name
 * (apps.md A1), so the detail page is reachable by mouse and keyboard from
 * the hub. The card link is a stretched overlay; the footer actions must stay
 * operable above it.
 */
describe('AppsGrid card navigation (#2554)', () => {
  it('renders an available (uninstalled) app card as a link named after the app', () => {
    useAppsMock.mockReturnValue({ apps: [], isLoading: false, error: null });
    useAppCatalogMock.mockReturnValue({
      apps: [app({ slug: 'issue-desk', name: 'Issue resolution desk' })],
      isLoading: false,
      error: null,
    });

    render(<AppsGrid organizationId="org_1" />);

    // A real anchor (keyboard reachable by role) with a11y name = app name.
    expect(
      screen.getByRole('link', { name: 'Issue resolution desk' }),
    ).toBeInTheDocument();
    // The Install action still renders alongside the card link.
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
  });

  it('renders an installed app card as a link named after the app, next to Open', () => {
    useAppsMock.mockReturnValue({
      apps: [app({ slug: 'installed-app', name: 'Installed App' })],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [app({ slug: 'installed-app', name: 'Installed App' })],
      isLoading: false,
      error: null,
    });
    useAppInstallStatesMock.mockReturnValue({
      bySlug: new Map([
        [
          'installed-app',
          {
            appSlug: 'installed-app',
            status: 'active' as const,
            installedAt: 1,
            blockedIntegrations: [],
          },
        ],
      ]),
      isLoading: false,
    });

    render(<AppsGrid organizationId="org_1" />);

    expect(
      screen.getByRole('link', { name: 'Installed App' }),
    ).toBeInTheDocument();
    // The footer Open link stays a distinct, operable control above the
    // card's overlay link.
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
  });
});
