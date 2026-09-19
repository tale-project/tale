'use client';

import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { FormSection } from '@tale/ui/form-section';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import {
  useOrgTeams,
  useTeamNames,
} from '@/app/features/settings/teams/hooks/queries';
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
  // What the viewer may ASSIGN (an admin: every team) — the picker's options.
  const { teams: assignableTeams } = useOrgTeams();
  // Every team by name — the read-only summary must name a team the viewer
  // is not in, too.
  const { nameOf } = useTeamNames();
  const { mutateAsync: updateSharing, isPending } = useUpdateProjectSharing();

  const [pendingNarrowChange, setPendingNarrowChange] = useState<
    string[] | null
  >(null);

  const applySave = useCallback(
    async (next: string[]) => {
      try {
        await updateSharing({ projectId, teamIds: next });
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
        toast({ title: t('settings.saveError'), variant: 'destructive' });
      }
    },
    [projectId, t, updateSharing],
  );

  // A change NARROWS access when it takes the project from organization-wide
  // to some teams, or drops a team that could see it — those are confirmed
  // first; widening (adding a team, going organization-wide) just saves.
  const handleChange = useCallback(
    (next: string[]) => {
      const wasOrgWide = teamIds.length === 0;
      const willBeOrgWide = next.length === 0;
      const upcoming = new Set(next);
      const narrows =
        (wasOrgWide && !willBeOrgWide) ||
        (!willBeOrgWide && teamIds.some((id) => !upcoming.has(id)));
      if (narrows) {
        setPendingNarrowChange(next);
        return;
      }
      void applySave(next);
    },
    [applySave, teamIds],
  );

  if (!canAdminister) {
    // Read-only audience summary for non-admin viewers.
    const audience =
      teamIds.length === 0
        ? t('list.sharingOrgWide')
        : teamIds.map((id) => nameOf(id) ?? t('list.unknownTeam')).join(', ');
    return (
      <FormSection label={t('sharing.effectiveAudience')}>
        <p className="text-muted-foreground text-sm">{audience}</p>
      </FormSection>
    );
  }

  if (!assignableTeams || assignableTeams.length === 0) {
    return (
      <FormSection>
        <p className="text-muted-foreground text-sm">
          {t('sharing.noTeamsHint')}{' '}
          <Link
            to="/dashboard/$id/settings/teams"
            params={{ id: organizationId }}
            className="text-primary hover:underline"
          >
            {t('sharing.noTeamsCreateLink')}
          </Link>
        </p>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t('settings.audience')}
          </label>
          <p className="text-muted-foreground text-sm">
            {t('settings.audienceHelp')}
          </p>
          <TeamMultiSelect
            teams={assignableTeams}
            selectedTeamIds={teamIds}
            onSelectionChange={handleChange}
            orgWideLabel={t('list.sharingOrgWide')}
            disabled={isPending}
          />
        </div>
      </FormSection>

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
