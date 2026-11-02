// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { postgres } = vi.hoisted(() => ({
  postgres: vi.fn((..._args: unknown[]) => ({
    unsafe: vi.fn(async (query: string) =>
      query.includes('version()')
        ? [{ version: 'PostgreSQL 17.6' }]
        : [{ exists: true }],
    ),
    end: vi.fn(async () => undefined),
  })),
}));
vi.mock('postgres', () => ({ default: postgres }));

import { clearPostgresCaCache } from '../../db/ssl';
import { buildConnectionUrl } from '../knowledge/connection';
import { openKnowledgeSession } from '../knowledge/pool';
import {
  type SslMode,
  testDatastoreConnection,
} from './test_datastore_connection';

/**
 * The knowledge connection's test must speak TLS as the organization's pool
 * will. It used to map `sslmode` itself: `prefer` fell back to plaintext, so a
 * database without TLS passed the test and then never answered the pool, and
 * `verify-ca` checked the hostname and read no CA bundle, so a server signed
 * by a private CA worked in the pool and failed the test (#5330).
 */

const PEM =
  '-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n';

const HOST = 'knowledge.example.test';

/** Every mode the test accepts: a mode added to `SslMode` does not compile
 * here until it is pinned too. */
const EVERY_MODE: Record<SslMode, true> = {
  disable: true,
  prefer: true,
  require: true,
  'verify-ca': true,
  'verify-full': true,
};
const MODES = Object.keys(EVERY_MODE) as SslMode[];

type CaFile = 'unset' | 'readable' | 'unreadable';
const CA_FILES: readonly CaFile[] = ['unset', 'readable', 'unreadable'];

/** A certificate issued to another host than the one connected to. */
const OTHER_HOST_CERT = {
  subject: { CN: 'other.example.test' },
  subjectaltname: 'DNS:other.example.test',
} as PeerCertificate;

/** The `ssl` option a lane handed postgres.js, or how it failed instead. */
type Outcome = { ssl: unknown } | { threw: string } | { failed: string | null };

let dir: string;
let savedCaFile: string | undefined;

beforeEach(async () => {
  postgres.mockClear();
  clearPostgresCaCache();
  savedCaFile = process.env.POSTGRES_CA_FILE;
  delete process.env.POSTGRES_CA_FILE;
  dir = await mkdtemp(path.join(tmpdir(), 'tale-datastore-test-ca-'));
});

afterEach(async () => {
  if (savedCaFile === undefined) {
    delete process.env.POSTGRES_CA_FILE;
  } else {
    process.env.POSTGRES_CA_FILE = savedCaFile;
  }
  clearPostgresCaCache();
  await rm(dir, { recursive: true, force: true });
});

async function useCaFile(caFile: CaFile): Promise<void> {
  if (caFile === 'unset') return;
  const file = path.join(dir, 'bundle.pem');
  if (caFile === 'readable') await writeFile(file, PEM);
  process.env.POSTGRES_CA_FILE = file;
}

/**
 * An `ssl` option as `toStrictEqual` can compare it. `checkServerIdentity` is
 * a fresh closure on every call, so it is replaced by what it decides for a
 * certificate issued to another host; an absent one stays absent, and Node
 * then checks the hostname itself.
 */
function comparable(ssl: unknown): unknown {
  if (typeof ssl !== 'object' || ssl === null) return ssl;
  const { checkServerIdentity, ...rest } = ssl as ConnectionOptions;
  if (checkServerIdentity === undefined) return rest;
  const refusal = checkServerIdentity(HOST, OTHER_HOST_CERT);
  return {
    ...rest,
    checkServerIdentity:
      refusal === undefined
        ? 'accepts another host'
        : `refuses another host: ${refusal.message}`,
  };
}

function lastSsl(): unknown {
  const options = postgres.mock.lastCall?.at(-1) as
    | { ssl?: unknown }
    | undefined;
  if (options === undefined) throw new Error('postgres.js was never called');
  return comparable(options.ssl);
}

function thrown(error: unknown): Outcome {
  return { threw: error instanceof Error ? error.message : String(error) };
}

/** What the test hands postgres.js for one mode. */
async function testOutcome(sslmode: SslMode): Promise<Outcome> {
  postgres.mockClear();
  try {
    const result = await testDatastoreConnection({
      host: HOST,
      port: 5432,
      database: 'corpus',
      user: 'tale',
      password: 'secret',
      sslmode,
    });
    if (!result.ok) return { failed: result.error };
  } catch (error) {
    return thrown(error);
  }
  return { ssl: lastSsl() };
}

/** What the knowledge pool hands postgres.js for the same organization
 * connection: the real factory, on the URL the organization's lane builds. */
function poolOutcome(sslmode: SslMode): Outcome {
  postgres.mockClear();
  try {
    openKnowledgeSession(
      buildConnectionUrl({
        connection: {
          host: HOST,
          port: 5432,
          database: 'corpus',
          user: 'tale',
          sslmode,
        },
        password: 'secret',
      }),
    );
  } catch (error) {
    return thrown(error);
  }
  return { ssl: lastSsl() };
}

describe('testDatastoreConnection TLS', () => {
  it.each(
    MODES.flatMap((sslmode) => CA_FILES.map((caFile) => ({ sslmode, caFile }))),
  )(
    'resolves $sslmode as the knowledge pool does, POSTGRES_CA_FILE $caFile',
    async ({ sslmode, caFile }) => {
      await useCaFile(caFile);
      const pool = poolOutcome(sslmode);
      clearPostgresCaCache();

      expect(await testOutcome(sslmode)).toStrictEqual(pool);
    },
  );

  it('asks for TLS on `prefer` with no plaintext fallback, so a database without TLS fails', async () => {
    // postgres.js falls back to plaintext only for the string 'prefer'; given
    // options it starts TLS whatever the server answers.
    expect(await testOutcome('prefer')).toStrictEqual({
      ssl: { rejectUnauthorized: false },
    });
  });

  it('checks `verify-ca` against POSTGRES_CA_FILE and not the hostname', async () => {
    await useCaFile('readable');

    expect(await testOutcome('verify-ca')).toStrictEqual({
      ssl: {
        rejectUnauthorized: true,
        ca: PEM,
        checkServerIdentity: 'accepts another host',
      },
    });
  });

  it('refuses to run without a CA bundle it was told to trust', async () => {
    await useCaFile('unreadable');

    const outcome = await testOutcome('verify-full');

    expect(outcome).toMatchObject({
      threw: expect.stringContaining('could not read the Postgres CA bundle'),
    });
    expect(postgres).not.toHaveBeenCalled();
  });
});
