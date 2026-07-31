import { describe, expect, it } from 'vitest';

import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import { deriveSubjectState } from './subject-state';

// The read-side classification every subject surface renders from. Pinned as
// a matrix against a folder-input desk contract (the levy-return-desk shape),
// a status-only contract, and a contract with no start gate at all — the
// derivation must stay a pure mirror of the choreography's own facts.

const deskContract: TaskSubjectContract = {
  workflow: 'levy-desk',
  externalSystem: 'northpack',
  input: { kind: 'folder', naming: String.raw`^\d{4}Q[1-4]$` },
  start: {
    when: 'hasFiles && status == backlog || hasFiles && status == todo || hasFiles && status == cancelled',
  },
  review: { requestChanges: true },
};

const statusOnlyContract: TaskSubjectContract = {
  workflow: 'issue-desk',
  start: { when: 'status == todo' },
};

const noStartContract: TaskSubjectContract = {
  workflow: 'sync-only',
};

describe('deriveSubjectState', () => {
  it('a live run wins over everything', () => {
    expect(
      deriveSubjectState(deskContract, {
        status: 'in_progress',
        runActive: true,
        hasFiles: true,
      }).kind,
    ).toBe('running');
    expect(
      deriveSubjectState(noStartContract, {
        status: 'backlog',
        runActive: true,
        hasFiles: false,
      }).kind,
    ).toBe('running');
  });

  it('in review classifies as review and carries the requestChanges flag', () => {
    const review = deriveSubjectState(deskContract, {
      status: 'in_review',
      runActive: false,
      hasFiles: true,
    });
    expect(review).toEqual({ kind: 'review', requestChanges: true });
    expect(
      deriveSubjectState(statusOnlyContract, {
        status: 'in_review',
        runActive: false,
        hasFiles: false,
      }),
    ).toEqual({ kind: 'review', requestChanges: false });
  });

  it('ready exactly when the start gate holds', () => {
    for (const status of ['backlog', 'todo', 'cancelled']) {
      expect(
        deriveSubjectState(deskContract, {
          status,
          runActive: false,
          hasFiles: true,
        }).kind,
      ).toBe('ready');
    }
    expect(
      deriveSubjectState(statusOnlyContract, {
        status: 'todo',
        runActive: false,
        hasFiles: false,
      }).kind,
    ).toBe('ready');
  });

  it('waiting_input when missing files are the only blocker', () => {
    expect(
      deriveSubjectState(deskContract, {
        status: 'backlog',
        runActive: false,
        hasFiles: false,
      }).kind,
    ).toBe('waiting_input');
    // Out of the start set entirely — files would not help; not a waiting state.
    expect(
      deriveSubjectState(deskContract, {
        status: 'done',
        runActive: false,
        hasFiles: false,
      }).kind,
    ).toBe('idle');
  });

  it('stalled for an in-progress task with no live run on a startable contract', () => {
    expect(
      deriveSubjectState(deskContract, {
        status: 'in_progress',
        runActive: false,
        hasFiles: true,
      }).kind,
    ).toBe('stalled');
    // No start gate ⇒ nothing to re-trigger; stays idle.
    expect(
      deriveSubjectState(noStartContract, {
        status: 'in_progress',
        runActive: false,
        hasFiles: false,
      }).kind,
    ).toBe('idle');
  });

  it('a contract without a start gate only ever reports running/review/idle', () => {
    expect(
      deriveSubjectState(noStartContract, {
        status: 'backlog',
        runActive: false,
        hasFiles: true,
      }).kind,
    ).toBe('idle');
  });
});
