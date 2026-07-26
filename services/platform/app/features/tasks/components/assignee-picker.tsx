'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Info, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAssignableActors } from '../hooks/use-actor-directory';
import { looksLikeCodeTask } from '../lib/agent-display';
import type { TaskActorType } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';

/**
 * Assignee control built on the same {@link SearchableSelect} as the chat model
 * and agent selectors: the assignee avatar is the (icon-button) trigger, and a
 * searchable list offers the current user first (self-assign), then the other
 * members, then platform Agents and External agents (image agents excluded), with
 * an Unassign action in the footer.
 *
 * When `disabled` (no edit permission) it renders the bare avatar with no menu.
 */
export function AssigneePicker({
  organizationId,
  projectId,
  assigneeType,
  assigneeId,
  onAssign,
  onUnassign,
  size = 'sm',
  align = 'start',
  disabled = false,
  taskTitle,
  taskDescription,
  taskLabels,
  afterTrigger,
}: {
  organizationId: string;
  projectId?: Id<'projects'>;
  assigneeType?: TaskActorType;
  assigneeId?: string;
  onAssign: (type: TaskActorType, id: string) => void;
  onUnassign: () => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  /** When set, enables the third-party-agent / non-code-task guidance under
   * the trigger. */
  taskTitle?: string;
  taskDescription?: string;
  taskLabels?: string[];
  /** Renders beside the avatar trigger (e.g. assignee name in the task modal). */
  afterTrigger?: ReactNode;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const {
    assignableMembers,
    assignableAgents,
    agents,
    currentUserId,
    resolveActor,
  } = useAssignableActors(organizationId, projectId);
  const [open, setOpen] = useState(false);

  const resolved =
    assigneeType && assigneeId ? resolveActor(assigneeType, assigneeId) : null;

  const assignedAgent =
    assigneeType === 'agent' && assigneeId
      ? agents.find((a) => a.id === assigneeId)
      : undefined;

  // Only when the caller supplied task context (modal) — compact board/list
  // pickers omit these props and must stay a single avatar control.
  const hasTaskContext =
    taskTitle !== undefined ||
    taskDescription !== undefined ||
    taskLabels !== undefined;
  const showNonCodeWarning =
    hasTaskContext &&
    assignedAgent?.displayCategory === 'coding-agent' &&
    !looksLikeCodeTask({
      title: taskTitle,
      description: taskDescription,
      labels: taskLabels,
    });

  const sectionInfoButton = useCallback(
    (content: string): ReactNode => (
      <Tooltip content={content} side="right">
        <button
          type="button"
          aria-label={tCommon('aria.moreInfo')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex rounded align-middle focus-visible:ring-1 focus-visible:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    ),
    [tCommon],
  );

  const label = resolved?.name ?? t('assignee.unassigned');

  const avatar = (
    <AssigneeAvatar
      assigneeType={assigneeType}
      assigneeId={assigneeId}
      name={resolved?.name}
      size={size}
    />
  );

  const options = useMemo<SearchableSelectOption[]>(() => {
    const sortedMembers = [...assignableMembers].sort((a, b) =>
      a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0,
    );
    const memberOptions: SearchableSelectOption[] = sortedMembers.map((m) => ({
      value: `user:${m.id}`,
      label: m.name,
      description: m.id === currentUserId ? t('assignee.assignToMe') : m.email,
      labelBadge:
        m.id === currentUserId ? (
          <Badge variant="outline" className="text-[10px]">
            {t('assignee.you')}
          </Badge>
        ) : undefined,
    }));

    const agentOption = (
      agent: (typeof agents)[number],
    ): SearchableSelectOption => ({
      value: `agent:${agent.id}`,
      label: agent.name,
    });

    // One plain "Agents" section — the entries are the project's own created
    // agents, not a third-party roster, so no platform/external split.
    const agentSections: SearchableSelectOption[] = [];
    if (assignableAgents.length > 0) {
      agentSections.push({
        value: '__section:agents',
        label: t('assignee.agents'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(t('assignee.agentsInfo')),
      });
      agentSections.push(...assignableAgents.map(agentOption));
    }

    return [...memberOptions, ...agentSections];
  }, [
    assignableMembers,
    assignableAgents,
    currentUserId,
    t,
    sectionInfoButton,
  ]);

  if (disabled) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Tooltip content={label}>
          <span className="inline-flex">{avatar}</span>
        </Tooltip>
        {afterTrigger}
      </span>
    );
  }

  const value =
    assigneeType && assigneeId ? `${assigneeType}:${assigneeId}` : null;

  const handleSelect = (val: string) => {
    if (val.startsWith('__section:')) return;
    const isAgent = val.startsWith('agent:');
    const id = val.slice(val.indexOf(':') + 1);
    onAssign(isAgent ? 'agent' : 'user', id);
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('actions.assign')}
      className="h-auto w-auto rounded-full p-1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {avatar}
    </Button>
  );

  const select = (
    <SearchableSelect
      value={value}
      onValueChange={handleSelect}
      options={options}
      open={open}
      onOpenChange={setOpen}
      align={align}
      modal
      trigger={trigger}
      searchPlaceholder={t('assignee.search')}
      emptyText={tCommon('search.noResults')}
      aria-label={t('fields.assignee')}
      optionAction={(opt) => {
        if (opt.isSectionHeader) return null;
        const isAgent = opt.value.startsWith('agent:');
        const id = opt.value.slice(opt.value.indexOf(':') + 1);
        return (
          <AssigneeAvatar
            assigneeType={isAgent ? 'agent' : 'user'}
            assigneeId={id}
            name={opt.label}
          />
        );
      }}
      footer={
        <Stack gap={0}>
          {/* #2610: only installed + enabled agents ever reach this list
              — a connected integration alone does not make its bundled
              agents assignable, so a familiar name (e.g. an
              integration's own agent) can be legitimately absent, up to
              and including the whole Agents section. Always shown (not
              gated on the section being non-empty) so that exact "why
              can't I find it" case still gets an answer. */}
          <Text variant="muted" className="px-2 py-1 text-[11px] text-wrap">
            {t('assignee.liveAgentsOnly')}
          </Text>
          {assigneeId && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              icon={UserX}
              onClick={() => {
                onUnassign();
                setOpen(false);
              }}
            >
              {t('assignee.unassign')}
            </Button>
          )}
        </Stack>
      }
    />
  );

  const triggerRow = (
    <Tooltip content={label}>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary */}
      <span
        className="inline-flex min-w-0 items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {select}
        {afterTrigger}
      </span>
    </Tooltip>
  );

  if (!showNonCodeWarning) {
    return triggerRow;
  }

  // Full-width under the avatar row — never beside it. The task-modal side
  // panel is a constrained flex column that shrinks PropertyField rows to
  // min-h-7; a tall warning inlined next to the avatar overflowed and
  // painted over Status/Priority/Due date.
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary
    <span
      className="flex w-full min-w-0 flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {triggerRow}
      <Text variant="muted" className="text-xs text-pretty">
        {t('assignee.nonCodeWarning')}
      </Text>
    </span>
  );
}
