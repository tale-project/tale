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
