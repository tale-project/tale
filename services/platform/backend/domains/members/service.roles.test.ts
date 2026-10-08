// @vitest-environment node

/**
 * Who may change a member's role and who may remove a member. Every refusal
 * is decided from the caller's seat, the target's seat and the organization's
 * creator before anything is written: the recording transaction answers the
 * guard reads only, so a write on a refused path fails the test.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { removeMember, updateMemberRole } from './service.ts';

const ORG_ID = 'org-under-test';
const CALLER_ID = 'user-caller';
const TARGET_USER_ID = 'user-target';
const TARGET_MEMBER_ID = 'member-target';

interface Scenario {
  /** The caller's role in the organization, or null when not a member. */
  callerRole: string | null;
  targetRole?: string;
  /** The user the organization records as its creator. */
  creatorId?: string;
  /** How many owners and admins the organization has. */
  adminCount?: number;
}

function recordingTx(scenario: Scenario): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const answer = (text: string): unknown[] => {
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role", "createdAt"',
      )
    ) {
      return [
        {
          id: TARGET_MEMBER_ID,
          organizationId: ORG_ID,
          userId: TARGET_USER_ID,
          role: scenario.targetRole ?? 'member',
          createdAt: '2026-01-01',
        },
      ];
    }
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role" FROM "member"',
      )
    ) {
      return scenario.callerRole === null
        ? []
        : [
            {
              id: 'member-caller',
              organizationId: ORG_ID,
              userId: CALLER_ID,
              role: scenario.callerRole,
            },
          ];
    }
    if (text.startsWith('SELECT "metadata" FROM "organization"')) {
      return [
        {
          metadata:
            scenario.creatorId === undefined
              ? null
              : JSON.stringify({ creatorId: scenario.creatorId }),
        },
      ];
    }
    if (text.startsWith('SELECT count(*)::text AS count FROM "member"')) {
      return [{ count: String(scenario.adminCount ?? 2) }];
    }
    throw new Error(`unexpected SQL in recording tx: ${text}`);
  };
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push(text);
    try {
      return Promise.resolve(answer(text));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { tx: tag as unknown as TransactionSql, statements };
}

const wrote = (statements: string[]): boolean =>
  statements.some((text) => /^(DELETE|UPDATE|INSERT)\b/.test(text));

const CALLER = { userId: CALLER_ID };

describe('updateMemberRole — who may change a role, and which roles are protected', () => {
  it.each(['developer', 'editor', 'member', null])(
    'refuses a caller whose role is %s [MEMBER-R1]',
    async (callerRole) => {
      const { tx, statements } = recordingTx({ callerRole });
      await expect(
        updateMemberRole(tx, CALLER, {
          memberId: TARGET_MEMBER_ID,
          role: 'editor',
        }),
      ).rejects.toMatchObject({
        code: 'MEMBER_ROLE_UPDATE_FORBIDDEN',
        status: 403,
      });
      expect(wrote(statements)).toBe(false);
    },
  );

  it('never changes the role of an owner, for another owner either [MEMBER-R2]', async () => {
    const { tx, statements } = recordingTx({
      callerRole: 'owner',
      targetRole: 'owner',
    });
    await expect(
      updateMemberRole(tx, CALLER, {
        memberId: TARGET_MEMBER_ID,
        role: 'admin',
      }),
    ).rejects.toMatchObject({
      code: 'MEMBER_OWNER_ROLE_IMMUTABLE',
      status: 403,
    });
    expect(wrote(statements)).toBe(false);
  });

  it.each(['owner', 'Owner'])(
    'never assigns the role %s [MEMBER-R2]',
    async (role) => {
      const { tx, statements } = recordingTx({ callerRole: 'owner' });
      await expect(
        updateMemberRole(tx, CALLER, { memberId: TARGET_MEMBER_ID, role }),
      ).rejects.toMatchObject({
        code: 'MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN',
        status: 400,
      });
      expect(wrote(statements)).toBe(false);
    },
  );

  it('never changes the role of the person who created the organization [MEMBER-R3]', async () => {
    const { tx, statements } = recordingTx({
      callerRole: 'owner',
      targetRole: 'admin',
      creatorId: TARGET_USER_ID,
    });
    await expect(
      updateMemberRole(tx, CALLER, {
        memberId: TARGET_MEMBER_ID,
        role: 'member',
      }),
    ).rejects.toMatchObject({
      code: 'MEMBER_CREATOR_ROLE_IMMUTABLE',
      status: 403,
    });
    expect(wrote(statements)).toBe(false);
  });

  it('refuses to demote the only owner or admin left [MEMBER-R4]', async () => {
    const { tx, statements } = recordingTx({
      callerRole: 'admin',
      targetRole: 'admin',
      adminCount: 1,
    });
    await expect(
      updateMemberRole(tx, CALLER, {
        memberId: TARGET_MEMBER_ID,
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_LAST_ADMIN', status: 400 });
    expect(wrote(statements)).toBe(false);
  });
});

describe('removeMember — who may remove a member, and who cannot be removed', () => {
  it.each(['developer', 'editor', 'member', null])(
    'refuses a caller whose role is %s [MEMBER-R1]',
    async (callerRole) => {
      const { tx, statements } = recordingTx({ callerRole });
      await expect(
        removeMember(tx, CALLER, TARGET_MEMBER_ID),
      ).rejects.toMatchObject({
        code: 'MEMBER_REMOVE_FORBIDDEN',
        status: 403,
      });
      expect(wrote(statements)).toBe(false);
    },
  );

  it('never removes an owner [MEMBER-R5]', async () => {
    const { tx, statements } = recordingTx({
      callerRole: 'owner',
      targetRole: 'owner',
    });
    await expect(
      removeMember(tx, CALLER, TARGET_MEMBER_ID),
    ).rejects.toMatchObject({
      code: 'MEMBER_OWNER_REMOVAL_FORBIDDEN',
      status: 403,
    });
    expect(wrote(statements)).toBe(false);
  });

  it('refuses an admin who removes their own membership [MEMBER-R5]', async () => {
    const { tx, statements } = recordingTx({ callerRole: 'admin' });
    await expect(
      removeMember(tx, { userId: TARGET_USER_ID }, TARGET_MEMBER_ID),
    ).rejects.toMatchObject({
      code: 'MEMBER_SELF_REMOVAL_FORBIDDEN',
      status: 400,
    });
    expect(wrote(statements)).toBe(false);
  });
});
