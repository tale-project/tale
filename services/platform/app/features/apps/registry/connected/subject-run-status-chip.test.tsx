// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SubjectRunStatusChip } from './subject-run-status-chip';

// Drive the indicator query by hand; echo i18n keys so assertions read clearly.
let indicator: 'parked' | 'failed' | null | undefined;
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: indicator }),
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/convex/_generated/api', () => ({
  api: { workflow_executions: { queries: { getSubjectRunIndicator: 'q' } } },
}));
vi.mock('../../runtime/app-runtime', () => ({
  useAppRuntime: () => ({ organizationId: 'org' }),
}));

function renderChip() {
  return render(
    <SubjectRunStatusChip
      subjectType="task"
      subjectId="t1"
      fallback={<span>in_progress</span>}
    />,
  );
}

describe('SubjectRunStatusChip', () => {
  it('swaps in the destructive "Failed" badge when the latest run failed', () => {
    indicator = 'failed';
    renderChip();
    expect(screen.getByText('runs.failed')).toBeInTheDocument();
    // The kanban status is replaced, not stacked, so the row reads as one state.
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
  });

  it('swaps in the "Queued for capacity" badge when parked', () => {
    indicator = 'parked';
    renderChip();
    expect(screen.getByText('runs.queuedForCapacity')).toBeInTheDocument();
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
  });

  it('shows the status badge when there is nothing to surface (incl. loading)', () => {
    indicator = null;
    renderChip();
    expect(screen.getByText('in_progress')).toBeInTheDocument();

    indicator = undefined; // query still loading
    renderChip();
    expect(screen.getAllByText('in_progress').length).toBeGreaterThan(0);
  });
});
