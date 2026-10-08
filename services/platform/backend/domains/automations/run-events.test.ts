// @vitest-environment node

/**
 * Unit lock for a run's event record: every row names the process that
 * observed it and that process's release, carries the kind and the detail
 * as given, and is inserted in the caller's transaction. A deferral re-tried
 * every few seconds is recorded once per release (`oncePerEngine`).
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  engineVersion,
  instanceId,
  resetInstanceIdForTests,
} from '../../lib/instance.ts';
import { recordRunEventInTx } from './run-events.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(inserted: boolean): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(inserted ? [{ id: 'event_1' }] : []);
  };
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetInstanceIdForTests();
});

describe('recordRunEventInTx', () => {
  it('stamps the observing process and its release beside the kind and detail', async () => {
    vi.stubEnv('TALE_VERSION', '0.5.80');
    vi.stubEnv('TALE_COLOR', 'green');
    const fake = fakeSql(true);
    await expect(
      recordRunEventInTx(fake.sql, {
        organizationId: 'org_1',
        runId: 'run_1',
        kind: 'handed_off',
        detail: { reason: 'shutdown', nodeId: 'send' },
      }),
    ).resolves.toBe(true);
    const [insert] = fake.statements;
    expect(insert?.text).toContain('INSERT INTO app.automation_run_events');
    const [runId, orgId, at, kind, instance, version, detail] =
      insert?.values ?? [];
    expect([runId, orgId, kind]).toEqual(['run_1', 'org_1', 'handed_off']);
    expect(typeof at).toBe('number');
    expect(instance).toBe(instanceId());
    expect(String(instance).endsWith(':green')).toBe(true);
    expect(version).toBe(engineVersion());
    expect(version).toBe('0.5.80');
    expect(detail).toEqual({ json: { reason: 'shutdown', nodeId: 'send' } });
    // Not limited to one per release unless asked.
    expect(insert?.values[7]).toBe(true);
  });

  it('binds no detail when there is none', async () => {
    const fake = fakeSql(true);
    await recordRunEventInTx(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      kind: 'lease_expired',
    });
    expect(fake.statements[0]?.values[6]).toBeNull();
  });

  it('skips a repeat of the same kind by the same release when asked to', async () => {
    const fake = fakeSql(false);
    await expect(
      recordRunEventInTx(fake.sql, {
        organizationId: 'org_1',
        runId: 'run_1',
        kind: 'engine_deferred',
        oncePerEngine: true,
      }),
    ).resolves.toBe(false);
    const [insert] = fake.statements;
    expect(insert?.values[7]).toBe(false);
    expect(insert?.text).toContain('NOT EXISTS');
    expect(insert?.text).toContain('AND engine_version = ?');
  });
});
