// Type declarations for dagre layout library
// These types cover only the API used by this project

declare module "dagre" {
  export interface NodeConfig {
    width: number;
    height: number;
  }

  export interface EdgeConfig {
    weight?: number;
  }

  export interface GraphLabel {
    rankdir?: "TB" | "BT" | "LR" | "RL";
    align?: "UL" | "UR" | "DL" | "DR";
    nodesep?: number;
    edgesep?: number;
    ranksep?: number;
    marginx?: number;
    marginy?: number;
    acyclicer?: string;
    ranker?: "network-simplex" | "tight-tree" | "longest-path";
  }

  export interface NodeInfo {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export class Graph {
    setGraph(label: GraphLabel): void;
    setDefaultEdgeLabel(labelFn: () => object): void;
    setNode(id: string, config: NodeConfig): void;
    setEdge(source: string, target: string, config?: EdgeConfig): void;
    node(id: string): NodeInfo;
  }

  export const graphlib: {
    Graph: new () => Graph;
  };

  export function layout(graph: Graph): void;

  const dagre: {
    graphlib: typeof graphlib;
    layout: typeof layout;
  };

  export default dagre;
}
