import { randomUUID } from 'node:crypto';

import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { EFFORT_LEVELS } from '../../lib/chat/effort.ts';
import { decodeChatError } from '../../lib/shared/chat-errors.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import { listComposerModels } from '../domains/chat/composer.ts';
import {
  createThread,
  MAX_THREAD_TITLE_CHARS,
  renameThread,
  setThreadArchived,
  stampCancelRequest,
  trashThread,
} from '../domains/chat/threads.ts';
import { resolveModelGovernanceForUser } from '../domains/governance/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import {
  chargeLane,
  domainErrorResponse,
  formatKeysetCursor,
  invalidBodyResponse,
  loadRestProject,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  parseBody,
  readIntegerCursor,
  readJsonBody,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * /api/v1 threads — the REST chat lane, direct turns only.
 *
 * A thread is USER-private: the API key resolves to one user, and these
 * endpoints see exactly that user's threads — another member's thread (and
 * every other organization's) reads as absent.
 * Unfiled threads live under `/threads`; a project-filed thread is only
 * reachable under `/projects/:id/threads`, with project access rechecked.
 *
 * `POST …/messages` answers 202: a direct turn streams for as long as the
 * model takes, which is not a request a client should hold open. The
 * accepted send re-gates and runs detached (`chat.api_turn`); the caller
 * polls `GET …/generation` until `idle` and reads the reply from
 * `GET …/messages`. The model is ALWAYS explicit on this surface — the
 * composer's Auto is a session-lane affordance with no wire form here.
 */

const MAX_TITLE = 200;
const MAX_MESSAGE = 100_000;
const MAX_MODEL_ID = 200;
/** A BCP 47 language tag as the reply-language directive reads it: a
 * language subtag and optional further subtags (`de`, `en-GB`, `zh-Hant`). */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** The token usage a finished turn recorded, whitelisted to the counters
 * the turn writes plus the catalog cost estimate it stamps beside them —
 * the stored JSON is the pipeline's own record (timings, provider facts),
 * and the wire carries only what a client can bill against. */
function restMessageUsage(stored: unknown): Record<string, number> | null {
  if (!isRecord(stored)) return null;
  const usage: Record<string, number> = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'reasoningTokens',
    'costEstimateCents',
  ]) {
    const value = stored[key];
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

/** What `GET /models` says about one model. */
interface RestModelView {
  id: string;
  label: string;
  providerSlug: string;
  providerLabel: string;
  contextWindow: number;
  maxOutputTokens?: number;
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean };
  pricing?: { inputCentsPerMillion: number; outputCentsPerMillion: number };
  tags: readonly string[];
  default?: true;
}

interface RestThreadRow {
  id: string;
  title: string | null;
  kind: string;
  harness: string | null;
  projectId: string | null;
  archived: boolean;
  /** When the thread was archived; null while active (and for a thread
   * archived before the moment was recorded). */
  archivedAt: number | null;
  isShared: boolean | null;
  /** A generation row exists — the turn is running (one join, never a
   * query per row); null only from a reader that skipped the join. */
  generating: boolean | null;
  /** The accepted send is waiting for a worker (`GET …/generation` answers
   * `queued`); the id it will stream into rides `streamId`. */
  queuedSince: number | null;
  streamId: string | null;
  createdAt: number;
  updatedAt: number;
}

const REST_THREAD_COLUMNS = `
  t.id, t.title, tm.chat_type AS "kind",
  tm.harness, tm.project_id AS "projectId", tm.archived,
  tm.archived_at_ms::float8 AS "archivedAt",
  tm.is_shared AS "isShared", (g.thread_id IS NOT NULL) AS generating,
  tm.generation_queued_since_ms::float8 AS "queuedSince",
  tm.stream_id AS "streamId",
  t.created_at_ms::float8 AS "createdAt",
  t.updated_at_ms::float8 AS "updatedAt"
`;

/** The thread tables every REST read joins: the metadata sidecar and the
 * at-most-one generation row whose existence is the `generating` flag. */
const REST_THREAD_JOINS = `
  JOIN app.thread_metadata tm ON tm.thread_id = t.id
  LEFT JOIN app.generations g ON g.thread_id = t.id
`;

/**
 * A failed turn's stored `error` is the app's envelope (`TALE_ERR1 <header>`
 * + the raw sentence) that the chat UI decodes. The wire carries the
 * sentence, and the stable classification code beside it, never the
 * URL-encoded header a client cannot read.
 */
function restMessageError(stored: string): {
  error: string;
  errorCode?: string;
} {
  const info = decodeChatError(stored);
  return {
    error: info.raw ?? 'The turn failed.',
    ...(info.code !== undefined ? { errorCode: info.code } : {}),
  };
}

export function createThreadRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  /** The models this door advertises: the composer's servable set narrowed
   * to direct credentials — a subscription model only runs in a sandbox. A
   * send is checked against the SAME projection, so the caller is held to
   * exactly what `GET /models` told them. */
  const restModels = async (c: Context<RestEnv>) => {
    const { models } = await listComposerModels(deps.sql, {
      organizationId: c.get('organizationId'),
      userId: c.get('userId'),
    });
    return models.filter(
      ({ credential }) =>
        credential.authMethod === 'api-key' || credential.authMethod === 'env',
    );
  };

  /** The listing carries what a client needs to CHOOSE — context window,
   * output cap, capabilities, price, tags — and marks the organization's
   * default pick for this key holder, so no caller has to keep a hand-made
   * table of model facts beside the id list. */
  app.get('/models', noQuery, async (c) => {
    try {
      const models = await restModels(c);
      const governance = await resolveModelGovernanceForUser(deps.sql, {
        organizationId: c.get('organizationId'),
        userId: c.get('userId'),
        supportedModels: [...new Set(models.map((model) => model.id))],
      });
      const preferred = governance.defaultModel;
      return c.json({
        models: models.map((model) => {
          const view: RestModelView = {
            id: model.id,
            label: model.label,
            providerSlug: model.providerSlug,
            providerLabel: model.providerLabel,
            contextWindow: model.contextWindow,
            capabilities: {
              tools: model.tools,
              vision: model.vision === true,
              reasoning: model.reasoning !== undefined,
            },
            tags: model.tags,
          };
          if (model.maxOutputTokens !== undefined) {
            view.maxOutputTokens = model.maxOutputTokens;
          }
          if (model.pricing !== undefined) view.pricing = model.pricing;
          if (
            preferred !== undefined &&
            preferred.providerName === model.providerSlug &&
            preferred.modelId === model.id
          ) {
            view.default = true;
          }
          return view;
        }),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** An explicit `providerSlug` is a choice, not a hint: the turn's own
   * resolution treats an unmatched provider as a preference and falls back
   * to whichever connector serves the model id — right for the composer,
   * which only offers real pairs, wrong for a machine caller that sent a
   * typo and got a reply from a provider it never named. Null when the pair
   * is one `GET /models` lists; otherwise the 400 naming what is wrong. */
  const refuseUnlistedProvider = (
    c: Context<RestEnv>,
    models: Awaited<ReturnType<typeof restModels>>,
    modelId: string,
    providerSlug: string,
  ): Response | null => {
    if (!models.some((model) => model.providerSlug === providerSlug)) {
      return c.json(
        {
          error: `Unknown provider "${providerSlug}". GET /api/v1/models lists the providers this key can send to.`,
          code: 'CHAT_PROVIDER_UNKNOWN',
        },
        400,
      );
    }
    if (
      !models.some(
        (model) => model.providerSlug === providerSlug && model.id === modelId,
      )
    ) {
      return c.json(
        {
          error: `Provider "${providerSlug}" does not serve model "${modelId}". GET /api/v1/models lists each model with its provider.`,
          code: 'CHAT_MODEL_NOT_ON_PROVIDER',
        },
        400,
      );
    }
    return null;
  };

  /** The provider for a model named WITHOUT one — resolved here, at the
   * door, against the same listing: a model the list does not carry is a
   * 400 now, not a 202 whose turn fails minutes later through the message
   * channel; a model two providers serve needs the caller to pick one. */
  const resolveModelProvider = (
    c: Context<RestEnv>,
    models: Awaited<ReturnType<typeof restModels>>,
    modelId: string,
  ): string | Response => {
    const providers = [
      ...new Set(
        models
          .filter((model) => model.id === modelId)
          .map((model) => model.providerSlug),
      ),
    ];
    const [only] = providers;
    if (only === undefined) {
      return c.json(
        {
          error: `Unknown model "${modelId}". GET /api/v1/models lists the models this key can send to.`,
          code: 'CHAT_MODEL_UNKNOWN',
        },
        400,
      );
    }
    if (providers.length > 1) {
      return c.json(
        {
          error: `Model "${modelId}" is served by more than one provider (${providers.join(', ')}); name one as providerSlug.`,
          code: 'CHAT_MODEL_AMBIGUOUS',
          data: { providers },
        },
        400,
      );
    }
    return only;
  };

  const threadView = (row: RestThreadRow) => ({
    id: row.id,
    ...(row.title !== null ? { title: row.title } : {}),
    kind: row.kind,
    ...(row.harness !== null ? { harness: row.harness } : {}),
    ...(row.projectId !== null ? { projectId: row.projectId } : {}),
    archived: row.archived,
    ...(row.archivedAt !== null && row.archivedAt !== undefined
      ? { archivedAt: row.archivedAt }
      : {}),
    ...(row.isShared !== null ? { isShared: row.isShared } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generating: row.generating === true,
  });

  const isGenerating = async (threadId: string): Promise<boolean> => {
    const rows = await deps.sql<{ threadId: string }[]>`
      SELECT thread_id AS "threadId" FROM app.generations
      WHERE thread_id = ${threadId} LIMIT 1
    `;
    return rows.length > 0;
  };

  /** The caller's thread by id as the REST projection, or null. */
  const loadRestThread = async (
    c: Context<RestEnv>,
    threadId: string,
    projectId: string | null,
  ): Promise<RestThreadRow | null> => {
    const rows = await deps.sql<RestThreadRow[]>`
      SELECT ${deps.sql.unsafe(REST_THREAD_COLUMNS)}
      FROM app.threads t
      ${deps.sql.unsafe(REST_THREAD_JOINS)}
      WHERE t.id = ${threadId} AND t.org_id = ${c.get('organizationId')}
        AND t.user_id = ${c.get('userId')} AND tm.status = 'active'
        AND tm.project_id IS NOT DISTINCT FROM ${projectId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  };

  // Both resources share the same chat behavior; the path fixes the scope
  // before listing, loading a transcript, or accepting a detached send.
  for (const scope of [
    { collection: '/threads', item: '/threads/:id', projectScoped: false },
    {
      collection: '/projects/:id/threads',
      item: '/projects/:id/threads/:threadId',
      projectScoped: true,
    },
  ]) {
    const projectIdFor = (c: Context<RestEnv>): string | null =>
      scope.projectScoped ? (c.req.param('id') ?? '') : null;
    const threadIdFor = (c: Context<RestEnv>): string =>
      c.req.param(scope.projectScoped ? 'threadId' : 'id') ?? '';

    if (scope.projectScoped) {
      const projectAccess = async (
        c: Context<RestEnv>,
        next: () => Promise<void>,
      ): Promise<Response | void> => {
        try {
          const auth = await restProjectAuth(deps.sql, c);
          // Chat belongs to its user: readable-project members may create
          // and send, without an editor seat. Archived projects only read.
          await loadRestProject(deps.sql, auth, c.req.param('id') ?? '', {
            active: c.req.method !== 'GET',
          });
        } catch (error) {
          return domainErrorResponse(c, error);
        }
        return next();
      };
      app.use(scope.collection, projectAccess);
      app.use(`${scope.collection}/*`, projectAccess);
    }

    /** The key holder's own threads, newest activity first, keyset-paginated
     * (`cursor` = the previous page's `<updatedAt>:<id>`). */
    app.get(scope.collection, async (c) => {
      const query = readQuery(c, PAGE_QUERY);
      if (query instanceof Response) return query;
      const projectId = projectIdFor(c);
      const threadList = `threads:${projectId ?? 'org'}`;
      const limit = readPageLimit(c, { fallback: 25, max: 100 });
      if (limit instanceof Response) return limit;
      const cursor = readKeysetCursor(c, threadList);
      if (cursor instanceof Response) return cursor;
      const cursorUpdatedAt = cursor?.at ?? null;
      const cursorId = cursor?.id ?? null;
      const rows = await deps.sql<RestThreadRow[]>`
      SELECT ${deps.sql.unsafe(REST_THREAD_COLUMNS)}
      FROM app.threads t
      ${deps.sql.unsafe(REST_THREAD_JOINS)}
      WHERE t.org_id = ${c.get('organizationId')}
        AND t.user_id = ${c.get('userId')}
        AND tm.status = 'active' AND tm.hidden IS NOT true
        AND tm.project_id IS NOT DISTINCT FROM ${projectId}
        AND (${cursorUpdatedAt}::bigint IS NULL
          OR t.updated_at_ms < ${cursorUpdatedAt}
          OR (t.updated_at_ms = ${cursorUpdatedAt} AND t.id < ${cursorId}))
      ORDER BY t.updated_at_ms DESC, t.id DESC
      LIMIT ${limit + 1}
    `;
      const page = rows.slice(0, limit);
      const isDone = rows.length <= limit;
      const last = page[page.length - 1];
      return c.json({
        page: page.map(threadView),
        isDone,
        continueCursor:
          isDone || !last
            ? ''
            : mintCursor(
                c,
                threadList,
                formatKeysetCursor(last.updatedAt, last.id),
              ),
      });
    });

    /** Start a thread. REST creates DIRECT threads: a sandbox thread needs a
     * harness and a session this surface cannot drive. */
    app.post(scope.collection, async (c) => {
      const body = await parseBody(
        c,
        z
          .object({
            title: z.string().min(1).max(MAX_TITLE).optional(),
          })
          .strict(),
        { optional: true },
      );
      if (body instanceof Response) return body;
      try {
        const projectId = projectIdFor(c);
        const threadId = await createThread(deps.sql, {
          organizationId: c.get('organizationId'),
          userId: c.get('userId'),
          kind: 'direct',
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(projectId !== null
            ? { projectId, requireActiveProject: true }
            : {}),
        });
        return c.json({ id: threadId }, 201);
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    });

    app.get(scope.item, noQuery, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      return c.json(threadView(thread));
    });

    const restAuth = (c: Context<RestEnv>) => ({
      organizationId: c.get('organizationId'),
      userId: c.get('userId'),
      email: c.get('userEmail'),
    });

    /** Archive, restore or rename the thread — the app's own toggle and
     * rename, audited the same way. An archived thread stays readable and
     * refuses sends. */
    app.patch(scope.item, async (c) => {
      const body = await parseBody(
        c,
        z
          .object({
            archived: z.boolean().optional(),
            title: z
              .string()
              .trim()
              .min(1)
              .max(MAX_THREAD_TITLE_CHARS)
              .optional(),
          })
          .strict()
          .refine(
            (patch) =>
              patch.archived !== undefined || patch.title !== undefined,
            { message: 'send archived, title, or both' },
          ),
      );
      if (body instanceof Response) return body;
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      try {
        if (body.title !== undefined) {
          await renameThread(
            deps.sql,
            c.get('organizationId'),
            c.get('userId'),
            thread.id,
            body.title,
          );
        }
        if (body.archived !== undefined) {
          await setThreadArchived(
            deps.sql,
            restAuth(c),
            thread.id,
            body.archived,
          );
        }
      } catch (error) {
        return domainErrorResponse(c, error);
      }
      const archived = body.archived ?? thread.archived;
      return c.json(
        threadView({
          ...thread,
          ...(body.title !== undefined ? { title: body.title } : {}),
          archived,
          archivedAt:
            body.archived === undefined
              ? thread.archivedAt
              : archived
                ? (thread.archivedAt ?? Date.now())
                : null,
        }),
      );
    });

    /** Delete the thread — the app's trash, with its grace window and
     * legal-hold check. A thread mid-turn is refused: cancel the turn
     * first. */
    app.delete(scope.item, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      try {
        const trashed =
          !(await isGenerating(thread.id)) &&
          (await trashThread(deps.sql, restAuth(c), thread.id));
        if (!trashed) {
          return c.json(
            {
              error:
                'This conversation is generating a response; cancel the turn before deleting it.',
              code: 'CHAT_TURN_IN_PROGRESS',
            },
            409,
          );
        }
      } catch (error) {
        return domainErrorResponse(c, error);
      }
      return c.body(null, 204);
    });

    /** The conversation in sequence order, cursor-paginated (`cursor` = the
     * previous page's last `order`). */
    app.get(`${scope.item}/messages`, async (c) => {
      const query = readQuery(c, PAGE_QUERY);
      if (query instanceof Response) return query;
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      const limit = readPageLimit(c, { fallback: 25, max: 100 });
      if (limit instanceof Response) return limit;
      // Only a stored message order fits this int4 cursor; anything else is
      // refused before it reaches Postgres's integer cast.
      const messageList = `messages:${thread.id}`;
      const cursor = readIntegerCursor(c, messageList, {
        max: 2_147_483_647,
      });
      if (cursor instanceof Response) return cursor;
      const rows = await deps.sql<
        {
          id: string;
          role: string;
          parts: unknown;
          text: string | null;
          sequence: number;
          stepOrder: number;
          model: string | null;
          providerSlug: string | null;
          blockedReason: string | null;
          error: string | null;
          status: string;
          usage: unknown;
          createdAt: number;
        }[]
      >`
      SELECT id, role, parts, text, "order" AS sequence,
             step_order AS "stepOrder", model, provider_slug AS "providerSlug",
             blocked_reason AS "blockedReason", error, status, usage,
             created_at_ms::float8 AS "createdAt"
      FROM app.messages
      WHERE thread_id = ${thread.id}
        AND (${cursor}::int IS NULL OR "order" > ${cursor})
      ORDER BY "order" ASC, step_order ASC
      LIMIT ${limit + 1}
    `;
      const page = rows.slice(0, limit);
      const isDone = rows.length <= limit;
      return c.json({
        page: page.map((row) => ({
          id: row.id,
          role: row.role,
          parts:
            row.parts ??
            (row.text !== null ? [{ type: 'text', text: row.text }] : []),
          sequence: row.sequence,
          // `pending` is the placeholder a running turn fills in — the row
          // GET …/generation names as messageId; the page is complete
          // without it being final.
          status: row.status,
          ...(row.model !== null ? { model: row.model } : {}),
          ...(row.providerSlug !== null
            ? { providerSlug: row.providerSlug }
            : {}),
          ...(row.blockedReason !== null
            ? { blockedReason: row.blockedReason }
            : {}),
          ...(row.error !== null ? restMessageError(row.error) : {}),
          ...(restMessageUsage(row.usage) !== null
            ? { usage: restMessageUsage(row.usage) }
            : {}),
          createdAt: row.createdAt,
        })),
        isDone,
        continueCursor:
          isDone || page.at(-1) === undefined
            ? ''
            : mintCursor(c, messageList, String(page.at(-1)?.sequence)),
      });
    });

    /** Poll the in-flight turn: `queued` while the accepted send waits for
     * a worker (the 202's marker), `streaming` while the generation row
     * exists — with the text and reasoning streamed so far, so a poller
     * sees progress — and `idle` once neither is there: the reply, if any,
     * is in the messages. */
    app.get(`${scope.item}/generation`, noQuery, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      const rows = await deps.sql<
        {
          messageId: string | null;
          text: string | null;
          reasoning: string | null;
          cancelRequested: boolean | null;
          updatedAt: number | null;
        }[]
      >`
      SELECT message_id AS "messageId", text, reasoning,
             cancel_requested AS "cancelRequested",
             updated_at_ms::float8 AS "updatedAt"
      FROM app.generations
      WHERE thread_id = ${thread.id} LIMIT 1
    `;
      const generation = rows[0];
      if (generation === undefined) {
        if (thread.queuedSince !== null && thread.queuedSince !== undefined) {
          return c.json({
            status: 'queued',
            ...(thread.streamId !== null && thread.streamId !== undefined
              ? { messageId: thread.streamId }
              : {}),
          });
        }
        return c.json({ status: 'idle' });
      }
      return c.json({
        status: generation.messageId === null ? 'queued' : 'streaming',
        ...(generation.messageId !== null
          ? { messageId: generation.messageId }
          : {}),
        text: generation.text ?? '',
        reasoning: generation.reasoning ?? '',
        cancelRequested: generation.cancelRequested === true,
        ...(typeof generation.updatedAt === 'number'
          ? { updatedAt: generation.updatedAt }
          : {}),
      });
    });

    /** Cancel the running turn — the app's own stop: the turn reads the
     * flag at its next progress write and settles what it has. 202: the
     * stop is asked for, not yet done; poll until idle. */
    app.delete(`${scope.item}/generation`, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      const rows = await deps.sql<{ messageId: string | null }[]>`
      UPDATE app.generations SET cancel_requested = true
      WHERE thread_id = ${thread.id} AND org_id = ${c.get('organizationId')}
      RETURNING message_id AS "messageId"
    `;
      const generation = rows[0];
      if (generation === undefined) {
        return notFound(c, 'No turn is running.', 'CHAT_TURN_NOT_RUNNING');
      }
      await stampCancelRequest(deps.sql, thread.id, generation.messageId);
      return c.json(
        {
          status: 'cancelling',
          ...(generation.messageId !== null
            ? { messageId: generation.messageId }
            : {}),
        },
        202,
      );
    });

    /** Send a message and start the turn that answers it (202). */
    app.post(`${scope.item}/messages`, async (c) => {
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const body = z
        .object({
          // Trimmed before the length check: a blank prompt is a mistake
          // to name at the door, not a turn to spend on.
          content: z.string().trim().min(1).max(MAX_MESSAGE),
          model: z
            .string({
              error: (issue) =>
                issue.input === undefined
                  ? 'is required — GET /api/v1/models lists the models this key can send to'
                  : undefined,
            })
            .min(1)
            .max(MAX_MODEL_ID),
          providerSlug: z.string().min(1).max(MAX_MODEL_ID).optional(),
          // The reasoning-depth pick the app's composer offers, on the same
          // five-step scale; absent samples the model's default.
          reasoningEffort: z.enum(EFFORT_LEVELS).optional(),
          // The caller's reply ceiling for this turn — checked below
          // against the listed model's own, so a turn can be bounded.
          maxOutputTokens: z.number().int().min(1).optional(),
          locale: z
            .string()
            .max(20)
            .regex(LOCALE_PATTERN, {
              message:
                'locale must be a BCP 47 language tag such as "de" or "en-GB"',
            })
            .optional(),
        })
        .strict()
        .safeParse(await readJsonBody(c));
      if (!body.success) {
        return invalidBodyResponse(c, body.error);
      }
      const projectId = projectIdFor(c);
      const thread = await loadRestThread(c, threadIdFor(c), projectId);
      if (thread === null)
        return notFound(c, 'Thread not found', 'THREAD_NOT_FOUND');
      // After the visibility gate — an invisible thread stays an opaque 404
      // whatever the body says — and before the thread's own state answers.
      // Either way the pair leaves here resolved: the provider the caller
      // named, checked, or the one the listing serves the model from.
      let providerSlug: string;
      let models: Awaited<ReturnType<typeof restModels>>;
      try {
        models = await restModels(c);
        if (body.data.providerSlug !== undefined) {
          const refusal = refuseUnlistedProvider(
            c,
            models,
            body.data.model,
            body.data.providerSlug,
          );
          if (refusal) return refusal;
          providerSlug = body.data.providerSlug;
        } else {
          const resolved = resolveModelProvider(c, models, body.data.model);
          if (resolved instanceof Response) return resolved;
          providerSlug = resolved;
        }
      } catch (error) {
        return domainErrorResponse(c, error);
      }
      // The caller's ceiling never exceeds the model's own: the listing is
      // the authority on what a reply may cost, and a cap above it would
      // silently mean the model's.
      const listed = models.find(
        (model) =>
          model.id === body.data.model && model.providerSlug === providerSlug,
      );
      const ceiling = listed?.maxOutputTokens;
      if (
        body.data.maxOutputTokens !== undefined &&
        ceiling !== undefined &&
        body.data.maxOutputTokens > ceiling
      ) {
        return c.json(
          {
            error: `invalid body: "maxOutputTokens" must be at most ${ceiling}, this model's own reply ceiling (GET /api/v1/models lists it)`,
            code: 'INVALID_BODY',
            data: {
              issues: [
                {
                  path: 'maxOutputTokens',
                  message: `must be at most ${ceiling}, this model's own reply ceiling`,
                },
              ],
            },
          },
          400,
        );
      }
      if (thread.archived) {
        return c.json(
          {
            error: 'This conversation is archived.',
            code: 'CHAT_THREAD_ARCHIVED',
          },
          409,
        );
      }
      if (thread.kind !== 'direct') {
        return c.json(
          {
            error:
              'This conversation runs a harness in a sandbox; it cannot be driven through the REST API.',
            code: 'CHAT_THREAD_NOT_DIRECT',
          },
          409,
        );
      }
      // At most one turn per thread — refuse a concurrent send rather than
      // let two turns interleave. The detached job re-checks this.
      if (await isGenerating(thread.id)) {
        return c.json(
          {
            error: 'This conversation is already generating a response.',
            code: 'CHAT_TURN_IN_PROGRESS',
          },
          409,
        );
      }

      // The reply's id is minted HERE, before the turn exists, so the 202
      // can name it: a caller that loses the response finds its reply by
      // that id, and the poll answers `queued` (not `idle`) until the
      // worker opens the turn — both in one transaction with the job, so
      // the marker and the job that ends it can never disagree.
      const assistantMessageId = randomUUID();
      await deps.sql.begin(async (tx) => {
        await tx`
          UPDATE app.thread_metadata SET
            generation_queued_since_ms = ${Date.now()},
            stream_id = ${assistantMessageId}
          WHERE thread_id = ${thread.id}
        `;
        await addJobInTx(tx, 'chat.api_turn', {
          organizationId: c.get('organizationId'),
          userId: c.get('userId'),
          threadId: thread.id,
          expectedProjectId: projectId,
          userText: body.data.content,
          modelId: body.data.model,
          // The resolved provider is the choice all the way to the wire —
          // the 202 names it, and the turn refuses a pair that stops
          // resolving rather than falling back to another connector.
          providerSlug,
          providerStrict: true,
          assistantMessageId,
          ...(body.data.reasoningEffort !== undefined
            ? { reasoningEffort: body.data.reasoningEffort }
            : {}),
          ...(body.data.maxOutputTokens !== undefined
            ? { maxOutputTokens: body.data.maxOutputTokens }
            : {}),
          ...(body.data.locale !== undefined
            ? { locale: body.data.locale }
            : {}),
        });
      });

      return c.json(
        {
          threadId: thread.id,
          status: 'accepted',
          model: body.data.model,
          providerSlug,
          messageId: assistantMessageId,
          poll:
            projectId === null
              ? `/api/v1/threads/${thread.id}/generation`
              : `/api/v1/projects/${projectId}/threads/${thread.id}/generation`,
        },
        202,
      );
    });
  }

  return app;
}
