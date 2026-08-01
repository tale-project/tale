import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { buildGraph } from '../lib/graph';
import { AutomationCanvas } from './automation-canvas';

/**
 * REAL Chromium (project `browser`): the run dialog's canvas must frame the
 * step in flight. jsdom has no layout, so React Flow's pane measures nothing
 * there and every viewport command is a silent no-op — the exact condition
 * this canvas used to mistake for success. Only a real browser can witness
 * the framing.
 *
 * Regression: the follow effect waited on `useNodesInitialized` (false in a
 * real browser long after the graph is on screen, because these nodes carry a
 * fixed box instead of a measured one) and recorded a followed step as framed
 * even when React Flow had dropped the pan or later grew its pane under it.
 * The viewport then kept its identity transform while the whole-graph fit
 * stayed switched off — nodes off-frame, an apparently empty strip, the
 * running step nowhere in sight.
 */

const PANE_HEIGHT = 600;
const PANE_WIDTH = 800;

beforeAll(() => {
  // The canvas sizes its frame with Tailwind classes and this tier loads no
  // app stylesheet, so the pane would collapse to zero height and React Flow
  // would centre against its built-in default instead of what is on screen.
  // In the app the dialog's own column gives the frame this height.
  const style = document.createElement('style');
  // `!important`: the React Flow stylesheet sizes the pane to 100% of a frame
  // that has no height here, and Vite may inject it after this rule.
  style.textContent = `.react-flow { height: ${String(PANE_HEIGHT)}px !important; width: ${String(PANE_WIDTH)}px !important; }`;
  document.head.append(style);
});

const graph = buildGraph({
  name: 'order-report',
  nodes: [
    { id: 'first', type: 'transform', input: { expr: '1 + 1' } },
    {
      id: 'second',
      type: 'transform',
      input: { expr: '{{ nodes.first.output }}' },
    },
    {
      id: 'third',
      type: 'transform',
      input: { expr: '{{ nodes.second.output }}' },
    },
  ],
});

/** Far apart, so a viewport framing one node cannot accidentally show another. */
const positions = {
  first: { x: 0, y: 0 },
  second: { x: 0, y: 1200 },
  third: { x: 0, y: 2400 },
};

// This tier registers no global cleanup, and a left-over canvas from an
// earlier case would be the one a document-wide query measures.
afterEach(cleanup);

/** The pane and one node box, measured inside THIS render's container. */
function boxes(
  container: HTMLElement,
  nodeId: string,
): { pane: DOMRect; node: DOMRect } | null {
  const pane = container.querySelector('.react-flow');
  const node = container.querySelector(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
  if (!pane || !node) return null;
  return {
    pane: pane.getBoundingClientRect(),
    node: node.getBoundingClientRect(),
  };
}

/** How far a node's own centre sits from the pane's, in screen pixels. */
function centreOffset(container: HTMLElement, nodeId: string): number {
  const measured = boxes(container, nodeId);
  if (measured === null) return Number.POSITIVE_INFINITY;
  const { pane, node } = measured;
  return Math.hypot(
    node.left + node.width / 2 - (pane.left + pane.width / 2),
    node.top + node.height / 2 - (pane.top + pane.height / 2),
  );
}

function canvas(props: {
  followNodeId: string;
  visibleNodeIds?: ReadonlySet<string>;
}) {
  return (
    <AutomationCanvas
      graph={graph}
      positions={positions}
      selectedNodeId={props.followNodeId}
      onSelectNode={vi.fn()}
      inspectorId="inspector"
      followNodeId={props.followNodeId}
      onReturnToFollow={vi.fn()}
      {...(props.visibleNodeIds !== undefined
        ? { visibleNodeIds: props.visibleNodeIds }
        : {})}
    />
  );
}

describe('AutomationCanvas — following the run', () => {
  it('centres the viewport on the followed step', async () => {
    const { container } = render(canvas({ followNodeId: 'second' }));

    // Within a few pixels of dead centre: the pan is animated, so allow the
    // last frame's rounding but nothing near a node's own height.
    await waitFor(() => {
      expect(centreOffset(container, 'second')).toBeLessThan(8);
    });
  });

  it('re-centres when the run advances to the next step', async () => {
    const { container, rerender } = render(canvas({ followNodeId: 'second' }));
    await waitFor(() => {
      expect(centreOffset(container, 'second')).toBeLessThan(8);
    });

    rerender(canvas({ followNodeId: 'third' }));

    await waitFor(() => {
      expect(centreOffset(container, 'third')).toBeLessThan(8);
    });
  });

  it('frames the drawn path when the followed step is not drawable', async () => {
    // The cursor sits outside the visible set, so the follow has no box to aim
    // at. The whole-graph fit is off while following, so without the fallback
    // fit the viewport would stay parked on nothing.
    const { container } = render(
      canvas({ followNodeId: 'third', visibleNodeIds: new Set(['first']) }),
    );

    await waitFor(() => {
      const measured = boxes(container, 'first');
      expect(measured).not.toBeNull();
      expect(measured?.node.top).toBeGreaterThanOrEqual(
        (measured?.pane.top ?? 0) - 1,
      );
      expect(measured?.node.bottom).toBeLessThanOrEqual(
        (measured?.pane.bottom ?? 0) + 1,
      );
    });
  });
});
