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
 * `createAuth` only constructs a lazy `pg.Pool`, so no database is touched;
 * the hooks are driven directly against a recording `sql` stand-in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_HINT_ENTITY } from '../../lib/shared/hint-entities.ts';
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

interface TeamLifecycleHooks {
  afterCreateTeam?: (data: {
    team: { id: string };
    organization: { id: string };
  }) => Promise<void>;
  afterUpdateTeam?: (data: {
    team: { id: string } | null;
    organization: { id: string };
  }) => Promise<void>;
  afterDeleteTeam?: (data: {
    team: { id: string };
    organization: { id: string };
  }) => Promise<void>;
}

function teamHooks(sql: Sql): TeamLifecycleHooks {
  const auth = createAuth({
    databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
    secret: 'test-secret-at-least-16-chars',
    baseUrl: 'https://tale.example.com',
    sql,
  });
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

describe('Better Auth team hooks — invalidation hints', () => {
  beforeEach(() => {
    // The delete hook's scope retirement runs against the recorder and may
    // log; the hint is what this suite is about.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('emits one org-wide team hint when a team is created', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterCreateTeam?.({
      team: { id: 'team-1' },
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
      team: { id: 'team-1' },
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
      organization: { id: 'org-1' },
    });

    expect(hints(statements)[0]?.values).toEqual([
      'org-1',
      null,
      TEAM_HINT_ENTITY,
      null,
    ]);
  });

  it('emits the hint when a team is deleted', async () => {
    const { sql, statements } = recordingSql();

    await teamHooks(sql).afterDeleteTeam?.({
      team: { id: 'team-1' },
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
        team: { id: 'team-1' },
        organization: { id: 'org-1' },
      }),
    ).resolves.toBeUndefined();
  });
});
