/**
 * Shared badge color utilities.
 * Provides consistent color schemes for status badges, role badges, etc.
 */

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted';

export type BadgeColorClasses = {
  bg: string;
  text: string;
  border?: string;
};

/**
 * Standard badge color mappings.
 */
export const badgeColors: Record<BadgeVariant, BadgeColorClasses> = {
  default: {
    bg: 'bg-secondary',
    text: 'text-secondary-foreground',
  },
  success: {
    bg: 'bg-green-100 dark:bg-green-950/20',
    text: 'text-green-800 dark:text-green-200',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    bg: 'bg-amber-100 dark:bg-amber-950/20',
    text: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-200 dark:border-amber-800',
  },
  error: {
    bg: 'bg-red-100 dark:bg-red-950/20',
    text: 'text-red-800 dark:text-red-200',
    border: 'border-red-200 dark:border-red-800',
  },
  info: {
    bg: 'bg-blue-100 dark:bg-blue-950/20',
    text: 'text-blue-800 dark:text-blue-200',
    border: 'border-blue-200 dark:border-blue-800',
  },
  muted: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
  },
};

/**
 * Get badge color classes for a variant.
 */
export function getBadgeColorClasses(
  variant: BadgeVariant,
  includeBorder = false
): string {
  const colors = badgeColors[variant];
  const classes = [colors.bg, colors.text];
  if (includeBorder && colors.border) {
    classes.push(colors.border);
  }
  return classes.join(' ');
}

/**
 * Role to badge variant mapping.
 */
export type RoleBadgeVariant = 'admin' | 'developer' | 'member' | 'viewer';

const roleBadgeVariantMap: Record<RoleBadgeVariant, BadgeVariant> = {
  admin: 'error',
  developer: 'info',
  member: 'muted',
  viewer: 'muted',
};

/**
 * Get badge color classes for a role.
 */
export function getRoleBadgeClasses(role?: string | null): string {
  const normalizedRole = (role || '').toLowerCase() as RoleBadgeVariant;
  const variant = roleBadgeVariantMap[normalizedRole] || 'muted';
  return getBadgeColorClasses(variant);
}

/**
 * Status to badge variant mapping.
 */
export type StatusBadgeVariant =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'draft'
  | 'archived'
  | 'open'
  | 'closed'
  | 'processing'
  | 'queued';

const statusBadgeVariantMap: Record<StatusBadgeVariant, BadgeVariant> = {
  active: 'success',
  inactive: 'muted',
  pending: 'warning',
  completed: 'success',
  failed: 'error',
  draft: 'info',
  archived: 'muted',
  open: 'info',
  closed: 'muted',
  processing: 'warning',
  queued: 'info',
};

/**
 * Get badge color classes for a status.
 */
export function getStatusBadgeClasses(status?: string | null): string {
  const normalizedStatus = (status || '').toLowerCase() as StatusBadgeVariant;
  const variant = statusBadgeVariantMap[normalizedStatus] || 'muted';
  return getBadgeColorClasses(variant);
}

/**
 * Workflow step type to badge variant mapping.
 */
type StepTypeBadgeVariant =
  | 'trigger'
  | 'action'
  | 'condition'
  | 'delay'
  | 'loop'
  | 'end';

const stepTypeBadgeVariantMap: Record<StepTypeBadgeVariant, BadgeVariant> = {
  trigger: 'info',
  action: 'success',
  condition: 'warning',
  delay: 'muted',
  loop: 'info',
  end: 'muted',
};

/**
 * Get badge color classes for a workflow step type.
 */
function getStepTypeBadgeClasses(stepType?: string | null): string {
  const normalizedType = (stepType || '').toLowerCase() as StepTypeBadgeVariant;
  const variant = stepTypeBadgeVariantMap[normalizedType] || 'muted';
  return getBadgeColorClasses(variant);
}

/**
 * RAG status to badge variant mapping.
 */
type RagStatusBadgeVariant =
  | 'indexed'
  | 'pending'
  | 'processing'
  | 'failed'
  | 'not_indexed';

const ragStatusBadgeVariantMap: Record<RagStatusBadgeVariant, BadgeVariant> = {
  indexed: 'success',
  pending: 'warning',
  processing: 'info',
  failed: 'error',
  not_indexed: 'muted',
};

/**
 * Get badge color classes for a RAG status.
 */
function getRagStatusBadgeClasses(status?: string | null): string {
  const normalizedStatus = (status || '').toLowerCase() as RagStatusBadgeVariant;
  const variant = ragStatusBadgeVariantMap[normalizedStatus] || 'muted';
  return getBadgeColorClasses(variant);
}

/**
 * Priority to badge variant mapping.
 */
type PriorityBadgeVariant = 'high' | 'medium' | 'low' | 'urgent';

const priorityBadgeVariantMap: Record<PriorityBadgeVariant, BadgeVariant> = {
  urgent: 'error',
  high: 'warning',
  medium: 'info',
  low: 'muted',
};

/**
 * Get badge color classes for a priority level.
 */
function getPriorityBadgeClasses(priority?: string | null): string {
  const normalizedPriority = (priority || '').toLowerCase() as PriorityBadgeVariant;
  const variant = priorityBadgeVariantMap[normalizedPriority] || 'muted';
  return getBadgeColorClasses(variant);
}
