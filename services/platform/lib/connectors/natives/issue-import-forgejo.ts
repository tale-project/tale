/**
 * Forgejo issue intake: the open issues or pull requests of one repository
 * on the instance a connection names, read the way the GitHub and GlitchTip
 * readers read theirs (`issue-import.ts`) — bounded, resumable, and only ever
 * read. Forgejo (and Gitea, whose API it keeps) lists pull requests among a
 * repository's issues; the listing asks for one kind (`type`), the author
 * who opened them and labels, oldest first.
 *
 * Identity: an issue's id is unique on its instance and shared by issues and
 * pull requests, so a snapshot's id is `<origin>#<id>` (as GlitchTip's), its
 * repository is the repository's id, and its link is built from the
 * connection's own origin and the repository's current name — never an
 * address the instance answered, so a reverse proxy that names itself
 * differently cannot point a task elsewhere.
 */

import { createHash } from 'node:crypto';

import { taskExternalIssueSchema } from '@tale/shared/schemas/task-external-issue';
import { z } from 'zod';

import { truncateImportedDescription } from '../../../backend/core/tasks/helpers';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import {
  answerRefresh,
  cursor,
  discover,
  get,
  invalid,
  isPullRequestRow,
  itemTypeSchema,
  limit,
  nameList,
  openedBy,
  parse,
  position,
  requireSuccess,
  rows,
  sourceTime,
  storable,
  unavailable,
  type ImportedIssue,
} from './issue-import';

/** A Forgejo user, organization or repository name. */
const forgejoName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/)
  .max(100);

/** Items a Forgejo page holds: the instance's default ceiling
 * (`MAX_RESPONSE_ITEMS`), which a larger request is cut to anyway. */
const PAGE_SIZE = 50;

const listInput = z
  .object({
    owner: forgejoName,
    repo: forgejoName,
    type: itemTypeSchema.optional(),
    labels: z.string().max(1000).optional(),
    author: forgejoName.optional(),
    limit,
    cursor,
  })
  .strict();

const issueRef = z
  .object({
    externalId: z.string().min(1),
    externalIssue: taskExternalIssueSchema.nullable(),
  })
  .passthrough();

const getInput = z
  .object({
    issue: issueRef,
    repositoryId: z.number().int().positive().safe().optional(),
  })
  .strict();

const refreshInput = z
  .object({
    issues: z.array(issueRef).max(500),
    repositoryId: z.number().int().positive().safe().optional(),
    report: z.boolean().optional(),
  })
  .strict();

const repositorySchema = z
  .object({
    id: z.number().int().positive().safe(),
    full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  })
  .passthrough();

const forgejoIssueSchema = z
  .object({
    id: z.number().int().positive().safe(),
    number: z.number().int().positive().safe(),
    title: z.string().trim().min(1).max(10000),
    body: z.string().nullable().optional(),
    state: z.enum(['open', 'closed']),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();

function endpointOf(ctx: NativeConnectorContext): string {
  if (!ctx.endpoint)
    invalid('The Forgejo connection needs an instance endpoint.');
  return ctx.endpoint;
}

/** A repository's path as its API takes it. */
function repoPath(fullName: string): string {
  return fullName.split('/').map(encodeURIComponent).join('/');
}

/** One Forgejo issue or pull request as a task takes it. */
function forgejoIssue(
  raw: unknown,
  args: { endpoint: string; repositoryId: number; fullName: string },
): ImportedIssue {
  const row = parse(forgejoIssueSchema, raw);
  const title = storable(row.title).trim() || `#${row.number}`;
  const description = storable(row.body ?? '').slice(0, 100000);
  const kind = isPullRequestRow(raw) ? 'pulls' : 'issues';
  const url = `${args.endpoint}/${repoPath(args.fullName)}/${kind}/${row.number}`;
  const updatedAt = sourceTime(row.updated_at);
  return {
    externalSystem: 'forgejo',
    externalId: `${args.endpoint}/${args.fullName.toLowerCase()}#${row.number}`,
    externalUrl: url,
    title,
    description: truncateImportedDescription(description),
    externalIssue: {
      id: `${args.endpoint}#${row.id}`,
      title,
      description,
      url,
      state: row.state,
      repositoryId: args.repositoryId,
      number: row.number,
      syncedAt: 0,
      ...(updatedAt !== undefined && { updatedAt }),
    },
  };
}

/** Whether a row carries every label of `names`, compared without regard
 * to case. Forgejo lists the items carrying every label it is asked for,
 * as GitHub does, but drops a name the repository has no label of without
 * a word: a misspelt or renamed label would widen the listing to every
 * open item, so the reader checks each row itself. */
function carriesLabels(row: unknown, names: readonly string[]): boolean {
  if (names.length === 0) return true;
  const labels =
    typeof row === 'object' &&
    row !== null &&
    'labels' in row &&
    Array.isArray(row.labels)
      ? row.labels
      : [];
  const carried = new Set<string>();
  for (const label of labels) {
    if (
      typeof label === 'object' &&
      label !== null &&
      'name' in label &&
      typeof label.name === 'string'
    )
      carried.add(label.name.toLowerCase());
  }
  return names.every((name) => carried.has(name.toLowerCase()));
}

export function forgejoIssueNatives(): Readonly<
  Record<string, NativeConnectorImpl>
> {
  /** The repository an id names, read once per call that asks; null when
   * the instance no longer has it (or no longer shows it). */
  const repositoryById = (
    ctx: NativeConnectorContext,
    endpoint: string,
    action: string,
  ) => {
    const known = new Map<number, Promise<string | null>>();
    return (id: number): Promise<string | null> => {
      let found = known.get(id);
      if (found === undefined) {
        found = (async () => {
          const response = await get(
            ctx,
            'Forgejo',
            `${endpoint}/api/v1/repositories/${id}`,
          );
          if (response.status === 404 || response.status === 410) return null;
          const repository = parse(
            repositorySchema,
            requireSuccess(response, 'Forgejo', action),
          );
          if (repository.id !== id)
            invalid('Forgejo returned a different repository.');
          return repository.full_name;
        })();
        known.set(id, found);
      }
      return found;
    };
  };

  /** Read one linked issue again, through its repository's current name. */
  const refreshOne = async (
    ctx: NativeConnectorContext,
    endpoint: string,
    repositoryName: (id: number) => Promise<string | null>,
    input: z.infer<typeof getInput>,
  ): Promise<ImportedIssue> => {
    const syncedAt = Date.now();
    const source = input.issue.externalIssue;
    if (source === null)
      invalid(
        'This Forgejo task has no source snapshot to refresh. Sync it again from its repository.',
      );
    const repositoryId = source.repositoryId ?? input.repositoryId;
    const number = source.number;
    if (
      !source.id.startsWith(`${endpoint}#`) ||
      repositoryId === undefined ||
      number === undefined
    )
      invalid('This issue belongs to a different Forgejo connection.');
    const fullName = await repositoryName(repositoryId);
    if (fullName === null) return unavailable('forgejo', input.issue, syncedAt);
    const response = await get(
      ctx,
      'Forgejo',
      `${endpoint}/api/v1/repos/${repoPath(fullName)}/issues/${number}`,
    );
    if (response.status === 404 || response.status === 410)
      return unavailable('forgejo', input.issue, syncedAt);
    const result = forgejoIssue(
      requireSuccess(response, 'Forgejo', 'forgejo.get_import_issue'),
      { endpoint, repositoryId, fullName },
    );
    if (result.externalIssue.id !== source.id)
      invalid('Forgejo returned a different issue identity.');
    result.externalIssue.syncedAt = syncedAt;
    return result;
  };

  return {
    'forgejo.list_import_issues': async (raw, ctx) => {
      const input = parse(listInput, raw);
      const endpoint = endpointOf(ctx);
      const action = 'forgejo.list_import_issues';
      const repository = parse(
        repositorySchema,
        requireSuccess(
          await get(
            ctx,
            'Forgejo',
            `${endpoint}/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
          ),
          'Forgejo',
          action,
        ),
      );
      const type = input.type ?? 'issues';
      const labelNames = nameList(input.labels);
      const labels = labelNames.length === 0 ? undefined : labelNames.join(',');
      const author = input.author?.toLowerCase();
      const scope = createHash('sha256')
        .update(
          JSON.stringify([
            endpoint,
            repository.id,
            type,
            labels ?? '',
            author ?? '',
          ]),
        )
        .digest('hex');
      const start = position(input.cursor, scope);
      const syncedAt = Date.now();
      const base =
        `${endpoint}/api/v1/repos/${repoPath(repository.full_name)}/issues` +
        `?state=open&type=${type}&sort=oldest&limit=${PAGE_SIZE}` +
        (labels !== undefined ? `&labels=${encodeURIComponent(labels)}` : '') +
        (author !== undefined
          ? `&created_by=${encodeURIComponent(author)}`
          : '');
      const result = await discover({
        limit: input.limit,
        start,
        // The listing asked for one kind, one author and its labels; it
        // checks each again, as an instance that ignores a filter (a label
        // the repository lacks) would answer more.
        normalize: (item) => {
          if (
            isPullRequestRow(item) !== (type === 'pulls') ||
            !openedBy(item, author) ||
            !carriesLabels(item, labelNames)
          )
            return null;
          const issue = forgejoIssue(item, {
            endpoint,
            repositoryId: repository.id,
            fullName: repository.full_name,
          });
          issue.externalIssue.syncedAt = syncedAt;
          return issue;
        },
        fetch: async (at) => {
          const response = await get(ctx, 'Forgejo', `${base}&page=${at.page}`);
          const data = rows(response, 'Forgejo', action);
          const link = response.headers.link ?? response.headers.Link;
          const more = link
            ? /rel="next"/.test(link)
            : data.length >= PAGE_SIZE;
          return {
            rows: data,
            next: more ? { ...at, page: at.page + 1, offset: 0 } : null,
          };
        },
      });
      return {
        ...result,
        repositoryId: repository.id,
        sourceOrigin: endpoint,
      };
    },
    'forgejo.get_import_issue': async (raw, ctx) => {
      const input = parse(getInput, raw);
      const endpoint = endpointOf(ctx);
      return refreshOne(
        ctx,
        endpoint,
        repositoryById(ctx, endpoint, 'forgejo.get_import_issue'),
        input,
      );
    },
    'forgejo.refresh_import_issues': async (raw, ctx) => {
      const input = parse(refreshInput, raw);
      const endpoint = endpointOf(ctx);
      // One read of each repository per refresh, however many of its
      // issues are read again.
      const repositoryName = repositoryById(
        ctx,
        endpoint,
        'forgejo.refresh_import_issues',
      );
      return answerRefresh('forgejo', input.issues, input.report, (issue) =>
        refreshOne(ctx, endpoint, repositoryName, {
          issue: parse(issueRef, issue),
          ...(input.repositoryId !== undefined && {
            repositoryId: input.repositoryId,
          }),
        }),
      );
    },
  };
}
