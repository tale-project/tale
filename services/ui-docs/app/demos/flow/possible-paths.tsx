import {
  FlowPathList,
  type FlowPathListSection,
} from '@tale/ui/flow/flow-path-list';
import {
  highlightForNodes,
  highlightForPaths,
  type FlowHighlight,
  type FlowPath,
} from '@tale/ui/flow/paths';
import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Braces, MessageSquare, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

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
      decisionKey: 'when:escalate',
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
      chips: [{ id: 'onError', label: 'Continues on error', tone: 'error' }],
      description: 'If it fails, the run goes on without it.',
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

// A host works these out from its own analysis of the workflow.
const PATHS: FlowPath[] = [
  {
    id: 'p1',
    label: 'Path 1',
    nodes: ['fetch', 'classify', '__gate:escalate', 'escalate', 'log'],
    decisions: { 'when:escalate': true },
  },
  {
    id: 'p2',
    label: 'Path 2',
    nodes: ['fetch', 'classify', '__gate:escalate', 'answer', 'log'],
    decisions: { 'when:escalate': false },
  },
];
// Every node whose failure ends the run; Log lets the run go on.
const HALTS = ['fetch', 'classify', 'escalate', 'answer'];

const SECTIONS: FlowPathListSection[] = [
  {
    id: 'paths',
    rows: [
      {
        id: 'p1',
        title: 'Path 1',
        meta: '4 of 5 nodes run',
        clauses: [{ id: 'escalate', label: 'Escalate: Yes', tone: 'positive' }],
      },
      {
        id: 'p2',
        title: 'Path 2',
        meta: '4 of 5 nodes run',
        clauses: [{ id: 'escalate', label: 'Escalate: No', tone: 'negative' }],
      },
    ],
  },
  {
    id: 'halts',
    title: 'Ends the run when it fails',
    rows: HALTS.map((id) => ({
      id: `halt:${id}`,
      title: GRAPH.nodes.find((node) => node.id === id)?.label ?? id,
      pinnable: false,
    })),
  },
];

/** The highlight a row shows: its path, with why the rest steps back, or
 *  every node that ends a run when it fails. */
function highlightOf(id: string | null): FlowHighlight | null {
  if (id === null) return null;
  if (id.startsWith('halt:'))
    return highlightForNodes(GRAPH, HALTS, { tone: 'error' });
  const path = PATHS.find((candidate) => candidate.id === id);
  if (path === undefined) return null;
  const highlight = highlightForPaths(GRAPH, [path]);
  const reasons: Record<string, string> = {};
  for (const node of GRAPH.nodes)
    if (!highlight.nodes.has(node.id))
      reasons[node.id] = `Not on ${path.label ?? 'this path'}`;
  return { ...highlight, reasons };
}

export default function FlowPossiblePathsDemo() {
  const [preview, setPreview] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const highlight = useMemo(
    () => highlightOf(pinned ?? preview),
    [pinned, preview],
  );
  return (
    <div className="flex w-full flex-col gap-3 md:flex-row">
      <div className="border-border w-full shrink-0 rounded-lg border py-2 md:w-64">
        <FlowPathList
          sections={SECTIONS}
          aria-label="Paths a run can take"
          previewId={preview}
          pinnedId={pinned}
          onPreview={setPreview}
          onPin={setPinned}
          onActivate={(id) => setSelected(id.replace('halt:', ''))}
          announce={(row) => `Showing ${row.title}`}
        />
      </div>
      <div className="h-[34rem] min-w-0 flex-1">
        <WorkflowCanvas
          graph={GRAPH}
          aria-label="Answer a ticket"
          layoutKey="possible-paths"
          framed
          paths={PATHS}
          highlight={highlight}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
