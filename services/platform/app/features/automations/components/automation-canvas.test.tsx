import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/tests/utils/render';

import { buildGraph } from '../lib/graph';
import { AutomationCanvas } from './automation-canvas';

/**
 * The canvas switches every React Flow interaction model off and puts a real
 * button inside each node box instead. React Flow answers that combination by
 * rendering node wrappers with `pointer-events: none` — which once made every
 * box unreachable by mouse while the keyboard path kept working. These tests
 * pin the repaired contract: the wrapper hands pointer events back, and a
 * plain click on a box selects it. (jsdom's synthetic clicks do not honour
 * pointer-events, so the style assertion is the load-bearing one.)
 */

const graph = buildGraph({
  name: 'order-report',
  nodes: [
    { id: 'calc', type: 'transform', input: { expr: '1 + 1' } },
    {
      id: 'summary',
      type: 'llm',
      when: '{{ nodes.calc.output.count > 0 }}',
      input: { prompt: '{{ nodes.calc.output }}' },
    },
  ],
});

/** Every node placed, so the canvas renders without waiting for auto-layout. */
const positions = {
  calc: { x: 0, y: 0 },
  summary: { x: 0, y: 200 },
};

describe('AutomationCanvas', () => {
  it('hands pointer events back to every node box', () => {
    const { container } = render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        inspectorId="inspector"
      />,
    );
    const wrappers =
      container.querySelectorAll<HTMLElement>('.react-flow__node');
    expect(wrappers).toHaveLength(2);
    for (const wrapper of wrappers) {
      expect(wrapper.style.pointerEvents).toBe('all');
    }
  });

  it('selects a node with a plain click on its box', () => {
    const onSelectNode = vi.fn();
    render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        inspectorId="inspector"
      />,
    );
    // fireEvent, not user-event: a full pointer sequence bubbles mousedown
    // into React Flow's d3-zoom pane handler, which dereferences the event's
    // `view` — null on jsdom's synthetic events.
    fireEvent.click(screen.getByRole('button', { name: /^calc/i }));
    expect(onSelectNode).toHaveBeenCalledWith('calc');
  });

  it('draws only the visible nodes when a visited set is handed in', () => {
    const { container } = render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        inspectorId="inspector"
        visibleNodeIds={new Set(['calc'])}
      />,
    );
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /^summary/i }),
    ).not.toBeInTheDocument();
  });

  it('offers the way back while the selection is off the followed step', () => {
    const onReturnToFollow = vi.fn();
    render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId="calc"
        onSelectNode={vi.fn()}
        inspectorId="inspector"
        followNodeId="summary"
        onReturnToFollow={onReturnToFollow}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /back to the current step/i }),
    );
    expect(onReturnToFollow).toHaveBeenCalledOnce();
  });

  it('hides the way back while the followed step is the selection', () => {
    render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId="summary"
        onSelectNode={vi.fn()}
        inspectorId="inspector"
        followNodeId="summary"
        onReturnToFollow={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /back to the current step/i }),
    ).not.toBeInTheDocument();
  });
});
