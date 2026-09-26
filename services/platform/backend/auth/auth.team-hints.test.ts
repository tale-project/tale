// @vitest-environment node

/**
 * Team create, rename and delete are served by Better Auth's OWN organization
 * endpoints, so none of them passes through an app route — the app's write
 * adapters never see them and, before these hooks existed, they emitted no
 * invalidation hint either. The result was a settings Teams table (and an
 * account-menu team picker) that only told the truth after a page reload: a
 * created team missing, a renamed one still showing its old name, a deleted
 * one still holding its row. These three hooks put the plugin's lane back on
 * the Tier-2 bus, so every connected session of the organization refreshes.
 *
 * The same hooks are the plugin lane's only audit: before them a team could
 * be created, renamed or deleted through the plugin with no row in the
 * organization's audit log (only the app's own delete door wrote one).
 *
 * `createAuth` only constructs a lazy `pg.Pool`, so no database is touched;
 * the hooks are driven directly against a recording `sql` stand-in, with
 * the audit writer and the serializable wrapper replaced by spies.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_HINT_ENTITY } from '../../lib/shared/hint-entities.ts';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../domains/audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/audit_logs/service.ts')
  >()),
  createAuditLog,
}));
vi.mock('@tale/shared/db/serializable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/shared/db/serializable')>()),
  transactSerializable: (sql: Sql, fn: (tx: unknown) => unknown) =>
    (
      sql as unknown as { begin: (run: (tx: unknown) => unknown) => unknown }
    ).begin(fn),
}));

import { createAuth } from './auth.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A `postgres.js` stand-in that records every statement and answers nothing. */
function recordingSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([]);
  };
  // The delete hook retires the deleted team's scopes in a transaction first;
  // it runs against this same recorder.
  (tag as unknown as { begin: unknown }).begin = (
    fn: (tx: unknown) => unknown,
  ) => Promise.resolve(fn(tag));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

interface HookTeam {
  id: string;
  name: string;
}
interface HookUser {
  id: string;
  email: string;
}

interface TeamLifecycleHooks {
  afterCreateTeam?: (data: {
    team: HookTeam;
    user?: HookUser;
    organization: { id: string };
  }) => Promise<void>;
  beforeUpdateTeam?: (data: {
    team: HookTeam;
    updates: { name?: string };
    user: HookUser;
    organization: { id: string };
  }) => Promise<void>;
  afterUpdateTeam?: (data: {
    team: HookTeam | null;
    user: HookUser;
    organization: { id: string };
  }) => Promise<void>;
  afterDeleteTeam?: (data: {
    team: HookTeam;
    user?: HookUser;
    organization: { id: string };
  }) => Promise<void>;
}

const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.com',
};

const ADMIN: HookUser = { id: 'user-1', email: 'ada@example.test' };

function teamHooks(sql: Sql): TeamLifecycleHooks {
  const auth = createAuth({ ...BASE, sql });
  const plugin = (auth.options.plugins ?? []).find(
    (candidate: { id?: string }) => candidate.id === 'organization',
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the organization plugin's own options object, narrowed to the hooks under test
  return (plugin as unknown as { options: { organizationHooks: unknown } })
    .options.organizationHooks as TeamLifecycleHooks;
}

/** The outbox rows a run of the hooks wrote, in order. */
function hints(statements: Statement[]): Statement[] {
  return statements.filter((statement) =>
    statement.text.includes('INSERT INTO app_realtime.outbox'),
  );
}

/** The audit rows a run of the hooks wrote, by action. */
function audited(): unknown[] {
  return createAuditLog.mock.calls.map((call) => call[1]);
}

describe('Better Auth team hooks — invalidation hints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The delete hook's scope retirement runs against the recorder and may
    // log; the hint is what this suite is about.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('emits one org-wide team hint when a team is created', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterCreateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(hints(statements)).toHaveLength(1);
    expect(hints(statements)[0]?.values).toEqual([
      'org-1',
      null,
      TEAM_HINT_ENTITY,
      'team-1',
    ]);
  });

  it('emits the hint when a team is renamed', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterUpdateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(hints(statements)[0]?.values).toEqual([
      'org-1',
      null,
      TEAM_HINT_ENTITY,
      'team-1',
    ]);
  });

  // Better Auth answers `team: null` when the update matched no row. The org
  // still needs its team reads dropped, so the hint goes out without an id.
  it('emits an id-less hint when the update matched no team', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterUpdateTeam?.({
      team: null,
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(hints(statements)[0]?.values).toEqual([
      'org-1',
      null,
      TEAM_HINT_ENTITY,
      null,
    ]);
    expect(audited()).toEqual([]);
  });

  it('emits the hint when a team is deleted', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterDeleteTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(hints(statements)[0]?.values).toEqual([
      'org-1',
      null,
      TEAM_HINT_ENTITY,
      'team-1',
    ]);
  });

  // The write the hook describes has already committed, so a hint that cannot
  // be written costs a live refresh — never the user's request.
  it('never fails the caller when the hint cannot be written', async () => {
    const failing = (() => Promise.reject(new Error('outbox down'))) as unknown;
    (failing as { begin: unknown }).begin = () =>
      Promise.reject(new Error('outbox down'));

    await expect(
      teamHooks(failing as Sql).afterCreateTeam?.({
        team: { id: 'team-1', name: 'Finance' },
        user: ADMIN,
        organization: { id: 'org-1' },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Better Auth team hooks — audit rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('records team.created under the signed-in user, naming the plugin door', async () => {
    const { sql } = recordingSql();

    await teamHooks(sql).afterCreateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'team.created',
        category: 'member',
        resourceType: 'team',
        resourceId: 'team-1',
        resourceName: 'Finance',
        newState: { name: 'Finance' },
        metadata: { door: 'plugin' },
        status: 'success',
      }),
    ]);
  });

  // A server-side call carries no session: the row still lands, under the
  // system rather than a made-up person.
  it('records the system as the actor when the hook was handed no user', async () => {
    const { sql } = recordingSql();

    await teamHooks(sql).afterCreateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      organization: { id: 'org-1' },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        action: 'team.created',
      }),
    ]);
  });

  // The after-hook only sees the row the plugin wrote; the before-hook
  // stashes the name it is about to replace so the row carries both.
  it('records a rename with the previous and the new name', async () => {
    const { sql } = recordingSql();
    const hooks = teamHooks(sql);

    await hooks.beforeUpdateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      updates: { name: 'Treasury' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });
    await hooks.afterUpdateTeam?.({
      team: { id: 'team-1', name: 'Treasury' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'user-1',
        action: 'team.updated',
        resourceId: 'team-1',
        resourceName: 'Treasury',
        previousState: { name: 'Finance' },
        newState: { name: 'Treasury' },
        changedFields: ['name'],
        metadata: { door: 'plugin' },
      }),
    ]);
  });

  it('records nothing for an update that re-sent the same name', async () => {
    const { sql } = recordingSql();
    const hooks = teamHooks(sql);

    await hooks.beforeUpdateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      updates: { name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });
    await hooks.afterUpdateTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(audited()).toEqual([]);
  });

  // The recorder answers the scope retirement nothing, so that step logs
  // and the row carries the door alone — the row itself must still land:
  // this hook is the only audit a plugin-door delete gets.
  it('records team.deleted for a plugin-door delete even when the retirement failed', async () => {
    const { sql } = recordingSql();

    await teamHooks(sql).afterDeleteTeam?.({
      team: { id: 'team-1', name: 'Finance' },
      user: ADMIN,
      organization: { id: 'org-1' },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'user-1',
        action: 'team.deleted',
        category: 'member',
        resourceType: 'team',
        resourceId: 'team-1',
        resourceName: 'Finance',
        metadata: { door: 'plugin' },
      }),
    ]);
  });

  it('never fails the caller when the audit row cannot be written', async () => {
    createAuditLog.mockRejectedValueOnce(new Error('chain locked'));
    const { sql, statements } = recordingSql();

    await expect(
      teamHooks(sql).afterCreateTeam?.({
        team: { id: 'team-1', name: 'Finance' },
        user: ADMIN,
        organization: { id: 'org-1' },
      }),
    ).resolves.toBeUndefined();
    // The hint still goes out.
    expect(hints(statements)).toHaveLength(1);
  });
});

describe('the plugin’s team-membership doors', () => {
  // They would write a membership with no audit row and no last-member
  // rule; the app's own doors carry both, and are what the product calls.
  it('are closed, while remove-team stays open for its hook', () => {
    const auth = createAuth({ ...BASE, sql: null as unknown as Sql });
    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining([
        '/organization/add-team-member',
        '/organization/remove-team-member',
      ]),
    );
    expect(auth.options.disabledPaths).not.toContain(
      '/organization/remove-team',
    );
  });
});
