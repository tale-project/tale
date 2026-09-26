import { createHash } from 'node:crypto';

import {
  taskExternalIssueSchema,
  type TaskExternalIssue,
} from '@tale/shared/schemas/task-external-issue';
import PQueue from 'p-queue';
/** Read-only vendor issue synchronization. Both providers share bounded,
 * resumable discovery and return the same task-intake shape. Source snapshots
 * are separate from local task edits; missing upstream rows are marked
 * unavailable and never interpreted as a request to delete or complete work. */
import { z } from 'zod';

import type { ConnectorHttpResponse } from '../../engine/core/slots';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

interface ImportedIssue {
  externalSystem: 'github' | 'glitchtip';
  externalId: string;
  externalUrl: string;
  title: string;
  description: string;
  externalIssue: TaskExternalIssue;
}
// Local task descriptions must remain editable through the app's task API.
// Source snapshots retain their separate, larger description limit.
const taskDescriptionLimit = 50_000;
const limit = z.number().int().min(1).max(500).default(100);
const cursor = z.string().max(12000).optional();
const githubInput = z
  .object({
    owner: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .max(100),
    repo: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+$/)
      .max(100),
    labels: z.string().max(1000).optional(),
    limit,
    cursor,
  })
  .strict();
const glitchtipInput = z
  .object({
    organization: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(100),
    project: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(100),
    query: z.string().max(2000).optional(),
    limit,
    cursor,
  })
  .strict();
const sourceInput = z
  .object({
    issue: z
      .object({
        externalId: z.string().min(1),
        externalIssue: taskExternalIssueSchema.nullable(),
      })
      .passthrough(),
    repositoryId: z.number().int().positive().safe().optional(),
    sourceProjectId: z.string().min(1).max(2000).optional(),
    organization: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(100)
      .optional(),
  })
  .strict();
const positionSchema = z
  .object({
    scope: z.string(),
    page: z.number().int().min(1),
    offset: z.number().int().min(0).max(100),
    upstream: z
      .string()
      .max(4096)
      .regex(/^[A-Za-z0-9+/_=:.-]*$/)
      .default(''),
    anchor: z.string().min(1).max(2000).optional(),
  })
  .strict();
type Position = z.infer<typeof positionSchema>;

function invalid(message: string): never {
  throw new ConnectorError('INPUT_INVALID', message, {});
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    invalid(
      result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    );
  return result.data;
}
function position(raw: string | undefined, scope: string): Position {
  if (!raw) return { scope, page: 1, offset: 0, upstream: '' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    invalid('The issue cursor is invalid. Start a new import.');
  }
  const result = parse(positionSchema, data);
  if (result.offset > 0 && !result.anchor)
    invalid('The issue cursor is invalid. Start a new import.');
  if (result.scope !== scope)
    invalid(
      'The issue cursor belongs to another source or filter. Start a new import.',
    );
  return result;
}
const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Tale',
};
async function get(
  ctx: NativeConnectorContext,
  provider: string,
  url: string,
): Promise<ConnectorHttpResponse> {
  return ctx.http.get(url, {
    headers:
      provider === 'GitHub' ? githubHeaders : { Accept: 'application/json' },
  });
}
function requireSuccess(
  response: ConnectorHttpResponse,
  provider: string,
): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw new ConnectorError(
      'REQUEST_FAILED',
      `${provider} issue sync failed (HTTP ${response.status}). Check the connection, source access, and rate limit${provider === 'GlitchTip' ? '; the token needs event:read and project:read' : ''}.`,
      {},
    );
  }
  return response.json();
}
function unavailable(
  provider: ImportedIssue['externalSystem'],
  source: z.infer<typeof sourceInput>['issue'],
  syncedAt: number,
): ImportedIssue {
  if (!source.externalIssue)
    throw new Error('An unavailable source needs a previous snapshot.');
  const issue = { ...source.externalIssue, unavailable: true, syncedAt };
  return {
    externalSystem: provider,
    externalId: source.externalId,
    externalUrl: issue.url,
    title: issue.title,
    description: issue.description.slice(0, taskDescriptionLimit),
    externalIssue: issue,
  };
}
const githubIssueSchema = z
  .object({
    id: z.number().int().positive().safe(),
    number: z.number().int().positive().safe(),
    title: z.string().trim().min(1).max(10000),
    body: z.string().nullable().optional(),
    state: z.enum(['open', 'closed']),
    html_url: z.string().url(),
    updated_at: z.string().optional(),
  })
  .passthrough();
function githubIssue(raw: unknown, repositoryId: number): ImportedIssue {
  const row = parse(githubIssueSchema, raw);
  const url = new URL(row.html_url);
  const ref = /^\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)$/.exec(url.pathname);
  if (
    url.origin !== 'https://github.com' ||
    !ref ||
    Number(ref[3]) !== row.number
  )
    invalid('GitHub returned an invalid issue URL.');
  const description = (row.body ?? '').slice(0, 100000);
  return {
    externalSystem: 'github',
    externalId: `${ref[1]}/${ref[2]}#${row.number}`.toLowerCase(),
    externalUrl: row.html_url,
    title: row.title,
    description: description.slice(0, taskDescriptionLimit),
    externalIssue: {
      id: String(row.id),
      title: row.title,
      description,
      url: row.html_url,
      state: row.state,
      repositoryId,
      number: row.number,
      syncedAt: 0,
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    },
  };
}
const glitchtipIssueSchema = z
  .object({
    id: z.union([
      z.string().regex(/^[1-9][0-9]*$/),
      z.number().int().positive().safe(),
    ]),
    title: z.string().trim().min(1).max(10000),
    status: z.enum(['unresolved', 'resolved', 'ignored']),
    project: z.object({
      id: z.union([z.string().min(1), z.number().int().positive().safe()]),
      slug: z.string().regex(/^[A-Za-z0-9_-]+$/),
    }),
    culprit: z.string().nullable().optional(),
    metadata: z
      .object({ value: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    lastSeen: z.string().optional(),
  })
  .passthrough();
function glitchtipIssue(
  raw: unknown,
  endpoint: string,
  organization: string,
): ImportedIssue {
  const row = parse(glitchtipIssueSchema, raw);
  const id = String(row.id);
  const description = [row.culprit, row.metadata?.value]
    .filter((value) => value?.trim())
    .join('\n\n')
    .slice(0, 100000);
  const url = `${endpoint}/${encodeURIComponent(organization)}/issues/${id}`;
  return {
    externalSystem: 'glitchtip',
    externalId: `${endpoint}/${encodeURIComponent(organization)}/${encodeURIComponent(row.project.slug)}#${id}`,
    externalUrl: url,
    title: row.title,
    description: description.slice(0, taskDescriptionLimit),
    externalIssue: {
      id: `${endpoint}#${id}`,
      title: row.title,
      description,
      url,
      state: row.status === 'unresolved' ? 'open' : row.status,
      sourceProjectId: String(row.project.id),
      syncedAt: 0,
      ...(row.lastSeen ? { updatedAt: row.lastSeen } : {}),
    },
  };
}
interface Page {
  rows: unknown[];
  next: Position | null;
}
function rowIdentity(row: unknown): string {
  if (typeof row !== 'object' || row === null || !('id' in row))
    invalid('The source returned an issue without an identity.');
  return String(row.id);
}
async function discover(options: {
  limit: number;
  start: Position;
  fetch: (position: Position) => Promise<Page>;
  normalize: (raw: unknown) => ImportedIssue | null;
}): Promise<{
  issues: ImportedIssue[];
  truncated: boolean;
  nextCursor: string | null;
}> {
  const issues: ImportedIssue[] = [];
  const seen = new Set<string>();
  const positions = new Set<string>();
  let current = options.start;
  let continuation = current;
  let restarted = false;
  for (let count = 0; count < 20; count++) {
    const key = `${current.page}:${current.upstream}`;
    if (positions.has(key))
      invalid(
        'The source repeated an issue pagination cursor. Retry the import.',
      );
    positions.add(key);
    const page = await options.fetch(current);
    if (current.offset > 0) {
      const anchor = page.rows.findIndex(
        (row) => rowIdentity(row) === current.anchor,
      );
      if (anchor < 0) {
        // A numeric offset silently skips work when a source filter changes.
        // Restart discovery; task identity makes replay harmless, including
        // deletions across earlier pages.
        if (restarted)
          invalid(
            'The source changed repeatedly while resuming. Start a new import.',
          );
        restarted = true;
        positions.clear();
        current = { scope: current.scope, page: 1, offset: 0, upstream: '' };
        continue;
      }
      current = { ...current, offset: anchor + 1 };
    }
    for (let at = current.offset; at < page.rows.length; at++) {
      const issue = options.normalize(page.rows[at]);
      if (!issue || seen.has(issue.externalIssue.id)) continue;
      seen.add(issue.externalIssue.id);
      issues.push(issue);
      if (issues.length === options.limit) {
        const next =
          at + 1 < page.rows.length || page.next !== null
            ? { ...current, offset: at + 1, anchor: rowIdentity(page.rows[at]) }
            : null;
        return {
          issues,
          truncated: next !== null,
          nextCursor: next === null ? null : JSON.stringify(next),
        };
      }
    }
    if (page.next === null)
      return { issues, truncated: false, nextCursor: null };
    continuation =
      page.rows.length > 0
        ? {
            ...current,
            offset: page.rows.length,
            anchor: rowIdentity(page.rows.at(-1)),
          }
        : page.next;
    current = page.next;
  }
  return { issues, truncated: true, nextCursor: JSON.stringify(continuation) };
}
function rows(response: ConnectorHttpResponse, provider: string): unknown[] {
  const value = requireSuccess(response, provider);
  if (!Array.isArray(value))
    invalid(`${provider} returned an invalid issue list.`);
  return value;
}
function glitchtipEndpoint(ctx: NativeConnectorContext): string {
  if (!ctx.endpoint)
    invalid('The GlitchTip connection needs an instance endpoint.');
  return ctx.endpoint;
}

export function issueImportNatives(): Readonly<
  Record<string, NativeConnectorImpl>
> {
  const natives: Record<string, NativeConnectorImpl> = {
    'github.list_import_issues': async (raw, ctx) => {
      const input = parse(githubInput, raw);
      const repo = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
      const metadata = parse(
        z.object({
          id: z.number().int().positive().safe(),
          full_name: z.string().optional(),
        }),
        requireSuccess(
          await get(ctx, 'GitHub', `https://api.github.com/repos/${repo}`),
          'GitHub',
        ),
      );
      const start = position(
        input.cursor,
        `${metadata.id}:${input.labels ?? ''}`,
      );
      const syncedAt = Date.now();
      const result = await discover({
        limit: input.limit,
        start,
        normalize: (item) => {
          if (
            typeof item === 'object' &&
            item !== null &&
            'pull_request' in item
          )
            return null;
          const issue = githubIssue(item, metadata.id);
          issue.externalIssue.syncedAt = syncedAt;
          return issue;
        },
        fetch: async (at) => {
          const response = await get(
            ctx,
            'GitHub',
            `https://api.github.com/repositories/${metadata.id}/issues?state=open&sort=created&direction=asc&per_page=100&page=${at.page}${input.labels ? `&labels=${encodeURIComponent(input.labels)}` : ''}`,
          );
          const data = rows(response, 'GitHub');
          const link = response.headers.link ?? response.headers.Link;
          const more = link ? /rel="next"/.test(link) : data.length === 100;
          return {
            rows: data,
            next: more ? { ...at, page: at.page + 1, offset: 0 } : null,
          };
        },
      });
      return {
        ...result,
        repositoryId: metadata.id,
        legacyPrefixes: [
          ...new Set([
            `${input.owner}/${input.repo}#`.toLowerCase(),
            `${metadata.full_name ?? `${input.owner}/${input.repo}`}#`.toLowerCase(),
          ]),
        ],
      };
    },
    'github.get_import_issue': async (raw, ctx) => {
      const syncedAt = Date.now();
      const { issue, repositoryId } = parse(sourceInput, raw);
      const source = issue.externalIssue;
      const legacy = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(
        issue.externalId,
      );
      const repoId = source?.repositoryId ?? repositoryId;
      const number = source?.number ?? (legacy ? Number(legacy[3]) : undefined);
      if (!repoId || !number || !Number.isSafeInteger(number))
        invalid(
          'This GitHub source is missing its repository identity. Import it again from its repository.',
        );
      const response = await get(
        ctx,
        'GitHub',
        `https://api.github.com/repositories/${repoId}/issues/${number}`,
      );
      if (response.status === 404 || response.status === 410)
        return source ? unavailable('github', issue, syncedAt) : null;
      const result = githubIssue(requireSuccess(response, 'GitHub'), repoId);
      if (source && result.externalIssue.id !== source.id)
        invalid('GitHub returned a different issue identity.');
      if (
        result.externalId.split('#')[0]?.toLowerCase() !==
        issue.externalId.split('#')[0]?.toLowerCase()
      ) {
        // A transfer can change both repository and issue number. Resolve the
        // fresh canonical repository instead of pairing its number with the
        // old repository on the next sync.
        const canonical = new URL(result.externalUrl).pathname
          .split('/')
          .slice(1, 3)
          .map(encodeURIComponent)
          .join('/');
        const repository = parse(
          z.object({ id: z.number().int().positive().safe() }),
          requireSuccess(
            await get(
              ctx,
              'GitHub',
              `https://api.github.com/repos/${canonical}`,
            ),
            'GitHub',
          ),
        );
        result.externalIssue.repositoryId = repository.id;
      }
      result.externalIssue.syncedAt = syncedAt;
      // First adopt the legacy row through the locator it actually stores.
      // Its source URL is canonical immediately; future refreshes can rename
      // the locator through the immutable identity without creating a twin.
      if (!source) result.externalId = issue.externalId;
      return result;
    },
    'glitchtip.list_import_issues': async (raw, ctx) => {
      const input = parse(glitchtipInput, raw);
      const endpoint = glitchtipEndpoint(ctx);
      const metadata = parse(
        z.object({
          id: z.union([z.string().min(1), z.number().int().positive().safe()]),
        }),
        requireSuccess(
          await get(
            ctx,
            'GlitchTip',
            `${endpoint}/api/0/projects/${encodeURIComponent(input.organization)}/${encodeURIComponent(input.project)}/`,
          ),
          'GlitchTip',
        ),
      );
      const syncedAt = Date.now();
      const query = input.query?.trim() || 'is:unresolved';
      const base = `${endpoint}/api/0/projects/${encodeURIComponent(input.organization)}/${encodeURIComponent(input.project)}/issues/?limit=100&sort=first_seen&query=${encodeURIComponent(query)}`;
      const scope = createHash('sha256')
        .update(
          JSON.stringify([
            endpoint,
            String(metadata.id),
            input.organization,
            input.project,
            query,
          ]),
        )
        .digest('hex');
      const start = position(input.cursor, scope);
      const result = await discover({
        limit: input.limit,
        start,
        normalize: (item) => {
          const issue = glitchtipIssue(item, endpoint, input.organization);
          if (
            issue.externalIssue.sourceProjectId !== String(metadata.id) ||
            !issue.externalId.startsWith(
              `${endpoint}/${encodeURIComponent(input.organization)}/${encodeURIComponent(input.project)}#`,
            )
          )
            invalid('GlitchTip returned an issue from a different project.');
          issue.externalIssue.syncedAt = syncedAt;
          return issue;
        },
        fetch: async (at) => {
          const response = await get(
            ctx,
            'GlitchTip',
            base +
              (at.upstream ? `&cursor=${encodeURIComponent(at.upstream)}` : ''),
          );
          const data = rows(response, 'GlitchTip');
          const next = (response.headers.link ?? response.headers.Link ?? '')
            .split(',')
            .find((part) => /rel="next"/.test(part));
          const more = Boolean(next && /results="true"/.test(next));
          const upstream = next?.match(/cursor="([^"]+)"/)?.[1];
          if (upstream !== undefined)
            parse(positionSchema.shape.upstream, upstream);
          if (more && (!upstream || upstream === at.upstream))
            invalid(
              'GlitchTip returned an invalid or repeated pagination cursor.',
            );
          return {
            rows: data,
            next: more ? { ...at, upstream: upstream ?? '', offset: 0 } : null,
          };
        },
      });
      return {
        ...result,
        sourceOrigin: endpoint,
        sourceProjectId: String(metadata.id),
        legacyPrefixes: [
          `${endpoint}/${encodeURIComponent(input.organization)}/${encodeURIComponent(input.project)}#`,
        ],
      };
    },
    'glitchtip.get_import_issue': async (raw, ctx) => {
      const syncedAt = Date.now();
      const { issue, organization, sourceProjectId } = parse(sourceInput, raw);
      if (!organization) invalid('A GlitchTip organization is required.');
      const endpoint = glitchtipEndpoint(ctx);
      const source = issue.externalIssue;
      const id = source
        ? source.id.slice(endpoint.length + 1)
        : (issue.externalId.split('#').at(-1) ?? '');
      if (
        !(source
          ? source.id.startsWith(`${endpoint}#`)
          : issue.externalId.startsWith(
              `${endpoint}/${encodeURIComponent(organization)}/`,
            )) ||
        !/^[1-9][0-9]*$/.test(id)
      )
        invalid('This issue belongs to a different GlitchTip connection.');
      const response = await get(
        ctx,
        'GlitchTip',
        `${endpoint}/api/0/issues/${id}/`,
      );
      if (response.status === 404 || response.status === 410)
        return source ? unavailable('glitchtip', issue, syncedAt) : null;
      const result = glitchtipIssue(
        requireSuccess(response, 'GlitchTip'),
        endpoint,
        organization,
      );
      if (source && result.externalIssue.id !== source.id)
        invalid('GlitchTip returned a different issue identity.');
      if (!source && sourceProjectId !== result.externalIssue.sourceProjectId)
        invalid('GlitchTip returned an issue from a different project.');
      result.externalIssue.syncedAt = syncedAt;
      if (!source) result.externalId = issue.externalId;
      return result;
    },
  };
  for (const provider of ['github', 'glitchtip']) {
    natives[`${provider}.refresh_import_issues`] = async (raw, ctx) => {
      const input = parse(
        z
          .object({
            issues: z.array(sourceInput.shape.issue).max(500),
            organization: sourceInput.shape.organization,
            repositoryId: sourceInput.shape.repositoryId,
            sourceProjectId: sourceInput.shape.sourceProjectId,
          })
          .strict(),
        raw,
      );
      const queue = new PQueue({ concurrency: 4 });
      const refresh = natives[`${provider}.get_import_issue`];
      if (!refresh) throw new Error('Missing issue refresh backend');
      try {
        const refreshed = await Promise.all(
          input.issues.map((issue) =>
            queue.add(() =>
              refresh(
                {
                  issue,
                  ...(input.organization
                    ? { organization: input.organization }
                    : {}),
                  ...(input.repositoryId
                    ? { repositoryId: input.repositoryId }
                    : {}),
                  ...(input.sourceProjectId
                    ? { sourceProjectId: input.sourceProjectId }
                    : {}),
                },
                ctx,
              ),
            ),
          ),
        );
        return refreshed.filter((issue) => issue !== null);
      } catch (error) {
        queue.clear();
        throw error;
      }
    };
  }
  return natives;
}
