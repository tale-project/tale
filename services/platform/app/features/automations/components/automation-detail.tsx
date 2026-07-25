'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Play, SearchX, Save } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { NodeDef, Workflow } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import { useSaveAutomation, useStartAutomationRun } from '../hooks/mutations';
import {
  useAutomation,
  useAutomationRuns,
  useAutomationVersions,
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
import { nodeStatusMap, projectRun } from '../lib/run-view';
import { automationSlugToParam } from '../lib/slug';
import { AutomationCanvas } from './automation-canvas';
import { NeedsReviewPanel } from './needs-review-panel';
import { NodeInspector } from './node-inspector';
import { RunList } from './run-list';
import { VersionList } from './version-list';

/**
 * Every field of a node a patch may clear. Spelling them out keeps the unset
 * path typed — `delete` needs a key the compiler knows is optional — and the
 * list is checked against `NodeDef` itself, so a field added to the document
 * grammar cannot silently become unclearable.
 */
const CLEARABLE_NODE_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
  'maxRepeats',
  'onError',
  'input',
  'code',
  'prompt',
  'system',
  'model',
  'outputSchema',
  'workflow',
] as const satisfies readonly Exclude<keyof NodeDef, 'id' | 'type'>[];

/** Apply one node patch to a document, dropping the fields the patch clears. */
function patchNode(
  workflow: Workflow,
  nodeId: string,
  patch: Partial<NodeDef>,
): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const next: NodeDef = { ...node, ...patch };
      for (const field of CLEARABLE_NODE_FIELDS) {
        // `undefined` in a patch means "unset": a cleared `when` must leave the
        // document, not sit in it as an empty condition the engine would read.
        if (field in patch && patch[field] === undefined) delete next[field];
      }
      return next;
    }),
  };
}

/**
 * One automation: its document on the canvas, its history, and its runs.
 *
 * The page always shows a stored VERSION — versions are immutable, so what is
 * drawn is exactly what was saved and exactly what a run of that version will
 * do. Editing builds a draft in the browser; saving appends a NEW version
 * rather than changing the one on screen, which is what keeps a live automation
 * from changing under a run already in flight.
 *
 * The most recent run is laid over the canvas by default, because the first
 * question anyone opening an automation has is "did the last one work".
 */
export function AutomationDetail({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Render inside a project shell: run links stay on the project routes and
   * a first save pins the automation to the project. */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const inspectorId = useId();
  const saveMessageId = useId();
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(
    undefined,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showLastRun, setShowLastRun] = useState(true);

  const automationQuery = useAutomation(
    organizationId,
    automationSlug,
    selectedVersion,
  );
  const versionsQuery = useAutomationVersions(organizationId, automationSlug);
  const runsQuery = useAutomationRuns(organizationId, automationSlug, 20);
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const save = useSaveAutomation();
  const startRun = useStartAutomationRun();

  const stored = useMemo(
    () => readDocument(automationQuery.data?.document),
    [automationQuery.data?.document],
  );
  const workflow = draft ?? stored;
  const graph = useMemo(() => buildGraph(workflow), [workflow]);
  const positions = useMemo(() => readPositions(workflow), [workflow]);
  const reviewNotes = useMemo(() => readReviewNotes(workflow), [workflow]);
  const reviewByNode = useMemo(
    () => reviewNotesByNode(reviewNotes),
    [reviewNotes],
  );
  const reviewCountByNode = useMemo(
    () =>
      new Map([...reviewByNode].map(([node, notes]) => [node, notes.length])),
    [reviewByNode],
  );

  const runs = runsQuery.data ?? [];
  const lastRun = runs[0];
  const lastRunProjection = useMemo(
    () => projectRun(showLastRun ? lastRun : null),
    [showLastRun, lastRun],
  );
  const runStatusByNode = useMemo(
    () =>
      showLastRun && lastRun
        ? nodeStatusMap(
            lastRunProjection,
            graph.nodes.map((node) => node.id),
          )
        : undefined,
    [showLastRun, lastRun, lastRunProjection, graph.nodes],
  );

  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data),
    [catalogQuery.data],
  );

  const onChangeNode = useCallback(
    (patch: Partial<NodeDef>) => {
      if (!workflow || selectedNodeId === null) return;
      setDraft(patchNode(workflow, selectedNodeId, patch));
    },
    [workflow, selectedNodeId],
  );

  if (automationQuery.data === null) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('notFound.title')}
        description={t('notFound.description')}
        headingLevel={2}
      />
    );
  }
  if (!workflow) {
    return (
      <Text as="p" variant="muted" className="p-4 text-sm">
        {t('detail.loading')}
      </Text>
    );
  }

  const meta = automationQuery.data;
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const isDirty = draft !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{automationSlug}</h2>
        {meta && (
          <Badge variant="slate">
            {t('versions.versionLabel', { version: meta.version })}
          </Badge>
        )}
        {meta?.deployedVersion !== undefined && (
          <Badge variant="green" icon={CheckCircle2}>
            {t('detail.deployedVersion', { version: meta.deployedVersion })}
          </Badge>
        )}
        {isDirty && <Badge variant="yellow">{t('detail.unsaved')}</Badge>}
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          icon={Play}
          isLoading={startRun.isPending}
          onClick={() => {
            setRefusal(null);
            startRun.mutate(
              { organizationId, name: automationSlug, mode: 'mock' },
              {
                onError: (error) => {
                  setRefusal(automationErrorMessage(error));
                },
              },
            );
          }}
        >
          {t('detail.runMock')}
        </Button>
      </div>

      {workflow.description !== undefined && (
        <Text as="p" variant="muted" className="text-sm">
          {workflow.description}
        </Text>
      )}

      {refusal !== null && (
        <Alert variant="destructive" description={refusal} />
      )}

      <NeedsReviewPanel notes={reviewNotes} onSelectNode={setSelectedNodeId} />

      {lastRun && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showLastRun}
            onClick={() => {
              setShowLastRun((shown) => !shown);
            }}
          >
            {showLastRun ? t('detail.hideLastRun') : t('detail.showLastRun')}
          </Button>
          {projectId ? (
            <Link
              to="/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$executionId"
              params={{
                id: organizationId,
                projectId,
                automationSlug: automationSlugToParam(automationSlug),
                executionId: lastRun.id,
              }}
              className="focus-visible:ring-ring text-sm underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {t('detail.openLastRun')}
            </Link>
          ) : (
            <Link
              to="/dashboard/$id/automations/$automationSlug/runs/$runId"
              params={{
                id: organizationId,
                automationSlug: automationSlugToParam(automationSlug),
                runId: lastRun.id,
              }}
              className="focus-visible:ring-ring text-sm underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {t('detail.openLastRun')}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-[26rem] flex-col">
          <AutomationCanvas
            graph={graph}
            positions={positions}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            inspectorId={inspectorId}
            {...(runStatusByNode !== undefined && { runStatusByNode })}
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
            selectedNode && showLastRun
              ? lastRunProjection.byNode.get(selectedNode.id)
              : undefined
          }
          readOnly={false}
          onChange={onChangeNode}
        />
      </div>

      <div className="border-border flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <Field
          label={t('detail.saveMessageLabel')}
          htmlFor={saveMessageId}
          description={t('detail.saveMessageDescription')}
          className="min-w-[16rem] flex-1"
        >
          <Input
            id={saveMessageId}
            value={saveMessage}
            onChange={(event) => {
              setSaveMessage(event.target.value);
            }}
          />
        </Field>
        <Button
          icon={Save}
          isLoading={save.isPending}
          disabled={!isDirty}
          disabledReason={t('detail.nothingToSave')}
          onClick={() => {
            setRefusal(null);
            save.mutate(
              {
                organizationId,
                workflow,
                ...(saveMessage !== '' && { message: saveMessage }),
                // Pins a NEW automation to this project; an existing one
                // keeps its owner (the store refuses a mismatch).
                ...(projectId !== undefined && { projectId }),
              },
              {
                onSuccess: () => {
                  setDraft(null);
                  setSaveMessage('');
                  setSelectedVersion(undefined);
                },
                onError: (error) => {
                  setRefusal(automationErrorMessage(error));
                },
              },
            );
          }}
        >
          {t('detail.saveVersion')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <VersionList
          organizationId={organizationId}
          name={automationSlug}
          versions={versionsQuery.data ?? []}
          deployedVersion={meta?.deployedVersion}
          selectedVersion={selectedVersion ?? meta?.version}
          onSelectVersion={(version) => {
            setDraft(null);
            setSelectedVersion(version);
          }}
        />
        <RunList
          organizationId={organizationId}
          automationSlug={automationSlug}
          runs={runs}
          {...(projectId !== undefined && { projectId })}
        />
      </div>
    </div>
  );
}
