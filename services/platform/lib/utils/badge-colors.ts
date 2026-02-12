/**
 * Shared badge color utilities.
 * Provides consistent color schemes for role badges.
 */

import { cva, type VariantProps } from 'class-variance-authority';

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

const roleMap: Record<string, RoleBadgeVariant> = {
  admin: 'admin',
  developer: 'developer',
  member: 'member',
  viewer: 'viewer',
};

export function getRoleBadgeClasses(role?: string | null): string {
  const variant = roleMap[(role || '').toLowerCase()];
  return roleBadgeVariants({ role: variant ?? 'member' });
}
