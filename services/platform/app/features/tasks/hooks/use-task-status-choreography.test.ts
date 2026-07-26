// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import {
  decideTaskStatusTransition,
  plannedTransitionKind,
} from './use-task-status-choreography';

// The status-verb matrix: how a board move on an automation-owned task maps
// onto the owning workflow's choreography. Pure, so the whole decision table
// is pinned without any Convex plumbing.

const contract: TaskSubjectContract = {
  workflow: 'vat-desk',
  externalSystem: 'vatplus',
  input: { kind: 'folder' },
  start: {
    when: 'hasFiles && status == backlog || hasFiles && status == todo',
  },
  review: { requestChanges: true },
};

function decide(
  from: string,
  to: string,
  facts: {
    runActive?: boolean;
    hasFiles?: boolean;
    c?: TaskSubjectContract | null;
  } = {},
) {
  return decideTaskStatusTransition({
    contract: facts.c === undefined ? contract : facts.c,
    from,
    to,
    runActive: facts.runActive ?? false,
    hasFiles: facts.hasFiles ?? false,
  });
}

describe('decideTaskStatusTransition', () => {
  it('no contract or a no-op move stays a plain move', () => {
    expect(decide('todo', 'in_progress', { c: null })).toEqual({
      kind: 'move',
    });
    expect(decide('in_progress', 'in_progress', { runActive: true })).toEqual({
      kind: 'move',
    });
  });

  it('leaving a running in_progress cancels first — and only moves when the target is not cancelled', () => {
    expect(decide('in_progress', 'done', { runActive: true })).toEqual({
      kind: 'cancel',
      alsoMove: true,
    });
    expect(decide('in_progress', 'cancelled', { runActive: true })).toEqual({
      kind: 'cancel',
      alsoMove: false,
    });
    // No live run → nothing to cancel.
    expect(decide('in_progress', 'done')).toEqual({ kind: 'move' });
  });

  it('in_review → in_progress is request-changes when the contract opts in', () => {
    expect(decide('in_review', 'in_progress')).toEqual({
      kind: 'request_changes',
    });
    expect(
      decide('in_review', 'in_progress', {
        c: { workflow: 'vat-desk', review: { requestChanges: false } },
      }),
    ).toEqual({ kind: 'move' });
  });

  it('entering in_progress starts when the gate holds, blocks when only input is missing', () => {
    expect(decide('todo', 'in_progress', { hasFiles: true })).toEqual({
      kind: 'start',
    });
    expect(decide('todo', 'in_progress')).toEqual({
      kind: 'block',
      reason: 'missing_input',
    });
    // `done` is outside the start set entirely — reopening is a plain move.
    expect(decide('done', 'in_progress', { hasFiles: true })).toEqual({
      kind: 'move',
    });
  });

  it('a contract without start.when never starts from a status move', () => {
    expect(
      decide('todo', 'in_progress', {
        hasFiles: true,
        c: { workflow: 'vat-desk' },
      }),
    ).toEqual({ kind: 'move' });
  });
});

describe('plannedTransitionKind', () => {
  it('names the intent a picker option would carry, assuming input present', () => {
    expect(plannedTransitionKind(contract, 'todo', 'in_progress', false)).toBe(
      'start',
    );
    expect(
      plannedTransitionKind(contract, 'in_review', 'in_progress', false),
    ).toBe('request_changes');
    expect(plannedTransitionKind(contract, 'in_progress', 'done', true)).toBe(
      'cancel',
    );
    expect(plannedTransitionKind(contract, 'todo', 'done', false)).toBeNull();
  });
});
