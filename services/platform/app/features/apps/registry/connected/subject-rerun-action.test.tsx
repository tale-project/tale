// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SubjectRerunAction } from './subject-rerun-action';

// Drive the indicator query by hand.
let indicator:
  | { state: 'parked' | 'failed' | null; failedExecutionId: string | null }
  | undefined;
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: indicator }),
}));
vi.mock('@/convex/_generated/api', () => ({
  api: { workflow_executions: { queries: { getSubjectRunIndicator: 'q' } } },
}));
vi.mock('../../runtime/app-runtime', () => ({
  useAppRuntime: () => ({ organizationId: 'org' }),
}));
// Stub the shared button so we can assert it's rendered with the failed run id.
vi.mock('@/app/features/operator/components/rerun-button', () => ({
  RerunButton: ({ executionId }: { executionId: string }) => (
    <button type="button">rerun:{executionId}</button>
  ),
}));

function renderAction() {
  return render(<SubjectRerunAction subjectType="task" subjectId="t1" />);
}

describe('SubjectRerunAction', () => {
  it('renders a re-run targeting the failed run when the latest run failed', () => {
    indicator = { state: 'failed', failedExecutionId: 'e1' };
    renderAction();
    expect(screen.getByText('rerun:e1')).toBeInTheDocument();
  });

  it('renders nothing for a parked, healthy, or still-loading row', () => {
    for (const value of [
      { state: 'parked', failedExecutionId: null } as const,
      { state: null, failedExecutionId: null } as const,
      undefined,
    ]) {
      indicator = value;
      const { container } = renderAction();
      expect(container).toBeEmptyDOMElement();
    }
  });

  it('renders nothing if a failed indicator is missing its execution id', () => {
    // Defensive: never render a re-run with no target.
    indicator = { state: 'failed', failedExecutionId: null };
    const { container } = renderAction();
    expect(container).toBeEmptyDOMElement();
  });
});
