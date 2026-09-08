// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPostgresCaCache,
  resolvePostgresConnection,
  sslOptionsFor,
} from './ssl';

/**
 * The backend reaches Postgres through two drivers that disagree about what a
 * connection string's TLS parameters mean, so this module takes the decision
 * away from both. These tests pin the two things that disagreement broke:
 * every driver gets a URL with nothing left to reinterpret, and the modes mean
 * what libpq says they mean.
 */

const PEM =
  '-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n';

let dir: string;
let caFile: string;
let savedCaFile: string | undefined;

beforeEach(async () => {
  clearPostgresCaCache();
  savedCaFile = process.env.POSTGRES_CA_FILE;
  delete process.env.POSTGRES_CA_FILE;
  dir = await mkdtemp(path.join(tmpdir(), 'tale-pg-ca-'));
  caFile = path.join(dir, 'bundle.pem');
  await writeFile(caFile, PEM);
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

describe('resolvePostgresConnection', () => {
  it('leaves a URL with no sslmode on plaintext', () => {
    // The bundled deployment's URL carries no sslmode and its Postgres serves
    // no TLS; defaulting to libpq's `prefer` would change that hop.
    const result = resolvePostgresConnection('postgresql://u:p@db:5432/tale');
    expect(result.ssl).toBe(false);
    expect(result.url).toBe('postgresql://u:p@db:5432/tale');
  });

  it('strips every TLS parameter so no driver re-reads them', () => {
    // node-postgres merges a parsed connection string OVER the config object,
    // so a surviving `sslmode` would silently outrank the options we pass.
    const result = resolvePostgresConnection(
      'postgresql://u:p@host:5432/tale?sslmode=verify-full&sslrootcert=system&application_name=x',
    );
    expect(result.url).not.toContain('sslmode');
    expect(result.url).not.toContain('sslrootcert');
    expect(result.url).toContain('application_name=x');
  });

  it('refuses an sslmode nobody implements', () => {
    expect(() =>
      resolvePostgresConnection('postgresql://u:p@h:5432/d?sslmode=verify'),
    ).toThrow(/sslmode "verify"/);
  });

  it('hands back a non-URL DSN untouched', () => {
    const dsn = 'host=db user=tale dbname=tale_app';
    const result = resolvePostgresConnection(dsn);
    expect(result.url).toBe(dsn);
    expect(result.ssl).toBe(false);
  });

  it('reads the deployment CA bundle for a verifying mode', () => {
    const result = resolvePostgresConnection(
      'postgresql://u:p@rds.example:5432/tale?sslmode=verify-full',
      { POSTGRES_CA_FILE: caFile },
    );
    expect(result.ssl).toMatchObject({ rejectUnauthorized: true, ca: PEM });
  });

  it('takes a per-connection sslrootcert over the deployment bundle', () => {
    const other = path.join(dir, 'other.pem');
    return writeFile(other, 'other').then(() => {
      const result = resolvePostgresConnection(
        `postgresql://u:p@h:5432/d?sslmode=verify-full&sslrootcert=${other}`,
        { POSTGRES_CA_FILE: caFile },
      );
      expect(result.ssl).toMatchObject({ ca: 'other' });
    });
  });

  it('fails loudly on an unreadable CA rather than connecting unverified', () => {
    // A silent downgrade here would connect anyway and report nothing, which
    // is exactly what the operator asked not to happen.
    expect(() =>
      resolvePostgresConnection('postgresql://u:p@h:5432/d?sslmode=verify-ca', {
        POSTGRES_CA_FILE: path.join(dir, 'missing.pem'),
      }),
    ).toThrow(/could not read the Postgres CA bundle/);
  });
});

describe('sslOptionsFor', () => {
  it('disables TLS for `disable`', () => {
    expect(sslOptionsFor('disable')).toBe(false);
  });

  it.each(['allow', 'prefer', 'require'] as const)(
    'encrypts without authenticating for `%s`',
    (mode) => {
      // libpq's semantics: these modes protect against passive eavesdropping
      // only, and promising more would be a lie.
      expect(sslOptionsFor(mode)).toMatchObject({ rejectUnauthorized: false });
    },
  );

  it('checks the chain but not the hostname for `verify-ca`', () => {
    // The whole difference from verify-full — and the one postgres.js gets
    // wrong by routing verify-ca through its verify-full branch.
    const options = sslOptionsFor('verify-ca');
    expect(options).toMatchObject({ rejectUnauthorized: true });
    expect(
      options !== false && typeof options.checkServerIdentity === 'function',
    ).toBe(true);
  });

  it('checks the hostname too for `verify-full`', () => {
    const options = sslOptionsFor('verify-full');
    expect(options).toMatchObject({ rejectUnauthorized: true });
    expect(options !== false && options.checkServerIdentity).toBeUndefined();
  });

  it('uses the system trust store for `sslrootcert=system`', () => {
    const options = sslOptionsFor('verify-full', 'system', {
      POSTGRES_CA_FILE: caFile,
    });
    // No `ca` at all is how Node says "the roots you shipped with".
    expect(options !== false && options.ca).toBeUndefined();
  });
});
