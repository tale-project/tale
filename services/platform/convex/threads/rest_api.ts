/**
 * Threads REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/threads              — List threads (paginated)
 *   POST   /api/v1/threads              — Create thread
 *   GET    /api/v1/threads/:id          — Get thread status
 *   GET    /api/v1/threads/:id/messages — Get thread messages
 *   PATCH  /api/v1/threads/:id          — Update thread title
 *   DELETE /api/v1/threads/:id          — Delete thread
 *   POST   /api/v1/threads/:id/archive  — Archive thread
 *   POST   /api/v1/threads/:id/unarchive — Unarchive thread
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parseIntParam,
  withRestAuth,
} from '../lib/rest/helpers';

const PREFIX = '/api/v1/threads/';

export const listThreads = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parseIntParam(url, 'limit', 25);
  const archived = url.searchParams.get('archived') === 'true';

  if (archived) {
    const result = await rc.ctx.runQuery(
      internal.threads.internal_queries.listArchivedThreadsInternal,
      {
        userId: rc.user.userId,
        paginationOpts: { numItems: limit, cursor },
      },
    );
    return jsonOk(result);
  }

  const result = await rc.ctx.runQuery(
    internal.threads.internal_queries.listThreadsInternal,
    {
      userId: rc.user.userId,
      paginationOpts: { numItems: limit, cursor },
    },
  );
  return jsonOk(result);
});

export const createThread = withRestAuth('rest:api', async (rc, request) => {
  const body = await request.json();

  const threadId = await rc.ctx.runMutation(
    internal.threads.internal_mutations.createChatThreadInternal,
    {
      userId: rc.user.userId,
      title: body.title,
    },
  );

  return jsonCreated({ id: threadId });
});

export const getThread = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing thread ID', 400);
  }

  // GET /api/v1/threads/:id/messages
  if (subPath === 'messages') {
    const result = await rc.ctx.runQuery(
      internal.threads.internal_queries.getThreadMessagesInternal,
      { threadId: id, callerOrgId: rc.org.organizationId },
    );
    return jsonOk(result);
  }

  if (subPath) {
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);
  }

  // GET /api/v1/threads/:id — thread metadata
  const thread = await rc.ctx.runQuery(
    internal.threads.internal_queries.getThreadMetadata,
    { threadId: id, callerOrgId: rc.org.organizationId },
  );

  if (!thread) {
    return jsonError('Thread not found', 404);
  }

  return jsonOk(thread);
});

export const patchThread = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing thread ID', 400);
  }

  const body = await request.json();

  if (!body.title || typeof body.title !== 'string') {
    return jsonError('Missing or invalid title', 400);
  }

  await rc.ctx.runMutation(
    internal.threads.internal_mutations.updateChatThreadInternal,
    {
      threadId: id,
      title: body.title,
      callerUserId: rc.user.userId,
      callerOrgId: rc.org.organizationId,
    },
  );

  return jsonNoContent();
});

export const deleteThread = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing thread ID', 400);
  }

  await rc.ctx.runMutation(
    internal.threads.internal_mutations.deleteChatThreadInternal,
    {
      threadId: id,
      callerUserId: rc.user.userId,
      callerOrgId: rc.org.organizationId,
    },
  );

  return jsonNoContent();
});

export const threadPostActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing thread ID', 400);
    }

    if (subPath === 'archive') {
      await rc.ctx.runMutation(
        internal.threads.internal_mutations.archiveChatThreadInternal,
        {
          threadId: id,
          callerUserId: rc.user.userId,
          callerOrgId: rc.org.organizationId,
        },
      );
      return jsonOk({ status: 'archived' });
    }

    if (subPath === 'unarchive') {
      await rc.ctx.runMutation(
        internal.threads.internal_mutations.unarchiveChatThreadInternal,
        {
          threadId: id,
          callerUserId: rc.user.userId,
          callerOrgId: rc.org.organizationId,
        },
      );
      return jsonOk({ status: 'active' });
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
