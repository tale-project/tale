import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { AppError } from '@/lib/shared/errors/app-error';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { SandboxQuotaEditor } from './sandbox-quota-editor';

const { state, save, refresh, toast } = vi.hoisted(() => ({
  state: {
    canEdit: true,
    usage: {
      isLoading: false,
      data: undefined as
        | Array<{ budget: string; used: number; cap: number }>
        | undefined,
    },
  },
  save: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => !state.canEdit }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => state.usage,
}));
vi.mock('@/app/hooks/use-toast', () => ({ toast }));
vi.mock('../governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: save }),
}));

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

function EditorView(props: Partial<ComponentProps<typeof SandboxQuotaEditor>>) {
  return (
    <ActiveEditorProvider>
      <HeaderActions />
      <EditorGroup>
        <SandboxQuotaEditor
          organizationId="org-1"
          deploymentLimits={{ status: 'available', maxSessions: 16 }}
          deploymentLimitsLoading={false}
          onRefreshDeploymentLimits={refresh}
          {...props}
        />
      </EditorGroup>
    </ActiveEditorProvider>
  );
}

beforeEach(() => {
  state.canEdit = true;
  state.usage.isLoading = false;
  state.usage.data = [
    { budget: 'project', used: 1, cap: 2 },
    { budget: 'workflow', used: 1, cap: 2 },
    { budget: 'render', used: 0, cap: 2 },
  ];
  save.mockReset().mockResolvedValue(null);
  refresh.mockReset();
  toast.mockReset();
});

describe('SandboxQuotaEditor', () => {
  it('recomputes all three limits live and saves a total equal to deployment capacity', async () => {
    const { user } = render(<EditorView />);
    const total = screen.getByRole('status', {
      name: 'Total organization sessions',
    });
    expect(total).toHaveTextContent('6 / 16');
    for (const [label, value, sum] of [
      ['Project agent sessions', '5', '9 / 16'],
      ['Workflow sessions', '6', '13 / 16'],
      ['Render sessions', '5', '16 / 16'],
    ]) {
      const input = screen.getByRole('spinbutton', { name: label });
      await user.clear(input);
      await user.type(input, value);
      expect(total).toHaveTextContent(sum);
    }
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'sandbox_quota',
        config: {
          maxSessionsPerOrg: 5,
          maxWorkflowSessionsPerOrg: 6,
          maxRenderSessionsPerOrg: 5,
        },
      }),
    );
  });

  it('preserves the other two configured limits when editing only one', async () => {
    state.usage.data = [
      { budget: 'project', used: 1, cap: 2 },
      { budget: 'workflow', used: 3, cap: 4 },
      { budget: 'render', used: 0, cap: 6 },
    ];
    const { user } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', {
      name: 'Project agent sessions',
    });
    await user.clear(input);
    await user.type(input, '6');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            maxSessionsPerOrg: 6,
            maxWorkflowSessionsPerOrg: 4,
            maxRenderSessionsPerOrg: 6,
          },
        }),
      ),
    );
  });

  it('blocks excess totals immediately and permits correction without losing edits', async () => {
    const { user } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', { name: 'Workflow sessions' });
    await user.clear(input);
    await user.type(input, '13');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The total of 17 sessions exceeds the deployment capacity of 16.',
    );
    for (const field of screen.getAllByRole('spinbutton')) {
      expect(field).toHaveAccessibleDescription(
        /The total of 17 sessions exceeds/,
      );
      expect(field).toHaveAttribute('aria-invalid', 'true');
    }
    // Native form submission must obey the same bound as the grouped Save.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    consoleError.mockRestore();
    expect(save).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '12');
    await user.tab();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('16 / 16');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });

  it('discards edits and the computed total without changing persisted allocation usage', async () => {
    const { user } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', { name: 'Workflow sessions' });
    await user.clear(input);
    await user.type(input, '13');
    expect(screen.getAllByText('Allocated: 1 / 2')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(input).toHaveValue(2);
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('6 / 16');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['Project agent sessions', '0'],
    ['Workflow sessions', '501'],
    ['Render sessions', '2.5'],
    ['Project agent sessions', ''],
  ])('rejects an invalid %s limit of "%s"', async (label, value) => {
    const { user } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', { name: label });
    await user.clear(input);
    if (value) await user.type(input, value);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.tab();
    expect(
      await screen.findByText('Must be a whole number between 1 and 500.'),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { deploymentLimits: undefined, deploymentLimitsLoading: true },
    {
      deploymentLimits: {
        status: 'unavailable',
        reason: 'unreachable',
      } as const,
    },
    {
      deploymentLimits: {
        status: 'unavailable',
        reason: 'not_configured',
      } as const,
    },
  ])(
    'refuses saves while deployment capacity is unknown: %j',
    async (props) => {
      const { user } = render(<EditorView {...props} />);
      const input = screen.getByRole('spinbutton', {
        name: 'Workflow sessions',
      });
      await user.clear(input);
      await user.type(input, '3');
      await user.tab();
      expect(
        screen.getByRole('status', { name: 'Total organization sessions' }),
      ).toHaveTextContent('7 / Unavailable');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(
        screen.getByText(
          'deploymentLimitsLoading' in props
            ? 'Checking deployment capacity…'
            : 'Deployment capacity is unavailable. Lowering limits still saves; refresh the infrastructure data before raising one.',
        ),
      ).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each([
    { deploymentLimits: undefined, deploymentLimitsLoading: false },
    {
      deploymentLimits: {
        status: 'unavailable',
        reason: 'unreachable',
      } as const,
    },
  ])(
    'still saves a total that does not grow while capacity is unknown: %j',
    async (props) => {
      // Shedding load is the one edit an admin needs during a sandbox
      // outage; lowering can never oversubscribe more than the saved total.
      const { user } = render(<EditorView {...props} />);
      const workflow = screen.getByRole('spinbutton', {
        name: 'Workflow sessions',
      });
      const render_ = screen.getByRole('spinbutton', {
        name: 'Render sessions',
      });
      await user.clear(workflow);
      await user.type(workflow, '1');
      await user.clear(render_);
      await user.type(render_, '3');
      await user.tab();
      // Same total as saved (2 + 1 + 3 = 6): allowed.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.getByRole('status', { name: 'Total organization sessions' }),
      ).toHaveTextContent('6 / Unavailable');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            config: {
              maxSessionsPerOrg: 2,
              maxWorkflowSessionsPerOrg: 1,
              maxRenderSessionsPerOrg: 3,
            },
          }),
        ),
      );
    },
  );

  it('revalidates dirty values when deployment capacity changes and lets existing excess be reduced', async () => {
    const { user, rerender } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', { name: 'Workflow sessions' });
    await user.clear(input);
    await user.type(input, '8');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    rerender(
      <EditorView
        deploymentLimits={{ status: 'available', maxSessions: 10 }}
      />,
    );
    expect(input).toHaveValue(8);
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('12 / 10');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '6');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });

  it('loads an existing excess unchanged and lets the user reduce it to fit', async () => {
    state.usage.data = [
      { budget: 'project', used: 1, cap: 2 },
      { budget: 'workflow', used: 3, cap: 10 },
      { budget: 'render', used: 0, cap: 8 },
    ];
    const { user } = render(<EditorView />);
    const input = screen.getByRole('spinbutton', { name: 'Render sessions' });
    expect(input).toHaveValue(8);
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('20 / 16');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            maxSessionsPerOrg: 2,
            maxWorkflowSessionsPerOrg: 10,
            maxRenderSessionsPerOrg: 4,
          },
        }),
      ),
    );
  });

  it.each([
    [
      new AppError({
        code: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
        total: 12,
        maxSessions: 10,
      }),
      'The total of 12 sessions exceeds the deployment capacity of 10. Reduce one or more limits to save.',
    ],
    [
      new BackendApiError(
        503,
        'Capacity reader failed',
        'SANDBOX_CAPACITY_UNAVAILABLE',
      ),
      'Deployment capacity is unavailable. Lowering limits still saves; refresh the infrastructure data before raising one.',
    ],
  ])(
    'retains dirty values and refreshes capacity when save is rejected: %s',
    async (error, message) => {
      save.mockRejectedValueOnce(error);
      const { user } = render(<EditorView />);
      const input = screen.getByRole('spinbutton', {
        name: 'Workflow sessions',
      });
      await user.clear(input);
      await user.type(input, '8');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            description: message,
            variant: 'destructive',
          }),
        ),
      );
      expect(toast).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(input).toHaveValue(8);
      expect(
        screen.queryByRole('button', { name: 'Saved' }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Discard' }));
      expect(input).toHaveValue(2);
    },
  );

  it('lets readers see limits and their total without editable fields or Save/Discard', () => {
    state.canEdit = false;
    render(<EditorView />);
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
    }
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('6 / 16');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard' }),
    ).not.toBeInTheDocument();
  });

  it('shows unavailable allocation data without substituting defaults or a zero total', () => {
    state.usage.data = undefined;
    render(<EditorView />);
    expect(screen.getAllByText('Allocation data unavailable')).toHaveLength(3);
    expect(screen.queryByText(/Allocated:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('Unavailable / 16');
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue(null);
    }
  });
});
