import {
  isAxisAligned,
  rectsOverlap,
  segmentCrossesRect,
} from '../layout/geometry';
import type { FlowLayout, FlowPoint, FlowRect } from '../types';

/**
 * Assertions over a finished layout, for unit tests (bundled ELK) and
 * browser tests (the worker, and boxes measured on the page) alike. Each
 * throws with every offence it found, named, so a failure says which edge
 * ran through which box.
 */

/** Every box an edge must route round: nodes and frame headers. */
export function flowObstacles(
  layout: FlowLayout,
): { id: string; rect: FlowRect }[] {
  return [
    ...Object.entries(layout.nodes).map(([id, rect]) => ({ id, rect })),
    ...Object.entries(layout.groups).map(([id, group]) => ({
      id: `${id} (header)`,
      rect: group.header,
    })),
  ];
}

/** The edges whose routes pass through a box, as "edge ∩ box" lines. */
export function edgeBoxCrossings(
  routes: Readonly<Record<string, { points: readonly FlowPoint[] }>>,
  obstacles: readonly { id: string; rect: FlowRect }[],
  inset = 1,
): string[] {
  const found: string[] = [];
  for (const [edgeId, { points }] of Object.entries(routes)) {
    for (let index = 0; index + 1 < points.length; index++) {
      const a = points[index];
      const b = points[index + 1];
      for (const obstacle of obstacles)
        if (segmentCrossesRect(a, b, obstacle.rect, inset))
          found.push(`${edgeId} ∩ ${obstacle.id}`);
    }
  }
  return [...new Set(found)];
}

/** Throws when an edge runs through a node, a gate, Start, End or a frame
 *  header (shrunk by `inset` px, so meeting a border does not count). */
export function assertNoEdgeCrossesBox(layout: FlowLayout, inset = 1): void {
  const crossings = edgeBoxCrossings(
    layout.edges,
    flowObstacles(layout),
    inset,
  );
  if (crossings.length > 0)
    throw new Error(`Edges cross boxes:\n  ${crossings.join('\n  ')}`);
}

/** Throws when an edge label overlaps a box or another label. */
export function assertLabelsClear(layout: FlowLayout): void {
  const problems: string[] = [];
  const labels = Object.entries(layout.edges).flatMap(([id, edge]) =>
    edge.label ? [{ id, rect: edge.label }] : [],
  );
  for (const label of labels)
    for (const obstacle of flowObstacles(layout))
      if (rectsOverlap(label.rect, obstacle.rect))
        problems.push(`label of ${label.id} ∩ ${obstacle.id}`);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i];
      const b = labels[j];
      if (a && b && rectsOverlap(a.rect, b.rect))
        problems.push(`label of ${a.id} ∩ label of ${b.id}`);
    }
  if (problems.length > 0)
    throw new Error(`Labels overlap:\n  ${problems.join('\n  ')}`);
}

/** Throws when a route has a segment that is neither horizontal nor
 *  vertical, or fewer than two points. */
export function assertRoutesAxisAligned(layout: FlowLayout): void {
  const bad = Object.entries(layout.edges)
    .filter(([, edge]) => edge.points.length < 2 || !isAxisAligned(edge.points))
    .map(([id, edge]) => `${id} ${JSON.stringify(edge.points)}`);
  if (bad.length > 0)
    throw new Error(`Routes are not axis-aligned:\n  ${bad.join('\n  ')}`);
}

/** The index of the row `id` sits in, or -1. */
export function flowRowIndex(layout: FlowLayout, id: string): number {
  return layout.rows.findIndex((row) => row.includes(id));
}

/**
 * Pairs of nodes that share a row before and after a relayout and swapped
 * sides: what a reader sees as boxes jumping past each other.
 */
export function flowRowOrderFlips(
  before: FlowLayout,
  after: FlowLayout,
): string[] {
  const flips: string[] = [];
  for (const row of before.rows) {
    for (let i = 0; i < row.length; i++) {
      for (let j = i + 1; j < row.length; j++) {
        const left = row[i];
        const right = row[j];
        const afterRow = after.rows.find((candidate) =>
          candidate.includes(left),
        );
        if (afterRow === undefined || !afterRow.includes(right)) continue;
        if (afterRow.indexOf(left) > afterRow.indexOf(right))
          flips.push(`${left} ↔ ${right}`);
      }
    }
  }
  return flips;
}
