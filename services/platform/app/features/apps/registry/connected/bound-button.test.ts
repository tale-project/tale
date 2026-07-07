import { describe, expect, it } from 'vitest';

import {
  deriveDoneState,
  isEffectAction,
  type RowActionSpec,
} from './bound-button';

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
