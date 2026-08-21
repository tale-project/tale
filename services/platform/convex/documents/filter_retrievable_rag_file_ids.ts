import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../lib/knowledge/types';
import type { QueryCtx } from '../_generated/server';
import { conversationAssignmentAllows } from '../lib/rls/helpers/conversation_assignment';
import { conversationCallerResolver } from '../lib/rls/helpers/conversation_caller';
import type { BlobRef } from '../lib/storage/blob_ref';
import { isActiveDocument } from './_helpers';

export interface FilterRetrievableRagFileIdsArgs {
  readonly organizationId: string;
  readonly fileIds: readonly BlobRef[];
  readonly access?: KnowledgeAccessScope;
  /** The turn user, for deciding conversation-scoped rows. Absent denies them. */
  readonly userId?: string;
  readonly folder?: string;
}

/**
 * Validate corpus refs against live Convex truth.
 *
 * SQL scope/status columns are projections and may lag a replacement or scope
 * change. A document hit is returnable only while its metadata is completed,
 * its linked document is active and still points at that exact blob, and its
 * current scope/folder still matches the request.
 *
 * An emailed attachment (`conversationId` set, no `documentId`) is its own
 * access class too, and the only one decided from LIVE state rather than a
 * stamp: the caller must currently be able to read the conversation the mail
 * arrived on, so reassigning the mail moves its attachments with it.
 *
 * A thread-bound chat upload (`threadId` set, no `documentId`) is its own
 * access class — the 0.3 model (`verify_thread_scoped_access`): retrievable
 * ONLY when the caller's access lists that thread. It is private to its
 * thread, so an org-wide caller (absent access) does NOT see it.
 */
export async function filterRetrievableRagFileIds(
  ctx: QueryCtx,
  args: FilterRetrievableRagFileIdsArgs,
): Promise<string[]> {
  const retrievable: string[] = [];
  const seen = new Set<string>();
  const allowedThreadIds = new Set(args.access?.threadIds ?? []);

  // Resolved once, only when a conversation-scoped row is actually hit, and
  // by the SAME helper any listing surface uses — see
  // `conversation_caller.ts` for why the role is never an argument.
  const conversationCaller = conversationCallerResolver(ctx, {
    organizationId: args.organizationId,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });

  for (const fileId of args.fileIds) {
    const ref = String(fileId);
    if (seen.has(ref)) continue;
    seen.add(ref);

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (
      metadata === null ||
      metadata.organizationId !== args.organizationId ||
      metadata.ragStatus !== 'completed' ||
      metadata.lifecycleStatus === 'trashed'
    ) {
      continue;
    }

    if (metadata.threadId !== undefined) {
      // Chat upload bound to a thread: the folder filter is a Document Hub
      // concept, so a folder-scoped search never returns thread uploads.
      if (
        allowedThreadIds.has(metadata.threadId) &&
        (args.folder === undefined || args.folder === '')
      ) {
        retrievable.push(ref);
      }
      continue;
    }

    // An emailed attachment. It has no document row, so without this branch it
    // falls through the `documentId` check below and is denied outright.
    //
    // This is the gate that makes conversation scope work. The SQL side only
    // ADMITTED the row; who may read it is decided here, from the conversation's
    // CURRENT assignment, using the same predicate `rls_rules.ts` uses. A
    // reassignment therefore moves the attachment with the mail, and nothing has
    // to be rewritten.
    if (metadata.conversationId !== undefined) {
      // A scope that excludes conversations is honoured here too, not only in
      // the SQL pre-filter — the pre-filter is the half that fails open.
      if (args.access !== undefined && !args.access.includeConversationScoped) {
        continue;
      }
      const conversation = await ctx.db.get(metadata.conversationId);
      if (
        conversation === null ||
        conversation.organizationId !== args.organizationId
      ) {
        continue;
      }
      const caller = await conversationCaller();
      if (caller === null) continue;
      const allowed = await conversationAssignmentAllows(conversation, {
        isAdmin: caller.isAdmin,
        userId: caller.userId,
        hasTeam: (teamId) => caller.teamIds.has(teamId),
      });
      // The folder filter is a Document Hub concept; a folder-scoped search
      // never returns emailed attachments, exactly as it never returns chat
      // uploads.
      if (allowed && (args.folder === undefined || args.folder === '')) {
        retrievable.push(ref);
      }
      continue;
    }

    if (metadata.documentId === undefined) {
      continue;
    }

    const document = await ctx.db.get(metadata.documentId);
    if (
      document === null ||
      document.organizationId !== args.organizationId ||
      !isActiveDocument(document) ||
      (document.fileId ?? '') !== ref
    ) {
      continue;
    }

    if (
      args.folder !== undefined &&
      args.folder !== '' &&
      document.folderPath !== args.folder &&
      !document.folderPath?.startsWith(`${args.folder}/`)
    ) {
      continue;
    }

    if (
      !knowledgeScopeAllows(args.access, {
        teamIds: document.teamTags ?? null,
        teamId: document.teamId ?? null,
        projectId: document.projectId ?? null,
      })
    ) {
      continue;
    }

    retrievable.push(ref);
  }

  return retrievable;
}
