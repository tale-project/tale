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

const validRoles = new Set<RoleBadgeVariant>([
  'admin',
  'developer',
  'member',
  'viewer',
]);

export function getRoleBadgeClasses(role?: string | null): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by Set check below
  const normalizedRole = (role || '').toLowerCase() as RoleBadgeVariant;
  if (validRoles.has(normalizedRole)) {
    return roleBadgeVariants({ role: normalizedRole });
  }
  return roleBadgeVariants({ role: 'member' });
}
