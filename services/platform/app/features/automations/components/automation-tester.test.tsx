// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

type ExecStatusData = {
  status: string;
  currentStepName?: string;
  error?: string;
  waitingFor?: string;
};

// Mutable so each test sets the execution status the subscription returns.
const h = vi.hoisted(() => {
  const fixture: {
    startMock: ReturnType<typeof vi.fn>;
    executionStatus: { data: ExecStatusData | undefined };
    setUrlState: ReturnType<typeof vi.fn>;
    urlState: Record<string, string | null>;
  } = {
    startMock: vi.fn(() => Promise.resolve('exec-1')),
    executionStatus: { data: undefined },
    setUrlState: vi.fn(),
    urlState: { execution: null },
  };
  return fixture;
});

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) =>
      // The mock returns the key path (no template), so append params rather
      // than replace `{placeholders}` that aren't there.
      params
        ? `automations.${key} ${Object.values(params).join(' ')}`
        : `automations.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// useUrlState wraps TanStack router hooks, which need a RouterProvider; the
// tester only writes the `execution` param through it, so stub the surface.
vi.mock('@/app/hooks/use-url-state', () => ({
  useUrlState: () => ({
    state: h.urlState,
    setState: h.setUrlState,
    setStates: vi.fn(),
    clearState: vi.fn(),
    clearAll: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: () => ['{}', vi.fn()],
}));

vi.mock('@/app/components/ui/forms/json-input', () => ({
  JsonInput: (props: { label?: string; value?: string }) => (
    <textarea aria-label={props.label} defaultValue={props.value} />
  ),
}));

vi.mock('../hooks/file-queries', () => ({
  useReadWorkflow: () => ({
    data: { ok: true, config: { steps: [{ stepType: 'start', config: {} }] } },
  }),
}));

vi.mock('../hooks/file-mutations', () => ({
  useStartWorkflowFromFile: () => ({
    mutateAsync: h.startMock,
    isPending: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useExecutionStatus: () => h.executionStatus,
}));

// The debug controls pull in action-query/mutation hooks that need a Convex
// provider; the tester test only asserts whether/with what they render.
vi.mock('./automation-debug-controls', () => ({
  AutomationDebugControls: (props: { currentStepName?: string }) => (
    <div data-testid="debug-controls">{props.currentStepName}</div>
  ),
}));

import { AutomationTester } from './automation-tester';

afterEach(() => {
  vi.clearAllMocks();
  h.executionStatus = { data: undefined };
  h.urlState = { execution: null };
});

async function runExecute() {
  const user = userEvent.setup();
  render(
    <AutomationTester organizationId="org-1" workflowSlug="my-workflow" />,
  );
  await user.click(
    screen.getByRole('button', { name: 'automations.tester.execute' }),
  );
}

describe('AutomationTester result feedback (#1484)', () => {
  describe('accessibility', () => {
    it('has no critical accessibility violations', async () => {
      const { container } = render(
        <AutomationTester organizationId="org-1" workflowSlug="my-workflow" />,
      );
      await checkAccessibility(container);
    });
  });

  it('shows which step failed and why after a failed run', async () => {
    h.executionStatus = {
      data: {
        status: 'failed',
        currentStepName: 'Send Email',
        error: 'Missing recipient address',
      },
    };

    await runExecute();

    expect(h.startMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText('automations.tester.result.failed'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('automations.tester.result.failedAtStep Send Email'),
    ).toBeInTheDocument();
    expect(screen.getByText('Missing recipient address')).toBeInTheDocument();
  });

  it('shows a success state when the run completes', async () => {
    h.executionStatus = { data: { status: 'completed' } };

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByText('automations.tester.result.completed'),
      ).toBeInTheDocument(),
    );
  });

  it('mirrors the started run into the execution URL param (#1487)', async () => {
    await runExecute();

    await waitFor(() =>
      expect(h.setUrlState).toHaveBeenCalledWith('execution', 'exec-1'),
    );
  });

  it('shows a running state with the current step', async () => {
    h.executionStatus = {
      data: { status: 'running', currentStepName: 'Fetch Data' },
    };

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByText('automations.tester.result.running'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('automations.tester.result.runningStep Fetch Data'),
    ).toBeInTheDocument();
  });
});

describe('AutomationTester debug mode (#1490)', () => {
  async function runDebug() {
    const user = userEvent.setup();
    render(
      <AutomationTester organizationId="org-1" workflowSlug="my-workflow" />,
    );
    await user.click(
      screen.getByRole('button', { name: 'automations.tester.debug.button' }),
    );
  }

  it('starts the run with debugMode and a distinct trigger source', async () => {
    await runDebug();

    expect(h.startMock).toHaveBeenCalledTimes(1);
    expect(h.startMock.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      workflowSlug: 'my-workflow',
      debugMode: true,
      triggeredBy: 'debug',
    });
  });

  it('does not pass debugMode on a plain Execute run', async () => {
    await runExecute();

    expect(h.startMock).toHaveBeenCalledTimes(1);
    expect(h.startMock.mock.calls[0][0]).toMatchObject({
      triggeredBy: 'test',
    });
    expect(h.startMock.mock.calls[0][0]).not.toHaveProperty('debugMode');
  });

  it('renders the debug controls while the run is paused before a step', async () => {
    h.executionStatus = {
      data: {
        status: 'running',
        currentStepName: 'Send email',
        waitingFor: 'debug:1:send-email',
      },
    };

    await runDebug();

    await waitFor(() =>
      expect(screen.getByTestId('debug-controls')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('debug-controls')).toHaveTextContent(
      'Send email',
    );
  });

  it('does not render the debug controls for a human-input pause', async () => {
    h.executionStatus = {
      data: {
        status: 'running',
        currentStepName: 'Approval',
        waitingFor: 'approval-id-123',
      },
    };

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByText('automations.tester.result.running'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('debug-controls')).not.toBeInTheDocument();
  });
});
