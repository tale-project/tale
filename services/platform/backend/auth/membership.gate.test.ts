import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  MembershipError,
  requireOrganizationMembership,
} from './membership.ts';

/** A `postgres` stand-in over a member table and an organization table that
 * counts the reads it answered. */
function memberDb(
  members: { organizationId: string; userId: string; role: string }[],
  organizations: string[],
) {
  const reads: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    reads.push(text);
    if (text.includes('FROM "member"')) {
      const [userId] = values as [string];
      return Promise.resolve(
        members
          .filter((row) => row.userId === userId)
          .map((row, i) => ({
            id: `m${i}`,
            organizationId: row.organizationId,
            userId: row.userId,
            role: row.role,
          })),
      );
    }
    if (text.includes('FROM "organization"')) {
      const [id] = values as [string];
      return Promise.resolve(organizations.includes(id) ? [{ id }] : []);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, reads };
}

describe('requireOrganizationMembership', () => {
  it('answers the membership and every organization of the caller from one read', async () => {
    const { sql, reads } = memberDb(
      [
        { organizationId: 'o1', userId: 'u1', role: 'Member' },
        { organizationId: 'o2', userId: 'u1', role: 'admin' },
        { organizationId: 'o1', userId: 'u2', role: 'member' },
      ],
      ['o1', 'o2'],
    );
    const result = await requireOrganizationMembership(sql, 'o2', 'u1');
    expect(result.member).toMatchObject({
      organizationId: 'o2',
      userId: 'u1',
      role: 'admin',
    });
    expect(result.organizationIds.sort()).toEqual(['o1', 'o2']);
    expect(reads).toHaveLength(1);
  });

  it('normalizes the role and refuses a disabled seat', async () => {
    const { sql } = memberDb(
      [{ organizationId: 'o1', userId: 'u1', role: 'DISABLED' }],
      ['o1'],
    );
    await expect(
      requireOrganizationMembership(sql, 'o1', 'u1'),
    ).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('tells a missing organization apart from a non-membership', async () => {
    const { sql } = memberDb(
      [{ organizationId: 'o1', userId: 'u1', role: 'member' }],
      ['o1', 'o3'],
    );
    await expect(
      requireOrganizationMembership(sql, 'o3', 'u1'),
    ).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
    await expect(
      requireOrganizationMembership(sql, 'gone', 'u1'),
    ).rejects.toMatchObject({ code: 'ORG_NOT_FOUND' });
  });

  it('requires an organization id', async () => {
    const { sql, reads } = memberDb([], []);
    const refusal = requireOrganizationMembership(sql, '', 'u1');
    await expect(refusal).rejects.toBeInstanceOf(MembershipError);
    await expect(refusal).rejects.toMatchObject({ code: 'ORG_ID_REQUIRED' });
    expect(reads).toHaveLength(0);
  });
});
