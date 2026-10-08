'use client';

import type { NodeProps } from '@xyflow/react';
import { Check, Filter, Minus, Split } from 'lucide-react';
import { memo } from 'react';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { FLOW_EDGE_COLORS } from '../edge-palette';
import { FlowNodeIssueMarker } from '../node-issue-marker';
import type { FlowGateNode } from '../types';
import { FlowNodeButton, useFlowRender } from './flow-render-context';
import type { FlowNodeData } from './step-node';

/**
 * A condition: a pill above the step it guards, the condition in words
 * (in mono when it is the expression itself), as wide as its words need
 * (160 to 288 px). `only-if` (a filter) has one plain line out; `if-else`
 * (a split) leads to Yes on the left and No on the right. A pointer gets the
 * full condition in a tooltip; a keyboard gets it in the name. In a run, a
 * chip at its end says how it decided — "Yes" with a check or "No" with a
 * dash, in the branch's colour.
 */
export const FlowGateNodeView = memo(function FlowGateNodeView({
  data,
}: NodeProps & { data: FlowNodeData<FlowGateNode> }) {
  const { t } = useT('flow');
  const { issues, looks } = useFlowRender();
  const { node, phase } = data;
  const Icon = node.mode === 'if-else' ? Split : Filter;
  const counts = issues.get(node.id);
  const decision = looks.get(node.id)?.decision;
  return (
    <FlowNodeButton
      id={node.id}
      phase={phase}
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
      {decision !== undefined && (
        <span
          aria-hidden="true"
          data-slot="flow-gate-decision"
          className="inline-flex h-5 shrink-0 items-center gap-0.5 text-xs font-medium"
          style={{
            color: decision
              ? FLOW_EDGE_COLORS.positive
              : FLOW_EDGE_COLORS.negative,
          }}
        >
          {decision ? (
            <Check className="size-3" />
          ) : (
            <Minus className="size-3" />
          )}
          {t(decision ? 'branch.yes' : 'branch.no')}
        </span>
      )}
    </FlowNodeButton>
  );
});
