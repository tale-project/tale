'use client';

import { Link } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Select } from '@/app/components/ui/forms/select';
import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { BackendError } from '@/app/lib/backend/backend-error';
import { useT } from '@/lib/i18n/client';

import { useUpdateProjectSharing } from '../hooks/mutations';

interface ProjectSharingSectionProps {
  projectId: string;
  organizationId: string;
  /** Current owning team id; `undefined` means org-wide. */
  teamId: string | undefined;
  /** Currently shared-with team ids. */
  sharedWithTeamIds: string[];
  /** Whether the current viewer can administer (gate the edit affordance). */
  canAdminister: boolean;
}

const NONE_OWNING_TEAM = '__org_wide__';

type PendingChange = {
  teamId: string | null;
  sharedWithTeamIds: string[];
};

export function ProjectSharingSection({
  projectId,
  organizationId,
  teamId,
  sharedWithTeamIds,
  canAdminister,
}: ProjectSharingSectionProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { teams } = useOrgTeams();
  const { mutateAsync: updateSharing, isPending } = useUpdateProjectSharing();

  const [pendingNarrowChange, setPendingNarrowChange] =
    useState<PendingChange | null>(null);

  const teamOptions = useMemo(() => {
    const opts = [{ value: NONE_OWNING_TEAM, label: t('list.sharingOrgWide') }];
    for (const team of teams ?? []) {
      opts.push({ value: team.id, label: team.name });
    }
    return opts;
  }, [teams, t]);

  // Teams available for the "Also shared with" multiselect — exclude the
  // owning team (mirrors `validateSharing` server-side).
  const shareableTeams = useMemo(
    () => (teams ?? []).filter((tm) => tm.id !== teamId),
    [teams, teamId],
  );

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams ?? []) map.set(team.id, team.name);
    return map;
  }, [teams]);

  const computeIsNarrowing = useCallback(
    (next: PendingChange): boolean => {
      const wasOrgWide = !teamId && sharedWithTeamIds.length === 0;
      const willBeOrgWide =
        next.teamId === null && next.sharedWithTeamIds.length === 0;
      if (wasOrgWide && !willBeOrgWide) return true;
      const previous = new Set<string>(sharedWithTeamIds);
      if (teamId) previous.add(teamId);
      const upcoming = new Set<string>(next.sharedWithTeamIds);
      if (next.teamId) upcoming.add(next.teamId);
      for (const id of previous) {
        if (!upcoming.has(id)) return true;
      }
      return false;
    },
    [teamId, sharedWithTeamIds],
  );

  const applySave = useCallback(
    async (next: PendingChange) => {
      try {
        await updateSharing({
          projectId,
          teamId: next.teamId,
          sharedWithTeamIds: next.sharedWithTeamIds,
        });
        toast({ title: t('settings.saveSuccess'), variant: 'success' });
        setPendingNarrowChange(null);
      } catch (error) {
        if (error instanceof BackendError) {
          const code = error.data?.code;
          if (
            code === 'PROJECT_SHARING_INVALID' ||
            code === 'PROJECT_TEAM_INVALID' ||
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

  const commit = useCallback(
    (next: PendingChange) => {
      if (computeIsNarrowing(next)) {
        setPendingNarrowChange(next);
        return;
      }
      void applySave(next);
    },
    [applySave, computeIsNarrowing],
  );

  const handleOwningTeamChange = useCallback(
    (value: string) => {
      const nextOwningTeam = value === NONE_OWNING_TEAM ? null : value;
      // Going org-wide clears every share — a "shared-with" team is additional
      // to an owning team, so without an owner those shares would silently keep
      // the project restricted while the Select reads "Org-wide" (mirrors the
      // server-side `normalizeSharing`). Otherwise drop just the new owning team
      // from the shared list (the owning team can't also appear in it).
      const nextShared =
        nextOwningTeam === null
          ? []
          : sharedWithTeamIds.filter((id) => id !== nextOwningTeam);
      commit({ teamId: nextOwningTeam, sharedWithTeamIds: nextShared });
    },
    [commit, sharedWithTeamIds],
  );

  const handleSharedTeamsChange = useCallback(
    (nextShared: string[]) => {
      commit({ teamId: teamId ?? null, sharedWithTeamIds: nextShared });
    },
    [commit, teamId],
  );

  if (!canAdminister) {
    // Read-only audience summary for non-admin viewers.
    const names: string[] = [];
    if (teamId) names.push(teamNameMap.get(teamId) ?? teamId);
    for (const sid of sharedWithTeamIds) {
      names.push(teamNameMap.get(sid) ?? sid);
    }
    const audience =
      names.length === 0 ? t('list.sharingOrgWide') : names.join(', ');
    return (
      <FormSection label={t('sharing.effectiveAudience')}>
        <p className="text-muted-foreground text-sm">{audience}</p>
      </FormSection>
    );
  }

  if (!teams || teams.length === 0) {
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
        <Select
          options={teamOptions}
          label={t('settings.owningTeam')}
          description={t('settings.owningTeamHelp')}
          value={teamId ?? NONE_OWNING_TEAM}
          onValueChange={handleOwningTeamChange}
          disabled={isPending}
        />
      </FormSection>

      {teamId && shareableTeams.length > 0 ? (
        <FormSection>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t('settings.alsoSharedWith')}
            </label>
            <p className="text-muted-foreground text-sm">
              {t('settings.alsoSharedWithHelp')}
            </p>
            <TeamMultiSelect
              teams={shareableTeams}
              selectedTeamIds={sharedWithTeamIds}
              onSelectionChange={handleSharedTeamsChange}
              orgWideLabel={t('settings.noAdditionalTeams')}
              emptyPlaceholderStyle="muted"
              disabled={isPending}
            />
          </div>
        </FormSection>
      ) : null}

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
