'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Id } from '@/convex/_generated/dataModel';
import { EDITOR_ROLES } from '@/convex/projects/access';
import { useT } from '@/lib/i18n/client';

import { useAssignableActors } from '../hooks/use-actor-directory';
import { AssigneeAvatar } from './assignee-avatar';

/**
 * Reviewer control for the task modal's property panel: designates the human
 * the task's review gate waits on. A deliberate SIBLING of
 * {@link AssigneePicker}, not a mode of it — designation is soft (allowed
 * mid-run, no ownership transfer), so none of the assignee's handoff
 * machinery (transfer confirm, live-run cancel, agents/automations sections)
 * applies here. Candidates are the project's members holding an editor-level
 * org role — the same `EDITOR_ROLES` set the server enforces (Members can see
 * review cards but cannot respond).
 *
 * When `disabled` (no edit permission) it renders the bare avatar with no menu.
 */
export function ReviewerPicker({
  organizationId,
  projectId,
  reviewerUserId,
  onChange,
  disabled = false,
  align = 'start',
  afterTrigger,
}: {
  organizationId: string;
  projectId?: Id<'projects'>;
  reviewerUserId?: string;
  /** Called with the designated user id, or undefined to clear. */
  onChange: (reviewerUserId: string | undefined) => void;
  disabled?: boolean;
  align?: 'start' | 'center' | 'end';
  /** Renders beside the avatar trigger (e.g. reviewer name in the task modal). */
  afterTrigger?: ReactNode;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { assignableMembers, currentUserId, resolveActor } =
    useAssignableActors(organizationId, projectId);
  const [open, setOpen] = useState(false);

  const resolved =
    reviewerUserId !== undefined ? resolveActor('user', reviewerUserId) : null;
  const label = resolved?.name ?? t('reviewer.none');

  const options = useMemo<SearchableSelectOption[]>(() => {
    const eligible = assignableMembers.filter(
      (member) => member.role !== undefined && EDITOR_ROLES.has(member.role),
    );
    const sorted = [...eligible].sort((a, b) =>
      a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0,
    );
    return sorted.map((member) => ({
      value: member.id,
      label: member.name,
      description:
        member.id === currentUserId ? t('reviewer.assignToMe') : member.email,
      labelBadge:
        member.id === currentUserId ? (
          <Badge variant="outline" className="text-[10px]">
            {t('assignee.you')}
          </Badge>
        ) : undefined,
    }));
  }, [assignableMembers, currentUserId, t]);

  const reviewerIsCurrentUser =
    reviewerUserId !== undefined &&
    !!currentUserId &&
    reviewerUserId === currentUserId;

  const avatar = (
    <AssigneeAvatar
      assigneeType={reviewerUserId !== undefined ? 'user' : undefined}
      assigneeId={reviewerUserId}
      name={resolved?.name}
      isCurrentUser={reviewerIsCurrentUser}
    />
  );

  if (disabled) {
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <Tooltip content={label}>
          <span className="inline-flex">{avatar}</span>
        </Tooltip>
        {afterTrigger}
      </span>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('fields.reviewer')}
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
        className="inline-flex max-w-full min-w-0 items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <SearchableSelect
          value={reviewerUserId ?? null}
          onValueChange={(value) => {
            if (value !== reviewerUserId) onChange(value);
          }}
          options={options}
          open={open}
          onOpenChange={setOpen}
          align={align}
          modal
          trigger={trigger}
          searchPlaceholder={t('reviewer.search')}
          emptyText={tCommon('search.noResults')}
          aria-label={t('fields.reviewer')}
          optionAction={(opt) => (
            <AssigneeAvatar
              assigneeType="user"
              assigneeId={opt.value}
              name={opt.label}
              isCurrentUser={opt.value === currentUserId}
            />
          )}
          footer={
            <Stack gap={0}>
              <Text variant="muted" className="px-2 py-1 text-[11px] text-wrap">
                {t('reviewer.editorsOnly')}
              </Text>
              {reviewerUserId !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  icon={UserX}
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                >
                  {t('reviewer.clear')}
                </Button>
              )}
            </Stack>
          }
        />
        {afterTrigger}
      </span>
    </Tooltip>
  );
}
