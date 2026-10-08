'use client';

/**
 * The task's own actions in the board dialog's top-right cluster, beside
 * Close: **Copy link** and **Open as page**. Both name the task's page
 * (`/dashboard/{org}/tasks/{taskId}`) — the address a teammate opens, and the
 * conversation view this dialog maximizes into. The page shows the same
 * Copy link in its header.
 */

import { IconButton } from '@tale/ui/icon-button';
import { Tooltip } from '@tale/ui/tooltip';
import { useCopy } from '@tale/ui/use-copy';
import { toast } from '@tale/ui/use-toast';
import { Link, useRouter } from '@tanstack/react-router';
import { Link2, Maximize2 } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useTask } from '../hooks/queries';

/** Copy the task page's address. */
export function TaskCopyLinkButton({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}) {
  const { t } = useT('tasks');
  const router = useRouter();
  const { copy } = useCopy();
  const copyLink = () => {
    // The page's own address, without any board state in its query, so the
    // link a teammate opens lands on this task wherever it was copied from.
    const href =
      router.buildLocation({
        to: '/dashboard/$id/tasks/$taskId',
        params: { id: organizationId, taskId },
      }).href ?? '';
    void copy(`${window.location.origin}${href}`).then((copied) => {
      if (copied) toast({ title: t('detail.linkCopied') });
    });
  };
  return (
    <Tooltip content={t('detail.copyLink')} side="bottom">
      <IconButton
        icon={Link2}
        size="sm"
        variant="ghost"
        onClick={copyLink}
        aria-label={t('detail.copyLink')}
        className="text-muted-foreground hover:text-foreground"
      />
    </Tooltip>
  );
}

/** Leave the dialog for the task's page — a real link, so a modifier or
 * middle click opens it in a new tab and Back returns to the board with the
 * dialog open. */
export function TaskOpenPageButton({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}) {
  const { t } = useT('tasks');
  return (
    <Tooltip content={t('detail.openPage')} side="bottom">
      <IconButton
        asChild
        slotChild={
          <Link
            to="/dashboard/$id/tasks/$taskId"
            params={{ id: organizationId, taskId }}
          />
        }
        icon={Maximize2}
        size="sm"
        variant="ghost"
        aria-label={t('detail.openPage')}
        className="text-muted-foreground hover:text-foreground"
      />
    </Tooltip>
  );
}

/**
 * The board dialog's header actions for the task it shows. Rendered only
 * while a task is open, and gone for a task that does not exist (any more):
 * a missing task has no page to open or link to.
 */
export function TaskDialogHeaderActions({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}) {
  const { task, isLoading } = useTask(taskId);
  if (!isLoading && task === null) return null;
  return (
    <>
      <TaskCopyLinkButton organizationId={organizationId} taskId={taskId} />
      <TaskOpenPageButton organizationId={organizationId} taskId={taskId} />
    </>
  );
}
