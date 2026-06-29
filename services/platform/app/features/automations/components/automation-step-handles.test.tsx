// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// The canvas is read-only: `nodesConnectable={false}` on the FlowCanvas is NOT
// enough on its own, because `@xyflow/react` only forwards that to each node's
// `isConnectable` prop — a node that hardcodes `isConnectable={true}` on its
// handles stays drag-connectable regardless. These tests render the real node
// components with their real handles and assert the rendered handles carry no
// `connectable` class, i.e. they cannot start or accept a connection.

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('./automation-callbacks-context', () => ({
  useAutomationCallbacks: () => ({ onNodeClick: vi.fn() }),
}));

vi.mock('./execution-status-context', () => ({
  useNodeExecutionStatus: () => null,
  useViewedExecution: () => ({ executionId: null, execution: null }),
}));

import { AutomationLoopContainer } from './automation-loop-container';
import { AutomationStep } from './automation-step';

function renderInFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function expectNoConnectableHandles(container: HTMLElement) {
  const handles = container.querySelectorAll('.react-flow__handle');
  expect(handles.length).toBeGreaterThan(0);
  for (const handle of handles) {
    // `@xyflow/react` adds the `connectable` class only when `isConnectable` is
    // truthy. `@xyflow/system` validates a connection endpoint with
    // `connectable && connectableend` (see XYHandle.isValid), so dropping the
    // `connectable` class makes the handle an invalid endpoint — no connection
    // can complete on it. This is the same read-only treatment the organigram
    // canvas applies to its handles.
    expect(handle).not.toHaveClass('connectable');
  }
}

describe('automation canvas handles are non-connectable (read-only)', () => {
  it('renders AutomationStep handles as non-connectable', () => {
    const { container } = renderInFlow(
      <AutomationStep
        data={{ label: 'Fetch data', stepType: 'action', stepSlug: 'fetch' }}
      />,
    );

    expectNoConnectableHandles(container);
  });

  it('renders AutomationLoopContainer handles as non-connectable', () => {
    const { container } = renderInFlow(
      <AutomationLoopContainer data={{ label: 'Loop', stepSlug: 'loop' }} />,
    );

    expectNoConnectableHandles(container);
  });
});
