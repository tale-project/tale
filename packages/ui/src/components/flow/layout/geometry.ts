import type { FlowPoint, FlowRect } from '../types';

/**
 * Pure geometry for routed edges: turning ELK's sections into one clean
 * polyline, and that polyline into the SVG path the canvas draws.
 */

/** The fragment of an ELK edge section this module reads. */
export interface FlowElkSection {
  id: string;
  startPoint: FlowPoint;
  endPoint: FlowPoint;
  bendPoints?: readonly FlowPoint[];
  incomingSections?: readonly string[];
  outgoingSections?: readonly string[];
}

/**
 * One polyline from an edge's sections. An edge that crosses a frame's
 * border can come back in several sections, each naming the one before and
 * after it; they are joined in that order, the shared junction point once.
 */
export function joinSections(sections: readonly FlowElkSection[]): FlowPoint[] {
  if (sections.length === 0) return [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  const first =
    sections.find(
      (section) =>
        (section.incomingSections ?? []).filter((id) => byId.has(id)).length ===
        0,
    ) ?? sections[0];
  const points: FlowPoint[] = [];
  const seen = new Set<string>();
  let current: FlowElkSection | undefined = first;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    for (const point of [
      current.startPoint,
      ...(current.bendPoints ?? []),
      current.endPoint,
    ]) {
      const last = points.at(-1);
      if (last === undefined || last.x !== point.x || last.y !== point.y)
        points.push({ x: point.x, y: point.y });
    }
    const next: string | undefined = (current.outgoingSections ?? []).find(
      (id) => byId.has(id),
    );
    current = next === undefined ? undefined : byId.get(next);
  }
  // Sections no chain reached (ELK never leaves one, but a malformed answer
  // must not drop a route) follow in the order ELK gave them.
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    for (const point of [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ])
      points.push({ x: point.x, y: point.y });
  }
  return points;
}

/** Rounds to the half pixel: strokes land on the pixel grid at any zoom
 *  that divides it. */
export const snapHalf = (value: number) => Math.round(value * 2) / 2;

/**
 * Snaps a route to the half pixel and makes every segment exactly
 * horizontal or vertical. ELK answers coordinates that differ by a hair
 * (12.2499 against 12.2501) where it means the same line; drawn as given,
 * such a segment is a diagonal a fraction of a pixel wide. A segment is
 * straightened along its longer axis by moving its later end — the earlier
 * one for the last segment, so the arrow still lands where ELK put it.
 * Then repeated and collinear points go.
 */
export function cleanRoute(points: readonly FlowPoint[]): FlowPoint[] {
  const snapped = points.map((point) => ({
    x: snapHalf(point.x),
    y: snapHalf(point.y),
  }));
  for (let index = 0; index + 1 < snapped.length; index++) {
    const a = snapped[index];
    const b = snapped[index + 1];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx === 0 || dy === 0) continue;
    const lastSegment = index + 2 === snapped.length;
    if (dy >= dx) {
      if (lastSegment && index > 0) a.x = b.x;
      else b.x = a.x;
    } else if (lastSegment && index > 0) a.y = b.y;
    else b.y = a.y;
  }
  return dropRedundant(snapped);
}

/** Drops repeated points and interior points on a straight run. */
export function dropRedundant(points: readonly FlowPoint[]): FlowPoint[] {
  const out: FlowPoint[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (last !== undefined && last.x === point.x && last.y === point.y)
      continue;
    const before = out.at(-2);
    if (
      before !== undefined &&
      last !== undefined &&
      ((before.x === last.x && last.x === point.x) ||
        (before.y === last.y && last.y === point.y))
    ) {
      out[out.length - 1] = { x: point.x, y: point.y };
      continue;
    }
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/** Every segment is horizontal or vertical. */
export function isAxisAligned(points: readonly FlowPoint[]): boolean {
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

const distance = (a: FlowPoint, b: FlowPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The route with its last `length` px cut off — where the stroke stops so
 * an arrowhead of that length ends exactly on the route's end point.
 */
export function trimEnd(
  points: readonly FlowPoint[],
  length: number,
): FlowPoint[] {
  const out = points.map((point) => ({ ...point }));
  let left = length;
  while (out.length >= 2 && left > 0) {
    const end = out[out.length - 1];
    const before = out[out.length - 2];
    const run = distance(before, end);
    if (run > left) {
      const ratio = (run - left) / run;
      out[out.length - 1] = {
        x: before.x + (end.x - before.x) * ratio,
        y: before.y + (end.y - before.y) * ratio,
      };
      return out;
    }
    left -= run;
    out.pop();
  }
  return out;
}

const fmt = (value: number) => String(Math.round(value * 100) / 100);

/**
 * An SVG path through an orthogonal route with rounded corners: each
 * corner a quadratic curve of radius `min(radius, half of either segment)`,
 * so two close bends never overshoot each other.
 */
export function roundedOrthogonalPath(
  points: readonly FlowPoint[],
  radius: number,
): string {
  const first = points[0];
  if (first === undefined) return '';
  let path = `M${fmt(first.x)} ${fmt(first.y)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1];
    const corner = points[index];
    const after = points[index + 1];
    const inLength = distance(before, corner);
    const outLength = distance(corner, after);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      path += ` L${fmt(corner.x)} ${fmt(corner.y)}`;
      continue;
    }
    const enter = {
      x: corner.x - ((corner.x - before.x) / inLength) * r,
      y: corner.y - ((corner.y - before.y) / inLength) * r,
    };
    const leave = {
      x: corner.x + ((after.x - corner.x) / outLength) * r,
      y: corner.y + ((after.y - corner.y) / outLength) * r,
    };
    path += ` L${fmt(enter.x)} ${fmt(enter.y)} Q${fmt(corner.x)} ${fmt(corner.y)} ${fmt(leave.x)} ${fmt(leave.y)}`;
  }
  const last = points[points.length - 1];
  if (points.length > 1) path += ` L${fmt(last.x)} ${fmt(last.y)}`;
  return path;
}

/** The direction of the route's last segment, as a unit vector. */
export function endDirection(points: readonly FlowPoint[]): FlowPoint {
  const end = points.at(-1);
  const before = points.at(-2);
  if (end === undefined || before === undefined) return { x: 0, y: 1 };
  const length = distance(before, end) || 1;
  return { x: (end.x - before.x) / length, y: (end.y - before.y) / length };
}

/**
 * Whether the segment `a`–`b` passes through `rect` shrunk by `inset` on
 * every side — touching a border (where an edge meets its own box) does
 * not count.
 */
export function segmentCrossesRect(
  a: FlowPoint,
  b: FlowPoint,
  rect: FlowRect,
  inset = 1,
): boolean {
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  if (right <= left || bottom <= top) return false;
  // Liang–Barsky clipping of the segment against the shrunk rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - left],
    [dx, right - a.x],
    [-dy, a.y - top],
    [dy, bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-9;
}

/** Whether two rectangles share any area. */
export function rectsOverlap(a: FlowRect, b: FlowRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The smallest rectangle around every given one. */
export function boundsOf(rects: readonly FlowRect[]): FlowRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
