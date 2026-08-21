/**
 * The emailed attachments a caller may read, newest arrival first.
 *
 * An emailed attachment has no listing surface anywhere else in the product. It
 * is not a Document Hub row, so it is absent from the Documents page and from
 * `list kind="document"`, and its only appearance is on its own conversation in
 * the Inbox. Retrieval was the sole way to discover one, which means guessing
 * words inside a file whose name says nothing about why it was sent.
 *
 * ## Why it needs its own index
 *
 * `mailReceivedAt` is present only on bound rows, so a range above `undefined`
 * on `by_organizationId_and_mailReceivedAt` is a mail-only walk in arrival
 * order. No existing index gives that: pairing with `conversationId` orders by
 * conversation first, and the plain org index is dominated by rows that never
 * arrived by mail.
 *
 * Three earlier shapes each failed on cost or on order:
 *
 *  - walking every `fileMetadata` row under a budget spent the budget on rows
 *    that could never qualify — on one deployment, 3,671 rows of which 3 carried
 *    a conversation — so reachability depended on creation position;
 *  - walking only bound rows fixed that but still read the whole budget to
 *    return one page, and above it reported "most recent" from an arbitrary
 *    window;
 *  - leading with conversations bounded the cost but ordered by conversation
 *    activity, so a fresh application sorted below an older one that happened
 *    to get a reply.
 *
 * This walk reads `limit` rows in the order the caller asked for, and stops.
 *
 * ## What the privacy check costs
 *
 * Assignment is read live, per row, through the same predicate and resolver the
 * retrieval gate uses — so reassigning a conversation moves its attachments
 * here too, with nothing rewritten. The decision is cached per conversation, so
 * a page of attachments from one thread pays for one conversation read.
 *
 * A row the caller cannot read is skipped, which means the walk may pass more
 * rows than it keeps. `SCAN_CAP` bounds that, and it is reported: a caller who
 * can read little should be told the reach was bounded rather than shown an
 * empty list as if the inbox were empty.
 */

import type { QueryCtx } from '../_generated/server';
import { conversationAssignmentAllows } from '../lib/rls/helpers/conversation_assignment';
import { conversationCallerResolver } from '../lib/rls/helpers/conversation_caller';

/** Bound rows examined before the walk stops, however few were readable. */
const SCAN_CAP = 200;

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
  /** The walk stopped before the end of the mail index — either the page filled
   *  or the scan bound was reached. Not "the inbox holds nothing more". */
  readonly truncated: boolean;
}

export async function listMailAttachments(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId?: string | undefined;
    limit: number;
    /** Bound rows examined before stopping. Defaults to {@link SCAN_CAP}; the
     *  internal query never overrides it. Present so a test can prove the
     *  bound without seeding hundreds of rows. */
    scanCap?: number;
  },
): Promise<MailAttachmentListingResult> {
  const caller = conversationCallerResolver(ctx, {
    organizationId: args.organizationId,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });

  // Many attachments share one conversation, so the decision is cached per
  // conversation rather than per row.
  const decided = new Map<string, boolean>();
  const attachments: MailAttachmentListing[] = [];
  let scanned = 0;
  let truncated = false;

  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_organizationId_and_mailReceivedAt', (q) =>
      // Above `undefined` selects the rows that carry an arrival time, which is
      // exactly the rows that arrived by mail.
      q
        .eq('organizationId', args.organizationId)
        .gt('mailReceivedAt', undefined),
    )
    .order('desc')) {
    if (attachments.length >= args.limit) {
      truncated = true;
      break;
    }
    scanned += 1;
    if (scanned > (args.scanCap ?? SCAN_CAP)) {
      truncated = true;
      break;
    }
    const conversationId = row.conversationId;
    if (conversationId === undefined) continue;
    if (row.lifecycleStatus === 'trashed') continue;

    const key = String(conversationId);
    let allowed = decided.get(key);
    if (allowed === undefined) {
      const identity = await caller();
      if (identity === null) return { attachments: [], truncated: false };
      const conversation = await ctx.db.get(conversationId);
      allowed =
        conversation !== null &&
        conversation.organizationId === args.organizationId &&
        (await conversationAssignmentAllows(conversation, {
          isAdmin: identity.isAdmin,
          userId: identity.userId,
          hasTeam: (teamId) => identity.teamIds.has(teamId),
        }));
      decided.set(key, allowed);
    }
    if (!allowed) continue;

    attachments.push({
      ref: String(row.storageId),
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.size,
      conversationId: key,
      receivedAt: row.mailReceivedAt ?? row._creationTime,
      indexed: row.ragStatus === 'completed',
    });
  }

  return { attachments, truncated };
}
