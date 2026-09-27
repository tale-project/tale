import { z } from 'zod';

import { epochMsSchema } from './epoch-ms';

/** The last observed upstream issue, separate from a person's Tale edits.
 * `id` is vendor-stable (never a repository name, project slug, or title). */
export const taskExternalIssueSchema = z
  .object({
    id: z.string().trim().min(1).max(2000),
    title: z.string().min(1).max(10000),
    description: z.string().max(100000),
    url: z.url({ protocol: /^https?$/ }).max(4000),
    state: z.enum(['open', 'closed', 'resolved', 'ignored']),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    // A valid stored timestamp must remain renderable by every task card.
    syncedAt: epochMsSchema,
    unavailable: z.boolean().optional(),
    repositoryId: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    sourceProjectId: z.string().trim().min(1).max(2000).optional(),
    number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export type TaskExternalIssue = z.infer<typeof taskExternalIssueSchema>;
