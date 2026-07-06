import { describe, expect, it, vi } from 'vitest';

import { queueActionableEmail } from './notify_email';

describe('queueActionableEmail', () => {
  it('schedules delivery for actionable notification types', async () => {
    const runAfter = vi.fn(async () => undefined);
    const ctx = { scheduler: { runAfter } } as never;

    await queueActionableEmail(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'task_assigned',
      titleKey: 'taskAssigned',
      bodyKey: 'taskAssignedBody',
      params: { title: 'Ship it', projectId: 'proj_1' },
      resourceType: 'task',
      resourceId: 'task_1',
      taskId: 'task_1' as never,
    });

    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('does not schedule delivery for non-actionable types', async () => {
    const runAfter = vi.fn(async () => undefined);
    const ctx = { scheduler: { runAfter } } as never;

    await queueActionableEmail(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'task_status_changed',
      titleKey: 'taskStatusChanged',
      bodyKey: 'taskStatusChangedBody',
      resourceType: 'task',
      resourceId: 'task_1',
    });

    expect(runAfter).not.toHaveBeenCalled();
  });
});
