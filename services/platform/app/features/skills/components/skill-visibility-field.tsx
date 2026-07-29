'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useT } from '@/lib/i18n/client';
import type { SkillVisibility } from '@/lib/shared/schemas/skills';

export interface SkillSharingValue {
  readonly visibility: SkillVisibility;
  /** Selected team ids; only meaningful when `visibility === 'team'`. */
  readonly teams: readonly string[];
}

/**
 * True when moving from `current` to `next` takes access away from someone
 * who has it — org → anything narrower, or a team dropped from the list.
 * Widening (private → team/org, adding teams) never warns.
 */
export function isNarrowingSharingChange(
  current: SkillSharingValue,
  next: SkillSharingValue,
): boolean {
  if (current.visibility === 'org') return next.visibility !== 'org';
  if (current.visibility === 'team') {
    if (next.visibility === 'org') return false;
    if (next.visibility === 'private') return true;
    return current.teams.some((teamId) => !next.teams.includes(teamId));
  }
  return false;
}

/**
 * Who may see a skill: private / team(s) / everyone. The team option only
 * arms when the org has teams; a narrowing change (someone loses access —
 * and with it any chat or agent that equips the skill through them) asks
 * before it applies.
 *
 * Controlled: `value` is what the FORM currently holds; `savedValue` is what
 * the file on disk says, and is what the narrowing warning compares against.
 */
export function SkillVisibilityField({
  value,
  savedValue,
  onChange,
  disabled,
}: {
  value: SkillSharingValue;
  savedValue?: SkillSharingValue;
  onChange: (value: SkillSharingValue) => void;
  disabled?: boolean;
}) {
  const { t } = useT('skills');
  const { teams, isLoading } = useOrgTeams();
  const orgTeams = teams ?? [];
  const [pendingNarrowing, setPendingNarrowing] =
    useState<SkillSharingValue | null>(null);

  const apply = (next: SkillSharingValue) => {
    if (
      savedValue !== undefined &&
      isNarrowingSharingChange(savedValue, next)
    ) {
      setPendingNarrowing(next);
      return;
    }
    onChange(next);
  };

  const teamOptionDisabled = !isLoading && orgTeams.length === 0;
  const teamsRequired = value.visibility === 'team' && value.teams.length === 0;

  return (
    <Stack gap={2}>
      <RadioGroup
        // The visible label comes from the settings row framing this control.
        aria-label={t('visibility.label')}
        value={value.visibility}
        onValueChange={(visibility) => {
          if (
            visibility !== 'private' &&
            visibility !== 'team' &&
            visibility !== 'org'
          ) {
            return;
          }
          apply({
            visibility,
            teams: visibility === 'team' ? value.teams : [],
          });
        }}
        disabled={disabled}
        options={[
          {
            value: 'private',
            label: t('visibility.private'),
            description: t('visibility.privateHelp'),
          },
          {
            value: 'team',
            label: t('visibility.team'),
            description: teamOptionDisabled
              ? t('visibility.noTeamsHint')
              : t('visibility.teamHelp'),
            disabled: teamOptionDisabled,
          },
          {
            value: 'org',
            label: t('visibility.org'),
            description: t('visibility.orgHelp'),
          },
        ]}
      />

      {value.visibility === 'team' && (
        <Stack gap={1}>
          <Text as="span" variant="label">
            {t('visibility.teamsLabel')}
          </Text>
          <TeamMultiSelect
            teams={orgTeams}
            selectedTeamIds={[...value.teams]}
            onSelectionChange={(teamIds) =>
              apply({ visibility: 'team', teams: teamIds })
            }
            orgWideLabel={t('visibility.teamsPlaceholder')}
            emptyPlaceholderStyle="muted"
            disabled={disabled}
          />
          {teamsRequired && (
            <Text as="p" variant="caption" className="text-destructive">
              {t('visibility.teamsRequired')}
            </Text>
          )}
        </Stack>
      )}

      <ConfirmDialog
        open={pendingNarrowing !== null}
        onOpenChange={(next) => {
          if (!next) setPendingNarrowing(null);
        }}
        title={t('visibility.narrowingTitle')}
        description={t('visibility.narrowingWarning')}
        variant="destructive"
        onConfirm={() => {
          if (pendingNarrowing !== null) onChange(pendingNarrowing);
          setPendingNarrowing(null);
        }}
      />
    </Stack>
  );
}
