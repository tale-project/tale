import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { THREAD_BUSY_REASON, ThreadBusyError } from '../../../lib/chat/turn.ts';
import {
  classifyChatErrorCode,
  encodeChatError,
} from '../../../lib/shared/chat-errors.ts';
import { AppError } from '../../../lib/shared/errors/app-error.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { isBackendDraining } from '../control/service.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  ensureArenaPair,
  getArenaPair,
  hasLiveGeneration,
  settleArenaPair,
} from './arena.ts';
import {
  listAutomationCapabilities,
  listComposerModels,
  listProjectCapabilities,
} from './composer.ts';
import {
  claimDeferredSendVideos,
  cancelDeferredSend,
  enqueueDeferredSend,
  listDeferredSends,
} from './deferred-sends.ts';
import { getOrgChatHealth } from './health.ts';
import {
  listMemories,
  reviewMemory,
  saveMemory,
  searchApprovedMemories,
} from './memories.ts';
import { getPendingQuestion, resolveQuestion } from './questions.ts';
import { runChatTurn } from './service.ts';
import { appendMessageRow } from './store.ts';

/** The pre-turn refusals of the serving layer: the model is not available to
 * the org, or the credential its provider resolves to cannot serve. Every
 * other error from a turn stays what it is — an internal failure. */
const SERVING_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'CHAT_MODEL_UNKNOWN',
  'CHAT_CREDENTIAL_UNSUPPORTED',
  'CHAT_PROVIDER_ENDPOINT_MISSING',
  'CREDENTIAL_NONE_CONFIGURED',
  'CREDENTIAL_DISABLED',
  'CREDENTIAL_KEY_ROTATED',
  'CREDENTIAL_ENV_UNSET',
]);

function servingRefusalReason(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  const data: unknown = error.data;
  if (data === null || typeof data !== 'object') return null;
  const code = 'code' in data ? data.code : undefined;
  const message = 'message' in data ? data.message : undefined;
  return typeof code === 'string' &&
    SERVING_REFUSAL_CODES.has(code) &&
    typeof message === 'string'
    ? message
    : null;
}
import {
  loadProjectSharedThread,
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

const arenaTurnSchema = z.object({
  userText: z.string().max(200_000),
  modelIdA: z.string().min(1).max(200),
  modelIdB: z.string().min(1).max(200),
  providerSlugA: z.string().min(1).max(200).optional(),
  providerSlugB: z.string().min(1).max(200).optional(),
  /** One pick for the whole comparison — BOTH columns run with it, so the
   * two replies differ by model alone. */
  reasoningEffort: z.enum(['low', 'medium', 'high', 'extra', 'max']).optional(),
  locale: z.string().max(35).optional(),
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

/** The same view by id alone — for a thread the caller may READ but does
 * not own (`loadProjectSharedThread` proved the access). */
async function threadViewById(
  sql: Sql,
  organizationId: string,
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
      AND tm.status = 'active'
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

/**
 * The assistant row's parts AS THEY STAND mid-turn.
 *
 * The turn writes them a step at a time (`updateAssistantParts`), so this is
 * where a tool call becomes visible before the turn ends — the transcript
 * itself is only refetched at settle. Read separately from the generation
 * row because it is only worth reading once a message id exists.
 */
async function readLiveParts(
  sql: Sql,
  organizationId: string,
  messageId: string,
): Promise<unknown[] | null> {
  const rows = await sql<{ parts: unknown }[]>`
    SELECT parts FROM app.messages
    WHERE id = ${messageId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const parts = rows[0]?.parts;
  return Array.isArray(parts) ? parts : null;
}

export function createChatRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  /** A thread-family write happened for this caller — nudge THEIR
   * `['backend', orgId, 'chat_thread']` reads (user-targeted hint; other
   * members' views of shared threads refetch on their own cadence). */
  const hintThread = async (
    c: Context<OrgEnv>,
    threadId: string,
  ): Promise<void> => {
    const { organizationId, userId } = caller(c);
    await emitHintInTx(deps.sql, {
      orgId: organizationId,
      userId,
      entity: 'chat_thread',
      entityId: threadId,
    });
  };

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
      await hintThread(c, threadId);
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
      const ok = await setThreadCapabilities(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
        body.data,
      );
      if (ok) await hintThread(c, c.req.param('threadId'));
      return c.json({ ok });
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
    const ok = await setThreadReasoningEffort(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.reasoningEffort,
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
  });

  app.post('/threads/:threadId/project', async (c) => {
    const body = z
      .object({ projectId: z.string().max(128).nullable() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      const ok = await moveThreadToProject(
        deps.sql,
        {
          organizationId,
          userId,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('threadId'),
        body.data.projectId,
      );
      if (ok) await hintThread(c, c.req.param('threadId'));
      return c.json({ ok });
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
    const ok = await renameThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.title,
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
  });

  app.post('/threads/:threadId/pin', async (c) => {
    const body = z
      .object({ pinned: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const ok = await setThreadPinned(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
      body.data.pinned,
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
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
    await hintThread(c, c.req.param('threadId'));
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/archive', async (c) => {
    const body = z
      .object({ archived: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const ok = await setThreadArchived(
      deps.sql,
      {
        organizationId,
        userId,
        email: c.get('sessionBundle').user.email,
      },
      c.req.param('threadId'),
      body.data.archived,
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
  });

  app.post('/threads/:threadId/share-project', async (c) => {
    const body = z
      .object({ shared: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    try {
      const ok = await setThreadSharedWithProject(
        deps.sql,
        {
          organizationId,
          userId,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('threadId'),
        body.data.shared,
      );
      if (ok) await hintThread(c, c.req.param('threadId'));
      return c.json({ ok });
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
    if (share === null) return c.json({ error: 'thread not found' }, 404);
    await hintThread(c, c.req.param('threadId'));
    return c.json(share);
  });

  // Works on a trashed thread too — revoking a link must never depend on
  // the conversation being visible.
  app.post('/threads/:threadId/unshare', async (c) => {
    const { organizationId, userId } = caller(c);
    const ok = await unshareThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
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
    if (branchId === null) {
      return c.json({ error: 'thread or message not found' }, 404);
    }
    await hintThread(c, branchId);
    return c.json({ id: branchId }, 201);
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
    if (branchId === null) {
      return c.json({ error: 'thread or message not found' }, 404);
    }
    await hintThread(c, branchId);
    return c.json({ id: branchId }, 201);
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
    if (branchId === null) {
      return c.json({ error: 'thread or message not found' }, 404);
    }
    await hintThread(c, branchId);
    return c.json({ id: branchId }, 201);
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
    await hintThread(c, c.req.param('threadId'));
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/trash', async (c) => {
    const { organizationId, userId } = caller(c);
    try {
      const ok = await trashThread(
        deps.sql,
        {
          organizationId,
          userId,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('threadId'),
      );
      if (ok) await hintThread(c, c.req.param('threadId'));
      return c.json({ ok });
    } catch (error) {
      return handleThreadError(c, error);
    }
  });

  app.post('/threads/:threadId/restore', async (c) => {
    const { organizationId, userId } = caller(c);
    const ok = await restoreThread(
      deps.sql,
      {
        organizationId,
        userId,
        email: c.get('sessionBundle').user.email,
      },
      c.req.param('threadId'),
    );
    if (ok) await hintThread(c, c.req.param('threadId'));
    return c.json({ ok });
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

  /** Org chat health (the metrics page; admin). */
  app.get('/health', async (c) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin role required' }, 403);
    }
    const periodRaw = Number(c.req.query('periodDays') ?? '7');
    const periodDays =
      periodRaw === 1
        ? (1 as const)
        : periodRaw === 30
          ? (30 as const)
          : (7 as const);
    return c.json(
      await getOrgChatHealth(deps.sql, c.get('orgId'), { periodDays }),
    );
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
        videoJobIds: z.array(z.string().min(1).max(128)).max(20).optional(),
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
      const enqueued = await enqueueDeferredSend(deps.sql, {
        organizationId,
        userId,
        threadId: c.req.param('threadId'),
        userText: body.data.text,
        ...(body.data.attachments !== undefined
          ? { attachments: body.data.attachments }
          : {}),
        ...(body.data.videoJobIds !== undefined &&
        body.data.videoJobIds.length > 0
          ? { videoJobIds: body.data.videoJobIds }
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
        ...(body.data.locale !== undefined ? { locale: body.data.locale } : {}),
      });
      // The claim releases the composer chips + stamps the row's set — an
      // unclaimable id (foreign, bound, cancelled) is dropped, 0.4 posture.
      if (
        body.data.videoJobIds !== undefined &&
        body.data.videoJobIds.length > 0
      ) {
        await claimDeferredSendVideos(deps.sql, {
          organizationId,
          userId,
          threadId: c.req.param('threadId'),
          deferredSendId: enqueued.deferredSendId,
          videoJobIds: body.data.videoJobIds,
        });
      }
      return c.json(enqueued, 201);
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
    // Owner, or a conversation its owner shared with a project the caller
    // can read (never write) — the 0.4 `listMessages` posture.
    let thread = await ownedThread(
      deps.sql,
      organizationId,
      userId,
      c.req.param('threadId'),
    );
    if (thread === null) {
      const shared = await loadProjectSharedThread(
        deps.sql,
        organizationId,
        userId,
        c.req.param('threadId'),
      );
      if (shared !== null) {
        thread = await threadViewById(deps.sql, organizationId, shared.id);
      }
    }
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

  /** The pending clarifying question for a thread (the 0.4
   * `getPendingQuestion` — owner-only; null clears the panel). */
  app.get('/threads/:threadId/question', async (c) => {
    const { organizationId, userId } = caller(c);
    const question = await getPendingQuestion(deps.sql, {
      organizationId,
      userId,
      threadId: c.req.param('threadId'),
    });
    return c.json({ question });
  });

  /** Close a pending question — answered or superseded; double-submits are
   * no-ops. */
  app.post('/questions/:requestId/resolve', async (c) => {
    const body = z
      .object({ outcome: z.enum(['answered', 'superseded']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    await resolveQuestion(deps.sql, {
      organizationId,
      userId,
      requestId: c.req.param('requestId'),
      outcome: body.data.outcome,
    });
    return c.json({ ok: true });
  });

  /** Create (or return) the arena pair for a conversation. */
  app.post('/threads/:threadId/arena/ensure', async (c) => {
    const { organizationId, userId } = caller(c);
    const result = await ensureArenaPair(deps.sql, {
      organizationId,
      userId,
      threadId: c.req.param('threadId'),
    });
    if (!('refused' in result)) {
      await hintThread(c, c.req.param('threadId'));
    }
    return c.json(result);
  });

  /** The live pair as seen from either column (null = not in a pair). */
  app.get('/threads/:threadId/arena', async (c) => {
    const { organizationId, userId } = caller(c);
    const pair = await getArenaPair(deps.sql, {
      organizationId,
      userId,
      threadId: c.req.param('threadId'),
    });
    return c.json({ pair });
  });

  /** Settle the pair — the verdict picks the surviving thread. */
  app.post('/threads/:threadId/arena/settle', async (c) => {
    const body = z
      .object({
        verdict: z.enum(['a_better', 'b_better', 'tie', 'both_bad']).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    const result = await settleArenaPair(deps.sql, {
      organizationId,
      userId,
      threadId: c.req.param('threadId'),
      ...(body.data.verdict !== undefined
        ? { verdict: body.data.verdict }
        : {}),
    });
    if (!('refused' in result)) {
      await hintThread(c, c.req.param('threadId'));
    }
    return c.json(result);
  });

  /** One prompt fanned into BOTH columns, each running the ordinary direct
   * turn with its own model (the 0.4 `startArenaTurn`). The two turns run
   * concurrently and are deliberately isolated: a failure on one side —
   * even before its pipeline starts — records an assistant error row on ITS
   * thread and leaves the other column streaming. */
  app.post('/threads/:threadId/arena/turn', async (c) => {
    const body = arenaTurnSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
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
    const pair = await getArenaPair(deps.sql, {
      organizationId,
      userId,
      threadId: thread.id,
    });
    if (pair === null) {
      return c.json(
        {
          code: 'not_found',
          error: 'This conversation is not in an arena pair.',
        },
        404,
      );
    }
    if (await isBackendDraining(deps.sql)) {
      return c.json(
        {
          status: 'refused',
          reason:
            'The backend is restarting for an upgrade — send again in a moment.',
        },
        503,
      );
    }
    // Busy-gates BOTH sides up front — a half-sent prompt would
    // desynchronize the comparison.
    if (
      (await hasLiveGeneration(deps.sql, organizationId, pair.threadIdA)) ||
      (await hasLiveGeneration(deps.sql, organizationId, pair.threadIdB))
    ) {
      const busy = { status: 'refused' as const, reason: THREAD_BUSY_REASON };
      return c.json({ a: busy, b: busy });
    }

    const shared = {
      organizationId,
      userId,
      userText: body.data.userText,
      ...(body.data.reasoningEffort !== undefined
        ? { reasoningEffort: body.data.reasoningEffort }
        : {}),
      locale: body.data.locale ?? 'en',
    };
    const runSide = async (side: {
      threadId: string;
      modelId: string;
      providerSlug?: string;
    }): Promise<{ status: 'completed' | 'refused'; reason?: string }> => {
      try {
        const outcome = await runChatTurn(deps.sql, {
          ...shared,
          threadId: side.threadId,
          modelId: side.modelId,
          ...(side.providerSlug !== undefined
            ? { providerSlug: side.providerSlug }
            : {}),
        });
        return outcome.status === 'completed'
          ? { status: 'completed' }
          : {
              status: 'refused',
              ...(outcome.reason !== undefined
                ? { reason: outcome.reason }
                : {}),
            };
      } catch (err) {
        // Lost the column's claim to a send that slipped past the busy read
        // above: the open rolled back and the other turn owns the thread —
        // an error row now would land in ITS transcript.
        if (err instanceof ThreadBusyError) {
          return { status: 'refused', reason: err.message };
        }
        // A pre-pipeline throw (model resolution, credential) left nothing
        // in the transcript — write the error row here so the column
        // explains itself instead of sitting silently half-empty.
        const reason = sanitizeError(err);
        try {
          await appendMessageRow(deps.sql, {
            organizationId,
            threadId: side.threadId,
            role: 'assistant',
            parts: [],
            model: side.modelId,
            error: encodeChatError({
              code: classifyChatErrorCode(err),
              model: side.modelId,
              raw: reason,
            }),
          });
        } catch (writeErr) {
          console.error('[arena] could not record side failure', writeErr);
        }
        return { status: 'refused', reason };
      }
    };
    const [a, b] = await Promise.all([
      runSide({
        threadId: pair.threadIdA,
        modelId: body.data.modelIdA,
        ...(body.data.providerSlugA !== undefined
          ? { providerSlug: body.data.providerSlugA }
          : {}),
      }),
      runSide({
        threadId: pair.threadIdB,
        modelId: body.data.modelIdB,
        ...(body.data.providerSlugB !== undefined
          ? { providerSlug: body.data.providerSlugB }
          : {}),
      }),
    ]);
    return c.json({ a, b });
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
    // Deploy drain: refuse NEW turns so the client retries onto the
    // restarted backend (nothing is appended — the send is safe to repeat).
    if (await isBackendDraining(deps.sql)) {
      return c.json(
        {
          status: 'refused',
          reason:
            'The backend is restarting for an upgrade — send again in a moment.',
        },
        503,
      );
    }
    // At most one turn per thread. This read is the fast path that spares a
    // busy thread the model resolution; the GUARD is the turn's own atomic
    // open (`beginTurn` claims the generation row and rejects a loser with
    // ThreadBusyError), so two sends racing through this check cannot both
    // run and delete each other's row.
    const live = await readGeneration(deps.sql, organizationId, thread.id);
    if (live !== null) {
      return c.json({ status: 'refused', reason: THREAD_BUSY_REASON }, 409);
    }
    let outcome;
    try {
      outcome = await runChatTurn(deps.sql, {
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
    } catch (error) {
      // The claim loser of two racing sends: nothing was appended, the
      // other turn streams on — the same refusal the fast path gives.
      if (error instanceof ThreadBusyError) {
        return c.json({ status: 'refused', reason: error.message }, 409);
      }
      // A turn that could not START because the picked model is not
      // servable — its provider's default credential was disabled or
      // deleted, or the composer still holds a model the picker has since
      // dropped — is a refusal the composer can show, not an internal error.
      const reason = servingRefusalReason(error);
      if (reason === null) throw error;
      return c.json({ status: 'refused', reason });
    }
    return outcome.status === 'completed'
      ? c.json({ status: 'completed' })
      : c.json({ status: 'refused', reason: outcome.reason });
  });

  // First-token UX metric: stamp the perceived wait ON the message's usage
  // blob, once (the 0.4 `reportPerceivedWait` — owner-only, assistant rows).
  app.post('/messages/:messageId/perceived-wait', async (c) => {
    const body = z
      .object({ perceivedWaitMs: z.number().finite().positive().max(600_000) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { organizationId, userId } = caller(c);
    await deps.sql`
      UPDATE app.messages m
      SET usage = coalesce(m.usage, '{}'::jsonb)
        -- jsonb_build_object takes "any", so an uncast parameter leaves
        -- Postgres nothing to infer from and the statement fails to PARSE
        -- (42P18) — every report was dropped before it ran.
        || jsonb_build_object(
          'perceivedWaitMs', ${body.data.perceivedWaitMs}::numeric
        )
      FROM app.threads t
      WHERE m.id = ${c.req.param('messageId')}
        AND m.org_id = ${organizationId}
        AND m.role = 'assistant'
        AND t.id = m.thread_id AND t.user_id = ${userId}
        AND (m.usage IS NULL OR NOT (m.usage ? 'perceivedWaitMs'))
    `;
    return c.json({ ok: true });
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
      let lastSentParts: string | null = null;
      let lastMessageId: string | null = null;
      let generating = false;
      let lastBeatAt = Date.now();
      // Resolve the client's initial state IMMEDIATELY: an idle thread must
      // not wait a heartbeat interval to learn nothing is running (the send
      // affordance keys off this), and a live one paints on arrival.
      try {
        const initial = await readGeneration(
          deps.sql,
          organizationId,
          thread.id,
        );
        if (initial === null) {
          await stream.writeSSE({ event: 'idle', data: '' });
          lastBeatAt = Date.now();
        }
        // A live row falls through: the loop's first pass ships `progress`.
      } catch (error) {
        console.warn('[chat] stream initial probe failed:', error);
      }
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
              // Parts ride along only when they CHANGED. Text ticks at the
              // store's throttle while a tool result can be large (a RAG
              // page), so resending an unchanged array four times a second
              // would pay for the trace over and over. The client keeps the
              // last one it saw.
              let parts: unknown[] | null = null;
              if (generation.messageId != null) {
                const live = await readLiveParts(
                  deps.sql,
                  organizationId,
                  generation.messageId,
                );
                const serialized = live === null ? null : JSON.stringify(live);
                if (serialized !== null && serialized !== lastSentParts) {
                  lastSentParts = serialized;
                  parts = live;
                }
              }
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  messageId: generation.messageId,
                  text: generation.text,
                  reasoning: generation.reasoning,
                  cancelRequested: generation.cancelRequested,
                  ...(parts !== null ? { parts } : {}),
                  serverNow: Date.now(),
                }),
              });
              lastBeatAt = Date.now();
            }
          } else if (generating) {
            // The row's absence is the settle signal — ship the final row.
            generating = false;
            lastSeenUpdate = 0;
            lastSentParts = null;
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
