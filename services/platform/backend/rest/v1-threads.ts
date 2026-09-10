import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { decodeChatError } from '../../lib/shared/chat-errors.ts';
import { listComposerModels } from '../domains/chat/composer.ts';
import { createThread } from '../domains/chat/threads.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  formatKeysetCursor,
  loadRestProject,
  pageLimit,
  parseKeysetCursor,
  readJsonBody,
  readOptionalJsonBody,
  restProjectAuth,
  type RestEnv,
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

interface RestThreadRow {
  id: string;
  title: string | null;
  kind: string;
  harness: string | null;
  projectId: string | null;
  archived: boolean;
  isShared: boolean | null;
  createdAt: number;
  updatedAt: number;
}

const REST_THREAD_COLUMNS = `
  t.id, t.title, tm.chat_type AS "kind",
  tm.harness, tm.project_id AS "projectId", tm.archived,
  tm.is_shared AS "isShared", t.created_at_ms::float8 AS "createdAt",
  t.updated_at_ms::float8 AS "updatedAt"
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

  app.get('/models', async (c) => {
    try {
      const { models } = await listComposerModels(deps.sql, {
        organizationId: c.get('organizationId'),
        userId: c.get('userId'),
      });
      return c.json({
        models: models
          .filter(
            ({ credential }) =>
              credential.authMethod === 'api-key' ||
              credential.authMethod === 'env',
          )
          .map(({ id, label, providerSlug, providerLabel }) => ({
            id,
            label,
            providerSlug,
            providerLabel,
          })),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  const threadView = (row: RestThreadRow, generating: boolean) => ({
    id: row.id,
    ...(row.title !== null ? { title: row.title } : {}),
    kind: row.kind,
    ...(row.harness !== null ? { harness: row.harness } : {}),
    ...(row.projectId !== null ? { projectId: row.projectId } : {}),
    archived: row.archived,
    ...(row.isShared !== null ? { isShared: row.isShared } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generating,
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
      JOIN app.thread_metadata tm ON tm.thread_id = t.id
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
        const ambiguous = await assertExplicitOrg(deps.sql, c);
        if (ambiguous) return ambiguous;
        try {
          const auth = await restProjectAuth(deps.sql, c);
          // Chat belongs to its user: readable-project members may create
          // and send, without an editor seat. Archived projects only read.
          await loadRestProject(deps.sql, auth, c.req.param('id') ?? '', {
            active: c.req.method === 'POST',
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
      const projectId = projectIdFor(c);
      const limit = pageLimit(c.req.query('limit'), { fallback: 25, max: 100 });
      const cursor = parseKeysetCursor(c.req.query('cursor'));
      const cursorUpdatedAt = cursor?.at ?? null;
      const cursorId = cursor?.id ?? null;
      const rows = await deps.sql<RestThreadRow[]>`
      SELECT ${deps.sql.unsafe(REST_THREAD_COLUMNS)}
      FROM app.threads t
      JOIN app.thread_metadata tm ON tm.thread_id = t.id
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
      const views = [];
      for (const row of page) {
        views.push(threadView(row, await isGenerating(row.id)));
      }
      const last = page[page.length - 1];
      return c.json({
        page: views,
        isDone,
        continueCursor:
          isDone || !last ? '' : formatKeysetCursor(last.updatedAt, last.id),
      });
    });

    /** Start a thread. REST creates DIRECT threads: a sandbox thread needs a
     * harness and a session this surface cannot drive. */
    app.post(scope.collection, async (c) => {
      const body = z
        .object({
          title: z.string().min(1).max(MAX_TITLE).optional(),
        })
        .strict()
        .safeParse(await readOptionalJsonBody(c));
      if (!body.success) {
        return c.json({ error: 'invalid body' }, 400);
      }
      try {
        const projectId = projectIdFor(c);
        const threadId = await createThread(deps.sql, {
          organizationId: c.get('organizationId'),
          userId: c.get('userId'),
          kind: 'direct',
          ...(body.data.title !== undefined ? { title: body.data.title } : {}),
          ...(projectId !== null
            ? { projectId, requireActiveProject: true }
            : {}),
        });
        return c.json({ id: threadId }, 201);
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    });

    app.get(scope.item, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null) return c.json({ error: 'Thread not found' }, 404);
      return c.json(threadView(thread, await isGenerating(thread.id)));
    });

    /** The conversation in sequence order, cursor-paginated (`cursor` = the
     * previous page's last `order`). */
    app.get(`${scope.item}/messages`, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null) return c.json({ error: 'Thread not found' }, 404);
      const limit = pageLimit(c.req.query('limit'), { fallback: 25, max: 100 });
      const cursorParam = c.req.query('cursor');
      // Only a stored message order fits this int4 cursor. Invalid values
      // start the first page instead of reaching Postgres's integer cast.
      const parsedCursor = Number(cursorParam);
      const cursor =
        cursorParam !== undefined &&
        cursorParam.trim() !== '' &&
        Number.isInteger(parsedCursor) &&
        parsedCursor >= 0 &&
        parsedCursor <= 2_147_483_647
          ? parsedCursor
          : null;
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
          createdAt: number;
        }[]
      >`
      SELECT id, role, parts, text, "order" AS sequence,
             step_order AS "stepOrder", model, provider_slug AS "providerSlug",
             blocked_reason AS "blockedReason", error,
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
          ...(row.model !== null ? { model: row.model } : {}),
          ...(row.providerSlug !== null
            ? { providerSlug: row.providerSlug }
            : {}),
          ...(row.blockedReason !== null
            ? { blockedReason: row.blockedReason }
            : {}),
          ...(row.error !== null ? restMessageError(row.error) : {}),
          createdAt: row.createdAt,
        })),
        isDone,
        continueCursor: isDone ? '' : String(page.at(-1)?.sequence ?? ''),
      });
    });

    /** Poll the in-flight turn. ABSENCE of the generation row means idle —
     * the reply, if any, is in the messages. */
    app.get(`${scope.item}/generation`, async (c) => {
      const thread = await loadRestThread(c, threadIdFor(c), projectIdFor(c));
      if (thread === null) return c.json({ error: 'Thread not found' }, 404);
      const rows = await deps.sql<{ messageId: string | null }[]>`
      SELECT message_id AS "messageId" FROM app.generations
      WHERE thread_id = ${thread.id} LIMIT 1
    `;
      const generation = rows[0];
      if (generation === undefined) return c.json({ status: 'idle' });
      return c.json({
        status: generation.messageId === null ? 'queued' : 'streaming',
        ...(generation.messageId !== null
          ? { messageId: generation.messageId }
          : {}),
      });
    });

    /** Send a message and start the turn that answers it (202). */
    app.post(`${scope.item}/messages`, async (c) => {
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const body = z
        .object({
          content: z.string().min(1).max(MAX_MESSAGE),
          model: z.string().min(1).max(MAX_MODEL_ID),
          providerSlug: z.string().min(1).max(MAX_MODEL_ID).optional(),
          locale: z.string().min(1).max(20).optional(),
        })
        .strict()
        .safeParse(await readJsonBody(c));
      if (!body.success) {
        return c.json(
          { error: 'invalid body ("content" and "model" are required)' },
          400,
        );
      }
      const projectId = projectIdFor(c);
      const thread = await loadRestThread(c, threadIdFor(c), projectId);
      if (thread === null) return c.json({ error: 'Thread not found' }, 404);
      if (thread.archived) {
        return c.json({ error: 'This conversation is archived.' }, 409);
      }
      if (thread.kind !== 'direct') {
        return c.json(
          {
            error:
              'This conversation runs a harness in a sandbox; it cannot be driven through the REST API.',
          },
          409,
        );
      }
      // At most one turn per thread — refuse a concurrent send rather than
      // let two turns interleave. The detached job re-checks this.
      if (await isGenerating(thread.id)) {
        return c.json(
          { error: 'This conversation is already generating a response.' },
          409,
        );
      }

      await addJobInTx(deps.sql, 'chat.api_turn', {
        organizationId: c.get('organizationId'),
        userId: c.get('userId'),
        threadId: thread.id,
        expectedProjectId: projectId,
        userText: body.data.content,
        modelId: body.data.model,
        ...(body.data.providerSlug !== undefined
          ? { providerSlug: body.data.providerSlug }
          : {}),
        ...(body.data.locale !== undefined ? { locale: body.data.locale } : {}),
      });

      return c.json(
        {
          threadId: thread.id,
          status: 'accepted',
          model: body.data.model,
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
