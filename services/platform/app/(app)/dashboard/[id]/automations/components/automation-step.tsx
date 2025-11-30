'use client';

import { Handle, Position } from '@xyflow/react';
import { Cpu, HelpCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Doc } from '@/convex/_generated/dataModel';
import { PickaxeIcon, Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface AutomationStepProps {
  data: {
    label: string;
    description?: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    stepSlug: string;
    onNodeClick?: (stepSlug: string) => void;
    isLeafNode?: boolean;
    isTerminalNode?: boolean;
    onAddStep?: () => void;
    hasNextSteps?: boolean;
    target?: string;
    incomingCount?: number;
    outgoingCount?: number;
    hasBidirectionalTop?: boolean;
    hasBidirectionalBottom?: boolean;
  };
}

export default function AutomationStep({ data }: AutomationStepProps) {
  // Determine handle positions based on whether each edge (top/bottom) has bidirectional connections
  // Only offset if there are connections in both directions at that specific edge
  const topTargetLeft = data.hasBidirectionalTop ? '45%' : '50%';
  const topSourceLeft = data.hasBidirectionalTop ? '55%' : '50%';
  const bottomTargetLeft = data.hasBidirectionalBottom ? '45%' : '50%';
  const bottomSourceLeft = data.hasBidirectionalBottom ? '55%' : '50%';

  const getIcon = (stepType: string) => {
    switch (stepType) {
      case 'trigger':
        return (
          <Zap className="size-5 p-1 bg-blue-100 rounded-sm shrink-0 text-blue-600" />
        );
      case 'llm':
        return (
          <Cpu className="size-5 p-1 bg-purple-100 rounded-sm shrink-0 text-purple-600" />
        );
      case 'condition':
        return (
          <HelpCircle className="size-5 p-1 bg-amber-100 rounded-sm shrink-0 text-amber-600" />
        );

      case 'loop':
        return (
          <Repeat className="size-5 p-1 bg-cyan-100 rounded-sm shrink-0 text-cyan-600" />
        );
      case 'action':
        return (
          <PickaxeIcon className="size-5 p-1 bg-orange-100 rounded-sm shrink-0 text-orange-600" />
        );
      default:
        return <div className="size-5 rounded-full bg-muted" />;
    }
  };

  const getStepTypeLabel = (stepType: string) => {
    switch (stepType) {
      case 'trigger':
        return 'Trigger';
      case 'llm':
        return 'LLM';
      case 'condition':
        return 'Condition';

      case 'loop':
        return 'Loop';
      case 'action':
        return 'Action';
      default:
        return stepType;
    }
  };

  const cardContent = (
    <button
      type="button"
      aria-label={data.label ? `Open ${data.label}` : 'Open step'}
      className={cn(
        'w-[18.75rem] rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer text-left focus:outline-none',
        data.isTerminalNode
          ? 'border-dashed border-2 border-muted-foreground/50'
          : 'border-border',
      )}
      onClick={() => data.onNodeClick?.(data.stepSlug)}
    >
      <div className="py-2 px-2.5 flex gap-3">
        {/* Icon on left */}
        {getIcon(data.stepType)}

        {/* Content in center */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground">
              {data.label}
            </h3>
            {/* Terminal Node Indicator */}
            {data.isTerminalNode && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground border border-muted-foreground/30">
                End
              </span>
            )}
          </div>
          {data.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {data.description}
            </p>
          )}
        </div>

        {/* Step type label on right */}
        <Badge
          variant="outline"
          className="text-xs text-muted-foreground px-1 py-0.5 h-fit"
        >
          {getStepTypeLabel(data.stepType)}
        </Badge>
      </div>
    </button>
  );

  return (
    <div className="relative">
      {/* Top Target Handle - incoming from higher-ranked nodes */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ top: 2, left: topTargetLeft, opacity: 0 }}
      />

      {/* Top Source Handle - outgoing to higher-ranked nodes */}
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ top: 2, left: topSourceLeft, opacity: 0 }}
      />

      {/* Left Target Handle - for backward connections coming from the side */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ left: 0, top: '50%', opacity: 0 }}
      />

      {/* Right Source Handle - for backward connections going to the side */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ right: 0, top: '50%', opacity: 0 }}
      />

      {cardContent}

      {/* Bottom Target Handle - incoming from lower-ranked nodes */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ bottom: 0, left: bottomTargetLeft, opacity: 0 }}
      />

      {/* Bottom Source Handle - outgoing to lower-ranked nodes */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!w-2 !h-2 !border-0 !bg-transparent !z-10"
        isConnectable={true}
        style={{ bottom: 0, left: bottomSourceLeft, opacity: 0 }}
      />
    </div>
  );
}
