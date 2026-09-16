'use client';

import type { Edge, Node } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type EdgeRoutes,
  type ElkLayoutOptions,
  layoutWithElk,
} from './elk-layout';

/**
 * Runs {@link layoutWithElk} (async) and returns positioned nodes for a React
 * Flow canvas. ELK layout is asynchronous, so until the first run resolves
 * `nodes` is empty and `isLayouting` is true.
 *
 * Re-layout fires only when the graph's *structure* changes — a signature of
 * node ids/sizes/parents plus the layered-edge endpoints — so unrelated
 * re-renders (selection, hover) don't thrash the layout. Stale async results
 * are discarded via a cancellation flag.
 */
export function useElkLayout(
  nodes: Node[],
  layoutEdges: Edge[],
  options?: ElkLayoutOptions,
): { nodes: Node[]; edgeRoutes: EdgeRoutes; isLayouting: boolean } {
  const [layouted, setLayouted] = useState<Node[]>([]);
  const [edgeRoutes, setEdgeRoutes] = useState<EdgeRoutes>({});
  const [isLayouting, setIsLayouting] = useState(true);

  const signature = useMemo(() => {
    const nodeSig = nodes
      .map((n) => {
        const w = n.width ?? n.style?.width ?? '';
        const h = n.height ?? n.style?.height ?? '';
        return `${n.id}:${w}x${h}:${n.parentId ?? ''}`;
      })
      .join('|');
    const edgeSig = layoutEdges.map((e) => `${e.source}>${e.target}`).join('|');
    return `${nodeSig}#${edgeSig}#${JSON.stringify(options ?? {})}`;
  }, [nodes, layoutEdges, options]);

  // Keep the latest inputs without widening the effect's dependency list to
  // referentially-unstable arrays.
  const latest = useRef({ nodes, layoutEdges, options });
  latest.current = { nodes, layoutEdges, options };

  useEffect(() => {
    let cancelled = false;
    setIsLayouting(true);
    const { nodes: n, layoutEdges: e, options: o } = latest.current;
    layoutWithElk(n, e, o)
      .then((result) => {
        if (cancelled) return;
        setLayouted(result.nodes);
        setEdgeRoutes(result.edgeRoutes);
        setIsLayouting(false);
      })
      .catch((error: unknown) => {
        console.error('ELK layout failed; rendering unpositioned nodes', error);
        if (cancelled) return;
        setLayouted(latest.current.nodes);
        setEdgeRoutes({});
        setIsLayouting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signature]);

  return { nodes: layouted, edgeRoutes, isLayouting };
}
