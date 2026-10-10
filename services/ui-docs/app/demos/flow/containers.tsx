import type { FlowGraph, FlowGroup } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';

const step = (id: string, label: string, typeLabel: string) => ({
  id,
  kind: 'step' as const,
  label,
  typeLabel,
});

const each = (id: string): FlowGroup => ({
  id: `each:${id}`,
  kind: 'each',
  label: 'For each item of pulls of Open pulls',
  members: [id],
});

// Three nodes each go through the same list, one after the other: one frame
// each, since each finishes every item before the next one starts. "Poll"
// repeats until it is done; its frame draws the loop.
const GRAPH: FlowGraph = {
  nodes: [
    { id: '__start', kind: 'entry', triggers: [], inputs: [] },
    step('open_pulls', 'Open pulls', 'GitHub · List pull requests'),
    step('diff', 'Diff', 'GitHub · Get pull request diff'),
    step('review', 'Review', 'Language model'),
    step('post', 'Post', 'GitHub · Create pull request review'),
    step('poll', 'Poll', 'HTTP · Get status'),
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'r', label: 'The output of Review' }],
    },
  ],
  edges: [
    { id: 'a', source: '__start', target: 'open_pulls', kind: 'entry' },
    { id: 'b', source: 'open_pulls', target: 'diff', kind: 'data' },
    { id: 'c', source: 'diff', target: 'review', kind: 'data' },
    { id: 'd', source: 'review', target: 'post', kind: 'data' },
    { id: 'e', source: 'post', target: 'poll', kind: 'data' },
    { id: 'f', source: 'review', target: '__end', kind: 'exit' },
    { id: 'g', source: 'poll', target: '__end', kind: 'completion' },
  ],
  groups: [
    each('diff'),
    each('review'),
    each('post'),
    {
      id: 'repeat:poll',
      kind: 'repeat',
      label: 'Repeats until done is true, at most 5×',
      members: ['poll'],
    },
  ],
};

export default function FlowContainersDemo() {
  return (
    <div className="h-[40rem] w-full">
      <WorkflowCanvas
        graph={GRAPH}
        aria-label="Review pull requests"
        layoutKey="containers"
        framed
      />
    </div>
  );
}
