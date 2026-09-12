import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { EFFORT_LEVELS } from '../../../lib/chat/effort.ts';
import {
  classifyChatErrorCode,
  describeChatError,
  encodeChatError,
} from '../../../lib/shared/chat-errors.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { isBackendDraining } from '../control/service.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { runChatTurn } from './service.ts';
import {
  appendAssistantErrorMessage,
  appendMessageRow,
  assertThreadWriteScope,
} from './store.ts';
import {
  ChatThreadError,
  loadOwnedThread,
  projectChatAccess,
} from './threads.ts';

/**
 * The REST message turn — the 0.5 twin of 0.4's `startTurnForApiKey`:
 * The scoped or unfiled REST messages route answers 202 and enqueues this, so
 * the caller never holds a connection open for a minutes-long stream. The
 * job re-runs the owned-thread and busy gates (it executes detached from
 * the accept), then drives the SAME `runChatTurn` the deferred-send lane
 * uses. A thrown start lands as an assistant error row — a silently
 * swallowed 202 would read as "the model never answered".
 */
export interface ApiTurnPayload {
  organizationId: string;
  userId: string;
  threadId: string;
  /** The URL scope accepted by REST; null means an unfiled thread. */
  expectedProjectId: string | null;
  userText: string;
  modelId: string;
  providerSlug?: string;
  /** The named provider is a choice the turn must keep — no fallback to
   * another connector, whatever the configuration does between the 202
   * and the run. */
  providerStrict?: boolean;
  /** The assistant message id the 202 named: the turn's placeholder (or its
   * failure row) lands under it, so a caller that lost the response can
   * find its reply. Absent only for a job an older image enqueued. */
  assistantMessageId?: string;
  reasoningEffort?: (typeof EFFORT_LEVELS)[number];
  /** The caller's reply ceiling, already checked against the model's own. */
  maxOutputTokens?: number;
  locale?: string;
}

/**
 * The payload as the job handler parses it — every field the door sends,
 * so nothing is silently stripped on the way to the turn (`providerStrict`
 * used to be: the strict provider choice the 202 promised never reached the
 * run, and the turn fell back to another connector).
 */
export const apiTurnPayloadSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  threadId: z.string().min(1),
  expectedProjectId: z.string().min(1).nullable(),
  userText: z.string().min(1),
  modelId: z.string().min(1),
  providerSlug: z.string().min(1).optional(),
  providerStrict: z.boolean().optional(),
  assistantMessageId: z.string().min(1).optional(),
  reasoningEffort: z.enum(EFFORT_LEVELS).optional(),
  maxOutputTokens: z.number().int().min(1).optional(),
  locale: z.string().min(1).optional(),
});

/**
 * The accepted send is no longer waiting for a worker: the 202's `queued`
 * marker ends here. Set at the 202 (with the placeholder's id as
 * `stream_id`), cleared by the turn-open write when the run starts, and by
 * every path on which the job ends WITHOUT opening a turn — otherwise the
 * poll would answer `queued` forever for a send that will never run.
 *
 * Only THIS job's marker: the send that follows a settled turn can claim
 * the thread between the turn's close and this clear, and its marker
 * carries its own reply id — clearing that one would answer `idle` to a
 * poller whose send is queued. A job an older image enqueued without the
 * id keeps the unscoped clear.
 */
export async function clearQueuedTurn(
  sql: Sql,
  threadId: string,
  streamId?: string,
): Promise<void> {
  const own = streamId ?? null;
  await sql`
    UPDATE app.thread_metadata SET
      generation_queued_since_ms = NULL,
      stream_id = CASE WHEN generation_status = 'generating' THEN stream_id ELSE NULL END
    WHERE thread_id = ${threadId} AND generation_queued_since_ms IS NOT NULL
      AND (${own}::text IS NULL OR stream_id = ${own})
  `;
}

export async function runApiTurn(
  sql: Sql,
  payload: ApiTurnPayload,
): Promise<void> {
  // Deploy drain: hand the accepted message to a FRESH job past the window
  // instead of erroring it — the new `created` job survives the restart, so
  // the 202 promise is kept (and so is its `queued` marker).
  if (await isBackendDraining(sql)) {
    await addJobInTx(sql, 'chat.api_turn', payload, {
      startAfter: new Date(Date.now() + 5_000),
    });
    return;
  }
  try {
    await runAcceptedTurn(sql, payload);
  } finally {
    await clearQueuedTurn(sql, payload.threadId, payload.assistantMessageId);
  }
}

async function runAcceptedTurn(
  sql: Sql,
  payload: ApiTurnPayload,
): Promise<void> {
  const thread = await loadOwnedThread(
    sql,
    payload.organizationId,
    payload.userId,
    payload.threadId,
  );
  if (
    thread === null ||
    thread.projectId !== payload.expectedProjectId ||
    thread.kind !== 'direct' ||
    thread.archived
  )
    return;
  // A queued send cannot follow an app-side move into another project, or
  // keep running after project access was revoked or the project archived.
  // Only readable membership is needed here, just as on the accepting URL.
  if (payload.expectedProjectId !== null) {
    const access = await projectChatAccess(sql, {
      organizationId: payload.organizationId,
      userId: payload.userId,
      projectId: payload.expectedProjectId,
    });
    if (access !== 'ok') return;
    const project = await loadProjectOrThrow(sql, payload.expectedProjectId);
    if (project.archivedAt !== null) return;
  }
  const recordFailure = async (error: string, includeUserMessage: boolean) => {
    try {
      await transactSerializable(sql, async (tx) => {
        await assertThreadWriteScope(tx, {
          organizationId: payload.organizationId,
          userId: payload.userId,
          threadId: payload.threadId,
          projectId: payload.expectedProjectId,
        });
        if (includeUserMessage) {
          await appendMessageRow(tx, {
            organizationId: payload.organizationId,
            threadId: payload.threadId,
            role: 'user',
            parts: [{ type: 'text', text: payload.userText }],
            text: payload.userText,
          });
        }
        await appendAssistantErrorMessage(tx, {
          ...(payload.assistantMessageId !== undefined
            ? { id: payload.assistantMessageId }
            : {}),
          organizationId: payload.organizationId,
          threadId: payload.threadId,
          model: payload.modelId,
          error,
        });
      });
    } catch (writeError) {
      if (
        writeError instanceof ChatThreadError &&
        writeError.code === 'THREAD_SCOPE_CHANGED'
      )
        return;
      throw writeError;
    }
  };
  const generating = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE thread_id = ${payload.threadId} LIMIT 1
  `;
  if (generating.length > 0) {
    // The accepted prompt lands beside the refusal: the caller's text is
    // the only copy, and a busy verdict must not make it vanish. The code
    // names the fact (`thread_busy`), not the generic bucket.
    console.warn(
      `[rest-turn] thread ${payload.threadId} busy — accepted message recorded, no turn run`,
    );
    await recordFailure(
      encodeChatError({
        code: 'thread_busy',
        model: payload.modelId,
        raw: 'This conversation was already generating a response.',
      }),
      true,
    );
    return;
  }
  // Whether the turn got as far as persisting the caller's message: a
  // refusal BEFORE that point (an unknown model, say) used to leave the
  // thread with an assistant error row and no trace of what was asked.
  let userAppended = false;
  try {
    const outcome = await runChatTurn(sql, {
      organizationId: payload.organizationId,
      userId: payload.userId,
      threadId: payload.threadId,
      expectedProjectId: payload.expectedProjectId,
      userText: payload.userText,
      modelId: payload.modelId,
      ...(payload.providerSlug !== undefined
        ? { providerSlug: payload.providerSlug }
        : {}),
      ...(payload.providerStrict === true ? { providerStrict: true } : {}),
      ...(payload.assistantMessageId !== undefined
        ? { placeholderId: payload.assistantMessageId }
        : {}),
      ...(payload.reasoningEffort !== undefined
        ? { reasoningEffort: payload.reasoningEffort }
        : {}),
      ...(payload.maxOutputTokens !== undefined
        ? { maxOutputTokens: payload.maxOutputTokens }
        : {}),
      locale: payload.locale ?? 'en',
      onUserMessageAppended: async () => {
        userAppended = true;
      },
    });
    if (outcome.status === 'refused') {
      console.warn(
        `[rest-turn] turn refused for ${payload.threadId}: ${outcome.reason}`,
      );
    }
  } catch (error) {
    if (
      error instanceof ChatThreadError &&
      error.code === 'THREAD_SCOPE_CHANGED'
    )
      return;
    // A ThreadBusyError here is the busy gate above lost to a send that
    // slipped in between the read and the turn's atomic open — the same
    // fact, answered the same way: the caller sees why their message never
    // got a reply. (The open rolled back; the other turn is untouched.)
    // The sentence is the refusal's own (`data.message` for a platform
    // AppError), never its serialized payload.
    const reason = describeChatError(error, 'The turn could not be started.');
    console.warn(`[rest-turn] turn threw for ${payload.threadId}: ${reason}`);
    await recordFailure(
      encodeChatError({
        code: classifyChatErrorCode(error),
        model: payload.modelId,
        raw: reason,
      }),
      !userAppended,
    );
  }
}
