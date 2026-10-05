'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';

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
 *
 * A failed read says so, with **Try again**, and never reads as "not in any
 * team" (#3847): that sentence is a read that answered with no teams.
 */
export function TeamsSection() {
  const { t: tSettings } = useT('settings');
  const organizationId = useOrganizationId();
  const { teams, unavailable, stale, retrying, failureCount, retry } =
    useTeams();
  const canManageTeams = useAbility().can('read', 'orgSettings');

  // A retry that works takes the notice away, and with it a Try again that
  // held the focus: the focus goes to the section, which keeps its name,
  // instead of dropping to the page.
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = useCallback(() => {
    sectionRef.current?.focus();
  }, []);

  return (
    <SettingsSection
      ref={sectionRef}
      tabIndex={-1}
      className="outline-none"
      id="teams"
      title={tSettings('account.teams.title')}
      description={tSettings('account.teams.description')}
      action={
        canManageTeams && organizationId ? (
          <Button asChild variant="secondary" size="sm">
            <Link
              to="/dashboard/$id/settings/teams"
              params={{ id: organizationId }}
            >
              {tSettings('account.teams.manageLink')}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {(unavailable || stale) && (
        <CatalogLoadError
          // Each failure is announced again; Try again keeps its node, and
          // the focus on it, while a retry runs and when it fails again.
          failureKey={failureCount}
          onFocusLost={focusSection}
          message={tSettings(
            stale ? 'account.teams.refreshFailed' : 'account.teams.loadFailed',
          )}
          onRetry={retry}
          isRetrying={retrying}
        />
      )}
      {teams === undefined ? null : teams.length === 0 ? (
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
    </SettingsSection>
  );
}
