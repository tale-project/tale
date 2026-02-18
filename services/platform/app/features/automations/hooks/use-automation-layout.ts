'use client';

import type { Edge, Node } from '@xyflow/react';

import { MarkerType } from '@xyflow/react';
import React, { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { getLayoutedElements } from '../utils/dagre-layout';

export function useAutomationLayout(steps: Doc<'wfStepDefs'>[]) {
  return useMemo(() => {
    if (!steps || steps.length === 0) {
      return { initialNodes: [], initialEdges: [] };
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

    const calculateLoopWidth = (loopStepSlug: string): number => {
      const BASE_WIDTH = 640;
      const NODE_WIDTH = 300;
      const HORIZONTAL_PADDING = 32;
      const NODE_SEP = 120;
      const EXTRA_MARGIN = 64;

      const children = sortedSteps.filter((s) => {
        const childParentSlug = Array.from(loopBodyMap.entries()).find(
          ([, bodies]) => bodies.has(s.stepSlug),
        )?.[0];
        return childParentSlug === loopStepSlug;
      });

      if (children.length === 0) {
        return BASE_WIDTH;
      }

      const nestedLoops = children.filter((child) => child.stepType === 'loop');

      if (nestedLoops.length === 0) {
        return BASE_WIDTH;
      }

      const nestedLoopWidths = nestedLoops.map((loop) =>
        calculateLoopWidth(loop.stepSlug),
      );

      const maxNestedWidth = Math.max(...nestedLoopWidths);

      const conditionalNodes = children.filter(
        (child) => child.stepType === 'condition',
      );

      let maxBranchWidth = 0;
      conditionalNodes.forEach((condNode) => {
        const targets = Object.values(condNode.nextSteps);
        const targetNodes = targets
          .map((targetSlug) => children.find((c) => c.stepSlug === targetSlug))
          .filter(Boolean);

        const hasLoopBranch = targetNodes.some((t) => t?.stepType === 'loop');
        const hasNonLoopBranch = targetNodes.some(
          (t) => t?.stepType !== 'loop',
        );

        if (hasLoopBranch && hasNonLoopBranch) {
          const loopWidth = targetNodes
            .filter((t) => t?.stepType === 'loop')
            .map((t) => calculateLoopWidth(t?.stepSlug ?? ''))
            .reduce((max, w) => Math.max(max, w), 0);

          const nonLoopWidth = NODE_WIDTH;
          const branchWidth = loopWidth + NODE_SEP + nonLoopWidth;
          maxBranchWidth = Math.max(maxBranchWidth, branchWidth);
        }
      });

      if (maxBranchWidth > 0) {
        return Math.min(maxBranchWidth + HORIZONTAL_PADDING, 1920);
      }

      if (nestedLoops.length === 1) {
        return maxNestedWidth + HORIZONTAL_PADDING + EXTRA_MARGIN;
      }

      const totalNestedWidth = nestedLoopWidths.reduce((sum, w) => sum + w, 0);
      const spacingBetween = (nestedLoops.length - 1) * NODE_SEP;

      const widthForBranching =
        totalNestedWidth + spacingBetween + HORIZONTAL_PADDING;
      const widthForStacking =
        maxNestedWidth + HORIZONTAL_PADDING + EXTRA_MARGIN;

      return Math.min(Math.max(widthForBranching, widthForStacking), 1920);
    };

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
          actionType:
            step.stepType === 'action' && 'type' in step.config
              ? String(step.config.type)
              : undefined,
          isLeafNode: leafStepSlugs.has(step.stepSlug),
          isTerminalNode: leafStepSlugs.has(step.stepSlug),
          rank: step.order,
          isLoopBodyNode: !!parentLoopId,
        },
      };

      if (isLoopNode) {
        const loopWidth = calculateLoopWidth(step.stepSlug);
        const topPadding = 80;
        const bottomPadding = 30;
        const estimatedHeight = topPadding + 200 + bottomPadding;

        nodeConfig.width = loopWidth;
        nodeConfig.height = estimatedHeight;
        nodeConfig.style = {
          width: loopWidth,
          height: estimatedHeight,
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
        nodeConfig.draggable = true;
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

            const isLoopExit = [
              'done',
              'complete',
              'finished',
              'exit',
            ].includes(keyLower);

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

            let edgeColor = '#9CA3AF';
            let edgeLabel: string | undefined = undefined;
            let edgeStyle: React.CSSProperties = {
              strokeWidth: 1.5,
              stroke: edgeColor,
            };

            if (step.stepType === 'loop') {
              if (isLoopExit) {
                edgeColor = 'hsl(var(--chart-2))';
                edgeLabel = undefined;
                edgeStyle = { strokeWidth: 2, stroke: edgeColor };
              } else {
                edgeLabel = undefined;
              }
            } else if (step.stepType === 'condition') {
              if (isNegativePath) {
                edgeColor = 'hsl(var(--destructive))';
                edgeLabel = 'false';
              } else if (isPositivePath) {
                edgeColor = 'hsl(var(--chart-2))';
                edgeLabel = 'true';
              }
              edgeStyle = { strokeWidth: 1.5, stroke: edgeColor };
            } else if (step.stepType === 'action' || step.stepType === 'llm') {
              if (isNegativePath) {
                edgeColor = 'hsl(var(--destructive))';
              } else if (isPositivePath) {
                edgeColor = 'hsl(var(--chart-2))';
              }
              edgeStyle = { strokeWidth: 1.5, stroke: edgeColor };
            }

            const targetIsLoop =
              sortedSteps.find((s) => s.stepSlug === targetStepSlug)
                ?.stepType === 'loop';

            const sourceStep = sortedSteps.find(
              (s) => s.stepSlug === step.stepSlug,
            );
            const targetStepData = sortedSteps.find(
              (s) => s.stepSlug === targetStepSlug,
            );

            let sourceHandle = 'bottom-source';
            let targetHandle = 'top-target';
            let edgeType: 'smoothstep' | 'default' = 'smoothstep';

            const isBackwardConnection =
              targetStepData &&
              sourceStep &&
              targetStepData.order < sourceStep.order;

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
                ...(isBackwardConnection
                  ? {
                      strokeDasharray: '5,5',
                      opacity: 0.7,
                      strokeWidth: 2,
                    }
                  : {}),
              },
              animated: !isBackwardConnection,
              data: {
                isBackward: isBackwardConnection,
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

    const layouted = getLayoutedElements(
      nodesWithFullConnectionData,
      edges,
      'TB',
    );

    return {
      initialNodes: layouted.nodes,
      initialEdges: layouted.edges,
    };
  }, [steps]);
}
