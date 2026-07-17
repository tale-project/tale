'use client';

import { IconButton } from '@tale/ui/icon-button';
import { Stack } from '@tale/ui/layout';
import { Link } from '@tanstack/react-router';
import { Check, Plus, Settings } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { TeamCreateDialog } from './team-create-dialog';

interface TeamOption {
  id: string;
  name: string;
}

interface TeamListPanelProps {
  organizationId: string;
  teams: TeamOption[];
  /** Currently active team filter, or null for "All teams". */
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
  onAfterAction?: () => void;
  /**
   * Called when the user activates the "manage teams" gear in the header, so a
   * caller that renders the panel inside an overlay (e.g. the account menu) can
   * dismiss that overlay before we navigate to the team-settings page.
   */
  onManageTeams?: () => void;
  /**
   * Hide the "Team" section header. Use when the panel is rendered under a row
   * that already labels it (e.g. the account menu's inline Team picker), where
   * the header would be redundant.
   */
  hideHeader?: boolean;
}

/**
 * The team-filter picker, mirroring {@link OrganizationListPanel}: a scrollable
 * list of teams with the active one checked, plus a "Create team" footer that
 * opens the team-create dialog. Always renders — when the org has no teams yet
 * it shows an empty-state line above the create action, so the section never
 * silently disappears.
 *
 * The first row is an "All teams" pseudo-option that clears the filter.
 */
export function TeamListPanel({
  organizationId,
  teams,
  selectedTeamId,
  onSelectTeam,
  onAfterAction,
  onManageTeams,
  hideHeader = false,
}: TeamListPanelProps) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [createOpen, setCreateOpen] = useState(false);
  // Gate the header's settings gear to match its destination
  // (/dashboard/$id/settings/teams is `read orgSettings`), so members who
  // can't reach that page aren't sent to a denied screen.
  const canManageTeams = useAbility().can('read', 'orgSettings');

  const handleSelect = useCallback(
    (teamId: string | null) => {
      onSelectTeam(teamId);
      onAfterAction?.();
    },
    [onSelectTeam, onAfterAction],
  );

  const options: { value: string; label: string }[] = [
    { value: '', label: tNav('teamFilter.allTeams') },
    ...teams.map((team) => ({ value: team.id, label: team.name })),
  ];

  return (
    <Stack gap={0}>
      {!hideHeader && (
        <div className="flex min-h-8 items-center justify-between gap-2 pr-1.5 pl-3">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {tNav('teamFilter.label')}
          </span>
          {canManageTeams && (
            <IconButton
              asChild
              icon={Settings}
              size="sm"
              aria-label={tNav('teamFilter.manageTeams')}
              slotChild={
                <Link
                  to="/dashboard/$id/settings/teams"
                  params={{ id: organizationId }}
                  // Navigating leaves the popup, so dismiss the (controlled) menu
                  // it lives in — otherwise it lingers over the settings page.
                  // team-select is intentionally left untouched.
                  onClick={() => onManageTeams?.()}
                />
              }
            />
          )}
        </div>
      )}

      <ul
        role="radiogroup"
        aria-label={tNav('teamFilter.label')}
        className="max-h-72 overflow-y-auto py-1"
      >
        {options.map((option) => {
          const checked = (selectedTeamId ?? '') === option.value;
          return (
            <li key={option.value || 'all'}>
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(option.value || null);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  checked
                    ? 'bg-muted'
                    : 'hover:bg-muted focus-visible:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {checked ? (
                  <Check className="text-foreground size-4 shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {teams.length === 0 && (
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          {tEmpty('teams.description')}
        </p>
      )}

      <div className="border-border border-t p-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCreateOpen(true);
          }}
          className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
        >
          <Plus className="text-muted-foreground size-4 shrink-0" />
          <span>{tSettings('teams.createTeam')}</span>
        </button>
      </div>

      <TeamCreateDialog
        organizationId={organizationId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Stack>
  );
}
