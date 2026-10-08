/**
 * Every option the flow layout hands ELK, in one place. The layout is a pure
 * function of the graph and these: change a number here and every canvas
 * changes with it, and the layout tests say whether the pictures still hold.
 *
 * All spacings sit on the 4-px grid. The choices are measured (ELK 0.11.1 on
 * the shipped automations and synthetic graphs of 20 and 40 nodes):
 * orthogonal routing crosses a third as often as splines; model order keeps
 * the picture deterministic and close to the document's own order; one port
 * per edge end on fixed sides keeps edges entering at the top and leaving at
 * the bottom, even the back edge of a cyclic graph.
 *
 * Start and End take no layer constraint: every node is reached from Start
 * and reaches End, so the layering already puts each alone in the first and
 * the last row (a test holds it), and pinning them with
 * `FIRST_SEPARATE`/`LAST_SEPARATE` measured more crossings (2 against 0 on a
 * 40-node graph) and 6–30 % more time for nothing.
 */

export const FLOW_LAYOUT_SPACING = {
  nodeNode: 48,
  betweenLayers: 64,
  edgeNode: 24,
  edgeEdge: 16,
  edgeLabel: 4,
  components: 48,
} as const;

/** Inner padding of a frame; a `repeat` frame keeps room on its right for
 *  the loop arc. */
export const FLOW_FRAME_PADDING = {
  top: 12,
  left: 16,
  bottom: 16,
  right: 16,
  repeatRight: 40,
} as const;

export const FLOW_ELK_ROOT: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  // One graph across frames, so an edge may run into or out of a frame and
  // still be routed round everything in its way.
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.thoroughness': '10',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.spacing.nodeNode': String(FLOW_LAYOUT_SPACING.nodeNode),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(
    FLOW_LAYOUT_SPACING.betweenLayers,
  ),
  'elk.spacing.edgeNode': String(FLOW_LAYOUT_SPACING.edgeNode),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(
    FLOW_LAYOUT_SPACING.edgeNode,
  ),
  'elk.spacing.edgeEdge': String(FLOW_LAYOUT_SPACING.edgeEdge),
  'elk.layered.spacing.edgeEdgeBetweenLayers': String(
    FLOW_LAYOUT_SPACING.edgeEdge,
  ),
  'elk.spacing.edgeLabel': String(FLOW_LAYOUT_SPACING.edgeLabel),
  'elk.spacing.componentComponent': String(FLOW_LAYOUT_SPACING.components),
  // "Yes" and "No" sit just under the gate they leave.
  'elk.edgeLabels.placement': 'TAIL',
  'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
  // Every coordinate ELK answers with is absolute, frames or not.
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'ROOT',
};

/** Added only when a graph already on screen is laid out again: each node
 *  keeps its order within its row (with position hints, measured: no row
 *  order flips after an append, a side branch, a new reference, a removed
 *  node or a new gate). */
export const FLOW_ELK_LIVE: Readonly<Record<string, string>> = {
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};

/** Every node: ports stay on the side they were given. */
export const FLOW_ELK_NODE: Readonly<Record<string, string>> = {
  'elk.portConstraints': 'FIXED_SIDE',
};
