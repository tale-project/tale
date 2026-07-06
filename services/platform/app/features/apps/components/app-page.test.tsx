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

const {
  useAppsMock,
  useAppCatalogMock,
  useAppInstallStatesMock,
  useAppBindingsMock,
  useAppConfigMock,
} = vi.hoisted(() => ({
  useAppsMock: vi.fn(),
  useAppCatalogMock: vi.fn(),
  useAppInstallStatesMock: vi.fn(),
  useAppBindingsMock: vi.fn(),
  useAppConfigMock: vi.fn(),
}));

vi.mock('../hooks/use-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-apps')>()),
  useApps: useAppsMock,
  useAppCatalog: useAppCatalogMock,
}));

vi.mock('../hooks/use-install-state', () => ({
  useAppInstallStates: useAppInstallStatesMock,
  useAppBindings: useAppBindingsMock,
  useAppInstallActions: () => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    verify: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../hooks/use-app-config', () => ({
  useAppConfig: useAppConfigMock,
}));

// The installed body renders the config drawer (Convex-backed form) and the ⋯
// lifecycle menu; stub both to probes so the banner assertions stay focused on
// the derived `isConfigured` state without pulling in Convex machinery.
vi.mock('./app-config-drawer', () => ({
  AppConfigDrawer: () => null,
}));
vi.mock('./app-lifecycle-actions', () => ({
  AppLifecycleActions: () => null,
}));

// Probe the wizard as a lightweight open/closed marker so the test asserts the
// details page keeps hosting it across the install-state transition, without
// pulling in the wizard's Convex/integration machinery.
vi.mock('./install-wizard/app-install-wizard', () => ({
  AppInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>wizard step probe</div> : null,
}));

// The installed views (MembershipHub/InstalledAppBody) reach into Convex-backed
// readiness; stub them so the #2341 test observes a clean assertion (the wizard
// disappearing on the old code) rather than a Convex-provider crash.
vi.mock('../hooks/use-app-agent-readiness', () => ({
  useAppAgentReadiness: () => ({ agents: [], refetch: vi.fn() }),
}));
vi.mock('../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: () => ({
    required: [],
    blockedSlugs: [],
    isLoading: false,
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
  // Default: nothing installed, so an app resolves to its pre-install details.
  useAppInstallStatesMock.mockReturnValue({
    bySlug: new Map(),
    isLoading: false,
  });
  useAppBindingsMock.mockReturnValue({ bindings: [], isLoading: false });
  useAppConfigMock.mockReturnValue({ config: {}, isLoading: false });
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

  it('resolves the installed entry over a same-slug catalog entry (installed wins)', () => {
    // The same slug exists in both the org's installed list and the catalog;
    // the page must resolve the installed entry (it carries the full per-install
    // data) rather than the catalog projection.
    useAppsMock.mockReturnValue({
      apps: [
        catalogApp({ name: 'Installed Sample', description: 'Org install.' }),
      ],
      isLoading: false,
      error: null,
    });
    useAppCatalogMock.mockReturnValue({
      apps: [catalogApp({ name: 'Catalog Sample', description: 'Catalog.' })],
      isLoading: false,
      error: null,
    });

    render(<AppPage organizationId="org_1" appSlug="sample-app" />);

    expect(screen.getByText('Installed Sample')).toBeInTheDocument();
    expect(screen.queryByText('Catalog Sample')).not.toBeInTheDocument();
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

/**
 * Regression net for #2341: the pre-install details page hosts the install
 * wizard. The wizard's Install step installs the app, which flips the reactive
 * install state to defined — and AppPage keys the details page on `!state`.
 * Before the fix that transition unmounted the details page (and its open
 * wizard) mid-flow, so a project-scoped install closed silently after Install
 * instead of continuing to its integration/Done steps.
 */
describe('AppPage keeps the install wizard mounted across install (#2341)', () => {
  const projectApp = () =>
    catalogApp({
      slug: 'issue-desk',
      name: 'Issue Resolution Desk',
      scope: 'project',
    });

  it('keeps hosting the wizard after the install lands install state', async () => {
    useAppsMock.mockReturnValue({ apps: [], isLoading: false, error: null });
    useAppCatalogMock.mockReturnValue({
      apps: [projectApp()],
      isLoading: false,
      error: null,
    });

    const { user, rerender } = render(
      <AppPage organizationId="org_1" appSlug="issue-desk" />,
    );

    // Open the wizard from the pre-install details page.
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(screen.getByText('wizard step probe')).toBeInTheDocument();

    // The Install step installs the app: its reactive state now resolves. The
    // details page must survive this so the wizard reaches its later steps.
    useAppInstallStatesMock.mockReturnValue({
      bySlug: new Map([
        ['issue-desk', { status: 'active', blockedIntegrations: [] }],
      ]),
      isLoading: false,
    });
    rerender(<AppPage organizationId="org_1" appSlug="issue-desk" />);

    expect(screen.getByText('wizard step probe')).toBeInTheDocument();
  });
});

/**
 * Regression net for #2349: the "Configuration needed" banner must clear once
 * every REQUIRED config field has a value — a field marked `optional` (e.g.
 * issue-desk's auto-detected test command / free-text repo notes) must not hold
 * it open. Before the fix `isConfigured` required EVERY declared field, so an
 * operator who set only the repository saw the banner persist forever (even
 * across a reload) while the data panels loaded with the saved repo.
 */
describe('AppPage config banner clears once required fields are set (#2349)', () => {
  const bannerTitle = 'Configuration needed';

  function renderBound(config: Record<string, unknown>) {
    const app = catalogApp({
      slug: 'issue-desk',
      name: 'Issue Resolution Desk',
      scope: 'project',
      requiredConfig: [
        {
          key: 'repository',
          type: 'string',
          labelKey: 'issueDesk.config.repository',
        },
        {
          key: 'testCommand',
          type: 'string',
          optional: true,
          labelKey: 'issueDesk.config.testCommand',
        },
        {
          key: 'repoNotes',
          type: 'string',
          optional: true,
          labelKey: 'issueDesk.config.repoNotes',
        },
      ],
    });
    useAppsMock.mockReturnValue({ apps: [app], isLoading: false, error: null });
    useAppCatalogMock.mockReturnValue({
      apps: [],
      isLoading: false,
      error: null,
    });
    useAppInstallStatesMock.mockReturnValue({
      bySlug: new Map([
        ['issue-desk', { status: 'active', blockedIntegrations: [] }],
      ]),
      isLoading: false,
    });
    useAppBindingsMock.mockReturnValue({
      bindings: [{ projectId: 'proj_1', projectName: 'Project One' }],
      isLoading: false,
    });
    useAppConfigMock.mockReturnValue({ config, isLoading: false });
    render(
      <AppPage
        organizationId="org_1"
        appSlug="issue-desk"
        projectId="proj_1"
      />,
    );
  }

  it('hides the banner when the required field is set but optional fields are blank', () => {
    renderBound({
      repository: 'tale-project/tale',
      owner: 'tale-project',
      repo: 'tale',
    });
    expect(screen.queryByText(bannerTitle)).not.toBeInTheDocument();
  });

  it('shows the banner while the required field is still empty', () => {
    renderBound({});
    expect(screen.getByText(bannerTitle)).toBeInTheDocument();
  });
});
