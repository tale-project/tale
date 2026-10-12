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

interface ExitObservation {
  element: HTMLElement;
  attached: boolean;
  animationName: string;
  ariaHidden: string | null;
  inert: boolean;
  edgeAttached: boolean;
}

/** The exit lasts 150 ms. Copy its values at a DOM commit, before an async
 * test continuation can resume with an already detached element. */
function observeExit(container: HTMLElement, id: string, edgeId: string) {
  let observation: ExitObservation | null = null;
  const observer = new MutationObserver(() => {
    const element = container.querySelector<HTMLElement>(
      `[data-flow-leaving="${CSS.escape(id)}"]`,
    );
    if (element === null || !element.isConnected) return;
    const edge = container.querySelector(
      `[data-flow-edge-leaving="${CSS.escape(edgeId)}"]`,
    );
    // React Flow commits the node and its edge separately. Observe the
    // complete exit while both are on the page, never a detached remnant.
    if (edge === null || !edge.isConnected) return;
    observation = {
      element,
      attached: element.isConnected,
      animationName: getComputedStyle(element).animationName,
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert'),
      edgeAttached: edge.isConnected,
    };
    observer.disconnect();
  });
  observer.observe(container, {
    childList: true,
    attributes: true,
    subtree: true,
  });
  return {
    read: () => {
      if (observation === null) throw new Error('no attached exit observed');
      return observation;
    },
    disconnect: () => observer.disconnect(),
  };
}

function expectExit(observation: ExitObservation) {
  expect(observation.attached).toBe(true);
  expect(observation.animationName).toBe('flow-exit');
  expect(observation.ariaHidden).toBe('true');
  expect(observation.inert).toBe(true);
  // Its lines fade out along their old routes.
  expect(observation.edgeAttached).toBe(true);
}

describe('WorkflowCanvas live relayout', () => {
  it('glides what stays, grows in what joins and fades new lines in last', async () => {
    const { container, layouts, swap } = await renderLive(triageFlowGraph());
    const next = withStep('glide');
    swap(next);
    await waitFor(() => expect(layouts).toHaveLength(2), { timeout: 20_000 });
    await waitFor(() => {
      expect(chart(container)).toHaveAttribute('data-flow-transition', 'move');
      // Every node that stays carries the move: 300 ms, out-quint.
      const issues = getComputedStyle(wrapper(container, 'issues') as Element);
      expect(issues.transitionProperty).toBe('transform');
      expect(issues.transitionDuration).toBe('0.3s');
      expect(issues.transitionTimingFunction).toBe(
        'cubic-bezier(0.22, 1, 0.36, 1)',
      );
    });

    // The new node grows in once the glide is under way.
    await waitFor(() => {
      const button = container.querySelector('[data-flow-node="probe_glide"]');
      if (button === null) throw new Error('not drawn yet');
      const probe = getComputedStyle(button);
      expect(probe.animationName).toBe('flow-enter');
      expect(probe.animationDuration).toBe('0.2s');
      expect(probe.animationDelay).toBe('0.15s');
    });

    // Its lines fade in last, once the boxes are nearly there.
    await waitFor(() => {
      const group = container.querySelector(
        '[data-flow-edge-group="report>probe_glide"]',
      );
      if (group === null) throw new Error('not drawn yet');
      const line = getComputedStyle(group);
      expect(line.animationName).toBe('fade-in');
      expect(line.animationDelay).toBe('0.25s');
    });

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
    const exit = observeExit(container, 'probe_leave', 'report>probe_leave');
    try {
      swap(triageFlowGraph());
      await waitFor(() => expect(layouts).toHaveLength(2), {
        timeout: 20_000,
      });
      expectExit(await waitFor(exit.read));
      await waitFor(
        () =>
          expect(
            container.querySelector('[data-flow-leaving="probe_leave"]'),
          ).toBeNull(),
        { timeout: 2_000 },
      );
    } finally {
      exit.disconnect();
    }
  });

  it('keeps the exit observation when the test driver resumes after removal', async () => {
    const { container, layouts, swap } = await renderLive(withStep('delayed'));
    const exit = observeExit(
      container,
      'probe_delayed',
      'report>probe_delayed',
    );
    try {
      swap(triageFlowGraph());
      await waitFor(() => expect(layouts).toHaveLength(2), {
        timeout: 20_000,
      });
      const observation = await waitFor(exit.read);
      // Resume the assertion only after the actual exit lifecycle has ended.
      await waitFor(() => expect(observation.element.isConnected).toBe(false), {
        timeout: 2_000,
      });
      expect(getComputedStyle(observation.element).animationName).toBe('');
      expectExit(observation);
    } finally {
      exit.disconnect();
    }
  });

  it('rejects a missing animation in the attached exit observation', async () => {
    const { container, layouts, swap } = await renderLive(
      withStep('no_motion'),
    );
    const style = document.createElement('style');
    style.textContent =
      '[data-flow-leaving="probe_no_motion"] { animation: none !important; }';
    document.head.append(style);
    const exit = observeExit(
      container,
      'probe_no_motion',
      'report>probe_no_motion',
    );
    try {
      swap(triageFlowGraph());
      await waitFor(() => expect(layouts).toHaveLength(2), {
        timeout: 20_000,
      });
      const observation = await waitFor(exit.read);
      expect(observation.animationName).toBe('none');
      expect(() => expectExit(observation)).toThrow('flow-exit');
    } finally {
      exit.disconnect();
      style.remove();
    }
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
    await waitFor(() => {
      const element = container.querySelector(
        '[data-flow-node="report"] [data-slot="flow-node-changed"]',
      );
      if (element === null) throw new Error('no ring yet');
      const style = getComputedStyle(element);
      expect(style.animationName).toBe('flow-ring');
      expect(style.animationDelay).toBe('0s');
      expect(style.animationDuration).toBe('1.2s');
    });
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
