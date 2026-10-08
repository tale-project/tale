import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { resetFlowElkForTests } from './layout/elk-client';
import { flowNodeSize } from './layout/sizes';
import { flowEdgePaths } from './render/routed-edge';
import { branchFlowGraph, triageFlowGraph } from './testing/flow-fixtures';
import { edgeBoxCrossings } from './testing/flow-geometry';
import type { FlowGraph, FlowLayout, FlowRect } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
  vi.restoreAllMocks();
});

function Harness({
  graph,
  onLayout,
  onSelect,
  width = 1100,
  height = 1500,
  ...rest
}: Partial<WorkflowCanvasProps> & {
  graph: FlowGraph;
  width?: number;
  height?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div>
      <button type="button">Before the chart</button>
      <div data-testid="frame" style={{ width, height }}>
        <WorkflowCanvas
          graph={graph}
          aria-label="Triage GitHub issues"
          layoutKey="triage"
          selectedId={selected}
          onSelect={(id) => {
            setSelected(id);
            onSelect?.(id);
          }}
          onLayout={onLayout}
          fitPolicy="all"
          {...rest}
        />
      </div>
    </div>
  );
}

/**
 * Triage with one more node: a graph this session has not laid out yet, so
 * no cached layout answers it.
 */
function freshGraph(tag: string): FlowGraph {
  const graph = triageFlowGraph();
  const id = `probe_${tag}`;
  return {
    ...graph,
    nodes: [
      ...graph.nodes.slice(0, -1),
      { id, kind: 'step', label: 'Probe' },
      ...graph.nodes.slice(-1),
    ],
    edges: [
      ...graph.edges,
      { id: `report>${id}`, source: 'report', target: id, kind: 'data' },
      { id: `${id}>__end`, source: id, target: '__end', kind: 'completion' },
    ],
  };
}

/** Renders a graph and resolves once its layout is on the page, at rest. */
async function renderLaidOut(
  graph: FlowGraph,
  props: Partial<WorkflowCanvasProps> & {
    width?: number;
    height?: number;
  } = {},
) {
  await page.viewport(1280, 1600);
  let layout: FlowLayout | null = null;
  const view = render(
    <Harness
      graph={graph}
      onLayout={(next) => {
        layout = next;
      }}
      {...props}
    />,
  );
  await waitFor(
    () => {
      if (layout === null) throw new Error('not laid out yet');
    },
    { timeout: 20_000 },
  );
  // Every drawn edge is on the page (React Flow draws them once the boxes'
  // handles are measured), and the fit has come to rest.
  const drawn = graph.edges.filter((edge) => !edge.layoutOnly).length;
  await waitFor(
    () =>
      expect(
        view.container.querySelectorAll('path[data-flow-edge]'),
      ).toHaveLength(drawn),
    { timeout: 10_000 },
  );
  await viewportAtRest();
  // The chart fades in; colours are judged once it is fully there (a
  // reserved row's pulse runs for ever and is left alone).
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
      .map((animation) => animation.finished),
  );
  return { ...view, layout: layout as unknown as FlowLayout };
}

/** The view's translate and scale, from React Flow's viewport element. */
function viewTransform(container: HTMLElement) {
  const viewport = container.querySelector<HTMLElement>(
    '.react-flow__viewport',
  );
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
    viewport?.style.transform ?? '',
  );
  if (match === null) throw new Error('no viewport transform');
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/** Each node's box as the page draws it, mapped back to flow coordinates. */
function renderedBoxes(container: HTMLElement): Map<string, FlowRect> {
  const pane = container.querySelector('.react-flow')?.getBoundingClientRect();
  if (pane === undefined) throw new Error('no pane');
  const { x, y, zoom } = viewTransform(container);
  const boxes = new Map<string, FlowRect>();
  for (const button of container.querySelectorAll<HTMLElement>(
    '[data-flow-node]',
  )) {
    const rect = button.getBoundingClientRect();
    boxes.set(button.dataset.flowNode ?? '', {
      x: (rect.left - pane.left - x) / zoom,
      y: (rect.top - pane.top - y) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    });
  }
  return boxes;
}

describe('WorkflowCanvas', () => {
  it('lays Triage out in the worker and draws each edge along its route', async () => {
    const graph = triageFlowGraph();
    const { container, layout } = await renderLaidOut(graph);
    expect(layout.engine).toBe('worker');
    expect(
      container
        .querySelector('[data-flow-engine]')
        ?.getAttribute('data-flow-engine'),
    ).toBe('worker');
    for (const edge of graph.edges) {
      const path = container.querySelector(`path[data-flow-edge="${edge.id}"]`);
      expect(path?.getAttribute('d'), edge.id).toBe(
        flowEdgePaths(layout.edges[edge.id]?.points ?? []).stroke,
      );
    }
    // No edge is React Flow's own curve: every edge group holds a routed path.
    for (const group of container.querySelectorAll('.react-flow__edge'))
      expect(group.querySelector('path[data-flow-edge]')).not.toBeNull();
  });

  it('draws every box at its size and no line through any box on the page', async () => {
    const graph = triageFlowGraph();
    const { container, layout } = await renderLaidOut(graph);
    const boxes = renderedBoxes(container);
    for (const node of graph.nodes) {
      const box = boxes.get(node.id);
      const size = flowNodeSize(node);
      expect(box, node.id).toBeDefined();
      expect(
        Math.abs((box?.width ?? 0) - size.width),
        `${node.id} width`,
      ).toBeLessThan(1);
      expect(
        Math.abs((box?.height ?? 0) - size.height),
        `${node.id} height`,
      ).toBeLessThan(1);
    }
    const obstacles = [...boxes].map(([id, rect]) => ({ id, rect }));
    expect(edgeBoxCrossings(layout.edges, obstacles)).toEqual([]);
    // The frame header is a box too.
    const header = container.querySelector('[data-slot="flow-frame-header"]');
    expect(header?.textContent).toContain(
      'For each item of issues of Open issues',
    );
  });

  it('is one Tab stop that the arrows walk along the lines', async () => {
    const onSelect = vi.fn();
    await renderLaidOut(triageFlowGraph(), { onSelect });
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-flow-node]'),
    );
    expect(nodes.filter((node) => node.tabIndex === 0)).toHaveLength(1);

    screen.getByRole('button', { name: 'Before the chart' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Start' }),
    );
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Issues' }),
    );
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open issues' }),
    );
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open issues' }),
    );
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'End' }),
    );
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Report' }),
    );
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Start' }),
    );
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('issues');
    // The selected node now holds the Tab stop, and Tab leaves the chart.
    const issues = screen.getByRole('button', { name: 'Issues' });
    expect(issues).toHaveAttribute('aria-pressed', 'true');
    expect(issues.tabIndex).toBe(0);
    await userEvent.tab();
    expect(document.activeElement?.closest('[data-flow-node]')).toBeNull();
  });

  it('describes each node: where it sits, where it leads, what it reads', async () => {
    await renderLaidOut(triageFlowGraph());
    const score = screen.getByRole('button', { name: 'Score' });
    expect(score).toHaveAccessibleDescription(
      'Node 4 of 6. Comes from Open issues. Leads to Report. Reads Open issues and each item. Runs once for each item of issues of Open issues.',
    );
    const chart = screen.getByRole('group', { name: 'Triage GitHub issues' });
    expect(chart).toHaveAttribute('aria-roledescription', 'flow chart');
    expect(chart).toHaveAccessibleDescription(/Use the arrow keys/);
  });

  it('names a condition and its branches, and labels Yes and No', async () => {
    const { container } = await renderLaidOut(branchFlowGraph());
    const gate = screen.getByRole('button', {
      name: 'Condition for Urgent: urgent of Classify is true',
    });
    expect(gate).toHaveAccessibleDescription(
      /Yes leads to Urgent, No leads to Normal/,
    );
    const labels = Array.from(
      container.querySelectorAll('[data-flow-edge-label]'),
      (label) => label.textContent,
    );
    expect(labels.sort()).toEqual(['No', 'No', 'Yes', 'Yes']);
  });

  it.each(['light', 'dark'])(
    'passes axe and keeps every line and word readable (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = await renderLaidOut(branchFlowGraph());
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-allowed-attr',
          'aria-valid-attr-value',
          'aria-roledescription',
          'button-name',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);

      const pane = container.querySelector('.react-flow__pane');
      if (pane === null) throw new Error('no pane');
      for (const path of container.querySelectorAll('path[data-flow-edge]')) {
        expect(
          ratioAgainst(pane, getComputedStyle(path).stroke),
          `${theme} ${path.getAttribute('data-flow-edge')} line`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const label of container.querySelectorAll<HTMLElement>(
        '[data-flow-edge-label]',
      ))
        expect(
          ratioAgainst(label, getComputedStyle(label).color),
          `${theme} label`,
        ).toBeGreaterThanOrEqual(4.5);
      for (const strip of container.querySelectorAll(
        '[data-slot="flow-node-strip"]',
      ))
        expect(
          ratioAgainst(strip, getComputedStyle(strip).color),
          `${theme} strip`,
        ).toBeGreaterThanOrEqual(4.5);
      for (const header of container.querySelectorAll(
        '[data-slot="flow-frame-header"]',
      ))
        expect(
          ratioAgainst(header, getComputedStyle(header).color),
          `${theme} frame header`,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('lays out on the main thread, and says so once, when the worker cannot start', async () => {
    resetFlowElkForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const RealWorker = window.Worker;
    class RefusedWorker {
      constructor() {
        throw new Error('Refused by policy');
      }
    }
    window.Worker = RefusedWorker as unknown as typeof Worker;
    try {
      const { layout } = await renderLaidOut(freshGraph('refused'));
      expect(layout.engine).toBe('main');
      expect(warn).toHaveBeenCalledWith(
        'Flow layout worker unavailable; laying out on the main thread',
        expect.any(Error),
      );
    } finally {
      window.Worker = RealWorker;
      resetFlowElkForTests();
    }
  });

  it('switches to the List view and back, and remembers the choice', async () => {
    await renderLaidOut(triageFlowGraph());
    await userEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    const list = await screen.findByRole('list', {
      name: 'Triage GitHub issues',
    });
    expect(list).toBeInTheDocument();
    expect(window.localStorage.getItem('tale:flow-view')).toBe('list');
    await userEvent.click(
      screen.getByRole('button', { name: 'Show as chart' }),
    );
    await screen.findByRole('group', { name: 'Triage GitHub issues' });
    expect(window.localStorage.getItem('tale:flow-view')).toBe('chart');
  });

  it('shows a skeleton column, busy, until the first layout lands', async () => {
    const { container } = render(
      <Harness graph={triageFlowGraph()} layoutKey="fresh-key" />,
    );
    const chart = screen.getByRole('group', { name: 'Triage GitHub issues' });
    // A fresh picture of a graph nobody laid out before starts busy.
    expect(chart).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-skeleton-mask]')).not.toBeNull();
    await waitFor(() => expect(chart).toHaveAttribute('aria-busy', 'false'), {
      timeout: 20_000,
    });
  });
});
