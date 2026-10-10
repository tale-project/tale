'use client';

import { useEffect, useState } from 'react';

import type {
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowLayout,
  FlowNode,
  FlowPoint,
  FlowRect,
} from '../types';
import { FLOW_DURATION, FLOW_RELAYOUT_SETTLE } from './flow-motion';

/** A chart on screen: a graph and the layout it is drawn at. */
export interface FlowPicture {
  graph: FlowGraph;
  layout: FlowLayout;
}

/** A line that leaves with a relayout, drawn along its old route. */
export interface FlowLeavingEdge {
  edge: FlowEdge;
  points: readonly FlowPoint[];
  label?: FlowRect;
}

/**
 * What a live relayout does to each part of the chart, worked out from the
 * picture before and the picture after. Pure, so the choreography is
 * tested without a browser.
 */
export interface FlowTransitionPlan {
  /** Nodes on both pictures: they glide to their new place. */
  moving: ReadonlySet<string>;
  /** Nodes only on the new picture: they grow in. */
  entering: ReadonlySet<string>;
  /** Nodes only on the old picture, at their old place: they shrink out. */
  leaving: ReadonlyArray<{ node: FlowNode; rect: FlowRect }>;
  /** Frames on both pictures at the same size: they glide. */
  framesMoving: ReadonlySet<string>;
  /** Frames that are new or changed size: they fade in. */
  framesEntering: ReadonlySet<string>;
  /** Frames that are gone, or the old box of one that changed size. */
  framesLeaving: ReadonlyArray<{
    group: FlowGroup;
    rect: FlowRect & { header: FlowRect };
  }>;
  /** Lines that are new or took another route: they fade in last. */
  edgesEntering: ReadonlySet<string>;
  /** Lines that are gone or took another route, along the old route. */
  edgesLeaving: readonly FlowLeavingEdge[];
}

const samePoints = (
  a: readonly FlowPoint[] | undefined,
  b: readonly FlowPoint[] | undefined,
) =>
  a !== undefined &&
  b !== undefined &&
  a.length === b.length &&
  a.every((point, index) => {
    const other = b[index];
    return other !== undefined && point.x === other.x && point.y === other.y;
  });

const sameSize = (a: FlowRect, b: FlowRect) =>
  a.width === b.width && a.height === b.height;

/** Which parts of the chart enter, leave or move between two pictures. */
export function planFlowTransition(
  from: FlowPicture,
  to: FlowPicture,
): FlowTransitionPlan {
  const before = new Map(from.graph.nodes.map((node) => [node.id, node]));
  const after = new Set(to.graph.nodes.map((node) => node.id));
  const moving = new Set<string>();
  const entering = new Set<string>();
  for (const node of to.graph.nodes) {
    if (to.layout.nodes[node.id] === undefined) continue;
    if (before.has(node.id) && from.layout.nodes[node.id] !== undefined)
      moving.add(node.id);
    else entering.add(node.id);
  }
  const leaving: Array<{ node: FlowNode; rect: FlowRect }> = [];
  for (const node of from.graph.nodes) {
    const rect = from.layout.nodes[node.id];
    if (!after.has(node.id) && rect !== undefined) leaving.push({ node, rect });
  }

  const groupsBefore = new Map(
    (from.graph.groups ?? []).map((group) => [group.id, group]),
  );
  const groupsAfter = new Set((to.graph.groups ?? []).map((group) => group.id));
  const framesMoving = new Set<string>();
  const framesEntering = new Set<string>();
  const framesLeaving: Array<{
    group: FlowGroup;
    rect: FlowRect & { header: FlowRect };
  }> = [];
  for (const group of to.graph.groups ?? []) {
    const rect = to.layout.groups[group.id];
    if (rect === undefined) continue;
    const old = from.layout.groups[group.id];
    const was = groupsBefore.get(group.id);
    if (old !== undefined && was !== undefined && sameSize(old, rect))
      framesMoving.add(group.id);
    else {
      framesEntering.add(group.id);
      if (old !== undefined && was !== undefined)
        framesLeaving.push({ group: was, rect: old });
    }
  }
  for (const group of from.graph.groups ?? []) {
    const rect = from.layout.groups[group.id];
    if (!groupsAfter.has(group.id) && rect !== undefined)
      framesLeaving.push({ group, rect });
  }

  const edgesBefore = new Map(
    from.graph.edges
      .filter((edge) => !edge.layoutOnly)
      .map((edge) => [edge.id, edge]),
  );
  const edgesEntering = new Set<string>();
  const edgesLeaving: FlowLeavingEdge[] = [];
  const drawnAfter = new Set<string>();
  for (const edge of to.graph.edges) {
    if (edge.layoutOnly) continue;
    const route = to.layout.edges[edge.id];
    if (route === undefined) continue;
    drawnAfter.add(edge.id);
    const old = from.layout.edges[edge.id];
    const was = edgesBefore.get(edge.id);
    if (was !== undefined && samePoints(old?.points, route.points)) continue;
    edgesEntering.add(edge.id);
    if (was !== undefined && old !== undefined)
      edgesLeaving.push({
        edge: was,
        points: old.points,
        ...(old.label ? { label: old.label } : {}),
      });
  }
  for (const [id, edge] of edgesBefore) {
    const old = from.layout.edges[id];
    if (drawnAfter.has(id) || old === undefined) continue;
    edgesLeaving.push({
      edge,
      points: old.points,
      ...(old.label ? { label: old.label } : {}),
    });
  }

  return {
    moving,
    entering,
    leaving,
    framesMoving,
    framesEntering,
    framesLeaving,
    edgesEntering,
    edgesLeaving,
  };
}

/** Where a relayout is: leaving parts still on screen, or only the glide
 *  and the last fades left. */
export type FlowTransitionPhase = 'exit' | 'settle';

interface TransitionState {
  picture: FlowPicture | null;
  key: string;
  plan: FlowTransitionPlan | null;
  phase: FlowTransitionPhase | null;
}

/**
 * Plays a live relayout: when the same picture (`layoutKey`) gets a new
 * layout, it plans what enters, leaves and moves, keeps the leaving parts
 * on screen for their exit (`short`), and holds the plan until the
 * geometry has settled (450 ms) — then the chart is plain again. A new
 * `layoutKey`, the first layout, or `enabled: false` (reduced motion)
 * plays nothing. A relayout that lands mid-transition starts from where
 * things are: CSS transitions retarget from the current transforms.
 */
export function useLayoutTransition({
  picture,
  layoutKey,
  enabled,
}: {
  picture: FlowPicture | null;
  layoutKey: string;
  enabled: boolean;
}): { plan: FlowTransitionPlan | null; phase: FlowTransitionPhase | null } {
  const [state, setState] = useState<TransitionState>({
    picture,
    key: layoutKey,
    plan: null,
    phase: null,
  });

  // A new layout on screen: plan its transition while rendering it, so the
  // first frame of the new picture already carries every class it needs.
  let current = state;
  if (state.picture?.layout !== picture?.layout) {
    const live =
      enabled &&
      state.picture !== null &&
      picture !== null &&
      state.key === layoutKey;
    const plan =
      live && state.picture !== null && picture !== null
        ? planFlowTransition(state.picture, picture)
        : null;
    current = {
      picture,
      key: layoutKey,
      plan,
      phase: plan === null ? null : 'exit',
    };
    setState(current);
  } else if (state.key !== layoutKey) {
    // Another picture that happens to share the layout: nothing plays, and
    // the next change of this picture is a live one.
    current = { picture, key: layoutKey, plan: null, phase: null };
    setState(current);
  }

  const { plan } = current;
  useEffect(() => {
    if (plan === null) return undefined;
    const exit = setTimeout(
      () =>
        setState((now) =>
          now.plan === plan ? { ...now, phase: 'settle' } : now,
        ),
      FLOW_DURATION.short,
    );
    const settle = setTimeout(
      () =>
        setState((now) =>
          now.plan === plan ? { ...now, plan: null, phase: null } : now,
        ),
      FLOW_RELAYOUT_SETTLE,
    );
    return () => {
      clearTimeout(exit);
      clearTimeout(settle);
    };
  }, [plan]);

  return { plan: current.plan, phase: current.phase };
}
