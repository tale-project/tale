'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNavigate } from '@tanstack/react-router';
import { Ban, SearchX } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { readStateOf } from '@/app/lib/backend/read-state';
import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { mergeNodeTypes } from '../hooks/backend';
import { useCancelAutomationRun } from '../hooks/mutations';
import {
  useAutomation,
  useAutomationRun,
  useNodeTypeCatalog,
  useRunPendingAsk,
  useRunRecord,
} from '../hooks/queries';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { useRunStarterLabel } from '../hooks/use-run-starter-label';
import { automationDetailPathname } from '../lib/detail-paths';
import { readDocument } from '../lib/document';
import { automationErrorMessage, isMissingAutomationRead } from '../lib/errors';
import { flowGraphTarget } from '../lib/flow-ids';
import { issueImportResultSchema, issueSource } from '../lib/issue-import';
import {
  actionTitle,
  connectorName,
  nodeCatalogView,
  nodeTitle,
} from '../lib/node-face';
import {
  cursorNodeStatus,
  isRunFinished,
  nodeStatusMap,
  projectRun,
  readRunAgentRetry,
  readRunCursorNode,
  readRunParkNode,
  readRunStatus,
  runReasonKey,
} from '../lib/run-view';
import {
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_RUN_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from '../lib/workbench';
import { AgentExecutionLog } from './agent-execution-log';
import { AutomationCanvas, type CanvasRun } from './automation-canvas';
import { EffectList } from './effect-list';
import { IssueImportContinuation } from './issue-import-continuation';
import { IssueImportResult } from './issue-import-result';
import { NodeInspector, type InspectorContext } from './node-inspector';
import { approvalIdFromDetail, RunApprovalCard } from './run-approval-card';
import { RunAskCard } from './run-ask-card';
import { RunFailureCard } from './run-failure-card';
import { RunInDoubtCard } from './run-in-doubt-card';
import { RunQuarantineCard } from './run-quarantine-card';
import { RunReplayDialog } from './run-replay-dialog';
import { RunBadge } from './run-status-badge';

/**
 * One run, laid over the document that produced it.
 *
 * The canvas is drawn from the EXACT version the run started against — the
 * store resolves the run and its document together for the same reason — so a
 * redeploy since then cannot make the picture lie. Each node carries its status
 * from the trace, selecting one shows what that node received and returned, and
 * every effect the run performed is listed in full below.
 *
 * When no version document exists any more — the automation was deleted, and
 * its runs are kept until retention removes them — the canvas is drawn from
 * the run's own trace: the nodes it recorded, in the order it ran them. The
 * page never goes blank over retained history (2026-09-26 evaluation, D-14).
 *
 * The run routes keep this mounted when they move to another run (a
 * continuation, back and forward), so each run gets a fresh page state: a
 * refused stop or a picked node never shows on the next run.
 */
export function RunDetail(props: RunDetailProps) {
  const { t } = useT('automations');
  const runRegionRef = useRef<HTMLDivElement>(null);
  const focusRunRegion = useCallback(() => runRegionRef.current?.focus(), []);
  return (
    <div
      ref={runRegionRef}
      role="region"
      aria-label={t('runs.breadcrumb')}
      tabIndex={-1}
      className="flex min-w-0 flex-1 flex-col"
    >
      <RunDetailBody
        key={props.runId}
        {...props}
        onFocusLost={focusRunRegion}
      />
    </div>
  );
}

interface RunDetailProps {
  organizationId: string;
  automationSlug: string;
  runId: string;
}

function RunDetailBody({
  organizationId,
  automationSlug,
  runId,
  onFocusLost,
}: RunDetailProps & { onFocusLost: () => void }) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const inspectorId = useId();
  const effectsHeadingId = useId();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const deselectNode = useCallback(() => {
    const id = selectedNodeId;
    setSelectedNodeId(null);
    if (id !== null) {
      queueMicrotask(() => {
        focusAutomationNode(id);
      });
    }
  }, [selectedNodeId]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  /** The step a retry is being planned from, while its dialog is open. */
  const [retryFrom, setRetryFrom] = useState<string | null>(null);
  const navigate = useNavigate();
  const ability = useAbility();
  // Live runs, like saving and deploying, are the author's.
  const canStartLive = ability.can('read', 'developerSettings');

  const runQuery = useAutomationRun(organizationId, runId);
  const runRead = readStateOf(runQuery);
  const readFailureRef = useRef<string | undefined>(undefined);
  const settledRunErrorRef = useRef<unknown>(undefined);
  if (runQuery.isError) {
    settledRunErrorRef.current = runQuery.error;
    readFailureRef.current = failureDetail(runQuery.error);
  }
  const run = runQuery.data ?? null;
  const pendingAskQuery = useRunPendingAsk(organizationId, runId);
  const pendingAsk = pendingAskQuery.data ?? null;
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    run?.version,
  );
  // The latest version, for a retry on it.
  const latestQuery = useAutomation(organizationId, automationSlug);
  const recordQuery = useRunRecord(
    organizationId,
    run?.status === 'failed' ? runId : undefined,
    { finished: true },
  );
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const cancel = useCancelAutomationRun();
  const starterLabel = useRunStarterLabel(organizationId);

  const projection = useMemo(() => projectRun(run), [run]);
  // The version read has SETTLED with nothing to draw — the automation (or
  // this version of it) is gone. Never true while the read is pending or on
  // a transient failure, so the trace canvas below never flashes in front
  // of the real document.
  const versionMissing = isMissingAutomationRead(versionQuery);
  const versionPending =
    versionQuery.data === undefined && !versionQuery.isError;
  const automation = useMemo(() => {
    const document = readDocument(versionQuery.data?.document);
    if (document !== null || run === null || !versionMissing) return document;
    // No document to draw: the run's trace names every node it reached and
    // its type, which is enough for a canvas of what happened. A node the
    // run passed more than once (a repeat) is drawn once.
    const seen = new Set<string>();
    const nodes: { id: string; type: string }[] = [];
    for (const entry of projection.trace) {
      if (seen.has(entry.node)) continue;
      seen.add(entry.node);
      nodes.push({ id: entry.node, type: entry.type });
    }
    return readDocument({ name: run.name, nodes });
  }, [versionQuery.data?.document, run, projection.trace, versionMissing]);
  // The heading names the automation the way the breadcrumb above it does,
  // not by the slug the store addresses it with.
  const { locale } = useLocale();
  const displayName = automationDisplayName(
    versionQuery.data?.presentation,
    automationSlug,
    locale,
  );
  const runStatusByNode = useMemo(
    () =>
      nodeStatusMap(
        projection,
        (automation?.nodes ?? []).map((node) => node.id),
        readRunCursorNode(run),
        cursorNodeStatus(run),
      ),
    [automation?.nodes, projection, run],
  );
  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data?.nodeTypes),
    [catalogQuery.data?.nodeTypes],
  );
  const catalog = useMemo(
    () => nodeCatalogView(nodeTypes, catalogQuery.data?.connectors ?? []),
    [nodeTypes, catalogQuery.data?.connectors],
  );
  // The step the run failed at, as its record tells it: a step of this
  // version (not one inside a subautomation), the last to fail.
  const failedStep = useMemo<RecordedStep | undefined>(
    () =>
      recordQuery.data?.nodes
        .filter(
          (step) =>
            step.status === 'failed' &&
            step.parentPath === undefined &&
            step.failure !== undefined,
        )
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
        .at(-1),
    [recordQuery.data],
  );
  const failureLabels = useMemo(
    () => ({
      connectorLabel: (slug: string) => connectorName(slug, catalog, locale),
      actionLabel: (type: string) => actionTitle(type, catalog, locale),
    }),
    [catalog, locale],
  );
  const canvasRun = useMemo<CanvasRun | null>(
    () =>
      run === null
        ? null
        : {
            statusByNode: runStatusByNode,
            projection,
            status: readRunStatus(run.status),
            startedBy: starterLabel(run),
          },
    [run, runStatusByNode, projection, starterLabel],
  );
  // A failed run opens on its failure: the node that failed comes into
  // view, and the way the run took to it stands out.
  const failedNode = useMemo(
    () =>
      [...runStatusByNode].find(([, status]) => status === 'error')?.[0] ??
      null,
    [runStatusByNode],
  );
  /** A condition opens its node; Start and End have no inspector of their
   * own yet. */
  const selectOnCanvas = useCallback((id: string | null) => {
    if (id === null) {
      setSelectedNodeId(null);
      return;
    }
    const target = flowGraphTarget(id);
    if (target.kind === 'node' || target.kind === 'gate') {
      setSelectedNodeId(target.nodeId);
    }
  }, []);

  // What the inspector reads besides the node: no check runs on a run's
  // page, so it opens on what the run did and has no Shape tab.
  const inspectorContext = useMemo<InspectorContext | null>(
    () =>
      automation === null
        ? null
        : {
            doc: automation,
            flow: analyzeFlow(automation.nodes),
            analysis: null,
            types: null,
            shapeStatus: 'off',
            diagnosticsStatus: 'ready',
            settled: null,
            catalog,
            onSelect: (id) => selectOnCanvas(id),
            sampleOf: (nodeId) => projection.byNode.get(nodeId)?.output,
          },
    [automation, catalog, selectOnCanvas, projection],
  );

  const runMissing = isMissingAutomationRead({
    data: runQuery.data,
    isError: runQuery.isError || runRead.unavailable,
    error: runRead.unavailable ? settledRunErrorRef.current : runQuery.error,
  });

  if (runMissing) {
    return (
      <ContentArea variant="narrow">
        <EmptyState
          icon={SearchX}
          title={t('runs.notFound.title')}
          description={t('runs.notFound.description')}
          headingLevel={2}
        />
      </ContentArea>
    );
  }
  if (runRead.unavailable) {
    return (
      <ContentArea variant="narrow">
        <CatalogLoadError
          message={[t('runs.loadFailed'), readFailureRef.current]
            .filter(Boolean)
            .join(' ')}
          isRetrying={runRead.retrying}
          failureKey={runRead.failureCount}
          onRetry={() => void runQuery.refetch()}
          onFocusLost={onFocusLost}
        />
      </ContentArea>
    );
  }
  if (!run || versionPending) {
    return (
      <ContentArea variant="narrow">
        <Text as="p" variant="muted" className="text-sm">
          {t('runs.loading')}
        </Text>
      </ContentArea>
    );
  }

  const status = readRunStatus(run.status);
  const selectedNode =
    automation?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const issueImport =
    issueSource(automationSlug) === null
      ? null
      : issueImportResultSchema.safeParse(run.output);

  return (
    // Full width rather than the `narrow` configuration measure: a run is read
    // on the same two-column workbench the automation is authored on — the
    // canvas beside its inspector — and the settings measure would leave the
    // graph a ~25rem column next to a 22rem panel.
    <ContentArea className="flex-1" gap={4}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionHeader
          as="h2"
          size="lg"
          title={t('runs.heading', { automation: displayName })}
        />
        <RunBadge status={status} stalled={run.stalled === true} />
        {(() => {
          const retryAttempt = readRunAgentRetry(run);
          if (retryAttempt === null) return null;
          return (
            <Text as="span" variant="muted" className="text-xs">
              {t('runs.autoRetrying', {
                n: retryAttempt,
                max: run.agentAutoRetryMax,
              })}
            </Text>
          );
        })()}
        <Badge variant={run.mode === 'live' ? 'orange' : 'slate'}>
          {t(`runs.mode.${run.mode === 'live' ? 'live' : 'mock'}`)}
        </Badge>
        <span className="text-sm">
          {t('versions.versionLabel', { version: run.version })}
        </span>
        <Text as="span" variant="muted" className="text-xs">
          {starterLabel(run)}
        </Text>
        <Text as="span" variant="muted" className="text-xs">
          {t('runs.startedAt', {
            date: formatDate(new Date(run.startedAt), 'long'),
          })}
        </Text>
        {typeof run.finishedAt === 'number' && (
          <Text as="span" variant="muted" className="text-xs">
            {t('runs.finishedAt', {
              date: formatDate(new Date(run.finishedAt), 'long'),
            })}
          </Text>
        )}
        {!isRunFinished(status) && status !== 'quarantined' && (
          <Button
            variant="secondary"
            size="sm"
            icon={Ban}
            isLoading={cancel.isPending}
            onClick={() => {
              setConfirmStop(true);
            }}
          >
            {t('runs.cancel')}
          </Button>
        )}
        {/* A run another server took over, or a stopping one handed on:
            how often, and the last time when and why — the platform's
            recovery, told apart from anything the reader did. On a row of
            its own under the run's identity, and only once a server has it
            again: until then the Interrupted badge says where it stands. */}
        {status !== 'quarantined' &&
          typeof run.resumeCount === 'number' &&
          run.resumeCount > 0 &&
          run.stalled !== true && (
            <Text as="p" variant="muted" className="basis-full text-xs">
              {[
                t('runs.resumed.label', { count: run.resumeCount }),
                run.lastResume === undefined
                  ? null
                  : t(`runs.resumed.${run.lastResume.reason}`, {
                      date: formatDate(new Date(run.lastResume.at), 'long'),
                    }),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </Text>
          )}
      </div>

      {/* A stop is irreversible and withdraws whatever the run waits on (an
          approval card, a question), so it asks first — like the delete and
          revoke doors do. */}
      <ConfirmDialog
        open={confirmStop && status !== 'quarantined'}
        onOpenChange={setConfirmStop}
        title={t('runs.cancelConfirm.title')}
        description={t('runs.cancelConfirm.body')}
        confirmText={t('runs.cancel')}
        variant="destructive"
        isLoading={cancel.isPending}
        onConfirm={() => {
          setConfirmStop(false);
          setRefusal(null);
          cancel.mutate(
            { organizationId, runId },
            {
              onError: (error) => {
                setRefusal(automationErrorMessage(error));
              },
            },
          );
        }}
      />

      {refusal !== null && (
        <Alert variant="destructive" description={refusal} />
      )}
      {status !== 'quarantined' && pendingAsk !== null && (
        <RunAskCard organizationId={organizationId} ask={pendingAsk} />
      )}
      {(() => {
        if (status === 'quarantined') {
          return (
            <RunQuarantineCard
              organizationId={organizationId}
              runId={runId}
              quarantine={run.legacyQuarantine}
              onReload={() => void runQuery.refetch()}
            />
          );
        }
        // A live run parked on a write approval carries `approval:<id>` as
        // its detail — render the decision card instead of the raw string.
        // On a finished run that reference is history, so nothing renders.
        const approvalId = approvalIdFromDetail(run.detail);
        if (approvalId !== undefined) {
          if (isRunFinished(status)) return null;
          return (
            <RunApprovalCard
              organizationId={organizationId}
              approvalId={approvalId}
            />
          );
        }
        // A write that may already have happened when the run was
        // interrupted: the card names it and offers the ways on, in place of
        // the waiting line.
        const inDoubtNode =
          run.waitingFor === 'in_doubt'
            ? readRunParkNode(run.detail)
            : undefined;
        if (inDoubtNode !== undefined && !isRunFinished(status)) {
          return (
            <RunInDoubtCard
              organizationId={organizationId}
              runId={runId}
              node={inDoubtNode}
              iterates={
                automation?.nodes.find((node) => node.id === inDoubtNode)
                  ?.forEach !== undefined
              }
              onFocusLost={onFocusLost}
            />
          );
        }
        // The failure sentence of a failed run; the park of a waiting one
        // in words (the ask card above already says what an ask waits on).
        // The raw `repeat:<node>` / `agent:<node>` / `room:<node>` /
        // `in_doubt:<node>` detail never renders.
        const reason = runReasonKey(run);
        if (reason === undefined) return null;
        if (reason.kind === 'failed') {
          const failedId = failedStep?.nodeId;
          return (
            <RunFailureCard
              {...(failedStep?.failure !== undefined && {
                failure: failedStep.failure,
              })}
              {...(failedId !== undefined && {
                stepLabel: nodeTitle(failedId),
                editor: {
                  to: `${automationDetailPathname({
                    organizationId,
                    automationSlug,
                    ...(run.projectId !== undefined && {
                      projectId: run.projectId,
                    }),
                  })}/editor`,
                  search: { node: failedId, version: run.version },
                },
                onShowStep: () => {
                  setSelectedNodeId(failedId);
                },
                onRetryFromStep: () => {
                  setRetryFrom(failedId);
                },
              })}
              {...(run.failureCode !== undefined && {
                code: run.failureCode,
              })}
              detail={reason.detail}
              labels={failureLabels}
            />
          );
        }
        if (run.waitingFor === 'ask' && pendingAsk !== null) return null;
        return (
          <Alert variant="info" description={t(reason.key, reason.values)} />
        );
      })()}

      <IssueImportResult
        organizationId={organizationId}
        automationSlug={automationSlug}
        output={run.output}
        mock={run.mode === 'mock'}
      />
      {status === 'success' &&
        issueImport?.success &&
        issueImport.data.nextCursor &&
        automation?.inputs && (
          <IssueImportContinuation
            organizationId={organizationId}
            projectId={run.projectId}
            automationSlug={automationSlug}
            version={run.version}
            mode={run.mode}
            input={run.input}
            schema={automation.inputs}
            cursor={issueImport.data.nextCursor}
          />
        )}

      <div
        className={cn(
          AUTOMATION_RUN_WORKBENCH_GRID,
          selectedNode !== null && AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
        )}
      >
        <div className={AUTOMATION_WORKBENCH_CANVAS_SLOT}>
          {automation !== null ? (
            <AutomationCanvas
              automation={automation}
              layoutKey={`${automationSlug}:run:${runId}`}
              catalog={catalog}
              selectedId={selectedNodeId}
              onSelect={selectOnCanvas}
              revealId={selectedNodeId ?? failedNode}
              inspectorId={inspectorId}
              {...(canvasRun !== null && { run: canvasRun })}
            />
          ) : (
            versionQuery.isError && (
              // The version read failed for now (not a deleted automation,
              // which draws the trace): say so where the chart would be.
              <Alert
                variant="destructive"
                title={t('detail.loadFailed.title')}
                description={automationErrorMessage(versionQuery.error)}
              />
            )
          )}
        </div>
        {selectedNode !== null && inspectorContext !== null && (
          <NodeInspector
            id={inspectorId}
            node={selectedNode}
            nodeType={nodeTypes.find((def) => def.type === selectedNode.type)}
            catalogUnavailable={catalogQuery.isError}
            runView={projection.byNode.get(selectedNode.id)}
            readOnly
            onChange={() => {
              // A recorded run is history: the inspector renders it read-only.
            }}
            organizationId={organizationId}
            onDeselect={deselectNode}
            context={inspectorContext}
            defaultTab="run"
          />
        )}
      </div>

      {retryFrom !== null && (
        <RunReplayDialog
          open
          onOpenChange={(open) => {
            if (!open) setRetryFrom(null);
          }}
          organizationId={organizationId}
          run={{ id: run.id, version: run.version, mode: run.mode }}
          from={retryFrom}
          stepLabel={nodeTitle}
          failedHere={retryFrom === failedStep?.nodeId}
          {...(latestQuery.data?.version !== undefined && {
            latestVersion: latestQuery.data.version,
          })}
          {...(versionQuery.data?.deployedVersion !== undefined && {
            deployedVersion: versionQuery.data.deployedVersion,
          })}
          canStartLive={canStartLive}
          onStarted={(started) => {
            void navigate({
              to: `${automationDetailPathname({
                organizationId,
                automationSlug,
                ...(run.projectId !== undefined && {
                  projectId: run.projectId,
                }),
              })}/runs/${started.runId}`,
            });
          }}
          onSelectStep={(id) => {
            setSelectedNodeId(id);
          }}
        />
      )}

      {/* What an `agent` node did inside the sandbox — the one window into a
          turn that is otherwise an opaque spinner. Renders nothing for runs
          without an agent node. */}
      <AgentExecutionLog
        organizationId={organizationId}
        runId={runId}
        waitingForRoom={run.waitingFor === 'room'}
      />

      <section className="flex flex-col gap-2">
        <SectionHeader
          as="h3"
          size="sm"
          title={
            <span id={effectsHeadingId}>
              {t('runs.effects.title', { count: projection.effects.length })}
            </span>
          }
          description={t('runs.effects.description')}
        />
        <EffectList
          effects={projection.effects}
          emptyMessage={t('runs.effects.none')}
          headingId={effectsHeadingId}
        />
      </section>

      {/* Input and output side by side once the run column is 42rem wide —
          the column, not the viewport. */}
      <div className="@container">
        <div className="grid gap-4 @2xl:grid-cols-2">
          <section className="flex flex-col gap-2">
            <SectionHeader as="h3" size="sm" title={t('runs.inputTitle')} />
            <JsonViewer data={run.input} collapsed={1} />
          </section>
          {run.output !== undefined && (
            <section className="flex flex-col gap-2">
              <SectionHeader as="h3" size="sm" title={t('runs.outputTitle')} />
              <JsonViewer data={run.output} collapsed={1} />
            </section>
          )}
        </div>
      </div>
    </ContentArea>
  );
}
