import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  listByOrganization,
  lookupMembers,
  type MemberDirectoryEntry,
  searchMembers,
} from './service.ts';

/**
 * The member reads, pinned against a recording `sql`: the statement the
 * database is sent, and what the service keeps of the rows it answers. The
 * lookup's and the search's statements themselves run against Postgres in
 * the integration lanes (`lookup.integration.ts`, `search.integration.ts`).
 */

interface Statement {
  text: string;
  values: unknown[];
}

interface Row {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  displayName: string | null;
  email: string | null;
  organizationId?: string;
  twoFactorEnabled?: boolean | null;
  joinedMs?: number;
}

function recordingSql(rows: Row[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.raw.join('$').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { sql: tag as unknown as Sql, statements };
}

const ORG = 'org-acme';

const noah: Row = {
  id: 'member-noah',
  userId: 'user-noah',
  role: 'member',
  createdAt: '2026-01-01 09:00:00+00',
  displayName: 'Noah Berg',
  email: 'noah@acme.example',
};

const mia: Row = {
  id: 'member-mia',
  userId: 'user-mia',
  role: 'Admin',
  createdAt: '2026-01-02 09:00:00+00',
  displayName: 'Mia',
  email: 'm.weber@acme.example',
};

describe('lookupMembers [MEMBER-R11]', () => {
  it('reads one organization’s members by id and by handle, factor-free, oldest seat first [MEMBER-R11]', async () => {
    const { sql, statements } = recordingSql([noah, mia]);

    const found = await lookupMembers(sql, ORG, {
      userIds: ['user-mia', 'user-mia'],
      handles: ['Noah.Berg', 'noah.berg'],
    });

    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement?.text).toContain('WHERE m."organizationId" = $');
    expect(statement?.text).toContain('ORDER BY m."createdAt" ASC, m."id" ASC');
    expect(statement?.text).not.toMatch(/passkey|twoFactor/i);
    expect(statement?.values[0]).toBe(ORG);
    // Each id and each handle once, the handles lowercased, and the name
    // keys a name handle is matched by: the handle without its dots.
    expect(statement?.values).toContainEqual(['user-mia']);
    expect(statement?.values).toContainEqual(['noah.berg']);
    expect(statement?.values).toContainEqual(['noahberg']);

    expect(found).toEqual<MemberDirectoryEntry[]>([
      {
        id: 'member-noah',
        userId: 'user-noah',
        role: 'member',
        createdAt: '2026-01-01 09:00:00+00',
        displayName: 'Noah Berg',
        email: 'noah@acme.example',
      },
      {
        id: 'member-mia',
        userId: 'user-mia',
        role: 'admin',
        createdAt: '2026-01-02 09:00:00+00',
        displayName: 'Mia',
        email: 'm.weber@acme.example',
      },
    ]);
    for (const entry of found) {
      expect(Object.keys(entry).sort()).toEqual([
        'createdAt',
        'displayName',
        'email',
        'id',
        'role',
        'userId',
      ]);
    }
  });

  it('keeps only the members who answer to a handle asked for, as the shared handle rules say [MEMBER-R11]', async () => {
    // What the statement narrows to can hold members a handle only looks
    // like: `noahberg` is not one of `Noah.Berg`'s handles (a name without
    // spaces keeps its dots), and `m.weber` names Mia by her email.
    const dotted: Row = { ...noah, displayName: 'Noah.Berg' };
    const { sql } = recordingSql([dotted, mia]);

    const byNameKey = await lookupMembers(sql, ORG, {
      userIds: [],
      handles: ['noahberg', 'm.weber'],
    });
    expect(byNameKey.map((entry) => entry.userId)).toEqual(['user-mia']);

    const byForms = await lookupMembers(recordingSql([noah, mia]).sql, ORG, {
      userIds: [],
      handles: ['noahberg', 'mia', 'user-noah'],
    });
    expect(byForms.map((entry) => entry.userId)).toEqual([
      'user-noah',
      'user-mia',
    ]);
  });

  it('asks nothing when it names no one [MEMBER-R11]', async () => {
    const { sql, statements } = recordingSql([noah]);

    expect(await lookupMembers(sql, ORG, { userIds: [], handles: [] })).toEqual(
      [],
    );
    expect(statements).toHaveLength(0);
  });
});

describe('searchMembers [MEMBER-R12]', () => {
  // The member statement, not the fragment of it that says when a member
  // joined (the recording tag records that call too).
  const searchStatement = (statements: Statement[]) =>
    statements.find((statement) => statement.text.includes('FROM "member" m'));
  const noahJoined: Row = { ...noah, joinedMs: 1767258000000 };
  const miaJoined: Row = { ...mia, joinedMs: 1767344400000 };

  it('searches one organization’s members by name and email, factor-free, in the order they joined [MEMBER-R12]', async () => {
    const { sql, statements } = recordingSql([noahJoined, miaJoined]);

    const page = await searchMembers(sql, ORG, {
      query: '  Noah   Berg ',
      limit: 2,
      cursor: null,
    });

    const statement = searchStatement(statements);
    expect(statement?.text).toContain('WHERE m."organizationId" = $');
    expect(statement?.text).toContain('u."email"');
    expect(statement?.text).toContain('ORDER BY $ ASC, m."id" ASC');
    expect(statement?.text).not.toMatch(/passkey|twoFactor/i);
    expect(statement?.values).toContain(ORG);
    // The text with its spaces as one, and as hyphens, matched anywhere:
    // what the pickers' own filters keep, the server finds.
    expect(statement?.values).toContainEqual(['%Noah Berg%', '%Noah-Berg%']);
    // One row more than the page, to know whether another page follows.
    expect(statement?.values.at(-1)).toBe(3);

    expect(page).toEqual({
      members: [
        {
          id: 'member-noah',
          userId: 'user-noah',
          role: 'member',
          createdAt: '2026-01-01 09:00:00+00',
          displayName: 'Noah Berg',
          email: 'noah@acme.example',
        },
        {
          id: 'member-mia',
          userId: 'user-mia',
          role: 'admin',
          createdAt: '2026-01-02 09:00:00+00',
          displayName: 'Mia',
          email: 'm.weber@acme.example',
        },
      ],
      next: null,
    });
  });

  it('ends the page at its limit and says where it ends [MEMBER-R12]', async () => {
    const { sql } = recordingSql([noahJoined, miaJoined]);

    const page = await searchMembers(sql, ORG, {
      query: '',
      limit: 1,
      cursor: null,
    });

    expect(page.members.map((entry) => entry.userId)).toEqual(['user-noah']);
    expect(page.next).toEqual({ at: 1767258000000, id: 'member-noah' });
  });

  it('reads on from the cursor, in the project’s teams, matching LIKE’s wildcards as themselves [MEMBER-R12]', async () => {
    const { sql, statements } = recordingSql([]);

    await searchMembers(sql, ORG, {
      query: '50%_off',
      access: 'read',
      projectTeamIds: ['team-design'],
      limit: 10,
      cursor: { at: 1767258000000, id: 'member-noah' },
    });

    const statement = searchStatement(statements);
    // A membership counts only in a team of the member's own organization.
    expect(statement?.text).toContain(
      'FROM "teamMember" tm JOIN "team" t ON t."id" = tm."teamId" AND t."organizationId" = m."organizationId"',
    );
    const values = statement?.values;
    expect(values).toContainEqual(['%50\\%\\_off%']);
    expect(values).toContainEqual(['team-design']);
    expect(values).toContain(1767258000000);
    expect(values).toContain('member-noah');
  });
});

describe('listByOrganization', () => {
  it('lists the members table without counting anyone’s passkeys', async () => {
    const { sql, statements } = recordingSql([
      { ...noah, organizationId: ORG, twoFactorEnabled: null },
    ]);

    const [member] = await listByOrganization(sql, ORG);

    expect(statements[0]?.text).not.toMatch(/passkey/i);
    expect(member).not.toHaveProperty('passkeyCount');
    expect(member).toMatchObject({
      userId: 'user-noah',
      organizationId: ORG,
      twoFactorEnabled: false,
    });
  });
});
