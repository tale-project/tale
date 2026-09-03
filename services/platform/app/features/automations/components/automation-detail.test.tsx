import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

/**
 * The automation page is an editor: its draft lives in the browser and a save
 * APPENDS a version, so these tests hold it to the unified editor contract —
 * editing arms the shared Save/Discard cluster, discarding restores the stored
 * version, and nothing is written until the save-version dialog is confirmed.
 * Backing out of that dialog is a deliberate no-op, which is why the "no toast,
 * draft intact" case is pinned here: a cancelled save that reported a failure
 * would teach authors to distrust the cluster.
 */

const {
  state,
  projectsData,
  runsData,
  saveMutation,
  startRun,
  deploy,
  toastSpy,
} = vi.hoisted(() => ({
  state: {
    document: {
      name: 'billing/dunning',
      description: 'Chases unpaid invoices.',
      nodes: [{ id: 'summary', type: 'llm', prompt: 'One sentence, please.' }],
    } as unknown,
    /** The pack manifest's display half, when the test wants one. */
    presentation: undefined as unknown,
    version: 3,
    deployedVersion: 2 as number | undefined,
    /** Agent nodes of the DEPLOYED version without a provider pin. */
    deployedUnpinnedAgentNodes: undefined as string[] | undefined,
  },
  /** The org's projects and the automation's bindings — the run-scope picker
   * appears only when two or more projects are bound. */
  projectsData: {
    list: [] as Array<{ _id: string; name: string }>,
    bound: [] as string[],
  },
  /** Newest-first run log. Empty unless a test is pinning last-run chrome. */
  runsData: [] as Array<{
    id: string;
    name: string;
    version: number;
    status: string;
    mode: string;
    startedBy: string;
    startedAt: number;
  }>,
  saveMutation: { mutateAsync: vi.fn(), isPending: false },
  startRun: { mutate: vi.fn(), isPending: false },
  deploy: { mutate: vi.fn(), isPending: false, variables: undefined },
  toastSpy: vi.fn(),
}));

// `EditorActions` owns every piece of save feedback and reaches for the
// module-level toast to do it.
vi.mock('@/app/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

// The page hides its authoring surface (inspector edits, the save cluster,
// live runs) from members; these tests exercise that surface, so they run
// with the developer capability granted.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// The Projects panel and the run-scope picker resolve project names through
// this hook; each test sets the roster it needs on `projectsData`.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: projectsData.list, isLoading: false }),
}));

vi.mock('../hooks/queries', () => ({
  useAutomation: (
    _organizationId: string,
    _name: string,
    version?: number,
  ) => ({
    data: {
      document: state.document,
      version: version ?? state.version,
      deployedVersion: state.deployedVersion,
      ...(state.presentation !== undefined
        ? { presentation: state.presentation }
        : {}),
      ...(state.deployedUnpinnedAgentNodes !== undefined
        ? { deployedUnpinnedAgentNodes: state.deployedUnpinnedAgentNodes }
        : {}),
    },
    isPending: false,
  }),
  useAutomationVersions: () => ({
    data: [
      {
        version: 3,
        message: 'tightened the prompt',
        createdBy: 'user:a',
        createdAt: 1_700_000_100_000,
      },
      {
        version: 2,
        message: 'first cut',
        createdBy: 'user:a',
        createdAt: 1_700_000_000_000,
      },
    ],
  }),
  useAutomationRuns: () => ({ data: runsData }),
  useAutomationTriggers: () => ({ data: [] }),
  useAutomationProjects: () => ({ data: projectsData.bound }),
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAutomation: () => saveMutation,
  useStartAutomationRun: () => startRun,
  useDeployAutomation: () => deploy,
  useSetAutomationTrigger: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAutomationTrigger: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAutomationProjects: () => ({ mutate: vi.fn(), isPending: false }),
}));

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

vi.mock('@tanstack/react-router', () => ({
  Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params: _params, children, ...rest },
    ref,
  ) {
    return (
      <a ref={ref} href={to ?? '#'} {...rest}>
        {children}
      </a>
    );
  }),
}));

// The canvas is a React Flow viewport and jsdom performs no layout; the page
// only needs it to hand a node to the inspector, so the stub offers that.
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    graph,
    onSelectNode,
  }: {
    graph: { nodes: readonly { id: string }[] };
    onSelectNode: (nodeId: string | null) => void;
  }) => (
    <div>
      {graph.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => {
            onSelectNode(node.id);
          }}
        >
          {`select ${node.id}`}
        </button>
      ))}
      <button type="button" onClick={() => onSelectNode(null)}>
        deselect
      </button>
    </div>
  ),
}));

vi.mock('@/app/components/ui/data-display/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json">{JSON.stringify(data)}</pre>
  ),
}));

import { AutomationDetail } from './automation-detail';

/** Mirrors the shells: a provider around the page, no cluster of its own. */
function renderPage() {
  return render(
    <ActiveEditorProvider>
      <AutomationDetail
        organizationId="org-1"
        automationSlug="billing/dunning"
      />
    </ActiveEditorProvider>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });
const whenField = () => screen.getByRole('textbox', { name: 'When' });
const versionPicker = () => screen.getByRole('button', { name: 'Version' });

/** Select the one node and edit a field every node type accepts. */
async function editTheNode(user: ReturnType<typeof renderPage>['user']) {
  await user.click(screen.getByRole('button', { name: 'select summary' }));
  await user.type(whenField(), 'x');
}

beforeEach(() => {
  saveMutation.mutateAsync = vi.fn().mockResolvedValue(undefined);
  saveMutation.isPending = false;
  toastSpy.mockClear();
  startRun.mutate.mockClear();
  deploy.mutate.mockReset();
  projectsData.list = [];
  projectsData.bound = [];
  runsData.length = 0;
  state.presentation = undefined;
  state.version = 3;
  state.deployedVersion = 2;
  state.deployedUnpinnedAgentNodes = undefined;
});

describe('AutomationDetail', () => {
  it('omits the pack description from the workbench header', () => {
    state.presentation = {
      name: 'Chase overdue invoices',
      description: 'Sends the dunning ladder.',
      i18n: { de: { name: 'Offene Rechnungen anmahnen' } },
    };
    renderPage();
    expect(screen.queryByText('Sends the dunning ladder.')).toBeNull();
    expect(screen.queryByText('Chases unpaid invoices.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });

  it('swaps the inspector from the trigger to a node and back', async () => {
    const { user } = renderPage();
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Trigger' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'deselect' }));
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeVisible();
  });

  it('returns to the workflow from Close and Escape', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeVisible();
  });

  it('keeps the node inspector open on Escape while typing', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  });

  it('does not put a standing banner over pinless agents on the live version', () => {
    state.deployedUnpinnedAgentNodes = ['agent'];
    renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(
      screen.queryByText(/The live version \(v2\) has an agent node/),
    ).toBeNull();
  });

  it('deploys the canvas version from the header when it is not live', async () => {
    const { user } = renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(screen.queryByText('Live: v2')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Deploy$/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Deploy this version' }),
    );
    expect(deploy.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        version: 3,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("surfaces the deploy gate's own refusal, not a generic error", async () => {
    deploy.mutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError({
          data: {
            code: 'AUTOMATION_DEPLOY_REJECTED',
            message:
              'deploy gate: billing/dunning@3 was saved with failing tests — fix them and save a new version',
          },
        });
      },
    );
    const { user } = renderPage();
    await user.click(
      screen.getByRole('button', { name: 'Deploy this version' }),
    );
    expect(
      screen.getByText(
        'deploy gate: billing/dunning@3 was saved with failing tests — fix them and save a new version',
      ),
    ).toBeVisible();
  });

  it('offers no header deploy when the canvas version is already live', () => {
    state.deployedVersion = 3;
    renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(versionPicker()).not.toHaveTextContent('Live');
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/^Live:/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Deploy this version' }),
    ).not.toBeInTheDocument();
  });

  it('still offers header deploy when nothing is live yet', () => {
    state.deployedVersion = undefined;
    renderPage();
    expect(screen.queryByText('Live')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Deploy this version' }),
    ).toBeVisible();
  });

  it('drops the header deploy after switching to the live version', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'v2' }));
    expect(versionPicker()).toHaveTextContent('v2');
    expect(versionPicker()).not.toHaveTextContent('Live');
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole('button', { name: 'Deploy this version' }),
    ).not.toBeInTheDocument();
  });

  it('switches the canvas from the header version picker', async () => {
    const { user } = renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(
      screen.getByRole('button', { name: 'Deploy this version' }),
    ).toBeVisible();

    await user.click(versionPicker());
    await user.click(screen.getByRole('menuitem', { name: /^v2/ }));

    expect(versionPicker()).toHaveTextContent('v2');
    expect(versionPicker()).not.toHaveTextContent('Live');
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole('button', { name: 'Deploy this version' }),
    ).not.toBeInTheDocument();
  });

  it('toggles the last-run overlay from a canvas control', async () => {
    runsData.push({
      id: 'run_1',
      name: 'billing/dunning',
      version: 3,
      status: 'success',
      mode: 'mock',
      startedBy: 'user:a',
      startedAt: 1_700_000_200_000,
    });
    const { user } = renderPage();
    const hide = screen.getByRole('button', { name: 'Hide last run' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(hide.closest('.absolute')).not.toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Open the last run' }),
    ).toBeNull();

    await user.click(hide);
    expect(
      screen.getByRole('button', { name: 'Show last run' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays quiet when the deployed version has no pinless agent node', () => {
    renderPage();
    expect(
      screen.queryByText(/without a pinned provider/, { exact: false }),
    ).toBeNull();
  });

  it('test-runs the version on screen, not the deployed one', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Test run' }));
    // The page shows v3 while v2 is deployed; without the explicit version the
    // server falls back to the deployment and an undeployed draft cannot be
    // tested at all.
    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'mock',
        version: 3,
      },
      expect.any(Object),
    );
  });

  it('closes the Run live confirm as soon as the run is started', async () => {
    // startRun only schedules the run — a later LIVE_BODY_FAILED is a run
    // outcome, not a start refusal. Waiting on the mutation would leave the
    // dialog stuck open after a failed live fetch.
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Run live' }));
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(dialog).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Run live' }));
    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'live',
      },
      expect.any(Object),
    );
    expect(screen.queryByRole('dialog', { name: 'Run live?' })).toBeNull();
  });

  it('offers no run-scope picker unless the automation is multi-bound', () => {
    // One binding is auto-applied server-side; none is org-wide already —
    // neither is a choice worth surfacing.
    projectsData.list = [{ _id: 'project_a', name: 'Acme' }];
    projectsData.bound = ['project_a'];
    renderPage();
    expect(
      screen.queryByRole('combobox', { name: 'Project scope' }),
    ).toBeNull();
  });

  it('names the sole bound project in the Run live dialog', async () => {
    // No picker for a sole binding, but the live dialog still states where the
    // run will act — the project the server pins it to.
    projectsData.list = [{ _id: 'project_a', name: 'Acme' }];
    projectsData.bound = ['project_a'];
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Run live' }));
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(
      within(dialog).getByText(/operates in the Acme project/),
    ).toBeVisible();
  });

  it('scopes a run to a chosen project when the automation is multi-bound', async () => {
    projectsData.list = [
      { _id: 'project_a', name: 'Acme' },
      { _id: 'project_b', name: 'Globex' },
    ];
    projectsData.bound = ['project_a', 'project_b'];
    const { user } = renderPage();

    // The default is organization-wide — a run carries no projectId until the
    // author narrows it.
    const scope = screen.getByRole('combobox', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Organization-wide');

    await user.click(scope);
    await user.click(screen.getByRole('option', { name: 'Globex' }));
    await user.click(screen.getByRole('button', { name: 'Test run' }));

    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'mock',
        version: 3,
        projectId: 'project_b',
      },
      expect.any(Object),
    );
  });

  it('arms the shared cluster as soon as a node is edited', async () => {
    const { user } = renderPage();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();

    await editTheNode(user);

    expect(whenField()).toHaveValue('x');
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
  });

  it('discards the draft back to the stored version', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(discardButton());

    expect(whenField()).toHaveValue('');
    expect(saveButton()).toBeDisabled();
  });

  it('asks for a version message and writes nothing until it is confirmed', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(saveButton());

    expect(screen.getByText('Save a new version')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Version message' }),
    ).toBeVisible();
    expect(saveMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the draft and stays silent when the dialog is dismissed', async () => {
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Save a new version')).toBeNull();
    });
    expect(saveMutation.mutateAsync).not.toHaveBeenCalled();
    // A cancelled save is not a failure: no toast, and the edit survives.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
    expect(whenField()).toHaveValue('x');
  });

  it('appends the version with the typed message and clears the draft', async () => {
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());

    await user.type(
      screen.getByRole('textbox', { name: 'Version message' }),
      'tighten the prompt',
    );
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    await waitFor(() => {
      expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(saveMutation.mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      message: 'tighten the prompt',
      automation: expect.objectContaining({
        name: 'billing/dunning',
        nodes: [expect.objectContaining({ id: 'summary', when: 'x' })],
      }),
    });
    // The draft is gone: the page reads the stored version again, and the
    // cluster disarms (Save itself is mid "Saved" flash, so Discard is the
    // stable dirty signal to assert).
    await waitFor(() => {
      expect(discardButton()).toBeDisabled();
    });
    expect(whenField()).toHaveValue('');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("surfaces the store's own refusal in one toast", async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue({
      data: {
        code: 'AUTOMATION_NAME_INVALID',
        message:
          'billing/Dunning is not a valid name — use lower-case segments',
      },
    });
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description:
          'billing/Dunning is not a valid name — use lower-case segments',
      }),
    );
    // The refusal leaves the draft in place so it can be corrected and re-saved.
    expect(saveButton()).toBeEnabled();
  });

  it('confirms before a version switch drops the draft', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(screen.getByRole('button', { name: 'v2' }));
    expect(screen.getByText('Show another version?')).toBeVisible();

    // Backing out of the question leaves the draft exactly where it was.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Show another version?')).toBeNull();
    });
    expect(whenField()).toHaveValue('x');

    await user.click(screen.getByRole('button', { name: 'v2' }));
    await user.click(
      screen.getByRole('button', { name: 'Discard and switch' }),
    );

    await waitFor(() => {
      expect(whenField()).toHaveValue('');
    });
    expect(saveButton()).toBeDisabled();
  });

  it('does not put delete beside the save cluster', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Delete automation' }),
    ).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
  });
});
