'use client';

import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  ConnectionLineType,
  Edge,
  Node,
  BackgroundVariant,
  Panel,
  useReactFlow,
} from '@xyflow/react';
import {
  TestTubeDiagonal,
  Info,
  X,
  Scan,
  Sparkles,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from 'react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { useUrlState } from '@/app/hooks/use-url-state';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useCreateStep } from '../hooks/mutations';
import { useAutomationLayout } from '../hooks/use-automation-layout';
import { AutomationCallbacksProvider } from './automation-callbacks-context';
import { AutomationEdge } from './automation-edge';
import { AutomationGroupNode } from './automation-group-node';
import { AutomationLoopContainer } from './automation-loop-container';
import { AutomationSidePanel } from './automation-sidepanel';
import { AutomationStep } from './automation-step';
import { CreateStepDialog } from './step-create-dialog';

interface AutomationStepsProps {
  steps: Doc<'wfStepDefs'>[];
  className?: string;
  organizationId: string;
  automationId: Id<'wfDefinitions'>;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  onStepCreated?: () => void;
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
  organizationId,
  automationId,
  status,
  onStepCreated: _onStepCreated,
}: AutomationStepsProps) {
  const { t } = useT('automations');
  const { user } = useAuth();
  const { mutateAsync: createStep } = useCreateStep();
  const isDraft = status === 'draft';
  const isActive = status === 'active';
  const hasSteps = steps && steps.length > 0;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- without explicit Edge, TS infers never[]
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isCreateStepDialogOpen, setIsCreateStepDialogOpen] = useState(false);

  const urlStateDefinitions = useMemo(
    () => ({
      panel: { default: null },
      step: { default: null },
    }),
    [],
  );

  const {
    state: panelState,
    setStates: setPanelStates,
    clearAll: clearPanelState,
  } = useUrlState({
    definitions: urlStateDefinitions,
  });

  const sidePanelMode =
    panelState.panel === 'step' ||
    panelState.panel === 'ai-chat' ||
    panelState.panel === 'test'
      ? panelState.panel
      : null;
  const selectedStepSlug = panelState.step;

  const selectedStep = useMemo(() => {
    if (!selectedStepSlug) return null;
    return steps.find((s) => s.stepSlug === selectedStepSlug) ?? null;
  }, [steps, selectedStepSlug]);

  const [_parentStepForNewStep, setParentStepForNewStep] = useState<
    string | null
  >(null);
  const [edgeToInsertStep, setEdgeToInsertStep] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [showDraftBanner, setShowDraftBanner] = useState(true);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const MINIMAP_BASE_WIDTH = 144;
    const MINIMAP_MAX_WIDTH = 192;

    const updateMinimapSize = () => {
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
    };

    const resizeObserver = new ResizeObserver(updateMinimapSize);
    resizeObserver.observe(container);
    window.addEventListener('resize', updateMinimapSize);
    updateMinimapSize();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMinimapSize);
    };
  }, []);

  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        const currentViewport = getViewport();
        void fitView({
          padding: 0.2,
          duration: 400,
          includeHiddenNodes: false,
          minZoom: currentViewport.zoom,
          maxZoom: currentViewport.zoom,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sidePanelMode, fitView, getViewport, nodes.length]);

  const handleNodeClick = useCallback(
    (stepSlug: string) => {
      const step = steps.find((s) => s.stepSlug === stepSlug);
      if (step) {
        setPanelStates({ panel: 'step', step: stepSlug });
      }
    },
    [steps, setPanelStates],
  );

  const handleCloseSidePanel = useCallback(() => {
    clearPanelState();
  }, [clearPanelState]);

  const handleOpenAIChat = useCallback(() => {
    setPanelStates({ panel: 'ai-chat', step: null });
  }, [setPanelStates]);

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
        actionType:
          s.stepType === 'action' && 'type' in s.config
            ? String(s.config.type)
            : undefined,
      })),
    [steps],
  );

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

  const handleCreateStep = async (data: {
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Doc<'wfStepDefs'>['config'];
    nextSteps?: Doc<'wfStepDefs'>['nextSteps'];
  }) => {
    if (!user) {
      toast({
        title: t('steps.toast.notAuthenticated'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const stepSlug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

      if (!stepSlug) {
        toast({
          title: t('steps.toast.invalidStepName'),
          variant: 'destructive',
        });
        return;
      }

      if (steps.some((s) => s.stepSlug === stepSlug)) {
        toast({
          title: t('steps.toast.duplicateStepSlug'),
          variant: 'destructive',
        });
        return;
      }

      const nextOrder =
        steps.length > 0 ? Math.max(...steps.map((s) => s.order)) + 1 : 1;

      let nextSteps: Record<string, string> = data.nextSteps || {};

      if (edgeToInsertStep) {
        nextSteps = {
          ...nextSteps,
          success: edgeToInsertStep.targetId,
        };
      }

      await createStep({
        wfDefinitionId: automationId,
        stepSlug,
        name: data.name,
        stepType: data.stepType,
        order: nextOrder,
        config: data.config,
        nextSteps,
        editMode: 'visual',
      });

      toast({
        title: t('steps.toast.stepCreated'),
      });
    } catch (error) {
      console.error('Failed to create step:', error);
      toast({
        title: t('steps.toast.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <AutomationCallbacksProvider
      onNodeClick={handleNodeClick}
      onAddStep={handleAddStep}
      onAddStepOnEdge={handleAddStepOnEdge}
      onDeleteEdge={handleDeleteEdge}
    >
      <div className="relative flex w-full flex-1 justify-stretch overflow-auto">
        <style>{MINIMAP_STYLES}</style>
        <div ref={containerRef} className="bg-background min-h-0 flex-[1_1_0]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={isActive ? undefined : onNodesChange}
            onEdgesChange={isActive ? undefined : onEdgesChange}
            onConnect={isActive ? undefined : onConnect}
            onEdgesDelete={isActive ? undefined : onEdgesDelete}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            fitView={true}
            fitViewOptions={{ padding: 0.2, duration: 400, maxZoom: 1 }}
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
            deleteKeyCode={isActive ? null : ['Backspace', 'Delete']}
            nodesDraggable={!isActive}
            nodesConnectable={!isActive}
            nodesFocusable={!isActive}
            edgesFocusable={!isActive}
            multiSelectionKeyCode={['Meta', 'Ctrl']}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap
              className="border-border overflow-hidden rounded-lg border shadow-sm"
              style={{
                width: minimapDimensions.width,
                height: minimapDimensions.height,
              }}
              nodeStrokeColor={minimapNodeStrokeColor}
              nodeStrokeWidth={3}
              pannable
              zoomable
              inversePan={false}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={2}
              color="hsl(var(--muted-foreground) / 0.2)"
            />

            {!hasSteps && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="space-y-2 text-center">
                  <div className="text-muted-foreground">
                    {t('emptyState.noSteps')}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t('emptyState.createStepsHint')}
                  </div>
                </div>
              </div>
            )}

            {showDraftBanner && isDraft && (
              <Panel position="top-center" className="mx-4 mt-4 w-full px-8">
                <div className="mx-auto flex max-w-xl items-center gap-2.5 rounded-lg bg-blue-50 px-4 py-3 shadow-sm ring-1 ring-blue-200">
                  <Info className="size-5 shrink-0 text-blue-600" />
                  <p className="text-sm text-blue-600">
                    {t('steps.banners.draftNotPublished')}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6 shrink-0 p-1 text-blue-600 hover:bg-blue-100 hover:text-blue-700"
                    onClick={() => setShowDraftBanner(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </Panel>
            )}

            {isActive && (
              <Panel position="top-center" className="mx-4 mt-4 w-full px-4">
                <div className="mx-auto flex max-w-3xl items-center gap-2.5 rounded-lg bg-amber-50 px-4 py-3 shadow-sm ring-1 ring-amber-200">
                  <AlertTriangle className="size-5 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-600">
                    {t('steps.banners.activeCannotModify')}
                  </p>
                </div>
              </Panel>
            )}

            <Panel position="bottom-center" className="mb-4">
              <div className="ring-border bg-background flex items-center gap-2 rounded-lg p-1 shadow-sm ring-1">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="icon"
                    title={t('steps.toolbar.focus')}
                    onClick={() => {
                      void fitView({
                        padding: 0.2,
                        duration: 400,
                        maxZoom: 1,
                      });
                    }}
                  >
                    <Scan className="size-4" />
                  </Button>

                  <Button
                    size="icon"
                    title={t('steps.toolbar.aiAssistant')}
                    onClick={handleOpenAIChat}
                    className="bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800"
                  >
                    <Sparkles className="size-4" />
                  </Button>

                  <Button
                    size="icon"
                    variant="secondary"
                    title={t('steps.toolbar.addStep')}
                    onClick={() => setIsCreateStepDialogOpen(true)}
                    disabled={isActive}
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
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {sidePanelMode && (
          <AutomationSidePanel
            step={selectedStep}
            isOpen={!!sidePanelMode}
            onClose={handleCloseSidePanel}
            showAIChat={sidePanelMode === 'ai-chat'}
            showTestPanel={sidePanelMode === 'test'}
            automationId={automationId}
            organizationId={organizationId}
            stepOptions={stepOptions}
          />
        )}
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
      </div>
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
