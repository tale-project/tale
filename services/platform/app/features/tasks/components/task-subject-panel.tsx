'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { ConvexError } from 'convex/values';
import { CheckCircle2, Loader2, Play, Undo2, Workflow } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { AgentExecutionLog } from '@/app/features/automations/components/agent-execution-log';
import { AutomationCanvas } from '@/app/features/automations/components/automation-canvas';
import { EffectList } from '@/app/features/automations/components/effect-list';
import {
  RunApprovalCard,
  approvalIdFromDetail,
} from '@/app/features/automations/components/run-approval-card';
import { RunStepDetail } from '@/app/features/automations/components/run-step-detail';
import {
  useAutomation,
  useAutomationRun,
} from '@/app/features/automations/hooks/queries';
import {
  readDocument,
  readPositions,
} from '@/app/features/automations/lib/document';
import { buildGraph } from '@/app/features/automations/lib/graph';
import type { NodeRunView } from '@/app/features/automations/lib/run-view';
import {
  nodeStatusMap,
  projectRun,
  readRunCursorNode,
  visitedNodeIds,
} from '@/app/features/automations/lib/run-view';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useAddTaskComment, useUpdateTaskStatus } from '../hooks/mutations';
import type { ResolvedTaskSubjectContract } from '../hooks/use-task-subject-contract';
import { deriveSubjectState } from '../lib/subject-state';

/**
 * The run's progress, inspected WITHOUT leaving the task.
 *
 * The graph rides along as a SMALL strip — enough to see where the run is and
 * to click another step — while the weight of the dialog goes to the step the
 * run is on: what it resolved, what it produced, and, for an `agent` step, the
 * transcript of what the agent did inside the sandbox. The step reading is
 * {@link RunStepDetail}, the very component the automation editor's node
 * inspector renders, so a step is described identically on both surfaces.
 * Nothing is fetched until the dialog opens.
 */
function TaskRunDetailsDialog({
  organizationId,
  automationSlug,
  runId,
  name,
  open,
  onOpenChange,
}: {
  organizationId: string;
  automationSlug: string;
  runId: Id<'automationRuns'>;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const detailId = useId();
  const runQuery = useAutomationRun(organizationId, open ? runId : undefined);
  const run = runQuery.data ?? null;
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    open ? run?.version : undefined,
  );
  const automation = useMemo(
    () => readDocument(versionQuery.data?.document),
    [versionQuery.data?.document],
  );
  const graph = useMemo(() => buildGraph(automation), [automation]);
  const positions = useMemo(() => readPositions(automation), [automation]);
  const projection = useMemo(() => projectRun(run), [run]);
  // Where the run IS: the stepper's own cursor while it runs, else the last
  // step of the finished run's ordered trace. Never "the last key of the
  // checkpoint record" — those arrive alphabetically, which would point at
  // whichever skipped node happens to sort last.
  const currentNodeId =
    readRunCursorNode(run) ?? projection.trace.at(-1)?.node ?? null;
  const runStatusByNode = useMemo(
    () =>
      nodeStatusMap(
        projection,
        graph.nodes.map((node) => node.id),
        currentNodeId,
      ),
    [currentNodeId, graph.nodes, projection],
  );
  // The strip draws the path TAKEN, not the whole document — pending nodes
  // are noise while a run is being watched. Before anything has run there is
  // no path to draw, so the full graph stands in as orientation.
  const visitedIds = useMemo(
    () => visitedNodeIds(projection, currentNodeId),
    [projection, currentNodeId],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const activeNodeId = selectedNodeId ?? currentNodeId;
  const recordedView =
    activeNodeId !== null ? projection.byNode.get(activeNodeId) : undefined;
  // The step in flight has no checkpoint yet — nothing has been recorded about
  // it, which is exactly why "not reached" would be the wrong thing to say. Its
  // view is synthesised from the document so the reader still sees WHICH step
  // is running and, for an `agent` step, its transcript.
  const activeView: NodeRunView | undefined =
    recordedView ??
    (activeNodeId !== null && activeNodeId === currentNodeId
      ? {
          status: 'running',
          effects: [],
          ...(() => {
            const type = graph.nodes.find(
              (node) => node.id === activeNodeId,
            )?.type;
            return type !== undefined ? { type } : {};
          })(),
        }
      : undefined);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-3xl">
        <ResponsiveDialogTitle className="text-base font-semibold">
          {t('run.detailsTitle', { name })}
        </ResponsiveDialogTitle>
        {run !== null && (
          <>
            {/* Orientation only — small on purpose; the step below is the
                subject of this dialog. It shows the run's own path and keeps
                the cursor in view; the pill inside hands a wandering selection
                back to the step in flight. */}
            <AutomationCanvas
              graph={graph}
              positions={positions}
              selectedNodeId={activeNodeId}
              onSelectNode={setSelectedNodeId}
              inspectorId={detailId}
              runStatusByNode={runStatusByNode}
              {...(visitedIds.size > 0 ? { visibleNodeIds: visitedIds } : {})}
              followNodeId={currentNodeId}
              onReturnToFollow={() => setSelectedNodeId(null)}
              size="compact"
            />
            <Stack
              id={detailId}
              gap={4}
              className={cn(
                'min-w-0 rounded-lg border p-4',
                // The step in flight is the subject of this dialog — give it a
                // frame that says so, rather than looking like any other row.
                activeNodeId === currentNodeId
                  ? 'border-primary/40 bg-primary/[0.03]'
                  : 'border-border bg-card',
              )}
            >
              {activeView !== undefined && activeNodeId !== null ? (
                <>
                  <RunStepDetail
                    runView={activeView}
                    heading={activeNodeId}
                    {...(activeNodeId === currentNodeId
                      ? { badge: t('run.currentStep') }
                      : {})}
                  />
                  {/* The transcript is the AGENT step's detail — never another
                      step's, and nothing at all for a run without one. */}
                  {activeView.type === 'agent' && (
                    <div className="border-border border-t pt-4">
                      <AgentExecutionLog
                        organizationId={organizationId}
                        runId={runId}
                      />
                    </div>
                  )}
                </>
              ) : (
                <Text as="p" variant="muted">
                  {activeNodeId === null
                    ? t('run.noProgressYet')
                    : t('run.stepNotReached')}
                </Text>
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
 *
 * It reads top-to-bottom as the whole answer to opening the task: WHO owns it
 * (the automation's declared name), WHAT it is (the automation's own
 * description — live from the deployed version, never copied into the task),
 * WHAT NOW (the state line) and WHAT TO PRESS (the verb). The primary verb is
 * therefore never absent while the task is startable-in-principle: waiting for
 * input renders Start soft-disabled with the reason attached, because a promise
 * of "then start" with no Start on screen leaves the reader hunting the board
 * for a gesture that doesn't exist.
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
  const headingId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const { automationSlug, displayName, displayDescription, contract } = ownedBy;

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
  const addComment = useAddTaskComment();

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
              ? t('run.alreadyRunning', { name: displayName })
              : t('run.notStarted', { name: displayName }),
          variant:
            result.reason === 'already_running' ? undefined : 'destructive',
        });
      }
    } catch (error) {
      console.error('[tasks] subject-panel start failed', error);
      toast({
        title: t('run.notStarted', { name: displayName }),
        variant: 'destructive',
      });
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

  /**
   * Request changes is ONE gesture: the feedback is written as the task's
   * comment and the rerun starts after it lands. The workflow re-reads the
   * task's comments on its next pass, so the order is the whole point — a
   * rerun kicked before the comment exists would read no feedback and repeat
   * itself, which is exactly the trap of asking the reviewer to remember to
   * comment first.
   */
  const requestChanges = async () => {
    const body = feedback.trim();
    if (body === '') return;
    setBusy(true);
    try {
      await addComment.mutateAsync({ taskId: task._id, body });
      const result = await startRun.mutateAsync({
        organizationId,
        taskId: task._id,
        workflowSlug: automationSlug,
      });
      // The comment landed either way, so the box always closes and empties:
      // leaving the text in a still-open dialog invites a second Send back,
      // which would file the same feedback twice.
      setChangesOpen(false);
      setFeedback('');
      if (result.started) {
        toast({
          title: t('subject.requestChangesSent', { name: displayName }),
          variant: 'success',
        });
      } else {
        // Say what did NOT happen — the feedback is recorded, nothing is running.
        toast({
          title:
            result.reason === 'already_running'
              ? t('run.alreadyRunning', { name: displayName })
              : t('run.notStarted', { name: displayName }),
          variant:
            result.reason === 'already_running' ? undefined : 'destructive',
        });
      }
    } catch (error) {
      console.error('[tasks] request-changes failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const stateLine =
    state.kind === 'running'
      ? t('run.working', { name: displayName })
      : state.kind === 'review'
        ? t('subject.review', { name: displayName })
        : state.kind === 'ready'
          ? t('subject.ready', { name: displayName })
          : state.kind === 'waiting_input'
            ? t('subject.waitingInput')
            : t('subject.stalled');

  const approvalId =
    run !== null ? approvalIdFromDetail(run.detail) : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        // This panel is what the reader opened the task FOR, so it carries the
        // accent whenever the next move is theirs. A run in flight is a plain
        // card: there is nothing to press, and the spinner tells that story.
        state.kind === 'running'
          ? 'border-border bg-card'
          : 'border-primary/40 bg-primary/[0.03]',
      )}
    >
      <Row gap={2} align="center">
        <Workflow
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text
          as="h3"
          id={headingId}
          variant="label"
          className="min-w-0 flex-1 truncate"
        >
          {displayName}
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

      {/* The automation's OWN words on what it does — clamped, because a pack
          may declare a paragraph and this is orientation, not documentation. */}
      {displayDescription !== undefined && (
        <Text as="p" variant="caption" className="line-clamp-2 text-pretty">
          {displayDescription}
        </Text>
      )}

      <Row gap={2} align="center">
        {state.kind === 'running' && (
          <Loader2
            className="text-muted-foreground size-4 shrink-0 animate-spin"
            aria-hidden
          />
        )}
        <Text as="p" className="min-w-0 flex-1 text-pretty">
          {stateLine}
        </Text>
      </Row>

      {canEdit && (
        <Row gap={2} wrap className="mt-1">
          {(state.kind === 'ready' ||
            state.kind === 'stalled' ||
            state.kind === 'waiting_input') && (
            <Button
              size="sm"
              // Soft-disabled, not absent: the verb stays where the reader was
              // told to look, and the tooltip (pointer AND keyboard, via the
              // shared primitive) says what is missing.
              disabled={busy || state.kind === 'waiting_input'}
              disabledReason={
                state.kind === 'waiting_input'
                  ? t('run.missingInput')
                  : undefined
              }
              icon={Play}
              onClick={() =>
                void start(t('run.started', { name: displayName }))
              }
            >
              {state.kind === 'stalled'
                ? t('subject.startAgain')
                : t('subject.start')}
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
                  onClick={() => setChangesOpen(true)}
                >
                  {t('subject.requestChanges')}
                </Button>
              )}
            </>
          )}
        </Row>
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
          automationSlug={run.name}
          runId={run.runId}
          name={displayName}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('subject.cancelConfirmTitle')}
        description={t('subject.cancelConfirmBody', { name: displayName })}
        confirmText={t('subject.cancel')}
        isLoading={busy}
        variant="destructive"
        onConfirm={() => void cancel()}
      />
      <ConfirmDialog
        open={changesOpen}
        onOpenChange={(next) => {
          if (!next && !busy) setChangesOpen(false);
        }}
        title={t('subject.requestChanges')}
        description={t('subject.requestChangesDialog', { name: displayName })}
        confirmText={t('subject.requestChangesSend')}
        isLoading={busy}
        disableConfirm={feedback.trim() === ''}
        onConfirm={() => void requestChanges()}
      >
        <Textarea
          aria-label={t('subject.requestChangesLabel')}
          placeholder={t('subject.requestChangesPlaceholder')}
          rows={5}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </ConfirmDialog>
    </section>
  );
}
