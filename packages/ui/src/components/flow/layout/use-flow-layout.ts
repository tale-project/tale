'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { FlowEdge, FlowGraph, FlowLayout } from '../types';
import { retainFlowElk } from './elk-client';
import { flowLayoutCache } from './layout-cache';
import {
  defaultEdgeLabel,
  flowLayoutSignature,
  layoutFlowGraph,
  type FlowElk,
} from './layout-flow-graph';
import { estimateFlowText, loadFlowFonts, measureFlowText } from './sizes';

export type FlowLayoutStatus = 'pending' | 'ready' | 'failed';

export interface UseFlowLayoutOptions {
  /**
   * What the graph is a picture of — a document and the version on screen.
   * The same key with a changed graph lays it out again keeping every row's
   * order (a live relayout); a new key is another picture, laid out afresh.
   */
  layoutKey: string;
  /** The words on an edge ("Yes", "No"). */
  edgeLabel?: (edge: FlowEdge) => string | undefined;
  /** Tests: the engine to use instead of the shared worker. */
  elk?: FlowElk;
}

export interface UseFlowLayoutResult {
  /** The layout on screen; `null` until the first one resolves. */
  layout: FlowLayout | null;
  /** The layout before it, while the same picture changed — what a
   *  transition moves from. */
  previous: FlowLayout | null;
  /** `failed` when the engine could not run and the graph stands in one
   *  column. */
  status: FlowLayoutStatus;
}

let fontsReady: Promise<void> | null = null;
const fonts = () => (fontsReady ??= loadFlowFonts());

/**
 * Lays out `graph` and keeps the layout current as the graph changes.
 *
 * Only a change to the graph's shape — its nodes, edges, frames and their
 * sizes — lays it out again, so a node's new title or a selection never
 * moves anything. The latest graph wins: a layout still running when
 * another change arrives is cancelled. A fresh layout this session already
 * computed comes from the cache at once.
 */
export function useFlowLayout(
  graph: FlowGraph,
  { layoutKey, edgeLabel = defaultEdgeLabel, elk }: UseFlowLayoutOptions,
): UseFlowLayoutResult {
  const [state, setState] = useState<{
    key: string | null;
    layout: FlowLayout | null;
    previous: FlowLayout | null;
  }>({ key: null, layout: null, previous: null });
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void fonts().then(() => {
      if (live) setFontsLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => retainFlowElk(), []);

  // Nothing is laid out before the fonts are in (a label measured in the
  // face standing in for Inter would size the boxes); the estimate only
  // stands in for the signature until then.
  const signature = useMemo(
    () =>
      flowLayoutSignature(graph, {
        measure: fontsLoaded ? measureFlowText : estimateFlowText,
        edgeLabel,
      }),
    [graph, edgeLabel, fontsLoaded],
  );

  // The newest inputs, read when a layout starts without widening the
  // effect to the graph's identity (a new object every render).
  const latest = useRef({ graph, edgeLabel, elk });
  latest.current = { graph, edgeLabel, elk };
  const shown = useRef(state);
  shown.current = state;

  useEffect(() => {
    if (!fontsLoaded) return undefined;
    const before = shown.current;
    const samePicture = before.key === layoutKey && before.layout !== null;
    if (samePicture && before.layout?.signature === signature) return undefined;
    if (!samePicture) {
      const cached = flowLayoutCache.get(signature);
      if (cached) {
        setState({ key: layoutKey, layout: cached, previous: null });
        return undefined;
      }
    }
    const controller = new AbortController();
    const { graph: current, edgeLabel: label, elk: engine } = latest.current;
    layoutFlowGraph(current, {
      previous: samePicture ? before.layout : null,
      measure: measureFlowText,
      edgeLabel: label,
      elk: engine,
      signal: controller.signal,
    }).then(
      (layout) => {
        if (controller.signal.aborted) return;
        if (!samePicture) flowLayoutCache.set(layout);
        setState({
          key: layoutKey,
          layout,
          previous: samePicture ? before.layout : null,
        });
      },
      (error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Flow layout failed', error);
      },
    );
    return () => controller.abort();
  }, [signature, layoutKey, fontsLoaded]);

  // A picture this session already laid out shows at once, without a
  // pending frame between two versions.
  const current =
    state.key === layoutKey
      ? state.layout
      : fontsLoaded
        ? (flowLayoutCache.peek(signature) ?? null)
        : null;
  return {
    layout: current,
    previous: state.key === layoutKey ? state.previous : null,
    status:
      current === null
        ? 'pending'
        : current.engine === 'fallback-column'
          ? 'failed'
          : 'ready',
  };
}
