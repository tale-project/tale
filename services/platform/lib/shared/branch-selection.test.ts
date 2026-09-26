import { describe, expect, it } from 'vitest';

import {
  forkGroupsForPath,
  forkKey,
  parseBranchSelections,
  resolveViewPath,
  selectionChainFor,
  type BranchInfo,
} from './branch-selection';

/**
 * The view resolver decides which sibling a conversation renders — a wrong
 * walk silently shows the wrong version of a conversation, so the boundaries
 * (invalid selections, purged branches, nested edits) are pinned here.
 */

const branch = (
  id: string,
  parentId: string,
  forkSequence: number,
  createdAt = 1,
): BranchInfo => ({ id, parentId, forkSequence, createdAt });

describe('parseBranchSelections', () => {
  it('reads a valid map and drops malformed values', () => {
    expect(parseBranchSelections('{"root:2":"b1","x":3}')).toEqual({
      'root:2': 'b1',
    });
  });

  it('treats corrupt JSON and absence as no choices', () => {
    expect(parseBranchSelections('nonsense{')).toEqual({});
    expect(parseBranchSelections(null)).toEqual({});
    expect(parseBranchSelections(undefined)).toEqual({});
  });
});

describe('resolveViewPath', () => {
  it('stays on the root without selections', () => {
    expect(resolveViewPath('root', [branch('b1', 'root', 2)], {})).toEqual([
      'root',
    ]);
  });

  it('follows a selected sibling, and nested selections below it', () => {
    const branches = [
      branch('b1', 'root', 2),
      branch('b2', 'b1', 4, 2),
      branch('b3', 'b1', 4, 3),
    ];
    const selections = {
      [forkKey('root', 2)]: 'b1',
      [forkKey('b1', 4)]: 'b3',
    };
    expect(resolveViewPath('root', branches, selections)).toEqual([
      'root',
      'b1',
      'b3',
    ]);
  });

  it('follows the earliest fork that selects away from the node', () => {
    const branches = [branch('early', 'root', 1), branch('late', 'root', 5)];
    const selections = {
      [forkKey('root', 1)]: 'early',
      // The later fork's choice belongs to a tail the view replaced.
      [forkKey('root', 5)]: 'late',
    };
    expect(resolveViewPath('root', branches, selections)).toEqual([
      'root',
      'early',
    ]);
  });

  it('ignores selections pointing at purged or foreign branches', () => {
    const branches = [branch('b1', 'root', 2)];
    expect(
      resolveViewPath('root', branches, { [forkKey('root', 2)]: 'gone' }),
    ).toEqual(['root']);
    expect(
      resolveViewPath('root', branches, { [forkKey('root', 3)]: 'b1' }),
    ).toEqual(['root']);
  });
});

describe('forkGroupsForPath', () => {
  it('lists the parent first and marks the followed sibling current', () => {
    const branches = [branch('b1', 'root', 2, 1), branch('b2', 'root', 2, 2)];
    const groups = forkGroupsForPath(['root', 'b2'], branches);
    expect(groups.get(2)).toEqual({
      parentId: 'root',
      forkSequence: 2,
      siblings: ['root', 'b1', 'b2'],
      currentIndex: 2,
    });
  });

  it('keeps forks before the jump and drops forks in the replaced tail', () => {
    const branches = [
      branch('kept', 'root', 1, 1),
      branch('jumped', 'root', 3, 2),
      branch('dropped', 'root', 5, 3),
    ];
    const groups = forkGroupsForPath(['root', 'jumped'], branches);
    expect(groups.get(1)?.currentIndex).toBe(0);
    expect(groups.get(3)?.currentIndex).toBe(1);
    expect(groups.has(5)).toBe(false);
  });

  it('ignores a selection naming a branch that has not arrived yet', () => {
    // The edit flow flips the selection optimistically before the branches
    // watch pushes the new row — the view must stay on the current sibling
    // (the swap hold covers the gap) instead of dead-ending.
    const path = resolveViewPath('root', [branch('b1', 'root', 2, 1)], {
      'root:2': 'not-yet-created',
    });
    expect(path).toEqual(['root']);
  });

  // Three versions of ONE turn, however they were written. The server hangs
  // a fork at a sibling's own fork sequence off the sibling's parent; a
  // lineage written before it did (a chain R → B1 → B2 at one sequence)
  // must read the same way, with the original reachable.

  it('reads "try again" then "edit" as 3/3 with the original reachable (flat)', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b2', 'root', 0, 2)];
    const groups = forkGroupsForPath(['root', 'b2'], branches);
    expect(groups.get(0)).toEqual({
      parentId: 'root',
      forkSequence: 0,
      siblings: ['root', 'b1', 'b2'],
      currentIndex: 2,
    });
    expect(groups.size).toBe(1);
  });

  it('merges a chain written before the flatten into one fork point', () => {
    // "Try again" (b1 off root), then "Edit" taken from b1 (b2 off b1).
    const branches = [branch('b1', 'root', 0, 1), branch('b2', 'b1', 0, 2)];
    const groups = forkGroupsForPath(['root', 'b1', 'b2'], branches);
    expect(groups.get(0)).toEqual({
      parentId: 'root',
      forkSequence: 0,
      siblings: ['root', 'b1', 'b2'],
      currentIndex: 2,
    });
    expect(groups.size).toBe(1);
  });

  it('reads two "try again"s taken in a row as three replies of one turn', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b1b', 'b1', 0, 2)];
    const groups = forkGroupsForPath(['root', 'b1', 'b1b'], branches);
    expect(groups.get(0)?.siblings).toEqual(['root', 'b1', 'b1b']);
    expect(groups.get(0)?.currentIndex).toBe(2);
  });

  it('shows the whole chain from any of its members, marking the deepest on screen', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b2', 'b1', 0, 2)];
    expect(forkGroupsForPath(['root', 'b1'], branches).get(0)).toMatchObject({
      siblings: ['root', 'b1', 'b2'],
      currentIndex: 1,
    });
    expect(forkGroupsForPath(['root'], branches).get(0)).toMatchObject({
      siblings: ['root', 'b1', 'b2'],
      currentIndex: 0,
    });
  });

  it('orders a merged group by creation, whichever node a version hangs off', () => {
    // A chain (b1 → b2) plus a flattened fork b3 taken later, off the root.
    const branches = [
      branch('b1', 'root', 0, 1),
      branch('b2', 'b1', 0, 2),
      branch('b3', 'root', 0, 3),
    ];
    const groups = forkGroupsForPath(['root', 'b1', 'b2'], branches);
    expect(groups.get(0)?.siblings).toEqual(['root', 'b1', 'b2', 'b3']);
  });

  it('collapses a path node that only COPIES the message at a merged sequence', () => {
    // b1 forked at 4 shows the root's copy at 2; its own fork y at 2 and
    // the root's x at 2 are versions of that one turn — b1 is not.
    const branches = [
      branch('b1', 'root', 4, 1),
      branch('x', 'root', 2, 2),
      branch('y', 'b1', 2, 3),
    ];
    const groups = forkGroupsForPath(['root', 'b1'], branches);
    expect(groups.get(2)).toEqual({
      parentId: 'root',
      forkSequence: 2,
      siblings: ['root', 'x', 'y'],
      currentIndex: 0,
    });
    expect(
      forkGroupsForPath(['root', 'b1', 'y'], branches).get(2),
    ).toMatchObject({ currentIndex: 2 });
  });
});

describe('selectionChainFor', () => {
  it('writes one key on a flat fork point', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b3', 'root', 0, 2)];
    expect(selectionChainFor(0, 'b3', ['root', 'b1'], branches)).toEqual([
      { forkKey: 'root:0', selectedThreadId: 'b3' },
    ]);
    expect(selectionChainFor(0, 'root', ['root', 'b1'], branches)).toEqual([
      { forkKey: 'root:0', selectedThreadId: 'root' },
    ]);
  });

  it('writes every ancestor’s key for a version deep in a chain, root-most first', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b2', 'b1', 0, 2)];
    expect(selectionChainFor(0, 'b2', ['root', 'b1', 'b2'], branches)).toEqual([
      { forkKey: 'root:0', selectedThreadId: 'b1' },
      { forkKey: 'b1:0', selectedThreadId: 'b2' },
    ]);
  });

  it('pins a chosen version with versions below it, so the walk stops there', () => {
    const branches = [branch('b1', 'root', 0, 1), branch('b2', 'b1', 0, 2)];
    expect(selectionChainFor(0, 'b1', ['root', 'b1', 'b2'], branches)).toEqual([
      { forkKey: 'root:0', selectedThreadId: 'b1' },
      { forkKey: 'b1:0', selectedThreadId: 'b1' },
    ]);
    // The original: every path node forking at 0 is pinned to its own tail.
    expect(
      selectionChainFor(0, 'root', ['root', 'b1', 'b2'], branches),
    ).toEqual([
      { forkKey: 'root:0', selectedThreadId: 'root' },
      { forkKey: 'b1:0', selectedThreadId: 'b1' },
    ]);
  });

  it('keys a version hanging off a later-forked sibling on that sibling', () => {
    const branches = [
      branch('b1', 'root', 4, 1),
      branch('x', 'root', 2, 2),
      branch('y', 'b1', 2, 3),
    ];
    expect(selectionChainFor(2, 'y', ['root', 'b1'], branches)).toEqual([
      { forkKey: 'b1:2', selectedThreadId: 'y' },
      { forkKey: 'root:2', selectedThreadId: 'root' },
    ]);
    expect(selectionChainFor(2, 'x', ['root', 'b1', 'y'], branches)).toEqual([
      { forkKey: 'root:2', selectedThreadId: 'x' },
      { forkKey: 'b1:2', selectedThreadId: 'b1' },
    ]);
  });
});
