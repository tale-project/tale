import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import type { IssueCounts } from '@tale/ui/issue-summary';
import { useState } from 'react';

const GRAPH: FlowGraph = {
  nodes: [
    { id: '__start', kind: 'entry', triggers: [], inputs: [] },
    {
      id: 'inbox',
      kind: 'step',
      label: 'Inbox',
      typeLabel: 'Conversations · List untriaged',
    },
    {
      id: '__gate:triage',
      kind: 'gate',
      label: 'Triage',
      mode: 'only-if',
      condition: 'Inbox has conversations',
    },
    {
      id: 'triage',
      kind: 'step',
      label: 'Triage',
      typeLabel: 'Language model',
      reads: [{ id: 'inbox', label: 'Inbox' }],
      conditional: true,
    },
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 's', label: 'summary', code: true }],
    },
  ],
  edges: [
    { id: 'a', source: '__start', target: 'inbox', kind: 'entry' },
    { id: 'b', source: 'inbox', target: '__gate:triage', kind: 'order' },
    { id: 'c', source: 'inbox', target: 'triage', kind: 'data' },
    { id: 'd', source: '__gate:triage', target: 'triage', kind: 'gate' },
    { id: 'e', source: 'triage', target: '__end', kind: 'exit' },
  ],
};

// Problems a check found, grouped by the node each one names — Start,
// End and a condition can carry them too.
const ISSUES: ReadonlyMap<string, IssueCounts> = new Map([
  ['__start', { errors: 0, warnings: 1 }],
  ['__gate:triage', { errors: 1, warnings: 0 }],
  ['triage', { errors: 2, warnings: 1 }],
]);

export default function FlowIssuesDemo() {
  const [selected, setSelected] = useState<string | null>('triage');
  return (
    <div className="h-[34rem] w-full">
      <WorkflowCanvas
        graph={GRAPH}
        aria-label="Triage inbox"
        layoutKey="issues"
        issues={ISSUES}
        selectedId={selected}
        onSelect={setSelected}
        framed
      />
    </div>
  );
}
