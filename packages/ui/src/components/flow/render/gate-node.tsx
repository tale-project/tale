'use client';

import type { NodeProps } from '@xyflow/react';
import { Filter, Split } from 'lucide-react';
import { memo } from 'react';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { FlowNodeIssueMarker } from '../node-issue-marker';
import type { FlowGateNode } from '../types';
import { FlowNodeButton, useFlowRender } from './flow-render-context';
import type { FlowNodeData } from './step-node';

/**
 * A condition: a pill above the step it guards, the condition in words
 * (in mono when it is the expression itself), as wide as its words need
 * (160 to 288 px). `only-if` (a filter) has one plain line out; `if-else`
 * (a split) leads to Yes on the left and No on the right. A pointer gets the
 * full condition in a tooltip; a keyboard gets it in the name.
 */
export const FlowGateNodeView = memo(function FlowGateNodeView({
  data,
}: NodeProps & { data: FlowNodeData<FlowGateNode> }) {
  const { t } = useT('flow');
  const { issues } = useFlowRender();
  const { node } = data;
  const Icon = node.mode === 'if-else' ? Split : Filter;
  const counts = issues.get(node.id);
  return (
    <FlowNodeButton
      id={node.id}
      tooltip={
        <span className="flex max-w-xs flex-col gap-0.5">
          <span className="font-medium">
            {t(node.mode === 'if-else' ? 'gate.ifElse' : 'gate.onlyIf')}
          </span>
          <span className={cn(node.conditionIsCode && 'font-mono')}>
            {node.condition}
          </span>
        </span>
      }
      className="bg-card text-card-foreground border-border flex items-center gap-2 rounded-full border px-3 shadow-sm"
    >
      <Icon
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs leading-4',
          node.conditionIsCode && 'font-mono',
        )}
      >
        {node.condition}
      </span>
      {counts && (
        <FlowNodeIssueMarker
          errors={counts.errors}
          warnings={counts.warnings}
        />
      )}
    </FlowNodeButton>
  );
});
