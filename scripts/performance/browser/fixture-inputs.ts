// Shared retained fixture/build boundary; the acceptance predicates are unchanged.
import { z } from 'zod';

export const seedIdsSchema = z.object({
  orgId: z.string(),
  ownerEmail: z.string(),
  userIds: z.array(z.string()).length(5),
  names: z.array(z.string()).length(5),
  projects: z.object({ small: z.string(), large: z.string() }),
});
const task = z.object({
  taskId: z.string(),
  title: z.string(),
  parent: z.string().optional(),
  assigneeName: z.string().nullable(),
});
const fixtureSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  count: z.number(),
  tasks: z.array(task),
});
export const fixturesSchema = z.object({
  small: fixtureSchema,
  large: fixtureSchema,
});
export const boardSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      parentTaskId: z.string().nullable(),
      assigneeId: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
});
const build = z.object({
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
export const buildsSchema = z.object({ baseline: build, candidate: build });
