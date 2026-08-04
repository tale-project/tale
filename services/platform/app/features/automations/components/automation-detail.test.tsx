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

const { state, saveMutation, startRun, deploy, toastSpy } = vi.hoisted(() => ({
  state: {
    document: {
      name: 'billing/dunning',
      description: 'Chases unpaid invoices.',
      nodes: [{ id: 'summary', type: 'llm', prompt: 'One sentence, please.' }],
    } as unknown,
    /** The pack manifest's display half, when the test wants one. */
    presentation: undefined as unknown,
  },
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

// The Projects panel resolves project names through this hook; the page
// under test needs no real projects.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [], isLoading: false }),
}));

vi.mock('../hooks/queries', () => ({
  useAutomation: () => ({
    data: {
      document: state.document,
      version: 3,
      deployedVersion: 2,
      ...(state.presentation !== undefined
        ? { presentation: state.presentation }
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
  useAutomationRuns: () => ({ data: [] }),
  useAutomationTriggers: () => ({ data: [] }),
  useAutomationProjects: () => ({ data: [] }),
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

// The canvas is a React Flow viewport and jsdom performs no layout; the page
// only needs it to hand a node to the inspector, so the stub offers that.
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    graph,
    onSelectNode,
  }: {
    graph: { nodes: readonly { id: string }[] };
    onSelectNode: (nodeId: string) => void;
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
});

describe('AutomationDetail', () => {
  it('shows the pack description under the area breadcrumb', () => {
    state.presentation = {
      name: 'Chase overdue invoices',
      description: 'Sends the dunning ladder.',
      i18n: { de: { name: 'Offene Rechnungen anmahnen' } },
    };
    renderPage();
    // The display name is the area header's breadcrumb leaf (covered by
    // `automation-breadcrumbs.test.tsx`); this strip only carries the blurb.
    expect(screen.getByText('Sends the dunning ladder.')).toBeVisible();
  });

  it('falls back to the document description when nothing was declared', () => {
    state.presentation = undefined;
    renderPage();
    expect(screen.getByText('Chases unpaid invoices.')).toBeVisible();
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

  it('passes an axe audit', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
  });
});
