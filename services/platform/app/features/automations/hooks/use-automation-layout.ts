'use client';

import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import React, { useMemo } from 'react';

import type { ElkLayoutOptions } from '@/app/components/flow/layout/elk-layout';
import { useElkLayout } from '@/app/components/flow/layout/use-elk-layout';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { getStepActionType } from '../utils/step-icons';

// Loop containers are compound nodes — ELK sizes them to fit their children
// (top padding leaves room for the loop header). These dimensions are only the
// nominal fallback for an empty loop that has no body nodes to measure.
const LOOP_NOMINAL_WIDTH = 640;
const LOOP_NOMINAL_HEIGHT = 310;

const AUTOMATION_ELK_OPTIONS: ElkLayoutOptions = {
  direction: 'DOWN',
  // Generous gaps so branches and their Yes/No labels have room to breathe and
  // the orthogonal arrows read as distinct paths rather than a tangle.
  nodeNodeSpacing: 90,
  layerSpacing: 90,
  edgeNodeSpacing: 28,
  compoundPadding: { top: 84, right: 24, bottom: 32, left: 24 },
};

const LOOP_EXIT_KEYS = new Set(['done', 'complete', 'finished', 'exit']);
const NEGATIVE_BRANCH_KEYS = new Set([
  'reject',
  'false',
  'no',
  'failure',
  'error',
]);
const POSITIVE_BRANCH_KEYS = new Set([
  'approve',
  'true',
  'yes',
  'success',
  'default',
]);
// Calm, theme-aware gray for the main "spine" (non-branching) connections, so
// the eye follows the happy path and only decisions/outcomes draw color.
const NEUTRAL_EDGE_COLOR = 'hsl(var(--muted-foreground))';

/**
 * Resolve the color + label for a condition step's branch edge. Standard
 * positive/negative outcomes map to green/"true" and red/"false"; any other
 * (custom) branch key keeps a neutral color but is labeled with its own key,
 * so the path is identifiable rather than an unlabeled gray line (#1486).
 */
export function resolveConditionBranchEdge(key: string): {
  color: string;
  label: string;
} {
  const keyLower = key.toLowerCase();
  if (NEGATIVE_BRANCH_KEYS.has(keyLower)) {
    return { color: 'hsl(var(--destructive))', label: 'false' };
  }
  if (POSITIVE_BRANCH_KEYS.has(keyLower)) {
    return { color: 'hsl(var(--chart-2))', label: 'true' };
  }
  return { color: NEUTRAL_EDGE_COLOR, label: key };
}

export function useAutomationLayout(steps: Doc<'wfStepDefs'>[]) {
  const { t } = useT('automations');
  const { rawNodes, builtEdges } = useMemo<{
    rawNodes: Node[];
    builtEdges: Edge[];
  }>(() => {
    if (!steps || steps.length === 0) {
      return { rawNodes: [], builtEdges: [] };
    }

    const sortedSteps = [...steps].sort((a, b) => a.order - b.order);

    const leafStepSlugs = new Set(
      sortedSteps
        .filter((step) => Object.keys(step.nextSteps).length === 0)
        .map((step) => step.stepSlug),
    );

    const loopNodes = sortedSteps.filter((step) => step.stepType === 'loop');

    const loopBodyMap = new Map<string, Set<string>>();

    loopNodes.forEach((loopNode) => {
      const bodyNodes = new Set<string>();
      const { nextSteps } = loopNode;

      if (nextSteps.loop) {
        const exitNodeId = nextSteps.done;
        const visited = new Set<string>();
        const queue = [nextSteps.loop];

        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) continue;

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

          if (leafStepSlugs.has(current)) {
            continue;
          }

          bodyNodes.add(current);

          Object.values(currentStep.nextSteps).forEach((target) => {
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

      loopBodyMap.set(loopNode.stepSlug, bodyNodes);
    });

    const nodes: Node[] = sortedSteps.map((step) => {
      const isLoopNode = step.stepType === 'loop';

      let parentLoopId: string | undefined;
      const candidateLoops: string[] = [];

      for (const [loopId, bodyNodes] of loopBodyMap.entries()) {
        if (bodyNodes.has(step.stepSlug)) {
          candidateLoops.push(loopId);
        }
      }

      if (candidateLoops.length > 0) {
        if (candidateLoops.length === 1) {
          parentLoopId = candidateLoops[0];
        } else {
          parentLoopId = candidateLoops.find((candidateId) => {
            return candidateLoops.some((otherId) => {
              return (
                otherId !== candidateId &&
                loopBodyMap.get(otherId)?.has(candidateId)
              );
            });
          });

          if (!parentLoopId) {
            parentLoopId = candidateLoops[candidateLoops.length - 1];
          }
        }
      }

      const nodeConfig: Partial<Node> = {
        id: step.stepSlug,
        type: isLoopNode ? 'loopContainer' : 'custom',
        position: { x: 0, y: 0 },
        zIndex: parentLoopId ? 10 : 1,
        data: {
          label: step.name,
          stepType: step.stepType,
          stepSlug: step.stepSlug,
          actionType: getStepActionType(step),
          isLeafNode: leafStepSlugs.has(step.stepSlug),
          isTerminalNode: leafStepSlugs.has(step.stepSlug),
          rank: step.order,
          isLoopBodyNode: !!parentLoopId,
        },
      };

      if (isLoopNode) {
        // ELK auto-sizes loop containers (compound nodes) to fit their body.
        // These nominal dimensions only apply to an empty loop with no body.
        nodeConfig.width = LOOP_NOMINAL_WIDTH;
        nodeConfig.height = LOOP_NOMINAL_HEIGHT;
        nodeConfig.style = {
          width: LOOP_NOMINAL_WIDTH,
          height: LOOP_NOMINAL_HEIGHT,
        };
      } else {
        nodeConfig.width = 300;
        nodeConfig.height = 80;
        nodeConfig.style = {
          width: 300,
          height: 80,
        };
      }

      if (parentLoopId) {
        nodeConfig.parentId = parentLoopId;
        nodeConfig.extent = 'parent';
        nodeConfig.position = { x: 0, y: 0 };
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- All required Node fields (id, position, type, data) are set above
      return nodeConfig as Node;
    });

    const edges: Edge[] = [];
    sortedSteps.forEach((step) => {
      if (step.nextSteps && typeof step.nextSteps === 'object') {
        Object.entries(step.nextSteps).forEach(([key, targetStepSlug]) => {
          if (sortedSteps.find((s) => s.stepSlug === targetStepSlug)) {
            const keyLower = key.toLowerCase();

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

            if (targetIsChildOfSource) {
              return;
            }

            const isLoopExit = LOOP_EXIT_KEYS.has(keyLower);
            const isNegativePath = NEGATIVE_BRANCH_KEYS.has(keyLower);
            const isPositivePath = POSITIVE_BRANCH_KEYS.has(keyLower);

            let edgeColor = NEUTRAL_EDGE_COLOR;
            let edgeLabel: string | undefined = undefined;
            let edgeStyle: React.CSSProperties = {
              strokeWidth: 2,
              stroke: edgeColor,
            };

            if (step.stepType === 'loop') {
              if (isLoopExit) {
                edgeColor = 'hsl(var(--chart-2))';
                edgeStyle = { strokeWidth: 2, stroke: edgeColor };
              }
            } else if (step.stepType === 'condition') {
              const branch = resolveConditionBranchEdge(key);
              edgeColor = branch.color;
              // Show plain-language Yes/No at decisions; keep any custom branch
              // key (e.g. a named outcome) as-is so it stays identifiable.
              edgeLabel =
                branch.label === 'true'
                  ? t('edges.yes')
                  : branch.label === 'false'
                    ? t('edges.no')
                    : branch.label;
              edgeStyle = { strokeWidth: 2, stroke: edgeColor };
            } else if (step.stepType === 'action' || step.stepType === 'llm') {
              if (isNegativePath) {
                edgeColor = 'hsl(var(--destructive))';
              } else if (isPositivePath) {
                edgeColor = 'hsl(var(--chart-2))';
              }
              edgeStyle = { strokeWidth: 2, stroke: edgeColor };
            }

            const targetStepData = sortedSteps.find(
              (s) => s.stepSlug === targetStepSlug,
            );
            const targetIsLoop = targetStepData?.stepType === 'loop';

            let sourceHandle = 'bottom-source';
            let targetHandle = 'top-target';
            let edgeType: 'smoothstep' | 'default' = 'smoothstep';

            const isBackwardConnection =
              targetStepData && targetStepData.order < step.order;

            if (isBackwardConnection) {
              sourceHandle = 'right-source';
              targetHandle = 'left-target';
              edgeType = 'smoothstep';
            }

            let bothAreChildNodes = false;
            for (const [, bodyNodes] of loopBodyMap.entries()) {
              if (
                bodyNodes.has(step.stepSlug) &&
                bodyNodes.has(targetStepSlug)
              ) {
                bothAreChildNodes = true;
                break;
              }
            }

            const sourceIsLoop = step.stepType === 'loop';
            const involvesLoopNode = sourceIsLoop || targetIsLoop;

            if (targetIsLoop && (isBackwardConnection || isNegativePath)) {
              return;
            }

            edges.push({
              id: `e${step.stepSlug}-${targetStepSlug}-${key}`,
              type: edgeType,
              source: step.stepSlug,
              target: targetStepSlug,
              sourceHandle,
              targetHandle,
              zIndex: bothAreChildNodes
                ? 10
                : isBackwardConnection
                  ? -3
                  : involvesLoopNode || isNegativePath || isPositivePath
                    ? -1
                    : -2,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 18,
                height: 18,
                color: edgeColor,
              },
              style: {
                ...edgeStyle,
                ...(isBackwardConnection
                  ? {
                      strokeDasharray: '5,5',
                      opacity: 0.7,
                      strokeWidth: 2,
                    }
                  : {}),
              },
              // Static lines: the editor shows structure, not live execution.
              // Animating every edge reads as noise to a non-technical viewer.
              animated: false,
              data: {
                isBackward: isBackwardConnection,
                label: edgeLabel,
                // Outline badge in the branch color (colored text + border on a
                // solid background), matching its arrow without a heavy fill.
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
                isBackwardConnection,
              },
            });
          }
        });
      }
    });

    const incomingCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();
    const topHandlesUsed = new Map<string, Set<string>>();
    const bottomHandlesUsed = new Map<string, Set<string>>();

    edges.forEach((edge) => {
      incomingCounts.set(
        edge.target,
        (incomingCounts.get(edge.target) || 0) + 1,
      );
      outgoingCounts.set(
        edge.source,
        (outgoingCounts.get(edge.source) || 0) + 1,
      );

      if (edge.sourceHandle) {
        const nodeHandles = edge.sourceHandle.startsWith('top-')
          ? topHandlesUsed
          : bottomHandlesUsed;
        if (!nodeHandles.has(edge.source)) {
          nodeHandles.set(edge.source, new Set());
        }
        nodeHandles.get(edge.source)?.add(edge.sourceHandle);
      }

      if (edge.targetHandle) {
        const nodeHandles = edge.targetHandle.startsWith('top-')
          ? topHandlesUsed
          : bottomHandlesUsed;
        if (!nodeHandles.has(edge.target)) {
          nodeHandles.set(edge.target, new Set());
        }
        nodeHandles.get(edge.target)?.add(edge.targetHandle);
      }
    });

    const hasBidirectionalTop = new Map<string, boolean>();
    const hasBidirectionalBottom = new Map<string, boolean>();

    nodes.forEach((node: Node) => {
      const topHandles = topHandlesUsed.get(node.id) || new Set();
      hasBidirectionalTop.set(
        node.id,
        topHandles.has('top-target') && topHandles.has('top-source'),
      );

      const bottomHandles = bottomHandlesUsed.get(node.id) || new Set();
      hasBidirectionalBottom.set(
        node.id,
        bottomHandles.has('bottom-target') &&
          bottomHandles.has('bottom-source'),
      );
    });

    // oxlint-disable-next-line oxc/no-map-spread -- immutable update required
    const nodesWithFullConnectionData = nodes.map((node: Node) => ({
      ...node,
      data: {
        ...node.data,
        incomingCount: incomingCounts.get(node.id) || 0,
        outgoingCount: outgoingCounts.get(node.id) || 0,
        hasBidirectionalTop: hasBidirectionalTop.get(node.id) || false,
        hasBidirectionalBottom: hasBidirectionalBottom.get(node.id) || false,
      },
    }));

    return { rawNodes: nodesWithFullConnectionData, builtEdges: edges };
  }, [steps, t]);

  // Lay out with ELK using only the forward edges so the vertical layering
  // stays clean; React Flow still renders every edge (forward + the backward
  // loop edges, which route through the nodes' side handles).
  const layoutEdges = useMemo(
    () => builtEdges.filter((edge) => !edge.data?.isBackwardConnection),
    [builtEdges],
  );

  const { nodes: initialNodes, edgeRoutes } = useElkLayout(
    rawNodes,
    layoutEdges,
    AUTOMATION_ELK_OPTIONS,
  );

  // Attach each edge's ELK orthogonal route so the renderer draws clean
  // right-angle arrows. Edges without a route (e.g. backward loop edges) keep
  // their handle-derived smoothstep path.
  const initialEdges = useMemo(
    () =>
      builtEdges.map((edge) => {
        const points = edgeRoutes[edge.id];
        if (!points) return edge;
        return { ...edge, data: { ...edge.data, elkPoints: points } };
      }),
    [builtEdges, edgeRoutes],
  );

  return { initialNodes, initialEdges };
}
