// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// Capture the props ReactFlow is configured with so the test can assert the
// canvas is wired up read-only, independent of ReactFlow's internals.
const h = vi.hoisted(() => {
  const fixture: { flowCanvasProps: Record<string, unknown> } = {
    flowCanvasProps: {},
  };
  return fixture;
});

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/components/flow/flow-canvas', () => ({
  FlowCanvas: (props: { centerActions?: ReactNode; children?: ReactNode }) => {
    h.flowCanvasProps = props;
    return (
      <div data-testid="flow-canvas">
        {props.centerActions}
        {props.children}
      </div>
    );
  },
}));

vi.mock('../hooks/use-workflow-layout', () => {
  // Stable references: the component's effect depends on these arrays, so
  // returning fresh arrays each render would loop setNodes/setEdges forever.
  const EMPTY_NODES: unknown[] = [];
  const EMPTY_EDGES: unknown[] = [];
  return {
    useWorkflowLayout: () => ({
      initialNodes: EMPTY_NODES,
      initialEdges: EMPTY_EDGES,
    }),
  };
});

vi.mock('./execution-status-context', () => ({
  WORKFLOW_EXECUTION_URL_DEFINITIONS: { execution: { default: null } },
  useViewedExecution: () => ({ executionId: null, execution: null }),
  useNodeExecutionStatus: () => null,
}));

vi.mock('@/app/hooks/use-url-state', () => ({
  useUrlState: () => ({
    state: {},
    states: {},
    setState: vi.fn(),
    setStates: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

// The schedule-readiness readout normally rides a real Convex action query —
// stub it to a mutable fixture so tests can drive "no gap" vs "gap" without a
// ConvexProvider.
const scheduleReadiness = vi.hoisted(() => ({ missingFields: [] as string[] }));

vi.mock(
  '@/app/features/automations/hooks/use-automation-schedule-readiness',
  () => ({
    useAutomationScheduleReadiness: () => ({
      readiness: { required: [], schedules: [] },
      missingFields: scheduleReadiness.missingFields,
      isLoading: false,
      refetch: vi.fn(),
    }),
  }),
);

import type { StepDef } from '../utils/step-icons';
import { WorkflowSteps } from './workflow-steps';

// Minimal fixture — the banner reads only `organizationId`/`wfDefinitionId`
// off the first step to key the schedule-readiness query.
const STEP: StepDef = {
  _id: 'step-1',
  _creationTime: 0,
  organizationId: 'org-1',
  wfDefinitionId: 'wf-1',
  stepSlug: 'step-1',
  name: 'Step 1',
  stepType: 'action',
  order: 0,
  nextSteps: {},
  config: {},
};

describe('WorkflowSteps canvas editing affordances', () => {
  it('keeps the "add step" toolbar button visible but disabled', () => {
    render(<WorkflowSteps steps={[]} hasActiveTrigger={false} />);

    const addButton = screen.getByRole('button', {
      name: 'steps.toolbar.addStepUnavailable',
    });
    expect(addButton).toBeDisabled();
  });

  it('configures ReactFlow as read-only (no connect, no edge delete)', () => {
    render(<WorkflowSteps steps={[]} hasActiveTrigger={false} />);

    // Connecting nodes and deleting edges silently no-op'd before — the canvas
    // must not present those affordances at all. `nodesConnectable={false}`
    // alone is not sufficient (each node must also mark its handles
    // non-connectable) — that the rendered handles are non-connectable is
    // asserted in `workflow-step-handles.test.tsx`.
    expect(h.flowCanvasProps.nodesConnectable).toBe(false);
    expect(h.flowCanvasProps.deleteKeyCode).toBeNull();
    expect(h.flowCanvasProps.onConnect).toBeUndefined();
    expect(h.flowCanvasProps.onEdgesDelete).toBeUndefined();
  });
});

// Regression coverage for the #2605/#2606 class: the Editor tab's "this
// workflow is active" banner must not claim more-ready-than-real when an
// ACTIVE schedule is still missing required start-schema variables — it has
// to fold in the same readiness signal the Integrations-tab checklist reads
// (`useAutomationScheduleReadiness`).
describe('WorkflowSteps activity banner schedule-readiness gap (#2605/#2606)', () => {
  afterEach(() => {
    scheduleReadiness.missingFields = [];
  });

  it('shows the plain "active" banner when no schedule is missing variables', () => {
    render(
      <WorkflowSteps steps={[STEP]} hasActiveTrigger setupIncomplete={false} />,
    );

    expect(
      screen.getByText('steps.banners.hasActiveTriggers'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('steps.banners.hasActiveTriggersScheduleGap'),
    ).not.toBeInTheDocument();
  });

  it('swaps in the schedule-gap copy when an active schedule leaves required fields blank', () => {
    scheduleReadiness.missingFields = ['owner', 'repo'];

    render(
      <WorkflowSteps steps={[STEP]} hasActiveTrigger setupIncomplete={false} />,
    );

    expect(
      screen.getByText('steps.banners.hasActiveTriggersScheduleGap'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('steps.banners.hasActiveTriggers'),
    ).not.toBeInTheDocument();
  });
});
