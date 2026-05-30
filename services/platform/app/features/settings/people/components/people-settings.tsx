'use client';

import { Tabs } from '@tale/ui/tabs';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { MembersSettings } from './members-settings';

type MemberContext = {
  memberId?: string;
  organizationId?: string;
  userId?: string;
  role?: string | null;
  createdAt?: number;
  displayName?: string;
  isAdmin?: boolean;
  canManageMembers?: boolean;
};

interface PeopleSettingsProps {
  organizationId: string;
  memberContext: MemberContext | null;
  tab: 'members' | 'teams';
  onTabChange: (tab: 'members' | 'teams') => void;
}

// =============================================================================
// People settings page — renders the REAL `SettingsPage` header + pill `Tabs`
// strip on every state (cold, warm, loaded). The Members and Teams tables own
// their own count-aware loading skeletons (via the DataTable state machine), so
// there is no separate page-skeleton to drift from this layout: the header and
// tab strip are known at load time and never shift when data arrives.
// =============================================================================
export function PeopleSettings({
  organizationId,
  memberContext,
  tab,
  onTabChange,
}: PeopleSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tAccess } = useT('accessDenied');
  const { teams } = useOrgTeams();

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // Access is only knowable once the ability has loaded; until then the real
  // page (with its self-skeletonizing tables) stands in — no denied-flash on
  // warm entry, no separate skeleton tab strip to mismatch the pill `Tabs`.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <SettingsPage
      title={tNav('people')}
      description={tSettings('menu.people.description')}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v === 'teams' ? 'teams' : 'members')}
        items={[
          {
            value: 'members',
            label: tSettings('organization.membersTitle'),
            content: (
              <MembersSettings
                organizationId={organizationId}
                memberContext={memberContext}
              />
            ),
          },
          {
            value: 'teams',
            label: tNav('teams'),
            content: (
              <TeamsTable teams={teams} organizationId={organizationId} />
            ),
          },
        ]}
      />
    </SettingsPage>
  );
}
