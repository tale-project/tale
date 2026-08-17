/**
 * Chat REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/threads                      — List the key holder's threads
 *   POST   /api/v1/threads                      — Start a thread
 *   GET    /api/v1/threads/:id                  — One thread
 *   GET    /api/v1/threads/:id/messages         — The conversation (paginated)
 *   POST   /api/v1/threads/:id/messages         — Send a message, start a turn (202)
 *   GET    /api/v1/threads/:id/generation       — Poll the in-flight turn
 *
 * ## Whose conversation
 *
 * A thread is USER-private, not org-shared: the API key resolves to one user,
 * and these endpoints see exactly that user's threads. The ownership check is
 * the `(organizationId, userId)` pair every read in `rest_support.ts` walks, so
 * another member's thread — and every other organization's — reads as absent.
 *
 * ## Why a turn answers 202
 *
 * A direct turn streams for as long as the model takes (up to three minutes),
 * which is not a request a client should hold open. `POST .../messages`
 * validates, refuses the cases it can see (no such thread, already generating),
 * schedules the turn, and answers 202. The caller then polls
 * `GET .../generation` until it reads `idle` and reads the reply from
 * `GET .../messages` — the same two facts the app's subscriptions consume.
 *
 * Only the DIRECT lane runs here: a sandbox (external-agent) thread is started
 * and stopped by its own action, and there is no direct-lane stop, so this
 * surface deliberately has no stop endpoint rather than a broken one.
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonAccepted,
  jsonCreated,
  jsonError,
  jsonOk,
  optionalString,
  parsePageLimit,
  readJsonObject,
  readJsonObjectOrEmpty,
  requiredString,
  withRestAuth,
} from '../lib/rest/helpers';

const PREFIX = '/api/v1/threads/';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Ceilings on what a REST caller may put in a thread's metadata. Generous
 * guards, not product limits — the same spirit as the composer's own. */
const MAX_TITLE = 200;
const MAX_SLUG = 200;
const MAX_MESSAGE = 100_000;

export const listThreads = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const result = await rc.ctx.runQuery(
    internal.chat.rest_support.restListThreads,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      cursor: url.searchParams.get('cursor') ?? null,
      limit: parsePageLimit(url, DEFAULT_LIMIT, MAX_LIMIT),
    },
  );
  return jsonOk(result);
});

/**
 * Start a thread. REST creates DIRECT threads: a sandbox thread needs a harness
 * and a session this surface cannot drive, so it is not creatable here.
 */
export const createThread = withRestAuth('rest:api', async (rc, request) => {
  const body = await readJsonObjectOrEmpty(request);
  const title = optionalString(body, 'title', MAX_TITLE);
  const projectId = optionalString(body, 'projectId', 100);

  const threadId = await rc.ctx.runMutation(
    internal.chat.rest_support.restCreateThread,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      kind: 'direct',
      ...(title !== undefined && { title }),
      ...(projectId !== undefined && { projectId }),
    },
  );
  return jsonCreated({ id: threadId });
});

/** Every read that hangs off one thread. */
export const threadReads = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing thread ID', 400);

  if (subPath === null) {
    const thread = await rc.ctx.runQuery(
      internal.chat.rest_support.restGetThread,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
      },
    );
    if (!thread) return jsonError('Thread not found', 404);
    return jsonOk(thread);
  }

  if (subPath === 'messages') {
    const result = await rc.ctx.runQuery(
      internal.chat.rest_support.restListMessages,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
        cursor: url.searchParams.get('cursor') ?? null,
        limit: parsePageLimit(url, DEFAULT_LIMIT, MAX_LIMIT),
      },
    );
    if (result === null) return jsonError('Thread not found', 404);
    return jsonOk(result);
  }

  if (subPath === 'generation') {
    // The generation row exists only while a turn is in flight, so ABSENCE
    // means the thread is idle — the turn is done (or never started) and the
    // reply, if any, is in the messages. A thread that is not the caller's is
    // refused rather than reported idle.
    const thread = await rc.ctx.runQuery(
      internal.chat.rest_support.restGetThread,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
      },
    );
    if (!thread) return jsonError('Thread not found', 404);
    const generation = await rc.ctx.runQuery(
      internal.chat.rest_support.restGetGeneration,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
      },
    );
    return jsonOk(generation ?? { status: 'idle' });
  }

  return jsonError(`Unknown sub-resource: ${subPath}`, 404);
});

/**
 * Send a message and start the turn that answers it.
 *
 * The model is ALWAYS explicit on this surface — the API never auto-selects
 * one — so a request without `model` is a 400 rather than a guess. The chat
 * composer's Auto is a UI affordance of the session lane; it has no wire
 * form here on purpose (a script that wants routing can decide for itself).
 */
export const threadPostActions = withRestAuth(
  'rest:execute',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing thread ID', 400);
    if (subPath !== 'messages') {
      return jsonError(`Unknown action: ${subPath ?? ''}`, 404);
    }

    const body = await readJsonObject(request);
    const content = requiredString(body, 'content', MAX_MESSAGE);
    const model = requiredString(body, 'model', MAX_SLUG);
    const locale = optionalString(body, 'locale', 20);

    const thread = await rc.ctx.runQuery(
      internal.chat.rest_support.restGetThread,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
      },
    );
    if (!thread) return jsonError('Thread not found', 404);
    if (thread.kind !== 'direct') {
      return jsonError(
        'This conversation runs a harness in a sandbox; it cannot be driven through the REST API.',
        409,
      );
    }
    // At most one turn per thread — refuse a concurrent send rather than let
    // two turns interleave and delete each other's generation row mid-stream.
    // The scheduled action re-checks this, since it runs detached from here.
    if (thread.generating) {
      return jsonError(
        'This conversation is already generating a response.',
        409,
      );
    }

    await rc.ctx.scheduler.runAfter(
      0,
      internal.chat.turn_action.startTurnForApiKey,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        threadId: id,
        userText: content,
        modelId: model,
        ...(locale !== undefined && { locale }),
      },
    );

    return jsonAccepted({
      threadId: thread.id,
      status: 'accepted',
      model,
      poll: `/api/v1/threads/${thread.id}/generation`,
    });
  },
);
