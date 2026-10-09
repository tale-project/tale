'use client';

import type { NodeProps } from '@xyflow/react';
import { Flag } from 'lucide-react';
import { memo } from 'react';

import { useT } from '../../../i18n/client';
import { flowNodeTitle } from '../describe';
import { FLOW_SECTION_ROWS } from '../layout/sizes';
import type { FlowExitNode } from '../types';
import { FlowNodeNotice, FlowNodeSection } from './entry-node';
import { FlowNodeButton, FlowNodeStrip } from './flow-render-context';
import { FlowNodeTitleRow, type FlowNodeData } from './step-node';

/**
 * End: what a successful run returns (and its shape) and every way a run
 * can end, below everything else. Its strip names the nodes that finish
 * the run.
 */
export const FlowExitNodeView = memo(function FlowExitNodeView({
  data,
}: NodeProps & { data: FlowNodeData<FlowExitNode> }) {
  const { t } = useT('flow');
  const { node, phase } = data;
  const outcomes = node.outcomes ?? [];
  return (
    <FlowNodeButton
      id={node.id}
      phase={phase}
      className="bg-card text-card-foreground border-border flex flex-col rounded-lg border shadow-sm"
    >
      <span className="flex min-h-0 flex-1 flex-col px-3 pt-3">
        <FlowNodeTitleRow
          id={node.id}
          icon={Flag}
          title={flowNodeTitle(node, t)}
          terminal
        />
        <FlowNodeSection
          heading={t('node.outputs')}
          rows={node.outputs}
          max={FLOW_SECTION_ROWS.outputs}
          empty={node.outputsEmpty ?? t('node.noOutput')}
        />
        {node.shape && (
          <span className="text-muted-foreground mt-1 h-4 truncate font-mono text-xs leading-4">
            {node.shape}
          </span>
        )}
        {outcomes.length > 0 && (
          <FlowNodeSection
            heading={t('node.outcomes')}
            rows={outcomes}
            max={FLOW_SECTION_ROWS.outcomes}
            empty=""
          />
        )}
        {node.notice && <FlowNodeNotice notice={node.notice} />}
      </span>
      <FlowNodeStrip id={node.id} />
    </FlowNodeButton>
  );
});
