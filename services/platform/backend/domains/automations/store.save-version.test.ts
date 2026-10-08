// @vitest-environment node

/**
 * Unit lock for `saveVersion`'s write shape (definition-integrity class):
 * every writer of one name takes the per-name advisory lock BEFORE reading
 * `max(version)` (two concurrent saves become versions N and N+1, never a
 * UNIQUE (org_id, name, version) collision surfacing as a 500); a
 * create-only save of a name that already has versions is refused with a
 * coded 409 and writes nothing (the wizard once appended a version to — and
 * then rebound the trigger of — a live automation sharing the slug); and the
 * install project binds version 1 only. The real-Postgres probe proves the
 * concurrent convergence on the actual schema.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

// The definition writes' audit rows are their own concern (`audit.ts`,
// `audit.test.ts`); this double answers no audit-chain query.
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import { auditDefinitionWrite } from './audit.ts';
import { AutomationError, saveVersion } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted `sql`: the version SELECT answers with the given existing
 * versions; the INSERT echoes what the database would compute. */
function fakeStore(existingVersions: number[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tx = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (text.includes('SELECT max(version)')) {
      return Promise.resolve([
        {
          latest:
            existingVersions.length === 0
              ? null
              : Math.max(...existingVersions),
        },
      ]);
    }
    if (text.includes('INSERT INTO app.automations')) {
      return Promise.resolve([
        { version: Math.max(0, ...existingVersions) + 1 },
      ]);
    }
    if (text.includes('SELECT id FROM app.projects')) {
      return Promise.resolve([{ id: 'p1' }]);
    }
    return Promise.resolve([]);
  };
  tx.json = (value: unknown): unknown => value;
  const sql = {
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  };
  return { sql: sql as unknown as Sql, statements };
}

const args = (overrides: Partial<Parameters<typeof saveVersion>[1]> = {}) => ({
  organizationId: 'org_1',
  name: 'ops/greet',
  document: { version: 1, name: 'ops/greet', nodes: [] },
  actor: 'user_1',
  ...overrides,
});

describe('saveVersion', () => {
  it('takes the audit chain, then the per-name advisory lock, before reading the version', async () => {
    const fake = fakeStore([1]);
    await saveVersion(fake.sql, args());

    // The chain before the name: the order every definition writer takes
    // them in, so two writers never wait on each other (`audit.ts`).
    const [chain, lock, read] = fake.statements;
    expect(chain?.text).toContain('pg_advisory_xact_lock');
    expect(chain?.values).toEqual([expect.any(Number), 'audit-chain:org_1']);
    expect(lock?.text).toContain('pg_advisory_xact_lock');
    expect(lock?.values).toEqual(['org_1', 'ops/greet']);
    expect(read?.text).toContain('SELECT max(version)');
  });

  it('refuses a create-only save of an existing name with a coded 409 and writes nothing', async () => {
    const fake = fakeStore([1, 2]);
    let caught: unknown;
    try {
      await saveVersion(fake.sql, args({ create: true }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutomationError);
    if (caught instanceof AutomationError) {
      expect(caught.code).toBe('AUTOMATION_NAME_TAKEN');
      expect(caught.status).toBe(409);
    }
    expect(
      fake.statements.some((statement) =>
        statement.text.includes('INSERT INTO'),
      ),
    ).toBe(false);
  });

  it('refuses a save whose draft started from a version that is no longer the latest [AUTO-R3]', async () => {
    // Tab A saved v6 while tab B still held a draft of v5: B's save must
    // not silently revert A's change (2026-09-26 evaluation, D-15).
    const fake = fakeStore([4, 5, 6]);
    let caught: unknown;
    try {
      await saveVersion(fake.sql, args({ baseVersion: 5 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutomationError);
    if (caught instanceof AutomationError) {
      expect(caught.code).toBe('AUTOMATION_VERSION_STALE');
      expect(caught.status).toBe(409);
      expect(caught.data).toEqual({ latestVersion: 6, baseVersion: 5 });
      expect(caught.message).toContain('v6');
    }
    expect(
      fake.statements.some((statement) =>
        statement.text.includes('INSERT INTO'),
      ),
    ).toBe(false);
  });

  it('appends when the draft started from the latest version, and always without a base [AUTO-R3]', async () => {
    const current = fakeStore([4, 5, 6]);
    await expect(
      saveVersion(current.sql, args({ baseVersion: 6 })),
    ).resolves.toEqual({ name: 'ops/greet', version: 7 });
    // The builder's autosave, an upload and MCP pass no base: last write
    // wins, as before.
    const blind = fakeStore([4, 5, 6]);
    await expect(saveVersion(blind.sql, args())).resolves.toEqual({
      name: 'ops/greet',
      version: 7,
    });
  });

  it('creates a fresh name and appends to an existing one without the flag [AUTO-R3]', async () => {
    const fresh = fakeStore([]);
    await expect(
      saveVersion(fresh.sql, args({ create: true })),
    ).resolves.toEqual({ name: 'ops/greet', version: 1 });
    const append = fakeStore([3]);
    await expect(saveVersion(append.sql, args())).resolves.toEqual({
      name: 'ops/greet',
      version: 4,
    });
  });

  /** A verdict given at save time is stamped with its time; a save without
   * one records neither (2026-09-13 evaluation, E4-04). */
  it('stamps tests_checked_at_ms beside a given verdict, and neither without one', async () => {
    const judged = fakeStore([]);
    const before = Date.now();
    await saveVersion(judged.sql, args({ testsPassed: false }));
    const insert = judged.statements.find((statement) =>
      statement.text.includes('INSERT INTO app.automations'),
    );
    expect(insert?.text).toContain('tests_checked_at_ms');
    const verdictAt = insert?.values.indexOf(false) ?? -1;
    expect(verdictAt).toBeGreaterThanOrEqual(0);
    expect(insert?.values[verdictAt + 1]).toBeGreaterThanOrEqual(before);

    const unjudged = fakeStore([]);
    await saveVersion(unjudged.sql, args());
    const bare = unjudged.statements.find((statement) =>
      statement.text.includes('INSERT INTO app.automations'),
    );
    // message, the verdict and its time, the three version fields, and the
    // door, key and client of a save that names no door (0181).
    expect(bare?.values.filter((value) => value === null).length).toBe(9);
  });

  it('binds the install project to version 1 only', async () => {
    const first = fakeStore([]);
    await saveVersion(first.sql, args({ projectId: 'p1' }));
    expect(
      first.statements.some((statement) =>
        statement.text.includes('INSERT INTO app.automation_project_bindings'),
      ),
    ).toBe(true);

    const later = fakeStore([1]);
    await saveVersion(later.sql, args({ projectId: 'p1' }));
    expect(
      later.statements.some((statement) =>
        statement.text.includes('INSERT INTO app.automation_project_bindings'),
      ),
    ).toBe(false);
  });
});

/**
 * A save body's `presentation: null` (the editor clearing the wizard's
 * name, an older client's default) went through `tx.json`, so the column
 * held the jsonb `'null'` — which `IS NOT NULL`, so the listings' newest
 * non-null presentation was that `null` and the declared name vanished
 * anyway (2026-09-26 evaluation, D-03). A null presentation is SQL NULL.
 */
describe('saveVersion presentation', () => {
  /** The scripted store with a json wrapper that can be told apart from a
   * bare SQL NULL. */
  function jsonTaggingStore() {
    const statements: Statement[] = [];
    const tx = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      const text = strings.join('?');
      statements.push({ text, values });
      if (text.includes('SELECT max(version)')) {
        return Promise.resolve([{ latest: null }]);
      }
      if (text.includes('INSERT INTO app.automations')) {
        return Promise.resolve([{ version: 1 }]);
      }
      return Promise.resolve([]);
    };
    tx.json = (value: unknown): unknown => ({ json: value });
    const sql = {
      begin: (callback: (handle: typeof tx) => Promise<unknown>) =>
        callback(tx),
    };
    return { sql: sql as unknown as Sql, statements };
  }
  const presentationValue = (statements: Statement[]): unknown => {
    const insert = statements.find((s) =>
      s.text.includes('INSERT INTO app.automations'),
    );
    // org, name, document, message, testsPassed, testsCheckedAt,
    // taskContract, settings, presentation, …
    return insert?.values[8];
  };

  it.each([undefined, null])('stores SQL NULL for %s', async (presentation) => {
    const fake = jsonTaggingStore();
    await saveVersion(fake.sql, args({ presentation }));
    expect(presentationValue(fake.statements)).toBeNull();
  });

  it('stores a declared presentation as json', async () => {
    const fake = jsonTaggingStore();
    await saveVersion(fake.sql, args({ presentation: { name: 'Greeter' } }));
    expect(presentationValue(fake.statements)).toEqual({
      json: { name: 'Greeter' },
    });
  });
});

/**
 * A coding agent's save sends only what it changes (`metadataMode: 'carry'`):
 * a version field it leaves out is copied from the latest version — read
 * under the name lock, so no save lands between the read and the write —
 * `null` stores none, and a value stores itself. The editor, an upload and
 * managed configuration keep the explicit rule: absent stores none.
 */
describe('saveVersion carry mode', () => {
  const LATEST = {
    name: 'billing/dunning',
    version: 5,
    document: {},
    message: null,
    testsPassed: null,
    testsCheckedAt: null,
    taskContract: { workflow: 'billing/dunning' },
    settings: { forms: [{ file: 'settings.json' }] },
    presentation: { name: 'Dunning' },
    createdBy: 'user_ben',
    createdAt: 1,
    createdVia: 'app',
    apiKeyId: null,
    clientName: null,
  };

  function carryStore(latest: number | null) {
    const statements: Statement[] = [];
    const tx = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      const text = strings.join('?');
      statements.push({ text, values });
      if (text.includes('SELECT max(version)')) {
        return Promise.resolve([{ latest }]);
      }
      if (text.includes('FROM app.automations') && text.includes('ORDER BY')) {
        return Promise.resolve(latest === null ? [] : [LATEST]);
      }
      if (text.includes('INSERT INTO app.automations')) {
        return Promise.resolve([{ version: (latest ?? 0) + 1 }]);
      }
      return Promise.resolve([]);
    };
    tx.json = (value: unknown): unknown => ({ json: value });
    const sql = {
      begin: (callback: (handle: typeof tx) => Promise<unknown>) =>
        callback(tx),
    };
    return { sql: sql as unknown as Sql, statements };
  }
  /** org, name, document, message, testsPassed, testsCheckedAt,
   * taskContract, settings, presentation, createdBy, createdAt, via, key,
   * client — the INSERT's bound values. */
  const inserted = (statements: Statement[]) => {
    const insert = statements.find((s) =>
      s.text.includes('INSERT INTO app.automations'),
    );
    const values = insert?.values ?? [];
    return {
      taskContract: values[6],
      settings: values[7],
      presentation: values[8],
      via: values[11],
      apiKeyId: values[12],
      clientName: values[13],
    };
  };
  const carryArgs = (overrides: Partial<Parameters<typeof saveVersion>[1]>) =>
    args({
      name: 'billing/dunning',
      document: { version: 1, name: 'billing/dunning', nodes: [] },
      metadataMode: 'carry',
      ...overrides,
    });

  it("Ada's agent saves v6 with only a new node: v6 keeps v5's settings, task contract and presentation", async () => {
    const fake = carryStore(5);
    const saved = await saveVersion(fake.sql, carryArgs({}));
    expect(saved).toEqual({
      name: 'billing/dunning',
      version: 6,
      carried: ['settings', 'taskContract', 'presentation'],
    });
    expect(inserted(fake.statements)).toMatchObject({
      settings: { json: LATEST.settings },
      taskContract: { json: LATEST.taskContract },
      presentation: { json: LATEST.presentation },
    });
    // The latest version is read under the name lock, never before it.
    const nameLock = fake.statements.findIndex(
      (s) =>
        s.text.includes('pg_advisory_xact_lock') &&
        s.values.includes('billing/dunning'),
    );
    const latestRead = fake.statements.findIndex(
      (s) =>
        s.text.includes('FROM app.automations') && s.text.includes('ORDER BY'),
    );
    expect(nameLock).toBeGreaterThanOrEqual(0);
    expect(latestRead).toBeGreaterThan(nameLock);
  });

  it('null stores none, a value stores itself, and only what was left out is carried', async () => {
    const fake = carryStore(5);
    const saved = await saveVersion(
      fake.sql,
      carryArgs({ settings: null, taskContract: { workflow: 'other' } }),
    );
    expect(saved.carried).toEqual(['presentation']);
    expect(inserted(fake.statements)).toMatchObject({
      settings: null,
      taskContract: { json: { workflow: 'other' } },
      presentation: { json: LATEST.presentation },
    });
  });

  it('carries nothing into a first version', async () => {
    const fake = carryStore(null);
    const saved = await saveVersion(fake.sql, carryArgs({}));
    expect(saved).toEqual({ name: 'billing/dunning', version: 1, carried: [] });
    expect(inserted(fake.statements)).toMatchObject({
      settings: null,
      taskContract: null,
      presentation: null,
    });
  });

  it('the explicit mode stores none for a field left out, as the editor expects', async () => {
    const fake = carryStore(5);
    const saved = await saveVersion(
      fake.sql,
      carryArgs({ metadataMode: 'explicit' }),
    );
    expect(saved).toEqual({ name: 'billing/dunning', version: 6 });
    expect(inserted(fake.statements)).toMatchObject({
      settings: null,
      taskContract: null,
      presentation: null,
    });
  });

  it('records the door, the key and the client a save came through (0181)', async () => {
    const fake = carryStore(5);
    await saveVersion(
      fake.sql,
      carryArgs({
        actor: 'api-key:user_ada',
        origin: { via: 'mcp', apiKeyId: 'key_1', clientName: 'Claude Code' },
      }),
    );
    expect(inserted(fake.statements)).toMatchObject({
      via: 'mcp',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
    });
  });

  it('audits the saved version, naming what it carried and never the document [AUTO-R28]', async () => {
    vi.mocked(auditDefinitionWrite).mockClear();
    const fake = carryStore(5);
    await saveVersion(
      fake.sql,
      carryArgs({
        actor: 'api-key:user_ada',
        baseVersion: 5,
        testsPassed: true,
      }),
    );
    expect(auditDefinitionWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      actor: 'api-key:user_ada',
      action: 'automation.version.saved',
      name: 'billing/dunning',
      version: 6,
      newState: { version: 6 },
      metadata: {
        version: 6,
        baseVersion: 5,
        carried: ['settings', 'taskContract', 'presentation'],
        testsPassed: true,
      },
    });
  });
});
