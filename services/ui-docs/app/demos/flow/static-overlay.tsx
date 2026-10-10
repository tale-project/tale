import type { FlowRunOverlay } from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Switch } from '@tale/ui/switch';
import { Braces, MessageSquare, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';

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

// Where each node of a finished run ended, as a host reads it from the
// run's record. Lines are left out: the canvas works out which ones the
// run took from where their two ends stand.
const LAST_RUN: FlowRunOverlay = {
  finished: true,
  nodes: {
    __start: { state: 'succeeded', detail: 'Started 07:00 by hand' },
    fetch: { state: 'succeeded', detail: '0.4 s' },
    classify: { state: 'succeeded', detail: '1.4 s' },
    '__gate:escalate': { state: 'succeeded', decision: false },
    escalate: { state: 'skipped', reason: 'Skipped: the condition is false' },
    answer: { state: 'succeeded', detail: '2.4 s' },
    log: { state: 'failed', reason: 'The log service did not answer' },
    __end: { state: 'failed', detail: 'Failed at Log' },
  },
};

export default function FlowStaticOverlayDemo() {
  const [focus, setFocus] = useState(true);
  return (
    <div className="flex w-full flex-col gap-3">
      <Switch
        label="Bring the way to the failure forward"
        checked={focus}
        onCheckedChange={setFocus}
      />
      <div className="h-[34rem]">
        <WorkflowCanvas
          graph={GRAPH}
          aria-label="Answer a ticket, last run"
          layoutKey="static-overlay"
          framed
          overlay={LAST_RUN}
          focusFailure={focus}
        />
      </div>
    </div>
  );
}
