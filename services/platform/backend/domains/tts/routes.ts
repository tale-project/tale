import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { resolveTtsModel } from '../../core/lib/providers/resolve_tts_model.ts';
import { errorCodeFromCaught } from '../../core/tts/error_codes.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import {
  locateOrgObjectStore,
  s3PresignGetUrl,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  rateLimitExceededCause,
  rateLimitedResponse,
} from '../../lib/rate-limit-response.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { loadOwnedThread } from '../chat/threads.ts';
import {
  getChunkForServe,
  getMessageChunks,
  getVoiceModeEffective,
  setThreadVoiceOutputOverride,
  setUserVoiceOutput,
  synthesizeChunk,
  TtsError,
} from './service.ts';

/**
 * /api/app/tts — the voice-output surface: the per-chunk synthesis door,
 * chunk listing for the player, the effective voice-mode cascade, the two
 * preference writers, the capability probe, and the AUDIO SERVE route
 * (cookie-bound and non-replayable by design: the backend streams the
 * bytes itself — a presigned URL handed to the client would be
 * bearer-replayable for its lifetime, the exact property 0.4 removed).
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  // A spent budget answers the one 429 every door speaks — the service
  // wraps the limiter's refusal as a coded TtsError and carries it as cause.
  const limited = rateLimitExceededCause(error);
  if (limited !== null) {
    return rateLimitedResponse(c, limited);
  }
  if (error instanceof TtsError) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
      },
      error.status,
    );
  }
  throw error;
}

export function createTtsRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  app.post('/synthesize', async (c) => {
    const body = z
      .object({
        messageId: z.string().min(1).max(128),
        threadId: z.string().min(1).max(128),
        index: z.number().int().nonnegative(),
        text: z.string().min(1).max(10_000),
        locale: z.string().min(1).max(35),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const result = await synthesizeChunk(deps.sql, {
        ...caller(c),
        messageId: body.data.messageId,
        threadId: body.data.threadId,
        index: body.data.index,
        text: body.data.text,
        locale: body.data.locale,
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/messages/:messageId/chunks', async (c) => {
    const threadId = c.req.query('threadId') ?? '';
    if (threadId === '') return c.json({ error: 'threadId required' }, 400);
    const chunks = await getMessageChunks(deps.sql, {
      ...caller(c),
      messageId: c.req.param('messageId'),
      threadId,
    });
    return c.json({ chunks });
  });

  // The info dialog's per-message voice spend (the 0.4 shape). Same gate as
  // the listing and the audio door: the caller must own the thread.
  app.get('/messages/:messageId/usage', async (c) => {
    const threadId = c.req.query('threadId') ?? '';
    if (threadId === '') return c.json({ error: 'threadId required' }, 400);
    const { organizationId, userId } = caller(c);
    const thread = await loadOwnedThread(
      deps.sql,
      organizationId,
      userId,
      threadId,
    );
    if (!thread) return c.json(null);
    const rows = await deps.sql<
      {
        provider: string;
        model: string;
        voice: string | null;
        characters: number;
        costCents: number;
        chunkCount: number;
      }[]
    >`
      SELECT c.provider_name AS provider, c.model_id AS model, c.voice,
             sum(c.character_count)::float8 AS characters,
             sum(coalesce(c.cost_estimate_cents, 0))::float8 AS "costCents",
             count(*)::float8 AS "chunkCount"
      FROM app.tts_audio_chunks c
      WHERE c.message_id = ${c.req.param('messageId')}
        AND c.thread_id = ${threadId}
        AND c.org_id = ${organizationId}
        AND c.status = 'ready'
      GROUP BY c.provider_name, c.model_id, c.voice
    `;
    if (rows.length === 0) return c.json(null);
    const breakdown = rows.map((row) =>
      Object.assign(
        {
          provider: row.provider,
          model: row.model,
          characters: row.characters,
          costCents: row.costCents,
          chunkCount: row.chunkCount,
        },
        row.voice !== null ? { voice: row.voice } : {},
      ),
    );
    return c.json({
      totalCharacters: breakdown.reduce((sum, b) => sum + b.characters, 0),
      totalCostCents: breakdown.reduce((sum, b) => sum + b.costCents, 0),
      chunkCount: breakdown.reduce((sum, b) => sum + b.chunkCount, 0),
      breakdown,
    });
  });

  app.get('/voice-mode', async (c) => {
    const threadId = c.req.query('threadId');
    return c.json(
      await getVoiceModeEffective(deps.sql, {
        ...caller(c),
        ...(threadId !== undefined ? { threadId } : {}),
      }),
    );
  });

  app.post('/voice-output', async (c) => {
    const body = z
      .object({ enabled: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await setUserVoiceOutput(deps.sql, {
      ...caller(c),
      enabled: body.data.enabled,
    });
    return c.json({ ok: true });
  });

  app.post('/threads/:threadId/voice-override', async (c) => {
    const body = z
      .object({ override: z.boolean().nullable() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await setThreadVoiceOutputOverride(deps.sql, {
        ...caller(c),
        threadId: c.req.param('threadId'),
        override: body.data.override,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** The provider probe: can this org synthesize at all? */
  app.get('/capability', async (c) => {
    const shim = createCtxShim(chatShimHandlers(deps.sql));
    try {
      const model = await resolveTtsModel(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 resolver on the chat shim
        shim as unknown as Parameters<typeof resolveTtsModel>[0],
        {
          organizationId: c.get('orgId'),
          locale: c.req.query('locale') ?? 'en',
        },
      );
      return c.json({
        available: true,
        providerName: model.providerName,
        modelId: model.modelId,
        voice: model.voice,
      });
    } catch (error) {
      const { code } = errorCodeFromCaught(error);
      return c.json({ available: false, errorCode: code });
    }
  });

  /** Stream one ready chunk's audio. The gate is ownership of the chunk's
   * thread (the same `loadOwnedThread` the listing and usage doors use); the
   * bytes are fetched server-side so no replayable URL ever reaches the
   * client. */
  app.get('/audio/:chunkId', async (c) => {
    const chunk = await getChunkForServe(deps.sql, {
      ...caller(c),
      chunkId: c.req.param('chunkId'),
    });
    if (!chunk) return c.json({ error: 'not found' }, 404);
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (!orgSlug) return c.json({ error: 'not found' }, 404);
    try {
      const key = chunk.storageRef.startsWith('s3:')
        ? chunk.storageRef.slice(3)
        : chunk.storageRef;
      // A chunk synthesized before the org connected its own bucket still
      // lives in the deployment default store until the backfill moves it.
      const store = await locateOrgObjectStore(orgSlug, key);
      const url = await s3PresignGetUrl(store, key);
      const upstream = await fetch(url);
      if (!upstream.ok || upstream.body === null) {
        return c.json({ error: 'audio unavailable' }, 502);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'content-type': chunk.contentType,
          'cache-control': 'private, max-age=3600',
        },
      });
    } catch (error) {
      console.warn('[tts] audio serve failed', error);
      return c.json({ error: 'audio unavailable' }, 502);
    }
  });

  return app;
}
