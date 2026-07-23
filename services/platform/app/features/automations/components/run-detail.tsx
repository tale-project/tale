'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Text } from '@tale/ui/text';
import { Ban, SearchX } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import { useCancelAutomationRun } from '../hooks/mutations';
import {
  useAutomation,
  useAutomationRun,
  useNodeTypeCatalog,
} from '../hooks/queries';
import {
  readDocument,
  readPositions,
  readReviewNotes,
  reviewNotesByNode,
} from '../lib/document';
import { automationErrorMessage } from '../lib/errors';
import { buildGraph } from '../lib/graph';
import {
  isRunFinished,
  nodeStatusMap,
  projectRun,
  readRunStatus,
} from '../lib/run-view';
import { AutomationCanvas } from './automation-canvas';
import { EffectList } from './effect-list';
import { NodeInspector } from './node-inspector';
import { RunBadge } from './run-status-badge';

/**
 * One run, laid over the document that produced it.
 *
 * The canvas is drawn from the EXACT version the run started against — the
 * store resolves the run and its document together for the same reason — so a
 * redeploy since then cannot make the picture lie. Each node carries its status
 * from the trace, selecting one shows what that node received and returned, and
 * every effect the run performed is listed in full below.
 */
export function RunDetail({
  organizationId,
  automationSlug,
  runId,
}: {
  organizationId: string;
  automationSlug: string;
  runId: Id<'workflowRuns'>;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const inspectorId = useId();
  const effectsHeadingId = useId();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const runQuery = useAutomationRun(organizationId, runId);
  const run = runQuery.data ?? null;
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    run?.version,
  );
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const cancel = useCancelAutomationRun();

  const workflow = useMemo(
    () => readDocument(versionQuery.data?.document),
    [versionQuery.data?.document],
  );
  const graph = useMemo(() => buildGraph(workflow), [workflow]);
  const positions = useMemo(() => readPositions(workflow), [workflow]);
  const reviewByNode = useMemo(
    () => reviewNotesByNode(readReviewNotes(workflow)),
    [workflow],
  );
  const projection = useMemo(() => projectRun(run), [run]);
  const runStatusByNode = useMemo(
    () =>
      nodeStatusMap(
        projection,
        graph.nodes.map((node) => node.id),
      ),
    [graph.nodes, projection],
  );
  const reviewCountByNode = useMemo(
    () =>
      new Map([...reviewByNode].map(([node, notes]) => [node, notes.length])),
    [reviewByNode],
  );
  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data),
    [catalogQuery.data],
  );

  if (runQuery.data === null) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('runs.notFound.title')}
        description={t('runs.notFound.description')}
        headingLevel={2}
      />
    );
  }
  if (!run) {
    return (
      <Text as="p" variant="muted" className="p-4 text-sm">
        {t('runs.loading')}
      </Text>
    );
  }

  const status = readRunStatus(run.status);
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {t('runs.heading', { automation: run.name })}
        </h2>
        <RunBadge status={status} />
        <Badge variant={run.mode === 'live' ? 'orange' : 'slate'}>
          {t(`runs.mode.${run.mode === 'live' ? 'live' : 'mock'}`)}
        </Badge>
        <span className="text-sm">
          {t('versions.versionLabel', { version: run.version })}
        </span>
        <Text as="span" variant="muted" className="text-xs">
          {t('runs.startedAt', {
            date: formatDate(new Date(run.startedAt), 'long'),
          })}
        </Text>
        {run.finishedAt !== undefined && (
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
          >
            {t('runs.cancel')}
          </Button>
        )}
      </div>

      {refusal !== null && (
        <Alert variant="destructive" description={refusal} />
      )}
      {run.detail !== undefined && (
        <Alert
          variant={status === 'failed' ? 'destructive' : 'info'}
          description={run.detail}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-[24rem] flex-col">
          <AutomationCanvas
            graph={graph}
            positions={positions}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            inspectorId={inspectorId}
            runStatusByNode={runStatusByNode}
            reviewCountByNode={reviewCountByNode}
          />
        </div>
        <NodeInspector
          id={inspectorId}
          node={selectedNode}
          nodeType={nodeTypes.find((def) => def.type === selectedNode?.type)}
          catalogUnavailable={catalogQuery.isError}
          reviewNotes={
            selectedNode ? (reviewByNode.get(selectedNode.id) ?? []) : []
          }
          runView={
            selectedNode ? projection.byNode.get(selectedNode.id) : undefined
          }
          readOnly
          onChange={() => {
            // A recorded run is history: the inspector renders it read-only.
          }}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 id={effectsHeadingId} className="text-sm font-semibold">
          {t('runs.effects.title', { count: projection.effects.length })}
        </h3>
        <Text as="p" variant="muted" className="text-xs">
          {t('runs.effects.description')}
        </Text>
        <EffectList
          effects={projection.effects}
          emptyMessage={t('runs.effects.none')}
          headingId={effectsHeadingId}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('runs.inputTitle')}</h3>
          <JsonViewer data={run.input} collapsed={1} />
        </section>
        {run.output !== undefined && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('runs.outputTitle')}</h3>
            <JsonViewer data={run.output} collapsed={1} />
          </section>
        )}
      </div>
    </div>
  );
}
