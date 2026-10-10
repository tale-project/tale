import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import {
  FlowNodeIssueMarker,
  flowNodeIssueFrameClass,
  flowNodeIssueText,
} from '@tale/ui/flow/node-issue-marker';
import { useT } from '@tale/ui/i18n/client';
import { useState } from 'react';

const NODES = [
  { id: 'triage', name: 'Triage', type: 'agent', errors: 0, warnings: 1 },
  { id: 'draft', name: 'Draft reply', type: 'agent', errors: 2, warnings: 1 },
  { id: 'send', name: 'Send reply', type: 'connector', errors: 0, warnings: 0 },
];

export default function FlowNodeIssues() {
  const { t } = useT('issues');
  const [selected, setSelected] = useState('draft');
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {NODES.map((node) => {
        const counts = { errors: node.errors, warnings: node.warnings };
        const issueText = flowNodeIssueText(t, counts);
        return (
          <button
            key={node.id}
            type="button"
            aria-pressed={selected === node.id}
            onClick={() => setSelected(node.id)}
            className={cn(
              'bg-card text-card-foreground border-border w-72 rounded-lg border p-3 text-left shadow-sm',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              flowNodeIssueFrameClass(counts),
              selected === node.id && 'ring-ring ring-2',
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {node.name}
                {issueText !== '' && (
                  <span className="sr-only"> {issueText}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <FlowNodeIssueMarker
                  errors={node.errors}
                  warnings={node.warnings}
                />
                <Badge variant="slate">{node.type}</Badge>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
