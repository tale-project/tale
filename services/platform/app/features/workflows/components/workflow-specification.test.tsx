// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const h = vi.hoisted(() => {
  const baseConfig = {
    name: 'Test Workflow',
    description: 'A test workflow',
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
      const { container } = render(
        <WorkflowSpecification
          organizationId="org-1"
          workflowSlug="my-workflow"
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders the existing specification and disables Save until edited', () => {
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="my-workflow"
      />,
    );
    const textarea = screen.getByLabelText('Specification');
    expect(textarea).toHaveValue('Existing specification text.');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('shows a stale banner when specSyncStatus is stale', () => {
    h.readData = { ...h.readData, specSyncStatus: 'stale' };
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="my-workflow"
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('enables Save once the draft is edited, and saves via saveWorkflowWithSnapshot', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="my-workflow"
      />,
    );
    const textarea = screen.getByLabelText('Specification');
    await user.type(textarea, ' More detail.');

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => expect(h.saveMock).toHaveBeenCalledTimes(1));
    expect(h.saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workflowSlug: 'my-workflow',
        expectedHash: 'hash-1',
        config: expect.objectContaining({
          specification: 'Existing specification text. More detail.',
          specificationMeta: undefined,
        }),
      }),
    );
  });

  it('opens the diff dialog with the candidate config on a successful graph regeneration', async () => {
    const candidateConfig = { ...h.baseConfig, steps: [{ stepSlug: 'a' }] };
    h.generateGraphMock.mockResolvedValue({
      ok: true,
      config: candidateConfig,
    });
    const user = userEvent.setup();
    // A distinct slug: the component's module-level draft cache (keyed by
    // org:slug, kept across unmounts) is never reset between tests, so reusing
    // "my-workflow" here would inherit the draft the "enables Save" test typed.
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="graph-regen-workflow"
      />,
    );

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
    h.generateGraphMock.mockResolvedValue({
      ok: false,
      errors: ['Step "x" is missing a required field.'],
    });
    const user = userEvent.setup();
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="my-workflow"
      />,
    );

    await user.click(screen.getByRole('button', { name: /regenerate graph/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Step "x" is missing a required field\./),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('sets the draft from a successful specification regeneration', async () => {
    h.generateSpecMock.mockResolvedValue({
      specification: 'A freshly generated specification.',
      sourceHash: 'graph-hash-1',
    });
    const user = userEvent.setup();
    render(
      <WorkflowSpecification
        organizationId="org-1"
        workflowSlug="my-workflow"
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /regenerate specification/i }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Specification')).toHaveValue(
        'A freshly generated specification.',
      ),
    );
  });
});
