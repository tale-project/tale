import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import {
  buildPlaybackTimeline,
  type FlowRealRun,
  type FlowRealSpan,
} from '../playback/build-timeline';
import type { FlowPlaybackTimeline } from '../playback/types';
import {
  branchFlowGraph,
  branchRun,
  flowGraphFromDoc,
  triageExplainedRun,
  triageFailedRun,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import type { FlowGraph } from '../types';
import {
  FlowRunTimeline,
  type FlowRunTimelineProps,
} from './flow-run-timeline';
import type { FlowTimelineRow } from './rows';

import '../../../globals.css';

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

/** A host: owns the clock and the selection, as a run page does. */
function Harness({
  graph,
  timeline,
  width = 900,
  height = 640,
  initialT,
  onSelect,
  ...props
}: {
  graph: FlowGraph;
  timeline: FlowPlaybackTimeline;
  width?: number;
  height?: number;
  initialT?: number;
  onSelect?: (row: FlowTimelineRow) => void;
} & Partial<Omit<FlowRunTimelineProps, 'graph' | 'timeline' | 'onSelect'>>) {
  const [t, setT] = useState(initialT ?? timeline.duration);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div>
      <button type="button">Before the steps</button>
      <div style={{ width, height }}>
        <FlowRunTimeline
          graph={graph}
          timeline={timeline}
          t={t}
          onSeek={setT}
          selectedId={selected}
          onSelect={(row) => {
            setSelected(row.id);
            onSelect?.(row);
          }}
          formatTime={(at) => `${Math.round(at)} ms`}
          formatDuration={(row) => (row.kind === 'node' ? '1 s' : undefined)}
          aria-label="Steps of the run"
          className="h-full border"
          {...props}
        />
      </div>
      <output data-testid="t">{Math.round(t)}</output>
    </div>
  );
}

const shownT = () => Number(screen.getByTestId('t').textContent);
const line = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-flow-timeline-line="${CSS.escape(id)}"]`,
  );
const tree = () => screen.getByRole('tree', { name: 'Steps of the run' });

/** A run of one node that worked through `count` items, a second each. */
function manyItems(count: number): { graph: FlowGraph; run: FlowRealRun } {
  const graph = flowGraphFromDoc(
    [{ id: 'a', reads: [], forEach: true }],
    ['a'],
  );
  const spans: FlowRealSpan[] = Array.from({ length: count }, (_, item) => ({
    nodeId: 'a',
    startedAt: item * 1_000,
    endedAt: (item + 1) * 1_000,
    outcome: 'succeeded',
    item,
  }));
  return {
    graph,
    run: { startedAt: 0, endedAt: count * 1_000, spans, travels: [] },
  };
}

/** A run of one node over three items, recorded only as the node's own
 *  stretch: its items are read on request, as a run page reads its
 *  record's pages. */
const unreadGraph = flowGraphFromDoc(
  [{ id: 'a', reads: [], forEach: true }],
  ['a'],
);
const unreadBase = buildPlaybackTimeline({
  startedAt: 0,
  endedAt: 3_000,
  spans: [
    {
      nodeId: 'a',
      startedAt: 0,
      endedAt: 3_000,
      outcome: 'succeeded',
      total: 3,
    },
  ],
  travels: [],
});

/** A host that reads a node's items when it opens — on the same clock:
 *  the items join the timeline where they ran, nothing else moves. */
function ReadingHost({
  initialSelected = null,
  reads = true,
}: {
  initialSelected?: string | null;
  reads?: boolean;
}) {
  const [asked, setAsked] = useState<string[]>([]);
  const [read, setRead] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const timeline: FlowPlaybackTimeline = read
    ? {
        ...unreadBase,
        spans: [
          ...unreadBase.spans,
          ...[0, 1, 2].map((item) => ({
            nodeId: 'a',
            start: unreadBase.fromReal(item * 1_000),
            end: unreadBase.fromReal((item + 1) * 1_000),
            outcome: 'succeeded' as const,
            item,
          })),
        ],
      }
    : unreadBase;
  return (
    <div style={{ width: 900, height: 400 }}>
      <FlowRunTimeline
        graph={unreadGraph}
        timeline={timeline}
        t={timeline.duration}
        onSeek={() => undefined}
        selectedId={selected}
        onSelect={(row) => setSelected(row.id)}
        {...(reads && {
          onExpand: (row) => setAsked((ids) => [...ids, row.id]),
        })}
        formatTime={(at) => `${Math.round(at)} ms`}
        aria-label="Steps of the run"
        className="h-full border"
      />
      <output data-testid="asked">{asked.join(',')}</output>
      <button type="button" onClick={() => setRead(true)}>
        Finish reading
      </button>
    </div>
  );
}

describe('FlowRunTimeline', () => {
  it('lists the run’s steps in time order, each named with its state, time and items', () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    render(<Harness graph={triageFlowGraph()} timeline={timeline} />);
    const items = within(tree()).getAllByRole('treeitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Start',
      'Issues (Succeeded, 1 s)',
      'Open issues (Succeeded, 1 s)',
      'Score (Failed, 1 s, 4 of 4 items)',
      'End (Failed)',
    ]);
    // Score has items to open; it says so, and it is not open yet.
    expect(items[3]).toHaveAttribute('aria-expanded', 'false');
    expect(items[1]).not.toHaveAttribute('aria-expanded');
    expect(items[3]).toHaveAttribute('aria-level', '1');
    expect(items[3]).toHaveAttribute('aria-posinset', '4');
    expect(items[3]).toHaveAttribute('aria-setsize', '5');
    expect(tree()).toHaveAccessibleDescription(/arrow keys/);
  });

  it('shows how each step stands at the moment shown: one not reached yet is pending, its words kept', () => {
    const run = triageFailedRun();
    const timeline = buildPlaybackTimeline(run);
    const t = timeline.fromReal(run.startedAt + 600);
    render(
      <Harness graph={triageFlowGraph()} timeline={timeline} initialT={t} />,
    );
    expect(line('issues')).toHaveAttribute(
      'data-flow-timeline-state',
      'running',
    );
    expect(line('score')).toHaveAttribute(
      'data-flow-timeline-state',
      'pending',
    );
    expect(line('score')).toHaveAccessibleName('Score (Not reached yet, 1 s)');
    expect(
      within(line('score') as HTMLElement).getByText('Score'),
    ).toBeVisible();
    expect(
      getComputedStyle(within(line('score') as HTMLElement).getByText('Score'))
        .opacity,
    ).toBe('1');
  });

  it('chooses a step and moves the clock to where it starts', async () => {
    const onSelect = vi.fn();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={timeline}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(line('open_issues') as HTMLElement);
    const row = onSelect.mock.calls[0]?.[0] as FlowTimelineRow | undefined;
    expect(row?.id).toBe('open_issues');
    expect(shownT()).toBe(Math.round(row?.start ?? -1));
    expect(line('open_issues')).toHaveAttribute('aria-selected', 'true');
    expect(line('issues')).toHaveAttribute('aria-selected', 'false');
    // The moment moved back: Score is not reached yet.
    expect(line('score')).toHaveAttribute(
      'data-flow-timeline-state',
      'pending',
    );
  });

  it('is one Tab stop: arrows move, → opens a step’s items and goes in, ← comes back and closes, Enter chooses', async () => {
    const onSelect = vi.fn();
    const timeline = buildPlaybackTimeline(triageFailedRun());
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={timeline}
        onSelect={onSelect}
      />,
    );
    const items = within(tree()).getAllByRole('treeitem');
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    screen.getByRole('button', { name: 'Before the steps' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(line('__start'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(line('score'));
    await userEvent.keyboard('{ArrowRight}');
    expect(line('score')).toHaveAttribute('aria-expanded', 'true');
    expect(line('score#item:2')).toHaveAccessibleName('Item 3 of 4 (Failed)');
    expect(line('score#item:2')).toHaveAttribute('aria-level', '2');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(line('score#item:0'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'score#item:2', item: 2 }),
    );
    expect(line('score#item:2')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(line('score'));
    await userEvent.keyboard('{ArrowLeft}');
    expect(line('score')).toHaveAttribute('aria-expanded', 'false');
    expect(line('score#item:2')).toBeNull();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(line('__end'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(line('__start'));
  });

  it('opens and closes a step’s items from its chevron without choosing it', async () => {
    const onSelect = vi.fn();
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={buildPlaybackTimeline(triageFailedRun())}
        onSelect={onSelect}
      />,
    );
    const chevron = line('score')?.querySelector<HTMLElement>(
      '[data-slot="flow-timeline-toggle"]',
    );
    if (!chevron) throw new Error('no chevron');
    expect(chevron).toHaveAttribute('title', 'Show items');
    await userEvent.click(chevron);
    expect(line('score')).toHaveAttribute('aria-expanded', 'true');
    expect(line('score#item:0')).not.toBeNull();
    await userEvent.click(chevron);
    expect(line('score')).toHaveAttribute('aria-expanded', 'false');
    expect(line('score#item:0')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens a step whose items are not read yet, asks for them, and says they load', async () => {
    render(<ReadingHost />);
    expect(line('a')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(
      line('a')?.querySelector('[data-slot="flow-timeline-toggle"]') as Element,
    );
    expect(screen.getByTestId('asked')).toHaveTextContent('a');
    const loading = screen.getByRole('treeitem', { name: 'Loading items…' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveAttribute('aria-level', '2');
    // ← from the loading line goes back to its step.
    loading.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(line('a'));

    await userEvent.click(
      screen.getByRole('button', { name: 'Finish reading' }),
    );
    expect(line('a#loading')).toBeNull();
    expect(line('a#item:2')).toHaveAccessibleName('Item 3 of 3 (Succeeded)');
  });

  it('keeps a step whose items no one will read closed', () => {
    render(<ReadingHost reads={false} />);
    expect(line('a')).not.toHaveAttribute('aria-expanded');
  });

  it('opens an item chosen before its step’s items were read, once they are', async () => {
    render(<ReadingHost initialSelected="a#item:1" />);
    expect(line('a#item:1')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish reading' }),
    );
    await waitFor(() =>
      expect(line('a#item:1')).toHaveAttribute('aria-selected', 'true'),
    );
    expect(line('a')).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the first 20 items, then all of them on "Show all"', async () => {
    const { graph, run } = manyItems(25);
    render(<Harness graph={graph} timeline={buildPlaybackTimeline(run)} />);
    await userEvent.click(
      line('a')?.querySelector('[data-slot="flow-timeline-toggle"]') as Element,
    );
    expect(line('a#item:19')).not.toBeNull();
    expect(line('a#item:20')).toBeNull();
    const more = screen.getByRole('treeitem', { name: 'Show all 25' });
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(line('a#item:24')).not.toBeNull();
    // The 21st item took the line's place, and the focus with it.
    await waitFor(() => expect(document.activeElement).toBe(line('a#item:20')));
    expect(document.activeElement).toHaveAccessibleName(
      'Item 21 of 25 (Succeeded)',
    );
  });

  it('windows a long list and still walks it to the end', async () => {
    const { graph, run } = manyItems(300);
    render(
      <Harness
        graph={graph}
        timeline={buildPlaybackTimeline(run)}
        height={480}
      />,
    );
    await userEvent.click(
      line('a')?.querySelector('[data-slot="flow-timeline-toggle"]') as Element,
    );
    screen.getByRole('treeitem', { name: 'Show all 300' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(line('a#item:20')).not.toBeNull());
    const mounted = within(tree()).getAllByRole('treeitem').length;
    expect(mounted).toBeLessThan(100);
    (line('a#item:20') as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(line('__end')));
    expect(line('a#item:0')).toBeNull();
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(document.activeElement).toBe(line('__start')));
  });

  it('draws each step’s bar under an axis in real time, and a cursor at the moment shown', async () => {
    const timeline = buildPlaybackTimeline(branchRun());
    const { rerender } = render(
      <Harness graph={branchFlowGraph()} timeline={timeline} />,
    );
    const cursor = document.querySelector<HTMLElement>(
      '[data-slot="flow-timeline-cursor"]',
    );
    expect(cursor?.style.transform).toBe('translateX(100%)');
    // The axis says real moments, from the host's words.
    const ticks = [
      ...document.querySelectorAll<HTMLElement>('[data-flow-axis-tick]'),
    ].filter((tick) => getComputedStyle(tick).display !== 'none');
    expect(ticks.map((tick) => tick.textContent)).toEqual([
      '0 ms',
      `${Math.round(timeline.duration / 4)} ms`,
      `${Math.round(timeline.duration / 2)} ms`,
      `${Math.round((timeline.duration * 3) / 4)} ms`,
      `${Math.round(timeline.duration)} ms`,
    ]);
    // A wait is a hatched band, a skip a dot, a decision a dot in its
    // branch's colour, a failure red.
    expect(
      line('wait:0')?.querySelector('[data-flow-bar="waiting"]'),
    ).not.toBeNull();
    const dot = line('urgent')?.querySelector<HTMLElement>(
      '[data-flow-bar="muted"]',
    );
    expect(dot?.getBoundingClientRect().width).toBeCloseTo(8, 0);
    expect(
      line('__gate:urgent')?.querySelector('[data-flow-bar="no"]'),
    ).not.toBeNull();
    expect(
      line('notify')?.querySelector('[data-flow-bar="failed"]'),
    ).not.toBeNull();
    // The bars line up with the cursor's column.
    const bar = line('fetch')?.querySelector<HTMLElement>(
      '[data-slot="flow-timeline-bar"] > span',
    );
    const column = cursor?.parentElement;
    expect(bar?.getBoundingClientRect().left).toBeCloseTo(
      column?.getBoundingClientRect().left ?? 0,
      0,
    );
    expect(bar?.getBoundingClientRect().width).toBeCloseTo(
      column?.getBoundingClientRect().width ?? 0,
      0,
    );
    // Halfway through, the cursor is halfway along.
    rerender(
      <Harness
        key="half"
        graph={branchFlowGraph()}
        timeline={timeline}
        initialT={timeline.duration / 2}
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          '[data-slot="flow-timeline-cursor"]',
        )?.style.transform,
      ).toBe('translateX(50%)'),
    );
  });

  it('hides the bars below 32rem and keeps the durations', () => {
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={buildPlaybackTimeline(triageFailedRun())}
        width={400}
      />,
    );
    const bars = document.querySelectorAll('[data-slot="flow-timeline-bar"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(getComputedStyle(bar).display).toBe('none');
    expect(
      within(line('issues') as HTMLElement).getByText('1 s'),
    ).toBeVisible();
    // A host can ask for them anyway.
    cleanup();
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={buildPlaybackTimeline(triageFailedRun())}
        width={400}
        showBars
      />,
    );
    for (const bar of document.querySelectorAll(
      '[data-slot="flow-timeline-bar"]',
    ))
      expect(getComputedStyle(bar).display).toBe('block');
  });

  it('says why a step went as it did, and lists waits and restarts', () => {
    const timeline = buildPlaybackTimeline(triageExplainedRun());
    render(<Harness graph={triageFlowGraph()} timeline={timeline} />);
    expect(line('score')).toHaveAccessibleDescription(
      'The model provider refused the request The model provider refused the request for the third issue: the prompt was too long.',
    );
    expect(line('score')).toHaveAccessibleName(
      'Score (Failed, 1 s, 4 of 12 items)',
    );
    expect(line('wait:0')).toHaveAccessibleName(
      'Waited 30 ms for approval (Ada)',
    );
    expect(line('mark:1')).toHaveAccessibleName(
      'The server restarted; another took over',
    );
    expect(line('mark:1')).toHaveAttribute(
      'data-flow-timeline-state',
      'restart',
    );
  });

  it('follows a live run while scrolled to its end, and stays put otherwise', async () => {
    const doc = Array.from({ length: 14 }, (_, index) => ({
      id: `s${String(index).padStart(2, '0')}`,
      reads: index === 0 ? [] : [`s${String(index - 1).padStart(2, '0')}`],
    }));
    const graph = flowGraphFromDoc(doc, ['s13']);
    /** The first `reached` nodes ran, the last of them still at work. */
    const liveRun = (reached: number) => {
      const spans: FlowRealSpan[] = [];
      doc.slice(0, reached).forEach((node, index) => {
        const span: FlowRealSpan = {
          nodeId: node.id,
          startedAt: index * 1_000,
          outcome: 'succeeded',
        };
        if (index < reached - 1) span.endedAt = (index + 1) * 1_000;
        spans.push(span);
      });
      return buildPlaybackTimeline({ startedAt: 0, spans, travels: [] });
    };
    const view = (reached: number) => (
      <Harness
        graph={graph}
        timeline={liveRun(reached)}
        height={240}
        initialT={liveRun(reached).duration}
      />
    );
    const { rerender } = render(view(10));
    const root = document.querySelector<HTMLElement>(
      '[data-slot="flow-run-timeline"]',
    );
    if (root === null) throw new Error('no timeline');
    const atEnd = () =>
      Math.abs(root.scrollHeight - root.scrollTop - root.clientHeight) <= 1;
    await waitFor(() => expect(atEnd()).toBe(true));
    rerender(view(12));
    await waitFor(() => expect(line('s11')).not.toBeNull());
    await waitFor(() => expect(atEnd()).toBe(true));
    // A row that joins comes in once.
    expect(line('s11')?.className).toContain('animate-row-enter');
    root.scrollTop = 0;
    root.dispatchEvent(new Event('scroll'));
    rerender(view(14));
    await waitFor(() => expect(line('s13')).not.toBeNull());
    expect(root.scrollTop).toBe(0);
  });

  it('lets rows join without an entrance under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const run = triageFailedRun();
    const partial = (until: number) =>
      buildPlaybackTimeline({
        ...run,
        endedAt: undefined,
        spans: run.spans.filter(
          (span) => span.startedAt <= run.startedAt + until,
        ),
      });
    const { rerender } = render(
      <Harness graph={triageFlowGraph()} timeline={partial(1_000)} />,
    );
    rerender(<Harness graph={triageFlowGraph()} timeline={partial(1_300)} />);
    await waitFor(() => expect(line('open_issues')).not.toBeNull());
    expect(line('open_issues')?.className).not.toContain('animate-row-enter');
  });

  it('says so when there is nothing to list', () => {
    render(
      <Harness
        graph={triageFlowGraph()}
        timeline={buildPlaybackTimeline({
          startedAt: 0,
          spans: [],
          travels: [],
        })}
        rows={[]}
      />,
    );
    expect(screen.getByText('No steps yet')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])(
    'passes axe and keeps its bars readable (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <Harness
          graph={branchFlowGraph()}
          timeline={buildPlaybackTimeline(branchRun())}
        />,
      );
      await userEvent.click(
        line('poll')?.querySelector(
          '[data-slot="flow-timeline-toggle"]',
        ) as Element,
      );
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-required-children',
          'aria-required-parent',
          'aria-allowed-attr',
          'aria-allowed-role',
          'aria-valid-attr-value',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);
      for (const bar of container.querySelectorAll<HTMLElement>(
        '[data-flow-bar]',
      )) {
        const tone = bar.dataset.flowBar;
        const color =
          tone === 'waiting'
            ? getComputedStyle(bar).color
            : getComputedStyle(bar).backgroundColor;
        expect(
          ratioAgainst(bar.parentElement as Element, color),
          `${theme} ${tone}`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
