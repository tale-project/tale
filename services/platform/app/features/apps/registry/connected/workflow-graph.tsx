'use client';

/**
 * Connected `WorkflowGraph` block — renders the app's workflow as a read-only
 * DAG, reusing the automations editor's layout + canvas stack (ELK auto-layout +
 * `@xyflow/react`) rather than rebuilding a graph. Binds the allowlisted
 * `readWorkflow` action (one-shot; the definition is static), maps `config.steps`
 * into the editor's `StepDef` shape, lays them out with `useAutomationLayout`, and
 * draws them in a fixed-height `FlowCanvas` with dragging/connecting/selecting
 * disabled. The Section header action deep-links to the full workflow editor.
 */
import { Button } from '@tale/ui/button';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  BackgroundVariant,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react';
import { GitBranch, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { AutomationCallbacksProvider } from '@/app/features/automations/components/automation-callbacks-context';
import { AutomationEdge } from '@/app/features/automations/components/automation-edge';
import { AutomationGroupNode } from '@/app/features/automations/components/automation-group-node';
import { AutomationLoopContainer } from '@/app/features/automations/components/automation-loop-container';
import { AutomationStep } from '@/app/features/automations/components/automation-step';
import { useAutomationLayout } from '@/app/features/automations/hooks/use-automation-layout';
import type {
  StepConfig,
  StepDef,
  StepType,
} from '@/app/features/automations/utils/step-icons';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useAppRuntime } from '../../runtime/app-runtime';
import { Section } from './section';

export interface WorkflowGraphProps {
  title?: string;
  workflowSlug: string;
}

// The same node/edge renderers the editor canvas uses — reused read-only.
const nodeTypes = {
  custom: AutomationStep,
  group: AutomationGroupNode,
  loopContainer: AutomationLoopContainer,
};
const edgeTypes = {
  smoothstep: AutomationEdge,
  default: AutomationEdge,
};

const STEP_TYPES: readonly StepType[] = [
  'start',
  'trigger',
  'llm',
  'condition',
  'action',
  'loop',
  'output',
  'sandbox',
];

function isStepType(v: unknown): v is StepType {
  return typeof v === 'string' && (STEP_TYPES as readonly string[]).includes(v);
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

/** Map a file-based workflow step (JSON record) into the editor's `StepDef`. */
function toStepDef(raw: Record<string, unknown>, index: number): StepDef {
  const slug = str(raw, 'stepSlug') || `step-${index}`;
  const nextSteps: Record<string, string> = {};
  if (isRecord(raw.nextSteps)) {
    for (const [k, v] of Object.entries(raw.nextSteps)) {
      if (typeof v === 'string') nextSteps[k] = v;
    }
  }
  return {
    _id: slug,
    _creationTime: 0,
    organizationId: '',
    wfDefinitionId: '',
    stepSlug: slug,
    name: str(raw, 'name') || slug,
    description: str(raw, 'description') || undefined,
    stepType: isStepType(raw.stepType) ? raw.stepType : 'action',
    order: typeof raw.order === 'number' ? raw.order : index,
    nextSteps,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw config narrowed to a record; StepConfig is a record-with-optional-type superset read defensively downstream
    config: (isRecord(raw.config) ? raw.config : {}) as StepConfig,
  };
}

function extractSteps(result: unknown): StepDef[] {
  if (
    isRecord(result) &&
    result.ok === true &&
    isRecord(result.config) &&
    Array.isArray(result.config.steps)
  ) {
    return result.config.steps.filter(isRecord).map(toStepDef);
  }
  return [];
}

const noop = () => {};

function GraphCanvas({ steps }: { steps: StepDef[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- without explicit Edge, TS infers never[]
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { initialNodes, initialEdges } = useAutomationLayout(steps);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <ReactFlowProvider>
      <AutomationCallbacksProvider
        onNodeClick={noop}
        onAddStep={noop}
        onAddStepOnEdge={noop}
        onDeleteEdge={noop}
      >
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          backgroundProps={{
            variant: BackgroundVariant.Dots,
            gap: 20,
            size: 2,
            color: 'hsl(var(--muted-foreground) / 0.2)',
          }}
        />
      </AutomationCallbacksProvider>
    </ReactFlowProvider>
  );
}

export function WorkflowGraph({ title, workflowSlug }: WorkflowGraphProps) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const navigate = useNavigate();
  const read = useBoundAction('workflows/file_actions:readWorkflow', 'action');
  const readRef = useRef(read);
  readRef.current = read;

  const [steps, setSteps] = useState<StepDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await readRef.current.dispatch({
          organizationId: '$orgId',
          workflowSlug,
        });
        if (!cancelled) setSteps(extractSteps(result));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowSlug]);

  const openEditor = useMemo(
    () => () =>
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: workflowSlug },
      }),
    [navigate, organizationId, workflowSlug],
  );

  return (
    <Section
      title={title}
      icon={GitBranch}
      action={
        <Button size="sm" variant="secondary" onClick={openEditor}>
          <Pencil className="size-4" />
          {t('workflow.openEditor')}
        </Button>
      }
    >
      {error ? (
        <Text variant="error">{t('workflow.error', { error })}</Text>
      ) : loading && steps.length === 0 ? (
        <SkeletonText lines={4} />
      ) : steps.length === 0 ? (
        <Text variant="muted">{t('workflow.none')}</Text>
      ) : (
        <div className="bg-background h-[380px] w-full overflow-hidden rounded-md border">
          <GraphCanvas steps={steps} />
        </div>
      )}
    </Section>
  );
}
