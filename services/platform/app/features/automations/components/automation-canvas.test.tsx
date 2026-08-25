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
 * plain click on a box selects it (or clears the selection if it was already
 * the selected box). (jsdom's synthetic clicks do not honour
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

  it('clears the selection when the selected box is clicked again', () => {
    const onSelectNode = vi.fn();
    render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId="calc"
        onSelectNode={onSelectNode}
        inspectorId="inspector"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^calc/i }));
    expect(onSelectNode).toHaveBeenCalledWith(null);
  });

  it('clears the selection when the pane is clicked', () => {
    const onSelectNode = vi.fn();
    const { container } = render(
      <AutomationCanvas
        graph={graph}
        positions={positions}
        selectedNodeId="calc"
        onSelectNode={onSelectNode}
        inspectorId="inspector"
      />,
    );
    const pane = container.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    fireEvent.click(pane as Element);
    expect(onSelectNode).toHaveBeenCalledWith(null);
  });
});
