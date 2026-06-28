import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AppSummary } from '../hooks/use-apps';
import { AppPage } from './app-page';

/**
 * Regression net for #1979: a not-yet-installed app discovered through the
 * built-in catalog must resolve to its pre-install AppDetails page (full
 * description + Install CTA), NOT the "App not found" dead-end. The hub's union
 * surfaces catalog-only apps and links each card to this page, so the page has
 * to fall back to the catalog when the org's installed list doesn't carry the
 * slug — otherwise every discovery card contradicts itself with "App not found".
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
  // A catalog-only app is not installed, so it has no install state.
  useAppInstallStates: () => ({ bySlug: new Map(), isLoading: false }),
  useAppBindings: () => ({ bindings: [], isLoading: false }),
  useAppInstallActions: () => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    verify: vi.fn(),
    isPending: false,
  }),
}));

function catalogApp(overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    slug: 'sample-app',
    name: 'Sample App',
    description: 'A discoverable app from the built-in catalog.',
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

describe('AppPage catalog discovery (#1979)', () => {
  it('renders the pre-install AppDetails for a catalog-only app instead of "App not found"', () => {
    // The org has nothing installed; the catalog carries the discovered app.
    useAppsMock.mockReturnValue({ apps: [], isLoading: false, error: null });
    useAppCatalogMock.mockReturnValue({
      apps: [catalogApp()],
      isLoading: false,
      error: null,
    });

    render(<AppPage organizationId="org_1" appSlug="sample-app" />);

    expect(screen.getByText('Sample App')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.queryByText('App not found')).not.toBeInTheDocument();
  });

  it('still shows "App not found" for a slug in neither the org nor the catalog', () => {
    useAppsMock.mockReturnValue({ apps: [], isLoading: false, error: null });
    useAppCatalogMock.mockReturnValue({
      apps: [catalogApp()],
      isLoading: false,
      error: null,
    });

    render(<AppPage organizationId="org_1" appSlug="missing-app" />);

    expect(
      screen.getByRole('heading', { name: 'App not found', level: 3 }),
    ).toBeInTheDocument();
  });
});
