'use client';

import { EmptyState } from '@tale/ui/empty-state';
import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { Network } from 'lucide-react';
import { useMemo, useState } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { AutomationAIChatPanel } from '@/app/features/automations/components/automation-ai-chat-panel';
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
 * The organigram: the agents-only, many-to-many DELEGATION graph on the shared
 * {@link FlowCanvas}. The graph is read-only on the canvas — all editing
 * happens in the side panel (or the AI editor), exactly like the automations
 * editor. The chart is functionally load-bearing: delegation, decomposition,
 * SLA escalation, and budget handoff all read these edges.
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
  const { chart, isLoading } = useOrgChart(organizationId);
  const setDelegates = useSetAgentDelegates(organizationId);
  const setParents = useSetAgentParents(organizationId);
  const [selectedSlug, setSelectedSlug] = useState(focusSlug ?? null);
  const [aiOpen, setAiOpen] = useState(false);

  const { nodes, edges } = useMemo(
    () => layoutOrgChart(chart?.nodes ?? [], selectedSlug),
    [chart, selectedSlug],
  );
  const selected =
    chart?.nodes.find((node) => node.slug === selectedSlug) ?? null;

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
          onOpenAi={canEdit ? () => setAiOpen(true) : undefined}
        />
      </div>

      {aiOpen && (
        <AutomationAIChatPanel
          mode="organigram"
          organizationId={organizationId}
          onClose={() => setAiOpen(false)}
          overlay
        />
      )}

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
    </div>
  );
}
