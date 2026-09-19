'use client';

import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

/**
 * The teams the signed-in member belongs to, and what that means — the one
 * place a person learns which documents, projects and inbox queues their
 * membership opens. Read-only: an admin changes rosters under Settings ›
 * Teams (linked here for them); nobody "switches" a team.
 */
export function TeamsSection() {
  const { t: tSettings } = useT('settings');
  const organizationId = useOrganizationId();
  const { teams, isLoading } = useTeams();
  const canManageTeams = useAbility().can('read', 'orgSettings');

  return (
    <SettingsSection
      id="teams"
      title={tSettings('account.teams.title')}
      description={tSettings('account.teams.description')}
    >
      {isLoading ? null : !teams || teams.length === 0 ? (
        <Text variant="muted">{tSettings('account.teams.none')}</Text>
      ) : (
        <HStack gap={2} className="flex-wrap">
          {teams.map((team) => (
            <Badge key={team.id} variant="outline">
              {team.name}
            </Badge>
          ))}
        </HStack>
      )}
      {canManageTeams && organizationId ? (
        <Text variant="muted" className="mt-2 text-sm">
          <Link
            to="/dashboard/$id/settings/teams"
            params={{ id: organizationId }}
            className="text-primary hover:underline"
          >
            {tSettings('account.teams.manageLink')}
          </Link>
        </Text>
      ) : null}
    </SettingsSection>
  );
}
