'use client';

import type {
  ProjectTaskReviewer,
  TaskReviewer,
  TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { memo, useMemo, useState } from 'react';

import { EDITOR_ROLES } from '@/backend/core/projects/access';
import { useT } from '@/lib/i18n/client';

import {
  ActorDirectoryBoundary,
  useSharedActorDirectory,
  useSharedAssignableActors,
} from '../hooks/task-actor-directory';
import type { ActorDirectory } from '../hooks/use-actor-directory';
import { AssigneeAvatar } from './assignee-avatar';

interface ReviewerPickerProps {
  organizationId: string;
  projectId?: string;
  reviewer: TaskReviewer;
  projectReviewer: ProjectTaskReviewer;
  currentReviewer?: TaskReviewRecipient | null;
  hasPendingReview?: boolean;
  implementationAgentId?: string;
  onChange: (reviewer: TaskReviewer) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** A save keeps its trigger mounted and focusable, but cannot start another edit. */
  busy?: boolean;
  align?: 'start' | 'center' | 'end';
}

/** Who reviews, in words: the effective reviewer (an inherited agent
 *  default counts) and the label the trigger and its tooltip read. */
function describeReviewer(
  reviewer: TaskReviewer,
  projectReviewer: ProjectTaskReviewer,
  resolveActor: ActorDirectory['resolveActor'],
  t: ReturnType<typeof useT>['t'],
  currentReviewer?: TaskReviewRecipient | null,
) {
  const effective =
    currentReviewer ??
    (reviewer.kind === 'inherit'
      ? projectReviewer.kind === 'agent'
        ? projectReviewer
        : null
      : reviewer);
  const actorId =
    effective?.kind === 'user' ? effective.userId : effective?.agentId;
  const resolved =
    effective && actorId ? resolveActor(effective.kind, actorId) : null;
  const inheritLabel =
    projectReviewer.kind === 'agent'
      ? t('reviewer.projectDefault', {
          reviewer: resolveActor('agent', projectReviewer.agentId).name,
        })
      : t('reviewer.projectDefaultHuman');
  const label = resolved?.name ?? inheritLabel;
  return { effective, actorId, resolved, inheritLabel, label };
}

/** Reviewer routing is separate from implementation ownership. Selecting an
 * agent does not start a run or grant a tool; the caller transfers a pending
 * review only through its exact captured identity.
 *
 * Until its first use the picker is only its avatar and name: the list, with
 * its candidate reads (project access, the project, the standard agent), mounts
 * when it is first opened and stays mounted from then on — the same rule as
 * the assignee picker. The name comes from the directory an
 * `ActorDirectoryProvider` provides (the task's) or, without one, the picker's
 * own. */
export const ReviewerPicker = memo(function ReviewerPicker(
  props: ReviewerPickerProps,
) {
  return (
    <ActorDirectoryBoundary
      organizationId={props.organizationId}
      projectId={props.projectId}
    >
      <ReviewerPickerTrigger {...props} />
    </ActorDirectoryBoundary>
  );
});

/** The avatar and name a closed picker shows, until its first use mounts
 *  the list. */
function ReviewerPickerTrigger(props: ReviewerPickerProps) {
  const { t } = useT('tasks');
  const directory = useSharedActorDirectory(
    props.organizationId,
    props.projectId,
  );
  const [engaged, setEngaged] = useState(false);
  if (engaged) {
    return (
      <ActorDirectoryBoundary
        organizationId={props.organizationId}
        projectId={props.projectId}
        assignable
      >
        <ReviewerPickerList {...props} defaultOpen />
      </ActorDirectoryBoundary>
    );
  }

  const {
    reviewer,
    projectReviewer,
    onOpenChange,
    disabled = false,
    busy = false,
  } = props;
  const { effective, actorId, resolved, label } = describeReviewer(
    reviewer,
    projectReviewer,
    directory.resolveActor,
    t,
    props.currentReviewer,
  );
  const avatar = (
    <AssigneeAvatar
      assigneeType={effective?.kind}
      assigneeId={actorId}
      name={resolved?.name}
      isCurrentUser={
        effective?.kind === 'user' && actorId === directory.currentUserId
      }
    />
  );
  const name = <span className="min-w-0 text-sm break-words">{label}</span>;

  if (disabled) {
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <Tooltip content={label}>
          <span className="inline-flex">{avatar}</span>
        </Tooltip>
        {name}
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <Tooltip content={label}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('fields.reviewer')}
          // What the list's popover trigger says while it is shut.
          aria-haspopup="dialog"
          aria-expanded={false}
          data-state="closed"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          className="h-auto max-w-full min-w-0 gap-1.5 p-1 text-left whitespace-normal"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (busy) {
              event.preventDefault();
              return;
            }
            // The list mounts already open, so no open transition reaches
            // the caller from it: say it here, before the list exists.
            onOpenChange?.(true);
            setEngaged(true);
          }}
        >
          {avatar}
          {name}
        </Button>
      </Tooltip>
    </span>
  );
}

/** The picker in use: its list and candidate reads. */
function ReviewerPickerList({
  organizationId,
  projectId,
  reviewer,
  projectReviewer,
  currentReviewer,
  hasPendingReview = false,
  implementationAgentId,
  onChange,
  onOpenChange,
  disabled = false,
  busy = false,
  align = 'start',
  defaultOpen = false,
}: ReviewerPickerProps & {
  /** Mounted by a click on the closed picker: open the list at once. */
  defaultOpen?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const {
    assignableMembers,
    assignableAgents,
    currentUserId,
    resolveActor,
    scopeReady,
    agentsLoading,
  } = useSharedAssignableActors(organizationId, projectId);
  const [open, setOpen] = useState(defaultOpen);
  const { effective, actorId, resolved, inheritLabel, label } =
    describeReviewer(
      reviewer,
      projectReviewer,
      resolveActor,
      t,
      currentReviewer,
    );

  const { options, choices } = useMemo(() => {
    const choiceMap = new Map<string, TaskReviewer>([
      ['inherit', { kind: 'inherit' }],
    ]);
    // An agent the server would refuse — the implementation agent, or one
    // without the `task_review` grant (`agentReviewerEligibility`) — stays
    // listed but greyed, with the reason as its description; the same rule
    // judges the project default the inherited choice resolves to.
    const refusal = (agentId: string): string | undefined => {
      if (agentId === implementationAgentId)
        return t('reviewer.independentAgent');
      const agent = assignableAgents.find(
        (candidate) => candidate.id === agentId,
      );
      return agent !== undefined && !agent.tools?.includes('task_review')
        ? t('reviewer.agentPermissionRequired')
        : undefined;
    };
    const inheritRefusal =
      projectReviewer.kind === 'agent'
        ? refusal(projectReviewer.agentId)
        : undefined;
    const selectOptions: SearchableSelectOption[] = [
      {
        value: 'inherit',
        label: inheritLabel,
        group: 'default',
        disabled: inheritRefusal !== undefined,
        description: inheritRefusal,
      },
    ];
    if (scopeReady) {
      const eligible = assignableMembers.filter(
        (member) => member.role !== undefined && EDITOR_ROLES.has(member.role),
      );
      const sorted = [...eligible].sort((a, b) =>
        a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0,
      );
      for (const member of sorted) {
        const value = 'user:' + member.id;
        choiceMap.set(value, { kind: 'user', userId: member.id });
        selectOptions.push({
          value,
          label: member.name,
          group: 'people',
          description:
            member.id === currentUserId
              ? t('reviewer.assignToMe')
              : member.email,
          labelBadge:
            member.id === currentUserId ? (
              <Badge variant="outline" className="text-[10px]">
                {t('assignee.you')}
              </Badge>
            ) : undefined,
        });
      }
    }
    if (scopeReady && !agentsLoading) {
      for (const agent of assignableAgents) {
        const value = 'agent:' + agent.id;
        choiceMap.set(value, { kind: 'agent', agentId: agent.id });
        const agentRefusal = refusal(agent.id);
        selectOptions.push({
          value,
          label: agent.name,
          group: 'agents',
          disabled: agentRefusal !== undefined,
          description: agentRefusal ?? t('reviewer.agentReview'),
        });
      }
    }
    return { options: selectOptions, choices: choiceMap };
  }, [
    scopeReady,
    assignableMembers,
    assignableAgents,
    agentsLoading,
    currentUserId,
    implementationAgentId,
    projectReviewer,
    inheritLabel,
    t,
  ]);

  const value =
    reviewer.kind === 'inherit'
      ? 'inherit'
      : reviewer.kind === 'user'
        ? 'user:' + reviewer.userId
        : 'agent:' + reviewer.agentId;
  const avatar = (
    <AssigneeAvatar
      assigneeType={effective?.kind}
      assigneeId={actorId}
      name={resolved?.name}
      isCurrentUser={effective?.kind === 'user' && actorId === currentUserId}
    />
  );
  const name = <span className="min-w-0 text-sm break-words">{label}</span>;

  if (disabled) {
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <Tooltip content={label}>
          <span className="inline-flex">{avatar}</span>
        </Tooltip>
        {name}
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <SearchableSelect
        value={value}
        onValueChange={(next) => {
          if (busy) return;
          const choice = choices.get(next);
          if (choice !== undefined) onChange(choice);
        }}
        options={options}
        open={open}
        onOpenChange={(next) => {
          if (busy && next) return;
          onOpenChange?.(next);
          setOpen(next);
        }}
        align={align}
        modal
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('fields.reviewer')}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            className="h-auto max-w-full min-w-0 gap-1.5 p-1 text-left whitespace-normal"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (busy) event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (busy && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {avatar}
            {name}
          </Button>
        }
        tooltip={label}
        searchPlaceholder={t('reviewer.search')}
        emptyText={
          scopeReady && !agentsLoading
            ? tCommon('search.noResults')
            : tCommon('actions.loading')
        }
        aria-label={t('fields.reviewer')}
        optionAction={(option) => {
          const choice = choices.get(option.value);
          if (!choice || choice.kind === 'inherit') return null;
          return (
            <AssigneeAvatar
              assigneeType={choice.kind}
              assigneeId={
                choice.kind === 'user' ? choice.userId : choice.agentId
              }
              name={option.label}
              isCurrentUser={
                choice.kind === 'user' && choice.userId === currentUserId
              }
            />
          );
        }}
        footer={
          <div className="px-2 py-1">
            {(!scopeReady || agentsLoading) && (
              <Text variant="caption">{tCommon('actions.loading')}</Text>
            )}
            {reviewer.kind === 'inherit' && (
              <Text variant="caption">{inheritLabel}</Text>
            )}
            {hasPendingReview && (
              <Text variant="caption">{t('reviewer.transferHint')}</Text>
            )}
            <Text variant="caption">{t('reviewer.routingHint')}</Text>
          </div>
        }
      />
    </span>
  );
}
