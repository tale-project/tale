// @vitest-environment node

/**
 * `deploy` stamps the gate's verdict. The regression under test: a version
 * saved without a test run (`tests_passed` NULL — every MCP `save_automation`)
 * kept `testsPassed: null` on the wire after `deploy_automation` had run its
 * tests and promoted it, so the API reference's "deploy a version whose
 * tests pass" was never visible on `GET /automations/{name}`. A verdict the
 * save already stored is never overwritten, and a deploy that ran no tests
 * stamps nothing.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import { deploy } from './store.ts';

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

describe('deploy — the tests verdict', () => {
  it('stamps tests_passed = true on a version saved without a verdict', async () => {
    const fake = fakeStore(null);
    await deploy(fake.sql, { ...args, testsPassed: true });
    const update = stamp(fake.statements);
    expect(update?.text).toContain('tests_passed IS NULL');
    expect(update?.values).toEqual(['org_1', 'ops/greet', 1]);
  });

  it('leaves a stored verdict alone', async () => {
    const fake = fakeStore(true);
    await deploy(fake.sql, { ...args, testsPassed: true });
    expect(stamp(fake.statements)).toBeUndefined();
  });

  it('stamps nothing when the gate ran no tests', async () => {
    const fake = fakeStore(null);
    await deploy(fake.sql, args);
    expect(stamp(fake.statements)).toBeUndefined();
  });
});
