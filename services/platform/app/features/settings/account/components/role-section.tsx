'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { RoleBadge } from '@/app/features/settings/organization/components/role-badge';
import { useAbility } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

/**
 * The signed-in member's role in this organization — what they may do, beside
 * "Your teams" (what they can reach). The Members page that lists roles is
 * admin-only, so this is where everyone else learns theirs. Read-only: an
 * admin changes it under Settings › Members (linked here for them), or the
 * identity provider sets it at sign-in.
 */
export function RoleSection() {
  const { t: tSettings } = useT('settings');
  const organizationId = useOrganizationId();
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const canManageMembers = useAbility().can('read', 'orgSettings');
  const role = memberContext?.role;

  return (
    <SettingsSection
      id="role"
      title={tSettings('account.role.title')}
      description={tSettings('account.role.description')}
    >
      {role ? (
        <HStack>
          <RoleBadge role={role} />
        </HStack>
      ) : null}
      {canManageMembers && organizationId ? (
        <Text variant="muted" className="mt-2 text-sm">
          <Link
            to="/dashboard/$id/settings/members"
            params={{ id: organizationId }}
            className="text-primary hover:underline"
          >
            {tSettings('account.role.manageLink')}
          </Link>
        </Text>
      ) : null}
    </SettingsSection>
  );
}
