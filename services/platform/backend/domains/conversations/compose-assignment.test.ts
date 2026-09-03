import type { Sql } from 'postgres';
import { describe, expect, test } from 'vitest';

import { resolveComposeAssignment } from './send.ts';
import { ConversationError } from './service.ts';

/** A `sql` stand-in that answers every tagged-template query with `rows`. */
function fakeSql(rows: unknown[]): Sql {
  const tag = (..._args: unknown[]) => Promise.resolve(rows);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

describe('resolveComposeAssignment', () => {
  test('defaults the assignee to the actor', async () => {
    const result = await resolveComposeAssignment(fakeSql([]), {
      organizationId: 'org_1',
      actor: { userId: 'user_self', role: 'member' },
    });
    expect(result).toEqual({ assigneeUserId: 'user_self' });
  });

  test('an admin may assign another member and a team in-org', async () => {
    const result = await resolveComposeAssignment(
      fakeSql([{ organizationId: 'org_1' }]),
      {
        organizationId: 'org_1',
        assigneeUserId: 'user_other',
        assigneeTeamId: 'team_1',
        actor: { userId: 'user_admin', role: 'admin' },
      },
    );
    expect(result).toEqual({
      assigneeUserId: 'user_other',
      assigneeTeamId: 'team_1',
    });
  });

  test('a non-admin team pick is dropped (person clamped to self)', async () => {
    // Team query must not run — empty rows would otherwise look like not-in-org.
    const result = await resolveComposeAssignment(fakeSql([]), {
      organizationId: 'org_1',
      assigneeUserId: 'user_other',
      assigneeTeamId: 'team_1',
      actor: { userId: 'user_member', role: 'member' },
    });
    expect(result).toEqual({ assigneeUserId: 'user_member' });
    expect(result).not.toHaveProperty('assigneeTeamId');
  });

  test('rejects a team that is not in the organization', async () => {
    await expect(
      resolveComposeAssignment(fakeSql([{ organizationId: 'org_other' }]), {
        organizationId: 'org_1',
        assigneeTeamId: 'team_foreign',
        actor: { userId: 'user_admin', role: 'owner' },
      }),
    ).rejects.toMatchObject({
      code: 'team_not_in_org',
    } satisfies Partial<ConversationError>);
  });

  test('rejects a missing team the same as a foreign team', async () => {
    await expect(
      resolveComposeAssignment(fakeSql([]), {
        organizationId: 'org_1',
        assigneeTeamId: 'team_gone',
        actor: { userId: 'user_admin', role: 'admin' },
      }),
    ).rejects.toBeInstanceOf(ConversationError);
  });
});
