import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TooltipProvider } from '../overlays/tooltip';
import { FlowPathList } from './flow-path-list';
import { FlowStepList } from './flow-step-list';
import {
  highlightForNodes,
  highlightForPaths,
  type FlowPath,
} from './paths/highlight';
import { buildPlaybackTimeline } from './playback/build-timeline';
import { FlowPlaybackBar } from './playback/flow-playback-bar';
import { usePlaybackClock } from './playback/use-playback-clock';
import {
  branchFlowGraph,
  branchRun,
  branchRunOverlay,
  reviewPullRequestsFlowGraph,
  syntheticFlowGraph,
  triageFailedRun,
  triageFlowGraph,
  triageInboxFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

const meta: Meta<typeof WorkflowCanvas> = {
  title: 'Flow/WorkflowCanvas',
  component: WorkflowCanvas,
  tags: ['autodocs'],
  // Conditions show their full words in a tooltip, which needs a provider;
  // the app gets one from `AppShell`.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
A workflow drawn from its data with an automatic ELK layout: Start, steps,
conditions with Yes and No, frames round iterating steps, End, and lines
along routes that never cross a box. One Tab stop, arrows follow the lines;
the List view says the same in text. See the guide on ui.tale.dev.
        `,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof WorkflowCanvas>;

/** A canvas whose selection the story keeps, in a frame of its own size. */
function Selectable({
  graph,
  height = 720,
  ...props
}: Partial<WorkflowCanvasProps> & { graph: FlowGraph; height?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div style={{ height }} className="p-4">
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey="story"
        framed
        {...props}
        graph={graph}
        selectedId={selected}
        onSelect={setSelected}
      />
    </div>
  );
}

/** Triage GitHub issues: the long edge runs round Score's frame. */
export const Layout: Story = {
  render: () => (
    <Selectable
      graph={triageFlowGraph()}
      legend={[
        {
          id: 'data',
          swatch: { edge: 'data' },
          label: 'Reads the output above',
        },
        { id: 'exit', swatch: { edge: 'exit' }, label: 'The run returns it' },
        { id: 'frame', swatch: { node: 'frame' }, label: 'Runs once per item' },
      ]}
    />
  ),
};

/** If/else, an else-if, a step that goes on after failing, a repeat. */
export const Branches: Story = {
  render: () => <Selectable graph={branchFlowGraph()} height={900} />,
};

/** Three steps over the same list, a frame each. */
export const Frames: Story = {
  render: () => <Selectable graph={reviewPullRequestsFlowGraph()} />,
};

/** Problems marked on a condition, a step and End. */
export const Problems: Story = {
  render: () => (
    <Selectable
      graph={triageInboxFlowGraph()}
      issues={
        new Map([
          ['__gate:triage', { errors: 1, warnings: 0 }],
          ['propose', { errors: 0, warnings: 2 }],
          ['__end', { errors: 1, warnings: 0 }],
        ])
      }
    />
  ),
};

/** Forty nodes: shown from the top at a readable zoom. */
export const Large: Story = {
  render: () => <Selectable graph={syntheticFlowGraph(40)} />,
};

/** The same graph as a list. */
export const ListView: Story = {
  render: () => (
    <div className="max-w-md p-4">
      <FlowStepList graph={branchFlowGraph()} aria-label="Route a ticket" />
    </div>
  ),
};

/** Where a finished run ended: decisions, a skipped branch, a failure in
 *  focus, a repeat's passes. */
export const RunOverlay: Story = {
  render: () => (
    <Selectable
      graph={branchFlowGraph()}
      overlay={branchRunOverlay()}
      height={900}
    />
  ),
};

const TRIAGE_TIMELINE = buildPlaybackTimeline(triageFailedRun());

function Replay() {
  const clock = usePlaybackClock({ timeline: TRIAGE_TIMELINE });
  return (
    <div className="flex flex-col gap-2 p-4">
      <div style={{ height: 720 }}>
        <WorkflowCanvas
          graph={triageFlowGraph()}
          aria-label="Triage GitHub issues, a run"
          layoutKey="story-replay"
          framed
          playback={{ timeline: TRIAGE_TIMELINE, t: clock.t }}
        />
      </div>
      <FlowPlaybackBar
        timeline={TRIAGE_TIMELINE}
        t={clock.t}
        onTChange={clock.setT}
        playing={clock.playing}
        onPlayingChange={clock.setPlaying}
        speed={clock.speed}
        onSpeedChange={clock.setSpeed}
      />
    </div>
  );
}

/** A failed run replayed: values travel the lines, Score fails on its
 *  third issue. */
export const Playback: Story = {
  render: () => <Replay />,
};

const BRANCH_TIMELINE = buildPlaybackTimeline(branchRun());

/** A wait, a skipped branch and a repeat, replayed. */
export const PlaybackWithWait: Story = {
  render: function PlaybackWithWait() {
    const timeline = BRANCH_TIMELINE;
    const clock = usePlaybackClock({ timeline });
    return (
      <div className="flex flex-col gap-2 p-4">
        <div style={{ height: 900 }}>
          <WorkflowCanvas
            graph={branchFlowGraph()}
            aria-label="Route a ticket, a run"
            layoutKey="story-wait"
            framed
            playback={{ timeline, t: clock.t }}
          />
        </div>
        <FlowPlaybackBar
          timeline={timeline}
          t={clock.t}
          onTChange={clock.setT}
          playing={clock.playing}
          onPlayingChange={clock.setPlaying}
        />
      </div>
    );
  },
};

const BRANCH_PATHS: FlowPath[] = [
  {
    id: 'urgent',
    label: 'Path 1',
    nodes: [
      'fetch',
      'classify',
      'enrich',
      '__gate:urgent',
      'urgent',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': true },
  },
  {
    id: 'normal',
    label: 'Path 2',
    nodes: [
      'fetch',
      'classify',
      'enrich',
      '__gate:urgent',
      '__gate:normal',
      'normal',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': true },
  },
  {
    id: 'low',
    label: 'Path 3',
    nodes: [
      'fetch',
      'classify',
      'enrich',
      '__gate:urgent',
      '__gate:normal',
      'low',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': false },
  },
];

/** The paths beside the chart: point at one to preview it, Enter pins. */
export const Paths: Story = {
  render: function Paths() {
    const graph = branchFlowGraph();
    const [preview, setPreview] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const shown = pinned ?? preview;
    const path = BRANCH_PATHS.find((candidate) => candidate.id === shown);
    const highlight =
      shown === 'halts'
        ? highlightForNodes(graph, ['fetch', 'classify', 'merge'], {
            tone: 'error',
          })
        : path
          ? highlightForPaths(graph, [path])
          : null;
    return (
      <div className="flex gap-3 p-4">
        <div className="border-border w-64 shrink-0 rounded-lg border py-2">
          <FlowPathList
            aria-label="Paths a run can take"
            sections={[
              {
                id: 'paths',
                rows: BRANCH_PATHS.map((each) => ({
                  id: each.id,
                  title: each.label ?? each.id,
                })),
              },
              {
                id: 'halt',
                title: 'Ends the run when it fails',
                rows: [
                  {
                    id: 'halts',
                    title: 'Fetch, Classify, Merge',
                    pinnable: false,
                  },
                ],
              },
            ]}
            previewId={preview}
            pinnedId={pinned}
            onPreview={setPreview}
            onPin={setPinned}
          />
        </div>
        <div style={{ height: 900 }} className="min-w-0 flex-1">
          <WorkflowCanvas
            graph={graph}
            aria-label="Route a ticket"
            layoutKey="story-paths"
            framed
            paths={BRANCH_PATHS}
            highlight={highlight}
          />
        </div>
      </div>
    );
  },
};
