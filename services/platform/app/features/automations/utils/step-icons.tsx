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

import type { StepType } from '@/lib/shared/schemas/workflows';

export type { StepType } from '@/lib/shared/schemas/workflows';

/**
 * Free-form workflow step config as it comes off the file-based workflow JSON.
 * `type` is the action discriminator (e.g. 'set_variables', 'rag') present on
 * `action` steps; all other keys are step-shape-specific and read dynamically.
 */
export type StepConfig = Record<string, unknown> & { type?: string };

/**
 * Frontend-local mirror of a file-based workflow step. The automations UI maps
 * the validated workflow JSON (`WorkflowStep` from the shared schema) into this
 * shape — a superset that also carries the synthetic `_id`/`_creationTime`
 * fields the components/list keys rely on. This replaces the former
 * `Doc<'wfStepDefs'>` cast now that the legacy Convex tables are dropped.
 */
export interface StepDef {
  _id: string;
  _creationTime: number;
  organizationId: string;
  wfDefinitionId: string;
  stepSlug: string;
  name: string;
  description?: string;
  stepType: StepType;
  order: number;
  nextSteps: Record<string, string>;
  config: StepConfig;
}

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
  stepType?: StepType,
  actionType?: string,
): LucideIcon | null {
  if (stepType === 'action') {
    return getActionIconComponent(actionType);
  }
  return STEP_TYPE_ICON_MAP[stepType || ''] || null;
}

export function getStepIcon(
  stepType?: StepType,
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
  step: Pick<StepDef, 'stepType' | 'config'>,
): string | undefined {
  return step.stepType === 'action' && 'type' in step.config
    ? step.config.type
    : undefined;
}

/**
 * Type → color mapping for step cards. Colors are chosen to evoke the step's
 * role and to stay clear of the green/red the Yes/No arrows use, so box color
 * and edge color never get confused:
 *   start    → blue    (the entry point)
 *   condition→ amber   (a decision — the universal flowchart "choose" color)
 *   loop     → cyan    (a repeat / cycle)
 *   llm      → violet  (AI reasoning)
 *   action   → indigo  (a process step that does work)
 *   output   → slate   (a neutral terminator)
 */

/** Tailwind chip classes for a step type's badge (light + dark variants). */
export function getStepTypeColor(stepType: string): string {
  switch (stepType) {
    case 'start':
    case 'trigger':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'llm':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300';
    case 'condition':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'loop':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
    case 'action':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300';
    case 'output':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/** Minimap stroke color per step type — the same theme-token hue as the card's
 *  accent border (`getStepAccentBorder` keeps each `--color-*` variable alive),
 *  so the overview and the canvas tell one story. Token vars, never hex. */
export function getStepMinimapStroke(stepType: string): string {
  switch (stepType) {
    case 'start':
    case 'trigger':
      return 'var(--color-blue-500)';
    case 'llm':
      return 'var(--color-violet-500)';
    case 'condition':
      return 'var(--color-amber-500)';
    case 'loop':
      return 'var(--color-cyan-500)';
    case 'action':
      return 'var(--color-indigo-500)';
    case 'output':
      return 'var(--color-slate-400)';
    default:
      return 'hsl(var(--muted-foreground))';
  }
}

/** Left-accent border color per step type — lets the reader recognize a step's
 *  kind at a glance (blue = start, amber = decision, cyan = loop, …). */
export function getStepAccentBorder(stepType: string): string {
  switch (stepType) {
    case 'start':
    case 'trigger':
      return 'border-l-blue-500';
    case 'llm':
      return 'border-l-violet-500';
    case 'condition':
      return 'border-l-amber-500';
    case 'loop':
      return 'border-l-cyan-500';
    case 'action':
      return 'border-l-indigo-500';
    case 'output':
      return 'border-l-slate-400';
    default:
      return 'border-l-muted-foreground/40';
  }
}
