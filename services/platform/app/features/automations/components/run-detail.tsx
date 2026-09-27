'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Ban, SearchX } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { mergeNodeTypes } from '../hooks/backend';
import { useCancelAutomationRun } from '../hooks/mutations';
import {
  useAutomation,
  useAutomationRun,
  useNodeTypeCatalog,
  useRunPendingAsk,
} from '../hooks/queries';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { useRunStarterLabel } from '../hooks/use-run-starter-label';
import { readDocument, readPositions } from '../lib/document';
import { automationErrorMessage, isMissingAutomationRead } from '../lib/errors';
import { buildGraph } from '../lib/graph';
import { issueImportResultSchema, issueSource } from '../lib/issue-import';
import {
  isRunFinished,
  nodeStatusMap,
  projectRun,
  readRunAgentRetry,
  readRunCursorNode,
  readRunStatus,
  runReasonKey,
} from '../lib/run-view';
import {
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_RUN_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from '../lib/workbench';
import { AgentExecutionLog } from './agent-execution-log';
import { AutomationCanvas } from './automation-canvas';
import { EffectList } from './effect-list';
import { IssueImportContinuation } from './issue-import-continuation';
import { IssueImportResult } from './issue-import-result';
import { NodeInspector } from './node-inspector';
import { approvalIdFromDetail, RunApprovalCard } from './run-approval-card';
import { RunAskCard } from './run-ask-card';
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
 */
export function RunDetail({
  organizationId,
  automationSlug,
  runId,
}: {
  organizationId: string;
  automationSlug: string;
  runId: string;
}) {
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

  const runQuery = useAutomationRun(organizationId, runId);
  const run = runQuery.data ?? null;
  const pendingAskQuery = useRunPendingAsk(organizationId, runId);
  const pendingAsk = pendingAskQuery.data ?? null;
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    run?.version,
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
  const graph = useMemo(() => buildGraph(automation), [automation]);
  const positions = useMemo(() => readPositions(automation), [automation]);
  const runStatusByNode = useMemo(
    () =>
      nodeStatusMap(
        projection,
        graph.nodes.map((node) => node.id),
        readRunCursorNode(run),
      ),
    [graph.nodes, projection, run],
  );
  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data),
    [catalogQuery.data],
  );

  if (isMissingAutomationRead(runQuery)) {
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
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
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
        <RunBadge status={status} />
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
        {!isRunFinished(status) && (
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
      </div>

      {/* A stop is irreversible and withdraws whatever the run waits on (an
          approval card, a question), so it asks first — like the delete and
          revoke doors do. */}
      <ConfirmDialog
        open={confirmStop}
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
      {pendingAsk !== null && (
        <RunAskCard organizationId={organizationId} ask={pendingAsk} />
      )}
      {(() => {
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
        // The failure sentence of a failed run; the park of a waiting one
        // in words (the ask card above already says what an ask waits on).
        // The raw `repeat:<node>` / `agent:<node>` detail never renders.
        const reason = runReasonKey(run);
        if (reason === undefined) return null;
        if (reason.kind === 'failed') {
          return <Alert variant="destructive" description={reason.detail} />;
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
          <AutomationCanvas
            graph={graph}
            positions={positions}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            inspectorId={inspectorId}
            runStatusByNode={runStatusByNode}
          />
        </div>
        {selectedNode !== null && (
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
          />
        )}
      </div>

      {/* What an `agent` node did inside the sandbox — the one window into a
          turn that is otherwise an opaque spinner. Renders nothing for runs
          without an agent node. */}
      <AgentExecutionLog organizationId={organizationId} runId={runId} />

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
