import {
  buildPlaybackTimeline,
  flowStateAt,
  usePlaybackClock,
  type FlowRealRun,
} from '@tale/ui/flow/playback';
import { FlowPlaybackBar, formatFlowClock } from '@tale/ui/flow/playback-bar';
import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Braces, MessageSquare, Send, Sparkles } from 'lucide-react';

const GRAPH: FlowGraph = {
  nodes: [
    {
      id: '__start',
      kind: 'entry',
      triggers: [],
      inputs: [
        { id: 'ticket', label: 'ticket', detail: 'an object', code: true },
      ],
    },
    {
      id: 'fetch',
      kind: 'step',
      label: 'Fetch',
      icon: Send,
      typeLabel: 'HTTP · Get',
    },
    {
      id: 'classify',
      kind: 'step',
      label: 'Classify',
      icon: Sparkles,
      typeLabel: 'Language model',
      reads: [{ id: 'fetch', label: 'Fetch' }],
    },
    {
      id: '__gate:escalate',
      kind: 'gate',
      label: 'Escalate',
      mode: 'if-else',
      condition: 'the priority of Classify is "urgent"',
    },
    {
      id: 'escalate',
      kind: 'step',
      label: 'Escalate',
      icon: MessageSquare,
      typeLabel: 'Slack · Send message',
      reads: [{ id: 'classify', label: 'Classify' }],
      conditional: true,
    },
    {
      id: 'answer',
      kind: 'step',
      label: 'Answer',
      icon: Sparkles,
      typeLabel: 'Language model',
      reads: [{ id: 'classify', label: 'Classify' }],
      conditional: true,
    },
    {
      id: 'log',
      kind: 'step',
      label: 'Log',
      icon: Braces,
      typeLabel: 'Transform',
      reads: [
        { id: 'escalate', label: 'Escalate' },
        { id: 'answer', label: 'Answer' },
      ],
    },
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'log', label: 'The output of Log' }],
    },
  ],
  edges: [
    { id: 's>fetch', source: '__start', target: 'fetch', kind: 'entry' },
    { id: 'fetch>classify', source: 'fetch', target: 'classify', kind: 'data' },
    {
      id: 'classify>gate',
      source: 'classify',
      target: '__gate:escalate',
      kind: 'order',
    },
    {
      id: 'gate>escalate',
      source: '__gate:escalate',
      target: 'escalate',
      kind: 'branch-yes',
    },
    {
      id: 'classify>escalate',
      source: 'classify',
      target: 'escalate',
      kind: 'data',
    },
    {
      id: 'gate>answer',
      source: '__gate:escalate',
      target: 'answer',
      kind: 'branch-no',
    },
    {
      id: 'classify>answer',
      source: 'classify',
      target: 'answer',
      kind: 'data',
    },
    { id: 'escalate>log', source: 'escalate', target: 'log', kind: 'data' },
    { id: 'answer>log', source: 'answer', target: 'log', kind: 'data' },
    { id: 'log>end', source: 'log', target: '__end', kind: 'exit' },
  ],
};

const START = Date.UTC(2025, 9, 9, 7, 0, 0);
const at = (ms: number) => START + ms;
const APPROVED = 3 * 60 * 60 * 1000;
const skipped = 'Skipped: the condition is false';

// A run as a host records it, in real time: Answer waits three hours for
// an approval, then Log fails.
const RUN: FlowRealRun = {
  startedAt: at(0),
  endedAt: at(APPROVED + 3_300),
  spans: [
    {
      nodeId: 'fetch',
      startedAt: at(20),
      endedAt: at(420),
      outcome: 'succeeded',
      detail: '0.4 s',
    },
    {
      nodeId: 'classify',
      startedAt: at(430),
      endedAt: at(1_830),
      outcome: 'succeeded',
      detail: '1.4 s',
    },
    {
      nodeId: '__gate:escalate',
      startedAt: at(1_840),
      endedAt: at(1_840),
      outcome: 'succeeded',
      decision: false,
    },
    {
      nodeId: 'escalate',
      startedAt: at(1_840),
      endedAt: at(1_840),
      outcome: 'skipped',
      reason: skipped,
    },
    {
      nodeId: 'answer',
      startedAt: at(1_850),
      endedAt: at(APPROVED),
      outcome: 'waiting',
      reason: 'Waiting for approval',
    },
    {
      nodeId: 'answer',
      startedAt: at(APPROVED),
      endedAt: at(APPROVED + 2_400),
      outcome: 'succeeded',
      detail: '2.4 s',
    },
    {
      nodeId: 'log',
      startedAt: at(APPROVED + 2_410),
      endedAt: at(APPROVED + 3_300),
      outcome: 'failed',
      reason: 'The log service did not answer',
    },
  ],
  travels: [
    { edgeId: 's>fetch', at: at(0), target: 'fetch' },
    {
      edgeId: 'fetch>classify',
      at: at(420),
      target: 'classify',
      summary: 'the ticket',
    },
    { edgeId: 'classify>gate', at: at(1_830), target: '__gate:escalate' },
    { edgeId: 'gate>answer', at: at(1_840), target: 'answer' },
    { edgeId: 'classify>answer', at: at(1_840), target: 'answer' },
    { edgeId: 'answer>log', at: at(APPROVED + 2_400), target: 'log' },
  ],
  waits: [
    {
      startedAt: at(1_850),
      endedAt: at(APPROVED),
      label: 'Waited 3 h for approval',
    },
  ],
};

const TIMELINE = buildPlaybackTimeline(RUN);

export default function FlowPlaybackDemo() {
  const clock = usePlaybackClock({ timeline: TIMELINE });
  // What is happening at the moment shown, for the scrubber's spoken value.
  const frame = flowStateAt(GRAPH, TIMELINE, clock.t);
  const activity = GRAPH.nodes
    .flatMap((node) => {
      const state = frame.nodes[node.id]?.state;
      return node.kind === 'step' &&
        (state === 'running' || state === 'waiting')
        ? [`${node.label} ${state}`]
        : [];
    })
    .join(', ');
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="h-[32rem]">
        <WorkflowCanvas
          graph={GRAPH}
          aria-label="Answer a ticket, a run"
          layoutKey="playback"
          framed
          playback={{ timeline: TIMELINE, t: clock.t }}
        />
      </div>
      <FlowPlaybackBar
        timeline={TIMELINE}
        t={clock.t}
        onTChange={clock.setT}
        playing={clock.playing}
        onPlayingChange={clock.setPlaying}
        speed={clock.speed}
        onSpeedChange={clock.setSpeed}
        activity={activity}
        // The clock shows how long the run really took, waits included.
        formatTime={(t) => formatFlowClock(TIMELINE.toReal(t) - RUN.startedAt)}
      />
    </div>
  );
}
