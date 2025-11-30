import { Node, Position } from '@xyflow/react';

// Extended Node type with positionAbsolute for React Flow compatibility
interface NodeWithAbsolutePosition extends Node {
  positionAbsolute?: { x: number; y: number };
}

// Returns the position (top, right, bottom, left) passed node compared to the other node
function getParams(nodeA: Node, nodeB: Node): [number, number, Position] {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const horizontalDiff = Math.abs(centerA.x - centerB.x);
  const verticalDiff = Math.abs(centerA.y - centerB.y);

  let position: Position;

  // Determine which side of nodeA is closest to nodeB
  if (horizontalDiff > verticalDiff) {
    position = centerA.x > centerB.x ? Position.Left : Position.Right;
  } else {
    position = centerA.y > centerB.y ? Position.Top : Position.Bottom;
  }

  const [x, y] = getHandleCoordsByPosition(nodeA, position);
  return [x, y, position];
}

function getHandleCoordsByPosition(
  node: Node,
  handlePosition: Position,
): [number, number] {
  // Get node dimensions
  const nodeWidth = node.measured?.width || 300;
  const nodeHeight = node.measured?.height || 120;

  // Calculate handle position based on node position and dimensions
  const handleOffset = 0; // Handles are at the edge
  let x = node.position.x;
  let y = node.position.y;

  // If node is a child node (has parentNode), we need to calculate absolute position
  if (node.parentId) {
    // For child nodes, position is relative to parent
    // We need the absolute position which React Flow provides via positionAbsolute
    const nodeWithAbs = node as NodeWithAbsolutePosition;
    x = nodeWithAbs.positionAbsolute?.x ?? node.position.x;
    y = nodeWithAbs.positionAbsolute?.y ?? node.position.y;
  }

  switch (handlePosition) {
    case Position.Top:
      return [x + nodeWidth / 2, y + handleOffset];
    case Position.Right:
      return [x + nodeWidth - handleOffset, y + nodeHeight / 2];
    case Position.Bottom:
      return [x + nodeWidth / 2, y + nodeHeight - handleOffset];
    case Position.Left:
      return [x + handleOffset, y + nodeHeight / 2];
    default:
      return [x + nodeWidth / 2, y + nodeHeight / 2];
  }
}

function getNodeCenter(node: Node) {
  const nodeWidth = node.measured?.width || 300;
  const nodeHeight = node.measured?.height || 120;

  let x = node.position.x + nodeWidth / 2;
  let y = node.position.y + nodeHeight / 2;

  // If node is a child node, use absolute position
  if (node.parentId) {
    const nodeWithAbs = node as NodeWithAbsolutePosition;
    x = (nodeWithAbs.positionAbsolute?.x ?? node.position.x) + nodeWidth / 2;
    y = (nodeWithAbs.positionAbsolute?.y ?? node.position.y) + nodeHeight / 2;
  }

  return { x, y };
}

export function getEdgeParams(source: Node, target: Node) {
  const [sx, sy, sourcePos] = getParams(source, target);
  const [tx, ty, targetPos] = getParams(target, source);

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  };
}
