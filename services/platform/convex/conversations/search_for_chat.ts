/**
 * Question-shaped search over conversations, for the chat assistant.
 *
 * ## Why this one is not like the other legs
 *
 * Contacts and products can safely hand `organizationId` to an RLS-bypassing
 * internal query, because those tables are org-scope-and-role only. Conversations
 * are not: assignment privacy is narrower than membership, and the role gate the
 * chat leg already runs (`resolveWorkspaceReadAccess`) returns `allowed: true`
 * for ANY active member. So the role gate is necessary and nowhere near
 * sufficient — copying the contacts leg's shape here would publish the whole
 * inbox to every member.
 *
 * Every row therefore passes {@link conversationAssignmentAllows}, the same
 * predicate `rls_rules.ts` uses, rather than a second copy of the rule. Role and
 * team ids are resolved HERE from the caller's identity, not accepted as
 * arguments — an `isAdmin` flag travelling in from a caller is one refactor away
 * from being wrong in the direction that leaks.
 *
 * ## Bounded, recency-biased
 *
 * There is no text index on conversations, so this walks
 * `by_org_lastMessageAt` newest-first and stops at {@link SCAN_CAP}. That
 * mirrors `convex/chat/search.ts`: recent conversations are what a question is
 * almost always about, and an unbounded scan over a fat table is not an option
 * inside a turn. A match older than the cap is invisible — a real limit, stated
 * rather than hidden.
 *
 * Contact names are searched without a `get` per row: one bounded contacts
 * search resolves the term to a set of contact ids first, and a conversation
 * matches on its subject OR on being with one of those contacts. Message bodies
 * are NOT searched yet; `conversationMessages` does carry
 * `by_organizationId_and_deliveredAt`, so a bounded body leg is possible later
 * without a schema change.
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { resolveAgentReadAccess } from '../lib/rls/helpers/agent_read_access';
import { conversationAssignmentAllows } from '../lib/rls/helpers/conversation_assignment';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { contactsSearchStrategy, rowMatches } from '../lib/search';

/**
 * How many recent conversations one search may examine. Deliberately small:
 * each row costs an assignment decision, and the answer a question needs is
 * almost always recent. Raising it trades turn latency for reach.
 */
const SCAN_CAP = 300;

/** Matched contacts to resolve before scanning. Bounds the id set the
 *  conversation walk tests against. */
const CONTACT_MATCH_CAP = 25;

/** The contact ids whose name matches the term, so a conversation can be found
 *  by who it is with and not only by its subject. */
async function matchingContactIds(
  ctx: QueryCtx,
  args: { organizationId: string; term: string },
): Promise<Set<string>> {
  const ids = new Set<string>();
  const lower = args.term.toLowerCase();
  for await (const contact of ctx.db
    .query('contacts')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )) {
    if (rowMatches(contact, contactsSearchStrategy, lower, args.term, 'any')) {
      ids.add(String(contact._id));
      if (ids.size >= CONTACT_MATCH_CAP) break;
    }
  }
  return ids;
}

export const searchConversationsForChat = internalQuery({
  args: {
    organizationId: v.string(),
    /** The turn user. Authority is derived from this, never passed in. */
    userId: v.string(),
    term: v.string(),
    /** Explicit listing — the chat tool's `action: 'list'`. Skips the
     *  subject/contact text match and returns the most recent readable
     *  conversations; the privacy predicate and {@link SCAN_CAP} stay exactly
     *  as they are. There is still no cursor: the walk is recency-bounded,
     *  so a caller wanting more must narrow, not page. */
    list: v.optional(v.boolean()),
    limit: v.number(),
  },
  returns: v.object({
    conversations: v.array(
      v.object({
        _id: v.id('conversations'),
        subject: v.optional(v.string()),
        status: v.optional(v.string()),
        channel: v.optional(v.string()),
        lastMessageAt: v.optional(v.number()),
        /** Who owns it. Returned because "who is this assigned to?" is the
         *  first question asked of an inbox row, and because the assignment is
         *  the field this leg's whole privacy rule is built on — withholding it
         *  meant the answer could be found but not explained. */
        assigneeUserId: v.optional(v.string()),
        assigneeTeamId: v.optional(v.string()),
      }),
    ),
    /** True when the scan hit its cap, so the caller can say the reach was
     *  bounded instead of implying the inbox held nothing older. */
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const access = await resolveAgentReadAccess(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      subject: 'conversations',
    });
    // Not a member, or the role denies the subject: no rows, and no scan.
    if (!access.allowed) return { conversations: [], truncated: false };

    const admin = isAdmin(access.role);
    // One Better Auth round-trip at most, and only when it can matter. An
    // admin's decision never consults teams.
    let teamIds: Set<string> | undefined;
    const hasTeam = async (teamId: string): Promise<boolean> => {
      teamIds ??= new Set(await getUserTeamIds(ctx, args.userId));
      return teamIds.has(teamId);
    };

    const listing = args.list === true;
    const term = args.term.trim();
    const lower = term.toLowerCase();
    const contactIds =
      listing || term === ''
        ? new Set<string>()
        : await matchingContactIds(ctx, {
            organizationId: args.organizationId,
            term,
          });

    const out: Array<Doc<'conversations'>> = [];
    let scanned = 0;
    let truncated = false;
    for await (const conversation of ctx.db
      .query('conversations')
      .withIndex('by_org_lastMessageAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      if (scanned >= SCAN_CAP) {
        truncated = true;
        break;
      }
      scanned += 1;

      // A listing has no words to match: every scanned row goes straight to
      // the assignment decision below.
      if (!listing) {
        const bySubject =
          conversation.subject !== undefined &&
          rowMatches(
            conversation,
            // A one-field strategy: `subject` is the only prose a conversation
            // row carries. Declared inline rather than exported, because
            // nothing else searches this table.
            {
              table: 'conversations',
              orgIndex: 'by_organizationId',
              textFields: ['subject'],
              idFields: [],
              engine: 'scan',
            },
            lower,
            term,
            'any',
          );
        const byContact =
          conversation.contactId !== undefined &&
          contactIds.has(String(conversation.contactId));
        if (!bySubject && !byContact) continue;
      }

      // The scope decision comes AFTER the text match so an unreadable row
      // never costs a team lookup it cannot benefit from.
      const readable = await conversationAssignmentAllows(conversation, {
        isAdmin: admin,
        userId: args.userId,
        hasTeam,
      });
      if (!readable) continue;

      out.push(conversation);
      if (out.length >= args.limit) break;
    }

    // Built field-by-field rather than by spreading in a `map`: the returns
    // validator is closed, so only these five fields may cross the wire — a
    // whole-row spread would both trip `no-map-spread` and risk leaking a
    // column added to the table later.
    const conversations = [];
    for (const c of out) {
      const row: {
        _id: typeof c._id;
        subject?: string;
        status?: string;
        channel?: string;
        lastMessageAt?: number;
        assigneeUserId?: string;
        assigneeTeamId?: string;
      } = { _id: c._id };
      if (c.subject !== undefined) row.subject = c.subject;
      if (c.status !== undefined) row.status = c.status;
      if (c.channel !== undefined) row.channel = c.channel;
      if (c.lastMessageAt !== undefined) row.lastMessageAt = c.lastMessageAt;
      if (c.assigneeUserId !== undefined) row.assigneeUserId = c.assigneeUserId;
      if (c.assigneeTeamId !== undefined) row.assigneeTeamId = c.assigneeTeamId;
      conversations.push(row);
    }
    return { conversations, truncated };
  },
});
