'use client';

import React from 'react';
import { Position } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/feedback/badge';
import { useT } from '@/lib/i18n/client';
import { InvisibleHandle } from './invisible-handle';

interface AutomationLoopContainerProps {
  data: {
    label: string;
    stepSlug: string;
    onNodeClick?: (stepSlug: string) => void;
    incomingCount?: number;
    outgoingCount?: number;
    hasBidirectionalTop?: boolean;
    hasBidirectionalBottom?: boolean;
  };
}

export function AutomationLoopContainer({
  data,
}: AutomationLoopContainerProps) {
  const { t } = useT('automations');
  // Determine handle positions based on whether each edge (top/bottom) has bidirectional connections
  // Only offset if there are connections in both directions at that specific edge
  const topTargetLeft = data.hasBidirectionalTop ? '45%' : '50%';
  const topSourceLeft = data.hasBidirectionalTop ? '55%' : '50%';
  const bottomTargetLeft = data.hasBidirectionalBottom ? '45%' : '50%';
  const bottomSourceLeft = data.hasBidirectionalBottom ? '55%' : '50%';

  return (
    <div className="relative w-full h-full">
      {/* Top Target Handle - incoming from higher-ranked nodes */}
      <InvisibleHandle
        type="target"
        position={Position.Top}
        id="top-target"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ top: 2, left: topTargetLeft, opacity: 0 }}
      />

      {/* Top Source Handle - outgoing to higher-ranked nodes */}
      <InvisibleHandle
        type="source"
        position={Position.Top}
        id="top-source"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ top: 2, left: topSourceLeft, opacity: 0 }}
      />

      {/* Left Target Handle - for backward connections coming from the side */}
      <InvisibleHandle
        type="target"
        position={Position.Left}
        id="left-target"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ left: 0, top: '50%', opacity: 0 }}
      />

      {/* Right Source Handle - for backward connections going to the side */}
      <InvisibleHandle
        type="source"
        position={Position.Right}
        id="right-source"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ right: 0, top: '50%', opacity: 0 }}
      />

      {/* Main Card - matches regular automation step styling */}
      <button
        type="button"
        aria-label={
          data.label
            ? t('aria.openNamed', { name: data.label })
            : t('aria.openLoop')
        }
        className="w-full h-full rounded-lg border-2 border-border border-dashed bg-background shadow-sm hover:shadow-md transition-shadow cursor-pointer text-left focus:outline-none"
        onClick={() => data.onNodeClick?.(data.stepSlug)}
        style={{ overflow: 'visible', position: 'relative' }}
      >
        <div className="p-5 h-full flex flex-col">
          {/* Header with icon, title, and label */}
          <div className="flex items-start gap-3 flex-shrink-0 mb-4">
            {/* Icon on left */}
            <Repeat className="size-6 p-1 bg-primary/10 rounded-sm shrink-0 text-primary" />

            {/* Title in center */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-foreground">
                {data.label}
              </h3>
            </div>

            {/* Step type label on right */}
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {t('stepTypes.loop')}
            </Badge>
          </div>

          {/* Loop Body Container - Children nodes will be rendered here */}
          <div
            className="relative flex-1"
            style={{ overflow: 'visible', position: 'relative' }}
          >
            {/* Children nodes are rendered by ReactFlow's parent-child system */}
          </div>
        </div>
      </button>

      {/* Bottom Target Handle - incoming from lower-ranked nodes */}
      <InvisibleHandle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ bottom: 0, left: bottomTargetLeft, opacity: 0 }}
      />

      {/* Bottom Source Handle - outgoing to lower-ranked nodes */}
      <InvisibleHandle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="size-2! border-0! bg-transparent! z-10!"
        isConnectable={true}
        style={{ bottom: 0, left: bottomSourceLeft, opacity: 0 }}
      />
    </div>
  );
}
