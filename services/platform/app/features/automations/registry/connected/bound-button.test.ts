import { afterEach, describe, expect, it } from 'vitest';

import {
  clearSessionDoneLatches,
  deriveDoneState,
  isEffectAction,
  isSessionDoneLatched,
  markSessionDoneLatched,
  sessionLatchKey,
  type RowActionSpec,
} from './bound-button';

afterEach(() => {
  clearSessionDoneLatches();
});

describe('deriveDoneState', () => {
  it('is not done and does not latch for a plain action', () => {
    expect(deriveDoneState({}, { status: 'todo' }, false)).toEqual({
      done: false,
      latchesOnRun: false,
    });
  });

  it('latches on run only when the action declares a done label', () => {
    expect(
      deriveDoneState({ doneLabelKey: 'list.created' }, {}, false),
    ).toMatchObject({ latchesOnRun: true });
    expect(deriveDoneState({ doneLabel: 'Created' }, {}, false)).toMatchObject({
      latchesOnRun: true,
    });
    // An ordinary action (Start / Mark done) must never self-disable on click.
    expect(deriveDoneState({}, {}, true)).toMatchObject({
      latchesOnRun: false,
    });
  });

  it('is done once it has run this session (justRan)', () => {
    expect(deriveDoneState({ doneLabelKey: 'list.created' }, {}, true)).toEqual(
      {
        done: true,
        latchesOnRun: true,
      },
    );
  });

  it('is done when the row matches a persistent doneWhen predicate', () => {
    expect(
      deriveDoneState(
        { doneWhen: 'status == done' },
        { status: 'done' },
        false,
      ),
    ).toMatchObject({ done: true });
    expect(
      deriveDoneState(
        { doneWhen: 'status == done' },
        { status: 'todo' },
        false,
      ),
    ).toMatchObject({ done: false });
  });

  it('ignores doneWhen when there is no bound row', () => {
    expect(
      deriveDoneState({ doneWhen: 'status == done' }, undefined, false),
    ).toMatchObject({ done: false });
  });
});

describe('sessionLatchKey', () => {
  it('keys by path and stable row _id', () => {
    expect(
      sessionLatchKey('tasks/public_actions:createTaskFromExternalIssue', {
        _id: 'folder_1',
        name: '2025Q4',
      }),
    ).toBe('tasks/public_actions:createTaskFromExternalIssue::folder_1');
  });

  it('falls back to id when _id is absent', () => {
    expect(sessionLatchKey('path:a', { id: 7 })).toBe('path:a::7');
  });

  it('returns undefined without a stable row id', () => {
    expect(sessionLatchKey('path:a', { name: 'x' })).toBeUndefined();
    expect(sessionLatchKey('path:a', undefined)).toBeUndefined();
  });
});

describe('isSessionDoneLatched', () => {
  it('reflects entries recorded by markSessionDoneLatched', () => {
    const path = 'tasks/public_actions:createTaskFromExternalIssue';
    const row = { _id: 'folder_1', name: '2025Q4' };
    expect(isSessionDoneLatched(path, row)).toBe(false);
    expect(markSessionDoneLatched(path, row)).toBe(true);
    expect(isSessionDoneLatched(path, row)).toBe(true);
  });
});

describe('isEffectAction', () => {
  it('discriminates an effect-only action from a bound one by the absent path', () => {
    const effectAction: RowActionSpec = {
      labelKey: 'list.review',
      effect: { kind: 'openDetail', subjectType: 'task', id: '$selected._id' },
    };
    const boundAction: RowActionSpec = {
      labelKey: 'list.merge',
      path: 'tasks/public_actions:mergeTaskPullRequest',
      mode: 'action',
    };
    expect(isEffectAction(effectAction)).toBe(true);
    expect(isEffectAction(boundAction)).toBe(false);
  });
});
