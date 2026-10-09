import type { FlowLegendEntry } from '@tale/ui/flow/flow-legend';
import type { FlowHighlight } from '@tale/ui/flow/paths';
import type { FlowPlayback, FlowRunOverlay } from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '@/lib/engine/core/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

/**
 * The platform's half of the canvas: it turns the document into the graph
 * `@tale/ui`'s `WorkflowCanvas` draws, and puts the paths, the legend, the
 * run and the page's own controls around it. The package's own tests hold
 * the drawing (layout, routes, keyboard, motion); jsdom performs no layout,
 * so here a stand-in canvas shows what it was handed.
 */

const shown = vi.hoisted(() => ({
  props: null as null | {
    graph: FlowGraph;
    'aria-label': string;
    layoutKey: string;
    controlsId?: string;
    highlight?: FlowHighlight | null;
    overlay?: FlowRunOverlay;
    playback?: FlowPlayback;
    legend?: readonly FlowLegendEntry[];
    paths?: readonly unknown[];
  },
  compact: false,
}));

vi.mock('@tale/ui/flow/workflow-canvas', () => ({
  WorkflowCanvas: (props: {
    graph: FlowGraph;
    'aria-label': string;
    layoutKey: string;
    onSelect?: (id: string | null) => void;
    topStart?: ReactNode;
    topEnd?: ReactNode;
    notice?: ReactNode;
    toolbar?: ReactNode;
    highlight?: FlowHighlight | null;
  }) => {
    shown.props = props;
    return (
      <div>
        {props.notice}
        <div data-testid="toolbar">{props.toolbar}</div>
        <div data-testid="top-start">{props.topStart}</div>
        <div data-testid="top-end">{props.topEnd}</div>
        <div role="group" aria-label={props['aria-label']}>
          {props.graph.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              data-dashed={
                props.highlight?.nodes.has(node.id) === false ? 'quiet' : ''
              }
              onClick={() => props.onSelect?.(node.id)}
            >
              {`${node.kind} ${node.label ?? node.id}`}
            </button>
          ))}
        </div>
      </div>
    );
  },
}));

vi.mock('@tale/ui/use-media-query', () => ({
  useMediaQuery: () => shown.compact,
}));

import { nodeCatalogView } from '../lib/node-face';
import { AutomationCanvas } from './automation-canvas';

const CATALOG = nodeCatalogView([]);

/** Two ways to run: Triage only when the inbox has mail. */
const TRIAGE: Automation = {
  name: 'triage-inbox',
  nodes: [
    { id: 'inbox', type: 'transform', code: 'return [];' },
    {
      id: 'triage',
      type: 'llm',
      when: '{{ nodes.inbox.output.length > 0 }}',
      prompt: '{{ nodes.inbox.output }}',
    },
  ],
};

function renderCanvas(
  automation: Automation = TRIAGE,
  extra: Partial<Parameters<typeof AutomationCanvas>[0]> = {},
) {
  const onSelect = vi.fn();
  const utils = render(
    <AutomationCanvas
      automation={automation}
      layoutKey="triage-inbox:latest"
      catalog={CATALOG}
      selectedId={null}
      onSelect={onSelect}
      inspectorId="inspector"
      {...extra}
    />,
  );
  return { ...utils, onSelect };
}

const props = () => {
  if (shown.props === null) throw new Error('The canvas was not drawn');
  return shown.props;
};

beforeEach(() => {
  shown.props = null;
  shown.compact = false;
});

describe('AutomationCanvas', () => {
  it('draws the document with Start, its condition in words and End', () => {
    renderCanvas();
    const { graph } = props();
    expect(graph.nodes.map((node) => `${node.kind}:${node.id}`)).toEqual([
      'entry:__start',
      'step:inbox',
      'gate:__gate:triage',
      'step:triage',
      'exit:__end',
    ]);
    const gate = graph.nodes.find((node) => node.kind === 'gate');
    expect(gate).toMatchObject({
      condition: 'the output of Inbox is not empty',
    });
    expect(props()['aria-label']).toBe('Automation canvas');
    expect(props().controlsId).toBe('inspector');
    expect(props().layoutKey).toBe('triage-inbox:latest');
  });

  it('opens a box the reader picks', async () => {
    const { user, onSelect } = renderCanvas();
    await user.click(screen.getByRole('button', { name: 'step Triage' }));
    expect(onSelect).toHaveBeenCalledWith('triage');
  });

  it('says in the legend what every line and box means', () => {
    renderCanvas();
    expect(props().legend?.map((entry) => entry.label)).toEqual([
      'Solid line: reads the output of the node above',
      'Dashed line: runs after it, without reading its output',
      'Condition: decides whether the node below runs',
      'Yes: runs when the condition holds',
      "No: runs when the condition doesn't hold",
      'Dotted line: the run ends after this node',
      "Dashed box: may not run, or didn't run",
      'Frame: runs once per item, or repeats',
    ]);
  });

  it('asks a coding agent for nodes when the version has none', () => {
    renderCanvas(
      { name: 'empty', nodes: [] },
      {
        emptyAction: <button type="button">Edit with your coding agent</button>,
      },
    );
    expect(shown.props).toBeNull();
    expect(screen.getByText('This version has no nodes')).toBeVisible();
    expect(
      screen.getByText(
        'An automation does its work in nodes. Ask your coding agent to add them.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Edit with your coding agent' }),
    ).toBeVisible();
  });

  it('warns about a cycle and lists no paths', () => {
    renderCanvas({
      name: 'loop',
      nodes: [
        {
          id: 'a',
          type: 'transform',
          input: { v: '{{ nodes.b.output }}' },
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          input: { v: '{{ nodes.a.output }}' },
          code: 'return 1;',
        },
      ],
    });
    expect(
      screen.getByText('These nodes reference each other in a circle'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /paths?$/ })).toBeNull();
    // Start and End are still there to read.
    expect(screen.getByRole('button', { name: 'entry __start' })).toBeVisible();
  });

  it('lays a run over the boxes', () => {
    renderCanvas(TRIAGE, {
      run: {
        statusByNode: new Map([
          ['inbox', 'ok'],
          ['triage', 'error'],
        ]),
        projection: { byNode: new Map(), effects: [], trace: [] },
        status: 'failed',
      },
    });
    expect(props().overlay?.nodes.triage).toEqual({ state: 'failed' });
    expect(props().overlay?.finished).toBe(true);
  });
});

describe('AutomationCanvas playback', () => {
  const run = {
    statusByNode: new Map([
      ['inbox', 'ok' as const],
      ['triage', 'ok' as const],
    ]),
    projection: { byNode: new Map(), effects: [], trace: [] },
    status: 'success' as const,
  };
  function step(nodeId: string, startedAt: number, endedAt: number) {
    return {
      path: nodeId,
      nodeId,
      type: 'transform',
      status: 'succeeded' as const,
      startedAt,
      endedAt,
      activeMs: endedAt - startedAt,
      waitedMs: 0,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
      meta: {},
    };
  }
  const record = {
    format: 1 as const,
    runId: 'run-1',
    status: 'success',
    version: 1,
    mode: 'mock' as const,
    startedAt: 1000,
    finishedAt: 5000,
    source: 'record' as const,
    nodes: [step('inbox', 1000, 2000), step('triage', 2100, 4900)],
    events: [],
    eventsTotal: 0,
    cursor: 5000,
  };

  it('plays a recorded run back, opening on its end', () => {
    renderCanvas(TRIAGE, { run: { ...run, record } });
    const playback = props().playback;
    expect(playback).toBeDefined();
    expect(playback?.t).toBe(playback?.timeline.duration);
    const bar = within(screen.getByTestId('toolbar')).getByRole('group', {
      name: 'Run timeline',
    });
    expect(within(bar).getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('opens on the run’s end when the record lands after the chart', () => {
    const { rerender } = renderCanvas(TRIAGE, { run });
    expect(props().playback).toBeUndefined();
    rerender(
      <AutomationCanvas
        automation={TRIAGE}
        layoutKey="triage-inbox:latest"
        catalog={CATALOG}
        selectedId={null}
        onSelect={() => {}}
        inspectorId="inspector"
        run={{ ...run, record }}
      />,
    );
    const playback = props().playback;
    expect(playback).toBeDefined();
    expect(playback?.t).toBe(playback?.timeline.duration);
  });

  it('shows where each step ended for a run recorded before records were kept', () => {
    renderCanvas(TRIAGE, {
      run: { ...run, record: { ...record, source: 'trace' as const } },
    });
    expect(props().playback).toBeUndefined();
    expect(props().overlay?.finished).toBe(true);
    expect(
      within(screen.getByTestId('toolbar')).queryByRole('group'),
    ).toBeNull();
  });
});

describe('AutomationCanvas paths', () => {
  it('lists the paths in a panel beside the chart and lights one up', async () => {
    const { user } = renderCanvas();
    const button = within(screen.getByTestId('top-end')).getByRole('button', {
      name: '2 paths',
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const panel = screen.getByRole('region', { name: 'Possible paths' });
    expect(button).toHaveAttribute('aria-controls', panel.id);
    // The panel sits under the view switch, inside the canvas.
    expect(within(screen.getByTestId('top-start')).getByRole('region')).toBe(
      panel,
    );

    const paths = within(panel).getByRole('group', { name: 'Possible paths' });
    const [first] = within(paths).getAllByRole('button');
    if (first === undefined) throw new Error('No path rows');
    await user.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'true'));
    const highlight = props().highlight;
    expect(highlight?.announcement).toMatch(/^Showing path 1: /);
    expect(highlight?.nodes.has('triage')).toBe(true);

    // Closing the panel keeps what is pinned on the chart.
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Possible paths' })).toBeNull();
    expect(props().highlight?.nodes.has('triage')).toBe(true);
  });

  it('pins a path from a sheet on a narrow screen and leaves a pill to undo it', async () => {
    shown.compact = true;
    const { user } = renderCanvas();
    await user.click(screen.getByRole('button', { name: '2 paths' }));
    const sheet = await screen.findByRole('dialog', { name: 'Possible paths' });
    const [first] = within(
      within(sheet).getByRole('group', { name: 'Possible paths' }),
    ).getAllByRole('button');
    if (first === undefined) throw new Error('No path rows');
    await user.click(first);

    // The sheet closes on the pin (jsdom never ends its slide-out, so it
    // stays mounted, closed).
    await waitFor(() => expect(sheet).toHaveAttribute('data-state', 'closed'));
    const pill = within(screen.getByTestId('top-start'));
    expect(pill.getByText(/^Path 1 · /)).toBeVisible();
    // `hidden` and a plain click: the never-ended slide-out leaves the page
    // aria-hidden and without pointer events in jsdom; a browser lifts both
    // once the sheet is gone.
    act(() => {
      fireEvent.click(
        pill.getByRole('button', { name: 'Show all', hidden: true }),
      );
    });
    expect(props().highlight).toBeNull();
    expect(screen.queryByText(/^Path 1 · /)).toBeNull();
  });

  it('forgets a pinned path when another picture is shown', async () => {
    const { user, rerender } = renderCanvas();
    await user.click(screen.getByRole('button', { name: '2 paths' }));
    const [first] = within(
      screen.getByRole('group', { name: 'Possible paths' }),
    ).getAllByRole('button');
    if (first === undefined) throw new Error('No path rows');
    await user.click(first);
    await waitFor(() => expect(props().highlight).not.toBeNull());

    act(() => {
      rerender(
        <AutomationCanvas
          automation={TRIAGE}
          layoutKey="triage-inbox:2"
          catalog={CATALOG}
          selectedId={null}
          onSelect={vi.fn()}
          inspectorId="inspector"
        />,
      );
    });
    await waitFor(() => expect(props().highlight).toBeNull());
  });

  it('passes an axe audit with the Paths panel open', async () => {
    const { user, container } = renderCanvas();
    await user.click(screen.getByRole('button', { name: '2 paths' }));
    await checkAccessibility(container);
  });
});
