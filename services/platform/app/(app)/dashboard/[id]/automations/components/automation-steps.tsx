'use client';

import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from 'react';
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
  MarkerType,
  BackgroundVariant,
  Panel,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import {
  TestTubeDiagonal,
  Info,
  X,
  Scan,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import CreateStepDialog from './create-step-dialog';
import AutomationStep from './automation-step';
import AutomationSidePanel from './automation-sidepanel';
import AutomationGroupNode from './automation-group-node';
import AutomationLoopContainer from './automation-loop-container';
import AutomationEdge from './automation-edge';
import { Doc, Id } from '@/convex/_generated/dataModel';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { getLayoutedElements } from '../utils/dagre-layout';

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

// Inner component that uses useReactFlow hook
function AutomationStepsInner({
  steps,
  className: _className,
  organizationId,
  automationId,
  status,
  onStepCreated: _onStepCreated,
}: AutomationStepsProps) {
  const { t } = useT('automations');
  const isDraft = status === 'draft';
  const isActive = status === 'active';
  const hasSteps = steps && steps.length > 0;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isCreateStepDialogOpen, setIsCreateStepDialogOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Doc<'wfStepDefs'> | null>(
    null,
  );
  // Auto-open AI assistant panel when editing a draft automation
  const [sidePanelMode, setSidePanelMode] = useState<
    'step' | 'ai-chat' | 'test' | null
  >(isDraft ? 'ai-chat' : null);
  const [_parentStepForNewStep, setParentStepForNewStep] = useState<
    string | null
  >(null);
  const [edgeToInsertStep, setEdgeToInsertStep] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [showDraftBanner, setShowDraftBanner] = useState(true);
  const [showActiveBanner, setShowActiveBanner] = useState(true);

  // React Flow instance for controlling the view
  const { fitView, getViewport, setCenter: _setCenter } = useReactFlow();

  // Refs for stable access to current values
  const stepsRef = useRef(steps);
  const edgesRef = useRef<Edge[]>([]);

  // Update refs when values change
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Reposition the view when sidepanel opens/closes (maintain zoom, just recenter)
  useEffect(() => {
    if (nodes.length > 0) {
      // Use a small delay to allow DOM to update
      const timer = setTimeout(() => {
        const currentViewport = getViewport();

        // Fit the view with minimum zoom constraint to prevent zooming out
        fitView({
          padding: 0.2,
          duration: 400,
          includeHiddenNodes: false,
          minZoom: currentViewport.zoom, // Maintain minimum zoom at current level
          maxZoom: currentViewport.zoom, // Maintain maximum zoom at current level
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sidePanelMode, fitView, getViewport, nodes.length]);

  // Mutations (currently disabled until public APIs are available)
  // const createStep = useMutation(api.wf_step_defs.createStep);
  // const updateStep = useMutation(api.wf_step_defs.updateStep);

  // Handle node click to open side panel
  const handleNodeClick = useCallback(
    (stepSlug: string) => {
      const step = steps.find((s) => s.stepSlug === stepSlug);
      if (step) {
        setSelectedStep(step);
        setSidePanelMode('step');
      }
    },
    [steps],
  );

  // Handle closing side panel
  const handleCloseSidePanel = () => {
    setSidePanelMode(null);
    setSelectedStep(null);
  };

  // Handle opening AI chat
  const handleOpenAIChat = () => {
    setSelectedStep(null);
    setSidePanelMode('ai-chat');
  };

  // Handle opening test panel
  const handleOpenTestPanel = () => {
    setSelectedStep(null);
    setSidePanelMode('test');
  };

  // Handle adding step on edge
  const handleAddStepOnEdge = useCallback(
    (sourceId: string, targetId: string) => {
      setEdgeToInsertStep({ sourceId, targetId });
      setIsCreateStepDialogOpen(true);
    },
    [],
  );

  // Handle deleting edge
  const handleDeleteEdge = useCallback(async (_edgeId: string) => {
    // NOTE: Editing connections is currently disabled until public Convex
    // mutations are available. This UI is temporarily read-only.
    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });
    return;
  }, [t]);

  // Convert steps to nodes and edges using Dagre layout
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!steps || steps.length === 0) {
      return { initialNodes: [], initialEdges: [] };
    }

    // Sort steps by order
    const sortedSteps = [...steps].sort((a, b) => a.order - b.order);

    // Identify leaf steps (nodes with no outgoing connections)
    const leafStepSlugs = new Set(
      sortedSteps
        .filter((step) => {
          const nextSteps = step.nextSteps as
            | Record<string, string>
            | null
            | undefined;
          // Consider a step a leaf if nextSteps is null, undefined, or an empty object
          if (!nextSteps) return true;
          if (typeof nextSteps !== 'object') return true;
          return Object.keys(nextSteps).length === 0;
        })
        .map((step) => step.stepSlug),
    );

    // Find all loop nodes dynamically
    const loopNodes = sortedSteps.filter((step) => step.stepType === 'loop');
    const _loopNodeIds = new Set(loopNodes.map((node) => node.stepSlug));

    // Build a map of loop nodes to their body nodes
    // Loop body nodes are those connected via the 'loop' nextStep
    const loopBodyMap = new Map<string, Set<string>>();

    loopNodes.forEach((loopNode) => {
      const bodyNodes = new Set<string>();
      const nextSteps = loopNode.nextSteps as Record<string, string> | null;

      if (nextSteps && nextSteps.loop) {
        // Get the exit node (where the loop's "done" edge points to)
        const exitNodeId = nextSteps.done;

        // Find all nodes that are part of the loop body
        // by traversing from the loop entry point until we hit:
        // - The loop node itself (loop-back edge)
        // - The exit node (done edge destination)
        // - Already visited nodes
        const visited = new Set<string>();
        const queue = [nextSteps.loop];

        while (queue.length > 0) {
          const current = queue.shift()!;

          // Skip if already visited, is the loop itself, or is the exit node
          if (
            visited.has(current) ||
            current === loopNode.stepSlug ||
            current === exitNodeId
          ) {
            continue;
          }

          visited.add(current);

          const currentStep = sortedSteps.find((s) => s.stepSlug === current);
          if (!currentStep) continue;

          // Never include terminal/leaf nodes in loop bodies
          // They should always remain independent
          if (leafStepSlugs.has(current)) {
            continue;
          }

          // This node is part of the loop body
          bodyNodes.add(current);

          // Add all next steps to the queue
          const currentNextSteps = currentStep.nextSteps as Record<
            string,
            string
          > | null;
          if (currentNextSteps) {
            Object.values(currentNextSteps).forEach((target) => {
              // Add to queue if not visited, not the loop node, not the exit node, and not a leaf node
              if (
                !visited.has(target) &&
                target !== loopNode.stepSlug &&
                target !== exitNodeId &&
                !leafStepSlugs.has(target)
              ) {
                queue.push(target);
              }
            });
          }
        }
      }

      loopBodyMap.set(loopNode.stepSlug, bodyNodes);
    });

    // Helper function to calculate required width for a loop container
    const calculateLoopWidth = (loopStepSlug: string): number => {
      const BASE_WIDTH = 640;
      const NODE_WIDTH = 300;
      const HORIZONTAL_PADDING = 32; // 16px on each side
      const NODE_SEP = 120; // Dagre nodesep for branching
      const EXTRA_MARGIN = 64; // Extra comfortable spacing

      // Get all children of this loop
      const children = sortedSteps.filter((s) => {
        const childParentSlug = Array.from(loopBodyMap.entries()).find(
          ([, bodies]) => bodies.has(s.stepSlug),
        )?.[0];
        return childParentSlug === loopStepSlug;
      });

      if (children.length === 0) {
        return BASE_WIDTH;
      }

      // Check for nested loops
      const nestedLoops = children.filter((child) => child.stepType === 'loop');

      if (nestedLoops.length === 0) {
        // No nested loops - base width is fine
        return BASE_WIDTH;
      }

      // Calculate widths of all nested loops recursively
      const nestedLoopWidths = nestedLoops.map((loop) =>
        calculateLoopWidth(loop.stepSlug),
      );

      const maxNestedWidth = Math.max(...nestedLoopWidths);

      // Check for conditional nodes that might branch to both loops and non-loops
      const conditionalNodes = children.filter(
        (child) => child.stepType === 'condition',
      );

      // For each conditional node, check if it branches to both a nested loop AND other nodes
      let maxBranchWidth = 0;
      conditionalNodes.forEach((condNode) => {
        const nextSteps = condNode.nextSteps as Record<string, string> | null;
        if (!nextSteps) return;

        const targets = Object.values(nextSteps);
        const targetNodes = targets
          .map((targetSlug) => children.find((c) => c.stepSlug === targetSlug))
          .filter(Boolean);

        // Check if branches include both loop and non-loop nodes
        const hasLoopBranch = targetNodes.some((t) => t!.stepType === 'loop');
        const hasNonLoopBranch = targetNodes.some(
          (t) => t!.stepType !== 'loop',
        );

        if (hasLoopBranch && hasNonLoopBranch) {
          // Calculate width needed for side-by-side branching
          const loopWidth = targetNodes
            .filter((t) => t!.stepType === 'loop')
            .map((t) => calculateLoopWidth(t!.stepSlug))
            .reduce((max, w) => Math.max(max, w), 0);

          const nonLoopWidth = NODE_WIDTH; // Regular nodes are 300px

          // Width needed: loop + spacing + regular node
          const branchWidth = loopWidth + NODE_SEP + nonLoopWidth;
          maxBranchWidth = Math.max(maxBranchWidth, branchWidth);
        }
      });

      // If we found conditional branching with mixed loop/non-loop, use that width
      if (maxBranchWidth > 0) {
        const finalWidth = Math.min(maxBranchWidth + HORIZONTAL_PADDING, 1920);
        return finalWidth;
      }

      if (nestedLoops.length === 1) {
        // Single nested loop without mixed branching
        const finalWidth = maxNestedWidth + HORIZONTAL_PADDING + EXTRA_MARGIN;
        return finalWidth;
      }

      // Multiple nested loops - they might branch horizontally
      // Conservative estimate: assume they can be at same rank (side by side)
      const totalNestedWidth = nestedLoopWidths.reduce((sum, w) => sum + w, 0);
      const spacingBetween = (nestedLoops.length - 1) * NODE_SEP;

      // Calculate both scenarios
      const widthForBranching =
        totalNestedWidth + spacingBetween + HORIZONTAL_PADDING;
      const widthForStacking =
        maxNestedWidth + HORIZONTAL_PADDING + EXTRA_MARGIN;

      // Use the larger but cap at reasonable maximum (1920px for typical screens)
      const finalWidth = Math.min(
        Math.max(widthForBranching, widthForStacking),
        1920,
      );
      return finalWidth;
    };

    // Create nodes without positions (custom layout will calculate them)
    const nodes: Node[] = sortedSteps.map((step, _index) => {
      const isLoopNode = step.stepType === 'loop';

      // Check if this node is a body node of any loop
      // For nested loops, assign the INNERMOST (most specific) loop as parent
      let parentLoopId: string | undefined;
      const candidateLoops: string[] = [];

      // Find all loops that claim this node
      for (const [loopId, bodyNodes] of loopBodyMap.entries()) {
        if (bodyNodes.has(step.stepSlug)) {
          candidateLoops.push(loopId);
        }
      }

      // If this node is in multiple loop bodies (nested loops),
      // choose the innermost loop (the one that is itself inside another loop)
      if (candidateLoops.length > 0) {
        if (candidateLoops.length === 1) {
          parentLoopId = candidateLoops[0];
        } else {
          // For nested loops: find the innermost one
          // The innermost loop is one that is itself a child of another candidate loop
          parentLoopId = candidateLoops.find((candidateId) => {
            // Check if this candidate is in the body of another candidate
            return candidateLoops.some((otherId) => {
              return (
                otherId !== candidateId &&
                loopBodyMap.get(otherId)?.has(candidateId)
              );
            });
          });

          // If no clear innermost found (shouldn't happen), use the last one
          if (!parentLoopId) {
            parentLoopId = candidateLoops[candidateLoops.length - 1];
          }
        }
      }

      // Build node configuration
      const nodeConfig: Partial<Node> = {
        id: step.stepSlug,
        type: isLoopNode ? 'loopContainer' : 'custom',
        position: { x: 0, y: 0 }, // Will be updated by layout
        zIndex: parentLoopId ? 10 : 1,
        data: {
          label: step.name,
          stepType: step.stepType,
          stepSlug: step.stepSlug,
          onNodeClick: handleNodeClick,
          isLeafNode: leafStepSlugs.has(step.stepSlug),
          isTerminalNode: leafStepSlugs.has(step.stepSlug),
          rank: step.order, // Use order as rank for automatic positioning
          isLoopBodyNode: !!parentLoopId, // Flag to identify loop body nodes
          onAddStep: leafStepSlugs.has(step.stepSlug)
            ? () => {
                setParentStepForNewStep(step.stepSlug);
                setIsCreateStepDialogOpen(true);
              }
            : undefined,
        },
      };

      // Set explicit dimensions for all nodes
      if (isLoopNode) {
        // Calculate dynamic width based on nested content
        const loopWidth = calculateLoopWidth(step.stepSlug);

        // Initial height estimate - will be dynamically adjusted by layout algorithm
        // This provides a starting point before Dagre calculates the actual bounding box
        const topPadding = 80; // Top padding + header height + spacing
        const bottomPadding = 30; // Bottom padding
        const estimatedHeight = topPadding + 200 + bottomPadding; // Minimal default

        // Set dimensions in both style and node properties for MiniMap
        nodeConfig.width = loopWidth;
        nodeConfig.height = estimatedHeight;
        nodeConfig.style = {
          width: loopWidth, // Dynamic width based on nested loops and branching
          height: estimatedHeight, // Will be overridden by dynamic calculation in dagre-layout
        };
      } else {
        // Regular nodes have fixed dimensions matching AutomationStep component
        // Set dimensions in both style and node properties for MiniMap
        nodeConfig.width = 300;
        nodeConfig.height = 80;
        nodeConfig.style = {
          width: 300, // 18.75rem = 300px
          height: 80, // Approximate height of automation step card
        };
      }

      // Loop body nodes are children of their parent loop container
      if (parentLoopId) {
        nodeConfig.parentId = parentLoopId; // v12 uses 'parentId' not 'parentNode'
        nodeConfig.extent = 'parent';
        nodeConfig.draggable = true;

        // Initial position will be calculated by Dagre layout with conditional branching
        // This placeholder position will be overridden by the layout algorithm
        nodeConfig.position = {
          x: 0,
          y: 0,
        };
      }

      const node = nodeConfig as Node;

      return node;
    });

    // Filter out terminal nodes from visualization
    const visibleNodes = nodes.filter((node) => !node.data.isTerminalNode);

    // Create edges based on actual step connections from nextSteps
    const edges: Edge[] = [];
    sortedSteps.forEach((step) => {
      if (step.nextSteps && typeof step.nextSteps === 'object') {
        const nextSteps = step.nextSteps as Record<string, string>;

        Object.entries(nextSteps).forEach(([key, targetStepSlug]) => {
          // Only create edge if target step exists
          if (sortedSteps.find((s) => s.stepSlug === targetStepSlug)) {
            // Skip edges to terminal nodes
            const isTargetTerminal = leafStepSlugs.has(targetStepSlug);
            if (isTargetTerminal) {
              return;
            }

            const keyLower = key.toLowerCase();

            // Check if target is a child of the source (parent-child relationship)
            let targetIsChildOfSource = false;
            for (const [loopStepSlug, bodyNodes] of loopBodyMap.entries()) {
              if (
                loopStepSlug === step.stepSlug &&
                bodyNodes.has(targetStepSlug)
              ) {
                targetIsChildOfSource = true;
                break;
              }
            }

            // Skip edges from parent loop to its child nodes (loop entry edges)
            // The container boundary is sufficient to show this relationship
            if (targetIsChildOfSource) {
              return;
            }

            const isLoopExit = [
              'done',
              'complete',
              'finished',
              'exit',
            ].includes(keyLower);

            // Determine if this is a negative/alternative path
            const isNegativePath = [
              'reject',
              'false',
              'no',
              'failure',
              'error',
            ].includes(keyLower);

            const isPositivePath = [
              'approve',
              'true',
              'yes',
              'success',
              'default',
            ].includes(keyLower);

            // Determine edge styling and label
            let edgeColor = '#9CA3AF'; // Default gray
            let edgeLabel: string | undefined = undefined;
            let edgeStyle: React.CSSProperties = {
              strokeWidth: 1.5,
              stroke: edgeColor,
            };

            // Special styling for loop nodes
            if (step.stepType === 'loop') {
              if (isLoopExit) {
                edgeColor = 'hsl(var(--chart-2))'; // Green for loop exit
                edgeLabel = undefined; // No label - styling is sufficient
                edgeStyle = {
                  strokeWidth: 2,
                  stroke: edgeColor,
                };
              } else {
                // No label for other loop outputs
                edgeLabel = undefined;
              }
            }
            // Styling for conditions and approvals
            else if (step.stepType === 'condition') {
              if (isNegativePath) {
                edgeColor = 'hsl(var(--destructive))';
                edgeLabel = 'false'; // Show label on edge
              } else if (isPositivePath) {
                edgeColor = 'hsl(var(--chart-2))'; // Green color
                edgeLabel = 'true'; // Show label on edge
              }
              edgeStyle = {
                strokeWidth: 1.5,
                stroke: edgeColor,
              };
            }
            // Styling for action nodes with success/failure paths
            else if (step.stepType === 'action' || step.stepType === 'llm') {
              if (isNegativePath) {
                edgeColor = 'hsl(var(--destructive))';
                edgeLabel = undefined; // No label needed for actions
              } else if (isPositivePath) {
                edgeColor = 'hsl(var(--chart-2))'; // Green color
                edgeLabel = undefined; // No label needed for actions
              }
              edgeStyle = {
                strokeWidth: 1.5,
                stroke: edgeColor,
              };
            }

            // Determine if this is a loop-back edge (connecting to any loop container)
            const targetStep = sortedSteps.find(
              (s) => s.stepSlug === targetStepSlug,
            );
            const _isTargetLoop = targetStep?.stepType === 'loop';
            // Determine if this edge is from the loop exit handle
            const _isFromLoopExit =
              step.stepType === 'loop' && keyLower === 'done';

            // Check if source is in a loop body
            let sourceInLoopBody = false;
            for (const [_loopId, bodyNodes] of loopBodyMap.entries()) {
              if (bodyNodes.has(step.stepSlug)) {
                sourceInLoopBody = true;
                break;
              }
            }

            // Determine if this is a loop-back edge (from loop body back to loop container)
            const _isLoopBack = _isTargetLoop && sourceInLoopBody;

            // Determine source and target handles based on step order/rank
            const sourceStep = sortedSteps.find(
              (s) => s.stepSlug === step.stepSlug,
            );
            const targetStepData = sortedSteps.find(
              (s) => s.stepSlug === targetStepSlug,
            );

            let sourceHandle = 'bottom-source'; // default: going to lower-ranked node
            let targetHandle = 'top-target'; // default: coming from higher-ranked node
            let edgeType: 'smoothstep' | 'default' = 'smoothstep';

            // Detect backward connection (going up in rank/order)
            const isBackwardConnection =
              targetStepData &&
              sourceStep &&
              targetStepData.order < sourceStep.order;

            // For backward connections, use side handles to route around nodes
            if (isBackwardConnection) {
              // Determine if we should route left or right based on spatial layout
              // For now, default to right-to-left routing
              // In the future, could analyze node positions to choose optimal side
              sourceHandle = 'right-source';
              targetHandle = 'left-target';
              edgeType = 'smoothstep'; // smoothstep handles curves better for side routing
            }

            // Check if both source and target are child nodes (inside loop containers)
            let bothAreChildNodes = false;
            for (const [_loopId2, bodyNodes] of loopBodyMap.entries()) {
              if (
                bodyNodes.has(step.stepSlug) &&
                bodyNodes.has(targetStepSlug)
              ) {
                bothAreChildNodes = true;
                break;
              }
            }

            // Check if edge involves a loop node (source or target is a loop)
            const sourceIsLoop = step.stepType === 'loop';
            const targetIsLoop =
              sortedSteps.find((s) => s.stepSlug === targetStepSlug)
                ?.stepType === 'loop';
            const involvesLoopNode = sourceIsLoop || targetIsLoop;

            // Skip backward connections and failure edges to loop nodes (they should not be visible)
            if (targetIsLoop && (isBackwardConnection || isNegativePath)) {
              return;
            }

            edges.push({
              id: `e${step.stepSlug}-${targetStepSlug}-${key}`,
              type: edgeType,
              source: step.stepSlug,
              target: targetStepSlug,
              sourceHandle: sourceHandle,
              targetHandle: targetHandle,
              // Proper z-index layering:
              // - Edges between child nodes (within loop): 10 (above loop container background)
              // - Backward connections: -3 (lowest, below everything)
              // - Regular edges: -2
              // - Positive/negative paths: -1 (highest edge layer for non-child edges)
              // - Loop edges (not between children): -1
              zIndex: bothAreChildNodes
                ? 10 // Edges within loop body must be above loop container background
                : isBackwardConnection
                  ? -3
                  : involvesLoopNode
                    ? -1
                    : isNegativePath || isPositivePath
                      ? -1
                      : -2,
              markerEnd: {
                type: MarkerType.Arrow,
                strokeWidth: 1.5,
                color: edgeColor,
              },
              style: {
                ...edgeStyle,
                // Add extra styling for backward connections
                ...(isBackwardConnection
                  ? {
                      strokeDasharray: '5,5', // Dashed line for backward connections
                      opacity: 0.7, // Slightly transparent to indicate secondary flow
                      strokeWidth: 2, // Thinner to de-emphasize
                    }
                  : {}),
              },
              animated: !isBackwardConnection, // Animate forward edges to show direction
              data: {
                isBackward: isBackwardConnection,
                onAddStepOnEdge: handleAddStepOnEdge,
                onDeleteEdge: handleDeleteEdge,
                label: edgeLabel,
                labelStyle: edgeLabel
                  ? {
                      fill: edgeColor,
                      fontSize: '11px',
                      fontWeight: 600,
                    }
                  : undefined,
                labelBgStyle: edgeLabel
                  ? {
                      fill: 'hsl(var(--background))',
                      stroke: edgeColor,
                      strokeWidth: 1.5,
                    }
                  : undefined,
                isBackwardConnection: isBackwardConnection,
              },
            });
          }
        });
      }
    });

    // Use visible nodes (excluding terminal nodes) and edges for processing
    const nodesToProcess = visibleNodes;
    const edgesToProcess = edges;

    // Calculate incoming and outgoing connection counts for each node
    const incomingCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();

    // Track which specific handles are being used (for bidirectional detection)
    const topHandlesUsed = new Map<string, Set<string>>(); // nodeId -> Set of handle types used at top
    const bottomHandlesUsed = new Map<string, Set<string>>(); // nodeId -> Set of handle types used at bottom

    edgesToProcess.forEach((edge) => {
      // Count incoming connections
      const inCount = incomingCounts.get(edge.target) || 0;
      incomingCounts.set(edge.target, inCount + 1);

      // Count outgoing connections
      const outCount = outgoingCounts.get(edge.source) || 0;
      outgoingCounts.set(edge.source, outCount + 1);

      // Track handle usage at source node
      if (edge.sourceHandle) {
        const nodeHandles = edge.sourceHandle.startsWith('top-')
          ? topHandlesUsed
          : bottomHandlesUsed;
        if (!nodeHandles.has(edge.source)) {
          nodeHandles.set(edge.source, new Set());
        }
        nodeHandles.get(edge.source)!.add(edge.sourceHandle);
      }

      // Track handle usage at target node
      if (edge.targetHandle) {
        const nodeHandles = edge.targetHandle.startsWith('top-')
          ? topHandlesUsed
          : bottomHandlesUsed;
        if (!nodeHandles.has(edge.target)) {
          nodeHandles.set(edge.target, new Set());
        }
        nodeHandles.get(edge.target)!.add(edge.targetHandle);
      }
    });

    // Determine if nodes have bidirectional connections at top or bottom
    const hasBidirectionalTop = new Map<string, boolean>();
    const hasBidirectionalBottom = new Map<string, boolean>();

    nodesToProcess.forEach((node: Node) => {
      // Check if both target and source handles are used at the top
      const topHandles = topHandlesUsed.get(node.id) || new Set();
      hasBidirectionalTop.set(
        node.id,
        topHandles.has('top-target') && topHandles.has('top-source'),
      );

      // Check if both target and source handles are used at the bottom
      const bottomHandles = bottomHandlesUsed.get(node.id) || new Set();
      hasBidirectionalBottom.set(
        node.id,
        bottomHandles.has('bottom-target') &&
          bottomHandles.has('bottom-source'),
      );
    });

    // Update nodes with connection count data and handle usage info
    const nodesWithFullConnectionData = nodesToProcess.map((node: Node) => ({
      ...node,
      data: {
        ...node.data,
        incomingCount: incomingCounts.get(node.id) || 0,
        outgoingCount: outgoingCounts.get(node.id) || 0,
        hasBidirectionalTop: hasBidirectionalTop.get(node.id) || false,
        hasBidirectionalBottom: hasBidirectionalBottom.get(node.id) || false,
      },
    }));

    // Apply Dagre layout algorithm
    const layouted = getLayoutedElements(
      nodesWithFullConnectionData,
      edgesToProcess,
      'TB',
    );

    return {
      initialNodes: layouted.nodes,
      initialEdges: layouted.edges,
    };
  }, [steps, handleNodeClick, handleAddStepOnEdge, handleDeleteEdge]);

  // Update nodes and edges when steps change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = async (params: Connection) => {
    if (!params.source || !params.target) return;

    // NOTE: Editing connections is currently disabled until public Convex mutations
    // are available. This UI is temporarily read-only.
    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });

    // Remove the edge if it was optimistically added elsewhere
    setEdges((eds) =>
      eds.filter(
        (edge) =>
          !(edge.source === params.source && edge.target === params.target),
      ),
    );

    return;
  };

  // Handle edge removal
  const onEdgesDelete = async (_edgesToDelete: Edge[]) => {
    // NOTE: Editing connections is currently disabled until public Convex mutations
    // are available. This UI is temporarily read-only.
    toast({
      title: t('steps.toast.editingNotAvailable'),
      description: t('steps.toast.apiNotWired'),
    });

    return;
  };

  // Handle creating a new step
  const handleCreateStep = async (_data: {
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Doc<'wfStepDefs'>['config'];
  }) => {
    try {
      // Generate a unique stepSlug
      const _stepSlug = `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Calculate the next order number
      const _nextOrder =
        steps.length > 0 ? Math.max(...steps.map((s) => s.order)) + 1 : 1;

      // Prepare nextSteps for the new step - start with empty object
      let _newStepNextSteps = {};

      // If we're inserting on an edge, the new step should point to the target
      if (edgeToInsertStep) {
        _newStepNextSteps = {
          default: edgeToInsertStep.targetId,
        };
      }

      // NOTE: Step creation is currently disabled until public Convex mutations
      // are available. This UI is temporarily read-only.
      toast({
        title: t('steps.toast.stepCreationNotAvailable'),
        description: t('steps.toast.apiNotWired'),
      });
      return;
    } catch (error) {
      console.error('Failed to create step:', error);
      toast({
        title: t('steps.toast.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex justify-stretch size-full flex-1 max-h-[calc(100%-6rem)]">
      <style>{`
        /* Allow individual edges to control their z-index */
        .react-flow__edges {
          z-index: auto;
        }
        .react-flow__nodes {
          z-index: auto;
        }
        /* Individual elements can override z-index as needed */
        .react-flow__edge {
          z-index: 0;
        }
        .react-flow__node {
          z-index: 1;
        }

        /* MiniMap dark mode support */
        .react-flow__minimap {
          background-color: hsl(var(--muted)) !important;
        }

        .react-flow__minimap-node {
          fill: hsl(var(--background)) !important;
        }

        .react-flow__minimap-mask {
          fill: hsl(var(--muted) / 0.6) !important;
        }
      `}</style>
      {/* Main automation canvas */}
      <div className="flex-[1_1_0] min-h-0 bg-background">
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
            className="border border-border rounded-lg shadow-sm"
            nodeStrokeColor={(node) => {
              const stepType = node.data?.stepType;

              // Color mapping matching icon backgrounds for consistency
              switch (stepType) {
                case 'trigger':
                  return '#3b82f6'; // blue-500
                case 'llm':
                  return '#a855f7'; // purple-500
                case 'condition':
                  return '#f59e0b'; // amber-500

                case 'loop':
                  return '#06b6d4'; // cyan-500
                case 'action':
                  return '#f97316'; // orange-500
                default:
                  return '#71717a'; // zinc-500
              }
            }}
            nodeStrokeWidth={3}
            pannable
            zoomable
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={2}
            color="hsl(var(--muted-foreground) / 0.2)"
          />

          {/* Empty state overlay when there are no steps */}
          {!hasSteps && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-2">
                <div className="text-muted-foreground">
                  No automation steps to display
                </div>
                <div className="text-sm text-muted-foreground">
                  Create steps to see the automation overview, or use the AI
                  assistant to help you get started.
                </div>
              </div>
            </div>
          )}

          {/* Draft Banner */}
          {showDraftBanner && isDraft && (
            <Panel className="my-4 !mx-0 px-4 w-full max-w-[53.5rem] top-0 !left-1/2 !-translate-x-1/2">
              <div className="flex items-center gap-2 rounded-lg ring-1 ring-blue-200 bg-blue-50 p-3 shadow-sm">
                <Info className="size-4 shrink-0 text-blue-600" />
                <p className="text-sm text-blue-600">
                  This automation is not yet published
                </p>
                <Button
                  variant="ghost"
                  className="ml-auto text-blue-600 hover:bg-blue-100 hover:text-blue-700 size-6"
                  onClick={() => setShowDraftBanner(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </Panel>
          )}

          {/* Active Automation Banner */}
          {showActiveBanner && isActive && (
            <Panel className="my-4 !mx-0 px-4 w-full max-w-[53.5rem] top-0 !left-1/2 !-translate-x-1/2">
              <div className="flex items-center gap-2 rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3 shadow-sm">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-600">
                  This automation is published and cannot be modified. Create a
                  new version to make changes.
                </p>
                <Button
                  variant="ghost"
                  className="ml-auto text-amber-600 hover:bg-amber-100 hover:text-amber-700 size-6"
                  onClick={() => setShowActiveBanner(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </Panel>
          )}

          {/* Toolbar Panel */}
          <Panel position="bottom-center" className="mb-4">
            <div className="flex items-center gap-2 rounded-lg ring-1 ring-border bg-background p-1 shadow-sm">
              {/* Action Tools */}
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          fitView({
                            padding: 0.2,
                            duration: 400,
                            maxZoom: 1,
                          });
                        }}
                      >
                        <Scan className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Focus</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleOpenAIChat}
                      >
                        <Sparkles className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">AI assistant</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleOpenTestPanel}
                        disabled={steps.length === 0}
                      >
                        <TestTubeDiagonal className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Test Automation</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Right side panel for step details, AI chat, or test panel */}
      {sidePanelMode && (
        <AutomationSidePanel
          step={selectedStep}
          isOpen={!!sidePanelMode}
          onClose={handleCloseSidePanel}
          showAIChat={sidePanelMode === 'ai-chat'}
          showTestPanel={sidePanelMode === 'test'}
          automationId={automationId}
          organizationId={organizationId}
        />
      )}
      {/* Create Step Dialog */}
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
      />
    </div>
  );
}

// Wrapper component with ReactFlowProvider
export function AutomationSteps(props: AutomationStepsProps) {
  return (
    <ReactFlowProvider>
      <AutomationStepsInner {...props} />
    </ReactFlowProvider>
  );
}
