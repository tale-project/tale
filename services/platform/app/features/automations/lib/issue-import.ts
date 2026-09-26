import { z } from 'zod';

export type IssueSource = 'github' | 'glitchtip';

export function issueSource(slug: string | undefined): IssueSource | null {
  if (slug === 'github/import-issues' || slug === 'github-import-issues')
    return 'github';
  if (slug === 'glitchtip/import-issues' || slug === 'glitchtip-import-issues')
    return 'glitchtip';
  return null;
}

const fields = {
  github: {
    projectId: 'string',
    owner: 'string',
    repo: 'string',
    labels: 'string',
    limit: 'integer',
  },
  glitchtip: {
    projectId: 'string',
    organization: 'string',
    project: 'string',
    query: 'string',
    limit: 'integer',
  },
} as const;

/** A renamed or edited pack keeps the generic JSON editor whenever its
 * contract no longer fits the guided form. Never hide an author's inputs. */
export function guidedIssueSource(
  slug: string | undefined,
  schema: Record<string, unknown> | undefined,
): IssueSource | null {
  const source = issueSource(slug);
  if (source === null || schema?.type !== 'object') return null;
  const properties = z
    .record(z.string(), z.object({ type: z.string() }))
    .safeParse(schema.properties);
  if (!properties.success) return null;
  const expected: Record<string, string> = fields[source];
  if (
    !Object.entries(properties.data).every(
      ([key, value]) =>
        (key === 'cursor' ? 'string' : expected[key]) === value.type,
    )
  )
    return null;
  if (
    !Object.keys(expected).every(
      (key) => properties.data[key]?.type === expected[key],
    )
  )
    return null;
  if (
    Array.isArray(schema.required) &&
    schema.required.some(
      (key) =>
        typeof key !== 'string' || (!(key in expected) && key !== 'cursor'),
    )
  )
    return null;
  return source;
}

const count = z.number().int().nonnegative();
export const issueImportResultSchema = z.object({
  imported: count,
  created: count,
  updated: count,
  truncated: z.boolean(),
  skipped: count.optional(),
  refreshHasMore: z.boolean().optional(),
  nextCursor: z.string().max(12000).nullable().optional(),
  tasks: z
    .array(
      z.object({
        taskId: z.string().min(1),
        created: z.boolean(),
        title: z.string().optional(),
      }),
    )
    .max(1000),
});
