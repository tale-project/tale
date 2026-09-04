import type { Sql } from 'postgres';

import {
  classifyChatErrorCode,
  encodeChatError,
} from '../../../lib/shared/chat-errors.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { isBackendDraining } from '../control/service.ts';
import { runChatTurn } from './service.ts';
import { appendAssistantErrorMessage } from './store.ts';
import { loadOwnedThread } from './threads.ts';

/**
 * The REST message turn — the 0.5 twin of 0.4's `startTurnForApiKey`:
 * `POST /api/v1/threads/{id}/messages` answers 202 and enqueues this, so
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
  userText: string;
  modelId: string;
  providerSlug?: string;
  locale?: string;
}

export async function runApiTurn(
  sql: Sql,
  payload: ApiTurnPayload,
): Promise<void> {
  // Deploy drain: hand the accepted message to a FRESH job past the window
  // instead of erroring it — the new `created` job survives the restart, so
  // the 202 promise is kept.
  if (await isBackendDraining(sql)) {
    await addJobInTx(sql, 'chat.api_turn', payload, {
      startAfter: new Date(Date.now() + 5_000),
    });
    return;
  }
  const thread = await loadOwnedThread(
    sql,
    payload.organizationId,
    payload.userId,
    payload.threadId,
  );
  if (thread === null) return;
  const generating = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE thread_id = ${payload.threadId} LIMIT 1
  `;
  if (generating.length > 0) {
    console.warn(
      `[rest-turn] thread ${payload.threadId} busy — accepted message dropped`,
    );
    await appendAssistantErrorMessage(sql, {
      organizationId: payload.organizationId,
      threadId: payload.threadId,
      model: payload.modelId,
      error: encodeChatError({
        code: 'generic',
        model: payload.modelId,
        raw: 'This conversation was already generating a response.',
      }),
    });
    return;
  }
  try {
    const outcome = await runChatTurn(sql, {
      organizationId: payload.organizationId,
      userId: payload.userId,
      threadId: payload.threadId,
      userText: payload.userText,
      modelId: payload.modelId,
      ...(payload.providerSlug !== undefined
        ? { providerSlug: payload.providerSlug }
        : {}),
      locale: payload.locale ?? 'en',
    });
    if (outcome.status === 'refused') {
      console.warn(
        `[rest-turn] turn refused for ${payload.threadId}: ${outcome.reason}`,
      );
    }
  } catch (error) {
    // A ThreadBusyError here is the busy gate above lost to a send that
    // slipped in between the read and the turn's atomic open — the same
    // fact, answered the same way: the caller sees why their message never
    // got a reply. (The open rolled back; the other turn is untouched.)
    const reason =
      error instanceof Error ? error.message : 'The turn could not be started.';
    console.warn(`[rest-turn] turn threw for ${payload.threadId}: ${reason}`);
    await appendAssistantErrorMessage(sql, {
      organizationId: payload.organizationId,
      threadId: payload.threadId,
      model: payload.modelId,
      error: encodeChatError({
        code: classifyChatErrorCode(error),
        model: payload.modelId,
        raw: reason,
      }),
    });
  }
}
