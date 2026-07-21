import { describe, expect, it } from 'vitest';

import type { TaskSubjectContract } from '@/lib/shared/schemas/automations';

import {
  decideTaskStatusTransition,
  plannedTransitionKind,
} from './use-task-status-choreography';

const CONTRACT: TaskSubjectContract = {
  workflow: 'vat-return-desk',
  externalSystem: 'vatplus',
  input: { kind: 'folder' },
  start: {
    when: 'hasFiles && status == backlog || hasFiles && status == todo || hasFiles && status == cancelled',
  },
  review: { requestChanges: true },
};

function decide(over: {
  contract?: TaskSubjectContract | null;
  from: string;
  to: string;
  runActive?: boolean;
  hasFiles?: boolean;
}) {
  return decideTaskStatusTransition({
    contract: over.contract === undefined ? CONTRACT : over.contract,
    from: over.from,
    to: over.to,
    runActive: over.runActive ?? false,
    hasFiles: over.hasFiles ?? false,
  });
}

describe('decideTaskStatusTransition', () => {
  it('plain move for unowned tasks', () => {
    expect(decide({ contract: null, from: 'todo', to: 'in_progress' })).toEqual(
      { kind: 'move' },
    );
  });

  it('drag to In progress = start when the gate holds', () => {
    expect(decide({ from: 'todo', to: 'in_progress', hasFiles: true })).toEqual(
      { kind: 'start' },
    );
    expect(
      decide({ from: 'cancelled', to: 'in_progress', hasFiles: true }),
    ).toEqual({ kind: 'start' });
  });

  it('blocks with feedback when ONLY the input is missing', () => {
    expect(
      decide({ from: 'todo', to: 'in_progress', hasFiles: false }),
    ).toEqual({ kind: 'block', reason: 'missing_input' });
  });

  it('plain move when the gate fails on status (reopening done)', () => {
    expect(decide({ from: 'done', to: 'in_progress', hasFiles: true })).toEqual(
      { kind: 'move' },
    );
  });

  it('In review back to In progress = request changes', () => {
    expect(decide({ from: 'in_review', to: 'in_progress' })).toEqual({
      kind: 'request_changes',
    });
  });

  it('request changes falls back to a plain move without the review verb', () => {
    expect(
      decide({
        contract: { ...CONTRACT, review: undefined },
        from: 'in_review',
        to: 'in_progress',
      }),
    ).toEqual({ kind: 'move' });
  });

  it('dragging an actively running task out cancels first', () => {
    expect(
      decide({ from: 'in_progress', to: 'cancelled', runActive: true }),
    ).toEqual({ kind: 'cancel', alsoMove: false });
    expect(
      decide({ from: 'in_progress', to: 'todo', runActive: true }),
    ).toEqual({ kind: 'cancel', alsoMove: true });
  });

  it('leaving a settled In progress is a plain move', () => {
    expect(
      decide({ from: 'in_progress', to: 'in_review', runActive: false }),
    ).toEqual({ kind: 'move' });
  });

  it('non-in_progress targets on owned tasks stay plain moves', () => {
    expect(decide({ from: 'backlog', to: 'todo', hasFiles: true })).toEqual({
      kind: 'move',
    });
    expect(decide({ from: 'in_review', to: 'done' })).toEqual({
      kind: 'move',
    });
  });

  it('contracts without start gating never auto-start', () => {
    expect(
      decide({
        contract: { ...CONTRACT, start: undefined },
        from: 'todo',
        to: 'in_progress',
        hasFiles: true,
      }),
    ).toEqual({ kind: 'move' });
  });
});

describe('plannedTransitionKind (status-picker pre-flight hints)', () => {
  it('names the intent from the SAME matrix that executes it', () => {
    expect(plannedTransitionKind(CONTRACT, 'todo', 'in_progress', false)).toBe(
      'start',
    );
    expect(
      plannedTransitionKind(CONTRACT, 'in_review', 'in_progress', false),
    ).toBe('request_changes');
    expect(plannedTransitionKind(CONTRACT, 'in_progress', 'todo', true)).toBe(
      'cancel',
    );
  });

  it('plain moves carry no hint', () => {
    expect(
      plannedTransitionKind(CONTRACT, 'backlog', 'todo', false),
    ).toBeNull();
    expect(
      plannedTransitionKind(CONTRACT, 'done', 'in_progress', false),
    ).toBeNull();
    expect(
      plannedTransitionKind(CONTRACT, 'in_progress', 'todo', false),
    ).toBeNull();
  });
});
