// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';
import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

const h = vi.hoisted(() => {
  const fixture: {
    resumeMock: ReturnType<typeof vi.fn>;
    cancelMock: ReturnType<typeof vi.fn>;
    variablesQuery: {
      data: unknown;
      isPending: boolean;
      isError: boolean;
    };
  } = {
    resumeMock: vi.fn(),
    cancelMock: vi.fn(),
    variablesQuery: {
      data: { steps: {}, variables: {}, input: {} },
      isPending: false,
      isError: false,
    },
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

vi.mock('../hooks/execution-mutations', () => ({
  useResumeDebugStep: () => ({ mutate: h.resumeMock, isPending: false }),
  useCancelExecution: () => ({ mutate: h.cancelMock, isPending: false }),
}));

vi.mock('@/app/hooks/use-action-query', () => ({
  useActionQuery: () => h.variablesQuery,
}));

vi.mock('@/app/components/ui/data-display/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json-viewer">{JSON.stringify(data)}</pre>
  ),
}));

import { AutomationDebugControls } from './automation-debug-controls';

const executionId = toId<'wfExecutions'>('exec-1');

function renderControls() {
  return render(
    <AutomationDebugControls
      executionId={executionId}
      waitingFor="debug:1:send-email"
      currentStepName="Send email"
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  h.variablesQuery = {
    data: { steps: {}, variables: {}, input: {} },
    isPending: false,
    isError: false,
  };
});

describe('AutomationDebugControls (#1490)', () => {
  describe('accessibility', () => {
    it('has no critical accessibility violations', async () => {
      const { container } = renderControls();
      await checkAccessibility(container);
    });
  });

  it('shows the paused step and the variables inspector', () => {
    renderControls();

    expect(
      screen.getByText('automations.tester.debug.pausedAt Send email'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('json-viewer')).toBeInTheDocument();
  });

  it('sends a step event when Step is clicked', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(
      screen.getByRole('button', { name: 'automations.tester.debug.step' }),
    );

    expect(h.resumeMock).toHaveBeenCalledWith({ executionId, action: 'step' });
  });

  it('sends a continue event when Continue is clicked', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(
      screen.getByRole('button', {
        name: 'automations.tester.debug.continue',
      }),
    );

    expect(h.resumeMock).toHaveBeenCalledWith({
      executionId,
      action: 'continue',
    });
  });

  it('cancels the execution when Stop is clicked', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(
      screen.getByRole('button', { name: 'automations.tester.debug.stop' }),
    );

    expect(h.cancelMock).toHaveBeenCalledWith({ executionId });
  });

  it('shows a loading state while variables are being fetched', () => {
    h.variablesQuery = { data: undefined, isPending: true, isError: false };
    renderControls();

    expect(
      screen.getByText('automations.tester.debug.variablesLoading'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('json-viewer')).not.toBeInTheDocument();
  });

  it('shows an error state when the variables fetch fails', () => {
    h.variablesQuery = { data: undefined, isPending: false, isError: true };
    renderControls();

    expect(
      screen.getByText('automations.tester.debug.variablesError'),
    ).toBeInTheDocument();
  });
});
