// @vitest-environment node

/**
 * The `sops` shell-out is reached from HTTP handlers (object-store resolves,
 * credential saves) on a single-threaded event loop, so the contract under
 * test is: the child runs OFF the loop, a wedged child is killed at the
 * timeout, and concurrent cold reads of one file spawn one child. A fake
 * `sops` on PATH makes each of those observable and deterministic; the real
 * binary (when installed) proves the encrypt → decrypt round trip.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { deriveAgePublicKey } from './age_keygen';
import {
  decryptSecretsFile,
  encryptJsonWithSops,
  EncryptedFileWithoutKeyError,
  invalidateSecretsCache,
} from './sops';

/** A throwaway age identity minted for this suite — it protects nothing. */
const TEST_AGE_KEY =
  'AGE-SECRET-KEY-1V7RF0SP7WHE2LNTTHLYL2ART4WRD09HCP3VU5M4X5NCNUS6MQ9WQ2UDVCK';

const ORIGINAL_PATH = process.env.PATH ?? '';
const ORIGINAL_ENV = {
  key: process.env.SOPS_AGE_KEY,
  keyFile: process.env.SOPS_AGE_KEY_FILE,
};

function realSopsAvailable(): boolean {
  try {
    execFileSync('sops', ['--version'], {
      stdio: 'ignore',
      env: { ...process.env, PATH: ORIGINAL_PATH },
    });
    return true;
  } catch {
    return false;
  }
}
const HAS_REAL_SOPS = realSopsAvailable();

/**
 * The fake `sops`: logs every invocation to FAKE_SOPS_LOG, waits
 * FAKE_SOPS_DELAY_MS, then answers `-d` with FAKE_SOPS_DECRYPTED and `-e`
 * with an encrypted-shaped document. A single node process, so a kill closes
 * its stdio at once (a shell wrapper would leave a `sleep` holding the pipe).
 */
const FAKE_SOPS_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_SOPS_LOG, args.join(' ') + '\\n');
const delay = Number(process.env.FAKE_SOPS_DELAY_MS || '0');
setTimeout(() => {
  if (process.env.FAKE_SOPS_FAIL) {
    process.stderr.write('fake sops: ' + process.env.FAKE_SOPS_FAIL);
    process.exitCode = 1;
  } else if (args[0] === '-d') {
    process.stdout.write(process.env.FAKE_SOPS_DECRYPTED || '{}');
  } else if (args[0] === '-e') {
    process.stdout.write(JSON.stringify({ sops: { age: [] }, data: 'ENC[fake]' }));
  } else {
    process.stderr.write('fake sops: unknown verb ' + args[0]);
    process.exitCode = 1;
  }
}, delay);
`;

let root: string;
let fakeBin: string;
let logFile: string;
let fileCounter = 0;

const ENCRYPTED_SHAPE = JSON.stringify({
  apiKey: 'ENC[AES256_GCM,data:xx,type:str]',
  sops: { age: [{ recipient: 'age1test' }], version: '3.9.4' },
});

function writeSecretsFile(content: string): string {
  fileCounter += 1;
  const file = path.join(root, `secrets-${fileCounter}.json`);
  writeFileSync(file, content);
  return file;
}

function invocations(): string[] {
  try {
    return readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** A timer armed alongside an awaited call — records WHEN the loop got to
 * run it, which is how a blocked loop shows up as a late tick. */
function armTick(delayMs: number): {
  done: Promise<void>;
  firedAt: () => number;
} {
  let firedAt = 0;
  const done = new Promise<void>((resolve) => {
    setTimeout(() => {
      firedAt = Date.now();
      resolve();
    }, delayMs);
  });
  return { done, firedAt: () => firedAt };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sops-test-'));
  fakeBin = path.join(root, 'bin');
  mkdirSync(fakeBin);
  const fake = path.join(fakeBin, 'sops');
  writeFileSync(fake, FAKE_SOPS_SOURCE);
  chmodSync(fake, 0o755);
  process.env.PATH = `${fakeBin}${path.delimiter}${ORIGINAL_PATH}`;
});

afterAll(() => {
  process.env.PATH = ORIGINAL_PATH;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  logFile = path.join(root, `log-${Date.now()}-${Math.random()}.txt`);
  process.env.FAKE_SOPS_LOG = logFile;
  process.env.FAKE_SOPS_DELAY_MS = '0';
  process.env.FAKE_SOPS_DECRYPTED = JSON.stringify({ apiKey: 'decrypted' });
  process.env.SOPS_AGE_KEY = TEST_AGE_KEY;
  delete process.env.SOPS_AGE_KEY_FILE;
});

afterEach(() => {
  if (ORIGINAL_ENV.key === undefined) delete process.env.SOPS_AGE_KEY;
  else process.env.SOPS_AGE_KEY = ORIGINAL_ENV.key;
  if (ORIGINAL_ENV.keyFile === undefined) delete process.env.SOPS_AGE_KEY_FILE;
  else process.env.SOPS_AGE_KEY_FILE = ORIGINAL_ENV.keyFile;
});

describe('decryptSecretsFile', () => {
  it('runs sops off the event loop — a timer fires while the decrypt is in flight', async () => {
    process.env.FAKE_SOPS_DELAY_MS = '600';
    const file = writeSecretsFile(ENCRYPTED_SHAPE);
    const startedAt = Date.now();
    const tick = armTick(20);

    const data = await decryptSecretsFile(file);
    await tick.done;

    expect(data).toEqual({ apiKey: 'decrypted' });
    // A synchronous spawn would have held the loop for the whole 600ms and
    // the 20ms timer would only fire afterwards.
    expect(tick.firedAt() - startedAt).toBeLessThan(300);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(550);
  });

  it('kills a hung sops at the timeout and says so', async () => {
    process.env.FAKE_SOPS_DELAY_MS = '60000';
    const file = writeSecretsFile(ENCRYPTED_SHAPE);
    const startedAt = Date.now();

    await expect(decryptSecretsFile(file, { timeoutMs: 300 })).rejects.toThrow(
      /timed out after 300ms/,
    );

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(invocations()).toHaveLength(1);
  });

  it('shares one sops process across concurrent cold reads of the same file', async () => {
    process.env.FAKE_SOPS_DELAY_MS = '200';
    const file = writeSecretsFile(ENCRYPTED_SHAPE);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => decryptSecretsFile(file)),
    );

    for (const result of results) {
      expect(result).toEqual({ apiKey: 'decrypted' });
    }
    expect(invocations().filter((line) => line.startsWith('-d '))).toHaveLength(
      1,
    );
  });

  it('serves the cache until the file changes, and re-reads after invalidation', async () => {
    const file = writeSecretsFile(ENCRYPTED_SHAPE);
    expect(await decryptSecretsFile(file)).toEqual({ apiKey: 'decrypted' });
    expect(await decryptSecretsFile(file)).toEqual({ apiKey: 'decrypted' });
    expect(invocations()).toHaveLength(1);

    // Same content, new mtime → a re-read.
    const later = new Date(Date.now() + 5_000);
    utimesSync(file, later, later);
    process.env.FAKE_SOPS_DECRYPTED = JSON.stringify({ apiKey: 'rotated' });
    expect(await decryptSecretsFile(file)).toEqual({ apiKey: 'rotated' });
    expect(invocations()).toHaveLength(2);

    invalidateSecretsCache(file);
    expect(await decryptSecretsFile(file)).toEqual({ apiKey: 'rotated' });
    expect(invocations()).toHaveLength(3);
  });

  it('reads a plaintext file without spawning sops', async () => {
    const file = writeSecretsFile(JSON.stringify({ apiKey: 'plain' }));
    expect(await decryptSecretsFile(file)).toEqual({ apiKey: 'plain' });
    expect(invocations()).toHaveLength(0);
  });

  it('refuses an encrypted file when no age key is configured', async () => {
    delete process.env.SOPS_AGE_KEY;
    const file = writeSecretsFile(ENCRYPTED_SHAPE);
    await expect(decryptSecretsFile(file)).rejects.toBeInstanceOf(
      EncryptedFileWithoutKeyError,
    );
    expect(invocations()).toHaveLength(0);
  });

  it('surfaces a failing sops with its stderr', async () => {
    process.env.FAKE_SOPS_FAIL = 'no identity matched any of the recipients';
    try {
      const file = writeSecretsFile(ENCRYPTED_SHAPE);
      await expect(decryptSecretsFile(file)).rejects.toThrow(
        /no identity matched any of the recipients/,
      );
    } finally {
      delete process.env.FAKE_SOPS_FAIL;
    }
  });
});

describe('encryptJsonWithSops', () => {
  it('runs sops off the event loop and addresses every configured recipient', async () => {
    process.env.FAKE_SOPS_DELAY_MS = '300';
    const startedAt = Date.now();
    const tick = armTick(20);

    const encrypted = await encryptJsonWithSops('{"apiKey":"v"}');
    await tick.done;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's answer shape
    const parsed = JSON.parse(encrypted) as { sops?: unknown };
    expect(parsed.sops).toBeDefined();
    expect(tick.firedAt() - startedAt).toBeLessThan(200);
    const call = invocations()[0] ?? '';
    expect(call.startsWith('-e ')).toBe(true);
    expect(call).toContain(`--age ${deriveAgePublicKey(TEST_AGE_KEY)}`);
  });

  it('kills a hung sops at the timeout', async () => {
    process.env.FAKE_SOPS_DELAY_MS = '60000';
    const startedAt = Date.now();
    await expect(
      encryptJsonWithSops('{"apiKey":"v"}', { timeoutMs: 300 }),
    ).rejects.toThrow(/timed out after 300ms/);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('refuses to encrypt without an age key', async () => {
    delete process.env.SOPS_AGE_KEY;
    await expect(encryptJsonWithSops('{}')).rejects.toThrow(
      /No age secret key/,
    );
    expect(invocations()).toHaveLength(0);
  });
});

describe.skipIf(!HAS_REAL_SOPS)('real sops round trip', () => {
  beforeEach(() => {
    // The real binary, not the fake.
    process.env.PATH = ORIGINAL_PATH;
  });
  afterEach(() => {
    process.env.PATH = `${fakeBin}${path.delimiter}${ORIGINAL_PATH}`;
  });

  it('encrypts to the configured age recipient and decrypts it back', async () => {
    const encrypted = await encryptJsonWithSops(
      JSON.stringify({ apiKey: 'round-trip', nested: { n: 1 } }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sops output shape
    const shape = JSON.parse(encrypted) as { sops?: unknown; apiKey?: string };
    expect(shape.sops).toBeDefined();
    expect(shape.apiKey).toMatch(/^ENC\[/);

    const file = writeSecretsFile(encrypted);
    expect(await decryptSecretsFile(file)).toEqual({
      apiKey: 'round-trip',
      nested: { n: 1 },
    });
  }, 20_000);
});
