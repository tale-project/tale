'use client';

import { Text } from '@tale/ui/text';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Users } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { HUMANS_NODE_WIDTH, type HumansFlowNode } from './organigram-layout';

/**
 * The single "Humans" node at the top of the chart: the escalation target for
 * every root agent (one nobody delegates to). Not selectable — it is a fixed
 * anchor, not an editable agent.
 */
export function HumansNode({ data }: NodeProps<HumansFlowNode>) {
  const { t } = useT('organigram');

  return (
    <div
      style={{ width: HUMANS_NODE_WIDTH }}
      className="bg-muted/60 border-border flex items-center gap-3 rounded-lg border border-dashed p-3 text-left"
    >
      <span className="bg-foreground/10 text-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
        <Users className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <Text as="p" variant="label" className="truncate">
          {t('humans.title')}
        </Text>
        <Text as="p" variant="muted" className="truncate text-xs">
          {t('humans.subtitle', { count: data.rootCount })}
        </Text>
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
