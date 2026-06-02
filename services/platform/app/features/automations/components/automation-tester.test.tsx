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
};

// Mutable so each test sets the execution status the subscription returns.
const h = vi.hoisted(() => {
  const fixture: {
    startMock: ReturnType<typeof vi.fn>;
    executionStatus: { data: ExecStatusData | undefined };
  } = {
    startMock: vi.fn(() => Promise.resolve('exec-1')),
    executionStatus: { data: undefined },
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

import { AutomationTester } from './automation-tester';

afterEach(() => {
  vi.clearAllMocks();
  h.executionStatus = { data: undefined };
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
