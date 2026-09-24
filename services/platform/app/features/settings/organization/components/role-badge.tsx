'use client';

import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';
import { getRoleBadgeClasses } from '@/lib/utils/badge-colors';

/**
 * The localized name of a member role (`settings.roles.*`). A missing role
 * reads as Disabled — a member row without a role grants nothing.
 */
export function useRoleLabel(): (role: string | null | undefined) => string {
  const { t } = useT('settings');
  return useCallback(
    (role) =>
      t(
        (role ? `roles.${role.toLowerCase()}` : 'roles.disabled') as Parameters<
          typeof t
        >[0],
      ),
    [t],
  );
}

/** A member role as the coloured pill the Members table and the account
 *  page share. */
export function RoleBadge({ role }: { role: string | null | undefined }) {
  const roleLabel = useRoleLabel();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getRoleBadgeClasses(
        role,
      )}`}
    >
      {roleLabel(role)}
    </span>
  );
}
