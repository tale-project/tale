import { describe, expect, it } from 'vitest';

import {
  forkGroupsForPath,
  forkKey,
  parseBranchSelections,
  resolveViewPath,
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

  it('lets a deeper node win a sequence collision — its copy is on screen', () => {
    const branches = [branch('b1', 'root', 4, 1), branch('b2', 'b1', 2, 2)];
    const groups = forkGroupsForPath(['root', 'b1'], branches);
    // The leaf's own fork at 2 shadows nothing here, but a root fork at 2
    // would be replaced by it:
    const collided = forkGroupsForPath(
      ['root', 'b1'],
      [...branches, branch('rootFork', 'root', 2, 3)],
    );
    expect(groups.get(2)?.parentId).toBe('b1');
    expect(collided.get(2)?.parentId).toBe('b1');
  });
});
