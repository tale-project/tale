'use client';

import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Position } from '@xyflow/react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  getStepAccentBorder,
  getStepIconComponent,
  getStepTypeColor,
  type StepType,
} from '../utils/step-icons';
import { useAutomationCallbacks } from './automation-callbacks-context';
import { useNodeExecutionStatus } from './execution-status-context';
import { InvisibleHandle } from './invisible-handle';
import { NodeExecutionStatusBadge } from './node-execution-status-badge';

interface AutomationStepProps {
  data: {
    label: string;
    description?: string;
    stepType: StepType;
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
  const nodeStatus = useNodeExecutionStatus(data.stepSlug);

  // Determine handle positions based on whether each edge (top/bottom) has bidirectional connections
  // Only offset if there are connections in both directions at that specific edge
  const topTargetLeft = data.hasBidirectionalTop ? '45%' : '50%';
  const topSourceLeft = data.hasBidirectionalTop ? '55%' : '50%';
  const bottomTargetLeft = data.hasBidirectionalBottom ? '45%' : '50%';
  const bottomSourceLeft = data.hasBidirectionalBottom ? '55%' : '50%';

  const getIcon = (stepType: StepType, actionType?: string) => {
    const baseClass = 'size-6 p-1 rounded-md shrink-0';
    const styleClass = getStepTypeColor(stepType);

    const IconComponent = getStepIconComponent(stepType, actionType);
    if (!IconComponent) {
      return <div className="bg-muted size-6 rounded-full" />;
    }
    return <IconComponent className={cn(baseClass, styleClass)} />;
  };

  const getStepTypeLabel = (stepType: StepType) => {
    const labels: Record<string, string> = {
      start: t('stepTypes.start'),
      llm: t('stepTypes.llm'),
      condition: t('stepTypes.condition'),
      loop: t('stepTypes.loop'),
      action: t('stepTypes.action'),
      output: t('stepTypes.output'),
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
          : cn('border-border border-l-4', getStepAccentBorder(data.stepType)),
        nodeStatus?.status === 'running' && 'ring-2 ring-blue-400',
        nodeStatus?.status === 'failed' && 'ring-2 ring-destructive',
        nodeStatus?.status === 'waiting' && 'ring-2 ring-amber-400',
        nodeStatus?.status === 'paused' && 'ring-2 ring-amber-400',
      )}
      onClick={() => onNodeClick(data.stepSlug)}
    >
      <Row gap={3} align="stretch" className="px-2.5 py-2">
        {/* Icon on left */}
        {getIcon(data.stepType, data.actionType)}

        {/* Content in center */}
        <div className="min-w-0 flex-1">
          <Row gap={2}>
            <Heading level={3} size="sm">
              {data.label}
            </Heading>
            {/* Terminal Node Indicator */}
            {data.isTerminalNode && (
              <span className="bg-muted text-muted-foreground border-muted-foreground/30 rounded border px-2 py-0.5 text-xs font-medium">
                {t('sidePanel.end')}
              </span>
            )}
          </Row>
          {data.description && (
            <Text variant="caption" className="mt-1 line-clamp-2">
              {data.description}
            </Text>
          )}
        </div>

        {/* Step type label on right */}
        <Badge
          variant="outline"
          className="text-muted-foreground h-fit px-1 py-0.5 text-xs"
        >
          {getStepTypeLabel(data.stepType)}
        </Badge>
      </Row>
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

      {/* Execution status badge — a SIBLING of the card button (nesting a
          button inside the card's <button> would be invalid HTML), overlaid
          on the top-right corner. Renders nothing when no run is viewed. */}
      <NodeExecutionStatusBadge
        stepSlug={data.stepSlug}
        className="absolute -top-2.5 -right-2.5 z-10"
      />

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
