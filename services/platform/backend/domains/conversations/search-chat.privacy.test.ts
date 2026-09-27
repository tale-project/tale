/**
 * The chat assistant's conversations leg must keep assignment privacy — the
 * 0.4 suite (`convex/conversations/search_for_chat.test.ts`) ported to the
 * Postgres leg. The leg reads every row of the organization it scans and lets
 * `conversationAssignmentAllows` alone decide what the caller sees: nothing
 * upstream of it enforces assignment privacy, so a mistake here publishes the
 * whole inbox to any member.
 *
 * 0.4 proved it end to end through convex-test over a seeded world. Here
 * {@link worldSql} plays that part: an in-memory world answering the
 * statements the leg issues the way Postgres would, applying ONLY the
 * predicates the SQL carries. Drop an `org_id` filter and the foreign rows
 * come back, exactly as they would from the database — which is what gives
 * the cross-organization cases their teeth. A statement it does not know
 * throws, so a change to the leg's SQL surfaces here instead of passing
 * against a stale stand-in. The real-database counterpart is narrower: the
 * `checkChatConversationSearchLeg` lane of `backend:integration` proves the
 * subject, body and contact matches and the admin / own-row member / stranger
 * split on the live schema.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ChatConversationHit,
  searchConversationsForChat,
} from './search-chat.ts';

type Row = Record<string, unknown>;

interface World {
  members: { organizationId: string; userId: string; role: string }[];
  teams: { id: string; organizationId: string }[];
  teamMembers: { teamId: string; userId: string }[];
  contacts: {
    id: string;
    org_id: string;
    name: string | null;
    email: string | null;
    external_id: string | null;
    created_at_ms: number;
  }[];
  conversations: {
    id: string;
    org_id: string;
    subject: string | null;
    status: string | null;
    channel: string | null;
    last_message_at_ms: number | null;
    assignee_user_id: string | null;
    assignee_team_id: string | null;
    contact_id: string | null;
  }[];
  messages: {
    org_id: string;
    conversation_id: string;
    content: string;
    delivered_at_ms: number | null;
    seq: number;
  }[];
}

/** One table (or join) the leg reads: its rows keyed by the column names its
 * predicates use (quotes stripped), the one ORDER BY the fake implements for
 * it, and the SELECT list's projection. */
interface Table {
  from: string;
  rows: (world: World) => Row[];
  columns: readonly string[];
  orderBy?: { text: string; compare: (a: Row, b: Row) => number };
  project: (row: Row) => Row;
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const desc = (a: unknown, b: unknown): number => num(b) - num(a);
const descText = (a: unknown, b: unknown): number =>
  String(b).localeCompare(String(a));

const TABLES: readonly Table[] = [
  {
    from: 'FROM "member"',
    rows: (world) => world.members,
    columns: ['organizationId', 'userId'],
    project: (row) => ({ role: row.role }),
  },
  {
    from: 'FROM "teamMember" tm JOIN "team" t ON t."id" = tm."teamId"',
    rows: (world) =>
      world.teamMembers.flatMap((tm) =>
        world.teams
          .filter((team) => team.id === tm.teamId)
          .map((team) => ({
            'tm.teamId': tm.teamId,
            'tm.userId': tm.userId,
            't.organizationId': team.organizationId,
          })),
      ),
    columns: ['tm.userId', 't.organizationId'],
    project: (row) => ({ teamId: row['tm.teamId'] }),
  },
  {
    from: 'FROM app.contacts',
    rows: (world) => world.contacts,
    columns: ['org_id', 'name', 'email', 'external_id'],
    orderBy: {
      text: 'created_at_ms DESC',
      compare: (a, b) => desc(a.created_at_ms, b.created_at_ms),
    },
    project: (row) => ({
      _id: row.id,
      name: row.name,
      email: row.email,
      externalId: row.external_id,
    }),
  },
  {
    from: 'FROM app.conversation_messages',
    rows: (world) => world.messages,
    columns: ['org_id'],
    orderBy: {
      text: 'delivered_at_ms DESC NULLS LAST, seq DESC',
      compare: (a, b) =>
        (a.delivered_at_ms === null ? 1 : 0) -
          (b.delivered_at_ms === null ? 1 : 0) ||
        desc(a.delivered_at_ms, b.delivered_at_ms) ||
        desc(a.seq, b.seq),
    },
    project: (row) => ({
      conversationId: row.conversation_id,
      content: row.content,
    }),
  },
  {
    from: 'FROM app.conversations',
    rows: (world) => world.conversations,
    columns: ['org_id'],
    orderBy: {
      text: 'coalesce(last_message_at_ms, 0) DESC, id DESC',
      compare: (a, b) =>
        desc(a.last_message_at_ms, b.last_message_at_ms) ||
        descText(a.id, b.id),
    },
    project: (row) => ({
      _id: row.id,
      subject: row.subject,
      status: row.status,
      channel: row.channel,
      lastMessageAt: row.last_message_at_ms,
      assigneeUserId: row.assignee_user_id,
      assigneeTeamId: row.assignee_team_id,
      contactId: row.contact_id,
    }),
  },
];

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const unquote = (column: string): string => column.replaceAll('"', '');

const escapeRegExp = (char: string): string =>
  char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A Postgres LIKE pattern (escape character `\`) as an ILIKE regex. */
function likeToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '\\') {
      index += 1;
      source += escapeRegExp(pattern.charAt(index));
    } else if (char === '%') source += '.*';
    else if (char === '_') source += '.';
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`, 'is');
}

function evaluate(
  world: World,
  strings: TemplateStringsArray,
  values: unknown[],
): Row[] {
  const text = collapse(strings.join('?'));
  const table = TABLES.find((candidate) => text.includes(candidate.from));
  if (!table) throw new Error(`the fake knows no such statement: ${text}`);

  const equalities: [string, unknown][] = [];
  const likes: [string, string[]][] = [];
  let limit = Number.POSITIVE_INFINITY;
  values.forEach((value, index) => {
    const before = collapse(strings[index] ?? '');
    const equality = /([\w."]+) =$/.exec(before);
    const like = /([\w."]+) ILIKE ANY\($/.exec(before);
    if (equality?.[1] !== undefined) {
      equalities.push([unquote(equality[1]), value]);
    } else if (like?.[1] !== undefined && Array.isArray(value)) {
      likes.push([unquote(like[1]), value.map(String)]);
    } else if (before.endsWith('LIMIT')) {
      limit = Number(value);
    } else {
      throw new Error(
        `parameter ${index} binds nothing the fake reads: ${text}`,
      );
    }
  });
  const literalLimit = /\bLIMIT (\d+)\b/.exec(text)?.[1];
  if (literalLimit !== undefined) limit = Number(literalLimit);
  for (const [column] of [...equalities, ...likes]) {
    if (!table.columns.includes(column)) {
      throw new Error(`the fake has no column ${column}: ${text}`);
    }
  }

  // Every `col = ?` must hold; the ILIKE ANY predicates are one OR group,
  // which is how the contact leg writes them.
  let rows = table.rows(world).filter(
    (row) =>
      equalities.every(
        ([column, value]) => value !== null && row[column] === value,
      ) &&
      (likes.length === 0 ||
        likes.some(([column, patterns]) => {
          const cell = row[column];
          return (
            typeof cell === 'string' &&
            patterns.some((pattern) => likeToRegExp(pattern).test(cell))
          );
        })),
  );

  const orderBy = /ORDER BY (.+?)(?: LIMIT\b|$)/.exec(text)?.[1];
  if (orderBy !== undefined) {
    if (orderBy !== table.orderBy?.text) {
      throw new Error(`the fake implements no ORDER BY ${orderBy}: ${text}`);
    }
    rows = rows.toSorted(table.orderBy.compare);
  }
  return rows.slice(0, limit).map(table.project);
}

/** A `sql` stand-in answering from `world`, recording every statement. */
function worldSql(world: World) {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(collapse(strings.join('?')));
    return Promise.resolve(evaluate(world, strings, values));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

const ORG = 'org_chat_conv_leg';
const OTHER_ORG = 'org_chat_conv_leg_elsewhere';
const TEAM_X = 'team_x_chat_leg';
const FOREIGN_TEAM = 'team_chat_leg_elsewhere';
const ADMIN = 'user_chat_leg_admin';
const ORG_OWNER = 'user_chat_leg_org_owner';
const TEAM_MEMBER = 'user_chat_leg_team';
const ASSIGNEE = 'user_chat_leg_assignee';
const PLAIN_MEMBER = 'user_chat_leg_plain';

let world: World;
let nextId = 0;

function addConversation(seed: {
  subject: string;
  lastMessageAt: number;
  org?: string;
  assigneeUserId?: string;
  assigneeTeamId?: string;
  contactId?: string;
}): string {
  nextId += 1;
  const id = `conv_${String(nextId).padStart(4, '0')}`;
  world.conversations.push({
    id,
    org_id: seed.org ?? ORG,
    subject: seed.subject,
    status: 'open',
    channel: 'email',
    last_message_at_ms: seed.lastMessageAt,
    assignee_user_id: seed.assigneeUserId ?? null,
    assignee_team_id: seed.assigneeTeamId ?? null,
    contact_id: seed.contactId ?? null,
  });
  return id;
}

function addMessage(conversationId: string, content: string, at: number) {
  const conversation = world.conversations.find(
    (row) => row.id === conversationId,
  );
  world.messages.push({
    org_id: conversation?.org_id ?? ORG,
    conversation_id: conversationId,
    content,
    delivered_at_ms: at,
    seq: world.messages.length + 1,
  });
}

function addContact(name: string, org = ORG): string {
  nextId += 1;
  const id = `contact_${nextId}`;
  world.contacts.push({
    id,
    org_id: org,
    name,
    email: null,
    external_id: null,
    created_at_ms: nextId,
  });
  return id;
}

/** The 0.4 world: every subject shares the word "refund", so the text match is
 * never what distinguishes these rows — only the assignment scope is. */
function seedWorld(): void {
  nextId = 0;
  world = {
    members: [
      { organizationId: ORG, userId: ADMIN, role: 'admin' },
      { organizationId: ORG, userId: ORG_OWNER, role: 'owner' },
      { organizationId: ORG, userId: TEAM_MEMBER, role: 'member' },
      { organizationId: ORG, userId: ASSIGNEE, role: 'member' },
      { organizationId: ORG, userId: PLAIN_MEMBER, role: 'member' },
    ],
    teams: [{ id: TEAM_X, organizationId: ORG }],
    teamMembers: [{ teamId: TEAM_X, userId: TEAM_MEMBER }],
    contacts: [],
    conversations: [],
    messages: [],
  };
  addConversation({ subject: 'Refund pool unassigned', lastMessageAt: 400 });
  addConversation({
    subject: 'Refund queued to team X',
    assigneeTeamId: TEAM_X,
    lastMessageAt: 300,
  });
  addConversation({
    subject: 'Refund owned by a person',
    assigneeUserId: ASSIGNEE,
    lastMessageAt: 200,
  });
}

async function search(
  userId: string,
  term: string,
  options: { list?: boolean; limit?: number } = {},
) {
  const { sql, statements } = worldSql(world);
  const result = await searchConversationsForChat(sql, {
    organizationId: ORG,
    userId,
    term,
    limit: options.limit ?? 10,
    ...(options.list === true ? { list: true } : {}),
  });
  return { ...result, statements };
}

const subjects = (hits: ChatConversationHit[]): string[] =>
  hits.map((hit) => hit.subject ?? '').sort();

async function subjectsFor(userId: string, term = 'refund') {
  return subjects((await search(userId, term)).conversations);
}

beforeEach(seedWorld);

describe('searchConversationsForChat — assignment privacy', () => {
  // THE test. An unassigned conversation is admin-triage state, and a member
  // who is on no team and owns nothing must come back empty — not with the
  // inbox.
  it('shows a plain member nothing', async () => {
    expect(await subjectsFor(PLAIN_MEMBER)).toEqual([]);
  });

  it('shows an admin every matching conversation, unassigned included', async () => {
    expect(await subjectsFor(ADMIN)).toEqual([
      'Refund owned by a person',
      'Refund pool unassigned',
      'Refund queued to team X',
    ]);
  });

  it('shows the organization owner every matching conversation too', async () => {
    expect(await subjectsFor(ORG_OWNER)).toHaveLength(3);
  });

  it('shows the individual assignee only their own', async () => {
    expect(await subjectsFor(ASSIGNEE)).toEqual(['Refund owned by a person']);
  });

  it("shows a team member only their team's", async () => {
    expect(await subjectsFor(TEAM_MEMBER)).toEqual(['Refund queued to team X']);
  });

  it('shows the union to a person who is both assignee and on the team', async () => {
    world.teamMembers.push({ teamId: TEAM_X, userId: ASSIGNEE });
    expect(await subjectsFor(ASSIGNEE)).toEqual([
      'Refund owned by a person',
      'Refund queued to team X',
    ]);
  });

  // 0.4 could not reach these two: its role resolver fell back to a Better
  // Auth component convex-test did not register. The membership read is in
  // the leg now, so the refusal is provable here.
  it('answers a caller with no membership nothing, without scanning', async () => {
    const result = await search('user_chat_leg_stranger', 'refund');
    expect(result.conversations).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain('FROM "member"');
  });

  it('answers a disabled member nothing, not even the rows assigned to them', async () => {
    const assignee = world.members.find((member) => member.userId === ASSIGNEE);
    if (assignee) assignee.role = 'disabled';
    const result = await search(ASSIGNEE, 'refund');
    expect(result.conversations).toEqual([]);
    expect(result.statements).toHaveLength(1);
  });

  // One team lookup at most, and only when a decision depends on it.
  it("never reads an admin's teams", async () => {
    const result = await search(ADMIN, 'refund');
    expect(
      result.statements.some((text) => text.includes('"teamMember"')),
    ).toBe(false);
  });

  it('reads a member’s teams once per search, however many rows need them', async () => {
    addConversation({
      subject: 'Refund also queued to team X',
      assigneeTeamId: TEAM_X,
      lastMessageAt: 250,
    });
    const result = await search(TEAM_MEMBER, 'refund');
    expect(subjects(result.conversations)).toEqual([
      'Refund also queued to team X',
      'Refund queued to team X',
    ]);
    expect(
      result.statements.filter((text) => text.includes('"teamMember"')),
    ).toHaveLength(1);
  });
});

describe('searchConversationsForChat — cross-organization isolation', () => {
  it('does not reach into another organization', async () => {
    world.members.push({
      organizationId: OTHER_ORG,
      userId: ADMIN,
      role: 'admin',
    });
    addConversation({
      org: OTHER_ORG,
      subject: 'Refund in a foreign org',
      assigneeUserId: ADMIN,
      lastMessageAt: 500,
    });
    expect(await subjectsFor(ADMIN)).not.toContain('Refund in a foreign org');
  });

  it("neither answers nor is crowded out by another organization's contacts and mail", async () => {
    // Ours: older, so only this organization's filter keeps them in reach.
    const ourContact = addContact('Wilhelmina Baker');
    addConversation({
      subject: 'Ours by contact',
      contactId: ourContact,
      lastMessageAt: 100,
    });
    const ourBody = addConversation({
      subject: 'Ours by body',
      lastMessageAt: 100,
    });
    addMessage(ourBody, 'The chassis serial is XJ-4417.', 100);

    // Theirs: newer, and more of it than either pre-pass may read — a leg
    // that lost its organization filter would spend its cap on these.
    const theirs = addConversation({
      org: OTHER_ORG,
      subject: 'A foreign subject',
      assigneeUserId: ADMIN,
      lastMessageAt: 500,
    });
    for (let index = 0; index < 30; index += 1) {
      const contactId = addContact(`Wilhelmina Foreign ${index}`, OTHER_ORG);
      addConversation({
        org: OTHER_ORG,
        subject: `Foreign contact ${index}`,
        assigneeUserId: ADMIN,
        contactId,
        lastMessageAt: 500,
      });
    }
    for (let index = 0; index < 401; index += 1) {
      addMessage(theirs, `Serial XJ-4417, copy ${index}.`, 1_000 + index);
    }

    expect(await subjectsFor(ADMIN, 'wilhelmina')).toEqual(['Ours by contact']);
    const byBody = await search(ADMIN, 'XJ-4417');
    expect(subjects(byBody.conversations)).toEqual(['Ours by body']);
    expect(byBody.truncated).toBe(false);
  });

  it('reads the role per organization: an admin elsewhere is a member here', async () => {
    // Listed first, so a membership read that lost its organization filter
    // would pick this row up.
    world.members.unshift({
      organizationId: OTHER_ORG,
      userId: PLAIN_MEMBER,
      role: 'admin',
    });
    expect(await subjectsFor(PLAIN_MEMBER)).toEqual([]);
  });

  it('answers an admin of another organization nothing here', async () => {
    world.members.push({
      organizationId: OTHER_ORG,
      userId: 'user_chat_leg_foreign_admin',
      role: 'admin',
    });
    const result = await search('user_chat_leg_foreign_admin', 'refund');
    expect(result.conversations).toEqual([]);
  });

  it("grants nothing through another organization's team", async () => {
    world.teams.push({ id: FOREIGN_TEAM, organizationId: OTHER_ORG });
    world.teamMembers.push({ teamId: FOREIGN_TEAM, userId: PLAIN_MEMBER });
    // A stamp naming a team this organization does not own must not open the
    // row to that team's members.
    addConversation({
      subject: 'Refund stamped with a foreign team',
      assigneeTeamId: FOREIGN_TEAM,
      lastMessageAt: 500,
    });
    expect(await subjectsFor(PLAIN_MEMBER)).toEqual([]);
  });
});

describe('searchConversationsForChat — the contact leg', () => {
  it('finds a conversation by its contact name, not only its subject', async () => {
    const contactId = addContact('Wilhelmina Baker');
    addConversation({
      subject: 'A subject sharing no words with the query',
      assigneeUserId: ASSIGNEE,
      contactId,
      lastMessageAt: 600,
    });
    expect(await subjectsFor(ASSIGNEE, 'wilhelmina')).toEqual([
      'A subject sharing no words with the query',
    ]);
  });

  it('still applies assignment scope to a contact-name match', async () => {
    const contactId = addContact('Wilhelmina Baker');
    // Unassigned: findable by contact name for an admin, invisible to a plain
    // member. The contact match must not become a second way in.
    addConversation({
      subject: 'Unassigned but contact matches',
      contactId,
      lastMessageAt: 700,
    });
    expect(await subjectsFor(PLAIN_MEMBER, 'wilhelmina')).toEqual([]);
    expect(await subjectsFor(TEAM_MEMBER, 'wilhelmina')).toEqual([]);
    expect(await subjectsFor(ADMIN, 'wilhelmina')).toEqual([
      'Unassigned but contact matches',
    ]);
  });

  it("scopes a team-queued contact match to that team's members", async () => {
    const contactId = addContact('Wilhelmina Baker');
    addConversation({
      subject: 'Queued and contact matches',
      assigneeTeamId: TEAM_X,
      contactId,
      lastMessageAt: 700,
    });
    expect(await subjectsFor(TEAM_MEMBER, 'wilhelmina')).toEqual([
      'Queued and contact matches',
    ]);
    expect(await subjectsFor(ASSIGNEE, 'wilhelmina')).toEqual([]);
  });
});

describe('searchConversationsForChat — the assignment is returned', () => {
  // Observed in production: asked "what team is this assigned to", chat could
  // find the conversation and could not say. The assignment is the field this
  // leg's whole privacy rule is built on, and it was withheld from the answer.
  async function hit(subject: string) {
    const result = await search(ADMIN, 'refund');
    return result.conversations.find((row) => row.subject === subject);
  }

  it('names the team a conversation is queued to', async () => {
    const queued = await hit('Refund queued to team X');
    expect(queued?.assigneeTeamId).toBe(TEAM_X);
    expect(queued).not.toHaveProperty('assigneeUserId');
  });

  it('names the person a conversation is owned by', async () => {
    const owned = await hit('Refund owned by a person');
    expect(owned?.assigneeUserId).toBe(ASSIGNEE);
    expect(owned).not.toHaveProperty('assigneeTeamId');
  });

  it('returns neither field for an unassigned conversation', async () => {
    const pool = await hit('Refund pool unassigned');
    expect(pool).toBeDefined();
    expect(pool).not.toHaveProperty('assigneeUserId');
    expect(pool).not.toHaveProperty('assigneeTeamId');
  });

  it('returns only the answer fields — never the contact the row is with', async () => {
    const contactId = addContact('Wilhelmina Baker');
    addConversation({
      subject: 'Refund with a contact',
      assigneeUserId: ASSIGNEE,
      contactId,
      lastMessageAt: 100,
    });
    const row = await hit('Refund with a contact');
    expect(Object.keys(row ?? {}).sort()).toEqual([
      '_id',
      'assigneeUserId',
      'channel',
      'lastMessageAt',
      'status',
      'subject',
    ]);
  });
});

describe('searchConversationsForChat — explicit list mode', () => {
  const listFor = (userId: string, limit = 10) =>
    search(userId, '', { list: true, limit });

  it('lists without any words — the text predicate is off', async () => {
    const result = await listFor(ADMIN);
    expect(subjects(result.conversations)).toEqual([
      'Refund owned by a person',
      'Refund pool unassigned',
      'Refund queued to team X',
    ]);
    expect(result.truncated).toBe(false);
  });

  // Turning the words off must not turn the privacy off: the listing passes
  // exactly the same assignment predicate as the search.
  it('shows a plain member nothing, listed or searched', async () => {
    expect((await listFor(PLAIN_MEMBER)).conversations).toEqual([]);
  });

  it('shows a team member their team queue only', async () => {
    const result = await listFor(TEAM_MEMBER);
    expect(subjects(result.conversations)).toEqual(['Refund queued to team X']);
  });

  it('honours the limit, newest first', async () => {
    const result = await listFor(ADMIN, 2);
    expect(result.conversations.map((row) => row.subject)).toEqual([
      'Refund pool unassigned',
      'Refund queued to team X',
    ]);
    // The limit-break is NOT the scan cap: truncated stays false, which is
    // why the caller overfetches by one to detect a fuller inbox.
    expect(result.truncated).toBe(false);
  });

  it('reports truncation when the walk itself reaches the scan cap', async () => {
    // 300 is the cap; 301 unassigned rows the plain member may not read make
    // the walk run out before it finds anything.
    for (let index = 0; index < 301; index += 1) {
      addConversation({
        subject: `Triage ${index}`,
        lastMessageAt: 1_000 + index,
      });
    }
    const plain = await listFor(PLAIN_MEMBER);
    expect(plain.conversations).toEqual([]);
    expect(plain.truncated).toBe(true);
    // The same inbox answered in full before the cap is not partial.
    const admin = await listFor(ADMIN, 5);
    expect(admin.conversations).toHaveLength(5);
    expect(admin.truncated).toBe(false);
  });

  // Search behavior is untouched: term '' without the flag still matches
  // nothing, because an empty token list passes no row in 'any' mode.
  it('keeps the searchless empty result without the flag', async () => {
    expect((await search(ADMIN, '')).conversations).toEqual([]);
    expect((await search(ADMIN, '   ')).conversations).toEqual([]);
  });
});

describe('searchConversationsForChat — the message-body leg', () => {
  /** A conversation whose SUBJECT cannot match the term, so any hit proves
   * the body leg found it. */
  function seedWithBody(
    body: string,
    assignment: { assigneeUserId?: string; assigneeTeamId?: string } = {},
  ): string {
    const id = addConversation({
      subject: 'Nothing matching here',
      lastMessageAt: 500,
      ...assignment,
    });
    addMessage(id, body, 500);
    return id;
  }

  it('finds a conversation by a word only its message body contains', async () => {
    seedWithBody('The chassis serial is XJ-4417.', {
      assigneeUserId: ASSIGNEE,
    });
    expect(await subjectsFor(ASSIGNEE, 'XJ-4417')).toEqual([
      'Nothing matching here',
    ]);
  });

  it('still refuses a body match the caller may not read', async () => {
    // The body walk sees every message in the organization, so this is the
    // case that matters: matching is not reading.
    seedWithBody('The chassis serial is XJ-4417.', {
      assigneeUserId: ASSIGNEE,
    });
    const found = await search(PLAIN_MEMBER, 'XJ-4417');
    expect(found.conversations).toEqual([]);
    // …and nothing about the discarded match leaks as a partial answer.
    expect(found.truncated).toBe(false);
    expect(await subjectsFor(TEAM_MEMBER, 'XJ-4417')).toEqual([]);
  });

  it('refuses an unassigned body match to everyone but an admin', async () => {
    seedWithBody('The chassis serial is XJ-4417.');
    expect(await subjectsFor(ASSIGNEE, 'XJ-4417')).toEqual([]);
    expect(await subjectsFor(TEAM_MEMBER, 'XJ-4417')).toEqual([]);
    expect(await subjectsFor(ADMIN, 'XJ-4417')).toEqual([
      'Nothing matching here',
    ]);
  });

  it('matches through HTML rather than against its markup', async () => {
    seedWithBody('<div><p>The chassis serial is <b>XJ-4417</b>.</p></div>', {
      assigneeUserId: ASSIGNEE,
    });
    expect(await subjectsFor(ASSIGNEE, 'XJ-4417')).toEqual([
      'Nothing matching here',
    ]);
    // The tags never survive into the matched text.
    expect(await subjectsFor(ASSIGNEE, 'serial is XJ-4417')).toEqual([
      'Nothing matching here',
    ]);
  });

  it('does not match a word that exists only in the markup', async () => {
    // Without stripping, a search for "div" would hit every HTML mail.
    seedWithBody('<div><p>Nothing useful.</p></div>', {
      assigneeUserId: ASSIGNEE,
    });
    expect(await subjectsFor(ASSIGNEE, 'div')).toEqual([]);
  });

  it('reports truncation from the body walk, not just the conversation walk', async () => {
    // 401 messages against a 400 cap. A caller told "no matches" must be able
    // to tell that from "no matches in what I looked at".
    const id = addConversation({
      subject: 'Nothing matching here',
      assigneeUserId: ASSIGNEE,
      lastMessageAt: 1,
    });
    for (let index = 0; index < 401; index += 1) {
      addMessage(id, `filler ${index}`, 1_000 + index);
    }
    const found = await search(ASSIGNEE, 'nonexistent-term');
    expect(found.conversations).toEqual([]);
    expect(found.truncated).toBe(true);
  });

  it('reads only the newest messages: a match past the cap is invisible', async () => {
    const id = seedWithBody('The chassis serial is XJ-4417.', {
      assigneeUserId: ASSIGNEE,
    });
    for (let index = 0; index < 400; index += 1) {
      addMessage(id, `filler ${index}`, 1_000 + index);
    }
    const found = await search(ASSIGNEE, 'XJ-4417');
    expect(found.conversations).toEqual([]);
    expect(found.truncated).toBe(true);
  });

  it('skips the body walk entirely for a listing', async () => {
    // A listing has no term, so there is nothing to match and no reason to
    // pay for the walk.
    seedWithBody('irrelevant', { assigneeUserId: ASSIGNEE });
    const found = await search(ASSIGNEE, '', { list: true });
    expect(found.truncated).toBe(false);
    expect(found.conversations.length).toBeGreaterThan(0);
    expect(
      found.statements.some(
        (text) =>
          text.includes('app.conversation_messages') ||
          text.includes('app.contacts'),
      ),
    ).toBe(false);
  });
});
