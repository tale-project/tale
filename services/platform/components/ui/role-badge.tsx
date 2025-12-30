'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { getRoleBadgeClasses, getStatusBadgeClasses } from '@/lib/utils/badge-colors';

export interface RoleBadgeProps {
  /** The role to display */
  role: string | null | undefined;
  /** Translation function for role labels */
  getLabel?: (role: string) => string;
  /** Additional className */
  className?: string;
}

/**
 * A badge component that displays a role with appropriate styling.
 * Uses the shared badge color utility for consistent colors.
 *
 * @example
 * ```tsx
 * <RoleBadge role="admin" getLabel={(r) => t(`roles.${r}`)} />
 * ```
 */
export const RoleBadge = React.memo(function RoleBadge({
  role,
  getLabel,
  className,
}: RoleBadgeProps) {
  const displayRole = role || 'disabled';
  const label = getLabel ? getLabel(displayRole) : displayRole;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
        getRoleBadgeClasses(role),
        className
      )}
    >
      {label}
    </span>
  );
});

export interface StatusBadgeProps {
  /** The status to display */
  status: string | null | undefined;
  /** Translation function for status labels */
  getLabel?: (status: string) => string;
  /** Additional className */
  className?: string;
  /** Whether to show a dot indicator */
  showDot?: boolean;
}

/**
 * A badge component that displays a status with appropriate styling.
 * Uses the shared badge color utility for consistent colors.
 *
 * @example
 * ```tsx
 * <StatusBadge status="active" getLabel={(s) => t(`status.${s}`)} showDot />
 * ```
 */
export const StatusBadge = React.memo(function StatusBadge({
  status,
  getLabel,
  className,
  showDot = false,
}: StatusBadgeProps) {
  const displayStatus = status || 'inactive';
  const label = getLabel ? getLabel(displayStatus) : displayStatus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
        getStatusBadgeClasses(status),
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            'size-1.5 rounded-full',
            status === 'active' && 'bg-green-500',
            status === 'inactive' && 'bg-gray-400',
            status === 'pending' && 'bg-amber-500',
            status === 'failed' && 'bg-red-500',
            status === 'processing' && 'bg-blue-500 animate-pulse'
          )}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
});
