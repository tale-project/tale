'use client';

import { Position } from '@xyflow/react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  getStepIconComponent,
  getActionIconComponent,
} from '../utils/step-icons';
import { useAutomationCallbacks } from './automation-callbacks-context';
import { InvisibleHandle } from './invisible-handle';

interface AutomationStepProps {
  data: {
    label: string;
    description?: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    stepSlug: string;
    actionType?: string;
    isLeafNode?: boolean;
    isTerminalNode?: boolean;
    hasNextSteps?: boolean;
    target?: string;
    incomingCount?: number;
    outgoingCount?: number;
    hasBidirectionalTop?: boolean;
    hasBidirectionalBottom?: boolean;
  };
}

export function AutomationStep({ data }: AutomationStepProps) {
  const { t } = useT('automations');
  const { onNodeClick } = useAutomationCallbacks();

  // Determine handle positions based on whether each edge (top/bottom) has bidirectional connections
  // Only offset if there are connections in both directions at that specific edge
  const topTargetLeft = data.hasBidirectionalTop ? '45%' : '50%';
  const topSourceLeft = data.hasBidirectionalTop ? '55%' : '50%';
  const bottomTargetLeft = data.hasBidirectionalBottom ? '45%' : '50%';
  const bottomSourceLeft = data.hasBidirectionalBottom ? '55%' : '50%';

  const STEP_TYPE_STYLES: Record<string, string> = {
    start: 'bg-blue-100 text-blue-600',
    trigger: 'bg-blue-100 text-blue-600',
    llm: 'bg-purple-100 text-purple-600',
    condition: 'bg-amber-100 text-amber-600',
    loop: 'bg-cyan-100 text-cyan-600',
    action: 'bg-orange-100 text-orange-600',
  };

  const getIcon = (
    stepType: Doc<'wfStepDefs'>['stepType'],
    actionType?: string,
  ) => {
    const baseClass = 'size-5 p-1 rounded-sm shrink-0';
    const styleClass = STEP_TYPE_STYLES[stepType] || 'bg-muted';

    if (stepType === 'action') {
      const IconComponent = getActionIconComponent(actionType);
      return <IconComponent className={cn(baseClass, styleClass)} />;
    }

    const IconComponent = getStepIconComponent(stepType, actionType);
    if (!IconComponent) {
      return <div className="bg-muted size-5 rounded-full" />;
    }
    return <IconComponent className={cn(baseClass, styleClass)} />;
  };

  const getStepTypeLabel = (stepType: Doc<'wfStepDefs'>['stepType']) => {
    const labels: Record<string, string> = {
      start: t('stepTypes.start'),
      llm: t('stepTypes.llm'),
      condition: t('stepTypes.condition'),
      loop: t('stepTypes.loop'),
      action: t('stepTypes.action'),
    };
    return labels[stepType] || stepType;
  };

  const cardContent = (
    <button
      type="button"
      aria-label={
        data.label
          ? t('step.openStep', { name: data.label })
          : t('step.openStepDefault')
      }
      className={cn(
        'w-[18.75rem] rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer text-left focus:outline-none',
        data.isTerminalNode
          ? 'border-dashed border-2 border-muted-foreground/50'
          : 'border-border',
      )}
      onClick={() => onNodeClick(data.stepSlug)}
    >
      <div className="flex gap-3 px-2.5 py-2">
        {/* Icon on left */}
        {getIcon(data.stepType, data.actionType)}

        {/* Content in center */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold">
              {data.label}
            </h3>
            {/* Terminal Node Indicator */}
            {data.isTerminalNode && (
              <span className="bg-muted text-muted-foreground border-muted-foreground/30 rounded border px-2 py-0.5 text-xs font-medium">
                {t('sidePanel.end')}
              </span>
            )}
          </div>
          {data.description && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {data.description}
            </p>
          )}
        </div>

        {/* Step type label on right */}
        <Badge
          variant="outline"
          className="text-muted-foreground h-fit px-1 py-0.5 text-xs"
        >
          {getStepTypeLabel(data.stepType)}
        </Badge>
      </div>
    </button>
  );

  return (
    <div className="relative">
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

      {cardContent}

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
