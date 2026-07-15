'use client';

import { Button } from '@tale/ui/button';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { AssigneeAvatar } from '@/app/features/tasks/components/assignee-avatar';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useAssignConversation } from '../hooks/mutations';
import type { ConversationWithMessages } from '../types';

const UNASSIGN_VALUE = '__unassign__';

interface ConversationAssigneePickerProps {
  conversation: ConversationWithMessages;
  organizationId: string;
}

/**
 * Header control for a conversation's assignee. Admins get a searchable member
 * picker (with an Unassign action); everyone else sees the current assignee
 * read-only. Assignment is admin-only server-side too (`assignConversation`),
 * so this only gates the affordance.
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
  const { mutate: assignConversation } = useAssignConversation();
  const [open, setOpen] = useState(false);

  const assigneeUserId = conversation.assigneeUserId ?? null;
  const assignee = members.find((m) => m.userId === assigneeUserId);
  const assigneeName = assignee?.displayName ?? assignee?.email;

  const avatar = assigneeUserId ? (
    <AssigneeAvatar
      assigneeType="user"
      assigneeId={assigneeUserId}
      name={assigneeName}
      size="sm"
    />
  ) : (
    <UserPlus className="text-muted-foreground size-4 shrink-0" />
  );

  // Show the assignee's name (or "Assign") beside the avatar — a legible
  // control, not a bare icon.
  const triggerText = assigneeUserId
    ? (assigneeName ?? t('header.assignee'))
    : t('header.assign');
  const assignedLabel = assigneeName
    ? t('header.assignedTo', { name: assigneeName })
    : t('header.assignee');
  const chip = (
    <>
      {avatar}
      <span className="max-w-[10rem] truncate text-sm">{triggerText}</span>
    </>
  );

  // Non-admins: read-only. Show who's assigned; render nothing when unassigned.
  if (!isAdmin) {
    if (!assigneeUserId) return null;
    return (
      <span
        className="text-muted-foreground flex items-center gap-1.5"
        aria-label={assignedLabel}
      >
        {chip}
      </span>
    );
  }

  const options: SearchableSelectOption[] = members.map((member) => ({
    value: member.userId,
    label: member.displayName ?? member.email ?? member.userId,
  }));

  function handleValueChange(value: string) {
    setOpen(false);
    const nextAssignee = value === UNASSIGN_VALUE ? undefined : value;
    if ((assigneeUserId ?? undefined) === nextAssignee) return;
    assignConversation(
      {
        conversationId: toId<'conversations'>(conversation._id),
        assigneeUserId: nextAssignee,
      },
      {
        onError: () =>
          toast({ title: t('header.assignError'), variant: 'destructive' }),
      },
    );
  }

  return (
    <SearchableSelect
      open={open}
      onOpenChange={setOpen}
      value={assigneeUserId}
      onValueChange={handleValueChange}
      options={options}
      align="end"
      modal
      searchPlaceholder={t('header.assignSearch')}
      emptyText={t('header.noMembers')}
      aria-label={t('header.assignee')}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label={assigneeUserId ? assignedLabel : t('header.assign')}
        >
          {chip}
        </Button>
      }
      optionAction={(opt) => (
        <AssigneeAvatar
          assigneeType="user"
          assigneeId={opt.value}
          name={opt.label}
        />
      )}
      footer={
        assigneeUserId ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => handleValueChange(UNASSIGN_VALUE)}
          >
            {t('header.unassign')}
          </Button>
        ) : undefined
      }
    />
  );
}
