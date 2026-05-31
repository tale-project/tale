import { describe, expect, it } from 'vitest';

import { type DependencyEdge, wouldCreateCycle } from './dependencies';

const edge = (
  blockerTaskId: string,
  blockedTaskId: string,
): DependencyEdge => ({
  blockerTaskId,
  blockedTaskId,
});

describe('wouldCreateCycle', () => {
  it('treats a self-edge as a cycle', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('allows an independent edge', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
    expect(wouldCreateCycle([edge('a', 'b')], 'c', 'd')).toBe(false);
  });

  it('detects a direct two-node cycle', () => {
    // a blocks b already; adding b blocks a closes the loop.
    expect(wouldCreateCycle([edge('a', 'b')], 'b', 'a')).toBe(true);
  });

  it('detects a transitive cycle', () => {
    // a → b → c already; adding c → a closes a three-node loop.
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
  });

  it('allows a diamond (shared nodes, no cycle)', () => {
    // a blocks b and c; adding b → d and c → d is a valid DAG.
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd')];
    expect(wouldCreateCycle(edges, 'c', 'd')).toBe(false);
  });

  it('allows extending an existing chain forward', () => {
    // a → b → c; adding c → d extends the chain without looping.
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCreateCycle(edges, 'c', 'd')).toBe(false);
  });
});
