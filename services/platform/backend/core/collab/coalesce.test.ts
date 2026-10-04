import { describe, expect, it } from 'vitest';

import { coalesceKeyFor } from './coalesce.ts';

const question = {
  type: 'agent_escalation',
  resourceType: 'dashboard',
  resourceId: 'project-1',
  params: { askId: 'ask-1', runId: 'run-1', projectId: 'project-1' },
} as const;

describe('agent-question notification identity', () => {
  it('keys a taskless question by its ask, not its dashboard destination', () => {
    expect(coalesceKeyFor(question)).toBe('ask:ask-1:question');
    expect(coalesceKeyFor({ ...question, resourceId: 'org-1' })).toBe(
      'ask:ask-1:question',
    );
  });

  it('keeps separate asks in the same run and project distinct', () => {
    expect(
      coalesceKeyFor({
        ...question,
        params: { ...question.params, askId: 'ask-2' },
      }),
    ).toBe('ask:ask-2:question');
  });

  it.each([undefined, null, '', 42])(
    'does not collapse a dashboard question with invalid askId %s',
    (askId) => {
      expect(
        coalesceKeyFor({ ...question, params: { ...question.params, askId } }),
      ).toBeNull();
    },
  );

  it('preserves the existing task-bound subject', () => {
    expect(
      coalesceKeyFor({
        ...question,
        resourceType: 'task',
        resourceId: 'task-1',
      }),
    ).toBe('task:task-1:question');
  });

  it('does not give other dashboard notifications an ask subject', () => {
    expect(
      coalesceKeyFor({ ...question, type: 'agent_run_failed' }),
    ).toBeNull();
    expect(coalesceKeyFor({ ...question, type: 'mention' })).toBeNull();
  });
});
