/**
 * The emailed attachments a caller may read — a catalogue, with the words off.
 *
 * An emailed attachment has no listing surface anywhere in the product. It is
 * not a Document Hub row, so it is absent from the Documents page and from
 * `list kind="document"`, and its only appearance is on its own conversation in
 * the Inbox. Retrieval was therefore the sole way to discover one, which means
 * guessing words that appear inside it — and a CV named for its author contains
 * none of the words describing the role it was sent for.
 *
 * ## Scope is the conversation's LIVE assignment
 *
 * Decided per row by `conversationAssignmentAllows` against the conversation as
 * it stands now, using the caller resolved by `conversationCallerResolver` —
 * the same predicate and the same resolver the retrieval gate uses. That is
 * deliberate: a listing that derived its own notion of visibility would be one
 * refactor away from being wider than the search beside it, and the failure
 * mode is publishing an inbox.
 *
 * Because assignment is read live, reassigning a conversation moves its
 * attachments in this listing too, with nothing rewritten.
 *
 * ## Only bound rows are walked
 *
 * The range starts ABOVE `undefined` on `by_organizationId_and_conversationId`.
 * Convex orders `undefined` below every real value, so that bound selects
 * exactly the rows that carry a conversation, and
 * the walk touches only rows that have a conversation. That is not an
 * optimization, it is the correctness fix: an earlier version scanned all of
 * `fileMetadata` newest-first under a scan cap, and on a deployment whose table
 * is mostly unbound rows the cap was exhausted before the walk reached a single
 * bound attachment. It returned nothing while three readable attachments
 * existed. A cap on rows EXAMINED empties the result set when the filter
 * rejects most of what it touches, so the filter has to be the index instead.
 *
 * `SCAN_CAP` survives as a ceiling on an organization with a very large number
 * of mail attachments, where it now bounds a walk over bound rows only.
 *
 * ## Recency is applied after the walk
 *
 * The index orders by conversation, not by time, so the page is sorted by
 * arrival before the limit is taken. The bound decides the answer, and
 * oldest-first would report "what has come in?" as the stalest mail on the box.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { conversationAssignmentAllows } from '../lib/rls/helpers/conversation_assignment';
import { conversationCallerResolver } from '../lib/rls/helpers/conversation_caller';

/** Rows examined before the walk stops, regardless of how many were kept. */
const SCAN_CAP = 600;

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
  /** The scan budget stopped the walk, so the listing is a page and not the
   *  whole set. Distinct from a full page, which the caller detects itself. */
  readonly truncated: boolean;
}

export async function listMailAttachments(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId?: string | undefined;
    limit: number;
    /** Rows examined before the walk stops. Defaults to {@link SCAN_CAP}; the
     *  internal query never overrides it. Present so a test can prove the bound
     *  exists without seeding six hundred rows. */
    scanCap?: number;
  },
): Promise<MailAttachmentListingResult> {
  const caller = conversationCallerResolver(ctx, {
    organizationId: args.organizationId,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });

  // Many attachments share one conversation, so the assignment decision is
  // cached per conversation rather than per row.
  const decided = new Map<string, boolean>();
  const mayRead = async (
    conversationId: Doc<'fileMetadata'>['conversationId'],
  ): Promise<boolean> => {
    if (conversationId === undefined) return false;
    const key = String(conversationId);
    const cached = decided.get(key);
    if (cached !== undefined) return cached;
    const identity = await caller();
    if (identity === null) {
      decided.set(key, false);
      return false;
    }
    const conversation = await ctx.db.get(conversationId);
    const allowed =
      conversation !== null &&
      conversation.organizationId === args.organizationId &&
      (await conversationAssignmentAllows(conversation, {
        isAdmin: identity.isAdmin,
        userId: identity.userId,
        hasTeam: (teamId) => identity.teamIds.has(teamId),
      }));
    decided.set(key, allowed);
    return allowed;
  };

  const attachments: MailAttachmentListing[] = [];
  let scanned = 0;
  let truncated = false;
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_organizationId_and_conversationId', (q) =>
      // Above `null` selects the rows that HAVE a conversation. Unbound rows —
      // Document Hub uploads, chat uploads, the unreferenced residue of a
      // re-ingest bug — are never touched, so they cannot exhaust the budget
      // ahead of a readable attachment.
      q
        .eq('organizationId', args.organizationId)
        .gt('conversationId', undefined),
    )) {
    scanned += 1;
    if (scanned > (args.scanCap ?? SCAN_CAP)) {
      truncated = true;
      break;
    }
    if (row.lifecycleStatus === 'trashed') continue;
    if (!(await mayRead(row.conversationId))) continue;
    attachments.push({
      ref: String(row.storageId),
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.size,
      conversationId: String(row.conversationId),
      receivedAt: row._creationTime,
      indexed: row.ragStatus === 'completed',
    });
  }

  // Newest first, then the limit — the index orders by conversation, so recency
  // cannot come from the walk.
  attachments.sort((a, b) => b.receivedAt - a.receivedAt);
  const page = attachments.slice(0, args.limit);
  return {
    attachments: page,
    truncated: truncated || page.length < attachments.length,
  };
}
