import type { FlowLayout } from '@tale/ui/flow/layout';
import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Switch } from '@tale/ui/switch';
import { Braces, Sparkles } from 'lucide-react';
import { useState } from 'react';

const step = (id: string, label: string, typeLabel: string) => ({
  id,
  kind: 'step' as const,
  label,
  typeLabel,
  icon: typeLabel === 'Transform' ? Braces : Sparkles,
});

// "Split" leads to "Report" directly and through "Score". A straight line
// from Split to Report would cross Score's frame; the route goes round it.
const GRAPH: FlowGraph = {
  nodes: [
    { id: '__start', kind: 'entry', triggers: [], inputs: [] },
    step('split', 'Split', 'Transform'),
    step('score', 'Score', 'Language model'),
    step('report', 'Report', 'Transform'),
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'r', label: 'The output of Report' }],
    },
  ],
  edges: [
    { id: 'start>split', source: '__start', target: 'split', kind: 'entry' },
    { id: 'split>score', source: 'split', target: 'score', kind: 'data' },
    {
      id: 'split>report',
      source: 'split',
      target: 'report',
      kind: 'data',
      detail: 'Carries .items',
    },
    { id: 'score>report', source: 'score', target: 'report', kind: 'data' },
    { id: 'report>end', source: 'report', target: '__end', kind: 'exit' },
  ],
  groups: [
    {
      id: 'each:score',
      kind: 'each',
      label: 'For each item of Split',
      members: ['score'],
    },
  ],
};

export default function FlowRoutedEdgesDemo() {
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const route = layout?.edges['split>report']?.points ?? [];
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="h-[30rem]">
        <WorkflowCanvas
          graph={GRAPH}
          aria-label="Split, score and report"
          layoutKey="routed-edges"
          framed
          onLayout={setLayout}
        />
      </div>
      <Switch
        label="Show the route of Split → Report"
        checked={showRoute}
        onCheckedChange={setShowRoute}
      />
      {showRoute && (
        <ol className="text-muted-foreground flex flex-wrap gap-x-3 font-mono text-xs">
          {route.map((point, index) => (
            <li key={index}>
              ({point.x}, {point.y})
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
