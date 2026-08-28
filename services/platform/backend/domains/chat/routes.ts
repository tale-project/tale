import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  listAutomationCapabilities,
  listComposerModels,
  listProjectCapabilities,
} from './composer.ts';
import {
  cancelDeferredSend,
  enqueueDeferredSend,
  listDeferredSends,
} from './deferred-sends.ts';
import {
  listMemories,
  reviewMemory,
  saveMemory,
  searchApprovedMemories,
} from './memories.ts';
import { runChatTurn } from './service.ts';
import {
  branchForEdit,
  branchForRegenerate,
  branchThread,
  ChatThreadError,
  createThread,
  getSharedThread,
  getThread,
  getThreadShareStatus,
  listArchivedThreads,
  listThreadBranches,
  listThreads,
  listThreadsForProject,
  markThreadRead,
  moveThreadToProject,
  renameThread,
  restoreThread,
  searchChats,
  setBranchSelection,
  setThreadArchived,
  setThreadCapabilities,
  setThreadPinned,
  setThreadReasoningEffort,
  setThreadSharedWithProject,
  shareThread,
  trashThread,
  unshareThread,
} from './threads.ts';

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

const capabilitiesSchema = z.object({
  skills: z.array(z.string().max(200)).max(50),
  connectors: z.array(z.string().max(200)).max(50),
});

const createThreadSchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().max(128).optional(),
  kind: z.string().max(50).optional(),
  agentSlug: z.string().max(200).optional(),
  harness: z.string().max(100).optional(),
  capabilities: capabilitiesSchema.optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'extra', 'max']).optional(),
});

const sendSchema = z.object({
  text: z.string().max(200_000),
  /** Exactly one of `modelId` and `modelSelection: 'auto'` — enforced by
   * the turn engine itself (an unresolvable Auto refuses loudly). */
  modelId: z.string().min(1).max(200).optional(),
  modelSelection: z.literal('auto').optional(),
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
      AND t.user_id = ${userId} AND tm.status = 'active'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function handleThreadError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ChatThreadError || error instanceof LegalHoldError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
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
    try {
      const threadId = await createThread(deps.sql, {
        organizationId,
        userId,
        kind: body.data.kind ?? 'chat',
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.agentSlug !== undefined
          ? { agentSlug: body.data.agentSlug }
          : {}),
        ...(body.data.harness !== undefined
          ? { harness: body.data.harness }
          : {}),
        ...(body.data.capabilities !== undefined
          ? { capabilities: body.data.capabilities }
          : {}),
        ...(body.data.projectId !== undefined
          ? { projectId: body.data.projectId }
          : {}),
        ...(body.data.reasoningEffort !== undefined
          ? { reasoningEffort: body.data.reasoningEffort }
          : {}),
      });
      return c.json({ id: threadId }, 201);
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  // The panel's list: pinned rows floated, newest activity first, each row
  // tagged with whether a turn is generating.
  app.get('/threads', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json({
      threads: await listThreads(deps.sql, organizationId, userId),
    });
  });

  app.get('/threads/archived', async (c) => {
    const { organizationId, userId } = caller(c);
    const cursorRaw = c.req.query('cursor');
    const limitRaw = c.req.query('limit');
    return c.json(
      await listArchivedThreads(deps.sql, organizationId, userId, {
        ...(cursorRaw !== undefined ? { cursor: Number(cursorRaw) } : {}),
        ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
      }),
    );
  });

  app.get('/threads/search', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json({
      results: await searchChats(
        deps.sql,
        organizationId,
        userId,
        c.req.query('q') ?? '',
      ),
    });
  });

  // Resolve a share token to its read-only snapshot. Token + org membership
  // together authorize the read (the door already proved membership of
  // THIS org; the thread must belong to it).
  app.get('/threads/shared/:token', async (c) => {
    const view = await getSharedThread(
      deps.sql,
      [c.get('orgId')],
      c.req.param('token'),
    );
    return view === null ? c.json({ error: 'not found' }, 404) : c.json(view);
  });

  app.get('/threads/:threadId/summary', async (c) => {
    const { organizationId, userId } = caller(c);
    const summary = await getThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    return summary === null
      ? c.json({ error: 'thread not found' }, 404)
      : c.json({ thread: summary });
  });

  app.get('/threads/:threadId/share-status', async (c) => {
    const { organizationId, userId } = caller(c);
    const status = await getThreadShareStatus(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    return status === null
      ? c.json({ error: 'thread not found' }, 404)
      : c.json(status);
  });

  app.post('/threads/:threadId/capabilities', async (c) => {
    const body = capabilitiesSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      return c.json({
        ok: await setThreadCapabilities(
          deps.sql,
          organizationId,
          userId,
          c.req.param('threadId'),
          body.data,
        ),
      });
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.post('/threads/:threadId/reasoning-effort', async (c) => {
    const body = z
      .object({
        reasoningEffort: z
          .enum(['low', 'medium', 'high', 'extra', 'max'])
          .optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await setThreadReasoningEffort(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
        body.data.reasoningEffort,
      ),
    });
  });

  app.post('/threads/:threadId/project', async (c) => {
    const body = z
      .object({ projectId: z.string().max(128).nullable() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      return c.json({
        ok: await moveThreadToProject(
          deps.sql,
          organizationId,
          userId,
          c.req.param('threadId'),
          body.data.projectId,
        ),
      });
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.post('/threads/:threadId/rename', async (c) => {
    const body = z
      .object({ title: z.string().max(500) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await renameThread(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
        body.data.title,
      ),
    });
  });

  app.post('/threads/:threadId/pin', async (c) => {
    const body = z
      .object({ pinned: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await setThreadPinned(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
        body.data.pinned,
      ),
    });
  });

  app.post('/threads/:threadId/read', async (c) => {
    const body = z
      .object({ read: z.boolean().optional() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    await markThreadRead(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.read !== false,
    );
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/archive', async (c) => {
    const body = z
      .object({ archived: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await setThreadArchived(
        deps.sql,
        {
          organizationId,
          userId,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('threadId'),
        body.data.archived,
      ),
    });
  });

  app.post('/threads/:threadId/share-project', async (c) => {
    const body = z
      .object({ shared: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      return c.json({
        ok: await setThreadSharedWithProject(
          deps.sql,
          {
            organizationId,
            userId,
            email: c.get('sessionBundle').user.email,
          },
          c.req.param('threadId'),
          body.data.shared,
        ),
      });
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.post('/threads/:threadId/share', async (c) => {
    const { organizationId, userId } = caller(c);
    const share = await shareThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    return share === null
      ? c.json({ error: 'thread not found' }, 404)
      : c.json(share);
  });

  app.post('/threads/:threadId/unshare', async (c) => {
    const { organizationId, userId } = caller(c);
    await unshareThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/branch', async (c) => {
    const body = z
      .object({
        fromMessageId: z.string().min(1).max(128),
        title: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const branchId = await branchThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.fromMessageId,
      body.data.title,
    );
    return branchId === null
      ? c.json({ error: 'thread or message not found' }, 404)
      : c.json({ id: branchId }, 201);
  });

  // Edit / regenerate sibling branches + the fork-point selection map.
  app.post('/threads/:threadId/branch-edit', async (c) => {
    const body = z
      .object({ editedMessageId: z.string().min(1).max(128) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const branchId = await branchForEdit(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.editedMessageId,
    );
    return branchId === null
      ? c.json({ error: 'thread or message not found' }, 404)
      : c.json({ id: branchId }, 201);
  });

  app.post('/threads/:threadId/branch-regenerate', async (c) => {
    const body = z
      .object({ assistantMessageId: z.string().min(1).max(128) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const branchId = await branchForRegenerate(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.assistantMessageId,
    );
    return branchId === null
      ? c.json({ error: 'thread or message not found' }, 404)
      : c.json({ id: branchId }, 201);
  });

  app.get('/threads/:threadId/branches', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json(
      await listThreadBranches(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
      ),
    );
  });

  app.post('/threads/:threadId/branch-selection', async (c) => {
    const body = z
      .object({
        forkKey: z.string().min(1).max(256),
        selectedThreadId: z.string().min(1).max(128),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    await setBranchSelection(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.forkKey,
      body.data.selectedThreadId,
    );
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/trash', async (c) => {
    const { organizationId, userId } = caller(c);
    try {
      return c.json({
        ok: await trashThread(
          deps.sql,
          {
            organizationId,
            userId,
            email: c.get('sessionBundle').user.email,
          },
          c.req.param('threadId'),
        ),
      });
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.post('/threads/:threadId/restore', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await restoreThread(
        deps.sql,
        {
          organizationId,
          userId,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('threadId'),
      ),
    });
  });

  // The composer surface: the model picker + capability menus.
  app.get('/composer/models', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json(
      await listComposerModels(deps.sql, { organizationId, userId }),
    );
  });

  app.get('/composer/project/:projectId/capabilities', async (c) => {
    const { organizationId, userId } = caller(c);
    try {
      return c.json(
        await listProjectCapabilities(deps.sql, {
          organizationId,
          userId,
          projectId: c.req.param('projectId'),
        }),
      );
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.get('/composer/automation-capabilities', async (c) => {
    const { organizationId } = caller(c);
    // Developer-gated, matching the automation domain's own write gate.
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin or developer role required' }, 403);
    }
    const projectId = c.req.query('projectId');
    return c.json(
      await listAutomationCapabilities(deps.sql, {
        organizationId,
        ...(projectId !== undefined ? { projectId } : {}),
      }),
    );
  });

  // Memories: approval-gated durable facts (the preferences page's review
  // surface + the model-readable approved set).
  app.get('/memories', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json(await listMemories(deps.sql, organizationId, userId));
  });

  app.get('/memories/search', async (c) => {
    const { organizationId, userId } = caller(c);
    const limitRaw = c.req.query('limit');
    return c.json({
      memories: await searchApprovedMemories(deps.sql, {
        organizationId,
        userId,
        ...(c.req.query('q') !== undefined ? { query: c.req.query('q') } : {}),
        ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
      }),
    });
  });

  app.post('/memories', async (c) => {
    const body = z
      .object({
        content: z.string().min(1).max(4_000),
        sourceThreadId: z.string().max(128).optional(),
        sourceMessageId: z.string().max(128).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const id = await saveMemory(deps.sql, {
      organizationId,
      userId,
      email: c.get('sessionBundle').user.email,
      content: body.data.content,
      ...(body.data.sourceThreadId !== undefined
        ? { sourceThreadId: body.data.sourceThreadId }
        : {}),
      ...(body.data.sourceMessageId !== undefined
        ? { sourceMessageId: body.data.sourceMessageId }
        : {}),
    });
    return c.json({ id }, 201);
  });

  app.post('/memories/:memoryId/review', async (c) => {
    const body = z
      .object({ decision: z.enum(['approved', 'rejected']) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await reviewMemory(deps.sql, {
        organizationId,
        userId,
        memoryId: c.req.param('memoryId'),
        decision: body.data.decision,
      }),
    });
  });

  // Deferred sends: park a send while media settle; the tray + cancel.
  app.post('/threads/:threadId/deferred-sends', async (c) => {
    const body = z
      .object({
        text: z.string().max(200_000),
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
        modelId: z.string().min(1).max(200).optional(),
        modelSelection: z.literal('auto').optional(),
        providerSlug: z.string().min(1).max(200).optional(),
        reasoningEffort: z
          .enum(['low', 'medium', 'high', 'extra', 'max'])
          .optional(),
        locale: z.string().max(20).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      return c.json(
        await enqueueDeferredSend(deps.sql, {
          organizationId,
          userId,
          threadId: c.req.param('threadId'),
          userText: body.data.text,
          ...(body.data.attachments !== undefined
            ? { attachments: body.data.attachments }
            : {}),
          ...(body.data.modelId !== undefined
            ? { modelId: body.data.modelId }
            : {}),
          ...(body.data.modelSelection !== undefined
            ? { modelSelection: body.data.modelSelection }
            : {}),
          ...(body.data.providerSlug !== undefined
            ? { providerSlug: body.data.providerSlug }
            : {}),
          ...(body.data.reasoningEffort !== undefined
            ? { reasoningEffort: body.data.reasoningEffort }
            : {}),
          ...(body.data.locale !== undefined
            ? { locale: body.data.locale }
            : {}),
        }),
        201,
      );
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.get('/threads/:threadId/deferred-sends', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json({
      sends: await listDeferredSends(deps.sql, {
        organizationId,
        userId,
        threadId: c.req.param('threadId'),
      }),
    });
  });

  app.post('/deferred-sends/:deferredSendId/cancel', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json({
      ok: await cancelDeferredSend(deps.sql, {
        organizationId,
        userId,
        deferredSendId: c.req.param('deferredSendId'),
      }),
    });
  });

  // The project page's Chats tab: mine + shared-with-project.
  app.get('/project/:projectId/threads', async (c) => {
    const { organizationId, userId } = caller(c);
    return c.json(
      await listThreadsForProject(
        deps.sql,
        organizationId,
        userId,
        c.req.param('projectId'),
      ),
    );
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
      ...(body.data.modelId !== undefined
        ? { modelId: body.data.modelId }
        : {}),
      ...(body.data.modelSelection !== undefined
        ? { modelSelection: body.data.modelSelection }
        : {}),
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
