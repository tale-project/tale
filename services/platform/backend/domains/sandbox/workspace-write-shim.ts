import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import {
  linkAgentDocumentFile,
  storeAgentTextBlob,
  upsertAgentDocument,
} from '../documents/agent-write.ts';
import { addTaskComment } from '../tasks/comments.ts';
import { upsertTaskByExternalRef } from '../tasks/external-ref.ts';
import {
  agentCreateTaskTrusted,
  agentUpdateTaskStatusTrusted,
  listTasksForAgent,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '../tasks/service.ts';

/**
 * The WRITE half of the workspace-tool bridge: the task family (the agent's
 * comment included), plus the three calls `document_create` makes.
 *
 * These names were the last un-shimmed ones the reused bridge
 * (`core/node_only/sandbox/workspace_domain_tools.ts`) can reach, so every
 * granted write tool died at dispatch with `[ctx-shim] un-shimmed …` until
 * this map existed. Authority arrives already resolved (the dispatch runs
 * `resolveSessionActionContext` and hands the handlers a project or an
 * org-with-bound-projects scope), so nothing here re-decides who may write —
 * these are the trusted lower halves, and they are the SAME service functions
 * the human and connector lanes call.
 *
 * Errors cross a vocabulary boundary here: 0.5 domains throw
 * `{code, status}` errors, while the reused bridge reads `AppError.data.code`
 * to answer `not_found` vs `invalid_args`, and relays `data.message` — the
 * domain's own sentence, which names the limit a value broke — beside the
 * code. {@link asAppError} is that translation, and the only place it
 * happens.
 */

/**
 * A 0.5 domain refusal, in the shape the reused bridge branches on.
 *
 * The domain classes (`TaskError`, `DocumentError`, `ProjectError`,
 * `FileError`) all carry a string `code` AND a numeric `status`; a
 * postgres.js failure carries a SQLSTATE `code` and no status. Both halves
 * are checked precisely so a serialization failure or a dead connection stays
 * a plain error — relabelling one as a coded refusal would tell the agent its
 * ARGUMENTS were wrong when the database was simply unavailable. For the same
 * reason only a CLIENT refusal (a 4xx status, the set `isDomainError` in
 * `rest/shared.ts` lets through) is translated: a coded 5xx — the mention
 * directory's `MENTION_DIRECTORY_UNAVAILABLE` on a comment, the files
 * domain's `OBJECT_STORE_UNCONFIGURED` on `document_create` — is an
 * infrastructure failure that says "try again", so it stays a plain error
 * and the bridge answers it as `error`, never `invalid_args`.
 */
function asAppError(error: unknown): unknown {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return new AppError({ code: error.code, message: error.message });
  }
  return error;
}

/** Run a domain call, translating its refusal into the bridge's shape
 * ({@link asAppError}) — every write handler of the bridge goes through it. */
export async function coded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asAppError(error);
  }
}

/** The row shape the reused bridge's `compactTask` reads: `_id`, and absent
 * rather than null for everything optional. */
function toAgentTaskDoc(task: TaskRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      _id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      priority: task.priority,
      assigneeType: task.assigneeType,
      assigneeId: task.assigneeId,
      parentTaskId: task.parentTaskId,
      externalSystem: task.externalSystem,
      externalId: task.externalId,
      externalUrl: task.externalUrl,
      commentCount: task.commentCount,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function workspaceWriteShimHandlers(sql: Sql): ShimHandlers {
  return {
    'tasks/internal_queries:listTasksForAgent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        projectId?: string;
        projectIds?: string[];
        status?: TaskStatus;
        assigneeId?: string;
        includeArchived?: boolean;
      };
      const rows = await listTasksForAgent(sql, args);
      return rows.map(toAgentTaskDoc);
    },

    'tasks/internal_mutations:agentCreateTask': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge narrows status/priority before calling
      const args = raw as {
        organizationId: string;
        actorId: string;
        projectId: string;
        title: string;
        description?: string;
        status?: Extract<TaskStatus, 'backlog' | 'todo'>;
        priority?: TaskPriority;
        labels?: string[];
        parentTaskId?: string;
        mintLabels?: boolean;
      };
      return coded(() =>
        transactSerializable(sql, (tx) => agentCreateTaskTrusted(tx, args)),
      );
    },

    'tasks/internal_mutations:agentUpdateTaskStatus': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge and the turn host pass exactly this shape
      const args = raw as {
        organizationId: string;
        actorId: string;
        taskId: string;
        status: TaskStatus;
        review?: { runId: string };
      };
      return coded(() =>
        transactSerializable(sql, (tx) =>
          agentUpdateTaskStatusTrusted(tx, args),
        ),
      );
    },

    'tasks/internal_mutations:agentUpsertTaskByExternalRef': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this subset
      const args = raw as Parameters<typeof upsertTaskByExternalRef>[1];
      return coded(() =>
        transactSerializable(sql, (tx) => upsertTaskByExternalRef(tx, args)),
      );
    },

    'tasks/internal_mutations:agentAddComment': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        actorId: string;
        taskId: string;
        body: string;
        bodyByLocale?: Record<string, string>;
      };
      // The bridge already resolved WRITE authority (a project-bound
      // session); this writer is the trusted lower half, so it runs with an
      // administrative auth attributed to the agent actor. Coded like its
      // siblings: a comment over the limit is the agent's `invalid_args`,
      // not an `error` that reads as a transient failure — while a mention
      // directory that could not be listed (a coded 503) stays that `error`.
      return coded(() =>
        sql.begin(async (tx) => {
          const { messageId, threadId } = await addTaskComment(
            tx,
            {
              organizationId: args.organizationId,
              userId: args.actorId,
              role: 'admin',
              teamIds: [],
            },
            {
              taskId: args.taskId,
              body: args.body,
              ...(args.bodyByLocale !== undefined
                ? { bodyByLocale: args.bodyByLocale }
                : {}),
              author: { actorType: 'agent', actorId: args.actorId },
            },
          );
          return { messageId, threadId, mentionCount: 0 };
        }),
      );
    },

    // ------------------------------------------------ document_create's trio
    'documents/internal_actions:storeRawContent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        fileName: string;
        content: string;
        contentType: string;
        extension: string;
      };
      const stored = await coded(() => storeAgentTextBlob(sql, args));
      // `fileStorageId` is the BLOB ref — what a document's `file_ref` holds
      // and what the link call keys the metadata row on.
      return {
        success: true,
        fileStorageId: stored.storageRef,
        fileName: args.fileName,
        contentType: args.contentType,
        size: stored.size,
        extension: args.extension,
      };
    },

    'documents/internal_mutations:upsertDocumentByExternalId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this subset
      const args = raw as {
        organizationId: string;
        externalItemId: string;
        title: string;
        fileId: string;
        mimeType: string;
        extension?: string;
        sourceProvider?: string;
        createdBy: string;
        projectId?: string;
        auditActorId?: string;
      };
      const { fileId, ...rest } = args;
      // The bridge's `fileId` IS the blob ref `storeRawContent` answered.
      return coded(() =>
        upsertAgentDocument(sql, { ...rest, fileRef: fileId }),
      );
    },

    'file_metadata/internal_mutations:linkDocumentToFile': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as { storageId: string; documentId: string };
      await coded(() =>
        linkAgentDocumentFile(sql, {
          storageRef: args.storageId,
          documentId: args.documentId,
        }),
      );
      return null;
    },
  };
}
