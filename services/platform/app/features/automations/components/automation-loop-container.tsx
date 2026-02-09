'use client';

import { Position } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import React from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
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
    <div className="relative h-full w-full">
      {/* Top Target Handle - incoming from higher-ranked nodes */}
      <InvisibleHandle
        type="target"
        position={Position.Top}
        id="top-target"
        className="z-10! size-2! border-0! bg-transparent!"
        isConnectable={true}
        style={{ top: 2, left: topTargetLeft, opacity: 0 }}
      />

      {/* Top Source Handle - outgoing to higher-ranked nodes */}
      <InvisibleHandle
        type="source"
        position={Position.Top}
        id="top-source"
        className="z-10! size-2! border-0! bg-transparent!"
        isConnectable={true}
        style={{ top: 2, left: topSourceLeft, opacity: 0 }}
      />

      {/* Left Target Handle - for backward connections coming from the side */}
      <InvisibleHandle
        type="target"
        position={Position.Left}
        id="left-target"
        className="z-10! size-2! border-0! bg-transparent!"
        isConnectable={true}
        style={{ left: 0, top: '50%', opacity: 0 }}
      />

      {/* Right Source Handle - for backward connections going to the side */}
      <InvisibleHandle
        type="source"
        position={Position.Right}
        id="right-source"
        className="z-10! size-2! border-0! bg-transparent!"
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
        className="border-border bg-background h-full w-full cursor-pointer rounded-lg border-2 border-dashed text-left shadow-sm transition-shadow hover:shadow-md focus:outline-none"
        onClick={() => data.onNodeClick?.(data.stepSlug)}
        style={{ overflow: 'visible', position: 'relative' }}
      >
        <div className="flex h-full flex-col p-5">
          {/* Header with icon, title, and label */}
          <div className="mb-4 flex flex-shrink-0 items-start gap-3">
            {/* Icon on left */}
            <Repeat className="bg-primary/10 text-primary size-6 shrink-0 rounded-sm p-1" />

            {/* Title in center */}
            <div className="min-w-0 flex-1">
              <h3 className="text-foreground text-sm font-semibold">
                {data.label}
              </h3>
            </div>

            {/* Step type label on right */}
            <Badge variant="outline" className="text-muted-foreground text-xs">
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
        className="z-10! size-2! border-0! bg-transparent!"
        isConnectable={true}
        style={{ bottom: 0, left: bottomTargetLeft, opacity: 0 }}
      />

      {/* Bottom Source Handle - outgoing to lower-ranked nodes */}
      <InvisibleHandle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="z-10! size-2! border-0! bg-transparent!"
        isConnectable={true}
        style={{ bottom: 0, left: bottomSourceLeft, opacity: 0 }}
      />
    </div>
  );
}
