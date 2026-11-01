import { viewportAtRest } from '@tale/ui/testing/flow';
import type { UserEvent } from '@testing-library/user-event';
import { useReactFlow, type Node } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { FlowCanvas } from './flow-canvas';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
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

// React Flow's view before anything has fitted it.
const DEFAULT_VIEW = 'translate(0px, 0px) scale(1)';

// At mount the view is React Flow's default, where this column already fits
// the pane, so the nodes fitting proves nothing yet. The fit replaces that
// view in one step once the nodes are measured, zooming to show the whole
// column (about 1.14 here, never the default's 1): wait for it to land.
async function fitted() {
  await waitFor(() => expect(transform()).not.toBe(DEFAULT_VIEW));
  await waitFor(() => expect(nodesFitThePane()).toBe(true));
  return viewportAtRest();
}

/** Press a corner control; resolves with the view its ease comes to rest at. */
async function press(user: UserEvent, name: string) {
  const before = transform();
  await user.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(transform()).not.toBe(before));
  return viewportAtRest();
}

// A refit that must not come has no event to await: the pause gives one time
// to show. A runner too slow to draw it in time can only miss it, never fail
// a canvas that holds still.
const refitWindow = () => new Promise((resolve) => setTimeout(resolve, 400));

// React Flow fits once, against the box it has at mount. A canvas that then
// shrank — a window resized, a tab strip wrapping onto a second row — kept
// that zoom and cut its last boxes off. Only a real engine resizes a box.
describe('FlowCanvas fit (real layout)', () => {
  it('refits when its box shrinks', async () => {
    const { frame } = renderCanvas();
    await fitted();
    frame.style.height = '420px';
    frame.style.width = '600px';
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
  });

  it('leaves the view alone once the reader has zoomed', async () => {
    const { frame, user } = renderCanvas();
    await fitted();
    const chosen = await press(user, 'Zoom in');
    frame.style.height = '500px';
    await refitWindow();
    expect(transform()).toBe(chosen);
  });

  it('leaves the view alone once the page has moved it', async () => {
    const { frame, user } = renderCanvas();
    await fitted();
    await user.click(screen.getByRole('button', { name: 'Pan to a node' }));
    await waitFor(() => expect(transform()).toContain('scale(1)'));
    const chosen = transform();
    frame.style.width = '600px';
    await refitWindow();
    expect(transform()).toBe(chosen);
  });

  it('follows the box again after "reset view"', async () => {
    const { frame, user } = renderCanvas();
    await fitted();
    await press(user, 'Zoom in');
    await press(user, 'Reset view');
    frame.style.height = '420px';
    frame.style.width = '600px';
    await waitFor(() => expect(nodesFitThePane()).toBe(true));
  });
});

// A column far taller than the pane: 30 boxes, 160px apart.
const TALL: Node[] = Array.from({ length: 30 }, (_, i) => ({
  id: `t${i}`,
  position: { x: 0, y: i * 160 },
  width: 200,
  height: 80,
  data: { label: `Node ${i}` },
}));

describe('FlowCanvas auto fit', () => {
  it('shows a graph too tall to read whole from its top, at a readable zoom', async () => {
    render(
      <div style={{ width: 900, height: 700 }}>
        <FlowCanvas nodes={TALL} edges={[]} fitPolicy="auto" />
      </div>,
    );
    await waitFor(() => expect(transform()).not.toBe(DEFAULT_VIEW));
    const rest = await viewportAtRest();
    const zoom = Number(/scale\(([\d.]+)\)/.exec(rest)?.[1]);
    expect(zoom).toBeGreaterThanOrEqual(0.5);
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect();
    const first = document
      .querySelector('[data-id="t0"]')!
      .getBoundingClientRect();
    // The first box is at the top, centred across the pane.
    expect(first.top - pane.top).toBeGreaterThanOrEqual(0);
    expect(first.top - pane.top).toBeLessThan(80);
    expect(
      Math.abs(first.left + first.width / 2 - (pane.left + pane.width / 2)),
    ).toBeLessThan(2);
  });

  it('fits a graph that reads whole, like the all policy', async () => {
    render(
      <div data-testid="frame" style={{ width: 900, height: 700 }}>
        <FlowCanvas nodes={NODES} edges={[]} fitPolicy="auto" />
      </div>,
    );
    await fitted();
    expect(nodesFitThePane()).toBe(true);
  });
});

describe('FlowCanvas under reduced motion', () => {
  it('zooms at once, without an ease', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const { user } = renderCanvas();
    await fitted();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    // One frame later the zoom has landed: nothing eases toward it.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const landed = transform();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(transform()).toBe(landed);
  });
});
