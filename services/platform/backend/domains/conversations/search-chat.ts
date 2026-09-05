import type { Sql } from 'postgres';

import { htmlToText } from '../../../lib/knowledge/html-to-text.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { conversationAssignmentAllows } from '../../core/lib/rls/helpers/conversation_assignment.ts';
import { queryTokens, rowMatches } from '../../core/lib/search/relevance.ts';
import { contactsSearchStrategy } from '../../core/lib/search/strategies/contacts.ts';
import { viewerIsAdmin } from './service.ts';

/**
 * Question-shaped search over conversations for the chat assistant — the
 * 0.5 twin of `convex/conversations/search_for_chat.ts`, with the same
 * discipline: the role gate is nowhere near sufficient (assignment privacy
 * is narrower than membership), so EVERY row passes the reused
 * `conversationAssignmentAllows` predicate; role and team ids are resolved
 * HERE from the caller's identity, never accepted as arguments.
 *
 * Bounded and recency-biased exactly like 0.4: the main walk stops at
 * {@link SCAN_CAP} recent conversations; the body pre-pass reads at most
 * {@link MESSAGE_SCAN_CAP} recent messages (ids only cross that boundary —
 * an unreadable conversation's body match is collected and then discarded
 * by the assignment predicate); the contact leg prefilters in SQL and reads
 * at most {@link CONTACT_SCAN_CAP} recent candidates (mail ingest mints a
 * contact per correspondent, so the address book is the one table here that
 * grows without bound). A match older than a cap is invisible — `truncated`
 * states the limit.
 */

const SCAN_CAP = 300;
const CONTACT_MATCH_CAP = 25;
const CONTACT_SCAN_CAP = 500;
const MESSAGE_SCAN_CAP = 400;
const BODY_MATCH_CAP = 50;

/** A LIKE pattern matching `token` literally anywhere in the value —
 * `%`, `_` and `\` are LIKE metacharacters and must not widen the match. */
function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** A one-field strategy: `subject` is the only prose a conversation row
 * carries. Declared here rather than exported from the shared strategies,
 * because nothing else searches this table. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the strategy type is keyed to 0.4 table names; the matcher reads only the declared fields
const SUBJECT_STRATEGY = {
  table: 'conversations',
  textFields: ['subject'],
  idFields: [],
} as never;

async function matchingConversationIdsByBody(
  sql: Sql,
  args: { organizationId: string; term: string },
): Promise<{ ids: Set<string>; truncated: boolean }> {
  const rows = await sql<{ conversationId: string; content: string }[]>`
    SELECT conversation_id AS "conversationId", content
    FROM app.conversation_messages
    WHERE org_id = ${args.organizationId}
    ORDER BY delivered_at_ms DESC NULLS LAST, seq DESC
    LIMIT ${MESSAGE_SCAN_CAP + 1}
  `;
  const ids = new Set<string>();
  const lower = args.term.toLowerCase();
  let truncated = rows.length > MESSAGE_SCAN_CAP;
  for (const message of rows.slice(0, MESSAGE_SCAN_CAP)) {
    const body = message.content;
    if (body === '') continue;
    const text = body.includes('<') ? htmlToText(body) : body;
    if (text.toLowerCase().includes(lower)) {
      ids.add(message.conversationId);
      if (ids.size >= BODY_MATCH_CAP) break;
    }
  }
  if (ids.size >= BODY_MATCH_CAP) truncated = false;
  return { ids, truncated };
}

/**
 * Contacts whose name / email / external id the term hits. The reused matcher
 * (`'any'` mode) keeps a contact only when a surviving token hits a text
 * field at word-start or better, or an id field as a substring — every such
 * hit is a substring hit, so the SQL prefilter below is a SUPERSET the
 * matcher then narrows in JS. Bounded and recency-biased like the other
 * legs: the newest {@link CONTACT_SCAN_CAP} candidates, never the whole
 * address book loaded per query.
 */
async function matchingContactIds(
  sql: Sql,
  args: { organizationId: string; term: string },
): Promise<Set<string>> {
  const lower = args.term.toLowerCase();
  const tokens = queryTokens(lower, 'any');
  // An all-stopword question carries no searchable signal (the matcher would
  // keep nothing either) — no read at all.
  if (tokens.length === 0) return new Set();
  const patterns = tokens.map(likeContains);
  const rows = await sql<
    {
      _id: string;
      name: string | null;
      email: string | null;
      externalId: string | null;
    }[]
  >`
    SELECT id AS "_id", name, email, external_id AS "externalId"
    FROM app.contacts
    WHERE org_id = ${args.organizationId}
      AND (name ILIKE ANY(${patterns}::text[])
        OR email ILIKE ANY(${patterns}::text[])
        OR external_id ILIKE ANY(${patterns}::text[]))
    ORDER BY created_at_ms DESC
    LIMIT ${CONTACT_SCAN_CAP}
  `;
  const ids = new Set<string>();
  for (const contact of rows) {
    const wire = Object.fromEntries(
      Object.entries(contact).filter(([, value]) => value !== null),
    );
    if (
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused matcher reads only the strategy's declared fields
      rowMatches(wire as never, contactsSearchStrategy, lower, args.term, 'any')
    ) {
      ids.add(contact._id);
      if (ids.size >= CONTACT_MATCH_CAP) break;
    }
  }
  return ids;
}

interface ConversationScanRow {
  _id: string;
  subject: string | null;
  status: string | null;
  channel: string | null;
  lastMessageAt: number | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  contactId: string | null;
}

export interface ChatConversationHit {
  _id: string;
  subject?: string;
  status?: string;
  channel?: string;
  lastMessageAt?: number;
  assigneeUserId?: string;
  assigneeTeamId?: string;
}

export async function searchConversationsForChat(
  sql: Sql,
  args: {
    organizationId: string;
    /** The turn user. Authority is derived from this, never passed in. */
    userId: string;
    term: string;
    list?: boolean;
    limit: number;
  },
): Promise<{ conversations: ChatConversationHit[]; truncated: boolean }> {
  // Tier-A role gate (the per-subject matrix ports with governance): an
  // active member may search; the assignment predicate below is the real
  // privacy boundary.
  const members = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${args.organizationId}
      AND "userId" = ${args.userId}
    LIMIT 1
  `;
  const role = members[0]?.role;
  if (role === undefined || role === 'disabled') {
    return { conversations: [], truncated: false };
  }

  const admin = viewerIsAdmin(role);
  let teamIds: Set<string> | undefined;
  const hasTeam = async (teamId: string): Promise<boolean> => {
    teamIds ??= new Set(await getUserTeamIds(sql, args.userId));
    return teamIds.has(teamId);
  };

  const listing = args.list === true;
  const term = args.term.trim();
  const lower = term.toLowerCase();
  const contactIds =
    listing || term === ''
      ? new Set<string>()
      : await matchingContactIds(sql, {
          organizationId: args.organizationId,
          term,
        });
  const body =
    listing || term === ''
      ? { ids: new Set<string>(), truncated: false }
      : await matchingConversationIdsByBody(sql, {
          organizationId: args.organizationId,
          term,
        });

  const scan = await sql<ConversationScanRow[]>`
    SELECT id AS "_id", subject, status, channel,
           last_message_at_ms::float8 AS "lastMessageAt",
           assignee_user_id AS "assigneeUserId",
           assignee_team_id AS "assigneeTeamId", contact_id AS "contactId"
    FROM app.conversations
    WHERE org_id = ${args.organizationId}
    ORDER BY coalesce(last_message_at_ms, 0) DESC, id DESC
    LIMIT ${SCAN_CAP + 1}
  `;
  const out: ChatConversationHit[] = [];
  // The 0.4 truncation contract: true only when the walk itself was cut at
  // the cap — a limit-break before the cap is a full answer, not a partial.
  let hitLimit = false;
  for (const row of scan.slice(0, SCAN_CAP)) {
    if (!listing) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one-field wire row for the reused matcher
      const subjectWire = { subject: row.subject } as never;
      const bySubject =
        row.subject !== null &&
        rowMatches(subjectWire, SUBJECT_STRATEGY, lower, term, 'any');
      const byContact = row.contactId !== null && contactIds.has(row.contactId);
      const byBody = body.ids.has(row._id);
      if (!bySubject && !byContact && !byBody) continue;
    }

    // The scope decision comes AFTER the text match so an unreadable row
    // never costs a team lookup it cannot benefit from.
    const readable = await conversationAssignmentAllows(
      {
        ...(row.assigneeUserId !== null
          ? { assigneeUserId: row.assigneeUserId }
          : {}),
        ...(row.assigneeTeamId !== null
          ? { assigneeTeamId: row.assigneeTeamId }
          : {}),
      },
      { isAdmin: admin, userId: args.userId, hasTeam },
    );
    if (!readable) continue;

    const hit: ChatConversationHit = { _id: row._id };
    if (row.subject !== null) hit.subject = row.subject;
    if (row.status !== null) hit.status = row.status;
    if (row.channel !== null) hit.channel = row.channel;
    if (row.lastMessageAt !== null) hit.lastMessageAt = row.lastMessageAt;
    if (row.assigneeUserId !== null) hit.assigneeUserId = row.assigneeUserId;
    if (row.assigneeTeamId !== null) hit.assigneeTeamId = row.assigneeTeamId;
    out.push(hit);
    if (out.length >= args.limit) {
      hitLimit = true;
      break;
    }
  }

  // A cut-short body walk makes the whole answer partial, not just that leg.
  const truncated = body.truncated || (!hitLimit && scan.length > SCAN_CAP);
  return { conversations: out, truncated };
}
