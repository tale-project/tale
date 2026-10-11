'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';

import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import {
  useOrgTeams,
  useTeamNames,
} from '@/app/features/settings/teams/hooks/queries';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useUpdateProjectSharing } from '../hooks/mutations';

interface ProjectSharingSectionProps {
  projectId: string;
  organizationId: string;
  /** The audience — every team the project is scoped to; [] = org-wide. */
  teamIds: string[];
  /** Whether the current viewer can administer (gate the edit affordance). */
  canAdminister: boolean;
}

/**
 * A project's AUDIENCE — the one set of teams that may see it (empty =
 * organization-wide). There is no owning-versus-shared distinction any more:
 * the audience is a set, the same vocabulary a document or a folder uses.
 */
export function ProjectSharingSection({
  projectId,
  organizationId,
  teamIds,
  canAdminister,
}: ProjectSharingSectionProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  // What the viewer may ASSIGN (an admin: every team) — the picker's options,
  // with how that read stands: a failed read is never an org without teams.
  const {
    teams: assignableTeams,
    isLoading: teamsLoading,
    unavailable: teamsUnavailable,
    stale: teamsStale,
    retrying: teamsRetrying,
    failureCount: teamsFailures,
    retry: retryTeams,
  } = useOrgTeams();
  // Every team by name — the read-only summary must name a team the viewer
  // is not in, too.
  const names = useTeamNames();
  const { mutateAsync: updateSharing, isPending } = useUpdateProjectSharing();
  const summaryRef = useRef<HTMLDivElement>(null);

  const [acknowledgedAudience, setAcknowledgedAudience] = useState<{
    projectId: string;
    teamIds: string[];
  } | null>(null);
  const audienceTeamIds =
    acknowledgedAudience?.projectId === projectId
      ? acknowledgedAudience.teamIds
      : teamIds;

  if (
    acknowledgedAudience !== null &&
    (acknowledgedAudience.projectId !== projectId ||
      (teamIds.length === acknowledgedAudience.teamIds.length &&
        teamIds.every((id) => acknowledgedAudience.teamIds.includes(id))))
  ) {
    setAcknowledgedAudience(null);
  }

  const [pendingNarrowChange, setPendingNarrowChange] = useState<
    string[] | null
  >(null);

  const applySave = useCallback(
    async (next: string[]) => {
      try {
        await updateSharing({ projectId, teamIds: next });
        setAcknowledgedAudience({ projectId, teamIds: next });
        toast({ title: t('settings.saveSuccess'), variant: 'success' });
        setPendingNarrowChange(null);
      } catch (error) {
        if (error instanceof AppError) {
          const code = error.data?.code;
          if (
            code === 'PROJECT_SHARING_INVALID' ||
            code === 'PROJECT_TEAM_INVALID' ||
            code === 'TEAM_ACCESS_DENIED' ||
            code === 'ROLE_FORBIDDEN' ||
            code === 'PROJECT_FORBIDDEN'
          ) {
            toast({
              title: t('errors.' + code, {
                defaultValue: t('settings.saveError'),
              }),
              variant: 'destructive',
            });
            return;
          }
        }
        console.error('updateProjectSharing failed', error);
        toast({
          title: t('settings.saveError'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      }
    },
    [projectId, t, updateSharing],
  );

  // A change NARROWS access when it takes the project from organization-wide
  // to some teams, or drops a team that could see it — those are confirmed
  // first; widening (adding a team, going organization-wide) just saves.
  const handleChange = useCallback(
    (next: string[]) => {
      const wasOrgWide = audienceTeamIds.length === 0;
      const willBeOrgWide = next.length === 0;
      const upcoming = new Set(next);
      const narrows =
        (wasOrgWide && !willBeOrgWide) ||
        (!willBeOrgWide && audienceTeamIds.some((id) => !upcoming.has(id)));
      if (narrows) {
        setPendingNarrowChange(next);
        return;
      }
      void applySave(next);
    },
    [applySave, audienceTeamIds],
  );

  // A team's name comes from the directory, or from the assignable list an
  // admin's picker already holds. Only an answered directory can call a team
  // unknown: while it loads, or after its read failed, the summary counts the
  // teams instead of naming each one "Unknown team".
  const nameOf = (teamId: string) =>
    names.nameOf(teamId) ??
    assignableTeams?.find((team) => team.id === teamId)?.name;
  const namesPending =
    names.teams === undefined &&
    audienceTeamIds.some((id) => nameOf(id) === undefined);
  const audience =
    audienceTeamIds.length === 0
      ? t('list.sharingOrgWide')
      : namesPending
        ? t('sharing.teamCount', { count: audienceTeamIds.length })
        : audienceTeamIds
            .map((id) => nameOf(id) ?? t('list.unknownTeam'))
            .join(', ');

  const focusAudience = useCallback(() => {
    document
      .querySelector<HTMLElement>(
        `[data-project-audience="${projectId}"] [role="combobox"]`,
      )
      ?.focus();
  }, [projectId]);
  const focusSummary = useCallback(() => summaryRef.current?.focus(), []);

  if (!canAdminister) {
    return (
      <SettingsFieldList data-project-audience={projectId}>
        <SettingsFieldRow label={t('sharing.effectiveAudience')}>
          {/* A named group the focus can return to once a retried names
              read takes its notice away. */}
          {({ labelId }) => (
            <div
              ref={summaryRef}
              role="group"
              aria-labelledby={labelId}
              tabIndex={-1}
              className="space-y-2 outline-none"
            >
              <Text variant="muted">{audience}</Text>
              {namesPending && names.unavailable ? (
                <CatalogLoadError
                  message={t('sharing.teamNamesLoadError')}
                  failureKey={names.failureCount}
                  isRetrying={names.retrying}
                  onRetry={names.retry}
                  onFocusLost={focusSummary}
                />
              ) : namesPending && names.isLoading ? (
                <Spinner size="sm" label={tCommon('actions.loading')} />
              ) : null}
            </div>
          )}
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  }

  // A settled failed read, also while its retry runs, and a refresh that
  // failed: the saved audience stays readable, the picker's options are not
  // offered from a read that did not answer, and Try again hands the focus
  // to the picker once it is back.
  if (teamsUnavailable || teamsStale) {
    return (
      <SettingsFieldList data-project-audience={projectId}>
        <SettingsFieldRow
          label={t('settings.audience')}
          description={t('settings.audienceHelp')}
        >
          <div className="space-y-2">
            <Text variant="muted">{audience}</Text>
            <CatalogLoadError
              message={t('sharing.teamsLoadError')}
              failureKey={teamsFailures}
              isRetrying={teamsRetrying}
              onRetry={retryTeams}
              onFocusLost={focusAudience}
            />
          </div>
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  }

  // The same field-row chrome as the Project section above it: label and help
  // on the left, the control pinned in the shared control column on the
  // right, so this page reads as one aligned list of rows.
  if (!assignableTeams || assignableTeams.length === 0) {
    return (
      <SettingsFieldList data-project-audience={projectId}>
        <SettingsFieldRow
          label={t('settings.audience')}
          description={t('settings.audienceHelp')}
        >
          {/* No teams until the org's teams have loaded: "No teams yet" would
              be false for an org that has them, so hold the row meanwhile. */}
          {teamsLoading ? (
            <div className="space-y-2">
              <Text variant="muted">{audience}</Text>
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </div>
          ) : (
            <Text variant="muted">
              {t('sharing.noTeamsHint')}{' '}
              <Link
                to="/dashboard/$id/settings/teams"
                params={{ id: organizationId }}
                className="text-primary hover:underline"
              >
                {t('sharing.noTeamsCreateLink')}
              </Link>
            </Text>
          )}
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  }

  return (
    <>
      <SettingsFieldList data-project-audience={projectId}>
        <SettingsFieldRow
          label={t('settings.audience')}
          description={t('settings.audienceHelp')}
        >
          {/* The row shows the label and the help, so the combobox points at
              both itself: a screen reader hears "Audience" and that an empty
              audience means the whole organization before it narrows one. */}
          {({ labelId, descriptionId }) => (
            <TeamMultiSelect
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              teams={assignableTeams}
              selectedTeamIds={audienceTeamIds}
              onSelectionChange={handleChange}
              orgWideLabel={t('list.sharingOrgWide')}
              disabled={isPending}
            />
          )}
        </SettingsFieldRow>
      </SettingsFieldList>

      <ConfirmDialog
        open={pendingNarrowChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNarrowChange(null);
        }}
        title={t('overview.sharingHeading')}
        description={t('settings.sharingNarrowingWarning')}
        // A distinct "Confirm" (not "Save changes") so this access-narrowing
        // confirmation isn't mistaken for the page's form-save / unsaved-changes
        // prompt — they previously shared the exact "Save changes" wording.
        confirmText={tCommon('actions.confirm')}
        isLoading={isPending}
        variant="destructive"
        onConfirm={() => {
          if (pendingNarrowChange) void applySave(pendingNarrowChange);
        }}
      />
    </>
  );
}
