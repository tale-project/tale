'use client';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { MembersSettings } from '@/app/features/settings/organization/components/members-settings';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useT } from '@/lib/i18n/client';

interface MembersPageProps {
  organizationId: string;
}

// =============================================================================
// Members settings page — the org's people as their own menu point (split out
// of the Organization page, which keeps the workspace details). A single
// section over `MembersSettings`; the table owns its own count-aware loading
// skeleton, so there is no separate page-skeleton to drift from this layout.
// =============================================================================
export function MembersPage({ organizationId }: MembersPageProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tAccess } = useT('accessDenied');
  const { data: memberContext } = useCurrentMemberContext(organizationId);

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // Access is only knowable once the ability has loaded; until then the real
  // page (with its self-skeletonizing table) stands in — no denied-flash on
  // warm entry.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('members')}
        description={tSettings('organization.membersDescription')}
      >
        <MembersSettings
          organizationId={organizationId}
          memberContext={memberContext ?? null}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
