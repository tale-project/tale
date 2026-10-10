import { FlowStepList } from '@tale/ui/flow/flow-step-list';
import type { FlowGraph } from '@tale/ui/flow/types';
import { useState } from 'react';

const GRAPH: FlowGraph = {
  nodes: [
    { id: '__start', kind: 'entry', triggers: [], inputs: [] },
    {
      id: 'classify',
      kind: 'step',
      label: 'Classify',
      typeLabel: 'Language model',
    },
    {
      id: '__gate:urgent',
      kind: 'gate',
      label: 'Urgent',
      mode: 'if-else',
      condition: 'urgent of Classify is true',
    },
    {
      id: 'urgent',
      kind: 'step',
      label: 'Urgent',
      typeLabel: 'Agent',
      reads: [{ id: 'classify', label: 'Classify' }],
    },
    {
      id: 'normal',
      kind: 'step',
      label: 'Normal',
      typeLabel: 'Language model',
      reads: [{ id: 'classify', label: 'Classify' }],
    },
    { id: '__end', kind: 'exit', outputs: [] },
  ],
  edges: [
    { id: 'a', source: '__start', target: 'classify', kind: 'entry' },
    { id: 'b', source: 'classify', target: '__gate:urgent', kind: 'order' },
    { id: 'c', source: 'classify', target: 'urgent', kind: 'data' },
    { id: 'd', source: '__gate:urgent', target: 'urgent', kind: 'branch-yes' },
    { id: 'e', source: 'classify', target: 'normal', kind: 'data' },
    { id: 'f', source: '__gate:urgent', target: 'normal', kind: 'branch-no' },
    { id: 'g', source: 'urgent', target: '__end', kind: 'completion' },
    { id: 'h', source: 'normal', target: '__end', kind: 'completion' },
  ],
};

export default function FlowListViewDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="w-full max-w-md">
      <FlowStepList
        graph={GRAPH}
        aria-label="Route a ticket"
        selectedId={selected}
        onSelect={setSelected}
      />
    </div>
  );
}
