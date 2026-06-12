'use client';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

interface TeamsSettingsProps {
  organizationId: string;
}

// =============================================================================
// Teams settings page — renders the REAL section header above the Teams
// table on every state (cold, warm, loaded). Members live on the Organization
// page, so this page is now a single Teams table; the table owns its own
// count-aware loading skeleton (via the DataTable state machine), so there is
// no separate page-skeleton to drift from this layout.
// =============================================================================
export function TeamsSettings({ organizationId }: TeamsSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tAccess } = useT('accessDenied');
  const { teams } = useOrgTeams();

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // Access is only knowable once the ability has loaded; until then the real
  // page (with its self-skeletonizing table) stands in — no denied-flash on
  // warm entry.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <SettingsPage narrow>
      <SettingsSection
        title={tNav('teams')}
        description={tSettings('teams.sectionDescription')}
      >
        <TeamsTable teams={teams} organizationId={organizationId} />
      </SettingsSection>
    </SettingsPage>
  );
}
