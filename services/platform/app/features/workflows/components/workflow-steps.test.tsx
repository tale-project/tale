// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

import { WorkflowSteps } from './workflow-steps';

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
