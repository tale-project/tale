import { cloneElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import type { AutomationInstallState } from '../hooks/use-install-state';
import { AutomationsGrid, type AutomationsGridProps } from './automations-grid';

/**
 * Regression net for #1979 (the heart of gap #1, in-UI discovery): the
 * catalog renders the UNION of the org's installed automations and the built-in
 * catalog, keyed by slug, with the installed entry winning a same-slug
 * collision (it carries the full per-install data) and the result sorted by
 * name. A loop-order or precedence regression here would silently drop
 * installed automations' data, so the union/precedence/sort is asserted directly —
 * on the All tab, which shows the whole union (the catalog lands on
 * Installed).
 *
 * Card behaviour (product N2): the whole card is the click target — a
 * not-installed automation opens `AutomationPanel` (mocked below as a lightweight
 * probe, its own content is `automation-panel.test.tsx`'s job); an installed
 * automation navigates to its automation page. Every card also carries a ⋯ menu.
 */

const { useAutomationsMock, useAutomationCatalogMock } = vi.hoisted(() => ({
  useAutomationsMock: vi.fn(),
  useAutomationCatalogMock: vi.fn(),
}));

vi.mock('../hooks/use-automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-automations')>()),
  useAutomations: useAutomationsMock,
  useAutomationCatalog: useAutomationCatalogMock,
}));

// Install-state map, settable per test: empty ⇒ every card renders the
// not-installed ⋯ menu (Install [+ Delete]); entries flip cards to the
// installed ⋯ menu (Reinstall/Uninstall) and populate the Installed tab.
let mockInstallStates = new Map<string, AutomationInstallState>();

const installMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/use-install-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-install-state')>()),
  useAutomationInstallStates: () => ({
    bySlug: mockInstallStates,
    isLoading: false,
  }),
  useAutomationInstallActions: () => ({
    install: installMock,
    isPending: false,
  }),
}));

// The delete affordance's mutation hook needs a Convex client the test harness
// doesn't provide — stub it (the behaviour under test is which cards' ⋯ menu
// offers Delete, not the delete call itself).
vi.mock('../hooks/upload-mutations', () => ({
  useDeleteAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// An installed card's ⋯ menu renders the real `AutomationLifecycleActions`,
// whose Export action pulls a Convex action hook the harness has no client for
// — stub it (the behaviour under test is the menu's Reinstall/Uninstall items,
// not the export call itself). Mirrors integrations'/skills' catalog tests.
vi.mock('../hooks/use-export-automation', () => ({
  useExportAutomation: () => ({ mutateAsync: vi.fn() }),
}));

// The not-installed card's fast Install path can route through the wizard
// (project-scoped / required-integrations automations); probe it as a lightweight
// open/closed marker rather than pulling in its Convex machinery.
vi.mock('./install-wizard/automation-install-wizard', () => ({
  AutomationInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>wizard step probe</div> : null,
}));

// A bundle's ⋯ menu Install ALWAYS routes through its own aggregated wizard;
// same lightweight probe.
vi.mock('./install-wizard/bundle-install-wizard', () => ({
  BundleInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>bundle wizard step probe</div> : null,
}));

// The full preview panel is `automation-panel.test.tsx`'s job; stub it here so
// the grid's own tests stay about WHICH card opens it with WHICH automation.
vi.mock('./automation-panel', () => ({
  AutomationPanel: ({
    automation: panelAutomation,
  }: {
    automation: { name: string };
  }) => <div data-testid="automation-panel">{panelAutomation.name}</div>,
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

function automationSummary(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    slug: 'sample-automation',
    name: 'Sample Automation',
    description: 'A discoverable automation.',
    scope: 'org',
    kind: 'automation',
    workflows: [],
    agents: [],
    skills: [],
    functions: [],
    requiredIntegrations: [],
    views: [],
    ...overrides,
  };
}

function installState(
  automationSlug: string,
  overrides: Partial<AutomationInstallState> = {},
): AutomationInstallState {
  return {
    automationSlug,
    status: 'active',
    installedAt: 1,
    blockedIntegrations: [],
    ...overrides,
  };
}

/**
 * Render the catalog on the All tab (the full catalog union). The Installed/All
 * switch moved out of the toolbar into the page header's shared `TabNavigation`
 * (`AutomationsNavigation`), so the grid now takes it as a prop rather than
 * owning it — there is no in-grid tab to click.
 */
function renderAllTab(ui: ReactElement<AutomationsGridProps>) {
  return render(cloneElement(ui, { tab: 'all' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  installMock.mockResolvedValue(undefined);
  mockInstallStates = new Map();
});

describe('AutomationsGrid catalog/installed union (#1979)', () => {
  it('renders a card-grid skeleton while the union loads', () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: true,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [],
      isLoading: true,
      error: null,
    });

    const { container } = render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Automations');
    // Six icon tiles — one per placeholder card in the shared loading grid.
    expect(container.getElementsByClassName('size-10')).toHaveLength(6);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The card title is the union's identity: CatalogCard renders the automation name
  // as the card's title text, in DOM order = the sorted union.
  it('renders the union of installed and catalog automations, keyed by slug', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'installed-only', name: 'Installed Only' }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'catalog-only', name: 'Catalog Only' }),
      ],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(
      screen
        .getAllByText(/Catalog Only|Installed Only/)
        .map((el) => el.textContent),
    ).toStrictEqual(['Catalog Only', 'Installed Only']);
  });

  it('lets an installed entry win a same-slug catalog collision', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'shared',
          name: 'Installed Shared',
          description: 'From the org install.',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'shared',
          name: 'Catalog Shared',
          description: 'From the built-in catalog.',
        }),
      ],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    // One card for the slug, carrying the installed entry's data.
    expect(screen.getAllByText(/Shared/)).toHaveLength(1);
    expect(screen.getByText('Installed Shared')).toBeInTheDocument();
    expect(screen.getByText('From the org install.')).toBeInTheDocument();
    expect(screen.queryByText('Catalog Shared')).not.toBeInTheDocument();
  });

  // #2355: a private (uploaded) automation lives in the org install list but not the
  // built-in catalog. It must be distinguishable (a "Custom" corner glyph) and
  // deletable (a Delete item in its ⋯ menu) — a built-in catalog card gets
  // neither.
  it('badges + offers Delete only for a private (uploaded) automation', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'my-upload', name: 'My Upload' }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'builtin', name: 'Builtin Automation' }),
      ],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    // Exactly one "Custom" marker — on the uploaded automation, not the built-in one.
    expect(screen.getByText('Custom')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage My Upload' }));
    expect(
      screen.getByRole('menuitem', { name: 'Delete upload' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(
      screen.getByRole('button', { name: 'Manage Builtin Automation' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Install' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete upload' }),
    ).not.toBeInTheDocument();
  });

  it('sorts the union by name', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [automationSummary({ slug: 'zebra', name: 'Zebra' })],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'mango', name: 'Mango' }),
        automationSummary({ slug: 'apple', name: 'Apple' }),
      ],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(
      screen.getAllByText(/Apple|Mango|Zebra/).map((el) => el.textContent),
    ).toStrictEqual(['Apple', 'Mango', 'Zebra']);
  });
});

describe('AutomationsGrid card click behaviour', () => {
  it('opens the AutomationPanel for a not-installed card click', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'discoverable',
          name: 'Discoverable Automation',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(screen.queryByTestId('automation-panel')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Discoverable Automation' }),
    );
    expect(screen.getByTestId('automation-panel')).toHaveTextContent(
      'Discoverable Automation',
    );
  });

  it('navigates to the automation page for an installed card click', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'live', name: 'Live Automation' }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([['live', installState('live')]]);

    const { user } = render(<AutomationsGrid organizationId="org_1" />);

    await user.click(screen.getByRole('button', { name: 'Live Automation' }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org_1', automationSlug: 'live' },
    });
  });

  it("runs the one-click Install from a not-installed card's ⋯ menu", async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'quick', name: 'Quick Automation' }),
      ],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    await user.click(
      screen.getByRole('button', { name: 'Manage Quick Automation' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Install' }));

    expect(installMock).toHaveBeenCalledWith('quick');
    // The one-click path never needs the wizard.
    expect(screen.queryByText('wizard step probe')).not.toBeInTheDocument();
  });

  it("routes a project-scoped automation's Install through the wizard", async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'project-automation',
          name: 'Project Automation',
          scope: 'project',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    await user.click(
      screen.getByRole('button', { name: 'Manage Project Automation' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Install' }));

    expect(installMock).not.toHaveBeenCalled();
    expect(screen.getByText('wizard step probe')).toBeInTheDocument();
  });

  it("shows Reinstall/Uninstall in an installed card's ⋯ menu", async () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'live', name: 'Live Automation' }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([['live', installState('live')]]);

    const { user } = render(<AutomationsGrid organizationId="org_1" />);

    await user.click(
      screen.getByRole('button', { name: 'Manage Live Automation' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Reinstall' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Uninstall' }),
    ).toBeInTheDocument();
  });
});

describe('AutomationsGrid tabs + badges', () => {
  it('shows no state badge on a not-installed card (no "Available")', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [automationSummary()],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Manage Sample Automation' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Install' }),
    ).toBeInTheDocument();
  });

  it('lands on the Installed tab, showing only automations with an install row', () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'live', name: 'Live Automation' }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'discoverable',
          name: 'Discoverable Automation',
        }),
      ],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([['live', installState('live')]]);

    render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Live Automation')).toBeInTheDocument();
    expect(
      screen.queryByText('Discoverable Automation'),
    ).not.toBeInTheDocument();
    // The whole card is a real button carrying the automation's name as its
    // accessible name. "Installed" now appears exactly ONCE — only as the card
    // badge; the tab label moved to the page header's `AutomationsNavigation`.
    expect(
      screen.getByRole('button', { name: 'Live Automation' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Installed')).toHaveLength(1);
  });

  it('shows the catalog empty copy on an Installed tab with nothing installed', () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [automationSummary()],
      isLoading: false,
      error: null,
    });

    render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('No automations yet')).toBeInTheDocument();
  });

  it('groups the All tab into folder sections, ungrouped last as General', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        automationSummary({ slug: 'loose', name: 'Loose Automation' }),
        automationSummary({
          slug: 'issue-desk',
          name: 'Issue Desk',
          folder: 'github/issues',
        }),
      ],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    const sections = screen.getAllByRole('heading', { level: 3 });
    // Top-level manifest folder segment first, the General bucket trailing.
    expect(sections.map((h) => h.textContent)).toStrictEqual([
      'GitHub',
      'General',
    ]);
  });

  it('renders one flat grid when no automation declares a folder', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [automationSummary()],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByText('Sample Automation')).toBeInTheDocument();
  });

  it('moves manifest labels into the meta row (never inside the description)', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [automationSummary({ labels: ['GitHub', 'Email'] })],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    // Quiet tone renders the labels as one muted "A · B" line in the card's
    // meta row (see CatalogLabels) — a node of its own.
    const labels = screen.getByText('GitHub · Email');
    expect(labels).toBeInTheDocument();
    // Regression guard: the labels must never be concatenated into the
    // description paragraph.
    expect(screen.getByText('A discoverable automation.')).not.toContainElement(
      labels,
    );
  });
});

describe('AutomationsGrid bundle cards (kind: bundle)', () => {
  function bundleAutomation(overrides: Partial<AutomationSummary> = {}) {
    return automationSummary({
      slug: 'email-bundle',
      name: 'Email',
      kind: 'bundle',
      members: ['gmail/sync-emails', 'outlook/sync-emails'],
      ...overrides,
    });
  }

  it('shows the bundle kind badge with its member count', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Bundle · 2 automations')).toBeInTheDocument();
  });

  it('always opens the preview panel on card click, even with a member installed', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    // A member has its own install row — the bundle itself still has none.
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
    ]);

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    await user.click(screen.getByRole('button', { name: 'Email' }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('automation-panel')).toHaveTextContent('Email');
  });

  it('shows the partial "needs attention" state when some but not all members are installed', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
    ]);

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('shows the installed state once every member is installed', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
      ['outlook/sync-emails', installState('outlook/sync-emails')],
    ]);

    renderAllTab(<AutomationsGrid organizationId="org_1" />);

    // Only the bundle card's DERIVED badge says "Installed" — the tab label
    // moved to the page header's `AutomationsNavigation`.
    expect(screen.getAllByText('Installed')).toHaveLength(1);
  });

  it("routes the ⋯ menu's Install through the bundle wizard, never the one-click path", async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });

    const { user } = renderAllTab(<AutomationsGrid organizationId="org_1" />);

    await user.click(screen.getByRole('button', { name: 'Manage Email' }));
    await user.click(screen.getByRole('menuitem', { name: 'Install' }));

    expect(installMock).not.toHaveBeenCalled();
    expect(screen.getByText('bundle wizard step probe')).toBeInTheDocument();
  });

  // A bundle carries no `automationInstallations` row of its own, so the
  // Installed tab lists its MEMBERS (each with an "Uninstall bundle" action),
  // never the bundle card — the bundle stays browsable on the All tab.
  it('lists the installed MEMBER on the Installed tab, not the bundle', () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'gmail/sync-emails',
          name: 'Sync Gmail emails',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
    ]);

    render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
  });

  // A bundle MEMBER is built-in (merely hidden from the catalog), so it must
  // never earn the "Custom" corner glyph an uploaded automation gets.
  it('never marks a bundle member as Custom', () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'gmail/sync-emails',
          name: 'Sync Gmail emails',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
    ]);

    render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
  });

  // The Installed tab dissolves a bundle into its member cards (#2611) — each
  // member keeps its bundle parentage visible via a "Part of <bundle>" marker,
  // the same corner-glyph slot a Custom/bundle card uses.
  it('marks an installed bundle member "Part of <bundle>"', () => {
    useAutomationsMock.mockReturnValue({
      automations: [
        automationSummary({
          slug: 'gmail/sync-emails',
          name: 'Sync Gmail emails',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [bundleAutomation()],
      isLoading: false,
      error: null,
    });
    mockInstallStates = new Map([
      ['gmail/sync-emails', installState('gmail/sync-emails')],
    ]);

    render(<AutomationsGrid organizationId="org_1" />);

    expect(screen.getByText('Part of Email')).toBeInTheDocument();
  });
});
