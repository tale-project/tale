import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';

import { exec } from '../docker/exec';
import { migrationSessionCommand } from './acceptance-migrations';
import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  requireEmptyLegacyCensus,
} from './automation-cutover';
import { automationSession } from './automation-session';
import { runtimeProcessEnvironment } from './runtime-command';

// Opt in with a local immutable tale-db image; no pull/build, persistent volume,
// published port or pre-existing container is used. This tests the real session
// and PostgreSQL lock, not the provenance of a newly built candidate image.
const image = process.env.TALE_CUTOVER_PG_IMAGE;
const integration = describe.skipIf(!image);
let container = '';
const command = async (
  args: string[],
  stdin?: string,
  env?: Record<string, string>,
) => {
  const result = await exec('docker', args, {
    silent: true,
    timeout: 60,
    maxOutputBytes: 1_048_576,
    env: env ?? runtimeProcessEnvironment(),
    ...(stdin === undefined ? {} : { stdin }),
  });
  if (!result.success) throw new Error('Owned cutover fixture command failed.');
  return result.stdout;
};

integration('physical PostgreSQL automation cutover admission barrier', () => {
  beforeAll(async () => {
    if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error('Use an existing immutable local DB image ID.');
    container = await command(
      [
        'run',
        '-d',
        '--pull',
        'never',
        '--name',
        `tale-cutover-test-${randomUUID()}`,
        '--label',
        'dev.tale.test=automation-cutover',
        '--memory',
        '1g',
        '--cpus',
        '2',
        '--shm-size',
        '128m',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=1g',
        '-e',
        'DB_PASSWORD',
        '-e',
        'DB_USER=tale',
        '-e',
        'DB_NAME=tale',
        '-e',
        'TALE_DB_ROLE=platform',
        '-e',
        'DB_SHARED_BUFFERS=128MB',
        '-e',
        'DB_WORK_MEM=8MB',
        '-e',
        'DB_MAINTENANCE_WORK_MEM=64MB',
        image,
      ],
      undefined,
      {
        ...runtimeProcessEnvironment(),
        DB_PASSWORD: randomBytes(24).toString('hex'),
      },
    );
    if (!/^[a-f0-9]{64}$/.test(container))
      throw new Error('Owned fixture identity missing.');
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        await command([
          'exec',
          container,
          'sh',
          '-c',
          'test -f /tmp/.db_ready && pg_isready -U tale -d tale_app >/dev/null',
        ]);
        ready = true;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    if (!ready)
      throw new Error('Owned PostgreSQL fixture did not become ready.');
    const ids = readdirSync(
      new URL(
        '../../../../../services/platform/backend/db/migrations/',
        import.meta.url,
      ),
    )
      .filter(
        (name) =>
          /^\d{4}_[a-z0-9_]+\.(sql|ts)$/.test(name) &&
          Number(name.slice(0, 4)) <= 153,
      )
      .sort();
    await command(
      ['exec', '-i', container, 'sh', '-c', migrationSessionCommand('db')],
      `CREATE SCHEMA IF NOT EXISTS tale;
CREATE SCHEMA app;
CREATE TABLE tale.app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.automation_runs (id text PRIMARY KEY, org_id text NOT NULL, status text NOT NULL);
COPY tale.app_migrations(name) FROM STDIN;
${ids.join('\n')}
\\.
`,
    );
  }, 90_000);
  afterAll(async () => {
    if (/^[a-f0-9]{64}$/.test(container))
      await command(['rm', '-f', container]);
  }, 15_000);

  test('a held zero prevents a competing admission; release permits it again', async () => {
    const held = await automationSession(container);
    const writer = await automationSession(container);
    try {
      requireEmptyLegacyCensus(
        await held.query(AUTOMATION_CUTOVER_ACQUIRE_SQL),
      );
      await expect(
        writer.query(
          "SET statement_timeout = '300ms'; INSERT INTO app.automation_runs VALUES ('competing', 'other-org', 'queued');",
        ),
      ).rejects.toThrow('lock session');
      expect(
        JSON.parse(await held.query(AUTOMATION_CUTOVER_PROBE_SQL)),
      ).toEqual({ owned: true });
    } finally {
      await writer.close();
      await held.close();
    }
    const next = await automationSession(container);
    try {
      await next.query(
        "INSERT INTO app.automation_runs VALUES ('after-release', 'other-org', 'queued');",
      );
      expect(
        await next.query(
          "SELECT count(*) FROM app.automation_runs WHERE id = 'after-release';",
        ),
      ).toBe('1');
      await next.query(
        "DELETE FROM app.automation_runs WHERE id = 'after-release';",
      );
    } finally {
      await next.close();
    }
  });

  test('an uncommitted old admission refuses acquisition instead of manufacturing zero', async () => {
    const writer = await automationSession(container);
    const held = await automationSession(container);
    try {
      await writer.query(
        "BEGIN; INSERT INTO app.automation_runs VALUES ('uncommitted', 'other-org', 'queued');",
      );
      await expect(held.query(AUTOMATION_CUTOVER_ACQUIRE_SQL)).rejects.toThrow(
        'lock session',
      );
      expect(held.healthy()).toBe(false);
    } finally {
      await held.close();
      await writer.close();
    }
  });

  test('server-side session loss revokes lock ownership and refuses further operations', async () => {
    const held = await automationSession(container);
    const killer = await automationSession(container);
    try {
      requireEmptyLegacyCensus(
        await held.query(AUTOMATION_CUTOVER_ACQUIRE_SQL),
      );
      await killer.query(
        "SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_locks WHERE relation = 'app.automation_runs'::regclass AND mode = 'ShareLock' AND granted;",
      );
      await expect(held.query(AUTOMATION_CUTOVER_PROBE_SQL)).rejects.toThrow(
        'lock session',
      );
      expect(held.healthy()).toBe(false);
    } finally {
      await held.close();
      await killer.close();
    }
  });
});
