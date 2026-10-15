'use client';

/**
 * The project's Dispatch tab: what its dispatch does — every agent of its
 * pool with the runs it holds or why it is idle, its standing roles, the
 * other boards it serves and its reviewers, gates, the models and agent
 * workers it waits on, and its recent passes — and which other projects'
 * dispatches serve this board, for anyone who reads the project. Who may administer the project sets it up,
 * edits it, asks for a pass and holds or opens its gates. A read that failed
 * is named with Try again, never shown as a project without a dispatch; a
 * dispatch a newer version of Tale saved is named as such and offered for
 * no change.
 */

import type { ProjectDispatchStatus } from '@tale/shared/schemas/project-dispatch';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { Pencil, Play, Plus, Waypoints } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useProjectDispatch, useRequestDispatchPass } from '../hooks/dispatch';
import { useProject, useProjectAgents } from '../hooks/queries';
import { ProjectDispatchEditor } from './project-dispatch-editor';
import {
  ProjectDispatchOverview,
  SOURCE_SKIPPED_KEYS,
} from './project-dispatch-overview';
import { ProjectReadOnlyBanner } from './project-read-only-banner';
import {
  ProjectDispatchFrame,
  ProjectDispatchSkeleton,
} from './project-tab-skeletons';

interface ProjectDispatchTabProps {
  organizationId: string;
  projectId: string;
}

export function ProjectDispatchTab({
  organizationId,
  projectId,
}: ProjectDispatchTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { status, unavailable, stale, retrying, failureCount, retry } =
    useProjectDispatch(organizationId, projectId);
  const { agents } = useProjectAgents(projectId);
  const { mutateAsync: requestPass, isPending: passPending } =
    useRequestDispatchPass(organizationId, projectId);
  const [editorOpen, setEditorOpen] = useState(false);
  // Where the focus goes when the failure notice holding it leaves: a read
  // that answered on Try again put the page in its place.
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusBody = useCallback(() => bodyRef.current?.focus(), []);

  // An archived project is read-only for everyone: the backend refuses its
  // writes, so the page offers none.
  const isArchived = project?.archivedAt !== undefined;
  const canEdit = status?.canEdit === true && !isArchived;
  const config =
    status !== undefined && !status.unreadable ? status.config : null;

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent._id, agent.name])),
    [agents],
  );
  const taskTitles = useMemo(
    () =>
      new Map(
        (status?.standingRoles ?? []).flatMap((role): [string, string][] =>
          role.taskTitle === null ? [] : [[role.taskId, role.taskTitle]],
        ),
      ),
    [status?.standingRoles],
  );

  const runPass = () => {
    requestPass().then(
      () => {
        toast({
          title: t('dispatch.passRequested'),
          description: t('dispatch.passRequestedBody'),
          variant: 'success',
        });
      },
      (error: unknown) => {
        console.error('[dispatch] pass request failed', error);
        toast({
          title: t('dispatch.passFailed'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      },
    );
  };

  if (status === undefined && !unavailable) return <ProjectDispatchSkeleton />;

  const actions =
    canEdit && config !== null ? (
      <Row gap={2} wrap className="justify-end">
        <Button
          variant="secondary"
          size="sm"
          icon={Play}
          isLoading={passPending}
          onClick={runPass}
        >
          {t('dispatch.runPass')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Pencil}
          onClick={() => setEditorOpen(true)}
        >
          {t('dispatch.edit')}
        </Button>
      </Row>
    ) : undefined;

  return (
    <ProjectDispatchFrame action={actions} reader={!canEdit}>
      {isArchived ? <ProjectReadOnlyBanner reason="archived" /> : null}
      <div
        ref={bodyRef}
        role="group"
        aria-label={t('dispatch.title')}
        tabIndex={-1}
        className="flex flex-col gap-6 outline-none"
      >
        {unavailable || stale ? (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node.
            failureKey={failureCount}
            onFocusLost={focusBody}
            message={t(
              unavailable ? 'dispatch.loadFailed' : 'dispatch.refreshFailed',
            )}
            onRetry={retry}
            isRetrying={retrying}
          />
        ) : null}
        {status !== undefined && status.servedBy.length > 0 ? (
          <DispatchServedBy
            organizationId={organizationId}
            servedBy={status.servedBy}
          />
        ) : null}
        {status === undefined ? null : status.unreadable ? (
          <Alert
            variant="warning"
            live="off"
            title={t('dispatch.unreadable.title')}
            description={t('dispatch.unreadable.body')}
          />
        ) : config === null ? (
          <EmptyState
            icon={Waypoints}
            title={t('dispatch.notSetUp.title')}
            description={t(
              canEdit
                ? 'dispatch.notSetUp.body'
                : 'dispatch.notSetUp.readerBody',
            )}
            action={
              canEdit ? (
                <Button icon={Plus} onClick={() => setEditorOpen(true)}>
                  {t('dispatch.notSetUp.action')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ProjectDispatchOverview
            organizationId={organizationId}
            projectId={projectId}
            status={status}
            config={config}
            canEdit={canEdit}
            projectKey={project?.key}
            agentNames={agentNames}
          />
        )}
      </div>
      {canEdit && status !== undefined && !status.unreadable ? (
        <ProjectDispatchEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          organizationId={organizationId}
          projectId={projectId}
          projectKey={project?.key}
          workersLimit={status.workers.limit}
          taskTitles={taskTitles}
          settingUp={config === null}
        />
      ) : null}
    </ProjectDispatchFrame>
  );
}

/** The dispatches of other projects that serve this board: their agents
 * may be assigned to, started on and work its ready tasks while they reach
 * it. Each names its project, and says when it is switched off or skips
 * this board, and why. */
function DispatchServedBy({
  organizationId,
  servedBy,
}: {
  organizationId: string;
  servedBy: ProjectDispatchStatus['servedBy'];
}) {
  const { t } = useT('projects');
  return (
    <Alert
      variant="info"
      icon={Waypoints}
      live="off"
      title={t('dispatch.servedBy.title', { count: servedBy.length })}
      description={
        <Stack gap={1}>
          <p>{t('dispatch.servedBy.body')}</p>
          <ul className="list-disc pl-5">
            {servedBy.map((serving) => (
              <li key={serving.projectId}>
                {serving.name === null ? (
                  // A project the reader may not read: unnamed, unlinked.
                  <span className="font-medium">
                    {t('dispatch.servedBy.hiddenItem')}
                  </span>
                ) : (
                  <Link
                    to="/dashboard/$id/projects/$projectId/dispatch"
                    params={{
                      id: organizationId,
                      projectId: serving.projectId,
                    }}
                    className="focus-visible:ring-ring rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:outline-none"
                  >
                    {t('dispatch.servedBy.item', { project: serving.name })}
                  </Link>
                )}
                {!serving.enabled ? ` (${t('dispatch.servedBy.off')})` : null}
                {serving.skipped !== null
                  ? ` — ${t(SOURCE_SKIPPED_KEYS[serving.skipped])}`
                  : null}
              </li>
            ))}
          </ul>
        </Stack>
      }
    />
  );
}
