/**
 * Shared step icon utilities for automation components
 */

import type { LucideIcon } from 'lucide-react';
import {
  Zap,
  Cpu,
  HelpCircle,
  Repeat,
  ArrowRightFromLine,
  Users,
  MessageSquare,
  Package,
  FileText,
  Plug,
  Variable,
  Database,
  DatabaseZap,
  Mail,
  ClipboardList,
  CheckCircle,
  Cloud,
  Globe,
  GitBranch,
  Settings,
} from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';

const ACTION_ICON_MAP: Record<string, LucideIcon> = {
  customer: Users,
  conversation: MessageSquare,
  product: Package,
  document: FileText,
  integration: Plug,
  set_variables: Variable,
  rag: Database,
  imap: Mail,
  workflow_processing_records: ClipboardList,
  integration_processing_records: DatabaseZap,
  approval: CheckCircle,
  onedrive: Cloud,
  crawler: Globe,
  website: Globe,
  workflow: GitBranch,
};

const STEP_TYPE_ICON_MAP: Record<string, LucideIcon> = {
  start: Zap,
  trigger: Zap,
  llm: Cpu,
  condition: HelpCircle,
  loop: Repeat,
  output: ArrowRightFromLine,
};

const DEFAULT_ACTION_ICON = Settings;

export function getActionIconComponent(actionType?: string): LucideIcon {
  return ACTION_ICON_MAP[actionType || ''] || DEFAULT_ACTION_ICON;
}

export function getStepIconComponent(
  stepType?: Doc<'wfStepDefs'>['stepType'],
  actionType?: string,
): LucideIcon | null {
  if (stepType === 'action') {
    return getActionIconComponent(actionType);
  }
  return STEP_TYPE_ICON_MAP[stepType || ''] || null;
}

export function getStepIcon(
  stepType?: Doc<'wfStepDefs'>['stepType'],
  actionType?: string,
  iconClass = 'size-4 shrink-0',
) {
  const IconComponent = getStepIconComponent(stepType, actionType);
  if (!IconComponent) {
    return null;
  }
  return <IconComponent className={iconClass} />;
}

/** The `config.type` of an action step, or undefined for non-action steps. */
export function getStepActionType(
  step: Pick<Doc<'wfStepDefs'>, 'stepType' | 'config'>,
): string | undefined {
  return step.stepType === 'action' && 'type' in step.config
    ? step.config.type
    : undefined;
}

/** Tailwind chip classes for a step type's badge (light + dark variants). */
export function getStepTypeColor(stepType: string): string {
  switch (stepType) {
    case 'start':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'llm':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
    case 'condition':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'loop':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
    case 'action':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
