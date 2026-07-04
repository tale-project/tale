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

const { useAppsMock, useAppCatalogMock } = vi.hoisted(() => ({
  useAppsMock: vi.fn(),
  useAppCatalogMock: vi.fn(),
}));

vi.mock('../hooks/use-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-apps')>()),
  useApps: useAppsMock,
  useAppCatalog: useAppCatalogMock,
}));

vi.mock('../hooks/use-install-state', () => ({
  // Keep the install-state map empty so every card renders the catalog
  // (not-installed) Install branch; the union we are testing comes from
  // useApps (installed list) vs useAppCatalog, independent of install state.
  useAppInstallStates: () => ({ bySlug: new Map(), isLoading: false }),
  useAppInstallActions: () => ({ install: vi.fn(), isPending: false }),
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
  // those titles rather than card-level links — the refactor moved navigation
  // into the footer action (Open/Install), so install-state-empty cards no
  // longer carry a link, but the union/precedence/sort invariant is unchanged.
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
