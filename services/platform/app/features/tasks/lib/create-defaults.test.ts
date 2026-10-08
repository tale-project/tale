import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NEW_TASK_PRIORITY,
  defaultNewTaskStartDate,
} from './create-defaults';

// The reader's zone, pinned: a runner in UTC must not decide what "today"
// means for this test.
vi.mock('@/lib/shared/zoned-time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/zoned-time')>()),
  localTimeZone: () => 'Europe/Zurich',
}));

describe('new task defaults', () => {
  it('starts at Medium priority', () => {
    expect(DEFAULT_NEW_TASK_PRIORITY).toBe('p2');
  });

  it("starts today, at the reader's local midnight", () => {
    // 2026-10-08 23:30 in Zurich is still the 8th there.
    const lateEvening = Date.UTC(2026, 9, 8, 21, 30);
    const start = defaultNewTaskStartDate(lateEvening);
    expect(new Date(start).toISOString()).toBe('2026-10-07T22:00:00.000Z');
  });
});
