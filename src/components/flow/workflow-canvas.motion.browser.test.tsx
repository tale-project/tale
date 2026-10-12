import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';

import { render, waitFor } from '@/tests/utils/render';

import { triageFlowGraph } from './testing/flow-fixtures';
import type { FlowGraph, FlowLayout } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  window.localStorage.removeItem('tale:flow-view');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

/** Triage with a step `tag` added after Report: a graph this session has
 *  not laid out before. */
function withStep(tag: string, base = triageFlowGraph()): FlowGraph {
  const id = `probe_${tag}`;
  return {
    ...base,
    nodes: [
      ...base.nodes.slice(0, -1),
      { id, kind: 'step', label: `Probe ${tag}`, typeLabel: 'Transform' },
      ...base.nodes.slice(-1),
    ],
    edges: [
      ...base.edges,
      { id: `report>${id}`, source: 'report', target: id, kind: 'data' },
      { id: `${id}>__end`, source: id, target: '__end', kind: 'completion' },
    ],
  };
}

/** Renders a canvas whose graph the test swaps, and counts its layouts. */
async function renderLive(
  graph: FlowGraph,
  props: Partial<WorkflowCanvasProps> = {},
) {
  await page.viewport(1280, 1400);
  const layouts: FlowLayout[] = [];
  const view = render(
    <div style={{ width: 1100, height: 1300 }}>
      <WorkflowCanvas
        graph={graph}
        aria-label="Triage"
        layoutKey="triage"
        fitPolicy="all"
        onLayout={(layout) => layouts.push(layout)}
        {...props}
      />
    </div>,
  );
  await waitFor(() => expect(layouts.length).toBeGreaterThan(0), {
    timeout: 20_000,
  });
  await waitFor(() =>
    expect(
      view.container.querySelectorAll('path[data-flow-edge]'),
    ).toHaveLength(graph.edges.filter((edge) => !edge.layoutOnly).length),
  );
  await viewportAtRest();
  const swap = (next: FlowGraph, more: Partial<WorkflowCanvasProps> = {}) =>
    view.rerender(
      <div style={{ width: 1100, height: 1300 }}>
        <WorkflowCanvas
          graph={next}
          aria-label="Triage"
          layoutKey="triage"
          fitPolicy="all"
          onLayout={(layout) => layouts.push(layout)}
          {...props}
          {...more}
        />
      </div>,
    );
  return { ...view, layouts, swap };
}

const chart = (container: HTMLElement) => {
  const element = container.querySelector<HTMLElement>('[data-flow-engine]');
  if (element === null) throw new Error('no chart');
  return element;
};
const wrapper = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(id)}"]`,
  );

describe('WorkflowCanvas live relayout', () => {
  it('glides what stays, grows in what joins and fades new lines in last', async () => {
    const { container, layouts, swap } = await renderLive(triageFlowGraph());
    const next = withStep('glide');
    swap(next);
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    await waitFor(() =>
      expect(chart(container)).toHaveAttribute('data-flow-transition', 'move'),
    );

    // Every node that stays carries the move: 300 ms, out-quint.
    const issues = getComputedStyle(wrapper(container, 'issues') as Element);
    expect(issues.transitionProperty).toBe('transform');
    expect(issues.transitionDuration).toBe('0.3s');
    expect(issues.transitionTimingFunction).toBe(
      'cubic-bezier(0.22, 1, 0.36, 1)',
    );

    // The new node grows in once the glide is under way.
    const probe = await waitFor(() => {
      const button = container.querySelector('[data-flow-node="probe_glide"]');
      if (button === null) throw new Error('not drawn yet');
      return getComputedStyle(button);
    });
    expect(probe.animationName).toBe('flow-enter');
    expect(probe.animationDuration).toBe('0.2s');
    expect(probe.animationDelay).toBe('0.15s');

    // Its lines fade in last, once the boxes are nearly there.
    const line = await waitFor(() => {
      const group = container.querySelector(
        '[data-flow-edge-group="report>probe_glide"]',
      );
      if (group === null) throw new Error('not drawn yet');
      return getComputedStyle(group);
    });
    expect(line.animationName).toBe('fade-in');
    expect(line.animationDelay).toBe('0.25s');

    // Settled after 450 ms: plain again, nothing moves on a later pan.
    await waitFor(
      () =>
        expect(chart(container)).not.toHaveAttribute('data-flow-transition'),
      { timeout: 2_000 },
    );
    expect(
      getComputedStyle(wrapper(container, 'issues') as Element)
        .transitionProperty,
    ).not.toBe('transform');
  });

  it('shrinks a removed node out at its old place, then lets it go', async () => {
    const start = withStep('leave');
    const { container, layouts, swap } = await renderLive(start);
    swap(triageFlowGraph());
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    const leaving = await waitFor(() => {
      const button = container.querySelector(
        '[data-flow-leaving="probe_leave"]',
      );
      if (button === null) throw new Error('not leaving yet');
      return button;
    });
    expect(getComputedStyle(leaving).animationName).toBe('flow-exit');
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving.hasAttribute('inert')).toBe(true);
    // Its lines fade out along their old routes.
    expect(
      container.querySelector('[data-flow-edge-leaving="report>probe_leave"]'),
    ).not.toBeNull();
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-flow-leaving="probe_leave"]'),
        ).toBeNull(),
      { timeout: 2_000 },
    );
  });

  it('rings nodes changed outside this tab once, and only then', async () => {
    const { container, layouts, swap } = await renderLive(triageFlowGraph(), {
      changed: { ids: new Set(['report']), key: 0 },
    });
    // The key the canvas opened with is never rung.
    expect(
      container.querySelector('[data-slot="flow-node-changed"]'),
    ).toBeNull();
    swap(withStep('ring'), {
      changed: { ids: new Set(['probe_ring', 'report']), key: 1 },
    });
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    const ring = await waitFor(() => {
      const element = container.querySelector(
        '[data-flow-node="report"] [data-slot="flow-node-changed"]',
      );
      if (element === null) throw new Error('no ring yet');
      return element;
    });
    const style = getComputedStyle(ring);
    expect(style.animationName).toBe('flow-ring');
    expect(style.animationDelay).toBe('0s');
    expect(style.animationDuration).toBe('1.2s');
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-slot="flow-node-changed"]'),
        ).toBeNull(),
      { timeout: 2_000 },
    );
  });

  it('lays a new picture out afresh, without gliding', async () => {
    const { container, layouts, swap } = await renderLive(triageFlowGraph());
    swap(withStep('fresh'), { layoutKey: 'another-version' });
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    await waitFor(() =>
      expect(
        container.querySelector('[data-flow-node="probe_fresh"]'),
      ).not.toBeNull(),
    );
    expect(chart(container)).not.toHaveAttribute('data-flow-transition');
    expect(
      getComputedStyle(wrapper(container, 'issues') as Element)
        .transitionProperty,
    ).not.toBe('transform');
    expect(
      getComputedStyle(
        container.querySelector('[data-flow-node="probe_fresh"]') as Element,
      ).animationName,
    ).not.toBe('flow-enter');
  });

  it('jumps to the new layout under reduced motion: no animation, no ring', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const { container, layouts, swap } = await renderLive(withStep('calm'));
    swap(triageFlowGraph(), {
      changed: { ids: new Set(['report']), key: 'calm' },
    });
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    await waitFor(() =>
      expect(
        container.querySelector('[data-flow-node="probe_calm"]'),
      ).toBeNull(),
    );
    expect(chart(container)).not.toHaveAttribute('data-flow-transition');
    expect(container.querySelector('[data-flow-leaving]')).toBeNull();
    expect(
      container.querySelector('[data-slot="flow-node-changed"]'),
    ).toBeNull();
    // Nothing animates: no transition on a node, no running animation.
    expect(
      getComputedStyle(wrapper(container, 'issues') as Element)
        .transitionProperty,
    ).not.toBe('transform');
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number(animation.effect?.getComputedTiming().duration) > 1,
      );
    expect(running).toEqual([]);
    // Every box is at its final place at once.
    const final = layouts.at(-1);
    const report = wrapper(container, 'report');
    expect(report?.style.transform).toBe(
      `translate(${final?.nodes.report?.x}px, ${final?.nodes.report?.y}px)`,
    );
  });
});
