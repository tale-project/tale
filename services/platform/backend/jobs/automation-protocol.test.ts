// @vitest-environment node
import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { ensureQueues } from './boss.ts';
import { physicalTaskQueue, TASK_QUEUE_OPTIONS } from './tasks.ts';

const EXECUTION_QUEUES = [
  ['automation.step', 'automation.v2.step'],
  ['automation.poll', 'automation.v2.poll'],
  ['automation.agent_turn', 'automation.v2.agent_turn'],
  ['automation.agent_drive', 'automation.v2.agent_drive'],
  ['automation.ask_resume', 'automation.v2.ask_resume'],
] as const;

describe('automation execution queue protocol', () => {
  it.each(EXECUTION_QUEUES)(
    'isolates %s from legacy subscribers without changing its policy',
    (logical, physical) => {
      expect(physicalTaskQueue(logical)).toBe(physical);
      expect(physicalTaskQueue(physical)).toBe(physical);
      expect(TASK_QUEUE_OPTIONS[logical]).toBeDefined();
      expect(TASK_QUEUE_OPTIONS).not.toHaveProperty(physical);
    },
  );

  it('leaves every other declared queue and unknown or older physical names unchanged', () => {
    const mapped = new Set<string>(
      EXECUTION_QUEUES.map(([logical]) => logical),
    );
    for (const name of [
      ...Object.keys(TASK_QUEUE_OPTIONS).filter((queue) => !mapped.has(queue)),
      'automation.v1.step',
      'automation.v3.step',
      'automation.step.extra',
      'automation',
      'itest.owned',
    ])
      expect(physicalTaskQueue(name)).toBe(name);
  });

  it('creates only physical queues, retaining all logical options, and verifies a concurrent creator at that same identity', async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockResolvedValue({ name: 'automation.v2.step' });
    createQueue.mockImplementation(async (name: string) => {
      if (name === 'automation.v2.step') throw new Error('concurrent creator');
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- queue API capture only
    const boss = { createQueue, getQueue } as unknown as PgBoss;
    await ensureQueues(boss);
    expect(createQueue).toHaveBeenCalledTimes(
      Object.keys(TASK_QUEUE_OPTIONS).length,
    );
    for (const [logical, options] of Object.entries(TASK_QUEUE_OPTIONS)) {
      expect(createQueue).toHaveBeenCalledWith(physicalTaskQueue(logical), {
        notify: true,
        ...options,
      });
    }
    expect(getQueue).toHaveBeenCalledExactlyOnceWith('automation.v2.step');
    for (const [logical] of EXECUTION_QUEUES) {
      expect(createQueue.mock.calls.some(([name]) => name === logical)).toBe(
        false,
      );
    }
  });

  it('surfaces a failed physical queue creation when no concurrent creator exists', async () => {
    const failure = new Error('create refused');
    const createQueue = vi.fn().mockRejectedValue(failure);
    const getQueue = vi.fn().mockResolvedValue(null);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- queue API capture only
    const boss = { createQueue, getQueue } as unknown as PgBoss;
    await expect(ensureQueues(boss)).rejects.toBe(failure);
  });
});
