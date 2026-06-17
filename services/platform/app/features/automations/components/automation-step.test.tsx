// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const h = vi.hoisted(() => {
  const fixture: {
    nodeStatus: Record<string, unknown> | null;
    viewedExecution: Record<string, unknown> | null;
    onNodeClick: ReturnType<typeof vi.fn>;
  } = {
    nodeStatus: null,
    viewedExecution: null,
    onNodeClick: vi.fn(),
  };
  return fixture;
});

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? `automations.${key} ${Object.values(params).join(' ')}`
        : `automations.${key}`,
  }),
}));

vi.mock('./invisible-handle', () => ({
  InvisibleHandle: () => null,
}));

vi.mock('./automation-callbacks-context', () => ({
  useAutomationCallbacks: () => ({
    onNodeClick: h.onNodeClick,
    onAddStep: vi.fn(),
    onAddStepOnEdge: vi.fn(),
    onDeleteEdge: vi.fn(),
  }),
}));

vi.mock('./execution-status-context', () => ({
  useNodeExecutionStatus: () => h.nodeStatus,
  useViewedExecution: () => ({
    executionId: h.viewedExecution ? 'exec-1' : null,
    execution: h.viewedExecution,
  }),
}));

vi.mock('@/app/components/ui/data-display/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json-viewer">{String(data)}</pre>
  ),
}));

import { AutomationStep } from './automation-step';

const baseData = {
  label: 'Fetch data',
  stepType: 'action' as const,
  stepSlug: 'fetch-data',
};

function nodeStatus(overrides: Partial<ExecutionNodeState>) {
  return {
    status: 'success',
    attempts: 1,
    startedAt: 1000,
    completedAt: 3500,
    ...overrides,
  };
}

const badgeName = /steps\.execution\.nodeBadgeLabel/;

afterEach(() => {
  vi.clearAllMocks();
  h.nodeStatus = null;
  h.viewedExecution = null;
});

describe('AutomationStep execution status badge (#1487)', () => {
  it('renders no badge when no execution is viewed', () => {
    render(<AutomationStep data={baseData} />);

    expect(screen.queryByRole('button', { name: badgeName })).toBeNull();
  });

  it('shows a running badge and highlights the card', () => {
    h.nodeStatus = nodeStatus({ status: 'running', completedAt: undefined });

    render(<AutomationStep data={baseData} />);

    expect(
      screen.getByRole('button', {
        name: 'automations.steps.execution.nodeBadgeLabel automations.steps.execution.status.running',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'automations.step.openStep Fetch data',
      }),
    ).toHaveClass('ring-blue-400');
  });

  it('opens a popover with the error for a failed node', async () => {
    h.nodeStatus = nodeStatus({
      status: 'failed',
      error: 'Missing recipient address',
      attempts: 3,
    });
    const user = userEvent.setup();

    render(<AutomationStep data={baseData} />);

    await user.click(screen.getByRole('button', { name: badgeName }));

    expect(
      await screen.findByText('Missing recipient address'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('automations.steps.execution.attempts 3'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'automations.step.openStep Fetch data',
      }),
    ).toHaveClass('ring-destructive');
  });

  it('opens a popover with the output preview for a successful node', async () => {
    h.nodeStatus = nodeStatus({
      status: 'success',
      outputPreview: '{"rows":3}',
      outputTruncated: true,
    });
    const user = userEvent.setup();

    render(<AutomationStep data={baseData} />);

    await user.click(screen.getByRole('button', { name: badgeName }));

    expect(await screen.findByTestId('json-viewer')).toHaveTextContent(
      '{"rows":3}',
    );
    expect(
      screen.getByText('automations.steps.execution.outputTruncated'),
    ).toBeInTheDocument();
  });

  it('still opens the step panel when the card is clicked', async () => {
    h.nodeStatus = nodeStatus({ status: 'success' });
    const user = userEvent.setup();

    render(<AutomationStep data={baseData} />);

    await user.click(
      screen.getByRole('button', {
        name: 'automations.step.openStep Fetch data',
      }),
    );

    expect(h.onNodeClick).toHaveBeenCalledWith('fetch-data');
  });

  describe('accessibility', () => {
    it('has no critical accessibility violations with a badge', async () => {
      h.nodeStatus = nodeStatus({ status: 'failed', error: 'boom' });

      const { container } = render(<AutomationStep data={baseData} />);

      await checkAccessibility(container);
    });
  });
});
