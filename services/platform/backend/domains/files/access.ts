import type { Sql } from 'postgres';

import { findOrganizationMember } from '../../auth/membership.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { loadProjectSharedThread } from '../chat/threads.ts';
import {
  ConversationError,
  loadVisibleConversation,
} from '../conversations/service.ts';
import {
  assertDocumentVisible,
  DocumentError,
  listDocumentsForBlob,
} from '../documents/service.ts';
import {
  getProjectAuthContext,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { FileError } from './service.ts';

/**
 * Who may READ a file row — the files domain's single access decision.
 *
 * A blob ref is a capability string handed to every reader of the thing it
 * belongs to, so possession proves nothing; authority flows from the row's
 * BINDINGS, each resolved through its owning domain's own gate:
 *
 * - the uploader always reads their own row (staging uploads are bound to
 *   nothing yet);
 * - a DOCUMENT-bound row is the document's bytes — the document ACL
 *   (`assertDocumentVisible`: hub team rules / project access) is the only
 *   door, and every document sharing the blob counts (a multi-team upload
 *   is one blob, one document per team);
 * - a THREAD-bound row (chat attachment) reads for the thread's owner and
 *   for project members the owner shared the thread with;
 * - a CONVERSATION-bound row (mail attachment) follows the inbox assignment
 *   predicate;
 * - a TASK deliverable or attachment reads for anyone who can read a task
 *   that lists the ref — `tasks.outputs`/`attachments` are written only by
 *   trusted server code (the run harvest), never from a client body.
 *
 * Anything else is denied, and denial is 404-shaped: an inaccessible row
 * must be indistinguishable from a missing one.
 */

/** The binding fields a read decision consults — a projection of `app.file_metadata`. */
export interface FileBindingFields {
  organizationId: string;
  storageRef: string;
  uploadedBy: string | null;
  documentId: string | null;
  threadId: string | null;
  conversationId: string | null;
}

export type FileViewer = Pick<
  ProjectAuthContext,
  'organizationId' | 'userId' | 'role' | 'teamIds'
>;

/**
 * The parent-ACL probes the decision walks. Production wires them to the
 * owning domains ({@link fileAccessProbes}); tests inject verdicts.
 */
export interface FileAccessProbes {
  /** Some document whose content is this row's blob is visible to the viewer. */
  documentReadable(file: FileBindingFields): Promise<boolean>;
  threadReadable(threadId: string): Promise<boolean>;
  conversationReadable(conversationId: string): Promise<boolean>;
  /** A task the viewer can read lists `storageRef` among its attachments or outputs. */
  taskReadable(storageRef: string): Promise<boolean>;
}

/** The pure decision — which bindings are consulted, in which order, and the deny-by-default. */
export async function decideFileRead(
  viewer: FileViewer,
  file: FileBindingFields,
  probes: FileAccessProbes,
): Promise<boolean> {
  if (file.organizationId !== viewer.organizationId) return false;
  if (file.uploadedBy !== null && file.uploadedBy === viewer.userId) {
    return true;
  }
  // A document-bound row answers to the document ACL alone: a thread or
  // task that happens to name the same blob must not widen a document's
  // audience.
  if (file.documentId !== null) {
    return probes.documentReadable(file);
  }
  if (file.threadId !== null && (await probes.threadReadable(file.threadId))) {
    return true;
  }
  if (
    file.conversationId !== null &&
    (await probes.conversationReadable(file.conversationId))
  ) {
    return true;
  }
  return probes.taskReadable(file.storageRef);
}

/** The production probes — each binding resolved through its owning domain's gate. */
export function fileAccessProbes(
  sql: Sql,
  viewer: ProjectAuthContext,
): FileAccessProbes {
  return {
    documentReadable: async (file) => {
      const documents = await listDocumentsForBlob(sql, viewer.organizationId, {
        storageRef: file.storageRef,
        documentId: file.documentId,
      });
      for (const document of documents) {
        try {
          await assertDocumentVisible(sql, viewer, document);
          return true;
        } catch (error) {
          if (!(error instanceof DocumentError)) throw error;
        }
      }
      return false;
    },
    threadReadable: async (threadId) => {
      // The owner reads their own attachments whatever the thread's status
      // (an archived or trashed thread is still theirs); everyone else only
      // through the one read grant beside share links — a project share.
      const rows = await sql<{ userId: string }[]>`
        SELECT user_id AS "userId" FROM app.threads
        WHERE id = ${threadId} AND org_id = ${viewer.organizationId}
        LIMIT 1
      `;
      const thread = rows[0];
      if (!thread) return false;
      if (thread.userId === viewer.userId) return true;
      return (
        (await loadProjectSharedThread(
          sql,
          viewer.organizationId,
          viewer.userId,
          threadId,
        )) !== null
      );
    },
    conversationReadable: async (conversationId) => {
      try {
        await loadVisibleConversation(
          sql,
          {
            organizationId: viewer.organizationId,
            userId: viewer.userId,
            role: viewer.role,
          },
          conversationId,
        );
        return true;
      } catch (error) {
        if (error instanceof ConversationError) return false;
        throw error;
      }
    },
    taskReadable: async (storageRef) => {
      // `[{fileId}]` containment matches any element carrying the ref —
      // the deliverable/attachment shape both columns hold.
      const needle = JSON.stringify([{ fileId: storageRef }]);
      const projects = await sql<
        { teamId: string | null; sharedWithTeamIds: string[] | null }[]
      >`
        SELECT p.team_id AS "teamId",
               p.shared_with_team_ids AS "sharedWithTeamIds"
        FROM app.tasks t
        JOIN app.projects p ON p.id = t.project_id
        WHERE t.org_id = ${viewer.organizationId}
          AND (t.outputs @> ${needle}::jsonb
            OR t.attachments @> ${needle}::jsonb)
        LIMIT 50
      `;
      return projects.some(
        (project) =>
          checkProjectAccess(
            {
              teamId: project.teamId,
              sharedWithTeamIds: project.sharedWithTeamIds ?? [],
            },
            viewer.teamIds,
            viewer.role,
          ).canRead,
      );
    },
  };
}

export async function resolveFileReadAccess(
  sql: Sql,
  viewer: ProjectAuthContext,
  file: FileBindingFields,
): Promise<boolean> {
  return decideFileRead(viewer, file, fileAccessProbes(sql, viewer));
}

/** Refuse, 404-shaped, unless the viewer may read the row. */
export async function assertFileReadable(
  sql: Sql,
  viewer: ProjectAuthContext,
  file: FileBindingFields,
): Promise<void> {
  if (await resolveFileReadAccess(sql, viewer, file)) return;
  throw new FileError('FILE_NOT_FOUND', 'File not found', 404);
}

/** The viewer for a session caller (role from the membership middleware). */
export function viewerForMember(
  sql: Sql,
  member: { organizationId: string; userId: string; role: string },
): Promise<ProjectAuthContext> {
  return getProjectAuthContext(sql, member);
}

/**
 * The viewer for a user id alone (the chat turn runs as the sender, outside
 * the membership middleware). Null when the user is not an active member —
 * the caller must then deny everything.
 */
export async function viewerForUser(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<ProjectAuthContext | null> {
  const member = await findOrganizationMember(sql, organizationId, userId);
  if (member === null || member.role === 'disabled') return null;
  return getProjectAuthContext(sql, {
    organizationId,
    userId,
    role: member.role,
  });
}
