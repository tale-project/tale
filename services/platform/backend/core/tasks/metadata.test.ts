import { describe, expect, it } from 'vitest';

import { taskMetadataPatchSchema } from './metadata.ts';

describe('task metadata patch boundary', () => {
  it.each([
    { priority: null, expected: { priority: 'p1' } },
    { priority: 'p0', expected: { priority: null } },
    { agentId: null, expected: { assignee: { type: 'agent', id: 'old' } } },
    { agentId: 'next', expected: { assignee: null } },
    {
      priority: 'p1',
      agentId: 'next',
      expected: { priority: 'p3', assignee: { type: 'user', id: 'person' } },
    },
  ])('preserves explicit clears and expected field values (%j)', (patch) => {
    expect(taskMetadataPatchSchema.parse({ taskId: 'task', ...patch })).toEqual(
      { taskId: 'task', ...patch },
    );
  });

  it.each([
    {},
    { expected: {} },
    { priority: 'p1', expected: {} },
    { agentId: null, expected: {} },
    { priority: null, expected: { priority: null, assignee: null } },
    { agentId: 'next', expected: { priority: null, assignee: null } },
    { priority: 'high', expected: { priority: null } },
    { agentId: '', expected: { assignee: null } },
    { agentId: 'next', expected: { assignee: { type: 'user' } } },
    { agentId: 'next', expected: { assignee: { type: 'robot', id: 'old' } } },
    {
      agentId: 'next',
      expected: { assignee: { type: 'app', id: 'old', extra: true } },
    },
    { priority: 'p1', expected: { priority: null }, status: 'done' },
    { priority: 'p1', expected: { priority: null }, reviewerUserId: 'person' },
    { priority: 'p1', expected: { priority: null }, actorId: 'forged' },
  ])(
    'refuses omitted expectations and protected or malformed fields (%j)',
    (patch) => {
      expect(
        taskMetadataPatchSchema.safeParse({ taskId: 'task', ...patch }).success,
      ).toBe(false);
    },
  );
});
