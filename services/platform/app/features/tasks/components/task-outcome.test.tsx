import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  OperatorProjection,
  StepProjection,
} from '@/app/features/operator/types';

import { TaskOutcomeSection } from './task-outcome';

// The two data seams — the latest-run query and the projection hook — are
// stubbed; OutcomeRows itself stays real so the shared outcome contract
// (surface: "outcome" steps → entries) is exercised, not reimplemented.
const latestRun: {
  current: { executionId: string; status: string; startedAt: number } | null;
} = { current: null };
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: latestRun.current, isLoading: false }),
}));

const projectionState: { current: OperatorProjection | null } = {
  current: null,
};
vi.mock('@/app/features/operator/hooks/use-execution-projection', () => ({
  useExecutionProjection: () => ({
    projection: projectionState.current,
    isLoading: false,
    error: null,
  }),
}));

// Portal/markdown internals are irrelevant to the section contract.
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));
vi.mock(
  '@/app/features/chat/components/message-bubble/markdown-renderer',
  () => ({
    MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
  }),
);

function outcomeStep(over: Partial<StepProjection>): StepProjection {
  return {
    stepSlug: 'deliver',
    name: 'Deliver',
    stepType: 'action',
    render: 'status',
    partState: 'output_available',
    params: { surface: 'outcome' },
    ...over,
  } as StepProjection;
}

function projectionWith(
  steps: StepProjection[],
  status = 'completed',
): OperatorProjection {
  return { status, startedAt: 1, stages: [], steps };
}

function renderSection() {
  return render(
    <TaskOutcomeSection
      organizationId="org_1"
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture id
      taskId={'task_1' as never}
    />,
  );
}

beforeEach(() => {
  latestRun.current = null;
  projectionState.current = null;
});

describe('TaskOutcomeSection', () => {
  it('renders nothing for a task without a run', () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the run has no outcome-annotated steps', () => {
    latestRun.current = {
      executionId: 'exec1',
      status: 'completed',
      startedAt: 1,
    };
    projectionState.current = projectionWith([outcomeStep({ params: {} })]);
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the heading and file entries for a run with outcome files', () => {
    latestRun.current = {
      executionId: 'exec1',
      status: 'completed',
      startedAt: 1,
    };
    projectionState.current = projectionWith([
      outcomeStep({
        files: [{ name: 'screenshot.png', url: 'https://files/shot' }],
      }),
    ]);
    renderSection();
    expect(
      screen.getByRole('heading', { name: 'detail.outcome' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'screenshot.png' });
    expect(link).toHaveAttribute('href', 'https://files/shot');
  });

  it('shows pending slots while the run is still executing', () => {
    latestRun.current = {
      executionId: 'exec1',
      status: 'running',
      startedAt: 1,
    };
    projectionState.current = projectionWith(
      [
        outcomeStep({
          partState: 'upcoming',
          promisedTitle: 'return.xml',
        }),
      ],
      'running',
    );
    renderSection();
    expect(screen.getByText('return.xml')).toBeInTheDocument();
  });
});
