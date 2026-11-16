/**
 * `@tale/ui/flow/layout` — lays out a `FlowGraph` with ELK (in a worker,
 * the main thread when it cannot start, one column when ELK fails) and
 * answers where every box, frame, route and label goes.
 */
export { getFlowElk } from './elk-client';
export {
  layoutFlowGraph,
  type ElkLike,
  type FlowElk,
  type LayoutFlowGraphOptions,
} from './layout-flow-graph';
export {
  FLOW_NODE_WIDTH,
  flowEdgeLabelSize,
  flowNodeSize,
  type FlowTextMeasure,
} from './sizes';
export {
  useFlowLayout,
  type FlowLayoutStatus,
  type UseFlowLayoutOptions,
  type UseFlowLayoutResult,
} from './use-flow-layout';
export type { FlowLayout, FlowPoint, FlowRect } from '../types';
