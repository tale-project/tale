'use client';

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Bot } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ORG_NODE_WIDTH, type OrganigramFlowNode } from './organigram-layout';

/**
 * One agent on the organigram — identity only (icon, name, description), in
 * the same card idiom as the automations step node. Delegation edges are
 * edited from the side panel, never on the canvas, so the card carries no
 * controls; the handles exist purely as edge anchors.
 */
export function AgentOrgNode({
  data,
  selected,
}: NodeProps<OrganigramFlowNode>) {
  const { t } = useT('organigram');
  const node = data.chartNode;

  return (
    <div
      style={{ width: ORG_NODE_WIDTH }}
      className={cn(
        'bg-card border-border flex gap-3 rounded-lg border p-3 text-left shadow-sm transition-shadow hover:shadow-md',
        selected && 'border-primary ring-primary/30 ring-2',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="size-1.5! border-0! bg-transparent!"
      />

      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
        <Bot className="size-4.5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Heading level={3} size="sm" className="truncate">
            {node.displayName || node.slug}
          </Heading>
          {node.hasWarning && (
            <AlertTriangle
              className="size-3.5 shrink-0 text-amber-500"
              aria-label={t('node.warning')}
            />
          )}
        </div>
        {node.description ? (
          <Text variant="caption" className="mt-0.5 line-clamp-2">
            {node.description}
          </Text>
        ) : (
          <Text variant="muted" className="mt-0.5 truncate text-xs">
            {node.slug}
          </Text>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="size-1.5! border-0! bg-transparent!"
      />
    </div>
  );
}
