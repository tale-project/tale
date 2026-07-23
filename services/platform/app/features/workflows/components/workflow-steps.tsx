'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { Edge, Node } from '@xyflow/react';
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
  BackgroundVariant,
  Panel,
  useReactFlow,
} from '@xyflow/react';
import { TestTubeDiagonal, X, AlertTriangle, Plus } from 'lucide-react';
import React, { useEffect, useState, useRef, useCallback } from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { useAutomationScheduleReadiness } from '@/app/features/automations/hooks/use-automation-schedule-readiness';
import { useUrlState } from '@/app/hooks/use-url-state';
import { parseDebugWaitingFor } from '@/convex/workflow_engine/helpers/engine/debug_gate';
import { useT } from '@/lib/i18n/client';

import { useWorkflowLayout } from '../hooks/use-workflow-layout';
import { getStepMinimapStroke, type StepDef } from '../utils/step-icons';
import {
  WORKFLOW_EXECUTION_URL_DEFINITIONS,
  useViewedExecution,
} from './execution-status-context';
import { WorkflowCallbacksProvider } from './workflow-callbacks-context';
import { WorkflowEdge } from './workflow-edge';
import { WorkflowGroupNode } from './workflow-group-node';
import { WorkflowLoopContainer } from './workflow-loop-container';
import {
  computeMinimapDimensions,
  type MinimapDimensions,
} from './workflow-minimap-dimensions';
import { WorkflowStep } from './workflow-step';

interface WorkflowStepsProps {
  /** The Graph ⇄ Specification mode toggle — leads the bottom-center toolbar. */
  viewToggle?: React.ReactNode;
  steps: StepDef[];
  className?: string;
  hasActiveTrigger: boolean;
  /** The owning automation's setup isn't complete — suppress the "workflow is
   *  active" banner, since it can't actually run yet. */
  setupIncomplete?: boolean;
  onStepCreated?: () => void;
  onOpenAIChat?: () => void;
  /** Whether the AI assistant panel is open — makes the canvas ✨ button a
   *  toggle (pressed state) instead of a one-way open. */
  isAIChatOpen?: boolean;
}

const nodeTypes = {
  custom: WorkflowStep,
  group: WorkflowGroupNode,
  loopContainer: WorkflowLoopContainer,
};

const edgeTypes = {
  smoothstep: WorkflowEdge,
  default: WorkflowEdge,
};

export const WORKFLOW_PANEL_URL_DEFINITIONS = {
  panel: { default: null },
  step: { default: null },
} as const;

const RUN_STATUS_BADGE_VARIANTS: Record<
  string,
  'green' | 'destructive' | 'blue' | 'outline' | 'yellow'
> = {
  completed: 'green',
  failed: 'destructive',
  running: 'blue',
  pending: 'outline',
  waiting: 'yellow',
  paused: 'yellow',
};

const MINIMAP_STYLES = `
  .react-flow__edges { z-index: auto; }
  .react-flow__nodes { z-index: auto; }
  .react-flow__edge { z-index: 0; }
  .react-flow__node { z-index: 1; }
  .react-flow__minimap {
    background-color: hsl(var(--muted)) !important;
    overflow: hidden !important;
  }
  .react-flow__minimap svg { overflow: hidden !important; }
  .react-flow__minimap-node { fill: hsl(var(--background)) !important; }
  .react-flow__minimap-mask { fill: hsl(var(--muted) / 0.6) !important; }
`;

// Stroke each minimap node in its step type's accent hue via theme-token
// variables (never hex) — applied as an inline style, so it wins over
// xyflow's stylesheet defaults regardless of CSS order.
function minimapNodeStrokeColor(node: Node): string {
  const stepType = node.data?.stepType;
  return getStepMinimapStroke(typeof stepType === 'string' ? stepType : '');
}

function WorkflowStepsInner({
  steps,
  className: _className,
  hasActiveTrigger,
  setupIncomplete,
  onStepCreated: _onStepCreated,
  onOpenAIChat,
  isAIChatOpen,
  viewToggle,
}: WorkflowStepsProps) {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
  const hasSteps = steps && steps.length > 0;

  // Schedule-variable readiness (#2605/#2606 sibling): an ACTIVE schedule
  // missing a required start-schema field WILL fail at fire time, so the
  // "this workflow is active" claim below must not read as "everything will
  // run cleanly" when it can't. Every step already carries its owning org +
  // workflow slug (`StepDef.organizationId` / `wfDefinitionId`), so this
  // reads the SAME readiness signal `useAutomationScheduleReadiness` already
  // surfaces on the automation page's Integrations-tab checklist — without
  // threading new props through the Editor tab's caller chain. Disabled
  // while the banner itself wouldn't show, to skip the query entirely then.
  const firstStep = steps?.[0];
  const { missingFields: missingScheduleFields } =
    useAutomationScheduleReadiness(
      firstStep?.organizationId ?? '',
      firstStep?.wfDefinitionId ?? '',
      hasActiveTrigger && !setupIncomplete && firstStep !== undefined,
    );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- without explicit Edge, TS infers never[]
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { setStates: setPanelStates } = useUrlState({
    definitions: WORKFLOW_PANEL_URL_DEFINITIONS,
  });

  const { executionId: viewedExecutionId, execution: viewedExecution } =
    useViewedExecution();
  const { setState: setExecutionUrlState } = useUrlState({
    definitions: WORKFLOW_EXECUTION_URL_DEFINITIONS,
  });

  const [showActivityBanner, setShowActivityBanner] = useState(true);
  const [minimapDimensions, setMinimapDimensions] =
    useState<MinimapDimensions | null>(null);

  const { fitView, getViewport } = useReactFlow();

  const stepsRef = useRef(steps);
  const edgesRef = useRef<Edge[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const prevContainerWidthRef = useRef(0);
  const hasMeasuredContainerRef = useRef(false);
  const fitViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const WIDTH_CHANGE_THRESHOLD = 50;

    const handleContainerResize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      setMinimapDimensions(computeMinimapDimensions(width, height));

      // Skip the first measurement: ReactFlow's own `fitView` prop already
      // centers the initial graph (instantly). Firing another fitView here on
      // mount caused the second, animated reposition the user saw.
      if (!hasMeasuredContainerRef.current) {
        hasMeasuredContainerRef.current = true;
        prevContainerWidthRef.current = width;
      } else if (
        Math.abs(width - prevContainerWidthRef.current) > WIDTH_CHANGE_THRESHOLD
      ) {
        prevContainerWidthRef.current = width;
        if (fitViewTimerRef.current) clearTimeout(fitViewTimerRef.current);
        fitViewTimerRef.current = setTimeout(() => {
          const currentViewport = getViewport();
          void fitView({
            padding: 0.2,
            duration: 400,
            includeHiddenNodes: false,
            minZoom: currentViewport.zoom,
            maxZoom: currentViewport.zoom,
          });
        }, 100);
      }
    };

    const resizeObserver = new ResizeObserver(handleContainerResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleContainerResize);
    handleContainerResize();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleContainerResize);
      if (fitViewTimerRef.current) clearTimeout(fitViewTimerRef.current);
    };
  }, [fitView, getViewport]);

  const handleNodeClick = useCallback(
    (stepSlug: string) => {
      const step = steps.find((s) => s.stepSlug === stepSlug);
      if (step) {
        setPanelStates({ panel: 'step', step: stepSlug });
      }
    },
    [steps, setPanelStates],
  );

  const handleOpenTestPanel = useCallback(() => {
    setPanelStates({ panel: 'test', step: null });
  }, [setPanelStates]);

  // Surface waiting-for-input and debug pauses as their own banner states;
  // the run row in the executions table applies the same mapping.
  const viewedRunStatus = viewedExecution
    ? viewedExecution.status === 'running' && viewedExecution.waitingFor
      ? parseDebugWaitingFor(viewedExecution.waitingFor)
        ? 'paused'
        : 'waiting'
      : viewedExecution.status
    : null;

  const { initialNodes, initialEdges } = useWorkflowLayout(steps);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <WorkflowCallbacksProvider onNodeClick={handleNodeClick}>
      <Row
        gap={0}
        align="stretch"
        className="relative w-full flex-1 justify-stretch overflow-auto"
      >
        <style>{MINIMAP_STYLES}</style>
        <div ref={containerRef} className="bg-background min-h-0 flex-[1_1_0]">
          <FlowCanvas
            onOpenAi={onOpenAIChat}
            aiOpen={isAIChatOpen}
            centerActions={
              <>
                {viewToggle}
                {/* On-canvas step editing is not wired up yet. Keep the
                    affordance visible but disabled — with a tooltip pointing to
                    the working paths — instead of opening a create form that
                    silently no-ops on submit. */}
                <Button
                  size="icon"
                  variant="secondary"
                  title={t('steps.toolbar.addStepUnavailable')}
                  aria-label={t('steps.toolbar.addStepUnavailable')}
                  disabled
                >
                  <Plus className="size-4" />
                </Button>

                <Button
                  variant="secondary"
                  size="icon"
                  title={t('steps.toolbar.testWorkflow')}
                  aria-label={t('steps.toolbar.testWorkflow')}
                  onClick={handleOpenTestPanel}
                  disabled={steps.length === 0}
                >
                  <TestTubeDiagonal className="size-4" />
                </Button>
              </>
            }
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            // No fitView `duration`: the INITIAL fit must snap so the graph
            // appears already centered instead of visibly panning from the
            // top-left corner. Later re-fits (container resize) animate via the
            // explicit `fitView({ duration })` call in the resize observer.
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
            minZoom={0.2}
            maxZoom={2}
            elevateEdgesOnSelect={false}
            elevateNodesOnSelect={false}
            selectNodesOnDrag={false}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: false,
              style: { strokeWidth: 2 },
              zIndex: 0,
            }}
            // The on-canvas editor is read-only: steps and connections are
            // edited via the AI assistant or the workflow config, not by
            // drag-connecting nodes or deleting edges here. Disabling these
            // ReactFlow affordances keeps the canvas honest rather than
            // presenting controls that silently no-op. `deleteKeyCode={null}`
            // is required — omitting it leaves ReactFlow's default 'Backspace'
            // edge deletion enabled.
            deleteKeyCode={null}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable
            edgesFocusable
            multiSelectionKeyCode={['Meta', 'Ctrl']}
            minimapProps={
              minimapDimensions
                ? {
                    className:
                      'border-border overflow-hidden rounded-lg border shadow-sm',
                    style: {
                      width: minimapDimensions.width,
                      height: minimapDimensions.height,
                    },
                    nodeStrokeColor: minimapNodeStrokeColor,
                    nodeStrokeWidth: 3,
                    pannable: true,
                    zoomable: true,
                    inversePan: false,
                  }
                : undefined
            }
            backgroundProps={{
              variant: BackgroundVariant.Dots,
              gap: 20,
              size: 2,
              color: 'hsl(var(--muted-foreground) / 0.2)',
            }}
          >
            {!hasSteps && (
              <Row
                gap={0}
                justify="center"
                className="pointer-events-none absolute inset-0"
              >
                <Stack gap={2} className="text-center">
                  <Text as="div" variant="muted">
                    {t('emptyState.noSteps')}
                  </Text>
                  <Text as="div" variant="muted">
                    {t('emptyState.createStepsHint')}
                  </Text>
                </Stack>
              </Row>
            )}

            {((showActivityBanner && hasActiveTrigger && !setupIncomplete) ||
              viewedExecutionId) && (
              <Panel position="top-center" className="mx-4 mt-4 w-full px-4">
                <Stack gap={2} className="mx-auto max-w-3xl">
                  {showActivityBanner &&
                    hasActiveTrigger &&
                    !setupIncomplete && (
                      <Alert
                        variant="warning"
                        icon={AlertTriangle}
                        className="shadow-sm"
                      >
                        <Row className="items-center justify-between gap-2">
                          <Text className="text-sm">
                            {missingScheduleFields.length > 0
                              ? t(
                                  'steps.banners.hasActiveTriggersScheduleGap',
                                  {
                                    fields: missingScheduleFields.join(', '),
                                  },
                                )
                              : t('steps.banners.hasActiveTriggers')}
                          </Text>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={tCommon('aria.dismiss')}
                            aria-label={tCommon('aria.dismiss')}
                            className="size-6 shrink-0 p-1"
                            onClick={() => setShowActivityBanner(false)}
                          >
                            <X className="size-4" />
                          </Button>
                        </Row>
                      </Alert>
                    )}
                  {viewedExecutionId && (
                    <div
                      className="bg-background ring-border flex items-center gap-2.5 rounded-lg px-4 py-2 shadow-sm ring-1"
                      role="status"
                      aria-live="polite"
                    >
                      <Text className="text-sm">
                        {t('steps.execution.viewingRun', {
                          id: viewedExecutionId.slice(-6),
                        })}
                      </Text>
                      {viewedRunStatus && (
                        <Badge
                          dot
                          variant={
                            RUN_STATUS_BADGE_VARIANTS[viewedRunStatus] ||
                            'outline'
                          }
                          className="text-xs"
                        >
                          {t(`steps.execution.status.${viewedRunStatus}`)}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('steps.execution.clear')}
                        aria-label={t('steps.execution.clear')}
                        className="ml-auto size-6 shrink-0 p-1"
                        onClick={() => setExecutionUrlState('execution', null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  )}
                </Stack>
              </Panel>
            )}
          </FlowCanvas>
        </div>
      </Row>
    </WorkflowCallbacksProvider>
  );
}

export function WorkflowSteps(props: WorkflowStepsProps) {
  return (
    <ReactFlowProvider>
      <WorkflowStepsInner {...props} />
    </ReactFlowProvider>
  );
}
