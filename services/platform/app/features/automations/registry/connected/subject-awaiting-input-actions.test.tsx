// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SubjectAwaitingInputActions } from './subject-awaiting-input-actions';

// Drive the indicator query by hand.
let indicator:
  | {
      state: 'parked' | 'failed' | 'awaiting_input' | null;
      failedExecutionId: string | null;
    }
  | undefined;
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: indicator }),
}));
vi.mock('@/convex/_generated/api', () => ({
  api: { workflow_executions: { queries: { getSubjectRunIndicator: 'q' } } },
}));
vi.mock('../../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => ({ organizationId: 'org' }),
}));

function renderGate() {
  return render(
    <SubjectAwaitingInputActions
      subjectType="task"
      subjectId="t1"
      cluster={<button type="button">Start</button>}
    />,
  );
}

describe('SubjectAwaitingInputActions', () => {
  it('suppresses the cluster while the run awaits input', () => {
    // A "Start" here would re-run WITHOUT the awaited answer; the row itself
    // expands (chevron / row click) to the question and the answer panel.
    indicator = { state: 'awaiting_input', failedExecutionId: null };
    const { container } = renderGate();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the cluster unchanged for every other run state', () => {
    for (const value of [
      { state: 'parked', failedExecutionId: null } as const,
      { state: 'failed', failedExecutionId: 'e1' } as const,
      { state: null, failedExecutionId: null } as const,
      undefined,
    ]) {
      indicator = value;
      const { unmount } = renderGate();
      expect(screen.getByText('Start')).toBeInTheDocument();
      unmount();
    }
  });
});
