'use client';

/**
 * The composer's project control: which project the chat is filed in —
 * whose instructions and files its replies read, and whose agents may
 * answer in it.
 *
 * In a project chat it shows the project; elsewhere it reads **Project**.
 * Its menu is the same searchable list as **Move to project…**: before the
 * first message a pick only says where the chat will be created; in a chat
 * with messages it moves the chat, and a move that would end a project
 * share asks first (the caller's `onChange` decides both).
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { ChevronDown, FolderInput } from 'lucide-react';
import { useState } from 'react';

import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { useT } from '@/lib/i18n/client';

import { useChatProject } from '../data/chat-backend';
import { ThreadProjectPicker } from '../hooks/use-thread-menu-actions';

export function ComposerProjectPicker({
  organizationId,
  projectId,
  draft,
  onChange,
  disabled,
}: {
  organizationId: string;
  /** The project the chat is filed in, or will be created in. */
  projectId: string | undefined;
  /** No message yet: a pick only says where the chat will be created. */
  draft: boolean;
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useT('chat');
  const [open, setOpen] = useState(false);
  // The project is read by id, never every project (#5194).
  const read = useChatProject(organizationId, projectId);
  const project =
    read.status === 'ready' && read.data !== null ? read.data : undefined;
  const name = project?.name;
  // A project its read answered without — a stale link, one archived or
  // deleted since — is named as unavailable, not as a project.
  const unavailable =
    projectId !== undefined && read.status === 'ready' && read.data === null;
  const label =
    projectId === undefined
      ? t('projectPicker.none')
      : unavailable
        ? t('projectPicker.unavailable')
        : (name ?? t('projectPicker.unknown'));
  return (
    <DropdownMenu
      align="start"
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      tooltip={
        projectId === undefined
          ? t('projectPicker.tooltipNone')
          : t('projectPicker.tooltip', { name: label })
      }
      contentClassName="w-72 max-w-(--radix-dropdown-menu-content-available-width)"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            projectId === undefined
              ? t('projectPicker.ariaNone')
              : unavailable
                ? t('projectPicker.ariaUnavailable')
                : t('projectPicker.aria', { name: label })
          }
          aria-haspopup="menu"
          data-testid="composer-project-picker"
          className="max-w-44 min-w-0 shrink-0 gap-1.5 px-2"
        >
          {project !== undefined ? (
            <ProjectAvatar
              icon={project.icon}
              color={project.color}
              size={16}
              variant="plain"
            />
          ) : (
            <FolderInput aria-hidden className="size-4 shrink-0" />
          )}
          <span className="hidden min-w-0 truncate @lg/composer-toolbar:inline">
            {label}
          </span>
          {/* A narrow toolbar keeps the room for the names. */}
          <ChevronDown
            aria-hidden
            className="hidden size-3.5 shrink-0 @lg/composer-toolbar:block"
          />
        </Button>
      }
      items={[
        [
          {
            type: 'custom',
            content: (
              <ThreadProjectPicker
                t={t}
                organizationId={organizationId}
                currentProjectId={projectId}
                onMove={onChange}
                onPicked={() => setOpen(false)}
              />
            ),
          },
        ],
        [
          {
            type: 'label',
            content: (
              <span className="text-muted-foreground block max-w-64 text-xs leading-snug font-normal text-wrap">
                {t(draft ? 'projectPicker.hintDraft' : 'projectPicker.hint')}
              </span>
            ),
          },
        ],
      ]}
    />
  );
}
