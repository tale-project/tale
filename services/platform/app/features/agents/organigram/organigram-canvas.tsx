'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Row } from '@tale/ui/layout';
import {
  useNodesInitialized,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Network, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { useElkLayout } from '@/app/components/flow/layout/use-elk-layout';
import {
  useRegisterActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { useConfigDirtyState } from '@/app/components/ui/editor/use-config-dirty-state';
import { useRegisterDirtySource } from '@/app/components/ui/editor/use-dirty-source';
import { CreateAgentDialog } from '@/app/features/agents/components/agent-create-dialog';
import { AutomationEdge } from '@/app/features/automations/components/automation-edge';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { AgentOrgNode } from './agent-org-node';
import { useOrgChart } from './hooks';
import { HumansNode } from './humans-node';
import {
  applyDraft,
  buildReportsMap,
  changedReportSlugs,
  recomputeDerived,
  reportsEqual,
  setDelegatesInDraft,
  setParentsInDraft,
  type ReportsMap,
} from './organigram-draft';
import {
  buildOrgGraph,
  HUMANS_NODE_ID,
  ORG_ELK_OPTIONS,
} from './organigram-layout';
import { OrganigramPanel } from './organigram-panel';

// The organigram commits every touched agent at once, so it has no per-tab
// dirty keys to surface as a dot — a stable empty set keeps the controller
// literal referentially cheap.
const EMPTY_DIRTY_KEYS: ReadonlySet<string> = new Set();

const nodeTypes: NodeTypes = { agent: AgentOrgNode, humans: HumansNode };
// Reuse the automations edge renderer so the chart's arrows match the canvas.
const edgeTypes: EdgeTypes = {
  smoothstep: AutomationEdge,
  default: AutomationEdge,
};

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data: unknown }).data;
    if (data && typeof data === 'object' && 'code' in data) {
      const code = (data as { code: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
  }
  return undefined;
}

/**
 * Center the viewport on one node once the graph has measured — the per-agent
 * delegation tab's "show ME on the chart" affordance. Renders inside
 * <FlowCanvas> (needs the React Flow store) and fires exactly once so later
 * user panning isn't fought.
 */
function FocusOnNode({ slug }: { slug: string }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || focusedRef.current) return;
    focusedRef.current = true;
    void fitView({ nodes: [{ id: slug }], maxZoom: 1, padding: 0.4 });
  }, [nodesInitialized, fitView, slug]);
  return null;
}

/**
 * Registers the organigram's staged-draft controller as the active editor so
 * the agents tab strip renders the shared Save/Discard cluster (matching the
 * automation and agent editors) instead of a floating canvas overlay. Rendered
 * only when the user can edit, so a read-only viewer never sees the cluster.
 * Renders nothing.
 */
function OrganigramEditorRegistrar({
  controller,
}: {
  controller: EditorController;
}) {
  useRegisterActiveEditor(controller);
  return null;
}

/**
 * The organigram: the agents-only, many-to-many DELEGATION graph on the shared
 * {@link FlowCanvas}. The graph is read-only on the canvas — all editing
 * happens in the side panel. Edits are STAGED into a draft and only persisted
 * when the user saves (each save writes the touched agents' JSON, snapshotting
 * a new version per agent). The chart is functionally load-bearing:
 * delegation, decomposition, SLA escalation, and budget handoff all read
 * these edges.
 */
export function OrganigramCanvas({
  organizationId,
  canEdit,
  focusSlug,
}: {
  organizationId: string;
  canEdit: boolean;
  /** Pre-select this agent's node (the per-agent delegation tab's view). */
  focusSlug?: string;
}) {
  const { t } = useT('organigram');
  const { chart, isLoading, refetch } = useOrgChart(organizationId);
  const setDelegatesAction = useConvexAction(
    api.agents.org_chart_actions.setAgentDelegates,
  );
  const [selectedSlug, setSelectedSlug] = useState(focusSlug ?? null);
  const [createOpen, setCreateOpen] = useState(false);

  // Server-authoritative outgoing edges; the dirty-state core adopts refetched
  // values only while the draft is clean (creating an agent, post-save), and
  // leaves live edits untouched otherwise.
  const baseline = useMemo(() => buildReportsMap(chart?.nodes ?? []), [chart]);
  const {
    config: draft,
    isDirty,
    isSaving,
    configRef,
    savedConfigRef,
    setConfig,
    resetConfig,
    overrideConfig,
    setIsSaving,
  } = useConfigDirtyState<ReportsMap>({
    initial: baseline,
    equals: reportsEqual,
  });

  // Surface dirty state to the page-level blocker so navigating away with
  // unsaved delegation edits triggers the unified confirm dialog.
  useRegisterDirtySource(isDirty);

  // The draft graph: outgoing edges from the draft, incoming edges recomputed
  // so the chart and panel preview unsaved edits live (same relayout cadence
  // as the previous immediate-save model, which relaid out on every refetch).
  const derivedNodes = useMemo(
    () => recomputeDerived(applyDraft(chart?.nodes ?? [], draft)),
    [chart, draft],
  );

  // Build the graph once per derived-graph change (selection-independent),
  // position it with ELK, then apply the `selected` flag as a cheap post-step.
  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildOrgGraph(derivedNodes),
    [derivedNodes],
  );
  const { nodes: positioned, edgeRoutes } = useElkLayout(
    rawNodes,
    rawEdges,
    ORG_ELK_OPTIONS,
  );
  const nodes = useMemo(
    () =>
      positioned.map((node) => ({
        ...node,
        selected: node.id === selectedSlug,
      })),
    [positioned, selectedSlug],
  );
  // Draw delegation arrows along ELK's orthogonal routes once layout resolves.
  const edges = useMemo(
    () =>
      rawEdges.map((edge) => {
        const points = edgeRoutes[edge.id];
        if (!points) return edge;
        return { ...edge, data: { ...edge.data, elkPoints: points } };
      }),
    [rawEdges, edgeRoutes],
  );
  const selected =
    derivedNodes.find((node) => node.slug === selectedSlug) ?? null;
  const focusExists =
    !!focusSlug && derivedNodes.some((node) => node.slug === focusSlug);

  // Stage this agent's outgoing edges (its direct reports).
  const handleSetDelegates = useCallback(
    (agentSlug: string, delegateSlugs: string[]) => {
      setConfig((prev) => setDelegatesInDraft(prev, agentSlug, delegateSlugs));
    },
    [setConfig],
  );

  // Stage this agent's incoming edges by adjusting every OTHER agent's
  // outgoing reports so exactly the chosen parents include this agent.
  const handleSetParents = useCallback(
    (agentSlug: string, parentSlugs: string[]) => {
      setConfig((prev) => setParentsInDraft(prev, agentSlug, parentSlugs));
    },
    [setConfig],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    const current = configRef.current;
    const base = savedConfigRef.current;
    try {
      // Persist only the agents whose outgoing edge set actually changed; each
      // write snapshots that agent's prior JSON as a new version on disk.
      const changed = changedReportSlugs(current, base);
      for (const slug of changed) {
        await setDelegatesAction.mutateAsync({
          organizationId,
          agentSlug: slug,
          delegateSlugs: current[slug] ?? [],
        });
      }
      toast({ title: t('saved'), variant: 'success' });
    } catch (error) {
      const code = errorCode(error);
      toast({
        title:
          code === 'SELF_EDGE'
            ? t('errors.self')
            : code === 'FORBIDDEN_DEVELOPER_SETTINGS'
              ? t('errors.forbidden')
              : t('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      // Always reseed the baseline from authoritative server state — even on a
      // PARTIAL failure. The loop persists agents one at a time, so a mid-loop
      // throw leaves the already-written agents committed on disk; without this
      // resync their saved edges keep reading as unsaved and Discard would
      // revert them to a stale baseline.
      try {
        const result = await refetch();
        overrideConfig(buildReportsMap(result.data?.nodes ?? []));
      } catch (reseedError) {
        console.error(
          '[organigram] baseline reseed after save failed',
          reseedError,
        );
      }
      setIsSaving(false);
    }
  }, [
    configRef,
    organizationId,
    overrideConfig,
    refetch,
    savedConfigRef,
    setDelegatesAction,
    setIsSaving,
    t,
  ]);

  // The unified editor contract the agents tab strip consumes via
  // `useActiveEditor` → `EditorActions`. The organigram is always valid (there
  // are no per-field validation gates), so `isValid` is constant; `isLoading`
  // gates Save while the chart is still fetching.
  const editorController: EditorController = useMemo(
    () => ({
      isDirty,
      isSaving,
      isValid: true,
      isLoading,
      dirtyKeys: EMPTY_DIRTY_KEYS,
      save: handleSave,
      reset: resetConfig,
    }),
    [isDirty, isSaving, isLoading, handleSave, resetConfig],
  );

  // Rendered in both the empty state and the populated canvas, so define it
  // once. Pulls the chart (action-backed, non-reactive) and lands on the new
  // agent so its delegation can be wired up immediately.
  const createDialog = canEdit && (
    <CreateAgentDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      organizationId={organizationId}
      onCreated={(agentName) => {
        setCreateOpen(false);
        void refetch().then(() => setSelectedSlug(agentName));
      }}
    />
  );

  if (!isLoading && (chart?.nodes.length ?? 0) === 0) {
    return (
      <>
        <EmptyState
          icon={Network}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            canEdit ? (
              <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                {t('addAgent')}
              </Button>
            ) : undefined
          }
        />
        {createDialog}
      </>
    );
  }

  return (
    <Row
      gap={0}
      align="stretch"
      className="border-border h-[calc(100vh-220px)] min-h-105 overflow-hidden rounded-lg border"
    >
      {/* Save/Discard live in the agents tab strip (shared EditorActions),
          not on the canvas — register the controller so the strip can drive
          them. Edit-only; a viewer never registers. */}
      {canEdit && <OrganigramEditorRegistrar controller={editorController} />}
      <div className="relative min-w-0 flex-1">
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            if (node.id === HUMANS_NODE_ID) return;
            setSelectedSlug(node.id);
          }}
          onPaneClick={() => setSelectedSlug(null)}
          minZoom={0.3}
          maxZoom={1.5}
          backgroundProps={{ gap: 24 }}
          centerActions={
            canEdit ? (
              <Button
                size="icon"
                variant="secondary"
                aria-label={t('addAgent')}
                title={t('addAgent')}
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
              </Button>
            ) : undefined
          }
        >
          {focusSlug && focusExists && <FocusOnNode slug={focusSlug} />}
        </FlowCanvas>
      </div>

      {selected && (
        <OrganigramPanel
          organizationId={organizationId}
          node={selected}
          allNodes={derivedNodes}
          canEdit={canEdit}
          isSaving={isSaving}
          onSetParents={(parentSlugs) =>
            handleSetParents(selected.slug, parentSlugs)
          }
          onSetDelegates={(delegateSlugs) =>
            handleSetDelegates(selected.slug, delegateSlugs)
          }
          onClose={() => setSelectedSlug(null)}
        />
      )}

      {createDialog}
    </Row>
  );
}
