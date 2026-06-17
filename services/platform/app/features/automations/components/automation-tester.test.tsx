// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

type ExecStatusData = {
  status: string;
  currentStepName?: string;
  error?: string;
  errorCode?: string;
  waitingFor?: string;
};

type StepStatusesData = {
  execution: Record<string, unknown>;
  nodes: Record<
    string,
    {
      status:
        | 'running'
        | 'success'
        | 'failed'
        | 'waiting'
        | 'paused'
        | 'canceled';
      stepName?: string;
      attempts: number;
      startedAt?: number;
      error?: string;
    }
  >;
};

// Mutable so each test sets the execution status the subscription returns.
const h = vi.hoisted(() => {
  const fixture: {
    startMock: ReturnType<typeof vi.fn>;
    executionStatus: { data: ExecStatusData | undefined };
    stepStatuses: { data: StepStatusesData | undefined };
    setUrlState: ReturnType<typeof vi.fn>;
    setUrlStates: ReturnType<typeof vi.fn>;
    urlState: Record<string, string | null>;
  } = {
    startMock: vi.fn(() => Promise.resolve('exec-1')),
    executionStatus: { data: undefined },
    stepStatuses: { data: undefined },
    setUrlState: vi.fn(),
    setUrlStates: vi.fn(),
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
    setStates: h.setUrlStates,
    clearState: vi.fn(),
    clearAll: vi.fn(),
    isPending: false,
  }),
}));

// The tester only needs the URL-state definitions object; the real module
// pulls the whole ReactFlow canvas into the jsdom test for no reason.
vi.mock('./automation-steps', () => ({
  AUTOMATION_PANEL_URL_DEFINITIONS: {
    panel: { default: null },
    step: { default: null },
  },
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
  useExecutionStepStatuses: () => h.stepStatuses,
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
  h.stepStatuses = { data: undefined };
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

describe('AutomationTester per-step feedback (#1484)', () => {
  const failedRun = () => {
    h.executionStatus = {
      data: {
        status: 'failed',
        currentStepName: 'Send Email',
        error: 'Missing recipient address',
        errorCode: 'step_failure',
      },
    };
    h.stepStatuses = {
      data: {
        execution: { status: 'failed', startedAt: 0 },
        nodes: {
          'send-email': {
            status: 'failed',
            stepName: 'Send Email',
            attempts: 1,
            startedAt: 2,
            error: 'Missing recipient address',
          },
          'fetch-data': {
            status: 'success',
            stepName: 'Fetch Data',
            attempts: 1,
            startedAt: 1,
          },
        },
      },
    };
  };

  it('lists executed steps in start order with the failing step error inline', async () => {
    failedRun();

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByRole('list', {
          name: 'automations.tester.result.stepsHeading',
        }),
      ).toBeInTheDocument(),
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Sorted by startedAt, not by (alphabetical) record key order.
    expect(items[0]).toHaveTextContent('Fetch Data');
    expect(items[1]).toHaveTextContent('Send Email');
    expect(items[1]).toHaveTextContent('Missing recipient address');
    // The run-level fallback line is suppressed when a step row carries the
    // error — no duplicated "failed at step" prose.
    expect(
      screen.queryByText('automations.tester.result.failedAtStep Send Email'),
    ).not.toBeInTheDocument();
  });

  it('opens the failing step editor when its row is clicked', async () => {
    failedRun();

    await runExecute();

    const user = userEvent.setup();
    const stepButton = await screen.findByRole('button', {
      name: 'automations.tester.result.openStep Send Email',
    });
    await user.click(stepButton);

    expect(h.setUrlStates).toHaveBeenCalledWith({
      panel: 'step',
      step: 'send-email',
    });
  });

  it('shows an attempts counter for retried/looped steps', async () => {
    failedRun();
    const sendEmail = h.stepStatuses.data?.nodes['send-email'];
    if (sendEmail) sendEmail.attempts = 3;

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByText('automations.steps.execution.attempts 3'),
      ).toBeInTheDocument(),
    );
  });

  it('falls back to the run-level error and reason when no step failed', async () => {
    h.executionStatus = {
      data: {
        status: 'failed',
        error: 'Failed to start workflow: boom',
        errorCode: 'start_failure',
      },
    };

    await runExecute();

    await waitFor(() =>
      expect(
        screen.getByText('automations.tester.result.errorCode.start_failure'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Failed to start workflow: boom'),
    ).toBeInTheDocument();
  });

  it('has no critical accessibility violations with step rows rendered', async () => {
    failedRun();
    const user = userEvent.setup();
    const { container } = render(
      <AutomationTester organizationId="org-1" workflowSlug="my-workflow" />,
    );
    await user.click(
      screen.getByRole('button', { name: 'automations.tester.execute' }),
    );
    await screen.findByRole('list', {
      name: 'automations.tester.result.stepsHeading',
    });
    await checkAccessibility(container);
  });
});
