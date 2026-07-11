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
import { useT } from '@/lib/i18n/client';
import { looksLikeCodeTask } from '@/lib/shared/agents/display-category';

import { useActorDirectory } from '../hooks/use-actor-directory';
import type { TaskActorType } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';

/**
 * Assignee control built on the same {@link SearchableSelect} as the chat model
 * and agent selectors: the assignee avatar is the (icon-button) trigger, and a
 * searchable list offers the current user first (self-assign), then the other
 * members, then platform Agents and Coding agents (image agents excluded), with
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
}: {
  organizationId: string;
  projectId?: string;
  assigneeType?: TaskActorType;
  assigneeId?: string;
  onAssign: (type: TaskActorType, id: string) => void;
  onUnassign: () => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  taskTitle?: string;
  taskDescription?: string;
  taskLabels?: string[];
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { members, agents, currentUserId, resolveActor } = useActorDirectory(
    organizationId,
    projectId,
  );
  const [open, setOpen] = useState(false);

  const resolved =
    assigneeType && assigneeId ? resolveActor(assigneeType, assigneeId) : null;

  const assignedAgent =
    assigneeType === 'agent' && assigneeId
      ? agents.find((a) => a.id === assigneeId)
      : undefined;

  const showNonCodeWarning =
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

  const platformAgents = useMemo(
    () => agents.filter((a) => a.displayCategory === 'agent'),
    [agents],
  );
  const codingAgents = useMemo(
    () => agents.filter((a) => a.displayCategory === 'coding-agent'),
    [agents],
  );

  const options = useMemo<SearchableSelectOption[]>(() => {
    const sortedMembers = [...members].sort((a, b) =>
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

    const agentSections: SearchableSelectOption[] = [];
    if (platformAgents.length > 0) {
      agentSections.push({
        value: '__section:agents',
        label: t('assignee.agents'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(
          t('assignee.dispatchHints.agentPlatform'),
        ),
      });
      agentSections.push(...platformAgents.map(agentOption));
    }
    if (codingAgents.length > 0) {
      agentSections.push({
        value: '__section:coding-agents',
        label: t('assignee.codingAgents'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(t('assignee.codingAgentsInfo')),
      });
      agentSections.push(...codingAgents.map(agentOption));
    }

    return [...memberOptions, ...agentSections];
  }, [
    members,
    platformAgents,
    codingAgents,
    currentUserId,
    t,
    sectionInfoButton,
  ]);

  if (disabled) {
    return (
      <Tooltip content={label}>
        <span className="inline-flex">{avatar}</span>
      </Tooltip>
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

  return (
    <Tooltip content={label}>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary */}
      <span
        className="inline-flex flex-col items-end gap-1"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
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
        {showNonCodeWarning && (
          <Text variant="muted" className="max-w-56 text-right text-xs">
            {t('assignee.nonCodeWarning')}
          </Text>
        )}
      </span>
    </Tooltip>
  );
}
