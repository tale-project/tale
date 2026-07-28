'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { CheckCircle2, Loader2, Play, Undo2, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { AgentExecutionLog } from '@/app/features/automations/components/agent-execution-log';
import { EffectList } from '@/app/features/automations/components/effect-list';
import {
  RunApprovalCard,
  approvalIdFromDetail,
} from '@/app/features/automations/components/run-approval-card';
import { RunStatusBadge } from '@/app/features/automations/components/run-status-badge';
import { useAutomationRun } from '@/app/features/automations/hooks/queries';
import { projectRun } from '@/app/features/automations/lib/run-view';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateTaskStatus } from '../hooks/mutations';
import type { ResolvedTaskSubjectContract } from '../hooks/use-task-subject-contract';
import { deriveSubjectState } from '../lib/subject-state';

/**
 * The run's progress, inspected WITHOUT leaving the task: a dialog listing
 * each traced node with its state plus every effect performed so far. The
 * full run document is only fetched while the dialog is open.
 */
function TaskRunDetailsDialog({
  organizationId,
  runId,
  name,
  open,
  onOpenChange,
}: {
  organizationId: string;
  runId: Id<'automationRuns'>;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const runQuery = useAutomationRun(organizationId, open ? runId : undefined);
  const run = runQuery.data ?? null;
  const projection = projectRun(run);
  const nodes = [...projection.byNode.entries()];
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-xl">
        <ResponsiveDialogTitle className="text-base font-semibold">
          {t('run.detailsTitle', { name })}
        </ResponsiveDialogTitle>
        {run !== null && (
          <>
            <AgentExecutionLog organizationId={organizationId} runId={runId} />
            <Stack as="section" gap={1}>
              {nodes.length === 0 ? (
                <Text as="p" variant="muted">
                  {t('run.noProgressYet')}
                </Text>
              ) : (
                <ul className="flex flex-col gap-1">
                  {nodes.map(([nodeId, view]) => (
                    <li
                      key={nodeId}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{nodeId}</span>
                      <RunStatusBadge status={view.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Stack>
            <Stack as="section" gap={2}>
              <Text as="h3" variant="label">
                {t('run.effectsTitle')}
              </Text>
              <EffectList
                effects={projection.effects}
                emptyMessage={t('run.noEffectsYet')}
              />
            </Stack>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * The automation-ownership work panel of the task modal — the read-side twin
 * of the status choreography, with EXPLICIT verbs so nothing depends on
 * knowing the drag semantics: what the task is waiting for, a Start button
 * when the contract's gate holds, Cancel while the run is in flight (with
 * its progress and inline approvals, as before), and Approve / Request
 * changes when the output sits in review. Every state and verb derives from
 * the generic subject contract — nothing here knows any specific automation.
 */
export function TaskSubjectPanel({
  organizationId,
  task,
  ownedBy,
  canEdit,
}: {
  organizationId: string;
  task: {
    _id: Id<'tasks'>;
    projectId: Id<'projects'>;
    status: string;
    externalId?: string;
  };
  ownedBy: ResolvedTaskSubjectContract;
  canEdit: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { automationSlug, contract } = ownedBy;

  const runQuery = useConvexQuery(api.automations.queries.getLiveRunForTask, {
    organizationId,
    projectId: task.projectId,
    taskId: task._id,
  });
  const run = runQuery.data ?? null;

  // `hasFiles` exactly as the choreography computes it: only a folder-input
  // contract with a bound folder ever reads true.
  const folderBound =
    contract.input?.kind === 'folder' &&
    typeof task.externalId === 'string' &&
    task.externalId !== '';
  const documentsQuery = useConvexQuery(
    api.projects.queries.listProjectDocuments,
    folderBound ? { organizationId, projectId: task.projectId } : 'skip',
  );
  const hasFiles = useMemo(
    () =>
      folderBound &&
      (documentsQuery.data ?? []).some(
        (document) => document.folderId === task.externalId,
      ),
    [documentsQuery.data, folderBound, task.externalId],
  );

  const startRun = useConvexAction(api.tasks.public_actions.startTaskWorkflow);
  const cancelRun = useConvexAction(
    api.tasks.public_actions.cancelTaskWorkflow,
  );
  const updateStatus = useUpdateTaskStatus();

  // Facts still loading — render nothing rather than a state that flips.
  if (runQuery.data === undefined) return null;
  if (folderBound && documentsQuery.data === undefined) return null;

  const state = deriveSubjectState(contract, {
    status: task.status,
    runActive: run !== null,
    hasFiles,
  });
  if (state.kind === 'idle') return null;
  // A folder-input contract on a task with NO bound folder has no upload
  // surface to point at — "waiting for input" would be a dead end. The
  // ownership badge still marks the task; the panel stays quiet.
  if (
    state.kind === 'waiting_input' &&
    contract.input?.kind === 'folder' &&
    !folderBound
  ) {
    return null;
  }

  const start = async (successTitle: string) => {
    setBusy(true);
    try {
      const result = await startRun.mutateAsync({
        organizationId,
        taskId: task._id,
        workflowSlug: automationSlug,
      });
      if (result.started) {
        toast({ title: successTitle, variant: 'success' });
      } else {
        toast({
          title:
            result.reason === 'already_running'
              ? t('run.alreadyRunning')
              : t('run.notStarted'),
          variant:
            result.reason === 'already_running' ? undefined : 'destructive',
        });
      }
    } catch (error) {
      console.error('[tasks] subject-panel start failed', error);
      toast({ title: t('run.notStarted'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelRun.mutateAsync({ organizationId, taskId: task._id });
      toast({ title: t('run.cancelled') });
    } catch (error) {
      console.error('[tasks] subject-panel cancel failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    } finally {
      setBusy(false);
      setCancelOpen(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await updateStatus.mutateAsync({ taskId: task._id, status: 'done' });
      toast({ title: t('subject.approved'), variant: 'success' });
    } catch (error) {
      // Same guard surface as the status picker: a parent with open subtasks
      // cannot close, and the user should hear that, not a generic error.
      if (
        error instanceof ConvexError &&
        error.data?.code === 'TASK_HAS_OPEN_SUBTASKS'
      ) {
        toast({ title: t('detail.parentCloseGuard'), variant: 'destructive' });
      } else {
        console.error('[tasks] subject-panel approve failed', error);
        toast({ title: tCommon('errors.generic'), variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  const stateLine =
    state.kind === 'running'
      ? t('run.working', { name: run?.name ?? automationSlug })
      : state.kind === 'review'
        ? t('subject.review', { name: automationSlug })
        : state.kind === 'ready'
          ? t('subject.ready', { name: automationSlug })
          : state.kind === 'waiting_input'
            ? t('subject.waitingInput')
            : t('subject.stalled');

  const approvalId =
    run !== null ? approvalIdFromDetail(run.detail) : undefined;

  return (
    <section
      aria-label={t('automation.hint', { name: automationSlug })}
      className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-3"
    >
      <Row gap={2} align="center">
        {state.kind === 'running' ? (
          <Loader2
            className="text-muted-foreground size-4 shrink-0 animate-spin"
            aria-hidden
          />
        ) : (
          <Workflow
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        )}
        <Text
          as="p"
          variant="muted"
          className="min-w-0 flex-1 text-sm text-pretty"
        >
          {stateLine}
        </Text>
        {state.kind === 'running' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetailsOpen(true)}
          >
            {t('run.details')}
          </Button>
        )}
      </Row>

      {canEdit && (
        <Row gap={2} wrap>
          {(state.kind === 'ready' || state.kind === 'stalled') && (
            <Button
              size="sm"
              disabled={busy}
              icon={Play}
              onClick={() => void start(t('run.started'))}
            >
              {state.kind === 'ready'
                ? t('subject.start')
                : t('subject.startAgain')}
            </Button>
          )}
          {state.kind === 'running' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setCancelOpen(true)}
            >
              {t('subject.cancel')}
            </Button>
          )}
          {state.kind === 'review' && (
            <>
              <Button
                size="sm"
                disabled={busy}
                icon={CheckCircle2}
                onClick={() => void approve()}
              >
                {t('subject.approve')}
              </Button>
              {state.requestChanges && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  icon={Undo2}
                  onClick={() => void start(t('subject.requestChangesSent'))}
                >
                  {t('subject.requestChanges')}
                </Button>
              )}
            </>
          )}
        </Row>
      )}
      {state.kind === 'review' && state.requestChanges && canEdit && (
        <Text as="p" variant="muted" className="text-xs text-pretty">
          {t('subject.requestChangesHint')}
        </Text>
      )}

      {approvalId !== undefined && (
        <RunApprovalCard
          organizationId={organizationId}
          approvalId={approvalId}
        />
      )}
      {run !== null && (
        <TaskRunDetailsDialog
          organizationId={organizationId}
          runId={run.runId}
          name={run.name}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('subject.cancelConfirmTitle')}
        description={t('subject.cancelConfirmBody', {
          name: run?.name ?? automationSlug,
        })}
        confirmText={t('subject.cancel')}
        isLoading={busy}
        variant="destructive"
        onConfirm={() => void cancel()}
      />
    </section>
  );
}
