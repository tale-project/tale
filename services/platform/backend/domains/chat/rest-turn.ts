import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

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
    console.warn(
      `[rest-turn] thread ${payload.threadId} busy — accepted message dropped`,
    );
    await recordFailure(
      encodeChatError({
        code: 'generic',
        model: payload.modelId,
        raw: 'This conversation was already generating a response.',
      }),
      false,
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
