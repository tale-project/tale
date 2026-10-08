import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import {
  Braces,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Hand,
  Sparkles,
  Square,
} from 'lucide-react';
import { useState } from 'react';

// A host builds this from its own document: Start, then each node in the
// order it runs, then End; edges from what each node reads.
const GRAPH: FlowGraph = {
  nodes: [
    {
      id: '__start',
      kind: 'entry',
      triggers: [
        {
          id: 'schedule',
          icon: Clock,
          label: 'Every day at 07:00 · UTC',
          note: 'Next Thu 9 Oct, 07:00',
        },
        { id: 'manual', icon: Hand, label: 'By hand, the API or MCP' },
      ],
      inputs: [
        { id: 'owner', label: 'owner', detail: 'text · required', code: true },
        { id: 'repo', label: 'repo', detail: 'text · required', code: true },
      ],
    },
    {
      id: 'issues',
      kind: 'step',
      label: 'Issues',
      icon: CircleDot,
      typeLabel: 'GitHub · List issues',
      reads: [{ id: 'input', label: 'run input (owner, repo)' }],
      returns: { text: '{ issues: object[] }', code: true },
    },
    {
      id: 'open_issues',
      kind: 'step',
      label: 'Open issues',
      icon: Braces,
      typeLabel: 'Transform',
      reads: [{ id: 'issues', label: 'Issues' }],
    },
    {
      id: 'score',
      kind: 'step',
      label: 'Score',
      icon: Sparkles,
      typeLabel: 'Language model · claude-haiku-4-5',
      reads: [
        { id: 'open_issues', label: 'Open issues' },
        { id: 'item', label: 'each item' },
      ],
      description: 'Runs once for each item of issues of Open issues.',
    },
    {
      id: 'report',
      kind: 'step',
      label: 'Report',
      icon: Braces,
      typeLabel: 'Transform',
      reads: [
        { id: 'open_issues', label: 'Open issues' },
        { id: 'score', label: 'Score' },
      ],
    },
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'report', label: 'The output of Report' }],
      outcomes: [
        {
          id: 'ok',
          icon: CircleCheck,
          label: 'Succeeded',
          detail: 'returns the output',
        },
        {
          id: 'failed',
          icon: CircleX,
          label: 'Failed',
          detail: 'when one of 4 nodes fails',
        },
        {
          id: 'stopped',
          icon: Square,
          label: 'Stopped',
          detail: 'when someone stops it',
        },
      ],
    },
  ],
  edges: [
    { id: 'start>issues', source: '__start', target: 'issues', kind: 'entry' },
    {
      id: 'issues>open',
      source: 'issues',
      target: 'open_issues',
      kind: 'data',
    },
    { id: 'open>score', source: 'open_issues', target: 'score', kind: 'data' },
    {
      id: 'open>report',
      source: 'open_issues',
      target: 'report',
      kind: 'data',
    },
    { id: 'score>report', source: 'score', target: 'report', kind: 'data' },
    { id: 'report>end', source: 'report', target: '__end', kind: 'exit' },
  ],
  groups: [
    {
      id: 'each:score',
      kind: 'each',
      label: 'For each item of issues of Open issues',
      members: ['score'],
    },
  ],
};

export default function FlowLayoutDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="flex h-[36rem] w-full flex-col gap-2">
      <WorkflowCanvas
        graph={GRAPH}
        aria-label="Triage GitHub issues"
        layoutKey="triage"
        selectedId={selected}
        onSelect={setSelected}
        framed
        legend={[
          {
            id: 'data',
            swatch: { edge: 'data' },
            label: 'Reads the output of the node above',
          },
          {
            id: 'exit',
            swatch: { edge: 'exit' },
            label: 'The run returns this node’s output',
          },
          {
            id: 'frame',
            swatch: { node: 'frame' },
            label: 'Runs once for each item',
          },
        ]}
      />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {selected === null ? 'Nothing selected' : `Selected: ${selected}`}
      </p>
    </div>
  );
}
