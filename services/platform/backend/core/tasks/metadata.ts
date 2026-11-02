import {
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_PRIORITIES,
} from '@tale/shared/task-limits';
import { z } from 'zod';

export { TASK_PRIORITIES } from '@tale/shared/task-limits';

const id = z.string().trim().min(1).max(200);
const priority = z.enum(TASK_PRIORITIES).nullable();

/** A field-value comparison, not a timestamp: omitted fields stay untouched,
 * and null explicitly clears a value. Every touched field names what the
 * caller read so a concurrent triage decision is never silently replaced. */
export const taskMetadataPatchSchema = z
  .object({
    taskId: id,
    priority: priority.optional(),
    agentId: id.nullable().optional(),
    expected: z
      .object({
        priority: priority.optional(),
        assignee: z
          .object({ type: z.enum(['user', 'agent', 'app']), id })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.priority === undefined && value.agentId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Name priority or agentId to change.',
      });
    }
    if (
      (value.priority !== undefined) !==
      (value.expected.priority !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'priority'],
        message: 'Name the expected priority exactly when changing priority.',
      });
    }
    if (
      (value.agentId !== undefined) !==
      (value.expected.assignee !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'assignee'],
        message: 'Name the expected assignee exactly when changing agentId.',
      });
    }
  });

const labelName = z.string().trim().min(1).max(TASK_LABEL_CHARS_MAX);

/** Labels to add to and remove from one task, each by name and without
 * regard to case, against the task's whole label list as the caller read it
 * (`expected.labels`): a label another writer added or removed since makes
 * the change stale, so it is never decided on an old view. A label the
 * request does not name stays as it is. */
export const taskLabelsPatchSchema = z
  .object({
    taskId: id,
    add: z.array(labelName).max(TASK_LABELS_MAX).optional(),
    remove: z.array(labelName).max(TASK_LABELS_MAX).optional(),
    expected: z
      .object({
        labels: z
          .array(z.string().trim().max(TASK_LABEL_CHARS_MAX))
          .max(TASK_LABELS_MAX),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const added = new Set((value.add ?? []).map((name) => name.toLowerCase()));
    const removed = (value.remove ?? []).map((name) => name.toLowerCase());
    if (added.size === 0 && removed.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Name a label to add or to remove.',
      });
    }
    if (removed.some((name) => added.has(name))) {
      ctx.addIssue({
        code: 'custom',
        path: ['remove'],
        message: 'A label is added or removed, never both.',
      });
    }
  });

export type TaskLabelsPatch = z.infer<typeof taskLabelsPatchSchema>;
