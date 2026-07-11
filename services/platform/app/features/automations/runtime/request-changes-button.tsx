'use client';

/**
 * Feedback-first "Request changes" for the task detail overlay — thin wrapper
 * around the shared BoundButton `feedback: { as: "taskComment" }` path so the
 * detail overlay and Collection rows stay one implementation.
 */
import type { Id } from '@/convex/_generated/dataModel';

import { BoundButton } from '../registry/connected/bound-button';

export function RequestChangesButton({
  taskId,
  organizationId,
  workflowSlug,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  workflowSlug: string;
}) {
  return (
    <BoundButton
      action={{
        labelKey: 'list.requestChanges',
        path: 'tasks/public_actions:startTaskWorkflow',
        mode: 'action',
        variant: 'secondary',
        feedback: { as: 'taskComment' },
        args: {
          organizationId,
          taskId,
          workflowSlug,
        },
      }}
      item={{ _id: taskId }}
    />
  );
}
