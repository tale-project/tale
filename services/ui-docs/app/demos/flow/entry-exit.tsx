import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Ban, CircleCheck, CircleX, Clock, Hand, Webhook } from 'lucide-react';

const GRAPH: FlowGraph = {
  nodes: [
    {
      id: '__start',
      kind: 'entry',
      triggers: [
        {
          id: 'schedule',
          icon: Clock,
          label: 'Every Monday at 08:00 · Europe/Zurich',
          note: 'Next Mon 12 Oct, 08:00',
        },
        {
          id: 'webhook',
          icon: Webhook,
          label: 'A request to its webhook URL',
          badge: { label: 'Off', tone: 'neutral' },
        },
        { id: 'manual', icon: Hand, label: 'By hand, the API or MCP' },
      ],
      inputs: [
        { id: 'owner', label: 'owner', detail: 'text · required', code: true },
        { id: 'repo', label: 'repo', detail: 'text · required', code: true },
        { id: 'limit', label: 'limit', detail: 'a whole number', code: true },
        { id: 'label', label: 'label', detail: 'text', code: true },
        { id: 'since', label: 'since', detail: 'text', code: true },
      ],
      notice: {
        tone: 'warning',
        text: 'The schedule starts runs without owner and repo.',
      },
    },
    {
      id: 'fetch',
      kind: 'step',
      label: 'Fetch',
      typeLabel: 'GitHub · List issues',
    },
    {
      id: '__end',
      kind: 'exit',
      outputs: [
        {
          id: 'count',
          label: 'count',
          detail: 'a number · from Fetch',
          code: true,
        },
        {
          id: 'issues',
          label: 'issues',
          detail: 'list of objects · from Fetch',
          code: true,
        },
      ],
      shape: '{ count: number; issues: object[] }',
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
          detail: 'when Fetch fails',
        },
        {
          id: 'stopped',
          icon: Ban,
          label: 'Stopped',
          detail: 'when someone stops it',
        },
      ],
    },
  ],
  edges: [
    { id: 'a', source: '__start', target: 'fetch', kind: 'entry' },
    { id: 'b', source: 'fetch', target: '__end', kind: 'exit' },
  ],
};

export default function FlowEntryExitDemo() {
  return (
    <div className="h-[44rem] w-full">
      <WorkflowCanvas
        graph={GRAPH}
        aria-label="Import issues"
        layoutKey="entry-exit"
        framed
      />
    </div>
  );
}
