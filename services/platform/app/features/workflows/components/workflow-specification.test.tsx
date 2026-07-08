// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const h = vi.hoisted(() => {
  const baseConfig = {
    steps: [],
    specification: 'Existing specification text.',
  };
  const fixture: {
    baseConfig: typeof baseConfig;
    readData: {
      ok: boolean;
      config?: unknown;
      hash?: string;
      specSyncStatus?: string;
    };
    refetch: ReturnType<typeof vi.fn>;
    saveMock: ReturnType<typeof vi.fn>;
    generateGraphMock: ReturnType<typeof vi.fn>;
    generateSpecMock: ReturnType<typeof vi.fn>;
  } = {
    baseConfig,
    readData: {
      ok: true,
      config: baseConfig,
      hash: 'hash-1',
      specSyncStatus: 'synced',
    },
    refetch: vi.fn(),
    saveMock: vi.fn().mockResolvedValue({ hash: 'hash-2' }),
    generateGraphMock: vi.fn(),
    generateSpecMock: vi.fn(),
  };
  return fixture;
});

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('../hooks/file-queries', () => ({
  useReadWorkflow: () => ({
    data: h.readData,
    isLoading: false,
    refetch: h.refetch,
  }),
}));

vi.mock('../hooks/file-mutations', () => ({
  useSaveWorkflow: () => ({
    mutateAsync: h.saveMock,
    isPending: false,
  }),
}));

vi.mock('../hooks/specification-actions', () => ({
  useGenerateGraphFromSpecification: () => ({
    mutateAsync: h.generateGraphMock,
    isPending: false,
  }),
  useGenerateSpecificationFromGraph: () => ({
    mutateAsync: h.generateSpecMock,
    isPending: false,
  }),
}));

// The diff dialog has its own dedicated a11y + behavior test; stub it here so
// this test only asserts what candidate config it was handed.
vi.mock('./workflow-diff-dialog', () => ({
  WorkflowDiffDialog: (props: {
    open: boolean;
    candidateConfig: { specification?: string };
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="diff-dialog">
        <button onClick={props.onConfirm}>confirm-apply</button>
      </div>
    ) : null,
}));

import { WorkflowSpecification } from './workflow-specification';

/**
 * Saving moved to the page's shared Save cluster (the active-editor
 * contract) — this probe stands in for `EditorActions` so the test drives
 * the registered controller exactly the way the tab strip does.
 */
function EditorProbe() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return (
    <button
      disabled={!controller.isDirty || controller.isSaving}
      onClick={() => void controller.save()}
    >
      probe-save
    </button>
  );
}

function renderSpecification(workflowSlug: string) {
  return render(
    <ActiveEditorProvider>
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug={workflowSlug}
      />
      <EditorProbe />
    </ActiveEditorProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  h.readData = {
    ok: true,
    config: h.baseConfig,
    hash: 'hash-1',
    specSyncStatus: 'synced',
  };
});

describe('WorkflowSpecification', () => {
  describe('accessibility', () => {
    it('has no critical accessibility violations', async () => {
      const { container } = renderSpecification('my-workflow');
      await checkAccessibility(container);
    });
  });

  it('renders the existing specification and registers a clean controller', () => {
    renderSpecification('my-workflow');
    const textarea = screen.getByLabelText('Specification');
    expect(textarea).toHaveValue('Existing specification text.');
    // Not dirty yet → the shared Save cluster is disabled.
    expect(screen.getByRole('button', { name: 'probe-save' })).toBeDisabled();
  });

  it('shows no banner when the pair is synced (a fresh install)', () => {
    renderSpecification('my-workflow');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers "Update from graph" on a spec_stale banner and replaces the draft', async () => {
    h.readData = { ...h.readData, specSyncStatus: 'spec_stale' };
    h.generateSpecMock.mockResolvedValue({
      specification: 'A freshly generated specification.',
      sourceHash: 'graph-hash-1',
    });
    const user = userEvent.setup();
    // A distinct slug: the component's module-level draft cache (keyed by
    // org:slug, kept across unmounts) is never reset between tests.
    renderSpecification('spec-stale-workflow');

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /update from graph/i }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Specification')).toHaveValue(
        'A freshly generated specification.',
      ),
    );
  });

  it('enables Save once the draft is edited, and saves via saveWorkflowWithSnapshot', async () => {
    const user = userEvent.setup();
    renderSpecification('my-workflow');
    const textarea = screen.getByLabelText('Specification');
    await user.type(textarea, ' More detail.');

    const saveButton = screen.getByRole('button', { name: 'probe-save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(h.saveMock).toHaveBeenCalledTimes(1));
    expect(h.saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workflowSlug: 'my-workflow',
        expectedHash: 'hash-1',
        config: expect.objectContaining({
          specification: 'Existing specification text. More detail.',
          // The stored record (none here) is carried; the server-side
          // reconcile stamps the authored baseline.
          specificationMeta: undefined,
        }),
      }),
    );
  });

  it('offers "Regenerate graph" on a graph_stale banner and opens the diff dialog', async () => {
    h.readData = { ...h.readData, specSyncStatus: 'graph_stale' };
    const candidateConfig = { ...h.baseConfig, steps: [{ stepSlug: 'a' }] };
    h.generateGraphMock.mockResolvedValue({
      ok: true,
      config: candidateConfig,
    });
    const user = userEvent.setup();
    renderSpecification('graph-regen-workflow');

    await user.click(screen.getByRole('button', { name: /regenerate graph/i }));

    await waitFor(() =>
      expect(screen.getByTestId('diff-dialog')).toBeInTheDocument(),
    );
    expect(h.generateGraphMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      workflowSlug: 'graph-regen-workflow',
      specification: 'Existing specification text.',
    });
  });

  it('shows inline validation errors when graph regeneration fails', async () => {
    h.readData = { ...h.readData, specSyncStatus: 'graph_stale' };
    h.generateGraphMock.mockResolvedValue({
      ok: false,
      errors: ['Step "x" is missing a required field.'],
    });
    const user = userEvent.setup();
    renderSpecification('graph-fail-workflow');

    await user.click(screen.getByRole('button', { name: /regenerate graph/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Step "x" is missing a required field\./),
      ).toBeInTheDocument(),
    );
  });

  it('offers generation from the graph when no specification exists yet', () => {
    h.readData = {
      ok: true,
      config: { steps: [] },
      hash: 'hash-1',
      specSyncStatus: 'absent',
    };
    renderSpecification('empty-spec-workflow');

    expect(
      screen.getByRole('button', { name: /generate/i }),
    ).toBeInTheDocument();
  });
});
