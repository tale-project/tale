/**
 * Shared step icon utilities for automation components
 */

import type { LucideIcon } from 'lucide-react';

import {
  Zap,
  Cpu,
  HelpCircle,
  Repeat,
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
  Mic,
  Cloud,
  Globe,
  Layout,
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
  tone_of_voice: Mic,
  onedrive: Cloud,
  crawler: Globe,
  website: Globe,
  websitePages: Layout,
  workflow: GitBranch,
};

const STEP_TYPE_ICON_MAP: Record<string, LucideIcon> = {
  start: Zap,
  trigger: Zap,
  llm: Cpu,
  condition: HelpCircle,
  loop: Repeat,
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

function getActionIcon(actionType?: string, iconClass = 'size-4 shrink-0') {
  const IconComponent = getActionIconComponent(actionType);
  return <IconComponent className={iconClass} />;
}

export function getStepIcon(
  stepType?: Doc<'wfStepDefs'>['stepType'],
  actionType?: string,
  iconClass = 'size-4 shrink-0',
) {
  if (stepType === 'action') {
    return getActionIcon(actionType, iconClass);
  }

  const IconComponent = STEP_TYPE_ICON_MAP[stepType || ''];

  if (IconComponent) {
    return <IconComponent className={iconClass} />;
  }

  return null;
}
