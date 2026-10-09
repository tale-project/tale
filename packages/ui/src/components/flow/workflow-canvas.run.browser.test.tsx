import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { FLOW_STRIP_SETTLE } from './motion/flow-motion';
import { highlightForNodes, type FlowPath } from './paths/highlight';
import { buildPlaybackTimeline } from './playback/build-timeline';
import { flowStateAt } from './playback/derive-state';
import type { FlowPlaybackTimeline } from './playback/types';
import { FLOW_PULSE_DURATION } from './render/pulse-layer';
import {
  branchFlowGraph,
  branchRunOverlay,
  triageFailedRun,
  triageFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph, FlowLayout } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const BRANCH_PATHS: FlowPath[] = [
  {
    id: 'urgent',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      'urgent',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': true },
  },
  {
    id: 'normal',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      '__gate:normal',
      'normal',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': true },
  },
  {
    id: 'low',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      '__gate:normal',
      'low',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': false },
  },
];

function Canvas(props: Partial<WorkflowCanvasProps> & { graph: FlowGraph }) {
  return (
    <div style={{ width: 1100, height: 1500 }}>
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey={`run-${props.graph.nodes.length}`}
        fitPolicy="all"
        {...props}
      />
    </div>
  );
}

/** Renders and resolves once the layout and every line are on the page. */
async function renderRun(
  props: Partial<WorkflowCanvasProps> & { graph: FlowGraph },
) {
  await page.viewport(1280, 1600);
  let layout: FlowLayout | null = null;
  const view = render(
    <Canvas
      {...props}
      onLayout={(next) => {
        layout = next;
      }}
    />,
  );
  await waitFor(
    () => {
      if (layout === null) throw new Error('not laid out yet');
    },
    { timeout: 20_000 },
  );
  await waitFor(() =>
    expect(
      view.container.querySelectorAll('path[data-flow-edge]'),
    ).toHaveLength(props.graph.edges.filter((edge) => !edge.layoutOnly).length),
  );
  await viewportAtRest();
  return {
    ...view,
    layout: layout as unknown as FlowLayout,
    rerun: (more: Partial<WorkflowCanvasProps>) =>
      view.rerender(<Canvas {...props} {...more} />),
  };
}

const node = (id: string) =>
  document.querySelector<HTMLElement>(`[data-flow-node="${CSS.escape(id)}"]`);
const strip = (id: string) =>
  node(id)?.querySelector('[data-slot="flow-node-strip"]')?.textContent;
const look = (id: string) =>
  document
    .querySelector(`path[data-flow-edge="${CSS.escape(id)}"]`)
    ?.getAttribute('data-look');

describe('WorkflowCanvas with a run', () => {
  it('draws the state of every node at the playback moment, as flowStateAt says', async () => {
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const travel = timeline.travels.find(
      (candidate) => candidate.edgeId === 'issues>open_issues',
    );
    if (travel === undefined) throw new Error('no travel');
    const t = travel.start + (travel.end - travel.start) * 0.25;
    const { layout } = await renderRun({ graph, playback: { timeline, t } });
    const frame = flowStateAt(graph, timeline, t);
    for (const each of graph.nodes)
      expect(node(each.id)?.getAttribute('data-flow-state'), each.id).toBe(
        frame.nodes[each.id]?.state,
      );
    expect(strip('issues')).toBe('Succeeded · 1.2 s');
    expect(
      screen.getByRole('button', { name: /^Issues \(Succeeded\)/ }),
    ).toBeInTheDocument();

    // One dot rides the line a value is on, a quarter of the way along.
    const pulses = document.querySelectorAll('[data-flow-pulse]');
    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toHaveAttribute('data-flow-pulse', 'issues>open_issues');
    const animation = pulses[0]?.getAnimations()[0];
    expect(animation?.playState).toBe('paused');
    expect(Number(animation?.currentTime)).toBeCloseTo(
      0.25 * FLOW_PULSE_DURATION,
      0,
    );
    // It fades in over its first 16 px (a fifth of a line too short for
    // that), and over its last 16 px shrinks to half and fades into the box
    // it reaches.
    const dot = pulses[0]?.firstElementChild;
    const fade = dot?.getAnimations()[0]?.effect as KeyframeEffect | undefined;
    const keyframes = fade?.getKeyframes() ?? [];
    const points = layout.edges['issues>open_issues']?.points ?? [];
    let length = 0;
    for (let index = 1; index < points.length; index++)
      length += Math.hypot(
        (points[index]?.x ?? 0) - (points[index - 1]?.x ?? 0),
        (points[index]?.y ?? 0) - (points[index - 1]?.y ?? 0),
      );
    expect(length).toBeGreaterThan(0);
    const share = keyframes[1]?.computedOffset ?? 0;
    expect(share).toBeCloseTo(Math.min(0.2, 16 / length), 5);
    expect(keyframes.at(-1)).toMatchObject({
      opacity: '0',
      transform: 'scale(0.5)',
    });
    expect(keyframes.at(-2)?.computedOffset).toBeCloseTo(1 - share, 5);
  });

  it('moves the dot with the moment, and scrubbing back resets the states', async () => {
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const travel = timeline.travels.find(
      (candidate) => candidate.edgeId === 'issues>open_issues',
    );
    if (travel === undefined) throw new Error('no travel');
    const at = (share: number) =>
      travel.start + (travel.end - travel.start) * share;
    const { rerun } = await renderRun({
      graph,
      playback: { timeline, t: at(0.25) },
    });
    rerun({ playback: { timeline, t: at(0.75) } });
    await waitFor(() =>
      expect(
        Number(
          document.querySelector('[data-flow-pulse]')?.getAnimations()[0]
            ?.currentTime,
        ),
      ).toBeCloseTo(0.75 * FLOW_PULSE_DURATION, 0),
    );
    rerun({ playback: { timeline, t: 30 } });
    await waitFor(() =>
      expect(node('issues')).toHaveAttribute('data-flow-state', 'pending'),
    );
    expect(
      document.querySelector('[data-flow-pulse="issues>open_issues"]'),
    ).toBeNull();
  });

  it('draws no dots under reduced motion: the lines say when a value arrived', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const travel = timeline.travels[1];
    const t = travel ? (travel.start + travel.end) / 2 : 0;
    await renderRun({ graph, playback: { timeline, t } });
    expect(document.querySelectorAll('[data-flow-pulse]')).toHaveLength(0);
    expect(look('__start>issues')).toBe('travelled');
  });

  it('brings a failed run’s way to its failure forward', async () => {
    const graph = triageFlowGraph();
    const timeline: FlowPlaybackTimeline =
      buildPlaybackTimeline(triageFailedRun());
    const { rerun } = await renderRun({
      graph,
      playback: { timeline, t: timeline.duration },
    });
    expect(node('score')).toHaveAttribute('data-flow-state', 'failed');
    expect(strip('score')).toBe(
      'The model provider refused the request · 4 of 4 items',
    );
    expect(look('open_issues>score')).toBe('error');
    expect(look('issues>open_issues')).toBe('travelled');
    // Off the way there: stepped back, dashed, words kept.
    expect(node('report')).toHaveAttribute('data-flow-quiet', 'true');
    expect(look('score>report')).toBe('quiet');
    expect(node('__end')).toHaveAttribute('data-flow-state', 'failed');
    // The frame counts the items, beside its words, never over them.
    const counter = document.querySelector('[data-slot="flow-frame-counter"]');
    expect(counter?.textContent).toBe('4 of 4 items');
    const header = document.querySelector('[data-slot="flow-frame-header"]');
    expect(header?.getBoundingClientRect().right).toBeLessThanOrEqual(
      (counter?.getBoundingClientRect().left ?? 0) + 0.5,
    );

    rerun({
      playback: { timeline, t: timeline.duration },
      focusFailure: false,
    });
    await waitFor(() =>
      expect(node('report')).not.toHaveAttribute('data-flow-quiet'),
    );
  });

  it('says the run stopped here when the host gave no error line', async () => {
    const graph = triageFlowGraph();
    await renderRun({
      graph,
      overlay: {
        finished: true,
        nodes: {
          issues: { state: 'succeeded' },
          open_issues: { state: 'succeeded' },
          score: { state: 'failed' },
        },
      },
    });
    expect(strip('score')).toBe('The run stopped here');
    expect(strip('report')).toBe('Not run');
  });

  it('shows how each condition decided, and quiets the branch not taken', async () => {
    await renderRun({ graph: branchFlowGraph(), overlay: branchRunOverlay() });
    const decision = node('__gate:urgent')?.querySelector(
      '[data-slot="flow-gate-decision"]',
    );
    expect(decision?.textContent).toBe('No');
    expect(look('__gate:urgent>urgent')).toBe('quiet');
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>('[data-flow-edge-label]'),
    );
    expect(
      labels.filter((label) => label.dataset.taken === 'true'),
    ).toHaveLength(2);
    expect(
      labels.filter((label) => label.dataset.taken === 'false'),
    ).toHaveLength(2);
    expect(node('urgent')).toHaveAttribute('data-flow-state', 'skipped');
    expect(strip('urgent')).toBe('Skipped: the condition is false');
    expect(
      screen.getByRole('button', {
        name: /^Condition for Urgent: urgent of Classify is true \(Condition was false\)/,
      }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="flow-frame-counter"]')?.textContent,
    ).toBe('Pass 3 of 5');
  });
});

describe('WorkflowCanvas run motion', () => {
  /** The strip settles the canvas asked the browser for. */
  const settles = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(
      ([keyframes]) =>
        JSON.stringify(keyframes) ===
        JSON.stringify(FLOW_STRIP_SETTLE.keyframes),
    );

  it('sweeps a running node’s top bar, and holds it still under reduced motion', async () => {
    const overlay = {
      finished: false,
      nodes: { issues: { state: 'running' as const } },
    };
    const { unmount } = await renderRun({ graph: triageFlowGraph(), overlay });
    const bar = () =>
      node('issues')?.querySelector('[data-slot="flow-node-running"] > span');
    let style = getComputedStyle(bar() as Element);
    expect(style.animationName).toBe('flow-running-sweep');
    expect(style.animationDuration).toBe('1.6s');
    expect(style.animationTimingFunction).toBe(
      'cubic-bezier(0.42, 0, 0.58, 1)',
    );
    expect(style.animationIterationCount).toBe('infinite');
    // A soft light, a third of a faint track: calm beside other runners.
    const track = node('issues')?.querySelector<HTMLElement>(
      '[data-slot="flow-node-running"]',
    );
    expect(getComputedStyle(track as Element).backgroundColor).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(style.backgroundImage).toContain('linear-gradient');
    expect(
      (bar() as HTMLElement).getBoundingClientRect().width /
        (track as HTMLElement).getBoundingClientRect().width,
    ).toBeCloseTo(1 / 3, 1);
    unmount();

    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await renderRun({ graph: triageFlowGraph(), overlay });
    style = getComputedStyle(bar() as Element);
    // Still there, still blue, the whole track — it only stops moving.
    expect(style.animationName).toBe('none');
    expect(style.backgroundImage).toBe('none');
    expect(bar()).toBeVisible();
    expect((bar() as HTMLElement).getBoundingClientRect().width).toBeCloseTo(
      (
        node('issues')?.querySelector(
          '[data-slot="flow-node-running"]',
        ) as Element
      ).getBoundingClientRect().width,
      0,
    );
  });

  it('settles a strip softly as the run plays on, and swaps it when scrubbing back', async () => {
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const issues = timeline.spans.find((span) => span.nodeId === 'issues');
    if (issues?.end === undefined) throw new Error('no issues span');
    const running = (issues.start + issues.end) / 2;
    const { rerun } = await renderRun({
      graph,
      playback: { timeline, t: running },
    });
    expect(strip('issues')).toBe('Running');
    const animate = vi.spyOn(Element.prototype, 'animate');
    try {
      rerun({ playback: { timeline, t: issues.end + 1 } });
      await waitFor(() => expect(strip('issues')).toBe('Succeeded · 1.2 s'));
      const forward = settles(animate);
      expect(forward.length).toBeGreaterThan(0);
      expect(forward[0]?.[1]).toEqual(FLOW_STRIP_SETTLE.options);
      expect(FLOW_STRIP_SETTLE.options.duration).toBe(150);

      animate.mockClear();
      rerun({ playback: { timeline, t: running } });
      await waitFor(() => expect(strip('issues')).toBe('Running'));
      expect(settles(animate)).toEqual([]);
    } finally {
      animate.mockRestore();
    }
  });

  it('follows the node a run reaches into view, until the reader moves the view', async () => {
    await page.viewport(1280, 900);
    // Report runs from 400 to 900: below the fold of a small frame.
    const timeline: FlowPlaybackTimeline = {
      duration: 1_000,
      spans: [{ nodeId: 'report', start: 400, end: 900, outcome: 'succeeded' }],
      travels: [],
      events: [400, 900],
    };
    const Small = ({ t }: { t: number }) => (
      <div data-testid="small" style={{ width: 600, height: 320 }}>
        <WorkflowCanvas
          graph={triageFlowGraph()}
          aria-label="Workflow"
          layoutKey="follow"
          fitPolicy="auto"
          playback={{ timeline, t }}
        />
      </div>
    );
    const inside = (id: string) => {
      const frame = screen.getByTestId('small').getBoundingClientRect();
      const box = node(id)?.getBoundingClientRect();
      return (
        box !== undefined &&
        box.top >= frame.top - 1 &&
        box.bottom <= frame.bottom + 1
      );
    };
    const opened = async () => {
      const view = render(<Small t={0} />);
      await waitFor(() => expect(node('report')).not.toBeNull(), {
        timeout: 20_000,
      });
      await viewportAtRest();
      expect(inside('report')).toBe(false);
      return view;
    };
    const first = await opened();
    first.rerender(<Small t={500} />);
    await waitFor(() => expect(inside('report')).toBe(true));
    await viewportAtRest();
    first.unmount();

    // The same run opened again: the reader zooms in on Start, and the run
    // no longer pulls the view away.
    const { rerender } = await opened();
    const pane = document.querySelector('.react-flow__pane');
    if (pane === null) throw new Error('no pane');
    const at = node('__start')?.getBoundingClientRect();
    pane.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        clientX: (at?.left ?? 0) + 20,
        clientY: (at?.top ?? 0) + 20,
        bubbles: true,
        cancelable: true,
      }),
    );
    await viewportAtRest();
    const moved = await viewportAtRest();
    rerender(<Small t={500} />);
    await waitFor(() =>
      expect(node('report')).toHaveAttribute('data-flow-state', 'running'),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await viewportAtRest()).toBe(moved);
    expect(inside('report')).toBe(false);
  });

  it('swaps strips at once under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const issues = timeline.spans.find((span) => span.nodeId === 'issues');
    if (issues?.end === undefined) throw new Error('no issues span');
    const { rerun } = await renderRun({
      graph,
      playback: { timeline, t: (issues.start + issues.end) / 2 },
    });
    const animate = vi.spyOn(Element.prototype, 'animate');
    try {
      rerun({ playback: { timeline, t: issues.end + 1 } });
      await waitFor(() => expect(strip('issues')).toBe('Succeeded · 1.2 s'));
      expect(settles(animate)).toEqual([]);
    } finally {
      animate.mockRestore();
    }
  });
});

describe('WorkflowCanvas highlights', () => {
  it('highlights the paths through No when a pointer rests on its label', async () => {
    const onHighlightChange = vi.fn();
    await renderRun({
      graph: branchFlowGraph(),
      paths: BRANCH_PATHS,
      onHighlightChange,
    });
    const no = Array.from(
      document.querySelectorAll<HTMLElement>('[data-flow-edge-label]'),
    ).find(
      (label) => label.dataset.flowEdgeLabel === '__gate:urgent>__gate:normal',
    );
    if (no === undefined) throw new Error('no No label');
    await userEvent.hover(no);
    await waitFor(() => expect(look('__gate:urgent>urgent')).toBe('quiet'));
    expect(look('__gate:urgent>__gate:normal')).toBe('emphasis');
    expect(node('urgent')).toHaveAttribute('data-flow-quiet', 'true');
    expect(node('normal')).toHaveAttribute('data-flow-highlighted', 'default');
    expect(node('low')).toHaveAttribute('data-flow-highlighted', 'default');
    expect(onHighlightChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodes: expect.any(Set) }),
    );
    await userEvent.unhover(no);
    await waitFor(() => expect(look('__gate:urgent>urgent')).toBe('base'));
    expect(onHighlightChange).toHaveBeenLastCalledWith(null);
  });

  it('brings a node’s own lines forward under the pointer, quieting nothing', async () => {
    await renderRun({ graph: triageFlowGraph() });
    await userEvent.hover(screen.getByRole('button', { name: 'Open issues' }));
    await waitFor(() => expect(look('issues>open_issues')).toBe('emphasis'));
    expect(look('open_issues>score')).toBe('emphasis');
    expect(look('score>report')).toBe('base');
    expect(document.querySelector('[data-flow-quiet]')).toBeNull();
    // The two stacked lines crossfade: opacity only, short, out-quint.
    for (const selector of [
      'path[data-flow-edge="issues>open_issues"]',
      'path[data-flow-edge-state="issues>open_issues"]',
    ]) {
      const style = getComputedStyle(
        document.querySelector(selector) as Element,
      );
      expect(style.transitionProperty, selector).toBe('opacity');
      expect(style.transitionDuration, selector).toBe('0.15s');
      expect(style.transitionTimingFunction, selector).toBe(
        'cubic-bezier(0.22, 1, 0.36, 1)',
      );
    }
  });

  it('shows a host highlight with its reasons, and says it once', async () => {
    const graph = branchFlowGraph();
    const highlight = {
      ...highlightForNodes(graph, ['fetch', 'classify'], { tone: 'error' }),
      reasons: { merge: 'Not on this path' },
      announcement: 'Showing the nodes that end a run',
    };
    const { rerun } = await renderRun({ graph, highlight });
    expect(node('fetch')).toHaveAttribute('data-flow-highlighted', 'error');
    expect(strip('merge')).toBe('Not on this path');
    const status = document.querySelector('[data-slot="flow-announcer"]');
    await waitFor(() =>
      expect(status).toHaveTextContent('Showing the nodes that end a run'),
    );
    rerun({ highlight: { ...highlight } });
    expect(status?.querySelectorAll('span')).toHaveLength(1);
    rerun({ highlight: null });
    await waitFor(() =>
      expect(node('fetch')).not.toHaveAttribute('data-flow-highlighted'),
    );
  });

  it.each(['light', 'dark'])(
    'keeps quiet lines and every strip readable, and passes axe (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = await renderRun({
        graph: branchFlowGraph(),
        overlay: branchRunOverlay(),
      });
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-allowed-attr',
          'aria-valid-attr-value',
          'button-name',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);
      const pane = container.querySelector('.react-flow__pane');
      if (pane === null) throw new Error('no pane');
      for (const path of container.querySelectorAll<SVGPathElement>(
        'path[data-flow-edge-state]',
      )) {
        if (getComputedStyle(path).opacity === '0') continue;
        expect(
          ratioAgainst(pane, getComputedStyle(path).stroke),
          `${theme} ${path.getAttribute('data-flow-edge-state')}`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const element of container.querySelectorAll(
        '[data-slot="flow-node-strip"], [data-slot="flow-gate-decision"], [data-slot="flow-frame-counter"]',
      ))
        expect(
          ratioAgainst(element, getComputedStyle(element).color),
          `${theme} ${element.textContent}`,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
