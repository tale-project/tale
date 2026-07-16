import { describe, expect, it } from 'vitest';

import { shouldAckRunInProgress } from './run_status_ack';

describe('shouldAckRunInProgress', () => {
  const task = (
    over: Partial<
      Parameters<typeof shouldAckRunInProgress>[0]['task'] & object
    > = {},
  ) => ({
    assigneeType: 'agent',
    assigneeId: 'github/create-pull-requests/pr-creator',
    status: 'todo',
    ...over,
  });

  it('assignment runs always ack (task not consulted)', () => {
    expect(
      shouldAckRunInProgress({
        trigger: 'assignment',
        agentSlug: 'any',
        task: null,
      }),
    ).toBe(true);
  });

  // Regression: the durable path never acked at all, and mention runs by the
  // task's own assignee sat at To do through a 15-minute sandbox run.
  it("a mention run by the task's assignee on a To do task acks", () => {
    expect(
      shouldAckRunInProgress({
        trigger: 'mention',
        agentSlug: 'github/create-pull-requests/pr-creator',
        task: task(),
      }),
    ).toBe(true);
  });

  it('a mention of a NON-assignee agent stays pure conversation', () => {
    expect(
      shouldAckRunInProgress({
        trigger: 'mention',
        agentSlug: 'github/review-pull-requests/pr-reviewer',
        task: task(),
      }),
    ).toBe(false);
  });

  it('a mention on a task not at To do never flips the status', () => {
    for (const status of ['in_progress', 'in_review', 'done', 'cancelled']) {
      expect(
        shouldAckRunInProgress({
          trigger: 'mention',
          agentSlug: 'github/create-pull-requests/pr-creator',
          task: task({ status }),
        }),
      ).toBe(false);
    }
  });

  it('a human-assigned task never acks on an agent mention', () => {
    expect(
      shouldAckRunInProgress({
        trigger: 'mention',
        agentSlug: 'github/create-pull-requests/pr-creator',
        task: task({ assigneeType: 'user', assigneeId: 'user_1' }),
      }),
    ).toBe(false);
  });

  it('a deleted task (null) and pack-owned triggers never ack', () => {
    expect(
      shouldAckRunInProgress({
        trigger: 'mention',
        agentSlug: 'a',
        task: null,
      }),
    ).toBe(false);
    for (const trigger of [
      'revision',
      'sla_escalation',
      'unblock',
      'decomposition',
      'manual',
      undefined,
    ]) {
      expect(
        shouldAckRunInProgress({ trigger, agentSlug: 'a', task: task() }),
      ).toBe(false);
    }
  });
});
