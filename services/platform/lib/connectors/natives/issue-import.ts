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

import { truncateImportedDescription } from '../../../backend/core/tasks/helpers';
import type { FailureCause } from '../../engine/core/record/failure';
import type { ConnectorHttpResponse } from '../../engine/core/slots';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

/** One issue as a tracker answered it, in the shape a task takes it. */
export interface ImportedIssue {
  externalSystem: 'github' | 'glitchtip';
  externalId: string;
  externalUrl: string;
  title: string;
  description: string;
  externalIssue: TaskExternalIssue;
}

/** The longest a rate limit may ask the sync to wait. A reset further out
 * reads as a broken header, not as a day off. */
const MAX_RATE_LIMIT_WAIT_MS = 24 * 60 * 60 * 1000;

/** How long to wait on a rate limit that names no time: GitHub's advice for
 * a secondary limit without `retry-after`. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60 * 1000;

/**
 * A tracker answered with an error status. `status` lets a run record name
 * the cause (refused credentials, a missing repository); `retryAfter` is set
 * when the answer is a rate limit, to when the tracker asked to be called
 * again.
 */
export class IssueSourceHttpError extends ConnectorError {
  readonly status: number;
  /** Until when the tracker asked to be left alone (epoch ms) — a rate
   * limit's only. */
  readonly retryAfter: number | null;
  /** A rate limit is a wait, not a refusal: the run record says so even
   * when the tracker answered 403. */
  readonly failure?: FailureCause;

  constructor(
    message: string,
    args: { status: number; retryAfter: number | null; action: string },
  ) {
    super('REQUEST_FAILED', message, {});
    this.status = args.status;
    this.retryAfter = args.retryAfter;
    if (args.retryAfter !== null) {
      this.failure = {
        reason: 'CONNECTOR_RATE_LIMITED',
        params: {
          connector: args.action.slice(0, args.action.indexOf('.')),
          action: args.action,
          status: args.status,
        },
      };
    }
  }
}

/** The stored position belongs to another source or filter, or cannot be
 * read: only a fresh pass can go on. */
export class IssueCursorError extends ConnectorError {
  constructor(message: string) {
    super('INPUT_INVALID', message, {});
  }
}

/**
 * When a tracker that answered `response` asked to be called again, or null
 * when the answer is no rate limit. A 429 always is; GitHub also answers a
 * rate limit with 403, and says so through `retry-after`, an exhausted
 * `x-ratelimit-remaining`, or its message.
 */
export function rateLimitWait(
  response: ConnectorHttpResponse,
  now: number,
): number | null {
  const headers = response.headers;
  const retryAfter = headers['retry-after'];
  const remaining = headers['x-ratelimit-remaining'];
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (retryAfter !== undefined ||
        remaining === '0' ||
        /rate limit/i.test(safeText(response))));
  if (!limited) return null;
  let until: number | null = null;
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    until = Number.isFinite(seconds)
      ? now + seconds * 1000
      : Date.parse(retryAfter);
  } else if (remaining === '0') {
    const reset = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(reset)) until = reset * 1000;
  }
  if (until === null || !Number.isFinite(until)) {
    until = now + DEFAULT_RATE_LIMIT_WAIT_MS;
  }
  return Math.min(Math.max(until, now + 1000), now + MAX_RATE_LIMIT_WAIT_MS);
}

/** A response's text, or nothing when it has none to give. */
function safeText(response: ConnectorHttpResponse): string {
  try {
    return response.text();
  } catch (error) {
    console.warn('[issue-import] could not read an error response', error);
    return '';
  }
}
// A task's description is the task domain's own cut of the source text
// (`truncateImportedDescription`: the board's cap, on a grapheme boundary),
// so the run carries what the task will hold and every door can save it
// again. The source snapshot keeps its separate, larger limit.
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
function staleCursor(message: string): never {
  throw new IssueCursorError(message);
}
function position(raw: string | undefined, scope: string): Position {
  if (!raw) return { scope, page: 1, offset: 0, upstream: '' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    staleCursor('The issue cursor is invalid. Start a new import.');
  }
  const result = positionSchema.safeParse(data);
  if (!result.success || (result.data.offset > 0 && !result.data.anchor))
    staleCursor('The issue cursor is invalid. Start a new import.');
  if (result.data.scope !== scope)
    staleCursor(
      'The issue cursor belongs to another source or filter. Start a new import.',
    );
  return result.data;
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
  action: string,
): unknown {
  if (response.status < 200 || response.status >= 300) {
    const retryAfter = rateLimitWait(response, Date.now());
    throw new IssueSourceHttpError(
      retryAfter !== null
        ? `${provider} rate-limited the issue sync (HTTP ${response.status}) until ${new Date(retryAfter).toISOString()}.`
        : `${provider} issue sync failed (HTTP ${response.status}). Check the connection, source access, and rate limit${provider === 'GlitchTip' ? '; the token needs event:read and project:read' : ''}.`,
      { status: response.status, retryAfter, action },
    );
  }
  try {
    return response.json();
  } catch (error) {
    // The answer's own text stays out of the error: it would reach the
    // run's record, and a tracker's page can say anything.
    console.warn(
      `[issue-import] ${action}: ${provider} answered HTTP ${response.status} with a body that is not JSON`,
      error instanceof Error ? error.name : typeof error,
    );
    throw new ConnectorError(
      'INPUT_INVALID',
      `${provider} answered HTTP ${response.status} with a body that is not JSON.`,
      {},
    );
  }
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
    description: truncateImportedDescription(issue.description),
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
/** Text as Postgres can store it: a NUL character, which a tracker may
 * carry and no text or JSON column takes, is dropped. */
function storable(text: string): string {
  return text.replaceAll('\u0000', '');
}
function githubIssue(raw: unknown, repositoryId: number): ImportedIssue {
  const row = parse(githubIssueSchema, raw);
  const title = storable(row.title).trim() || `#${row.number}`;
  const url = new URL(row.html_url);
  const ref = /^\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)$/.exec(url.pathname);
  if (
    url.origin !== 'https://github.com' ||
    !ref ||
    Number(ref[3]) !== row.number
  )
    invalid('GitHub returned an invalid issue URL.');
  const description = storable(row.body ?? '').slice(0, 100000);
  return {
    externalSystem: 'github',
    externalId: `${ref[1]}/${ref[2]}#${row.number}`.toLowerCase(),
    externalUrl: row.html_url,
    title,
    description: truncateImportedDescription(description),
    externalIssue: {
      id: String(row.id),
      title,
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
  const title = storable(row.title).trim() || `Issue ${id}`;
  const description = [row.culprit, row.metadata?.value]
    .map((value) => storable(value ?? ''))
    .filter((value) => value.trim())
    .join('\n\n')
    .slice(0, 100000);
  const url = `${endpoint}/${encodeURIComponent(organization)}/issues/${id}`;
  return {
    externalSystem: 'glitchtip',
    externalId: `${endpoint}/${encodeURIComponent(organization)}/${encodeURIComponent(row.project.slug)}#${id}`,
    externalUrl: url,
    title,
    description: truncateImportedDescription(description),
    externalIssue: {
      id: `${endpoint}#${id}`,
      title,
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
function rows(
  response: ConnectorHttpResponse,
  provider: string,
  action: string,
): unknown[] {
  const value = requireSuccess(response, provider, action);
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
          'github.list_import_issues',
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
          const data = rows(response, 'GitHub', 'github.list_import_issues');
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
      const result = githubIssue(
        requireSuccess(response, 'GitHub', 'github.get_import_issue'),
        repoId,
      );
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
            'github.get_import_issue',
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
          'glitchtip.list_import_issues',
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
          const data = rows(
            response,
            'GlitchTip',
            'glitchtip.list_import_issues',
          );
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
        requireSuccess(response, 'GlitchTip', 'glitchtip.get_import_issue'),
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
            report: z.boolean().optional(),
          })
          .strict(),
        raw,
      );
      const refresh = natives[`${provider}.get_import_issue`];
      if (!refresh) throw new Error('Missing issue refresh backend');
      const outcome = await refreshEach(input.issues, (issue) =>
        refresh(
          {
            issue,
            ...(input.organization ? { organization: input.organization } : {}),
            ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
            ...(input.sourceProjectId
              ? { sourceProjectId: input.sourceProjectId }
              : {}),
          },
          ctx,
        ),
      );
      if (input.report === true) return outcome;
      const [first] = outcome.failed;
      if (first !== undefined) {
        console.warn(
          `[issue-import] ${provider}: ${outcome.failed.length} of ${input.issues.length} linked issues could not be refreshed and are tried again on a later run (first: ${first.error}${first.status !== undefined ? ` HTTP ${first.status}` : ''})`,
        );
      }
      return outcome.issues;
    };
  }
  return natives;
}

/** What went wrong reading a tracker, in the words a sync receipt uses. */
export type IssueSourceErrorCode =
  | 'credential'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'failed';

export interface IssueSourceFailure {
  error: IssueSourceErrorCode;
  /** The tracker's HTTP status, when it answered one. */
  status?: number;
  /** A rate limit's wait, until then (epoch ms). */
  retryAfter?: number;
  /** The failure's sentence — never the tracker's own body. */
  message: string;
}

/** The longest failure sentence a receipt keeps. */
const FAILURE_MESSAGE_MAX = 300;

/** What a receipt says of a failure whose own words could quote the
 * tracker's answer. */
const UNREADABLE_ANSWER =
  'The tracker’s answer could not be read; the next run tries again.';

/**
 * Why a read of a tracker failed, as a receipt says it: no usable
 * credential, refused access, a missing repository or project, a rate limit
 * with its wait, a tracker or network that did not answer, an answer that
 * made no sense, or anything else. A call cut because the server is
 * stopping is not the tracker's failure: it is thrown on, so the step stops
 * there and runs again.
 */
export function issueSourceFailure(error: unknown): IssueSourceFailure {
  if (error instanceof ConnectorError && error.code === 'INTERRUPTED') {
    throw error;
  }
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, FAILURE_MESSAGE_MAX);
  if (error instanceof IssueSourceHttpError) {
    const status = error.status;
    if (error.retryAfter !== null)
      return {
        error: 'rate_limited',
        status,
        retryAfter: error.retryAfter,
        message,
      };
    if (status === 401 || status === 403)
      return { error: 'unauthorized', status, message };
    if (status === 404 || status === 410)
      return { error: 'not_found', status, message };
    if (status >= 500) return { error: 'unavailable', status, message };
    return { error: 'failed', status, message };
  }
  if (error instanceof ConnectorError) {
    switch (error.code) {
      case 'CREDENTIAL_UNRESOLVED':
        return { error: 'credential', message };
      // The request never produced a response: the network, a timeout.
      case 'REQUEST_FAILED':
        return { error: 'unavailable', message };
      case 'INPUT_INVALID':
        return { error: 'invalid_response', message };
      // Whatever the reading threw, in its own words — which may quote what
      // the tracker answered, so the run's record gets a sentence of ours.
      case 'LIVE_BODY_FAILED':
        console.warn(
          '[issue-import] a tracker read failed in its body',
          error.connector ?? '',
          error.action ?? '',
        );
        return { error: 'failed', message: UNREADABLE_ANSWER };
      // The platform's own refusals: a host the connector may not reach, a
      // connector or action that is not there.
      default:
        return { error: 'failed', message };
    }
  }
  console.warn(
    '[issue-import] a tracker read failed',
    error instanceof Error ? error.name : typeof error,
  );
  return { error: 'failed', message: UNREADABLE_ANSWER };
}

/** What a refresh of linked issues answers when asked for its report. */
export interface IssueRefreshReport {
  /** The issues read, in the order asked. */
  issues: ImportedIssue[];
  /** The issues that could not be read; a later run tries them again. */
  failed: Array<{
    externalId: string;
    error: IssueSourceErrorCode;
    status?: number;
  }>;
  /** Issues not read at all: a rate limit stopped the batch before them. */
  notRead: number;
  /** The rate limit's wait, until then (epoch ms); null when none met. */
  retryAfter: number | null;
}

/**
 * Refresh each linked issue on its own, four at a time: one issue the
 * tracker refuses (403, 500, an answer that makes no sense) is reported and
 * skipped, never failing the others. A rate limit stops the batch: the
 * issues not started yet are not read, and the wait is reported.
 */
async function refreshEach(
  issues: ReadonlyArray<{ externalId: string }>,
  read: (issue: { externalId: string }) => Promise<unknown>,
): Promise<IssueRefreshReport> {
  const queue = new PQueue({ concurrency: 4 });
  let retryAfter: number | null = null;
  type Outcome =
    | { kind: 'read'; value: unknown }
    | { kind: 'failed'; externalId: string; failure: IssueSourceFailure }
    | { kind: 'not_read' };
  const outcomes = await Promise.all(
    issues.map((issue) =>
      queue.add(async (): Promise<Outcome> => {
        if (retryAfter !== null) return { kind: 'not_read' };
        try {
          return { kind: 'read', value: await read(issue) };
        } catch (error) {
          const failure = issueSourceFailure(error);
          if (failure.retryAfter !== undefined) {
            retryAfter = Math.max(retryAfter ?? 0, failure.retryAfter);
          }
          return { kind: 'failed', externalId: issue.externalId, failure };
        }
      }),
    ),
  );
  const report: IssueRefreshReport = {
    issues: [],
    failed: [],
    notRead: 0,
    retryAfter,
  };
  for (const outcome of outcomes) {
    if (outcome === undefined || outcome.kind === 'not_read') {
      report.notRead++;
    } else if (outcome.kind === 'failed') {
      report.failed.push({
        externalId: outcome.externalId,
        error: outcome.failure.error,
        ...(outcome.failure.status !== undefined && {
          status: outcome.failure.status,
        }),
      });
    } else if (outcome.value !== null) {
      // A legacy row the tracker no longer has, with no snapshot to keep:
      // nothing to refresh, and nothing failed.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the issue natives answer this shape
      report.issues.push(outcome.value as ImportedIssue);
    }
  }
  return report;
}
