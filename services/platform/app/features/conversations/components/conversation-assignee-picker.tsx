'use client';

import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { Check, Settings, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { AssigneeAvatar } from '@/app/features/tasks/components/assignee-avatar';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useAssignConversation,
  useAssignConversationTeam,
} from '../hooks/mutations';
import type { ConversationWithMessages } from '../types';

// One flat option list carries two independent dimensions; the prefixes route a
// pick to the right mutation, and the sentinels drive the per-dimension clears.
const USER_PREFIX = 'user:';
const TEAM_PREFIX = 'team:';
const PEOPLE_HEADER = '__people_header__';
const TEAM_HEADER = '__team_header__';
const UNASSIGN_USER = '__unassign_user__';
const UNASSIGN_TEAM = '__unassign_team__';

interface ConversationAssigneePickerProps {
  conversation: ConversationWithMessages;
  organizationId: string;
}

/**
 * Header control for a conversation's assignment. One searchable picker with
 * two labelled sections and two INDEPENDENT dimensions — a **People** owner
 * (`assigneeUserId`) and a **Team** queue (`assigneeTeamId`); both can be set at
 * once (shared-inbox model: route to a team, a person claims it). Picking from
 * a section updates only that dimension; the footer clears each separately.
 * Admins get the picker; everyone else sees the current assignment read-only.
 * Both mutations are admin-only server-side too (`assignConversation` /
 * `assignConversationTeam`), so this only gates the affordance.
 */
export function ConversationAssigneePicker({
  conversation,
  organizationId,
}: ConversationAssigneePickerProps) {
  const { t } = useT('conversations');
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const isAdmin =
    !!memberContext &&
    'role' in memberContext &&
    (memberContext.role === 'admin' || memberContext.role === 'owner');
  const { members = [] } = useMembers(organizationId);
  const { teams = [] } = useOrgTeams();
  const { mutate: assignConversation } = useAssignConversation();
  const { mutate: assignConversationTeam } = useAssignConversationTeam();
  const [open, setOpen] = useState(false);

  const assigneeUserId = conversation.assigneeUserId ?? null;
  const assigneeTeamId = conversation.assigneeTeamId ?? null;
  const assignee = members.find((m) => m.userId === assigneeUserId);
  const assigneeName = assignee?.displayName ?? assignee?.email;
  const team = teams.find((tm) => tm.id === assigneeTeamId);
  const teamName = team?.name;

  // Trigger content for the assign control.
  //
  // Two independent dimensions (team queue + person claimer) can both be set —
  // shared-inbox model. Labels are desktop-only; mobile stays icon-only but
  // must still show BOTH dimensions when both are set (stacked pair), never
  // drop one. Icons stay size-5 / avatar `md` for a usable hit target with the
  // square trigger below.
  const bothAssigned = Boolean(assigneeTeamId && assigneeUserId);

  let chips: ReactNode;
  if (bothAssigned && assigneeUserId) {
    chips = (
      <>
        <span
          data-testid="assign-dual-stack"
          className="relative inline-flex size-7 items-center justify-center md:hidden"
          aria-hidden="true"
        >
          <Users className="text-muted-foreground absolute top-0.5 left-0 size-4" />
          <AssigneeAvatar
            assigneeType="user"
            assigneeId={assigneeUserId}
            name={assigneeName}
            size="sm"
            className="border-background relative ml-2.5 border-2"
          />
        </span>
        <span className="hidden items-center gap-2 md:flex">
          <span className="flex items-center gap-1.5">
            <Users className="text-muted-foreground size-5 shrink-0" />
            <span className="max-w-[8rem] truncate text-sm">
              {teamName ?? t('header.assignedTeam')}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <AssigneeAvatar
              assigneeType="user"
              assigneeId={assigneeUserId}
              name={assigneeName}
              size="md"
            />
            <span className="max-w-[8rem] truncate text-sm">
              {assigneeName ?? t('header.assignee')}
            </span>
          </span>
        </span>
      </>
    );
  } else if (assigneeTeamId) {
    chips = (
      <span className="flex items-center gap-1.5">
        <Users className="text-muted-foreground size-5 shrink-0" />
        <span className="hidden max-w-[8rem] truncate text-sm md:inline">
          {teamName ?? t('header.assignedTeam')}
        </span>
      </span>
    );
  } else if (assigneeUserId) {
    chips = (
      <span className="flex items-center gap-1.5">
        <AssigneeAvatar
          assigneeType="user"
          assigneeId={assigneeUserId}
          name={assigneeName}
          size="md"
        />
        <span className="hidden max-w-[8rem] truncate text-sm md:inline">
          {assigneeName ?? t('header.assignee')}
        </span>
      </span>
    );
  } else {
    chips = (
      <span className="flex items-center gap-1.5">
        <UserPlus className="text-muted-foreground size-5 shrink-0" />
        <span className="hidden text-sm md:inline">{t('header.assign')}</span>
      </span>
    );
  }

  // Compose a read-out of the current assignment for the trigger's aria-label.
  const parts: string[] = [];
  if (teamName) parts.push(t('header.assignedToTeam', { name: teamName }));
  if (assigneeName) parts.push(t('header.assignedTo', { name: assigneeName }));
  const assignedLabel =
    parts.length > 0 ? parts.join(' · ') : t('header.assign');

  // Non-admins: read-only. Show the current assignment; nothing when unset.
  if (!isAdmin) {
    if (!assigneeUserId && !assigneeTeamId) return null;
    return (
      <span
        className="text-muted-foreground flex items-center gap-2"
        aria-label={assignedLabel}
      >
        {chips}
      </span>
    );
  }

  // Only render a section when it has rows, so an empty org has no dangling
  // header. When both are empty the picker falls through to `emptyText`.
  const options: SearchableSelectOption[] = [];
  if (members.length > 0) {
    options.push({
      value: PEOPLE_HEADER,
      label: t('header.peopleSection'),
      isSectionHeader: true,
    });
    for (const member of members) {
      options.push({
        value: `${USER_PREFIX}${member.userId}`,
        label: member.displayName ?? member.email ?? member.userId,
      });
    }
  }
  if (teams.length > 0) {
    options.push({
      value: TEAM_HEADER,
      label: t('header.teamsSection'),
      isSectionHeader: true,
    });
    for (const tm of teams) {
      options.push({ value: `${TEAM_PREFIX}${tm.id}`, label: tm.name });
    }
  }

  function handleValueChange(value: string) {
    setOpen(false);
    const onError = {
      onError: () =>
        toast({ title: t('header.assignError'), variant: 'destructive' }),
    };
    const conversationId = conversation._id;

    if (value === UNASSIGN_USER) {
      if (!assigneeUserId) return;
      assignConversation(
        { conversationId, assigneeUserId: undefined },
        onError,
      );
      return;
    }
    if (value === UNASSIGN_TEAM) {
      if (!assigneeTeamId) return;
      assignConversationTeam(
        { conversationId, assigneeTeamId: undefined },
        onError,
      );
      return;
    }
    if (value.startsWith(USER_PREFIX)) {
      const next = value.slice(USER_PREFIX.length);
      if ((assigneeUserId ?? undefined) === next) return;
      assignConversation({ conversationId, assigneeUserId: next }, onError);
      return;
    }
    if (value.startsWith(TEAM_PREFIX)) {
      const next = value.slice(TEAM_PREFIX.length);
      if ((assigneeTeamId ?? undefined) === next) return;
      assignConversationTeam({ conversationId, assigneeTeamId: next }, onError);
    }
  }

  return (
    <SearchableSelect
      open={open}
      onOpenChange={setOpen}
      // Two dimensions can be selected at once, so there is no single controlled
      // value — the current pick in each section is marked via `optionAction`.
      value={null}
      onValueChange={handleValueChange}
      options={options}
      align="end"
      modal
      searchPlaceholder={t('header.assignSearchAll')}
      emptyText={t('header.noAssignees')}
      aria-label={t('header.assignee')}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          // Mobile is icon-only: use a square ≥32px hit target. Desktop grows
          // with the label (`md:w-auto md:px-3`).
          className="size-8 shrink-0 gap-2 p-0 md:h-8 md:w-auto md:px-3"
          aria-label={assignedLabel}
        >
          {chips}
        </Button>
      }
      optionAction={(opt) => {
        if (opt.value.startsWith(USER_PREFIX)) {
          const uid = opt.value.slice(USER_PREFIX.length);
          return (
            <span className="flex items-center gap-1.5">
              {assigneeUserId === uid && (
                <Check className="text-primary size-4 shrink-0" />
              )}
              <AssigneeAvatar
                assigneeType="user"
                assigneeId={uid}
                name={opt.label}
              />
            </span>
          );
        }
        if (opt.value.startsWith(TEAM_PREFIX)) {
          const tid = opt.value.slice(TEAM_PREFIX.length);
          return assigneeTeamId === tid ? (
            <Check className="text-primary size-4 shrink-0" />
          ) : null;
        }
        return null;
      }}
      footer={
        <div className="flex flex-col">
          {assigneeUserId && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => handleValueChange(UNASSIGN_USER)}
            >
              {t('header.unassign')}
            </Button>
          )}
          {assigneeTeamId && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => handleValueChange(UNASSIGN_TEAM)}
            >
              {t('header.unassignTeam')}
            </Button>
          )}
          <Link
            to="/dashboard/$id/settings/governance/policies-limits"
            params={{ id: organizationId }}
            hash="conversation-routing"
            className="hover:bg-muted flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-sm"
            onClick={() => setOpen(false)}
          >
            <Settings className="size-4 shrink-0" aria-hidden="true" />
            {t('header.autoAssignSettings')}
          </Link>
        </div>
      }
    />
  );
}
