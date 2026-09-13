// @vitest-environment node

/**
 * `deploy` stamps the gate's verdict, and the LATEST verdict wins. The
 * regressions under test: a version saved without a test run
 * (`tests_passed` NULL — every MCP `save_automation` before the save ran
 * the tests) kept `testsPassed: null` on the wire after `deploy_automation`
 * had run its tests and promoted it; and a `false` an earlier gate
 * recorded was never lifted by a later gate whose run passed, while a
 * deploy that ran no tests must neither stamp anything nor promote a
 * version saved with failing tests (2026-09-13 evaluation, E4-04).
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import { deploy, recordTestVerdict, setTestsVerdict } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeStore(testsPassed: boolean | null): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.automations WHERE org_id')) {
      return Promise.resolve([
        {
          name: 'ops/greet',
          version: 1,
          document: {},
          message: null,
          testsPassed,
          testsCheckedAt: testsPassed === null ? null : 1_700_000_000_000,
          taskContract: null,
          settings: null,
          presentation: null,
          createdBy: 'user_1',
          createdAt: 1,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tx, {
    json: (value: unknown) => value,
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const args = {
  organizationId: 'org_1',
  name: 'ops/greet',
  version: 1,
  actor: 'u',
};
const stamp = (statements: Statement[]) =>
  statements.find((s) =>
    s.text.startsWith('UPDATE app.automations SET tests_passed'),
  );
const deployed = (statements: Statement[]) =>
  statements.some((s) =>
    s.text.startsWith('INSERT INTO app.automation_deployments'),
  );

describe('deploy — the tests verdict', () => {
  it('stamps the fresh true verdict, and when, on a version saved without one', async () => {
    const fake = fakeStore(null);
    const before = Date.now();
    await deploy(fake.sql, { ...args, testsPassed: true });
    const update = stamp(fake.statements);
    expect(update?.text).toContain('tests_checked_at_ms = ?');
    expect(update?.values.slice(0, 1)).toEqual([true]);
    expect(update?.values[1]).toBeGreaterThanOrEqual(before);
    expect(update?.values.slice(2)).toEqual(['org_1', 'ops/greet', 1]);
    expect(deployed(fake.statements)).toBe(true);
  });

  it('lets a fresh passing run lift a false an earlier gate recorded — the latest verdict wins', async () => {
    const fake = fakeStore(false);
    await deploy(fake.sql, { ...args, testsPassed: true });
    expect(stamp(fake.statements)?.values[0]).toBe(true);
    expect(deployed(fake.statements)).toBe(true);
  });

  it('refuses a version saved with failing tests when no fresh verdict is offered', async () => {
    const fake = fakeStore(false);
    await expect(deploy(fake.sql, args)).rejects.toMatchObject({
      code: 'AUTOMATION_DEPLOY_REJECTED',
      status: 409,
    });
    expect(deployed(fake.statements)).toBe(false);
  });

  it('refuses a failing verdict outright, whatever the row says', async () => {
    const fake = fakeStore(true);
    await expect(
      deploy(fake.sql, { ...args, testsPassed: false }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_DEPLOY_REJECTED' });
    expect(deployed(fake.statements)).toBe(false);
  });

  it('stamps nothing when the gate ran no tests', async () => {
    const fake = fakeStore(null);
    await deploy(fake.sql, args);
    expect(stamp(fake.statements)).toBeUndefined();
    expect(deployed(fake.statements)).toBe(true);
  });
});

describe('setTestsVerdict / recordTestVerdict — the gate’s refusal persists', () => {
  it('writes the verdict and its time to the one version', async () => {
    const fake = fakeStore(null);
    await setTestsVerdict(fake.sql, {
      ...args,
      testsPassed: false,
      at: 1_789_000_000_000,
    });
    expect(stamp(fake.statements)?.values).toEqual([
      false,
      1_789_000_000_000,
      'org_1',
      'ops/greet',
      1,
    ]);
  });

  it('records a standalone verdict in its own transaction with the definition hint', async () => {
    const fake = fakeStore(null);
    await recordTestVerdict(fake.sql, { ...args, testsPassed: false });
    expect(stamp(fake.statements)?.values[0]).toBe(false);
    expect(deployed(fake.statements)).toBe(false);
  });
});
