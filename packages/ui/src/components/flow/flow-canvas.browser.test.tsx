import { useReactFlow, type Node } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { FlowCanvas } from './flow-canvas';

import '../../globals.css';

afterEach(() => {
  cleanup();
});

// A column of boxes, like an automation: 200×80 each, 160px apart.
const NODES: Node[] = Array.from({ length: 4 }, (_, i) => ({
  id: `n${i}`,
  position: { x: 0, y: i * 160 },
  width: 200,
  height: 80,
  data: { label: `Node ${i}` },
}));

// The page moving the view on purpose — as the automation canvas pans a
// picked node into sight.
function PanButton() {
  const { setViewport } = useReactFlow();
  return (
    <button
      type="button"
      onClick={() => void setViewport({ x: 40, y: -120, zoom: 1 })}
    >
      Pan to a node
    </button>
  );
}

function renderCanvas() {
  const view = render(
    <div data-testid="frame" style={{ width: 900, height: 700 }}>
      <FlowCanvas nodes={NODES} edges={[]}>
        <PanButton />
      </FlowCanvas>
    </div>,
  );
  return { ...view, frame: screen.getByTestId('frame') };
}

function nodesFitThePane(): boolean {
  const pane = document.querySelector('.react-flow');
  if (!pane) return false;
  const bounds = pane.getBoundingClientRect();
  return Array.from(document.querySelectorAll('.react-flow__node')).every(
    (node) => {
      const r = node.getBoundingClientRect();
      return (
        r.left >= bounds.left - 1 &&
        r.right <= bounds.right + 1 &&
        r.top >= bounds.top - 1 &&
        r.bottom <= bounds.bottom + 1
      );
    },
  );
}

function transform(): string {
  return (
    document.querySelector<HTMLElement>('.react-flow__viewport')?.style
      .transform ?? ''
  );
}

// React Flow fits once, against the box it has at mount. A canvas that then
// shrank — a window resized, a tab strip wrapping onto a second row — kept
// that zoom and cut its last boxes off. Only a real engine resizes a box.
describe('FlowCanvas fit (real layout)', () => {
  it('refits when its box shrinks', async () => {
    const { frame } = renderCanvas();
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
    frame.style.height = '420px';
    frame.style.width = '600px';
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
  });

  it('leaves the view alone once the reader has zoomed', async () => {
    const { frame, user } = renderCanvas();
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(transform()).not.toBe(''));
    // let the zoom animation settle
    await new Promise((resolve) => setTimeout(resolve, 400));
    const chosen = transform();
    frame.style.height = '500px';
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(transform()).toBe(chosen);
  });

  it('leaves the view alone once the page has moved it', async () => {
    const { frame, user } = renderCanvas();
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Pan to a node' }));
    await waitFor(() => expect(transform()).toContain('scale(1)'));
    const chosen = transform();
    frame.style.width = '600px';
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(transform()).toBe(chosen);
  });

  it('follows the box again after "reset view"', async () => {
    const { frame, user } = renderCanvas();
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    // the reset eases in over 300ms
    await new Promise((resolve) => setTimeout(resolve, 500));
    frame.style.height = '420px';
    frame.style.width = '600px';
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
  });
});
