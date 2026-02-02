'use client';

import { Position } from '@xyflow/react';
import {
  Cpu,
  HelpCircle,
  Zap,
  Repeat,
  Users,
  MessageSquare,
  Package,
  FileText,
  Plug,
  Variable,
  Database,
  Mail,
  Send,
  ClipboardList,
  CheckCircle,
  Mic,
  Cloud,
  Globe,
  Layout,
  GitBranch,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Doc } from '@/convex/_generated/dataModel';
import { Badge } from '@/app/components/ui/feedback/badge';
import { useT } from '@/lib/i18n/client';
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

  const getActionIcon = (actionType?: string) => {
    const iconClass =
      'size-5 p-1 bg-orange-100 rounded-sm shrink-0 text-orange-600';
    switch (actionType) {
      case 'customer':
        return <Users className={iconClass} />;
      case 'conversation':
        return <MessageSquare className={iconClass} />;
      case 'product':
        return <Package className={iconClass} />;
      case 'document':
        return <FileText className={iconClass} />;
      case 'integration':
        return <Plug className={iconClass} />;
      case 'set_variables':
        return <Variable className={iconClass} />;
      case 'rag':
        return <Database className={iconClass} />;
      case 'imap':
        return <Mail className={iconClass} />;
      case 'email_provider':
        return <Send className={iconClass} />;
      case 'workflow_processing_records':
        return <ClipboardList className={iconClass} />;
      case 'approval':
        return <CheckCircle className={iconClass} />;
      case 'tone_of_voice':
        return <Mic className={iconClass} />;
      case 'onedrive':
        return <Cloud className={iconClass} />;
      case 'crawler':
      case 'website':
        return <Globe className={iconClass} />;
      case 'websitePages':
        return <Layout className={iconClass} />;
      case 'workflow':
        return <GitBranch className={iconClass} />;
      default:
        return <Settings className={iconClass} />;
    }
  };

  const getIcon = (stepType: string, actionType?: string) => {
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
        return getActionIcon(actionType);
      default:
        return <div className="size-5 rounded-full bg-muted" />;
    }
  };

  const getStepTypeLabel = (stepType: string) => {
    const labels: Record<string, string> = {
      trigger: t('stepTypes.trigger'),
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
      <div className="py-2 px-2.5 flex gap-3">
        {/* Icon on left */}
        {getIcon(data.stepType, data.actionType)}

        {/* Content in center */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground">
              {data.label}
            </h3>
            {/* Terminal Node Indicator */}
            {data.isTerminalNode && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground border border-muted-foreground/30">
                {t('sidePanel.end')}
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

      {cardContent}

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
