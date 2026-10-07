import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { layoutWithElk } from './elk-layout';

// Minimal Node factory — layoutWithElk only reads id/parentId/width/height/style.
function node(id: string, extra: Partial<Node> = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: {}, ...extra };
}

function byId(nodes: Node[], id: string): Node {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`node ${id} missing from layout output`);
  return found;
}

describe('layoutWithElk', () => {
  it('returns the input unchanged for an empty graph', async () => {
    const { nodes } = await layoutWithElk([], []);
    expect(nodes).toEqual([]);
  });

  it('assigns finite positions to a simple chain', async () => {
    const nodes = [
      node('a', { width: 100, height: 50 }),
      node('b', { width: 100, height: 50 }),
    ];
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b' }];
    const { nodes: out } = await layoutWithElk(nodes, edges);

    for (const n of out) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // Top-to-bottom: the target sits below the source.
    const a = byId(out, 'a');
    const b = byId(out, 'b');
    expect(b.position.y).toBeGreaterThan(a.position.y);
  });

  it('returns an absolute orthogonal route for each layout edge', async () => {
    const nodes = [
      node('a', { width: 100, height: 50 }),
      node('b', { width: 100, height: 50 }),
    ];
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b' }];
    const { nodes: out, edgeRoutes } = await layoutWithElk(nodes, edges);

    const route = edgeRoutes.e;
    expect(route).toBeDefined();
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (const p of route) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The route's endpoints sit between the two stacked nodes (absolute coords).
    const a = byId(out, 'a');
    const b = byId(out, 'b');
    const ys = route.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(a.position.y - 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(b.position.y + 51);
  });

  it('offsets routes of edges inside a container to absolute coordinates', async () => {
    // A node above the loop pushes the container's absolute Y well down, so the
    // assertion below distinguishes an absolute route from a (wrongly) parent-
    // relative one.
    const nodes = [
      node('top', { width: 100, height: 50 }),
      node('loop'),
      node('c1', { parentId: 'loop', width: 80, height: 40 }),
      node('c2', { parentId: 'loop', width: 80, height: 40 }),
    ];
    const edges: Edge[] = [
      { id: 'enter', source: 'top', target: 'loop' },
      { id: 'inner', source: 'c1', target: 'c2' },
    ];
    const { nodes: out, edgeRoutes } = await layoutWithElk(nodes, edges, {
      compoundPadding: { top: 80, right: 16, bottom: 24, left: 16 },
    });

    const route = edgeRoutes.inner;
    expect(route).toBeDefined();
    // c1/c2 positions are parent-relative; the route is absolute. Its lowest
    // point must clear the container's absolute top + header padding — which is
    // only true if the parent offset was added.
    const loop = byId(out, 'loop');
    const minY = Math.min(...route.map((p) => p.y));
    expect(minY).toBeGreaterThan(loop.position.y + 80);
  });

  it('lays out a cyclic graph without throwing or producing NaN', async () => {
    const nodes = [
      node('a', { width: 100, height: 50 }),
      node('b', { width: 100, height: 50 }),
      node('c', { width: 100, height: 50 }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'a' }, // closes the cycle
    ];
    const { nodes: out } = await layoutWithElk(nodes, edges, {
      cycleBreaking: 'DEPTH_FIRST',
    });

    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('auto-sizes a compound container to fit its children plus header padding', async () => {
    const childWidth = 80;
    const childHeight = 40;
    const padding = { top: 80, right: 16, bottom: 24, left: 16 };
    const nodes = [
      node('loop'), // compound: no fixed size
      node('child-1', {
        parentId: 'loop',
        width: childWidth,
        height: childHeight,
      }),
      node('child-2', {
        parentId: 'loop',
        width: childWidth,
        height: childHeight,
      }),
    ];
    const edges: Edge[] = [{ id: 'e', source: 'child-1', target: 'child-2' }];
    const { nodes: out } = await layoutWithElk(nodes, edges, {
      compoundPadding: padding,
    });

    const loop = byId(out, 'loop');
    // Container grew beyond a single child to wrap both children + padding.
    expect(loop.width ?? 0).toBeGreaterThan(childWidth);
    expect(loop.height ?? 0).toBeGreaterThan(childHeight + padding.top);

    // Children are positioned relative to the parent, below the header padding,
    // and within the container bounds (React Flow's nested-node model).
    for (const id of ['child-1', 'child-2']) {
      const child = byId(out, id);
      expect(child.position.y).toBeGreaterThanOrEqual(padding.top - 1);
      expect(child.position.x + childWidth).toBeLessThanOrEqual(
        (loop.width ?? 0) + 1,
      );
    }
  });
});
