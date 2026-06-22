import { describe, expect, it } from 'vitest';

import { type ActionEffect, resolveEffect } from './action-effects';

const baseCtx = { organizationId: 'org_1' };

describe('resolveEffect', () => {
  it('returns null for an absent effect', () => {
    expect(resolveEffect(undefined, baseCtx)).toBeNull();
  });

  it('resolves openDetail id from $result.<field>', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: '$result.taskId',
    };
    expect(
      resolveEffect(effect, { ...baseCtx, result: { taskId: 't9' } }),
    ).toEqual({
      kind: 'openDetail',
      subjectType: 'task',
      id: 't9',
      title: undefined,
    });
  });

  it('bails (null) when $result is unresolvable — e.g. a non-record return', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: '$result.taskId',
    };
    // No result in ctx (mirrors a scalar/null action return): the sentinel must
    // NOT leak through as a literal id that opens a broken overlay.
    expect(resolveEffect(effect, baseCtx)).toBeNull();
  });

  it('resolves openDetail id + title from $selected.* and $label:', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: '$selected._id',
      title: '$label:app.detail',
    };
    const ctx = {
      ...baseCtx,
      selected: { _id: 't1', title: 'Fix bug' },
      labels: { 'app.detail': '{title}' },
    };
    expect(resolveEffect(effect, ctx)).toEqual({
      kind: 'openDetail',
      subjectType: 'task',
      id: 't1',
      title: 'Fix bug',
    });
  });

  it('bails when $selected.* has no row in context', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: '$selected._id',
    };
    expect(resolveEffect(effect, baseCtx)).toBeNull();
  });

  it('keeps a legitimately $-prefixed literal title (not a sentinel)', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: 't1',
      title: '$5 off',
    };
    expect(resolveEffect(effect, baseCtx)).toEqual({
      kind: 'openDetail',
      subjectType: 'task',
      id: 't1',
      title: '$5 off',
    });
  });

  it('resolves a navigate effect, substituting $result into params', () => {
    const effect: ActionEffect = {
      kind: 'navigate',
      to: '/dashboard/runs',
      params: { executionId: '$result.executionId' },
    };
    // `to` is the literal route; the resolved values ride in `params`.
    expect(
      resolveEffect(effect, { ...baseCtx, result: { executionId: 'ex1' } }),
    ).toEqual({
      kind: 'navigate',
      to: '/dashboard/runs',
      params: { executionId: 'ex1' },
    });
  });
});
