import { z } from 'zod';

export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;

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
