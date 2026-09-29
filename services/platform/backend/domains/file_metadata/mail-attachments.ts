import type { Sql } from 'postgres';

import { getUserTeamIds } from '../../auth/membership.ts';
import { conversationAssignmentAllows } from '../../core/lib/rls/helpers/conversation_assignment.ts';
import { viewerIsAdmin } from '../conversations/service.ts';

/**
 * The emailed attachments a caller may read, newest arrival first — the 0.5
 * twin of `convex/file_metadata/list_mail_attachments.ts`.
 *
 * An emailed attachment has no listing surface anywhere else in the product.
 * It is not a Document Hub row, so it is absent from the Documents page and
 * from `list kind="document"`, and its only appearance is on its own
 * conversation in the Inbox. Retrieval was the sole way to discover one, which
 * means guessing words inside a file whose name says nothing about why it was
 * sent.
 *
 * ## Why the walk needs its own index
 *
 * `mail_received_at_ms` is written only on rows the email binder bound to a
 * conversation, so a partial index over the non-null values IS the mail index,
 * in arrival order. Migration 0064 adds it. The only other index on the pair
 * (`file_metadata_conversation`) leads with `conversation_id`, so it orders by
 * conversation — the shape PR #3035 recorded as rejected, because a
 * by-arrival page then reads most of its budget to return one row.
 *
 * ## What the privacy check costs, and why it is not optional
 *
 * A conversation is scoped more narrowly than membership: an unassigned inbox
 * row is admin-triage only. So every row passes the REUSED
 * `conversationAssignmentAllows` predicate, with the caller's role and team
 * ids resolved HERE from their identity and never accepted as arguments —
 * the same discipline `domains/conversations/search-chat.ts` follows. Skipping
 * it would publish the whole inbox to any member who asked for a listing.
 *
 * Assignment is read live, so reassigning a conversation moves its
 * attachments here too, with nothing rewritten. The decision is made once per
 * conversation, and the assignment stamps for the whole candidate window come
 * back in ONE query rather than a round-trip per row; the team lookup behind
 * `hasTeam` still happens at most once, and only for a conversation whose
 * decision actually turns on it.
 *
 * The conversation's own state gates the listing the way it gates retrieval
 * (`decideMailRetrievable`): an attachment of a conversation marked spam, or
 * one in the Trash, is not listed — retrieval would refuse its ref anyway,
 * and a listing that names what no fetch can read misleads.
 *
 * A row the caller cannot read is skipped, which means the walk may pass more
 * rows than it keeps. {@link SCAN_CAP} bounds that, and it is reported: a
 * caller who can read little should be told the reach was bounded rather than
 * shown an empty list as if the inbox were empty.
 */

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
  /** The walk stopped before the end of the mail index — either the page
   *  filled or the scan bound was reached. Not "the inbox holds nothing
   *  more". */
  readonly truncated: boolean;
}

interface CandidateRow {
  ref: string;
  fileName: string;
  contentType: string;
  size: number;
  conversationId: string;
  receivedAt: number;
  ragStatus: string | null;
}

export async function listMailAttachments(
  sql: Sql,
  args: {
    organizationId: string;
    /** The turn user. Authority is derived from this, never passed in. */
    userId: string;
    limit: number;
    /** Bound rows examined before stopping. Defaults to {@link SCAN_CAP}; the
     *  shim handler never overrides it. Present so a check can prove the bound
     *  without seeding hundreds of rows. */
    scanCap?: number;
  },
): Promise<MailAttachmentListingResult> {
  // Tier-A role gate (the per-subject matrix ports with governance): an
  // active member may list; the assignment predicate below is the real
  // privacy boundary.
  const members = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${args.organizationId}
      AND "userId" = ${args.userId}
    LIMIT 1
  `;
  const role = members[0]?.role;
  if (role === undefined || role === 'disabled') {
    return { attachments: [], truncated: false };
  }

  const admin = viewerIsAdmin(role);
  let teamIds: Set<string> | undefined;
  const hasTeam = async (teamId: string): Promise<boolean> => {
    teamIds ??= new Set(
      await getUserTeamIds(sql, args.organizationId, args.userId),
    );
    return teamIds.has(teamId);
  };

  const cap = Math.max(args.scanCap ?? SCAN_CAP, 1);
  // Over-fetch by one: the extra row is what distinguishes "the mail index
  // ended" from "the scan bound cut the walk short".
  const rows = await sql<CandidateRow[]>`
    SELECT storage_ref AS "ref", file_name AS "fileName",
           content_type AS "contentType", size::float8 AS size,
           conversation_id AS "conversationId",
           mail_received_at_ms::float8 AS "receivedAt",
           rag_status AS "ragStatus"
    FROM app.file_metadata
    WHERE org_id = ${args.organizationId}
      AND mail_received_at_ms IS NOT NULL
      AND conversation_id IS NOT NULL
      AND (lifecycle_status IS NULL OR lifecycle_status <> 'trashed')
    ORDER BY mail_received_at_ms DESC, id DESC
    LIMIT ${cap + 1}
  `;
  const candidates = rows.slice(0, cap);
  /** The scan bound cut the walk before the mail index ended. */
  let truncated = rows.length > cap;

  // One read for every conversation the window touches, instead of a
  // round-trip per attachment: many attachments share one conversation, and
  // the window is already bounded by the scan cap.
  const conversationIds = [
    ...new Set(candidates.map((row) => row.conversationId)),
  ];
  const conversations =
    conversationIds.length === 0
      ? []
      : await sql<
          {
            id: string;
            assigneeUserId: string | null;
            assigneeTeamId: string | null;
          }[]
        >`
          SELECT id, assignee_user_id AS "assigneeUserId",
                 assignee_team_id AS "assigneeTeamId"
          FROM app.conversations
          WHERE org_id = ${args.organizationId}
            AND id = ANY(${conversationIds})
            AND coalesce(lifecycle_status, 'active') = 'active'
            AND status IS DISTINCT FROM 'spam'
        `;
  // A conversation absent here — deleted, another org's id on the file row,
  // in the Trash or marked spam — lists none of its attachments.
  const stamps = new Map(
    conversations.map((row) => [
      row.id,
      {
        ...(row.assigneeUserId !== null
          ? { assigneeUserId: row.assigneeUserId }
          : {}),
        ...(row.assigneeTeamId !== null
          ? { assigneeTeamId: row.assigneeTeamId }
          : {}),
      },
    ]),
  );

  const decided = new Map<string, boolean>();
  const attachments: MailAttachmentListing[] = [];
  for (const row of candidates) {
    if (attachments.length >= args.limit) {
      // A candidate is still standing, so the mail index has more.
      truncated = true;
      break;
    }
    let allowed = decided.get(row.conversationId);
    if (allowed === undefined) {
      const stamp = stamps.get(row.conversationId);
      // A conversation missing from the rows above is fail-closed, never
      // org-readable.
      allowed =
        stamp !== undefined &&
        (await conversationAssignmentAllows(stamp, {
          isAdmin: admin,
          userId: args.userId,
          hasTeam,
        }));
      decided.set(row.conversationId, allowed);
    }
    if (!allowed) continue;

    attachments.push({
      ref: row.ref,
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.size,
      conversationId: row.conversationId,
      receivedAt: row.receivedAt,
      indexed: row.ragStatus === 'completed',
    });
  }

  return { attachments, truncated };
}

/**
 * Which of these refs name an emailed attachment, and the conversation each
 * arrived on — read from the file rows, the app's own truth, not from the
 * corpus row's copy of it.
 *
 * The door that serves mail (the chat tools) wraps it as untrusted by
 * provenance. The corpus stamps an attachment's conversation, but a stamp is
 * a copy that can be missing: an attachment indexed before the indexer
 * stamped one keeps an unstamped row until the backfill reaches it. The
 * retrievable filter decides such a row from its file row as mail, so it can
 * be served to that door — and a door that read provenance from the corpus
 * alone would then hand an outsider's text to the model unwrapped. The
 * filter's rule: a file row bound to a conversation and to no document. The
 * indexer stamps no conversation on a ref an active document also holds —
 * the file indexes as that document — and reading such a hit as mail here
 * only errs on the untrusted side.
 */
export async function emailedAttachmentConversations(
  sql: Sql,
  args: { organizationId: string; refs: readonly string[] },
): Promise<{ storageId: string; conversationId: string }[]> {
  if (args.refs.length === 0) return [];
  return sql<{ storageId: string; conversationId: string }[]>`
    SELECT DISTINCT ON (storage_ref) storage_ref AS "storageId",
           conversation_id AS "conversationId"
    FROM app.file_metadata
    WHERE org_id = ${args.organizationId}
      AND storage_ref = ANY(${[...args.refs]}::text[])
      AND conversation_id IS NOT NULL
      AND document_id IS NULL
    ORDER BY storage_ref, created_at_ms
  `;
}
