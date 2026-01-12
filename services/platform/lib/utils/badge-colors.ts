/**
 * Shared badge color utilities.
 * Provides consistent color schemes for status badges, role badges, etc.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const badgeColorVariants = cva('', {
  variants: {
    variant: {
      default: 'bg-secondary text-secondary-foreground',
      success:
        'bg-green-100 dark:bg-green-950/20 text-green-800 dark:text-green-200',
      warning:
        'bg-amber-100 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200',
      error: 'bg-red-100 dark:bg-red-950/20 text-red-800 dark:text-red-200',
      info: 'bg-blue-100 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200',
      muted: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const badgeBorderVariants = cva('', {
  variants: {
    variant: {
      default: '',
      success: 'border-green-200 dark:border-green-800',
      warning: 'border-amber-200 dark:border-amber-800',
      error: 'border-red-200 dark:border-red-800',
      info: 'border-blue-200 dark:border-blue-800',
      muted: '',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type BadgeVariant = NonNullable<
  VariantProps<typeof badgeColorVariants>['variant']
>;

/**
 * Get badge color classes for a variant.
 */
function getBadgeColorClasses(variant: BadgeVariant, includeBorder = false) {
  const base = badgeColorVariants({ variant });
  if (includeBorder) {
    return cn(base, badgeBorderVariants({ variant }));
  }
  return base;
}

export { badgeColorVariants, getBadgeColorClasses };
export type { BadgeVariant };

/**
 * Role badge variants - maps roles directly to badge styles.
 */
const roleBadgeVariants = cva('', {
  variants: {
    role: {
      admin: 'bg-red-100 dark:bg-red-950/20 text-red-800 dark:text-red-200',
      developer:
        'bg-blue-100 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200',
      member: 'bg-muted text-muted-foreground',
      viewer: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: {
    role: 'member',
  },
});

type RoleBadgeVariant = NonNullable<
  VariantProps<typeof roleBadgeVariants>['role']
>;

/**
 * Get badge color classes for a role.
 */
export function getRoleBadgeClasses(role?: string | null): string {
  const normalizedRole = (role || '').toLowerCase() as RoleBadgeVariant;
  const validRoles: RoleBadgeVariant[] = ['admin', 'developer', 'member', 'viewer'];
  if (validRoles.includes(normalizedRole)) {
    return roleBadgeVariants({ role: normalizedRole });
  }
  return roleBadgeVariants({ role: 'member' });
}

export { roleBadgeVariants };
export type { RoleBadgeVariant };

/**
 * Status badge variants - maps statuses directly to badge styles.
 */
const statusBadgeVariants = cva('', {
  variants: {
    status: {
      active:
        'bg-green-100 dark:bg-green-950/20 text-green-800 dark:text-green-200',
      inactive: 'bg-muted text-muted-foreground',
      pending:
        'bg-amber-100 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200',
      completed:
        'bg-green-100 dark:bg-green-950/20 text-green-800 dark:text-green-200',
      failed: 'bg-red-100 dark:bg-red-950/20 text-red-800 dark:text-red-200',
      draft:
        'bg-blue-100 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200',
      archived: 'bg-muted text-muted-foreground',
      open: 'bg-blue-100 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200',
      closed: 'bg-muted text-muted-foreground',
      processing:
        'bg-amber-100 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200',
      queued:
        'bg-blue-100 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200',
    },
  },
  defaultVariants: {
    status: 'inactive',
  },
});

type StatusBadgeVariant = NonNullable<
  VariantProps<typeof statusBadgeVariants>['status']
>;

/**
 * Get badge color classes for a status.
 */
export function getStatusBadgeClasses(status?: string | null): string {
  const normalizedStatus = (status || '').toLowerCase() as StatusBadgeVariant;
  const validStatuses: StatusBadgeVariant[] = [
    'active',
    'inactive',
    'pending',
    'completed',
    'failed',
    'draft',
    'archived',
    'open',
    'closed',
    'processing',
    'queued',
  ];
  if (validStatuses.includes(normalizedStatus)) {
    return statusBadgeVariants({ status: normalizedStatus });
  }
  return statusBadgeVariants({ status: 'inactive' });
}

export { statusBadgeVariants };
export type { StatusBadgeVariant };
