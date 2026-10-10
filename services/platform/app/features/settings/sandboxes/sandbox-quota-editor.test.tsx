import {
  ActiveEditorProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@tale/ui/editor';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { AppError } from '@/lib/shared/errors/app-error';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { SandboxQuotaEditor } from './sandbox-quota-editor';

const { state, save, refresh, toast, refetch } = vi.hoisted(() => ({
  state: {
    canEdit: true,
    usage: {
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null as Error | null,
      refetch: vi.fn(),
      data: undefined as
        | Array<{ budget: string; used: number; cap: number }>
        | undefined,
    },
  },
  save: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => !state.canEdit }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => state.usage,
}));
vi.mock('@tale/ui/use-toast', () => ({ toast }));
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
  state.usage.isError = false;
  state.usage.isFetching = false;
  state.usage.error = null;
  state.usage.refetch = refetch;
  refetch.mockReset().mockResolvedValue(undefined);
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
      ['Agent workers', '5', '9 / 16'],
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
      name: 'Agent workers',
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

  it("counts the organization's devices toward the ceiling, as the server does", async () => {
    const { user } = render(
      <EditorView
        deploymentLimits={{
          status: 'available',
          maxSessions: 10,
          deviceSessions: 4,
        }}
      />,
    );
    const total = screen.getByRole('status', {
      name: 'Total organization sessions',
    });
    expect(total).toHaveTextContent('6 / 14');
    expect(
      screen.getByText(/plus the 4 sandboxes your devices run/),
    ).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: 'Workflow sessions' });
    await user.clear(input);
    await user.type(input, '11');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The total of 15 sessions exceeds the capacity of 14: 10 on the deployment and 4 on your devices.',
    );
    await user.clear(input);
    await user.type(input, '10');
    await user.tab();
    // Beyond the deployment's 10, inside its 10 plus the devices' 4.
    expect(total).toHaveTextContent('14 / 14');
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
    ['Agent workers', '0'],
    ['Workflow sessions', '501'],
    ['Render sessions', '2.5'],
    ['Agent workers', ''],
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

  it('says how many agent runs wait for a free worker, under that limit alone', () => {
    const { rerender } = render(<EditorView waitingForWorkers={1} />);
    const row = screen
      .getByRole('spinbutton', { name: 'Agent workers' })
      .closest('[data-settings-field-row]') as HTMLElement;
    expect(
      within(row).getByText('1 agent run is waiting for a free worker.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/waiting for a free worker/)).toHaveLength(1);

    // Nothing waits, or the count is not the reader's: no line at all.
    rerender(<EditorView waitingForWorkers={0} />);
    expect(screen.queryByText(/waiting for a free worker/)).toBeNull();
    rerender(<EditorView />);
    expect(screen.queryByText(/waiting for a free worker/)).toBeNull();
  });

  it.each([
    new BackendApiError(503, 'Internal allocation reader payload'),
    new Error('Allocation service is temporarily offline.'),
  ])(
    'shows a safe allocation-read error and retries before recovering: %s',
    async (error) => {
      const recovered = [
        { budget: 'project', used: 1, cap: 3 },
        { budget: 'workflow', used: 0, cap: 4 },
        { budget: 'render', used: 0, cap: 2 },
      ];
      state.usage.data = undefined;
      state.usage.isError = true;
      state.usage.error = error;
      const { user, rerender } = render(<EditorView />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load sandbox allocation data");
      if (error instanceof BackendApiError) {
        expect(alert).not.toHaveTextContent(
          'Internal allocation reader payload',
        );
      } else {
        expect(alert).toHaveTextContent(
          'Allocation service is temporarily offline.',
        );
      }
      expect(
        screen.queryByText('Allocation data unavailable'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Deployment capacity is unavailable/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument();
      for (const input of screen.getAllByRole('spinbutton')) {
        expect(input).toBeDisabled();
        expect(input).toHaveValue(null);
      }

      let finishRetry = () => {};
      refetch.mockImplementationOnce(() => {
        state.usage.isFetching = true;
        state.usage.isLoading = true;
        state.usage.isError = false;
        state.usage.error = null;
        return new Promise<void>((resolve) => {
          finishRetry = resolve;
        });
      });
      const retry = screen.getByRole('button', { name: 'Retry' });
      await user.click(retry);
      rerender(<EditorView />);
      expect(refetch).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
      expect(retry).toBeDisabled();
      expect(retry).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('alert')).toBe(alert);
      if (!(error instanceof BackendApiError)) {
        expect(alert).toHaveTextContent(
          'Allocation service is temporarily offline.',
        );
      }
      for (const input of screen.getAllByRole('spinbutton')) {
        expect(input).toBeDisabled();
      }
      await user.click(retry);
      expect(refetch).toHaveBeenCalledOnce();
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument();

      state.usage.data = recovered;
      state.usage.isError = false;
      state.usage.isFetching = false;
      state.usage.isLoading = false;
      state.usage.error = null;
      finishRetry();
      rerender(<EditorView />);
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
      const workflow = screen.getByRole('spinbutton', {
        name: 'Workflow sessions',
      });
      await waitFor(() => expect(workflow).toHaveValue(4));
      for (const input of screen.getAllByRole('spinbutton'))
        expect(input).toBeEnabled();
      expect(
        screen.getByRole('status', { name: 'Total organization sessions' }),
      ).toHaveTextContent('9 / 16');
      await user.clear(workflow);
      await user.type(workflow, '5');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          organizationId: 'org-1',
          policyType: 'sandbox_quota',
          config: {
            maxSessionsPerOrg: 3,
            maxWorkflowSessionsPerOrg: 5,
            maxRenderSessionsPerOrg: 2,
          },
        }),
      );
    },
  );

  it('blocks editing and saving cached limits after an allocation refresh fails', async () => {
    const { user, rerender } = render(<EditorView />);
    const workflow = screen.getByRole('spinbutton', {
      name: 'Workflow sessions',
    });
    await user.clear(workflow);
    await user.type(workflow, '3');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    state.usage.isError = true;
    state.usage.error = new BackendApiError(503, 'Reader failed');
    rerender(<EditorView />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load sandbox allocation data",
    );
    expect(screen.queryByText(/Allocated:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    for (const input of screen.getAllByRole('spinbutton'))
      expect(input).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([undefined, [{ budget: 'project', used: 1, cap: 2 }]])(
    'shows successful incomplete allocation data without substituting defaults or a zero total: %j',
    (data) => {
      state.usage.data = data;
      render(<EditorView />);
      expect(screen.getAllByText('Allocation data unavailable')).toHaveLength(
        data ? 2 : 3,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
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
    },
  );
});
