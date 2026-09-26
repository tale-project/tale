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
import { PageLayout } from '@tale/ui/page-layout';
import { useNavigate } from '@tanstack/react-router';
import { KanbanSquare } from 'lucide-react';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';
import { useT } from '@/lib/i18n/client';

import { useTask } from '../hooks/queries';
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
  const { task, isLoading } = useTask(taskId);

  const openBoard = () => {
    if (task === null) return;
    void navigate({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: organizationId, projectId: task.projectId },
    });
  };

  // Deleted, never there, or out of reach: the platform's dead end with its
  // way out, not a blank column without a header or a back button.
  if (!isLoading && task === null) {
    return <DashboardNotFound organizationId={organizationId} />;
  }

  return (
    <PageLayout className="overflow-hidden">
      <div className="animate-in fade-in-0 flex min-h-0 flex-1 flex-col duration-200 motion-reduce:animate-none">
        <EditTaskBody
          key={taskId}
          taskId={taskId}
          surface="page"
          pageActions={
            <Button
              variant="ghost"
              size="sm"
              icon={KanbanSquare}
              onClick={openBoard}
              disabled={task === null}
              aria-label={t('detail.openBoard')}
              className="text-muted-foreground hover:text-foreground"
            >
              {/* Icon-only on a phone, where the header is tight. */}
              <span className="hidden sm:inline">{t('detail.openBoard')}</span>
            </Button>
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
      </div>
    </PageLayout>
  );
}
