'use node';

/**
 * Per-invocation bindings of the platform-native capability stores — the
 * task and document domains as the `task.*` / `document.*` connectors reach
 * them. The same posture as `webdavStore`: every call goes through the
 * domain's own internal functions, so actor attribution, the task-ops
 * invariants, and org scoping stay exactly where they live today; nothing
 * here opens a second route to org data.
 */

import type { WorkflowConversationStore } from '../../lib/connectors/natives/platform-conversations';
import type { WorkflowDocumentStore } from '../../lib/connectors/natives/platform-documents';
import type { WorkflowTaskStore } from '../../lib/connectors/natives/platform-tasks';
import { extractExtension } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  ingestEmails,
  ingestSentEmails,
  listMailboxMessages,
  querySyncCursor,
  syncMailbox,
} from '../conversations/sync_mailbox';

/**
 * The task-domain sentinel for automation-engine writes
 * (`internal_mutations.ts` attribution doc): event subscribers use it to tell
 * the engine apart from humans and agents — the task-ops loop-prevention
 * vocabulary.
 */
const WORKFLOW_ACTOR_ID = 'workflow';

export function workflowTaskStore(ctx: ActionCtx): WorkflowTaskStore {
  const taskId = (raw: string): Id<'tasks'> =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id is data from the run's own scope; a wrong id reads as null and refuses
    raw as Id<'tasks'>;
  return {
    async get({ organizationId, taskId: raw }) {
      const task = await ctx.runQuery(
        internal.tasks.internal_queries.getTaskByIdInternal,
        { organizationId, taskId: taskId(raw) },
      );
      if (task === null) return null;
      return {
        taskId: String(task._id),
        title: task.title,
        status: task.status,
        projectId: String(task.projectId),
        ...(task.externalSystem !== undefined
          ? { externalSystem: task.externalSystem }
          : {}),
        ...(task.externalId !== undefined
          ? { externalId: task.externalId }
          : {}),
        ...(task.externalUrl !== undefined
          ? { externalUrl: task.externalUrl }
          : {}),
      };
    },
    async updateStatus({ organizationId, taskId: raw, status }) {
      // Deliberately NO review mint on a workflow-lane `in_review` park (the
      // task-agent settle mints, keyed by its runId) — automation desks keep
      // the subject-panel review protocol for now.
      return await ctx.runMutation(
        internal.tasks.internal_mutations.agentUpdateTaskStatus,
        {
          organizationId,
          actorId: WORKFLOW_ACTOR_ID,
          taskId: taskId(raw),
          status,
        },
      );
    },
    async comment({ organizationId, taskId: raw, body, bodyByLocale }) {
      const posted = await ctx.runMutation(
        internal.tasks.internal_mutations.agentAddComment,
        {
          organizationId,
          actorId: WORKFLOW_ACTOR_ID,
          taskId: taskId(raw),
          body,
          ...(bodyByLocale !== undefined ? { bodyByLocale } : {}),
        },
      );
      return { messageId: posted.messageId };
    },
    async listComments({ organizationId, taskId: raw }) {
      const messages = await ctx.runQuery(
        internal.tasks.internal_queries.listTaskDiscussionMessagesInternal,
        { organizationId, taskId: taskId(raw) },
      );
      return messages.map((message) => ({
        authorType: message.authorType,
        authorId: message.authorId,
        body: message.body,
        createdAt: message.createdAt,
      }));
    },
  };
}

export function workflowDocumentStore(ctx: ActionCtx): WorkflowDocumentStore {
  return {
    async listFolder({ organizationId, folderId, folderPath, recursive }) {
      const files = await ctx.runQuery(
        internal.documents.internal_queries.listFilesByFolderInternal,
        {
          organizationId,
          ...(folderId !== undefined
            ? {
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a wrong id resolves to null and reads as folder-not-found
                folderId: folderId as Id<'folders'>,
              }
            : {}),
          ...(folderPath !== undefined ? { folderPath } : {}),
          ...(recursive !== undefined ? { recursive } : {}),
        },
      );
      if (files === null) return null;
      return files.map((file) => ({
        name: file.name,
        storageId: String(file.fileId),
      }));
    },
    async create({
      organizationId,
      folderId,
      name,
      storageId,
      content,
      contentType,
      externalItemId,
    }) {
      const extension = extractExtension(name);
      let fileId = storageId;
      if (fileId === undefined) {
        // Inline text: store the bytes first — sandbox staging skips
        // content-only rows, so a document must always carry a blob.
        const stored = await ctx.runAction(
          internal.documents.internal_actions.storeRawContent,
          {
            organizationId,
            fileName: name,
            content: content ?? '',
            contentType: contentType ?? 'text/plain',
            extension: extension ?? '',
          },
        );
        fileId = String(stored.fileStorageId);
      }
      // Same folder + same file name = the same document, WHOEVER wrote it
      // first (an upload, a seed, an earlier run): publishing refreshes that
      // document's blob instead of parking a same-named sibling next to it.
      const existing = await ctx.runQuery(
        internal.documents.internal_queries.findDocumentInFolderByTitle,
        {
          organizationId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a wrong id reads as no match and falls through to the upsert's own check
          folderId: folderId as Id<'folders'>,
          name,
        },
      );
      if (existing !== null) {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocument,
          {
            documentId: existing.documentId,
            callerOrgId: organizationId,
            fileId,
            ...(contentType !== undefined ? { mimeType: contentType } : {}),
            ...(extension !== undefined ? { extension } : {}),
            sourceProvider: 'agent',
          },
        );
        return { documentId: String(existing.documentId), action: 'updated' };
      }
      const upserted = await ctx.runMutation(
        internal.documents.internal_mutations.upsertDocumentByExternalId,
        {
          organizationId,
          // Idempotent per (folder, name) for fresh files too: a re-run of
          // the same node refreshes the artifact instead of duplicating it.
          externalItemId: externalItemId ?? `workflow:${folderId}:${name}`,
          title: name,
          fileId,
          ...(contentType !== undefined ? { mimeType: contentType } : {}),
          ...(extension !== undefined ? { extension } : {}),
          sourceProvider: 'agent',
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a wrong id fails the upsert's own folder check
          folderId: folderId as Id<'folders'>,
        },
      );
      return {
        documentId: String(upserted.documentId),
        action: upserted.action,
      };
    },
  };
}

export function workflowConversationStore(
  ctx: ActionCtx,
): WorkflowConversationStore {
  return {
    ingestEmails: (args) => ingestEmails(ctx, args),
    ingestSentEmails: (args) => ingestSentEmails(ctx, args),
    querySyncCursor: (args) => querySyncCursor(ctx, args),
    syncMailbox: (args) => syncMailbox(ctx, args),
    listMailboxMessages: (args) => listMailboxMessages(ctx, args),
  };
}
