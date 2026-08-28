import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { runChatTurn } from './service.ts';

/**
 * /api/app/chat — the signed-in chat surface: threads, history, one turn
 * per send (the caller AWAITS the turn, the 0.4 action contract), a
 * per-thread SSE progress lane over `app.generations`, and cancel.
 *
 * Ownership mirrors 0.4: a thread is user-private — only its owner reads
 * or writes it (the project-shared read grant ports with the frontend
 * bridge). The busy gate refuses a concurrent send rather than letting two
 * turns interleave on one thread.
 */

const createThreadSchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().max(128).optional(),
});

const sendSchema = z.object({
  text: z.string().max(200_000),
  modelId: z.string().min(1).max(200),
  providerSlug: z.string().min(1).max(200).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'extra', 'max']).optional(),
  attachments: z
    .array(
      z.object({
        fileId: z.string().min(1).max(1024),
        fileName: z.string().min(1).max(512),
        fileType: z.string().min(1).max(255),
        fileSize: z.number().int().min(0),
      }),
    )
    .max(20)
    .optional(),
  resend: z.boolean().optional(),
});

/** The stream lane wakes at the store's write throttle — polling faster
 * cannot observe fresher text. */
const STREAM_POLL_MS = 250;
const STREAM_HEARTBEAT_MS = 15_000;

interface ThreadView {
  id: string;
  title: string | null;
  projectId: string | null;
  generationStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MessageView {
  id: string;
  role: string;
  parts: unknown;
  sequence: number;
  model?: string;
  providerSlug?: string;
  usage?: unknown;
  blockedReason?: string;
  error?: string;
  createdAt: number;
}

interface GenerationRow {
  messageId: string | null;
  text: string;
  reasoning: string;
  cancelRequested: boolean;
  startedAt: number;
  updatedAt: number;
}

async function ownedThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<ThreadView | null> {
  const rows = await sql<ThreadView[]>`
    SELECT t.id, t.title, tm.project_id AS "projectId",
           tm.generation_status AS "generationStatus",
           t.created_at_ms::float8 AS "createdAt",
           t.updated_at_ms::float8 AS "updatedAt"
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${organizationId}
      AND t.user_id = ${userId} AND tm.chat_type = 'chat'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listMessageViews(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<MessageView[]> {
  const rows = await sql<
    (Omit<MessageView, 'model' | 'providerSlug' | 'usage'> & {
      model: string | null;
      providerSlug: string | null;
      usage: unknown;
    })[]
  >`
    SELECT id, role, parts, "order" AS sequence, model,
           provider_slug AS "providerSlug", usage,
           blocked_reason AS "blockedReason", error,
           created_at_ms::float8 AS "createdAt"
    FROM app.messages
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
    ORDER BY "order", step_order
  `;
  return rows.map((row) =>
    Object.assign(
      {
        id: row.id,
        role: row.role,
        parts: row.parts ?? [],
        sequence: row.sequence,
        createdAt: row.createdAt,
      },
      row.model !== null ? { model: row.model } : {},
      row.providerSlug !== null ? { providerSlug: row.providerSlug } : {},
      row.usage != null ? { usage: row.usage } : {},
      row.blockedReason != null ? { blockedReason: row.blockedReason } : {},
      row.error != null ? { error: row.error } : {},
    ),
  );
}

async function readGeneration(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<GenerationRow | null> {
  const rows = await sql<GenerationRow[]>`
    SELECT message_id AS "messageId", text, reasoning,
           cancel_requested AS "cancelRequested",
           started_at_ms::float8 AS "startedAt",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.generations
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function createChatRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  app.post('/threads', async (c) => {
    const body = createThreadSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const { organizationId, userId } = caller(c);
    // A project link is access-checked at creation with the same gate the
    // send path uses — a thread must never smuggle its owner into a project
    // they cannot read. (Access = the project is in the caller's readable
    // set; resolved via the projects service inside the shim's twin.)
    if (body.data.projectId !== undefined) {
      const readable = await deps.sql<{ id: string }[]>`
        SELECT p.id FROM app.projects p
        WHERE p.id = ${body.data.projectId} AND p.org_id = ${organizationId}
        LIMIT 1
      `;
      if (readable.length === 0) {
        return c.json({ error: 'project not found' }, 404);
      }
    }
    const now = Date.now();
    const threadId = await deps.sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                                 updated_at_ms)
        VALUES (${organizationId}, ${userId}, ${body.data.title ?? null},
                'chat', ${now}, ${now})
        RETURNING id
      `;
      const id = rows[0]?.id;
      if (!id) throw new Error('thread insert failed');
      await tx`
        INSERT INTO app.thread_metadata (thread_id, org_id, user_id,
                                         chat_type, status, project_id,
                                         created_at_ms)
        VALUES (${id}, ${organizationId}, ${userId}, 'chat', 'active',
                ${body.data.projectId ?? null}, ${now})
      `;
      return id;
    });
    return c.json({ id: threadId }, 201);
  });

  app.get('/threads', async (c) => {
    const { organizationId, userId } = caller(c);
    const rows = await deps.sql<ThreadView[]>`
      SELECT t.id, t.title, tm.project_id AS "projectId",
             tm.generation_status AS "generationStatus",
             t.created_at_ms::float8 AS "createdAt",
             t.updated_at_ms::float8 AS "updatedAt"
      FROM app.threads t
      JOIN app.thread_metadata tm ON tm.thread_id = t.id
      WHERE t.org_id = ${organizationId} AND t.user_id = ${userId}
        AND tm.chat_type = 'chat' AND tm.status = 'active'
      ORDER BY t.updated_at_ms DESC
      LIMIT 200
    `;
    return c.json({ threads: rows });
  });

  app.get('/threads/:threadId/messages', async (c) => {
    const { organizationId, userId } = caller(c);
    const thread = await ownedThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (thread === null) {
      return c.json({ error: 'thread not found' }, 404);
    }
    const messages = await listMessageViews(
      deps.sql,
      organizationId,
      thread.id,
    );
    return c.json({ thread, messages });
  });

  app.post('/threads/:threadId/messages', async (c) => {
    const body = sendSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const { organizationId, userId } = caller(c);
    const thread = await ownedThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (thread === null) {
      return c.json({ error: 'thread not found' }, 404);
    }
    // At most one turn per thread — refuse a concurrent send rather than
    // let two turns interleave and delete each other's generation row.
    const live = await readGeneration(deps.sql, organizationId, thread.id);
    if (live !== null) {
      return c.json(
        {
          status: 'refused',
          reason: 'This conversation is already generating a response.',
        },
        409,
      );
    }
    const outcome = await runChatTurn(deps.sql, {
      organizationId,
      userId,
      threadId: thread.id,
      userText: body.data.text,
      modelId: body.data.modelId,
      ...(body.data.providerSlug !== undefined
        ? { providerSlug: body.data.providerSlug }
        : {}),
      ...(body.data.reasoningEffort !== undefined
        ? { reasoningEffort: body.data.reasoningEffort }
        : {}),
      ...(body.data.attachments !== undefined &&
      body.data.attachments.length > 0
        ? { attachments: body.data.attachments }
        : {}),
      ...(body.data.resend === true ? { resend: true } : {}),
    });
    return outcome.status === 'completed'
      ? c.json({ status: 'completed' })
      : c.json({ status: 'refused', reason: outcome.reason });
  });

  app.post('/threads/:threadId/cancel', async (c) => {
    const { organizationId, userId } = caller(c);
    const thread = await ownedThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (thread === null) {
      return c.json({ error: 'thread not found' }, 404);
    }
    const rows = await deps.sql<{ threadId: string }[]>`
      UPDATE app.generations SET cancel_requested = true
      WHERE thread_id = ${thread.id} AND org_id = ${organizationId}
      RETURNING thread_id AS "threadId"
    `;
    return c.json({ cancelled: rows.length > 0 });
  });

  // The per-thread progress lane. Emits `progress` while a generation row
  // exists (whenever its updated_at_ms moves) and `settled` with the final
  // message when it disappears; stays open for the thread's next turn.
  // Polling AT the store's 250ms write throttle: pushing (the NOTIFY the
  // store already sends) cannot beat the throttle, so a listener hub would
  // add a connection without adding freshness.
  app.get('/threads/:threadId/stream', async (c) => {
    const { organizationId, userId } = caller(c);
    const thread = await ownedThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (thread === null) {
      return c.json({ error: 'thread not found' }, 404);
    }
    return streamSSE(c, async (stream) => {
      let lastSeenUpdate = 0;
      let lastMessageId: string | null = null;
      let generating = false;
      let lastBeatAt = Date.now();
      while (!stream.aborted) {
        try {
          const generation = await readGeneration(
            deps.sql,
            organizationId,
            thread.id,
          );
          if (generation !== null) {
            generating = true;
            lastMessageId = generation.messageId ?? lastMessageId;
            if (generation.updatedAt > lastSeenUpdate) {
              lastSeenUpdate = generation.updatedAt;
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  messageId: generation.messageId,
                  text: generation.text,
                  reasoning: generation.reasoning,
                  cancelRequested: generation.cancelRequested,
                }),
              });
              lastBeatAt = Date.now();
            }
          } else if (generating) {
            // The row's absence is the settle signal — ship the final row.
            generating = false;
            lastSeenUpdate = 0;
            const messages = await listMessageViews(
              deps.sql,
              organizationId,
              thread.id,
            );
            const settled =
              lastMessageId !== null
                ? (messages.find((row) => row.id === lastMessageId) ??
                  messages.at(-1))
                : messages.at(-1);
            await stream.writeSSE({
              event: 'settled',
              data: JSON.stringify({ message: settled ?? null }),
            });
            lastBeatAt = Date.now();
          } else if (Date.now() - lastBeatAt >= STREAM_HEARTBEAT_MS) {
            await stream.writeSSE({ event: 'heartbeat', data: '' });
            lastBeatAt = Date.now();
          }
        } catch (error) {
          if (stream.aborted) break;
          console.error('[chat] stream poll failed, backing off:', error);
          await stream.sleep(1000);
          continue;
        }
        await stream.sleep(STREAM_POLL_MS);
      }
    });
  });

  return app;
}
