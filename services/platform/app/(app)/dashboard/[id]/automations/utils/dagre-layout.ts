import dagre from 'dagre';
import { Node, Edge, Position } from '@xyflow/react';

const nodeWidth = 300;
const nodeHeight = 120;

// Dagre layout configuration constants
// Parent-level layout (top-level nodes and loop containers)
const PARENT_LAYOUT_CONFIG = {
  nodesep: 100, // Horizontal spacing between parent nodes
  ranksep: 50, // Vertical spacing between parent nodes
  edgesep: 20, // Edge separation
  marginx: 50,
  marginy: 50,
} as const;

// Child layout configuration (nodes inside loop containers)
const CHILD_LAYOUT_CONFIG = {
  nodesep: 120, // Horizontal spacing for nodes inside containers
  ranksep: 60, // Vertical spacing for nodes inside containers
  edgesep: 12, // Edge separation inside containers
  marginx: 20,
  marginy: 20,
} as const;

/**
 * Calculate edge weight for conditional branching
 * Lower weight = more horizontal spreading
 */
function calculateEdgeWeight(
  sourceNode: Node | undefined,
  edgeId: string | undefined,
  options: { includeLoopBranches?: boolean } = {},
): number {
  const { includeLoopBranches = true } = options;

  const isConditionalSource =
    sourceNode?.data?.stepType === 'condition' ||
    (includeLoopBranches && sourceNode?.data?.stepType === 'loop');

  const isPositiveBranch =
    edgeId?.includes('-true') ||
    edgeId?.includes('-success') ||
    edgeId?.includes('-approve') ||
    (includeLoopBranches && edgeId?.includes('-done'));

  const isNegativeBranch =
    edgeId?.includes('-false') ||
    edgeId?.includes('-failure') ||
    edgeId?.includes('-reject') ||
    (includeLoopBranches && edgeId?.includes('-error'));

  if (!isConditionalSource) {
    return 10; // Default: stay vertical
  }

  if (isPositiveBranch || isNegativeBranch) {
    return 0.1; // Very low weight = spread horizontally (left/right)
  }

  return 5; // Unknown conditional: middle priority
}

/**
 * Get node dimensions from style or use defaults
 */
function getNodeDimensions(node: Node): { width: number; height: number } {
  return {
    width: (node.style?.width as number) || nodeWidth,
    height: (node.style?.height as number) || nodeHeight,
  };
}

/**
 * Calculate node positions based on layout direction
 */
function calculateNodePositions(isHorizontal: boolean): {
  targetPosition: Position;
  sourcePosition: Position;
} {
  return {
    targetPosition: isHorizontal ? Position.Left : Position.Top,
    sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
  };
}

/**
 * Applies Dagre layout following the official React Flow example
 * https://reactflow.dev/examples/layout/dagre
 *
 * Key principles:
 * - Only layout parent nodes with Dagre
 * - Child nodes (with parentId) use initial positions - React Flow handles nesting
 * - Fresh graph instance per layout to prevent stale data
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  // Create a fresh graph instance for each layout calculation
  // This prevents stale data when switching between automations
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';

  // Separate parent and child nodes
  const parentNodes = nodes.filter((node) => !node.parentId);
  const childNodes = nodes.filter((node) => node.parentId);

  // Configure Dagre for horizontal branching of conditionals
  dagreGraph.setGraph({
    rankdir: direction,
    align: undefined, // No alignment to allow natural horizontal spreading
    ranker: 'network-simplex', // Better for balanced branching
    ...PARENT_LAYOUT_CONFIG,
  });

  // Add parent nodes to dagre with their actual heights and widths
  // Loop containers have dynamic heights based on their children count
  // Loop containers also have wider widths (640px vs 300px)
  parentNodes.forEach((node) => {
    const { width, height } = getNodeDimensions(node);
    dagreGraph.setNode(node.id, { width, height });
  });

  // Add edges between parent nodes with weights for branching control
  edges.forEach((edge) => {
    const sourceIsParent = parentNodes.some((n) => n.id === edge.source);
    const targetIsParent = parentNodes.some((n) => n.id === edge.target);
    if (sourceIsParent && targetIsParent) {
      const sourceNode = parentNodes.find((n) => n.id === edge.source);
      const weight = calculateEdgeWeight(sourceNode, edge.id);
      dagreGraph.setEdge(edge.source, edge.target, { weight });
    }
  });

  // Run dagre layout
  dagre.layout(dagreGraph);

  // Apply positions to parent nodes
  // Shift dagre position (center-center anchor) to top-left (React Flow anchor)
  const layoutedParentNodes = parentNodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const { width, height } = getNodeDimensions(node);
    const positions = calculateNodePositions(isHorizontal);

    return {
      ...node,
      ...positions,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  // Layout child nodes within each parent container using Dagre
  // Group child nodes by parent
  const childNodesByParent = new Map<string, Node[]>();
  childNodes.forEach((node) => {
    if (node.parentId) {
      if (!childNodesByParent.has(node.parentId)) {
        childNodesByParent.set(node.parentId, []);
      }
      childNodesByParent.get(node.parentId)!.push(node);
    }
  });

  const layoutedChildNodes: Node[] = [];

  // Layout each group of children independently
  childNodesByParent.forEach((children, parentId) => {
    // Get the parent node to determine its actual width
    const parentNode = layoutedParentNodes.find((n) => n.id === parentId);
    const parentWidth = (parentNode?.style?.width as number) || 640;

    // Get edges between these children
    const childIds = new Set(children.map((c) => c.id));
    const childEdges = edges.filter(
      (edge) => childIds.has(edge.source) && childIds.has(edge.target),
    );

    if (children.length === 0) return;

    // Create a separate Dagre graph for this parent's children
    const childGraph = new dagre.graphlib.Graph();
    childGraph.setDefaultEdgeLabel(() => ({}));
    childGraph.setGraph({
      rankdir: 'TB',
      align: undefined, // No alignment for horizontal branching
      ranker: 'network-simplex',
      ...CHILD_LAYOUT_CONFIG,
    });

    // Add child nodes to the graph with their ACTUAL dimensions
    // This is critical for nested loops which have dynamic heights
    children.forEach((child) => {
      const { width, height } = getNodeDimensions(child);
      childGraph.setNode(child.id, { width, height });
    });

    // Add edges with weights for conditional branching
    childEdges.forEach((edge) => {
      const sourceNode = children.find((n) => n.id === edge.source);
      // For child edges within containers, exclude loop-specific branches
      const weight = calculateEdgeWeight(sourceNode, edge.id, {
        includeLoopBranches: false,
      });
      childGraph.setEdge(edge.source, edge.target, { weight });
    });

    // Run dagre layout on children
    dagre.layout(childGraph);

    // Apply positions relative to parent container
    // Center the group horizontally within the parent
    const childPositions = children.map((child) => ({
      child,
      pos: childGraph.node(child.id),
    }));

    // Find the bounding box of all positioned children
    const minX = Math.min(
      ...childPositions.map((cp) => {
        const { width } = getNodeDimensions(cp.child);
        return cp.pos.x - width / 2;
      }),
    );
    const maxX = Math.max(
      ...childPositions.map((cp) => {
        const { width } = getNodeDimensions(cp.child);
        return cp.pos.x + width / 2;
      }),
    );
    const groupWidth = maxX - minX;

    // Calculate offset to center the group in the container with padding
    // Loop containers have dynamic widths based on nesting depth
    const containerWidth = parentWidth; // Use actual parent width
    const horizontalPadding = 16;
    const availableWidth = containerWidth - 2 * horizontalPadding;
    const containerCenterX = horizontalPadding + availableWidth / 2;
    const groupCenterX = minX + groupWidth / 2;
    const xOffset = containerCenterX - groupCenterX;

    // Position each child node with padding constraints
    childPositions.forEach(({ child, pos }) => {
      const { width: childWidth, height: childHeight } =
        getNodeDimensions(child);
      const positions = calculateNodePositions(isHorizontal);
      let xPos = pos.x - childWidth / 2 + xOffset;

      // Ensure nodes stay within padding boundaries
      xPos = Math.max(horizontalPadding, xPos); // left boundary
      xPos = Math.min(containerWidth - childWidth - horizontalPadding, xPos); // right boundary

      layoutedChildNodes.push({
        ...child,
        ...positions,
        position: {
          x: xPos,
          y: pos.y - childHeight / 2 + 80, // Add top padding for loop header
        },
      });
    });

    // Calculate dynamic height based on actual child positions AND heights
    // This is critical for nested loops which have variable heights
    if (childPositions.length > 0) {
      const minY = Math.min(
        ...childPositions.map((cp) => {
          const { height } = getNodeDimensions(cp.child);
          return cp.pos.y - height / 2;
        }),
      );
      const maxY = Math.max(
        ...childPositions.map((cp) => {
          const { height } = getNodeDimensions(cp.child);
          return cp.pos.y + height / 2;
        }),
      );
      const actualChildrenHeight = maxY - minY;

      // Calculate total container height with padding
      const topPadding = 80; // Header + spacing
      const bottomPadding = 40; // Bottom margin

      const calculatedHeight =
        topPadding + actualChildrenHeight + bottomPadding;

      // Enforce minimum height of 300px for loop containers
      const dynamicHeight = Math.max(300, calculatedHeight);

      // Update the parent loop container's height in the style object
      const parentNode = layoutedParentNodes.find((n) => n.id === parentId);
      if (parentNode) {
        if (parentNode.style) {
          parentNode.style.height = dynamicHeight;
        }
        // CRITICAL: Also update the node's width/height properties for React Flow
        parentNode.width = (parentNode.style?.width as number) || 640;
        parentNode.height = dynamicHeight;
      }
    }
  });

  // Re-run Dagre layout with updated loop container heights
  // This ensures nodes below loops are positioned correctly based on actual loop heights
  const dagreGraphUpdated = new dagre.graphlib.Graph();
  dagreGraphUpdated.setDefaultEdgeLabel(() => ({}));
  dagreGraphUpdated.setGraph({
    rankdir: direction,
    align: undefined, // No alignment for horizontal branching
    ranker: 'network-simplex',
    ...PARENT_LAYOUT_CONFIG, // Must match first pass
  });

  // Re-add parent nodes with UPDATED heights
  layoutedParentNodes.forEach((node) => {
    const { width, height } = getNodeDimensions(node);
    dagreGraphUpdated.setNode(node.id, { width, height });
  });

  // Re-add edges between parent nodes
  edges.forEach((edge) => {
    const sourceIsParent = layoutedParentNodes.some(
      (n) => n.id === edge.source,
    );
    const targetIsParent = layoutedParentNodes.some(
      (n) => n.id === edge.target,
    );
    if (sourceIsParent && targetIsParent) {
      const sourceNode = layoutedParentNodes.find((n) => n.id === edge.source);
      const weight = calculateEdgeWeight(sourceNode, edge.id);
      dagreGraphUpdated.setEdge(edge.source, edge.target, { weight });
    }
  });

  // Re-run dagre layout with corrected heights
  dagre.layout(dagreGraphUpdated);

  // Update parent node positions with corrected layout
  layoutedParentNodes.forEach((node) => {
    const nodeWithPosition = dagreGraphUpdated.node(node.id);
    const { width, height } = getNodeDimensions(node);

    node.position = {
      x: nodeWithPosition.x - width / 2,
      y: nodeWithPosition.y - height / 2,
    };
  });

  // Collect final layout results
  const finalNodes = [...layoutedParentNodes, ...layoutedChildNodes];

  return { nodes: finalNodes, edges };
}
