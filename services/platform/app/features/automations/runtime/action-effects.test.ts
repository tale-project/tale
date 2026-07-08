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

  it('resolves openDetail id + title from $selected.* and a $tpl: template', () => {
    const effect: ActionEffect = {
      kind: 'openDetail',
      subjectType: 'task',
      id: '$selected._id',
      title: '$tpl:{title}',
    };
    const ctx = {
      ...baseCtx,
      selected: { _id: 't1', title: 'Fix bug' },
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

  it('renders a literal toast title verbatim', () => {
    const effect: ActionEffect = { kind: 'toast', titleKey: 'Reply sent' };
    expect(resolveEffect(effect, baseCtx)).toEqual({
      kind: 'toast',
      title: 'Reply sent',
    });
  });

  it('resolves a toast $tpl: template, interpolating the row', () => {
    const effect: ActionEffect = {
      kind: 'toast',
      titleKey: '$tpl:Archived "{subject}"',
    };
    expect(
      resolveEffect(effect, {
        ...baseCtx,
        selected: { subject: 'Invoice' },
      }),
    ).toEqual({ kind: 'toast', title: 'Archived "Invoice"' });
  });

  it('resolves a setState effect, reading the value from $result', () => {
    const effect: ActionEffect = {
      kind: 'setState',
      key: 'conversationId',
      value: '$result.conversationId',
    };
    expect(
      resolveEffect(effect, { ...baseCtx, result: { conversationId: 'c1' } }),
    ).toEqual({ kind: 'setState', key: 'conversationId', value: 'c1' });
  });

  it('setState passes literal values through, and undefined clears the key', () => {
    expect(
      resolveEffect({ kind: 'setState', key: 'lane', value: 'done' }, baseCtx),
    ).toEqual({ kind: 'setState', key: 'lane', value: 'done' });
    expect(
      resolveEffect(
        { kind: 'setState', key: 'conversationId', value: undefined },
        baseCtx,
      ),
    ).toEqual({ kind: 'setState', key: 'conversationId', value: undefined });
  });

  it('bails (null) when a setState value is an unresolved sentinel', () => {
    const effect: ActionEffect = {
      kind: 'setState',
      key: 'conversationId',
      value: '$result.conversationId',
    };
    // No record result in ctx: the sentinel string must not be written as state.
    expect(resolveEffect(effect, baseCtx)).toBeNull();
  });
});
