'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { Connection, Edge, Node } from '@xyflow/react';
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
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from 'react';

import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { toast } from '@/app/hooks/use-toast';
import { useUrlState } from '@/app/hooks/use-url-state';
import { parseDebugWaitingFor } from '@/convex/workflow_engine/helpers/engine/debug_gate';
import { useT } from '@/lib/i18n/client';

import { useAutomationLayout } from '../hooks/use-automation-layout';
import {
  getStepActionType,
  type StepConfig,
  type StepDef,
  type StepType,
} from '../utils/step-icons';
import { AutomationCallbacksProvider } from './automation-callbacks-context';
import { AutomationEdge } from './automation-edge';
import { AutomationGroupNode } from './automation-group-node';
import { AutomationLoopContainer } from './automation-loop-container';
import { AutomationStep } from './automation-step';
import {
  AUTOMATION_EXECUTION_URL_DEFINITIONS,
  useViewedExecution,
} from './execution-status-context';
import { CreateStepDialog } from './step-create-dialog';

interface AutomationStepsProps {
  steps: StepDef[];
  className?: string;
  hasActiveTrigger: boolean;
  onStepCreated?: () => void;
  onOpenAIChat?: () => void;
}

const nodeTypes = {
  custom: AutomationStep,
  group: AutomationGroupNode,
  loopContainer: AutomationLoopContainer,
};

const edgeTypes = {
  smoothstep: AutomationEdge,
  default: AutomationEdge,
};

export const AUTOMATION_PANEL_URL_DEFINITIONS = {
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

function minimapNodeStrokeColor(node: Node): string {
  const stepType = node.data?.stepType;
  switch (stepType) {
    case 'start':
      return '#3b82f6';
    case 'llm':
      return '#a855f7';
    case 'condition':
      return '#f59e0b';
    case 'loop':
      return '#06b6d4';
    case 'action':
      return '#f97316';
    default:
      return '#71717a';
  }
}

function AutomationStepsInner({
  steps,
  className: _className,
  hasActiveTrigger,
  onStepCreated: _onStepCreated,
  onOpenAIChat,
}: AutomationStepsProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const hasSteps = steps && steps.length > 0;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- without explicit Edge, TS infers never[]
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isCreateStepDialogOpen, setIsCreateStepDialogOpen] = useState(false);

  const { setStates: setPanelStates } = useUrlState({
    definitions: AUTOMATION_PANEL_URL_DEFINITIONS,
  });

  const { executionId: viewedExecutionId, execution: viewedExecution } =
    useViewedExecution();
  const { setState: setExecutionUrlState } = useUrlState({
    definitions: AUTOMATION_EXECUTION_URL_DEFINITIONS,
  });

  const [_parentStepForNewStep, setParentStepForNewStep] = useState<
    string | null
  >(null);
  const [_edgeToInsertStep, setEdgeToInsertStep] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [showActivityBanner, setShowActivityBanner] = useState(true);
  const [minimapDimensions, setMinimapDimensions] = useState({
    width: 192,
    height: 128,
  });

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

    const MINIMAP_BASE_WIDTH = 144;
    const MINIMAP_MAX_WIDTH = 192;
    const WIDTH_CHANGE_THRESHOLD = 50;

    const handleContainerResize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      const aspectRatio = width / height;
      const isMobile = window.innerWidth < 768;
      const baseWidth = isMobile ? MINIMAP_BASE_WIDTH : MINIMAP_MAX_WIDTH;
      const calculatedHeight = Math.round(baseWidth / aspectRatio);

      setMinimapDimensions({
        width: baseWidth,
        height: Math.max(80, Math.min(calculatedHeight, 200)),
      });

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

  const handleAddStepOnEdge = useCallback(
    (sourceId: string, targetId: string) => {
      setEdgeToInsertStep({ sourceId, targetId });
      setIsCreateStepDialogOpen(true);
    },
    [],
  );

  const handleAddStep = useCallback((stepSlug: string) => {
    setParentStepForNewStep(stepSlug);
    setIsCreateStepDialogOpen(true);
  }, []);

  const handleDeleteEdge = useCallback(
    async (_edgeId: string) => {
      toast({
        title: t('steps.toast.editingNotAvailable'),
        description: t('steps.toast.apiNotWired'),
      });
      return;
    },
    [t],
  );

  const stepOptions = useMemo(
    () =>
      steps.map((s) => ({
        stepSlug: s.stepSlug,
        name: s.name,
        stepType: s.stepType,
        actionType: getStepActionType(s),
      })),
    [steps],
  );

  // Surface waiting-for-input and debug pauses as their own banner states;
  // the run row in the executions table applies the same mapping.
  const viewedRunStatus = viewedExecution
    ? viewedExecution.status === 'running' && viewedExecution.waitingFor
      ? parseDebugWaitingFor(viewedExecution.waitingFor)
        ? 'paused'
        : 'waiting'
      : viewedExecution.status
    : null;

  const { initialNodes, initialEdges } = useAutomationLayout(steps);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = async (params: Connection) => {
    if (!params.source || !params.target) return;

    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });

    setEdges((eds) =>
      eds.filter(
        (edge) =>
          !(edge.source === params.source && edge.target === params.target),
      ),
    );

    return;
  };

  const onEdgesDelete = async (_edgesToDelete: Edge[]) => {
    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });

    return;
  };

  const handleCreateStep = async (_data: {
    name: string;
    stepType: StepType;
    config: StepConfig;
    nextSteps?: Record<string, string>;
  }) => {
    // TODO: Replace with file-based workflow save (modify workflow JSON and save via useSaveWorkflow)
    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });
  };

  return (
    <AutomationCallbacksProvider
      onNodeClick={handleNodeClick}
      onAddStep={handleAddStep}
      onAddStepOnEdge={handleAddStepOnEdge}
      onDeleteEdge={handleDeleteEdge}
    >
      <Row
        gap={0}
        align="stretch"
        className="relative w-full flex-1 justify-stretch overflow-auto"
      >
        <style>{MINIMAP_STYLES}</style>
        <div ref={containerRef} className="bg-background min-h-0 flex-[1_1_0]">
          <FlowCanvas
            onOpenAi={onOpenAIChat}
            centerActions={
              <>
                <Button
                  size="icon"
                  variant="secondary"
                  title={t('steps.toolbar.addStep')}
                  onClick={() => setIsCreateStepDialogOpen(true)}
                >
                  <Plus className="size-4" />
                </Button>

                <Button
                  variant="secondary"
                  size="icon"
                  title={t('steps.toolbar.testAutomation')}
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
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
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
            deleteKeyCode={['Backspace', 'Delete']}
            nodesDraggable={false}
            nodesConnectable
            nodesFocusable
            edgesFocusable
            multiSelectionKeyCode={['Meta', 'Ctrl']}
            minimapProps={{
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
            }}
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

            {((showActivityBanner && hasActiveTrigger) ||
              viewedExecutionId) && (
              <Panel position="top-center" className="mx-4 mt-4 w-full px-4">
                <Stack gap={2} className="mx-auto max-w-3xl">
                  {showActivityBanner && hasActiveTrigger && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-amber-50 px-4 py-3 shadow-sm ring-1 ring-amber-200">
                      <AlertTriangle className="size-5 shrink-0 text-amber-600" />
                      <Text className="text-sm text-amber-600">
                        {t('steps.banners.hasActiveTriggers')}
                      </Text>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={tCommon('aria.dismiss')}
                        className="ml-auto size-6 shrink-0 p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-700"
                        onClick={() => setShowActivityBanner(false)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
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

        <CreateStepDialog
          open={isCreateStepDialogOpen}
          onOpenChange={(open) => {
            setIsCreateStepDialogOpen(open);
            if (!open) {
              setParentStepForNewStep(null);
              setEdgeToInsertStep(null);
            }
          }}
          onCreateStep={handleCreateStep}
          stepOptions={stepOptions}
        />
      </Row>
    </AutomationCallbacksProvider>
  );
}

export function AutomationSteps(props: AutomationStepsProps) {
  return (
    <ReactFlowProvider>
      <AutomationStepsInner {...props} />
    </ReactFlowProvider>
  );
}
