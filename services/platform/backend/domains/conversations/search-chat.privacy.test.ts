/**
 * The chat assistant's conversations leg must keep assignment privacy — the
 * 0.4 suite (`convex/conversations/search_for_chat.test.ts`) ported to the
 * Postgres leg. The leg reads every row of the organization it scans and lets
 * `conversationAssignmentAllows` alone decide what the caller sees: nothing
 * upstream of it enforces assignment privacy, so a mistake here publishes the
 * whole inbox to any member.
 *
 * 0.4 proved it end to end through convex-test over a seeded world. Here
 * {@link worldSql} plays that part: an in-memory world that parses each
 * statement the leg issues — its SELECT list, its FROM, its WHERE clause as
 * the AND/OR tree it is written as, its ORDER BY and its LIMIT — and answers
 * it the way Postgres would. It applies ONLY the predicates the SQL carries,
 * combined the way the SQL combines them, and returns ONLY the columns the
 * SELECT names. Drop an `org_id` filter, turn an `AND` into an `OR`, or drop
 * a column from a projection, and the answer changes exactly as the
 * database's would — which is what gives the cross-organization and
 * assignment cases their teeth. Anything outside that small grammar throws: a
 * predicate that is not `col = ?` or `col ILIKE ANY(?::text[])` (a literal
 * comparison, `IS NULL`, `<>`), a FROM or join it does not model, a cast or an
 * ORDER BY it does not implement, a parameter it cannot place, a LIMIT that
 * would cut rows no ORDER BY ranks. A read with no ORDER BY comes back in
 * reverse seeding order, because Postgres promises no order either. So a
 * change to the leg's SQL surfaces here instead of passing against a stale
 * stand-in. The two reads of the API-key owners the shared membership
 * readers make are the one exception, answered by their exact text (see
 * {@link answerKeyOwners}) — and the person's half of the acting audience
 * still runs through the grammar.
 *
 * The real-database counterpart is narrower: the
 * `checkChatConversationSearchLeg` lane of `backend:integration` (the
 * Backend integration check) proves the subject, body and contact matches
 * and the admin / own-row member / stranger split on the live schema.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ChatConversationHit,
  searchConversationsForChat,
} from './search-chat.ts';

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

interface World {
  members: { organizationId: string; userId: string; role: string }[];
  /** API keys that are their own identity (`app.api_key_owners`): a team's,
   * a project's or the organization's, each acting with a role. */
  apiKeys: {
    id: string;
    organizationId: string;
    kind: 'team' | 'project' | 'organization';
    principalUserId: string;
    teamId: string | null;
    projectId: string | null;
    role: string;
    revoked: boolean;
  }[];
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

/** One table (or join) the leg reads: the exact FROM clause it answers, its
 * rows keyed by every column it carries — named the way the statements name
 * them, qualified for a join, quotes stripped — and the one ORDER BY the fake
 * implements for it. */
interface Table {
  from: string;
  rows: (world: World) => Row[];
  columns: readonly string[];
  orderBy?: { text: string; compare: (a: Row, b: Row) => number };
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const desc = (a: unknown, b: unknown): number => num(b) - num(a);
const descText = (a: unknown, b: unknown): number =>
  String(b).localeCompare(String(a));

const TABLES: readonly Table[] = [
  {
    from: '"member"',
    rows: (world) =>
      world.members.map((member) => ({
        id: `member_${member.organizationId}_${member.userId}`,
        ...member,
      })),
    columns: ['id', 'organizationId', 'userId', 'role'],
  },
  {
    from: '"teamMember" tm JOIN "team" t ON t."id" = tm."teamId"',
    rows: (world) =>
      world.teamMembers.flatMap((tm) =>
        world.teams
          .filter((team) => team.id === tm.teamId)
          .map((team) => ({
            'tm.teamId': tm.teamId,
            'tm.userId': tm.userId,
            't.id': team.id,
            't.organizationId': team.organizationId,
          })),
      ),
    columns: ['tm.teamId', 'tm.userId', 't.id', 't.organizationId'],
  },
  {
    from: 'app.contacts',
    rows: (world) => world.contacts,
    columns: ['id', 'org_id', 'name', 'email', 'external_id', 'created_at_ms'],
    orderBy: {
      text: 'created_at_ms DESC',
      compare: (a, b) => desc(a.created_at_ms, b.created_at_ms),
    },
  },
  {
    from: 'app.conversation_messages',
    rows: (world) => world.messages,
    columns: ['org_id', 'conversation_id', 'content', 'delivered_at_ms', 'seq'],
    orderBy: {
      text: 'delivered_at_ms DESC NULLS LAST, seq DESC',
      compare: (a, b) =>
        (a.delivered_at_ms === null ? 1 : 0) -
          (b.delivered_at_ms === null ? 1 : 0) ||
        desc(a.delivered_at_ms, b.delivered_at_ms) ||
        desc(a.seq, b.seq),
    },
  },
  {
    from: 'app.conversations',
    rows: (world) => world.conversations,
    columns: [
      'id',
      'org_id',
      'subject',
      'status',
      'channel',
      'last_message_at_ms',
      'assignee_user_id',
      'assignee_team_id',
      'contact_id',
    ],
    orderBy: {
      text: 'coalesce(last_message_at_ms, 0) DESC, id DESC',
      compare: (a, b) =>
        desc(a.last_message_at_ms, b.last_message_at_ms) ||
        descText(a.id, b.id),
    },
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

/** The one statement shape the leg issues; `?` marks each bound parameter. */
const STATEMENT =
  /^SELECT (?<select>.+?) FROM (?<from>.+?)(?: WHERE (?<where>.+?))?(?: ORDER BY (?<orderBy>.+?))?(?: LIMIT (?<limit>\?|\d+))?$/;

/** A SELECT item: a column, optionally cast, optionally aliased. */
const SELECT_ITEM =
  /^(?<column>(?:\w+\.)?"?\w+"?)(?:::(?<cast>\w+))?(?: AS "?(?<alias>\w+)"?)?$/;

function columnOf(table: Table, name: string, text: string): string {
  const column = unquote(name);
  if (!table.columns.includes(column)) {
    throw new Error(`the fake has no column ${column}: ${text}`);
  }
  return column;
}

/** The SELECT list as a projection: only the named columns come back, under
 * the name Postgres gives them (the alias, else the bare column name). */
function parseSelect(
  table: Table,
  select: string,
  text: string,
): (row: Row) => Row {
  const items = select.split(',').map((item) => {
    const groups = SELECT_ITEM.exec(item.trim())?.groups;
    if (groups?.column === undefined) {
      throw new Error(`the fake cannot project ${item.trim()}: ${text}`);
    }
    if (groups.cast !== undefined && groups.cast !== 'float8') {
      throw new Error(`the fake implements no cast ::${groups.cast}: ${text}`);
    }
    const source = columnOf(table, groups.column, text);
    const alias = groups.alias ?? source.split('.').pop() ?? source;
    return { source, alias, numeric: groups.cast === 'float8' };
  });
  return (row) =>
    Object.fromEntries(
      items.map(({ source, alias, numeric }) => {
        const value = row[source];
        return [alias, numeric && value !== null ? Number(value) : value];
      }),
    );
}

/**
 * The WHERE clause as the boolean tree it is written as — `OR` binding looser
 * than `AND`, parentheses grouping — over the only two predicates the leg
 * uses. NULL never equals anything, as in SQL; with no `NOT` in the grammar,
 * treating UNKNOWN as false filters exactly as Postgres does.
 */
function parseWhere(
  table: Table,
  where: string,
  bind: () => unknown,
  text: string,
): Predicate {
  const tokens = [
    ...where.matchAll(/"[^"]*"|[A-Za-z_]\w*|::\w+(?:\[\])?|\S/g),
  ].map((match) => match[0]);
  let at = 0;
  const peek = (): string | undefined => tokens[at]?.toUpperCase();
  const take = (expected?: string): string => {
    const token = tokens[at];
    if (
      token === undefined ||
      (expected !== undefined && token.toUpperCase() !== expected)
    ) {
      throw new Error(
        `the fake cannot read WHERE ${where} at ${token ?? 'its end'}` +
          `${expected === undefined ? '' : ` (wanted ${expected})`}: ${text}`,
      );
    }
    at += 1;
    return token;
  };
  const column = (): string => {
    let name = take();
    if (peek() === '.') {
      take('.');
      name = `${name}.${take()}`;
    }
    return columnOf(table, name, text);
  };
  const factor = (): Predicate => {
    if (peek() === '(') {
      take('(');
      const inner = disjunction();
      take(')');
      return inner;
    }
    const name = column();
    if (peek() === '=') {
      take('=');
      take('?');
      const value = bind();
      return (row) => value !== null && row[name] === value;
    }
    if (peek() !== 'ILIKE') {
      throw new Error(
        `the fake reads only \`col = ?\` and \`col ILIKE ANY(?::text[])\`, not ${where}: ${text}`,
      );
    }
    for (const token of ['ILIKE', 'ANY', '(', '?', '::TEXT[]', ')']) {
      take(token);
    }
    const patterns = bind();
    if (!Array.isArray(patterns)) {
      throw new Error(`ILIKE ANY binds no array: ${text}`);
    }
    const expressions = patterns.map((pattern) =>
      likeToRegExp(String(pattern)),
    );
    return (row) => {
      const cell = row[name];
      return (
        typeof cell === 'string' &&
        expressions.some((expression) => expression.test(cell))
      );
    };
  };
  const conjunction = (): Predicate => {
    const parts = [factor()];
    while (peek() === 'AND') {
      take('AND');
      parts.push(factor());
    }
    return (row) => parts.every((part) => part(row));
  };
  const disjunction = (): Predicate => {
    const parts = [conjunction()];
    while (peek() === 'OR') {
      take('OR');
      parts.push(conjunction());
    }
    return (row) => parts.some((part) => part(row));
  };
  const predicate = disjunction();
  if (at !== tokens.length) {
    throw new Error(
      `the fake cannot read WHERE ${where} at ${tokens[at]}: ${text}`,
    );
  }
  return predicate;
}

function evaluate(world: World, text: string, values: unknown[]): Row[] {
  const parts = STATEMENT.exec(text)?.groups;
  const table = TABLES.find((candidate) => candidate.from === parts?.from);
  if (parts?.select === undefined || !table) {
    throw new Error(`the fake knows no such statement: ${text}`);
  }

  let bound = 0;
  const bind = (): unknown => {
    if (bound >= values.length) {
      throw new Error(`the statement binds fewer parameters: ${text}`);
    }
    bound += 1;
    return values[bound - 1];
  };
  const project = parseSelect(table, parts.select, text);
  const matches =
    parts.where === undefined
      ? () => true
      : parseWhere(table, parts.where, bind, text);
  let limit = Number.POSITIVE_INFINITY;
  if (parts.limit !== undefined) {
    limit = Number(parts.limit === '?' ? bind() : parts.limit);
  }
  if (bound !== values.length) {
    throw new Error(
      `the fake placed ${bound} of ${values.length} parameters: ${text}`,
    );
  }

  let rows = table.rows(world).filter(matches);
  if (parts.orderBy === undefined) {
    // Without ORDER BY, Postgres promises no order, so this fake gives the
    // least convenient one: the reverse of how the world was seeded. And a
    // LIMIT that would cut such a result keeps rows the heap chose, which no
    // case may rely on.
    if (rows.length > limit) {
      throw new Error(
        `LIMIT ${limit} cuts ${rows.length} unordered rows: ${text}`,
      );
    }
    rows = rows.toReversed();
  } else {
    if (parts.orderBy !== table.orderBy?.text) {
      throw new Error(
        `the fake implements no ORDER BY ${parts.orderBy}: ${text}`,
      );
    }
    rows = rows.toSorted(table.orderBy.compare);
  }
  return rows.slice(0, limit).map(project);
}

/** `readServicePrincipal`: the live key whose own identity a user id is. */
const KEY_IDENTITY_READ =
  'SELECT o.api_key_id AS "apiKeyId", o.org_id AS "organizationId", o.owner_kind AS "kind", o.key_user_id AS "keyUserId", o.principal_user_id AS "principalUserId", o.team_id AS "teamId", o.project_id AS "projectId", o.role, o.name, o.created_by AS "createdBy", o.created_at_ms AS "createdAt", o.revoked_at_ms AS "revokedAt", o.revoked_by AS "revokedBy" FROM app.api_key_owners o JOIN "apikey" k ON k."id" = o.api_key_id WHERE o.key_user_id = ? AND o.owner_kind <> \'member\' AND o.revoked_at_ms IS NULL AND k."enabled" IS NOT FALSE AND (k."expiresAt" IS NULL OR k."expiresAt" > now()) LIMIT 1';

/** `readActingAudience`: a person's teams, UNION the audience of a key that
 * is its own identity — a team's key its team (while the team lives in this
 * organization), a project's key its project. */
const AUDIENCE_PERSON_PROJECTION = ', NULL::text AS "projectId"';
const AUDIENCE_KEY_LEG =
  'SELECT o.team_id, o.project_id FROM app.api_key_owners o LEFT JOIN "team" t ON t."id" = o.team_id AND t."organizationId" = o.org_id WHERE o.principal_user_id = ? AND o.org_id = ? AND o.revoked_at_ms IS NULL AND ((o.owner_kind = \'team\' AND t."id" IS NOT NULL) OR o.owner_kind = \'project\')';

/**
 * The two statements that read the API-key owners, outside the grammar
 * above and so answered by their exact text: any edit to either throws here
 * until this stand-in is taught it. The audience's person half — the
 * `teamMember` join every organization filter rides on — still runs through
 * the grammar.
 */
function answerKeyOwners(world: World, text: string, values: unknown[]): Row[] {
  if (text === KEY_IDENTITY_READ) {
    const [userId] = values;
    return world.apiKeys
      .filter((key) => key.principalUserId === userId && !key.revoked)
      .slice(0, 1)
      .map((key) => ({
        apiKeyId: key.id,
        organizationId: key.organizationId,
        kind: key.kind,
        keyUserId: key.principalUserId,
        principalUserId: key.principalUserId,
        teamId: key.teamId,
        projectId: key.projectId,
        role: key.role,
        name: key.id,
        createdBy: ADMIN,
        createdAt: 1,
        revokedAt: null,
        revokedBy: null,
      }));
  }
  const [personLeg, keyLeg, ...rest] = text.split(' UNION ');
  if (
    personLeg === undefined ||
    !personLeg.includes(AUDIENCE_PERSON_PROJECTION) ||
    keyLeg !== AUDIENCE_KEY_LEG ||
    rest.length > 0
  ) {
    throw new Error(`the fake knows no such API-key owners read: ${text}`);
  }
  const personParams = personLeg.split('?').length - 1;
  const personTeams = evaluate(
    world,
    personLeg.replace(AUDIENCE_PERSON_PROJECTION, ''),
    values.slice(0, personParams),
  ).map((row) => Object.assign(row, { projectId: null }));
  const [userId, organizationId, ...extra] = values.slice(personParams);
  if (extra.length > 0) {
    throw new Error(`the statement binds more parameters: ${text}`);
  }
  const keyAudience = world.apiKeys
    .filter(
      (key) =>
        key.principalUserId === userId &&
        key.organizationId === organizationId &&
        !key.revoked &&
        ((key.kind === 'team' &&
          world.teams.some(
            (team) =>
              team.id === key.teamId && team.organizationId === organizationId,
          )) ||
          key.kind === 'project'),
    )
    .map((key) => ({ teamId: key.teamId, projectId: key.projectId }));
  return [...personTeams, ...keyAudience];
}

/** A `sql` stand-in answering from `world`, recording every statement. A
 * statement the fake cannot read rejects, as a failing query would. */
function worldSql(world: World) {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = collapse(strings.join('?'));
    statements.push(text);
    return new Promise<Row[]>((resolve) => {
      resolve(
        text.includes('app.api_key_owners')
          ? answerKeyOwners(world, text, values)
          : evaluate(world, text, values),
      );
    });
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

function addContact(
  name: string,
  extra: { org?: string; email?: string; externalId?: string } = {},
): string {
  nextId += 1;
  const id = `contact_${nextId}`;
  world.contacts.push({
    id,
    org_id: extra.org ?? ORG,
    name,
    email: extra.email ?? null,
    external_id: extra.externalId ?? null,
    created_at_ms: nextId,
  });
  return id;
}

/** The 0.4 world: every subject shares the word "refund", so the text match is
 * never what distinguishes these rows — only the assignment scope is. Seeded
 * neither newest nor oldest first, so the order an answer comes back in is
 * the scan's ORDER BY and nothing else. */
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
    apiKeys: [],
    teams: [{ id: TEAM_X, organizationId: ORG }],
    teamMembers: [{ teamId: TEAM_X, userId: TEAM_MEMBER }],
    contacts: [],
    conversations: [],
    messages: [],
  };
  addConversation({
    subject: 'Refund queued to team X',
    assigneeTeamId: TEAM_X,
    lastMessageAt: 300,
  });
  addConversation({ subject: 'Refund pool unassigned', lastMessageAt: 400 });
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

describe('searchConversationsForChat — assignment privacy [CONV-R2]', () => {
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

  // One row carrying both stamps: the leg must hand the predicate both, so the
  // team reaches it without the person and the person without the team.
  it('opens a row stamped with a person and a team to each of them', async () => {
    addConversation({
      subject: 'Refund owned and queued',
      assigneeUserId: ASSIGNEE,
      assigneeTeamId: TEAM_X,
      lastMessageAt: 100,
    });
    expect(await subjectsFor(TEAM_MEMBER)).toEqual([
      'Refund owned and queued',
      'Refund queued to team X',
    ]);
    // ASSIGNEE is on no team here.
    expect(await subjectsFor(ASSIGNEE)).toEqual([
      'Refund owned and queued',
      'Refund owned by a person',
    ]);
    expect(await subjectsFor(PLAIN_MEMBER)).toEqual([]);
  });

  // 0.4 could not reach these two: its role resolver fell back to a Better
  // Auth component convex-test did not register. The membership read is in
  // the leg now, so the refusal is provable here.
  it('answers a caller with no membership nothing, without scanning', async () => {
    const result = await search('user_chat_leg_stranger', 'refund');
    expect(result.conversations).toEqual([]);
    expect(result.truncated).toBe(false);
    // The membership, then whether the caller is an API key's own identity.
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain('FROM "member"');
    expect(result.statements[1]).toBe(KEY_IDENTITY_READ);
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

/**
 * A team's, a project's or the organization's API key is no member: it acts
 * with the role it was made with, and sees with the audience it was given —
 * the same inbox the REST door shows it.
 */
describe('searchConversationsForChat — API keys that are their own identity [APIKEY-R6]', () => {
  const KEY_USER = 'user_chat_leg_key_identity';
  function addKey(
    seed: Partial<World['apiKeys'][number]> &
      Pick<World['apiKeys'][number], 'kind' | 'role'>,
  ) {
    world.apiKeys.push({
      id: `key_${world.apiKeys.length + 1}`,
      organizationId: ORG,
      principalUserId: KEY_USER,
      teamId: null,
      projectId: null,
      revoked: false,
      ...seed,
    });
  }

  it('shows a team’s key its team’s queue only', async () => {
    addKey({ kind: 'team', teamId: TEAM_X, role: 'member' });
    expect(await subjectsFor(KEY_USER)).toEqual(['Refund queued to team X']);
  });

  it('shows the organization’s key what its role shows', async () => {
    addKey({ kind: 'organization', role: 'admin' });
    expect(await subjectsFor(KEY_USER)).toHaveLength(3);
    world.apiKeys = [];
    addKey({ kind: 'organization', role: 'developer' });
    // No team and no row of its own: like a plain member, nothing.
    expect(await subjectsFor(KEY_USER)).toEqual([]);
  });

  it('shows a project’s key nothing, without scanning', async () => {
    addKey({ kind: 'project', projectId: 'project_1', role: 'developer' });
    const result = await search(KEY_USER, 'refund');
    expect(result.conversations).toEqual([]);
    expect(
      result.statements.some((text) => text.includes('app.conversations')),
    ).toBe(false);
  });

  it('shows a revoked key, or one bound to another organization, nothing', async () => {
    addKey({ kind: 'organization', role: 'admin', revoked: true });
    expect(await subjectsFor(KEY_USER)).toEqual([]);
    world.apiKeys = [];
    addKey({ kind: 'organization', role: 'admin', organizationId: OTHER_ORG });
    expect(await subjectsFor(KEY_USER)).toEqual([]);
  });

  it('grants a team’s key nothing through a team of another organization', async () => {
    addKey({ kind: 'team', teamId: FOREIGN_TEAM, role: 'member' });
    world.teams.push({ id: FOREIGN_TEAM, organizationId: OTHER_ORG });
    addConversation({
      subject: 'Refund stamped with a foreign team',
      assigneeTeamId: FOREIGN_TEAM,
      lastMessageAt: 500,
    });
    expect(await subjectsFor(KEY_USER)).toEqual([]);
  });
});

describe('searchConversationsForChat — cross-organization isolation [CONV-R2]', () => {
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

    // Theirs: newer, and more of it than either pre-pass may keep — 30
    // matching contacts against the contact match cap (25), 401 messages
    // against the message scan cap (400). A leg that lost its organization
    // filter would spend its cap on these. Each foreign contact matches by
    // name, email AND external id, so the filter must hold over all three:
    // an `OR` that escapes the parentheses lets one column past it.
    const theirs = addConversation({
      org: OTHER_ORG,
      subject: 'A foreign subject',
      assigneeUserId: ADMIN,
      lastMessageAt: 500,
    });
    for (let index = 0; index < 30; index += 1) {
      const contactId = addContact(`Wilhelmina Foreign ${index}`, {
        org: OTHER_ORG,
        email: `wilhelmina.foreign${index}@elsewhere.test`,
        externalId: `wilhelmina-${index}`,
      });
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

describe('searchConversationsForChat — the subject match', () => {
  it('answers a search newest first', async () => {
    const found = await search(ADMIN, 'refund');
    expect(found.conversations.map((row) => row.subject)).toEqual([
      'Refund pool unassigned',
      'Refund queued to team X',
      'Refund owned by a person',
    ]);
  });

  // The chat hands the leg the user's question, not keywords: function words
  // drop out and any one remaining word that starts a subject word is a hit
  // (the 0.4 leg's 'any' mode). Requiring every word would match nothing here.
  it('matches a question by any one of its words', async () => {
    expect(await subjectsFor(ADMIN, 'what happened with the pool')).toEqual([
      'Refund pool unassigned',
    ]);
    expect(
      await subjectsFor(ADMIN, 'what happened with the refund pool'),
    ).toEqual([
      'Refund owned by a person',
      'Refund pool unassigned',
      'Refund queued to team X',
    ]);
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

  it('still applies assignment scope to a contact-name match [CONV-R2]', async () => {
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

  it('answers only the newest contacts past the contact match cap', async () => {
    // 26 contacts match against a cap of 25: the scan runs newest first, so
    // the oldest contact's conversation is the one left out.
    const conversationIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      conversationIds.push(
        addConversation({
          subject: `Contact case ${index}`,
          contactId: addContact(`Wilhelmina ${index}`),
          lastMessageAt: 600,
        }),
      );
    }
    const found = await search(ADMIN, 'wilhelmina', { limit: 50 });
    expect(found.conversations).toHaveLength(25);
    expect(found.conversations.map((row) => row._id)).not.toContain(
      conversationIds[0],
    );
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

  it('names both when a conversation is owned and queued at once', async () => {
    addConversation({
      subject: 'Refund owned and queued',
      assigneeUserId: ASSIGNEE,
      assigneeTeamId: TEAM_X,
      lastMessageAt: 100,
    });
    const both = await hit('Refund owned and queued');
    expect(both?.assigneeUserId).toBe(ASSIGNEE);
    expect(both?.assigneeTeamId).toBe(TEAM_X);
  });

  it('returns neither field for an unassigned conversation', async () => {
    const pool = await hit('Refund pool unassigned');
    expect(pool).toBeDefined();
    expect(pool).not.toHaveProperty('assigneeUserId');
    expect(pool).not.toHaveProperty('assigneeTeamId');
  });

  it('returns only the answer fields — never the contact the row is with [CONV-R2]', async () => {
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
  it('shows a plain member nothing, listed or searched [CONV-R2]', async () => {
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

  it('reports truncation when the walk itself reaches the scan cap [CONV-R2]', async () => {
    // 300 is the cap. With the three seeds, 297 unassigned rows the plain
    // member may not read make exactly 300: the walk reads them all and is
    // complete, even though it finds nothing.
    for (let index = 0; index < 297; index += 1) {
      addConversation({
        subject: `Triage ${index}`,
        lastMessageAt: 1_000 + index,
      });
    }
    const atCap = await listFor(PLAIN_MEMBER);
    expect(atCap.conversations).toEqual([]);
    expect(atCap.truncated).toBe(false);
    // One more row, and the walk runs out before the inbox does.
    addConversation({ subject: 'Triage 297', lastMessageAt: 1_297 });
    const pastCap = await listFor(PLAIN_MEMBER);
    expect(pastCap.conversations).toEqual([]);
    expect(pastCap.truncated).toBe(true);
    // The same inbox answered in full before the cap is not partial.
    const admin = await listFor(ADMIN, 5);
    expect(admin.conversations).toHaveLength(5);
    expect(admin.truncated).toBe(false);
  });

  it('never answers a row past the scan cap, even the only readable one [CONV-R2]', async () => {
    // 297 newer unassigned rows and the three seeds fill the cap; the one row
    // the plain member owns is the 301st newest, so the walk never reaches it.
    for (let index = 0; index < 297; index += 1) {
      addConversation({
        subject: `Triage ${index}`,
        lastMessageAt: 1_000 + index,
      });
    }
    addConversation({
      subject: 'Owned but past the cap',
      assigneeUserId: PLAIN_MEMBER,
      lastMessageAt: 100,
    });
    const plain = await listFor(PLAIN_MEMBER);
    expect(plain.conversations).toEqual([]);
    expect(plain.truncated).toBe(true);
  });

  // Search behavior is untouched: term '' without the flag still matches
  // nothing. The subject and contact matchers pass no row on an empty token
  // list; the body walk would pass EVERY message (`includes('')` is always
  // true), so it must not run at all — hence the readable body seeded here.
  it('keeps the searchless empty result without the flag', async () => {
    const id = addConversation({
      subject: 'Nothing matching here',
      assigneeUserId: ASSIGNEE,
      lastMessageAt: 500,
    });
    addMessage(id, 'Any text at all', 500);
    for (const term of ['', '   ']) {
      const found = await search(ADMIN, term);
      expect(found.conversations).toEqual([]);
      expect(found.truncated).toBe(false);
      expect(
        found.statements.some(
          (text) =>
            text.includes('app.conversation_messages') ||
            text.includes('app.contacts'),
        ),
      ).toBe(false);
    }
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

  it('still refuses a body match the caller may not read [CONV-R2]', async () => {
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

  it('refuses an unassigned body match to everyone but an admin [CONV-R2]', async () => {
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

  it('reports truncation from the body walk, not just the conversation walk [CONV-R2]', async () => {
    // A caller told "no matches" must be able to tell that from "no matches
    // in what I looked at". Exactly 400 messages against a 400 cap: all read,
    // so the answer is complete.
    const id = addConversation({
      subject: 'Nothing matching here',
      assigneeUserId: ASSIGNEE,
      lastMessageAt: 1,
    });
    for (let index = 0; index < 400; index += 1) {
      addMessage(id, `filler ${index}`, 1_000 + index);
    }
    const atCap = await search(ASSIGNEE, 'nonexistent-term');
    expect(atCap.conversations).toEqual([]);
    expect(atCap.truncated).toBe(false);
    // The 401st message is one the walk never reads.
    addMessage(id, 'filler 400', 1_400);
    const pastCap = await search(ASSIGNEE, 'nonexistent-term');
    expect(pastCap.conversations).toEqual([]);
    expect(pastCap.truncated).toBe(true);
  });

  it('reads only the newest messages: a match past the cap is invisible [CONV-R2]', async () => {
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

  it('stops at the match cap, and a walk the cap stopped is not partial', async () => {
    // 51 matches among the newest 400 of 451 messages. The walk stops at the
    // 50th, before it could reach the scan cap — like a limit-break, that is
    // a full answer, never `truncated` (the 0.4 contract).
    const filler = addConversation({
      subject: 'Nothing matching here',
      assigneeUserId: ASSIGNEE,
      lastMessageAt: 1,
    });
    for (let index = 0; index < 400; index += 1) {
      addMessage(filler, `filler ${index}`, 1 + index);
    }
    const matching: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      matching.push(
        seedWithBody(`Serial XJ-4417, unit ${index}.`, {
          assigneeUserId: ASSIGNEE,
        }),
      );
      const message = world.messages.at(-1);
      if (message) message.delivered_at_ms = 2_000 + index;
    }
    const found = await search(ASSIGNEE, 'XJ-4417', { limit: 100 });
    expect(found.conversations).toHaveLength(50);
    // The oldest match is the one the cap left behind.
    expect(found.conversations.map((row) => row._id)).not.toContain(
      matching[0],
    );
    expect(found.truncated).toBe(false);
  });

  it('skips the body and contact walks entirely for a listing', async () => {
    // The flag alone turns the words off — even with a term that would
    // otherwise drive both pre-passes, a listing pays for neither.
    seedWithBody('irrelevant', { assigneeUserId: ASSIGNEE });
    const found = await search(ASSIGNEE, 'irrelevant', { list: true });
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

// The fake is what gives the cases above their teeth, so its own reading of
// the SQL is pinned too: a stand-in that silently widened, narrowed or
// ignored part of a statement would let a privacy regression pass.
describe('worldSql — reads the statement, not a shape it assumes', () => {
  it('combines conditions the way the WHERE clause does', async () => {
    const { sql } = worldSql(world);
    const both = await sql<Row[]>`
      SELECT "userId" FROM "member"
      WHERE "organizationId" = ${OTHER_ORG} AND "userId" = ${ADMIN}
    `;
    const either = await sql<Row[]>`
      SELECT "userId" FROM "member"
      WHERE "organizationId" = ${OTHER_ORG} OR "userId" = ${ADMIN}
    `;
    expect(both).toEqual([]);
    expect(either).toEqual([{ userId: ADMIN }]);
  });

  it('returns only the columns the SELECT names, under their aliases', async () => {
    const { sql } = worldSql(world);
    const rows = await sql<Row[]>`
      SELECT id AS "_id", last_message_at_ms::float8 AS "lastMessageAt"
      FROM app.conversations WHERE org_id = ${ORG}
      ORDER BY coalesce(last_message_at_ms, 0) DESC, id DESC
      LIMIT 1
    `;
    expect(rows).toEqual([{ _id: 'conv_0002', lastMessageAt: 400 }]);
  });

  it('answers an unordered read reversed, and refuses a LIMIT that cuts it', async () => {
    const { sql } = worldSql(world);
    // Seeded 300, 400, 200: an unordered read comes back reversed.
    const unordered = await sql<Row[]>`
      SELECT subject FROM app.conversations WHERE org_id = ${ORG}
    `;
    expect(unordered).toEqual([
      { subject: 'Refund owned by a person' },
      { subject: 'Refund pool unassigned' },
      { subject: 'Refund queued to team X' },
    ]);
    await expect(
      sql`SELECT id FROM app.conversations WHERE org_id = ${ORG} LIMIT ${2}`,
    ).rejects.toThrow(/cuts 3 unordered rows/);
  });

  it('refuses a predicate it cannot evaluate rather than ignoring it', async () => {
    const { sql } = worldSql(world);
    await expect(
      sql`SELECT id FROM app.conversations WHERE org_id = ${ORG} AND status <> 'closed'`,
    ).rejects.toThrow(/reads only/);
    await expect(
      sql`SELECT id FROM app.conversations WHERE org_id = ${ORG} AND assignee_team_id IS NULL`,
    ).rejects.toThrow(/reads only/);
  });

  it('refuses a column, a join or an ORDER BY it does not model', async () => {
    const { sql } = worldSql(world);
    await expect(
      sql`SELECT body FROM app.conversations WHERE org_id = ${ORG}`,
    ).rejects.toThrow(/no column body/);
    await expect(
      sql`SELECT c.id FROM app.conversations c JOIN app.contacts k ON k.id = c.contact_id WHERE c.org_id = ${ORG}`,
    ).rejects.toThrow(/knows no such statement/);
    await expect(
      sql`SELECT id FROM app.conversations WHERE org_id = ${ORG} ORDER BY subject`,
    ).rejects.toThrow(/no ORDER BY/);
  });
});
