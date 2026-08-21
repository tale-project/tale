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
 * ## Two bounds, both reported
 *
 * `limit` bounds what is KEPT. `SCAN_CAP` bounds what is EXAMINED, which is the
 * one that matters: the walk filters as it goes, so a caller who can read few
 * conversations rejects most of what it touches. Without the second bound one
 * question would read the organization's whole `fileMetadata` table.
 *
 * The walk is newest-first. The bound decides the answer, so which end it keeps
 * is the feature: oldest-first would answer "what has come in?" with the
 * stalest mail on the box.
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
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc')) {
    scanned += 1;
    if (scanned > (args.scanCap ?? SCAN_CAP)) {
      truncated = true;
      break;
    }
    if (row.lifecycleStatus === 'trashed') continue;
    // `mayRead` rejects an unbound row itself, so there is no separate guard
    // here: a second one read as belt-and-braces but no test could tell it from
    // dead code.
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
    if (attachments.length >= args.limit) break;
  }

  return { attachments, truncated };
}
