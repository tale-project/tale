import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TooltipProvider } from '../../overlays/tooltip';
import { buildPlaybackTimeline } from '../playback/build-timeline';
import {
  FlowPlaybackBar,
  formatFlowClock,
} from '../playback/flow-playback-bar';
import { usePlaybackClock } from '../playback/use-playback-clock';
import {
  branchFlowGraph,
  branchRun,
  triageExplainedRun,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import type { FlowGraph } from '../types';
import { WorkflowCanvas } from '../workflow-canvas';
import { FlowRunTimeline } from './flow-run-timeline';
import type { FlowTimelineRow } from './rows';

const meta: Meta<typeof FlowRunTimeline> = {
  title: 'Flow/FlowRunTimeline',
  component: FlowRunTimeline,
  tags: ['autodocs'],
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
A run's steps in time order — Start, each node where it started, each
condition where it decided, waits, restarts and End — with time bars under
an axis in real time, driven by the timeline the canvas plays. Choosing a
step moves the shared clock there.
        `,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof FlowRunTimeline>;

const TRIAGE = buildPlaybackTimeline(triageExplainedRun());
const BRANCH = buildPlaybackTimeline(branchRun());

/** The Steps view and the canvas on one clock, as a run page has them. */
function Synced({
  graph,
  timeline,
  startedAt,
}: {
  graph: FlowGraph;
  timeline: typeof TRIAGE;
  startedAt: number;
}) {
  const clock = usePlaybackClock({ timeline });
  const [selected, setSelected] = useState<string | null>(null);
  const formatTime = (t: number) =>
    formatFlowClock(timeline.toReal(t) - startedAt);
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-2 gap-3" style={{ height: 640 }}>
        <FlowRunTimeline
          graph={graph}
          timeline={timeline}
          t={clock.t}
          onSeek={clock.setT}
          selectedId={selected}
          onSelect={(row: FlowTimelineRow) =>
            setSelected(
              row.kind === 'node' || row.kind === 'item' ? row.nodeId : row.id,
            )
          }
          formatTime={formatTime}
          className="border-border h-full rounded-lg border"
        />
        <WorkflowCanvas
          graph={graph}
          aria-label="The run"
          layoutKey="story-steps"
          framed
          playback={{ timeline, t: clock.t }}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>
      <FlowPlaybackBar
        timeline={timeline}
        t={clock.t}
        onTChange={clock.setT}
        playing={clock.playing}
        onPlayingChange={clock.setPlaying}
        speed={clock.speed}
        onSpeedChange={clock.setSpeed}
        formatTime={formatTime}
      />
    </div>
  );
}

/** A failed run told in full: an item that failed, a wait, a restart. */
export const Steps: Story = {
  render: () => (
    <Synced
      graph={triageFlowGraph()}
      timeline={TRIAGE}
      startedAt={triageExplainedRun().startedAt}
    />
  ),
};

/** Conditions deciding, a skipped branch and a repeat's passes. */
export const Branches: Story = {
  render: () => (
    <Synced
      graph={branchFlowGraph()}
      timeline={BRANCH}
      startedAt={branchRun().startedAt}
    />
  ),
};

/** Below 32rem the bars step aside; the durations stay. */
export const Narrow: Story = {
  render: () => (
    <div className="p-4" style={{ width: 360, height: 560 }}>
      <FlowRunTimeline
        graph={branchFlowGraph()}
        timeline={BRANCH}
        t={BRANCH.duration}
        onSeek={() => undefined}
        formatTime={formatFlowClock}
        className="border-border h-full rounded-lg border"
      />
    </div>
  ),
};
