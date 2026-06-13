'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Text } from '@tale/ui/text';
import {
  Panel,
  useNodesInitialized,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Loader2, Network, Plus, Save, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { useElkLayout } from '@/app/components/flow/layout/use-elk-layout';
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
  const { t: tCommon } = useT('common');
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
      // Reseed the baseline from the authoritative server state.
      const result = await refetch();
      const fresh = buildReportsMap(result.data?.nodes ?? []);
      overrideConfig(fresh);
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

  if (!isLoading && (chart?.nodes.length ?? 0) === 0) {
    return <EmptyState icon={Network} title={t('empty.noAgents')} />;
  }

  return (
    <div className="border-border flex h-[calc(100vh-220px)] min-h-105 overflow-hidden rounded-lg border">
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
          {canEdit && isDirty && (
            <Panel position="top-right" className="m-3">
              <div className="ring-border bg-background flex items-center gap-2 rounded-lg p-1.5 pl-3 shadow-sm ring-1">
                <Text variant="muted" className="text-xs">
                  {t('unsavedChanges')}
                </Text>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Undo2}
                  iconClassName="size-3.5"
                  disabled={isSaving}
                  onClick={resetConfig}
                >
                  {tCommon('actions.discard')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSaving}
                  aria-busy={isSaving ? 'true' : undefined}
                  onClick={() => void handleSave()}
                >
                  {isSaving ? (
                    <Loader2 className="size-3.5 animate-spin sm:mr-1.5" />
                  ) : (
                    <Save className="size-3.5 sm:mr-1.5" />
                  )}
                  {isSaving
                    ? tCommon('actions.saving')
                    : tCommon('actions.save')}
                </Button>
              </div>
            </Panel>
          )}
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

      {canEdit && (
        <CreateAgentDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          onCreated={(agentName) => {
            setCreateOpen(false);
            // Pull the chart (action-backed, non-reactive) and land on the
            // new agent so its delegation can be wired up immediately.
            void refetch().then(() => setSelectedSlug(agentName));
          }}
        />
      )}
    </div>
  );
}
