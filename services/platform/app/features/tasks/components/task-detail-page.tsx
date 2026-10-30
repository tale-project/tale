'use client';

/**
 * A task as a page of its own — how Home opens a task, the same way it opens
 * a chat or a customer conversation: in the main column, beside the Home
 * panel, in the thread frame every conversation uses. The task's brief leads,
 * its discussion and history follow as one conversation, the composer sits
 * at the foot, and the structure (status, owner, dates…) waits in the side
 * panel. The board dialog renders the same body, so a task edits identically
 * wherever it opens.
 */

import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import { useNavigate } from '@tanstack/react-router';
import { KanbanSquare } from 'lucide-react';
import { useCallback } from 'react';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { useT } from '@/lib/i18n/client';
import { documentTitle } from '@/lib/utils/seo';

import { useTask } from '../hooks/queries';
import { TaskDetailFallback } from './task-detail-fallback';
import { TaskCopyLinkButton } from './task-header-actions';
import { EditTaskBody } from './task-modal';

export function TaskDetailPage({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}) {
  const { t } = useT('tasks');
  const navigate = useNavigate();
  const { task, notFound, error, retrying, retry } = useTask(taskId);
  // The next task opening in place fades in, as another chat does.
  const swapRef = useSwapFade<HTMLDivElement>(taskId);
  // Where a retry that worked hands the focus: the task it brought back.
  const focusPage = useCallback(() => swapRef.current?.focus(), [swapRef]);
  // The tab names the task, so several open tasks stay apart in the browser.
  useDocumentTitle(
    task !== null ? documentTitle('task', task.title) : undefined,
  );
  const openBoard = () => {
    if (task === null) return;
    void navigate({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: organizationId, projectId: task.projectId },
    });
  };

  // Deleted, never there, or out of reach: the platform's dead end with its
  // way out, not a blank column without a header or a back button. A read
  // that failed is none of these (#4587).
  if (task === null && notFound) {
    return <DashboardNotFound organizationId={organizationId} />;
  }

  return (
    <PageLayout className="overflow-hidden">
      <div
        ref={swapRef}
        role="region"
        aria-label={task?.title ?? t('title')}
        tabIndex={-1}
        className="animate-in fade-in-0 flex min-h-0 flex-1 flex-col duration-200 outline-none motion-reduce:animate-none"
      >
        {task === null && error != null ? (
          // The task may well be there: say the read failed, where the task
          // would stand, and offer to read it again.
          <ContentArea variant="narrow" className="py-6">
            <TaskDetailFallback
              surface="page"
              state="error"
              error={error}
              retrying={retrying}
              onRetry={retry}
              onFocusLost={focusPage}
            />
          </ContentArea>
        ) : (
          <EditTaskBody
            key={taskId}
            taskId={taskId}
            organizationId={organizationId}
            surface="page"
            pageActions={
              <>
                <TaskCopyLinkButton
                  organizationId={organizationId}
                  taskId={taskId}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={KanbanSquare}
                  onClick={openBoard}
                  disabled={task === null}
                  aria-label={t('detail.openBoard')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {/* Icon-only where the header is tight — a phone, or a
                    tablet's column beside the rail and the panel. */}
                  <span className="hidden @xl/thread-header:inline">
                    {t('detail.openBoard')}
                  </span>
                </Button>
              </>
            }
            onOpenTask={(nextTaskId) =>
              void navigate({
                to: '/dashboard/$id/tasks/$taskId',
                params: { id: organizationId, taskId: nextTaskId },
              })
            }
            onClose={openBoard}
            showProjectLink
          />
        )}
      </div>
    </PageLayout>
  );
}
