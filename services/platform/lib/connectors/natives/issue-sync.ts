/**
 * The issue sync — one platform step that keeps a project's tasks in step
 * with a list of issue sources (GitHub repositories, GlitchTip projects, any
 * tracker a source adapter is written for). Per source, on every run:
 *
 *  1. read where the source's pass stands (the sync position store);
 *  2. read the next bounded batch of open issues from there;
 *  3. refresh the tasks already linked to the source, the longest-unchecked
 *     first, each issue on its own;
 *  4. write every issue into its task, each in its own transaction;
 *  5. save where the batch stopped, and answer a receipt.
 *
 * Each source is isolated: one whose tracker fails never stops the others,
 * one issue the tracker refuses never fails its source, and one task write
 * refused never rolls back the rest. A tracker that rate-limits the sync
 * stops that source for the run, keeps what was done, and its wait is
 * honoured by the runs after. A position whose cursor belongs to another
 * filter starts its pass over at once. The step fails only when every source
 * failed, so a schedule's failure streak and its notifications speak for a
 * sync that is broken, not for one tracker that is down.
 *
 * Pure orchestration: the trackers are read through the connector door, the
 * positions and the tasks through the task domain, all injected — the unit
 * tests drive it with fakes, the backend wires the real ones.
 */

import { createHash } from 'node:crypto';

import {
  taskExternalIssueSchema,
  type TaskExternalIssue,
} from '@tale/shared/schemas/task-external-issue';
import { z } from 'zod';

import type { FailureCause } from '../../engine/core/record/failure';
import { ConnectorError } from '../errors';
import {
  IssueCursorError,
  issueSourceFailure,
  type ImportedIssue,
  type IssueRefreshReport,
  type IssueSourceErrorCode,
} from './issue-import';

// ------------------------------------------------------------------ sources

/** What every source of the step may carry besides its tracker's own
 * fields: the stored connection its tracker is read with, by name. Empty
 * or left out, the organization's default one — so a template can ship an
 * empty answer for a person who has one connection. */
const credential = z.string().trim().max(200).optional();

const githubSourceSchema = z
  .object({
    kind: z.literal('github'),
    // The position's name is `owner/repo`, at most 200 characters.
    owner: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .max(99),
    repo: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+$/)
      .max(100),
    labels: z.string().max(1000).optional(),
    credential,
  })
  .strict();

const glitchtipSourceSchema = z
  .object({
    kind: z.literal('glitchtip'),
    organization: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(100),
    project: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(99),
    query: z.string().max(2000).optional(),
    credential,
  })
  .strict();

type GithubSource = z.infer<typeof githubSourceSchema>;
type GlitchtipSource = z.infer<typeof glitchtipSourceSchema>;
export type IssueSource = GithubSource | GlitchtipSource;

/** Where a source's linked tasks are, as the task domain looks them up. */
export interface LinkedIssueQuery {
  externalSystem: 'github' | 'glitchtip';
  repositoryId?: number;
  sourceOrigin?: string;
  sourceProjectId?: string;
  legacyPrefixes?: string[];
}

/** One batch as the sync reads a listing's answer. */
interface ListedBatch {
  issues: ImportedIssue[];
  /** Where the next batch starts; null once the listing is drained. */
  nextCursor: string | null;
  linked: LinkedIssueQuery;
  /** What the refresh action needs besides the issues. */
  refreshInput: Record<string, unknown>;
}

/**
 * What the sync needs to know about one kind of tracker. A new tracker is
 * one adapter here, beside its connector's `list_import_issues` and
 * `refresh_import_issues` actions.
 */
interface IssueSourceAdapter<S extends IssueSource> {
  readonly kind: S['kind'];
  /** The connector that reads the tracker; also the tracker's name on the
   * tasks and positions the sync writes. */
  readonly connector: 'github' | 'glitchtip';
  /** The source's name — `owner/repo`, `organization/project` — the name
   * the hand-built chains gave its position, so a pass they started carries
   * on. */
  name(source: S): string;
  /** The filter the listing is read under, written one way whatever way
   * the step wrote it; undefined when nothing narrows the listing. */
  filter(source: S): string | undefined;
  listInput(
    source: S,
    batch: { cursor: string; limit: number },
  ): Record<string, unknown>;
  listed(
    source: S,
    output: Listing,
  ): Omit<ListedBatch, 'issues' | 'nextCursor'>;
}

const importedIssueSchema = z
  .object({
    externalSystem: z.enum(['github', 'glitchtip']),
    externalId: z.string().min(1).max(2000),
    externalUrl: z.string().min(1).max(4000),
    title: z.string().min(1),
    description: z.string(),
    externalIssue: taskExternalIssueSchema,
  })
  .passthrough();

const listingSchema = z
  .object({
    issues: z.array(importedIssueSchema).max(500),
    nextCursor: z.string().min(1).max(12000).nullable(),
    repositoryId: z.number().int().positive().safe().optional(),
    sourceOrigin: z.string().min(1).optional(),
    sourceProjectId: z.string().min(1).optional(),
    legacyPrefixes: z.array(z.string().min(1).max(4000)).max(2).optional(),
  })
  .passthrough();

type Listing = z.infer<typeof listingSchema>;

/** A label filter as GitHub reads it: names separated by commas, each
 * trimmed, blanks and repeats dropped, in one order — GitHub wants every
 * label named, so `ui, bug` and `bug,ui,bug` are the one filter `bug,ui`. */
function githubLabels(labels: string | undefined): string | undefined {
  const names = [
    ...new Set(
      (labels ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    ),
  ].sort();
  return names.length === 0 ? undefined : names.join(',');
}

/** A GlitchTip search as the listing reads it: trimmed, and none when it
 * asks for what an empty search reads anyway. */
function glitchtipQuery(query: string | undefined): string | undefined {
  const search = (query ?? '').trim();
  return search === '' || search === 'is:unresolved' ? undefined : search;
}

function missingIdentity(field: string): never {
  throw new ConnectorError(
    'INPUT_INVALID',
    `The tracker's listing answered no ${field}, which the linked tasks are found by.`,
  );
}

const githubAdapter: IssueSourceAdapter<GithubSource> = {
  kind: 'github',
  connector: 'github',
  name: (source) => `${source.owner}/${source.repo}`,
  filter: (source) => githubLabels(source.labels),
  listInput: (source, batch) => {
    const labels = githubLabels(source.labels);
    return {
      owner: source.owner,
      repo: source.repo,
      ...(labels !== undefined && { labels }),
      limit: batch.limit,
      ...(batch.cursor !== '' && { cursor: batch.cursor }),
    };
  },
  listed: (_source, output) => {
    const repositoryId =
      output.repositoryId ?? missingIdentity('repository id');
    return {
      linked: {
        externalSystem: 'github',
        repositoryId,
        ...(output.legacyPrefixes !== undefined && {
          legacyPrefixes: output.legacyPrefixes,
        }),
      },
      refreshInput: { repositoryId },
    };
  },
};

const glitchtipAdapter: IssueSourceAdapter<GlitchtipSource> = {
  kind: 'glitchtip',
  connector: 'glitchtip',
  name: (source) => `${source.organization}/${source.project}`,
  filter: (source) => glitchtipQuery(source.query),
  listInput: (source, batch) => {
    const query = glitchtipQuery(source.query);
    return {
      organization: source.organization,
      project: source.project,
      ...(query !== undefined && { query }),
      limit: batch.limit,
      ...(batch.cursor !== '' && { cursor: batch.cursor }),
    };
  },
  listed: (source, output) => {
    const sourceOrigin = output.sourceOrigin ?? missingIdentity('instance');
    const sourceProjectId =
      output.sourceProjectId ?? missingIdentity('project id');
    return {
      linked: {
        externalSystem: 'glitchtip',
        sourceOrigin,
        sourceProjectId,
        ...(output.legacyPrefixes !== undefined && {
          legacyPrefixes: output.legacyPrefixes,
        }),
      },
      refreshInput: { sourceProjectId, organization: source.organization },
    };
  },
};

/** The adapter for a source's kind. */
function adapterFor(source: IssueSource): IssueSourceAdapter<IssueSource> {
  return source.kind === 'github' ? githubAdapter : glitchtipAdapter;
}

/** The longest name a position takes (the store's own limit). */
const POSITION_KEY_MAX = 200;

/**
 * The name a source's position is kept under: the source's own name, and
 * — when a filter narrows its listing — a digest of the filter. Two syncs
 * of one repository under two filters keep two passes instead of starting
 * each other's over, and a source without a filter keeps the plain name a
 * hand-built chain uses.
 */
function positionKey(source: IssueSource): string {
  const adapter = adapterFor(source);
  const name = adapter.name(source);
  const filter = adapter.filter(source);
  if (filter === undefined) return name;
  const digest = createHash('sha256').update(filter).digest('hex').slice(0, 12);
  return `${name}~${digest}`;
}

// -------------------------------------------------------------------- input

/** The most sources one step syncs. */
const ISSUE_SYNC_MAX_SOURCES = 20;

/** Issues read and refreshed per source and run, at most. */
const ISSUE_SYNC_MAX_BATCH = 500;

export const issueSyncInputSchema = z
  .object({
    projectId: z.string().trim().min(1),
    sources: z
      .array(
        z.discriminatedUnion('kind', [
          githubSourceSchema,
          glitchtipSourceSchema,
        ]),
      )
      .min(1)
      .max(ISSUE_SYNC_MAX_SOURCES),
    /** New open issues read per source and run. */
    limit: z.number().int().min(1).max(ISSUE_SYNC_MAX_BATCH).default(100),
    /** Linked tasks refreshed per source and run, the longest-unchecked
     * first; 0 refreshes none. */
    refreshLimit: z.number().int().min(0).max(ISSUE_SYNC_MAX_BATCH).default(50),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [at, source] of input.sources.entries()) {
      const key = positionKey(source);
      if (key.length > POSITION_KEY_MAX) {
        ctx.addIssue({
          code: 'custom',
          message: `names a source whose name and filter make a position name longer than ${POSITION_KEY_MAX} characters`,
          path: ['sources', at],
        });
      }
      const name = `${source.kind}:${key.toLowerCase()}`;
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: 'names a source the list already has, under the same filter',
          path: ['sources', at],
        });
      }
      seen.add(name);
    }
  });

export type IssueSyncInput = z.infer<typeof issueSyncInputSchema>;

// ------------------------------------------------------------------ receipts

/** Why a source's run did not go as planned. */
export type IssueSyncErrorCode = IssueSourceErrorCode;

/** What one source's run did — the step's record of it. */
export interface IssueSourceReceipt {
  kind: string;
  /** The source's name: `owner/repo`, `organization/project`. */
  source: string;
  /** The label filter or search the source is read under, written one
   * way; absent when nothing narrows it. */
  filter?: string;
  /** Its batch was read and saved, or another run had saved it first. */
  ok: boolean;
  error: IssueSyncErrorCode | null;
  /** The failure's sentence; absent when the run went as planned. */
  message?: string;
  /** The tracker's HTTP status, when the failure was its answer. */
  status?: number;
  /** The batch of the pass this run read, 1 for the first. */
  batch: number;
  /** A pass was under way and this batch continues it. */
  resumed: boolean;
  /** The stored position could not be read any more and the pass started
   * over. */
  restarted: boolean;
  /** The position moved on past this batch. */
  saved: boolean;
  /** Another run moved the position first; nothing was saved. */
  conflict: boolean;
  /** This batch reached the end of the listing; the next run starts the
   * next pass. */
  drained: boolean;
  /** Open issues the batch read. */
  discovered: number;
  created: number;
  /** Tasks whose issue changed upstream since they were last read. */
  refreshed: number;
  /** Tasks whose issue was read again and had not changed. */
  unchanged: number;
  /** Issues not read or not written this run; a later run tries them
   * again. */
  skipped: number;
  /** Issues closed, resolved or ignored upstream since they were last
   * read. */
  closedUpstream: number;
  /** Issues open again upstream since they were last read. */
  reopenedUpstream: number;
  /** Issues the tracker no longer has, or no longer shows this connection,
   * since they were last read. */
  unavailableUpstream: number;
  /** Until when the tracker asked to be left alone (epoch ms). */
  retryAfter: number | null;
  /** A few of the issues skipped, and why. */
  skippedIssues?: Array<{ externalId: string; reason: string }>;
}

/** What the step answers. */
export interface IssueSyncResult {
  /** One receipt per source, in the order listed. */
  sources: IssueSourceReceipt[];
  /** Sources whose batch failed. */
  failed: number;
  /** Sources a rate limit stopped or held back this run. */
  rateLimited: number;
  created: number;
  refreshed: number;
  unchanged: number;
  skipped: number;
  closedUpstream: number;
}

/** Skipped issues a receipt names, at most. */
const SKIPPED_ISSUES_LISTED = 10;

// --------------------------------------------------------------------- deps

/** A source position's name, within the step's project. */
export interface SyncPositionKey {
  externalSystem: string;
  source: string;
}

export interface SyncPositionRead {
  cursor: string;
  revision: string;
  batch: number;
  resumed: boolean;
  restarted: boolean;
  retryAfter: number | null;
}

export interface SyncPositionSave {
  saved: boolean;
  drained: boolean;
  batch: number;
  conflict: boolean;
  revision: string;
}

/** A task the source already has, as the refresh reads it. */
export interface LinkedIssue {
  taskId: string;
  externalId: string;
  externalIssue: TaskExternalIssue | null;
}

/** One issue written into its task — or why it was not. */
export type IssueWrite =
  | {
      ok: true;
      taskId: string | null;
      created: boolean;
      /** The source snapshot the task carried before. */
      previous: TaskExternalIssue | null;
    }
  | { ok: false; reason: string };

/** The run may not write in the step's project. */
export class IssueSyncProjectRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueSyncProjectRefusal';
  }
}

export interface IssueSyncDeps {
  /** Run one of a tracker connector's read actions as this step. */
  call(args: {
    connector: string;
    action: string;
    input: Record<string, unknown>;
    credential?: string;
  }): Promise<unknown>;
  positions: {
    read(key: SyncPositionKey): Promise<SyncPositionRead>;
    save(
      key: SyncPositionKey,
      args: { revision: string; next: string; retryAfter?: number },
    ): Promise<SyncPositionSave>;
    /** Count a batch the source refused. */
    fail(key: SyncPositionKey, args: { revision: string }): Promise<void>;
    /** Start the pass over from the revision read. */
    restart(
      key: SyncPositionKey,
      args: { revision: string },
    ): Promise<{ restarted: boolean; revision: string }>;
    /** Keep a rate limit's wait. */
    wait(key: SyncPositionKey, args: { retryAfter: number }): Promise<void>;
  };
  /** The tasks linked to a source, the longest-unchecked first; selecting
   * them moves them behind the rest. */
  linked(
    query: LinkedIssueQuery & { limit: number },
  ): Promise<{ issues: LinkedIssue[]; hasMore: boolean }>;
  /** Write one issue into its task, in a transaction of its own. */
  write(issue: ImportedIssue): Promise<IssueWrite>;
  now(): number;
  /** The step's stop: the server is shutting down. */
  signal?: AbortSignal;
}

// -------------------------------------------------------------- the sync

function interrupted(): ConnectorError {
  return new ConnectorError(
    'INTERRUPTED',
    'the issue sync was interrupted because its server is shutting down',
    { connector: 'task', action: 'sync_issues' },
  );
}

function throwIfStopped(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw interrupted();
}

/** How an issue's upstream state moved between two reads. */
function upstreamMove(
  previous: TaskExternalIssue | null,
  next: TaskExternalIssue,
): {
  changed: boolean;
  closed: boolean;
  reopened: boolean;
  unavailable: boolean;
} {
  if (previous === null) {
    return {
      changed: true,
      closed: false,
      reopened: false,
      unavailable: false,
    };
  }
  const wasOpen = previous.state === 'open';
  const isOpen = next.state === 'open';
  return {
    changed:
      previous.title !== next.title ||
      previous.description !== next.description ||
      previous.state !== next.state ||
      previous.url !== next.url ||
      (previous.unavailable ?? false) !== (next.unavailable ?? false) ||
      previous.repositoryId !== next.repositoryId ||
      previous.number !== next.number,
    closed: wasOpen && !isOpen,
    reopened: !wasOpen && isOpen,
    unavailable:
      !(previous.unavailable ?? false) && (next.unavailable ?? false),
  };
}

function emptyReceipt(kind: string, source: string): IssueSourceReceipt {
  return {
    kind,
    source,
    ok: false,
    error: null,
    batch: 1,
    resumed: false,
    restarted: false,
    saved: false,
    conflict: false,
    drained: false,
    discovered: 0,
    created: 0,
    refreshed: 0,
    unchanged: 0,
    skipped: 0,
    closedUpstream: 0,
    reopenedUpstream: 0,
    unavailableUpstream: 0,
    retryAfter: null,
  };
}

const refreshReportSchema = z
  .object({
    issues: z.array(importedIssueSchema),
    failed: z.array(
      z
        .object({
          externalId: z.string(),
          error: z.string(),
          status: z.number().optional(),
        })
        .passthrough(),
    ),
    notRead: z.number().int().nonnegative(),
    retryAfter: z.number().nullable(),
  })
  .passthrough();

function invalidAnswer(action: string, error: z.ZodError): ConnectorError {
  return new ConnectorError(
    'INPUT_INVALID',
    `${action} answered a shape the issue sync cannot read: ${error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'output'} ${issue.message}`)
      .join('; ')}`,
  );
}

/** One source's run. Throws only what must stop the whole step: the server
 * stopping, the project refusing the run, the database failing. */
async function syncSource(
  deps: IssueSyncDeps,
  source: IssueSource,
  limits: { limit: number; refreshLimit: number },
): Promise<IssueSourceReceipt> {
  const adapter = adapterFor(source);
  const key: SyncPositionKey = {
    externalSystem: adapter.connector,
    source: positionKey(source),
  };
  const filter = adapter.filter(source);
  const receipt: IssueSourceReceipt = {
    ...emptyReceipt(source.kind, adapter.name(source)),
    ...(filter !== undefined && { filter }),
  };
  const connection =
    source.credential === undefined || source.credential === ''
      ? undefined
      : source.credential;
  const fail = (failure: {
    error: IssueSyncErrorCode;
    message: string;
    status?: number;
  }): IssueSourceReceipt => ({
    ...receipt,
    ok: false,
    error: failure.error,
    message: failure.message,
    ...(failure.status !== undefined && { status: failure.status }),
  });

  let position = await deps.positions.read(key);
  Object.assign(receipt, {
    batch: position.batch,
    resumed: position.resumed,
    restarted: position.restarted,
  });
  // The tracker asked to be left alone until then: no call before it.
  if (position.retryAfter !== null && position.retryAfter > deps.now()) {
    return {
      ...fail({
        error: 'rate_limited',
        message: `The tracker asked to wait until ${new Date(position.retryAfter).toISOString()}; this source is read again after that.`,
      }),
      retryAfter: position.retryAfter,
    };
  }

  const list = async (cursor: string): Promise<ListedBatch> => {
    const output = await deps.call({
      connector: adapter.connector,
      action: 'list_import_issues',
      input: adapter.listInput(source, { cursor, limit: limits.limit }),
      ...(connection !== undefined && { credential: connection }),
    });
    const parsed = listingSchema.safeParse(output);
    if (!parsed.success) {
      throw invalidAnswer(
        `${adapter.connector}.list_import_issues`,
        parsed.error,
      );
    }
    return {
      issues: parsed.data.issues,
      nextCursor: parsed.data.nextCursor,
      ...adapter.listed(source, parsed.data),
    };
  };

  // 2. The next batch. A cursor that belongs to another filter starts the
  // pass over at once; a rate limit keeps the position and its wait; any
  // other failure counts against the position, which restarts after three.
  const attempt = async (
    cursor: string,
  ): Promise<
    | { batch: ListedBatch }
    | { stale: true }
    | { failure: ReturnType<typeof issueSourceFailure> }
  > => {
    try {
      return { batch: await list(cursor) };
    } catch (error) {
      if (error instanceof IssueCursorError && cursor !== '') {
        return { stale: true };
      }
      return { failure: issueSourceFailure(error) };
    }
  };
  let listed = await attempt(position.cursor);
  if ('stale' in listed) {
    const restarted = await deps.positions.restart(key, {
      revision: position.revision,
    });
    if (!restarted.restarted) {
      // Another run moved the position meanwhile; it carries the pass.
      return { ...receipt, ok: true, conflict: true };
    }
    position = {
      ...position,
      cursor: '',
      revision: restarted.revision,
      batch: 1,
      resumed: false,
      restarted: true,
    };
    Object.assign(receipt, { batch: 1, resumed: false, restarted: true });
    listed = await attempt('');
  }
  if ('failure' in listed) {
    const { failure } = listed;
    if (failure.retryAfter !== undefined) {
      await deps.positions.wait(key, { retryAfter: failure.retryAfter });
      return { ...fail(failure), retryAfter: failure.retryAfter };
    }
    await deps.positions.fail(key, { revision: position.revision });
    return fail(failure);
  }
  if (!('batch' in listed)) {
    throw new Error('a fresh pass has no cursor that could be stale');
  }
  const batch = listed.batch;
  receipt.discovered = batch.issues.length;
  throwIfStopped(deps.signal);

  // 3. The linked tasks, each issue read on its own.
  const skippedIssues: Array<{ externalId: string; reason: string }> = [];
  const skip = (externalId: string, reason: string) => {
    receipt.skipped++;
    if (skippedIssues.length < SKIPPED_ISSUES_LISTED) {
      skippedIssues.push({ externalId, reason });
    }
  };
  let retryAfter: number | null = null;
  const previousOf = new Map<string, TaskExternalIssue | null>();
  let refreshed: ImportedIssue[] = [];
  if (limits.refreshLimit > 0) {
    const linked = await deps.linked({
      ...batch.linked,
      limit: limits.refreshLimit,
    });
    if (linked.issues.length > 0) {
      let report: IssueRefreshReport | null = null;
      try {
        const output = await deps.call({
          connector: adapter.connector,
          action: 'refresh_import_issues',
          input: {
            issues: linked.issues.map((issue) => ({
              externalId: issue.externalId,
              externalIssue: issue.externalIssue,
            })),
            ...batch.refreshInput,
            report: true,
          },
          ...(connection !== undefined && {
            credential: connection,
          }),
        });
        const parsed = refreshReportSchema.safeParse(output);
        if (!parsed.success) {
          throw invalidAnswer(
            `${adapter.connector}.refresh_import_issues`,
            parsed.error,
          );
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parsed above; the natives answer this shape
        report = parsed.data as IssueRefreshReport;
      } catch (error) {
        // The refresh as a whole failed: every linked issue waits for a
        // later run, and the new batch is written all the same.
        const failure = issueSourceFailure(error);
        if (failure.retryAfter !== undefined) retryAfter = failure.retryAfter;
        for (const issue of linked.issues)
          skip(issue.externalId, failure.error);
      }
      if (report !== null) {
        for (const failed of report.failed) {
          skip(failed.externalId, failed.error);
        }
        receipt.skipped += report.notRead;
        if (report.retryAfter !== null) retryAfter = report.retryAfter;
        refreshed = report.issues;
        for (const issue of linked.issues) {
          if (issue.externalIssue !== null) {
            previousOf.set(issue.externalIssue.id, issue.externalIssue);
          }
        }
      }
    }
  }
  throwIfStopped(deps.signal);

  // 4. Every issue into its task, the refreshed ones first: a refresh reads
  // an issue after the listing did, so its snapshot is the newer one.
  const written = new Set<string>();
  const items = [...refreshed, ...batch.issues].filter((issue) => {
    const id = issue.externalIssue.id;
    if (written.has(id)) return false;
    written.add(id);
    return true;
  });
  for (const issue of items) {
    throwIfStopped(deps.signal);
    const result = await deps.write(issue);
    if (!result.ok) {
      skip(issue.externalId, result.reason);
      continue;
    }
    if (result.taskId === null) continue;
    if (result.created) {
      receipt.created++;
      continue;
    }
    const before =
      result.previous ?? previousOf.get(issue.externalIssue.id) ?? null;
    const move = upstreamMove(before, issue.externalIssue);
    if (move.changed) receipt.refreshed++;
    else receipt.unchanged++;
    if (move.closed) receipt.closedUpstream++;
    if (move.reopened) receipt.reopenedUpstream++;
    if (move.unavailable) receipt.unavailableUpstream++;
  }

  // 5. Where the batch stopped. A rate limit met while refreshing keeps its
  // wait on the position, whether this run saved it or another one did.
  const saved = await deps.positions.save(key, {
    revision: position.revision,
    next: batch.nextCursor ?? '',
    ...(retryAfter !== null && { retryAfter }),
  });
  if (saved.conflict && retryAfter !== null) {
    await deps.positions.wait(key, { retryAfter });
  }
  return {
    ...receipt,
    ok: true,
    saved: saved.saved,
    conflict: saved.conflict,
    drained: saved.drained,
    retryAfter,
    ...(skippedIssues.length > 0 && { skippedIssues }),
  };
}

/** The step's failure when every source failed: the cause they share, in
 * the words of the listing that failed, or a connector failure naming each
 * source. */
export function issueSyncFailure(receipts: IssueSourceReceipt[]): FailureCause {
  const [first] = receipts;
  const shared = receipts.every((receipt) => receipt.error === first?.error)
    ? first?.error
    : undefined;
  const kind = receipts.every((receipt) => receipt.kind === first?.kind)
    ? first?.kind
    : undefined;
  // One tracker: its listing failed. Several: the step itself.
  const connector = kind ?? 'task';
  const action =
    kind === undefined ? 'task.sync_issues' : `${kind}.list_import_issues`;
  const status = receipts.find(
    (receipt) => receipt.status !== undefined,
  )?.status;
  switch (shared) {
    case 'credential':
      return { reason: 'CONNECTOR_CREDENTIAL_MISSING', params: { connector } };
    case 'unauthorized':
      return {
        reason: 'CONNECTOR_AUTH',
        params: { connector, action, status: status ?? 403 },
      };
    case 'not_found':
      return {
        reason: 'CONNECTOR_NOT_FOUND',
        params: { connector, action, status: status ?? 404 },
      };
    case 'unavailable':
      return { reason: 'CONNECTOR_UNREACHABLE', params: { connector, action } };
    default:
      return {
        reason: 'CONNECTOR_FAILED',
        params: {
          connector,
          action,
          ...(shared !== undefined && status !== undefined && { status }),
          detail: receipts
            .map(
              (receipt) =>
                `${receipt.kind} ${receipt.source}: ${receipt.error ?? 'failed'}`,
            )
            .join('; '),
        },
      };
  }
}

/** Sync every source of the step, one after the other. */
export async function syncIssueSources(
  deps: IssueSyncDeps,
  input: IssueSyncInput,
): Promise<IssueSyncResult> {
  const receipts: IssueSourceReceipt[] = [];
  for (const source of input.sources) {
    throwIfStopped(deps.signal);
    receipts.push(
      await syncSource(deps, source, {
        limit: input.limit,
        refreshLimit: input.refreshLimit,
      }),
    );
  }
  const total = (field: keyof IssueSourceReceipt) =>
    receipts.reduce((sum, receipt) => {
      const value = receipt[field];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
  return {
    sources: receipts,
    failed: receipts.filter(
      (receipt) => !receipt.ok && receipt.error !== 'rate_limited',
    ).length,
    rateLimited: receipts.filter((receipt) => receipt.retryAfter !== null)
      .length,
    created: total('created'),
    refreshed: total('refreshed'),
    unchanged: total('unchanged'),
    skipped: total('skipped'),
    closedUpstream: total('closedUpstream'),
  };
}
