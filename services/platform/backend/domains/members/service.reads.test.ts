import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  listByOrganization,
  lookupMembers,
  type MemberDirectoryEntry,
} from './service.ts';

/**
 * The member reads, pinned against a recording `sql`: the statement the
 * database is sent, and what the service keeps of the rows it answers. The
 * lookup's statement itself runs against Postgres in the integration lane
 * (`lookup.integration.ts`).
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
