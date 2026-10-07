import { expect, test } from 'bun:test';

import { valueHash } from '../config/releases/identity';
import { acceptanceHealth } from './acceptance-health';
import {
  acceptedMigrations,
  acceptanceMigrationScript,
  ACCEPTANCE_SQL,
} from './acceptance-migrations';
import { deploymentAcceptanceSchema } from './acceptance-model';
import type { MigrationInventory } from './migration-model';

const inventory: MigrationInventory = [
  {
    service: 'db',
    schema: 'public',
    table: 'app_migrations',
    ids: ['0001_initial.sql', '0002_data.ts'],
  },
  {
    service: 'knowledge-db',
    schema: 'private_knowledge',
    table: 'schema_migrations',
    ids: ['1', '10', '2'],
  },
  {
    service: 'knowledge-db',
    schema: 'public_web',
    table: 'schema_migrations',
    ids: ['1'],
  },
];
test('migration hashes use compact sorted JSON and lexical IDs, including numbered TS', () => {
  const accepted = acceptedMigrations(
    inventory,
    '["0001_initial.sql","0002_data.ts"]',
    '["1","10","2"]\n["1"]',
  );
  expect(accepted.map((x) => x.inventorySha256)).toEqual(
    inventory.map(valueHash),
  );
  expect(accepted[0]?.ids).toContain('0002_data.ts');
  expect(valueHash(inventory[0])).toBe(
    valueHash({
      ids: inventory[0].ids,
      table: 'app_migrations',
      schema: 'public',
      service: 'db',
    }),
  );
});
for (const knowledge of [
  '["1","2","10"]\n["1"]',
  '["1","10","2","2"]\n["1"]',
  '[]\n["1"]',
  '["00000000000001","10","2"]\n["1"]',
  '[]',
  '[]\n[]\n[]',
  'not json',
])
  test(`refuses malformed or different knowledge ledger ${knowledge}`, () => {
    expect(() =>
      acceptedMigrations(
        inventory,
        '["0001_initial.sql","0002_data.ts"]',
        knowledge,
      ),
    ).toThrow('migration ledgers');
  });
test('SQL transport is fixed, bounded, read-only and never emits credentials', () => {
  for (const service of ['db', 'knowledge-db'] as const) {
    const script = acceptanceMigrationScript(service);
    expect(script).toContain('BEGIN READ ONLY;');
    expect(script).toContain("SET LOCAL statement_timeout = '5s';");
    expect(script).toContain('LIMIT 2049');
    expect(script).toContain('ROLLBACK;');
    expect(script).toContain('psql -X -q -A -t -v ON_ERROR_STOP=1');
    expect(script).not.toContain('PGPASSWORD=');
    expect(ACCEPTANCE_SQL[service]).not.toMatch(
      /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/,
    );
  }
});
for (const [status, body] of [
  [503, { status: 'ok', version: '1.2.3' }],
  [200, { status: 'ok', version: '1.2.2' }],
  [200, { status: 'ok', version: '1.2.3', extra: 'not public receipt' }],
  [200, { status: 'starting', version: '1.2.3' }],
  [200, 'x'.repeat(65537)],
] as const)
  test(`health refuses status ${status} or invalid body`, async () => {
    const request = (async (_url: string | URL | Request) =>
      typeof body === 'string'
        ? new Response(body, { status })
        : Response.json(body, { status })) as typeof fetch;
    await expect(
      acceptanceHealth('https://example.invalid', '1.2.3', 1000, request),
    ).rejects.toThrow('healthy serving version');
  });
test('health follows no redirects, sends no credentials and validates bounded success', async () => {
  let seen = false;
  const request = (async (url, options) => {
    expect(url).toBe('https://example.invalid/api/health');
    expect(options?.redirect).toBe('error');
    expect(options?.credentials).toBe('omit');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    seen = true;
    return Response.json({ status: 'ok', version: '1.2.3' });
  }) as typeof fetch;
  expect(
    await acceptanceHealth('https://example.invalid', '1.2.3', 1000, request),
  ).toEqual({ status: 'ok', version: '1.2.3' });
  expect(seen).toBe(true);
});
test('health cancels a stalled actual response under its deadline', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
      ),
  });
  try {
    await expect(
      acceptanceHealth(`http://127.0.0.1:${server.port}`, '1.2.3', 50),
    ).rejects.toThrow('healthy serving version');
  } finally {
    await server.stop(true);
  }
});
test('acceptance receipt rejects undeclared fields', () => {
  expect(
    deploymentAcceptanceSchema.safeParse({
      schemaVersion: 1,
      kind: 'tale-deployment-acceptance',
      secret: 'hidden',
    }).success,
  ).toBe(false);
});
