import { Button } from '@tale/ui/button';
import type {
  FlowEdge,
  FlowGraph,
  FlowIcon,
  FlowNode,
  FlowStepNode,
} from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { Braces, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';

const step = (
  id: string,
  label: string,
  typeLabel: string,
  icon: FlowIcon = typeLabel === 'Transform' ? Braces : Sparkles,
): FlowStepNode => ({ id, kind: 'step', label, typeLabel, icon });

const edge = (
  source: string,
  target: string,
  kind: FlowEdge['kind'] = 'data',
): FlowEdge => ({ id: `${source}>${target}`, source, target, kind });

const START: FlowNode = {
  id: '__start',
  kind: 'entry',
  triggers: [],
  inputs: [{ id: 'ticket', label: 'ticket', detail: 'an object', code: true }],
};
const END: FlowNode = {
  id: '__end',
  kind: 'exit',
  outputs: [{ id: 'reply', label: 'The output of Reply' }],
};

// Three versions of one workflow, as a coding agent might save them. The
// layoutKey stays the same, so the canvas glides from one to the next.
const VERSIONS: FlowGraph[] = [
  {
    nodes: [
      START,
      step('fetch', 'Fetch', 'HTTP · Get'),
      step('reply', 'Reply', 'Language model'),
      END,
    ],
    edges: [
      edge('__start', 'fetch', 'entry'),
      edge('fetch', 'reply'),
      edge('reply', '__end', 'exit'),
    ],
  },
  {
    nodes: [
      START,
      step('fetch', 'Fetch', 'HTTP · Get'),
      step('classify', 'Classify', 'Language model'),
      step('reply', 'Reply', 'Language model'),
      END,
    ],
    edges: [
      edge('__start', 'fetch', 'entry'),
      edge('fetch', 'classify'),
      edge('fetch', 'reply'),
      edge('classify', 'reply'),
      edge('reply', '__end', 'exit'),
    ],
  },
  {
    nodes: [
      START,
      step('fetch', 'Fetch', 'HTTP · Get'),
      step('classify', 'Classify', 'Language model'),
      step('reply', 'Reply', 'Language model'),
      step('notify', 'Notify', 'Email · Send', Mail),
      END,
    ],
    edges: [
      edge('__start', 'fetch', 'entry'),
      edge('fetch', 'classify'),
      edge('fetch', 'reply'),
      edge('classify', 'reply'),
      edge('classify', 'notify'),
      edge('reply', '__end', 'exit'),
      edge('notify', '__end', 'completion'),
    ],
  },
];

/** The nodes a version adds or rewires, ringed once when it arrives. */
const CHANGED: ReadonlySet<string>[] = [
  new Set(['reply']),
  new Set(['classify', 'reply']),
  new Set(['notify']),
];

export default function FlowLiveRelayoutDemo() {
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const graph = VERSIONS[version] ?? VERSIONS[0];
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={version === VERSIONS.length - 1}
          onClick={() => setVersion((at) => at + 1)}
        >
          Save the next version
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={version === 0}
          onClick={() => setVersion((at) => at - 1)}
        >
          Go back a version
        </Button>
      </div>
      <div className="h-[32rem]">
        <WorkflowCanvas
          graph={graph}
          aria-label="Answer a ticket"
          layoutKey="answer-a-ticket"
          framed
          selectedId={selected}
          onSelect={setSelected}
          changed={{
            ids: CHANGED[version] ?? new Set(),
            key: version,
          }}
        />
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Version {version + 1} of {VERSIONS.length}
      </p>
    </div>
  );
}
