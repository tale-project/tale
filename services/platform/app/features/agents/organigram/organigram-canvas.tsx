'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import {
  useNodesInitialized,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Network, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { CreateAgentDialog } from '@/app/features/agents/components/agent-create-dialog';
import { AutomationEdge } from '@/app/features/automations/components/automation-edge';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { AgentOrgNode } from './agent-org-node';
import { useOrgChart, useSetAgentDelegates, useSetAgentParents } from './hooks';
import { HumansNode } from './humans-node';
import { HUMANS_NODE_ID, layoutOrgChart } from './organigram-layout';
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
 * happens in the side panel. The chart is functionally load-bearing:
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
  const setDelegates = useSetAgentDelegates(organizationId);
  const setParents = useSetAgentParents(organizationId);
  const [selectedSlug, setSelectedSlug] = useState(focusSlug ?? null);
  const [createOpen, setCreateOpen] = useState(false);

  const { nodes, edges } = useMemo(
    () => layoutOrgChart(chart?.nodes ?? [], selectedSlug),
    [chart, selectedSlug],
  );
  const selected =
    chart?.nodes.find((node) => node.slug === selectedSlug) ?? null;
  const focusExists =
    !!focusSlug &&
    (chart?.nodes.some((node) => node.slug === focusSlug) ?? false);

  const isSaving = setDelegates.isPending || setParents.isPending;

  const onError = (error: unknown) => {
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
  };

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
          {focusSlug && focusExists && <FocusOnNode slug={focusSlug} />}
        </FlowCanvas>
      </div>

      {selected && chart && (
        <OrganigramPanel
          organizationId={organizationId}
          node={selected}
          allNodes={chart.nodes}
          canEdit={canEdit}
          isSaving={isSaving}
          onSetParents={(parentSlugs) =>
            setParents.mutate(
              { agentSlug: selected.slug, parentSlugs },
              { onError },
            )
          }
          onSetDelegates={(delegateSlugs) =>
            setDelegates.mutate(
              { agentSlug: selected.slug, delegateSlugs },
              { onError },
            )
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
