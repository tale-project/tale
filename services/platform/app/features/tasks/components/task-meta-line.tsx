'use client';

/**
 * A task's one quiet line of context under its title — project · key ·
 * status (· archived) — the same on the task page's header and in the board
 * dialog's. The key is what people quote in a message or a commit, so one
 * click copies it.
 */

import { ThreadHeaderSeparator } from '@tale/ui/thread-header';
import { Tooltip } from '@tale/ui/tooltip';

import { useT } from '@/lib/i18n/client';

import type { TaskStatus } from '../lib/display';
import { TaskArchivedBadge } from './task-archived-badge';

export function TaskMetaLine({
  projectName,
  identifier,
  onCopyKey,
  status,
  isArchived,
  projectVisibility = 'always',
}: {
  projectName?: string;
  identifier?: string;
  onCopyKey: () => void;
  status: TaskStatus;
  isArchived: boolean;
  /**
   * `wide`: the project steps aside in a narrow thread header — a phone, or
   * a tablet's column beside the rail and the panel — where the key and the
   * status are what fit beside the actions. `always`: a dialog's header,
   * which has the room.
   */
  projectVisibility?: 'always' | 'wide';
}) {
  const { t } = useT('tasks');
  const wideOnly = projectVisibility === 'wide';
  return (
    <>
      {projectName !== undefined && (
        <span
          className={
            wideOnly
              ? 'hidden min-w-0 truncate @xl/thread-header:inline'
              : 'min-w-0 truncate'
          }
        >
          {projectName}
        </span>
      )}
      {identifier !== undefined && (
        <>
          {projectName !== undefined && (
            <span
              className={
                wideOnly ? 'hidden @xl/thread-header:contents' : 'contents'
              }
            >
              <ThreadHeaderSeparator />
            </span>
          )}
          <Tooltip
            content={t('detail.copyKey', { key: identifier })}
            side="bottom"
          >
            <button
              type="button"
              onClick={onCopyKey}
              aria-label={t('detail.copyKey', { key: identifier })}
              className="hover:text-foreground focus-visible:ring-ring -mx-0.5 shrink-0 cursor-copy rounded px-0.5 font-mono text-[11px] tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {identifier}
            </button>
          </Tooltip>
        </>
      )}
      <ThreadHeaderSeparator />
      <span className="shrink-0">{t(`status.${status}`)}</span>
      {isArchived && (
        <>
          <ThreadHeaderSeparator />
          <TaskArchivedBadge className="shrink-0 px-1.5 py-px text-[10px]" />
        </>
      )}
    </>
  );
}
