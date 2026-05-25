'use client';

import { Tabs } from '@tale/ui/tabs';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
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

export function PeopleSettings({
  organizationId,
  memberContext,
  tab,
  onTabChange,
}: PeopleSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { teams } = useOrgTeams();

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
