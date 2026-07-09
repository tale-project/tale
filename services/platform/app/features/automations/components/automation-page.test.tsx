import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import { AutomationPage } from './automation-page';

/**
 * Regression net for #1979: a not-yet-installed automation discovered through the
 * built-in catalog must resolve to its pre-install AutomationDetails page (full
 * description + Install CTA), NOT the "Automation not found" dead-end. The hub's union
 * surfaces catalog-only automations and links each card to this page, so the page has
 * to fall back to the catalog when the org's installed list doesn't carry the
 * slug — otherwise every discovery card contradicts itself with "Automation not found".
 */

const {
  useAutomationsMock,
  useAutomationCatalogMock,
  useAutomationInstallStatesMock,
  useAutomationScheduleReadinessMock,
} = vi.hoisted(() => ({
  useAutomationsMock: vi.fn(),
  useAutomationCatalogMock: vi.fn(),
  useAutomationInstallStatesMock: vi.fn(),
  useAutomationScheduleReadinessMock: vi.fn(),
}));

vi.mock('../hooks/use-automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-automations')>()),
  useAutomations: useAutomationsMock,
  useAutomationCatalog: useAutomationCatalogMock,
}));

vi.mock('../hooks/use-install-state', () => ({
  useAutomationInstallStates: useAutomationInstallStatesMock,
  useAutomationBindings: () => ({ bindings: [], isLoading: false }),
  useAutomationInstallActions: () => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    verify: vi.fn(),
    isPending: false,
  }),
}));

// The Configuration tab's projects list renders per-project lifecycle menus
// that wire an Export action through useExportAutomation → useConvexAction →
// convex/react's useAction, which needs a ConvexProvider no test mounts. Stub
// it to the real `{ mutateAsync }` shape, mirroring the sibling
// useExportSkill / useExportIntegration test mocks.
vi.mock('../hooks/use-export-automation', () => ({
  useExportAutomation: () => ({ mutateAsync: vi.fn() }),
}));

// Probe the wizard as a lightweight open/closed marker so the test asserts the
// details page keeps hosting it across the install-state transition, without
// pulling in the wizard's Convex/integration machinery.
vi.mock('./install-wizard/automation-install-wizard', () => ({
  AutomationInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>wizard step probe</div> : null,
}));

// The installed views (InstalledAutomationBody) reach into Convex-backed
// readiness; stub them so the #2341 test observes a clean assertion (the wizard
// disappearing on the old code) rather than a Convex-provider crash.
vi.mock('../hooks/use-automation-agent-readiness', () => ({
  useAutomationAgentReadiness: () => ({ agents: [], refetch: vi.fn() }),
}));
vi.mock('../hooks/use-automation-schedule-readiness', () => ({
  useAutomationScheduleReadiness: useAutomationScheduleReadinessMock,
}));
vi.mock('../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: () => ({
    required: [],
    blockedSlugs: [],
    isLoading: false,
  }),
}));

// Tab selection rides the URL (`?tab=`) through the house useUrlState hook,
// which needs a live TanStack router — stub it with a presettable record so
// tests can deep-link a tab and observe writes.
const { urlStateMock, setUrlStateMock } = vi.hoisted(() => ({
  urlStateMock: { tab: null as string | null },
  setUrlStateMock: vi.fn(),
}));
vi.mock('@/app/hooks/use-url-state', () => ({
  useUrlState: () => ({
    state: { tab: urlStateMock.tab },
    setState: setUrlStateMock,
    setStates: vi.fn(),
    clearState: vi.fn(),
    clearAll: vi.fn(),
    isPending: false,
  }),
}));

// Developer-gated tabs (Editor/Executions/Triggers) key off this ability
// check; default to a non-developer so existing tests keep their prior
// behavior unless a test opts in.
const { abilityMock } = vi.hoisted(() => ({
  abilityMock: { can: vi.fn(() => false) },
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => abilityMock,
}));

// Overview rows and the header render router Links; no router mounts here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children?: ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  redirect: vi.fn(),
}));

// Puck's <Render> stack is irrelevant to the page's tab plumbing.
vi.mock('../registry/automation-view', () => ({
  AutomationView: () => <div data-testid="automation-view" />,
}));

// The page shell (PageLayout + breadcrumb + the shared TabNavigation) has its
// own coverage; a light stand-in keeps this file about what the PAGE owns —
// branch selection, tab composition/gating/default — while preserving
// `role="tab"` queries. `isActive` maps to `aria-selected`; the declared
// `search.tab` is folded into the href so deep-link assertions stay real.
vi.mock('./automation-detail-shell', () => ({
  AutomationDetailShell: ({
    displayName,
    tabs,
    tabsChildren,
    children,
  }: {
    displayName?: string;
    tabs?: {
      label: string;
      href: string;
      search?: Record<string, unknown>;
      isActive?: boolean;
    }[];
    tabsChildren?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      <div data-testid="breadcrumb-name">{displayName}</div>
      {tabs && (
        <div role="tablist">
          {tabs.map((tab) => (
            <a
              key={tab.label}
              role="tab"
              aria-selected={tab.isActive === true}
              href={
                typeof tab.search?.tab === 'string'
                  ? `${tab.href}?tab=${tab.search.tab}`
                  : tab.href
              }
            >
              {tab.label}
            </a>
          ))}
        </div>
      )}
      {tabsChildren}
      {children}
    </div>
  ),
}));

// The Integrations tab pulls the settings catalog card + connect wizard —
// irrelevant to the page's tab plumbing.
vi.mock('./automation-integrations-tab', () => ({
  AutomationIntegrationsTab: () => <div data-testid="integrations-tab" />,
}));

// Configuration's identity form pulls the workflow read/save + identity
// action (Convex + QueryClient); its content has its own test file.
vi.mock('./automation-configuration', () => ({
  AutomationConfiguration: () => <div data-testid="configuration-tab" />,
}));

// The Editor/Executions/Triggers tab bodies pull the workflow canvas,
// executions table, and triggers sections' own Convex/ReactFlow machinery —
// irrelevant to this page's tab plumbing (order, gating, default selection).
vi.mock('./automation-workflow-editor-tab', () => ({
  AutomationWorkflowEditorTab: () => <div data-testid="editor-tab" />,
}));
vi.mock('@/app/features/workflows/executions/executions-table', () => ({
  ExecutionsTable: () => <div data-testid="executions-table" />,
}));
vi.mock('@/app/features/workflows/triggers/triggers', () => ({
  Triggers: () => <div data-testid="triggers-tab" />,
}));

function catalogAutomation(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    slug: 'sample-automation',
    name: 'Sample Automation',
    description: 'A discoverable automation from the built-in catalog.',
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

beforeEach(() => {
  vi.clearAllMocks();
  abilityMock.can.mockReturnValue(false);
  // Default: nothing installed, so an automation resolves to its pre-install details.
  useAutomationInstallStatesMock.mockReturnValue({
    bySlug: new Map(),
    isLoading: false,
  });
  // Default: no schedule-variable gaps, so existing tests see the readiness
  // banner behave as before (#2606's coverage overrides this per-test).
  useAutomationScheduleReadinessMock.mockReturnValue({
    readiness: { required: [], schedules: [] },
    missingFields: [],
    isLoading: false,
    refetch: vi.fn(),
  });
});

describe('AutomationPage catalog discovery (#1979)', () => {
  it('renders the pre-install AutomationDetails for a catalog-only automation instead of "Automation not found"', () => {
    // The org has nothing installed; the catalog carries the discovered automation.
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [catalogAutomation()],
      isLoading: false,
      error: null,
    });

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    // Breadcrumb + the details header both carry the name.
    expect(screen.getAllByText('Sample Automation')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.queryByText('Automation not found')).not.toBeInTheDocument();
  });

  it('resolves the installed entry over a same-slug catalog entry (installed wins)', () => {
    // The same slug exists in both the org's installed list and the catalog;
    // the page must resolve the installed entry (it carries the full per-install
    // data) rather than the catalog projection.
    useAutomationsMock.mockReturnValue({
      automations: [
        catalogAutomation({
          name: 'Installed Sample',
          description: 'Org install.',
        }),
      ],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [
        catalogAutomation({ name: 'Catalog Sample', description: 'Catalog.' }),
      ],
      isLoading: false,
      error: null,
    });

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    expect(screen.getAllByText('Installed Sample').length).toBeGreaterThan(0);
    expect(screen.queryByText('Catalog Sample')).not.toBeInTheDocument();
  });

  it('still shows "Automation not found" for a slug in neither the org nor the catalog', () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [catalogAutomation()],
      isLoading: false,
      error: null,
    });

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="missing-automation"
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Automation not found', level: 3 }),
    ).toBeInTheDocument();
  });
});

function installSampleAutomation(overrides: Partial<AutomationSummary> = {}) {
  useAutomationsMock.mockReturnValue({
    automations: [catalogAutomation(overrides)],
    isLoading: false,
    error: null,
  });
  useAutomationCatalogMock.mockReturnValue({
    automations: [],
    isLoading: false,
    error: null,
  });
  useAutomationInstallStatesMock.mockReturnValue({
    bySlug: new Map([
      ['sample-automation', { status: 'active', blockedIntegrations: [] }],
    ]),
    isLoading: false,
  });
}

/**
 * An installed automation with no views and no workflow (a non-developer, or
 * a developer without dev-tab access to anything else) still gets the shared
 * strip — Integrations + Configuration — and lands on Integrations (the first
 * visible tab, where the "Finish setup" banner lives).
 */
describe('AutomationPage renders an installed automation with nothing else to show', () => {
  it('renders the breadcrumb name and lands on Integrations', () => {
    installSampleAutomation({ views: [] });

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    // The name lives in the breadcrumb.
    expect(screen.getByText('Sample Automation')).toBeInTheDocument();
    // No views, no workflow, non-developer → Integrations + Configuration
    // (Configuration is always the last tab).
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Integrations',
      'Configuration',
    ]);
    // …and Integrations is the landing tab.
    expect(screen.getByTestId('integrations-tab')).toBeInTheDocument();
  });
});

/**
 * The installed page's ONE top-level tab strip: Integrations always, then any
 * JSON view tabs (invalid ones as repair-stub tabs), then Configuration last —
 * the Editor/Executions/Triggers tabs stay off the strip entirely for a
 * non-developer. Each tab is a real link carrying its `?tab=` value.
 */
describe('AutomationPage tab strip (views + Configuration)', () => {
  const viewAutomation = () =>
    catalogAutomation({
      views: [
        {
          id: 'desk',
          title: 'Desk',
          data: { content: [], root: { props: {} } },
        },
      ] as AutomationSummary['views'],
    });

  it('renders Integrations + a tab per view + Configuration last, first view active', () => {
    installSampleAutomation(viewAutomation());

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Integrations',
      'Desk',
      'Configuration',
    ]);
    // A non-developer defaults to the first VIEW, not Configuration.
    expect(screen.getByRole('tab', { name: 'Desk' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The active view tab renders the view body.
    expect(screen.getByTestId('automation-view')).toBeInTheDocument();
  });

  it('links each tab to its ?tab deep link on the same route', () => {
    installSampleAutomation(viewAutomation());

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Configuration' })).toHaveAttribute(
      'href',
      '/dashboard/org_1/automations/sample-automation?tab=configuration',
    );
    // The default tab (the first view here) clears the param instead.
    expect(screen.getByRole('tab', { name: 'Desk' })).toHaveAttribute(
      'href',
      '/dashboard/org_1/automations/sample-automation',
    );
  });

  it('deep-links ?tab=configuration to the Configuration panel', () => {
    urlStateMock.tab = 'configuration';
    try {
      installSampleAutomation(viewAutomation());

      render(
        <AutomationPage
          organizationId="org_1"
          automationSlug="sample-automation"
        />,
      );

      expect(
        screen.getByRole('tab', { name: 'Configuration' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('configuration-tab')).toBeInTheDocument();
    } finally {
      urlStateMock.tab = null;
    }
  });

  it('surfaces an invalid view as a repair-stub tab with the reinstall affordance', () => {
    installSampleAutomation(
      catalogAutomation({
        views: [
          {
            id: 'broken-view',
            error: { code: 'INVALID_VIEW', message: 'bad json' },
          },
        ] as AutomationSummary['views'],
      }),
    );

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    // The stub claims a tab (humanized id) and, being first, renders active.
    expect(
      screen.getByRole('tab', { name: 'Broken View' }),
    ).toBeInTheDocument();
    expect(screen.getByText('bad json')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reinstall automation' }),
    ).toBeInTheDocument();
  });
});

/**
 * The 1:1 automation↔workflow tabs (N3): Editor/Executions/Triggers are
 * gated on developer access AND the automation having a workflow
 * (`manifest.workflows[0]`); Configuration always shows. A developer with a
 * workflow and no views lands on Editor by default; with views, the first
 * view is the default (Editor stays on the strip).
 */
describe('AutomationPage developer tabs (Editor/Executions/Triggers/Configuration)', () => {
  const workflowAutomation = () =>
    catalogAutomation({ workflows: ['sample-automation/main'], views: [] });

  it('renders no dev tabs for a non-developer even with a workflow', () => {
    installSampleAutomation(workflowAutomation());

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    // Editor/Executions/Triggers are never RENDERED for a non-developer
    // (not just hidden) — only Integrations + Configuration remain.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Integrations',
      'Configuration',
    ]);
    expect(screen.queryByTestId('editor-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('executions-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('triggers-tab')).not.toBeInTheDocument();
  });

  it('renders no dev tabs for a developer without a workflow', () => {
    abilityMock.can.mockReturnValue(true);
    installSampleAutomation(catalogAutomation({ workflows: [], views: [] }));

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Integrations',
      'Configuration',
    ]);
    expect(screen.queryByTestId('editor-tab')).not.toBeInTheDocument();
  });

  it('orders Editor, Executions, Triggers, Integrations, Configuration for a developer with a workflow', () => {
    abilityMock.can.mockReturnValue(true);
    installSampleAutomation(workflowAutomation());

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Editor',
      'Executions',
      'Triggers',
      'Environment',
      'Integrations',
      'Configuration',
    ]);
  });

  it('defaults to the Editor tab for a developer with a workflow and no views', () => {
    abilityMock.can.mockReturnValue(true);
    installSampleAutomation(workflowAutomation());

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('editor-tab')).toBeInTheDocument();
  });

  it('puts JSON view tabs after the developer tabs', () => {
    abilityMock.can.mockReturnValue(true);
    installSampleAutomation(
      catalogAutomation({
        workflows: ['sample-automation/main'],
        views: [
          {
            id: 'desk',
            title: 'Desk',
            data: { content: [], root: { props: {} } },
          },
        ] as AutomationSummary['views'],
      }),
    );

    render(
      <AutomationPage
        organizationId="org_1"
        automationSlug="sample-automation"
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Editor',
      'Executions',
      'Triggers',
      'Environment',
      'Integrations',
      'Desk',
      'Configuration',
    ]);
    // Developers with bundled views land on the first view (not Editor) so
    // operators and e2e don't need ?tab=desk; Editor stays one click away.
    expect(screen.getByRole('tab', { name: 'Desk' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Desk' })).toHaveAttribute(
      'href',
      '/dashboard/org_1/automations/sample-automation',
    );
  });
});

/**
 * Regression net for #2341: the pre-install details page hosts the install
 * wizard. The wizard's Install step installs the automation, which flips the reactive
 * install state to defined — and AutomationPage keys the details page on `!state`.
 * Before the fix that transition unmounted the details page (and its open
 * wizard) mid-flow, so a project-scoped install closed silently after Install
 * instead of continuing to its integration/Done steps.
 */
describe('AutomationPage keeps the install wizard mounted across install (#2341)', () => {
  const projectAutomation = () =>
    catalogAutomation({
      slug: 'issue-desk',
      name: 'Resolve GitHub issues',
      scope: 'project',
    });

  it('keeps hosting the wizard after the install lands install state', async () => {
    useAutomationsMock.mockReturnValue({
      automations: [],
      isLoading: false,
      error: null,
    });
    useAutomationCatalogMock.mockReturnValue({
      automations: [projectAutomation()],
      isLoading: false,
      error: null,
    });

    const { user, rerender } = render(
      <AutomationPage organizationId="org_1" automationSlug="issue-desk" />,
    );

    // Open the wizard from the pre-install details page.
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(screen.getByText('wizard step probe')).toBeInTheDocument();

    // The Install step installs the automation: its reactive state now resolves. The
    // details page must survive this so the wizard reaches its later steps.
    useAutomationInstallStatesMock.mockReturnValue({
      bySlug: new Map([
        ['issue-desk', { status: 'active', blockedIntegrations: [] }],
      ]),
      isLoading: false,
    });
    rerender(
      <AutomationPage organizationId="org_1" automationSlug="issue-desk" />,
    );

    expect(screen.getByText('wizard step probe')).toBeInTheDocument();
  });
});

/**
 * Regression net for #2606: readiness previously covered broken install /
 * integrations / agents only, so a schedule missing a required start-schema
 * field (e.g. GitHub `owner`/`repo`) left the checklist green while cron runs
 * would fail. The banner must name the gap and deep-link to Triggers.
 */
describe('AutomationPage readiness banner names schedule-variable gaps (#2606)', () => {
  it('shows the missing fields on the Integrations tab with a Triggers deep link', () => {
    abilityMock.can.mockReturnValue(true);
    urlStateMock.tab = 'integrations';
    try {
      installSampleAutomation({ workflows: ['sample-automation/main'] });
      useAutomationScheduleReadinessMock.mockReturnValue({
        readiness: { required: ['owner', 'repo'], schedules: [] },
        missingFields: ['owner', 'repo'],
        isLoading: false,
        refetch: vi.fn(),
      });

      render(
        <AutomationPage
          organizationId="org_1"
          automationSlug="sample-automation"
        />,
      );

      expect(
        screen.getByText('Missing schedule variables: owner, repo'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Open Triggers' }),
      ).toHaveAttribute(
        'href',
        '/dashboard/org_1/automations/sample-automation',
      );
    } finally {
      urlStateMock.tab = null;
    }
  });

  it('never shows the schedule gap on the Configuration tab (only integration/agent gaps ride there)', () => {
    abilityMock.can.mockReturnValue(true);
    urlStateMock.tab = 'configuration';
    try {
      installSampleAutomation({ workflows: ['sample-automation/main'] });
      useAutomationScheduleReadinessMock.mockReturnValue({
        readiness: { required: ['owner', 'repo'], schedules: [] },
        missingFields: ['owner', 'repo'],
        isLoading: false,
        refetch: vi.fn(),
      });

      render(
        <AutomationPage
          organizationId="org_1"
          automationSlug="sample-automation"
        />,
      );

      expect(
        screen.queryByText(/Missing schedule variables/),
      ).not.toBeInTheDocument();
    } finally {
      urlStateMock.tab = null;
    }
  });

  it('names the gap without a Triggers deep link when no dev tabs are rendered', () => {
    // A non-developer (or a developer viewing a no-workflow automation) has no
    // Triggers tab to deep-link to — the summary still names the gap.
    urlStateMock.tab = 'integrations';
    try {
      installSampleAutomation({ workflows: [] });
      useAutomationScheduleReadinessMock.mockReturnValue({
        readiness: { required: ['owner'], schedules: [] },
        missingFields: ['owner'],
        isLoading: false,
        refetch: vi.fn(),
      });

      render(
        <AutomationPage
          organizationId="org_1"
          automationSlug="sample-automation"
        />,
      );

      expect(
        screen.getByText('Missing schedule variables: owner'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Open Triggers' }),
      ).not.toBeInTheDocument();
    } finally {
      urlStateMock.tab = null;
    }
  });
});
