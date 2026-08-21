/**
 * The emailed attachments a caller may read — driven from conversations.
 *
 * An emailed attachment has no listing surface anywhere else in the product. It
 * is not a Document Hub row, so it is absent from the Documents page and from
 * `list kind="document"`, and its only appearance is on its own conversation in
 * the Inbox. Retrieval was the sole way to discover one, which means guessing
 * words inside a file whose name says nothing about why it was sent.
 *
 * ## Why the conversations lead
 *
 * The reads scale with the conversations shown, not with how many attachments
 * the organization has ever received. Two earlier shapes both failed on that:
 *
 *  - walking every `fileMetadata` row under a budget spent the budget on rows
 *    that can never qualify — on one deployment, 3,671 rows of which 3 carried
 *    a conversation — so which attachments were reachable depended on where
 *    they sat in creation order;
 *  - walking only the bound rows fixed reachability but still read up to the
 *    whole budget to return one page, and above that budget it was silently
 *    wrong about "most recent", because that index orders by conversation
 *    rather than by time.
 *
 * Leading with conversations removes both. Each conversation is one exact index
 * lookup, and the caller decides how many conversations to reach over.
 *
 * ## Ordering
 *
 * Conversation order is the caller's, and attachments follow it — most recently
 * active mail first, newest attachment first within a conversation. Not
 * global arrival order: that would need an index over bound rows keyed by time,
 * which does not exist and would cost a stored field plus a backfill.
 *
 * ## An id is not a capability
 *
 * Every conversation is re-checked here even though the caller resolved them
 * through a privacy-applied reader. The check is cheap — one row read per
 * conversation — and it keeps this query fail-closed on its own terms rather
 * than trusting whatever ids arrived.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { conversationAssignmentAllows } from '../lib/rls/helpers/conversation_assignment';
import { conversationCallerResolver } from '../lib/rls/helpers/conversation_caller';

/** One attachment, as a catalogue row rather than a retrieval hit. */
export interface MailAttachmentListing {
  /** The corpus ref, so a listed row can be fetched without another search. */
  readonly ref: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly conversationId: string;
  readonly receivedAt: number;
  /** Whether its text is in the corpus. A received-but-unindexed attachment is
   *  a real state, and saying so beats implying it is searchable. */
  readonly indexed: boolean;
}

export interface MailAttachmentListingResult {
  readonly attachments: MailAttachmentListing[];
  /** More attachments exist on the conversations reached than fit the limit.
   *  Says nothing about conversations NOT reached — that bound belongs to
   *  whoever chose the conversation list. */
  readonly truncated: boolean;
}

export async function listMailAttachments(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId?: string | undefined;
    /** The conversations to look in, in the order they should be reported. */
    conversationIds: readonly string[];
    limit: number;
  },
): Promise<MailAttachmentListingResult> {
  const caller = conversationCallerResolver(ctx, {
    organizationId: args.organizationId,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });

  const attachments: MailAttachmentListing[] = [];
  let more = false;

  for (const rawId of args.conversationIds) {
    if (attachments.length >= args.limit) {
      more = true;
      break;
    }
    const conversationId = ctx.db.normalizeId('conversations', rawId);
    if (conversationId === null) continue;

    const identity = await caller();
    if (identity === null) return { attachments: [], truncated: false };

    const conversation = await ctx.db.get(conversationId);
    if (
      conversation === null ||
      conversation.organizationId !== args.organizationId
    ) {
      continue;
    }
    const allowed = await conversationAssignmentAllows(conversation, {
      isAdmin: identity.isAdmin,
      userId: identity.userId,
      hasTeam: (teamId) => identity.teamIds.has(teamId),
    });
    if (!allowed) continue;

    // One exact index lookup per conversation, newest attachment first.
    const rows: Doc<'fileMetadata'>[] = [];
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_conversationId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('conversationId', conversationId),
      )
      .order('desc')) {
      if (row.lifecycleStatus === 'trashed') continue;
      rows.push(row);
      // One past the limit is enough to know more exist without reading a
      // conversation's whole attachment history.
      if (attachments.length + rows.length > args.limit) break;
    }

    for (const row of rows) {
      if (attachments.length >= args.limit) {
        more = true;
        break;
      }
      attachments.push({
        ref: String(row.storageId),
        fileName: row.fileName,
        contentType: row.contentType,
        size: row.size,
        conversationId: String(conversationId),
        receivedAt: row._creationTime,
        indexed: row.ragStatus === 'completed',
      });
    }
  }

  return { attachments, truncated: more };
}
