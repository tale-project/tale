import {
  diffHighlight,
  mergeFlowGraphs,
  type FlowNodeDiff,
} from '@tale/ui/flow/diff';
import type { FlowEdge, FlowGraph, FlowNode } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Braces, MessageSquare, Send, Siren, Sparkles } from 'lucide-react';
import { useState } from 'react';

const edge = (
  source: string,
  target: string,
  kind: FlowEdge['kind'],
): FlowEdge => ({ id: `${source}>${target}`, source, target, kind });

const start: FlowNode = {
  id: '__start',
  kind: 'entry',
  triggers: [],
  inputs: [{ id: 'ticket', label: 'ticket', detail: 'an object', code: true }],
};
const fetch: FlowNode = {
  id: 'fetch',
  kind: 'step',
  label: 'Fetch',
  icon: Send,
  typeLabel: 'HTTP · Get',
};
const classify: FlowNode = {
  id: 'classify',
  kind: 'step',
  label: 'Classify',
  icon: Sparkles,
  typeLabel: 'Language model',
  reads: [{ id: 'fetch', label: 'Fetch' }],
};
const gate: FlowNode = {
  id: '__gate:urgent',
  kind: 'gate',
  label: 'Urgent',
  mode: 'if-else',
  condition: 'the priority of Classify is "urgent"',
};
const log: FlowNode = {
  id: 'log',
  kind: 'step',
  label: 'Log',
  icon: Braces,
  typeLabel: 'Transform',
};
const end: FlowNode = {
  id: '__end',
  kind: 'exit',
  outputs: [{ id: 'log', label: 'The output of Log' }],
};

/** v4: an urgent ticket goes to Slack, the rest get an answer. */
const V4: FlowGraph = {
  nodes: [
    start,
    fetch,
    classify,
    gate,
    {
      id: 'escalate',
      kind: 'step',
      label: 'Escalate',
      icon: MessageSquare,
      typeLabel: 'Slack · Send message',
      conditional: true,
    },
    {
      id: 'answer',
      kind: 'step',
      label: 'Answer',
      icon: Sparkles,
      typeLabel: 'Language model',
      conditional: true,
    },
    log,
    end,
  ],
  edges: [
    edge('__start', 'fetch', 'entry'),
    edge('fetch', 'classify', 'data'),
    edge('classify', '__gate:urgent', 'order'),
    edge('__gate:urgent', 'escalate', 'branch-yes'),
    edge('__gate:urgent', 'answer', 'branch-no'),
    edge('escalate', 'log', 'data'),
    edge('answer', 'log', 'data'),
    edge('log', '__end', 'exit'),
  ],
};

/** v5: an urgent ticket opens an incident, Answer is now Reply, and
 *  Classify runs on another model. */
const V5: FlowGraph = {
  nodes: [
    start,
    fetch,
    classify,
    gate,
    {
      id: 'page',
      kind: 'step',
      label: 'Page',
      icon: Siren,
      typeLabel: 'PagerDuty · Create incident',
      conditional: true,
    },
    {
      id: 'reply',
      kind: 'step',
      label: 'Reply',
      icon: Sparkles,
      typeLabel: 'Language model',
      conditional: true,
    },
    log,
    end,
  ],
  edges: [
    edge('__start', 'fetch', 'entry'),
    edge('fetch', 'classify', 'data'),
    edge('classify', '__gate:urgent', 'order'),
    edge('__gate:urgent', 'page', 'branch-yes'),
    edge('__gate:urgent', 'reply', 'branch-no'),
    edge('page', 'log', 'data'),
    edge('reply', 'log', 'data'),
    edge('log', '__end', 'exit'),
  ],
};

/** Your words for what changed in the nodes both versions have. */
const CHANGED: Readonly<Record<string, FlowNodeDiff>> = {
  classify: { kind: 'changed', summary: 'Model changed' },
  reply: { kind: 'renamed', renamedFrom: 'Answer', beforeId: 'answer' },
};

const { graph: UNION, diff: DIFF } = mergeFlowGraphs(
  V4,
  V5,
  (id) => CHANGED[id],
);

type Side = 'changes' | 'v4' | 'v5';

export default function FlowDiffDemo() {
  const [side, setSide] = useState<Side>('changes');
  const own = side === 'v4' ? V4 : V5;
  return (
    <div className="flex h-[40rem] w-full flex-col">
      <WorkflowCanvas
        graph={side === 'changes' ? UNION : own}
        {...(side === 'changes'
          ? { diff: DIFF }
          : { highlight: diffHighlight(own, DIFF) })}
        aria-label={
          side === 'changes' ? 'Changes from v4 to v5' : `Tickets, ${side}`
        }
        layoutKey={`tickets:${side}`}
        framed
        topStart={
          <SegmentedControl
            aria-label="Show"
            value={side}
            onValueChange={(next) =>
              setSide(next === 'v4' || next === 'v5' ? next : 'changes')
            }
            options={[
              { value: 'changes', label: 'Changes' },
              { value: 'v4', label: 'v4' },
              { value: 'v5', label: 'v5' },
            ]}
          />
        }
      />
    </div>
  );
}
