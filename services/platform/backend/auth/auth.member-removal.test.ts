// @vitest-environment node

/**
 * Better Auth's own `POST /api/auth/organization/remove-member` deletes the
 * member row (and, with teams enabled, its team rows) and nothing else. The
 * app's members door runs `removeMembershipCascade` in the same transaction
 * for everything else the membership carried — including the member's live
 * platform-capability grants, which a re-added member would otherwise get
 * back carrying a right no admin re-granted.
 *
 * The plugin's door is mounted (it answers, unlike `/organization/delete`,
 * which is disabled), so it needs the same cascade: this pins the hook that
 * gives it one.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createAuth } from './auth.ts';

const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.com',
};

/** A `sql` whose `begin` hands the callback a statement-recording tag. */
function recordingSql() {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  const sql = {
    begin: (run: (tx: unknown) => Promise<unknown>) => run(tag),
  } as unknown as Sql;
  return { sql, statements };
}

function removalHook(sql: Sql) {
  const auth = createAuth({ ...BASE, sql });
  const organization = auth.options.plugins.find(
    (plugin) => plugin.id === 'organization',
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the plugin's own options bag, read for its hooks
  const options = (
    organization as unknown as {
      options?: { organizationHooks?: Record<string, unknown> };
    }
  )?.options;
  return options?.organizationHooks?.afterRemoveMember as
    | ((data: {
        member: { userId: string };
        user: { id: string };
        organization: { id: string };
      }) => Promise<void>)
    | undefined;
}

describe('the plugin’s leave door', () => {
  it('is closed, because it would delete a membership with no guard at all', () => {
    // Its remove-member sibling at least fires afterRemoveMember; `/leave`
    // calls the adapter directly, so no hook can give it the cascade, the
    // legal-hold check or the audit row the app's own removal carries.
    const auth = createAuth({ ...BASE, sql: null as unknown as Sql });
    expect(auth.options.disabledPaths).toContain('/organization/leave');
  });
});

describe('the plugin’s remove-member door', () => {
  it('ends the membership’s capability grants, not just its member row', async () => {
    const { sql, statements } = recordingSql();
    const hook = removalHook(sql);
    expect(hook, 'afterRemoveMember must be wired').toBeDefined();

    await hook?.({
      member: { userId: 'u-1' },
      user: { id: 'u-1' },
      organization: { id: 'org-1' },
    });

    const revoke = statements.find((statement) =>
      statement.includes('app.competence_records'),
    );
    expect(revoke).toBeDefined();
    expect(revoke).toContain("competence LIKE 'tale:%'");
    expect(revoke).toContain('revoked_at_ms IS NULL');
    // The rest of the membership's footprint goes with it, exactly as the
    // app door's removal does.
    expect(
      statements.some((statement) => statement.includes('"teamMember"')),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('app.sso_synced_team_members'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('app.user_preferences'),
      ),
    ).toBe(true);
  });
});
