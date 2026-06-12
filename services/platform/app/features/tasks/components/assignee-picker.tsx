'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { UserX } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

import { useActorDirectory } from '../hooks/use-actor-directory';
import type { TaskActorType } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';

/**
 * Assignee control built on the same {@link SearchableSelect} as the chat model
 * and agent selectors: the assignee avatar is the (icon-button) trigger, and a
 * searchable list offers the current user first (self-assign), then the other
 * members, then the project's agents, with an Unassign action in the footer.
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
    const sortedMembers = [...members].sort((a, b) =>
      a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0,
    );
    return [
      ...sortedMembers.map((m) => ({
        value: `user:${m.id}`,
        label: m.name,
        description:
          m.id === currentUserId ? t('assignee.assignToMe') : m.email,
        labelBadge:
          m.id === currentUserId ? (
            <Badge variant="outline" className="text-[10px]">
              {t('assignee.you')}
            </Badge>
          ) : undefined,
      })),
      ...agents.map((a) => ({
        value: `agent:${a.id}`,
        label: a.name,
        description: t('assignee.agents'),
      })),
    ];
  }, [members, agents, currentUserId, t]);

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
      // Stop the pointer/click from reaching the draggable card/row: dnd-kit's
      // listeners live on the parent, so without this a press starts a drag
      // (eating scroll/clicks in the popover) and the click opens the task.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {avatar}
    </Button>
  );

  return (
    <Tooltip content={label}>
      {/* React replays portal events through the React tree, so a click on a
          portaled option bubbles up to the card/row's onClick (opening the
          task). Stop pointer/click propagation here — the picker's whole
          subtree (trigger + portaled list) sits under this span in the React
          tree — so neither selecting an option nor dragging-to-scroll reaches
          the draggable parent. This span is a propagation boundary, not a
          control; the accessible controls (button + listbox) live inside it. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary, not an interactive control */}
      <span
        className="inline-flex"
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
          // The picker opens inside the (modal) task dialog: without a modal
          // popover the dialog's scroll lock eats wheel events over the list
          // and a long member+agent roster can't be scrolled.
          modal
          trigger={trigger}
          searchPlaceholder={t('assignee.search')}
          emptyText={tCommon('search.noResults')}
          aria-label={t('fields.assignee')}
          optionAction={(opt) => {
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
            assigneeId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                icon={UserX}
                onClick={() => {
                  onUnassign();
                  setOpen(false);
                }}
              >
                {t('assignee.unassign')}
              </Button>
            ) : undefined
          }
        />
      </span>
    </Tooltip>
  );
}
