// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    );
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { execFileSync } from 'node:child_process';

import {
  EncryptedFileWithoutKeyError,
  decryptSecretsFile,
  hasSopsKey,
  invalidateSecretsCache,
} from './sops';

const mockedExecFile = vi.mocked(execFileSync);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sops-test-'));
  mockedExecFile.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function writeFixture(name: string, content: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, content, 'utf-8');
  invalidateSecretsCache(p);
  return p;
}

describe('decryptSecretsFile — plaintext mode', () => {
  it('returns parsed JSON when the file has no sops key', async () => {
    const file = writeFixture('plain.json', '{"apiKey":"sk-test"}');
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    const data = await decryptSecretsFile(file);

    expect(data).toEqual({ apiKey: 'sk-test' });
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('rejects a top-level array', async () => {
    const file = writeFixture('arr.json', '[1, 2, 3]');

    await expect(decryptSecretsFile(file)).rejects.toThrow(
      /must contain a JSON object/i,
    );
  });

  it('rejects a top-level null', async () => {
    const file = writeFixture('null.json', 'null');

    await expect(decryptSecretsFile(file)).rejects.toThrow(
      /must contain a JSON object/i,
    );
  });

  it('rejects malformed JSON with a clear error', async () => {
    const file = writeFixture('bad.json', '{not json');

    await expect(decryptSecretsFile(file)).rejects.toThrow(
      /Failed to parse secrets file/i,
    );
  });
});

describe('decryptSecretsFile — encrypted mode', () => {
  const sopsShaped = JSON.stringify({
    apiKey: 'ENC[AES256_GCM,...]',
    sops: { kms: null, age: [{ recipient: 'age1...' }], lastmodified: 'now' },
  });

  it('throws EncryptedFileWithoutKeyError when no key configured', async () => {
    const file = writeFixture('enc.json', sopsShaped);
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    await expect(decryptSecretsFile(file)).rejects.toBeInstanceOf(
      EncryptedFileWithoutKeyError,
    );
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('treats whitespace-only env values as unset', async () => {
    const file = writeFixture('enc.json', sopsShaped);
    vi.stubEnv('SOPS_AGE_KEY', '   ');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    await expect(decryptSecretsFile(file)).rejects.toBeInstanceOf(
      EncryptedFileWithoutKeyError,
    );
  });

  it('shells out to sops -d when a key is set, returns decrypted JSON', async () => {
    const file = writeFixture('enc.json', sopsShaped);
    vi.stubEnv('SOPS_AGE_KEY', 'AGE-SECRET-KEY-1FAKE');
    mockedExecFile.mockReturnValueOnce('{"apiKey":"sk-decrypted"}');

    const data = await decryptSecretsFile(file);

    expect(data).toEqual({ apiKey: 'sk-decrypted' });
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0];
    expect(call?.[0]).toBe('sops');
    expect(call?.[1]).toEqual(['-d', '--output-type', 'json', file]);
  });

  it('SOPS_AGE_KEY_FILE alone satisfies hasSopsKey()', () => {
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '/path/to/keys.txt');

    expect(hasSopsKey()).toBe(true);
  });

  it('hasSopsKey() returns false when both env vars are blank', () => {
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    expect(hasSopsKey()).toBe(false);
  });
});

describe('decryptSecretsFile — caching', () => {
  it('serves a second call from cache when mtime is unchanged', async () => {
    const file = writeFixture('plain.json', '{"apiKey":"sk-1"}');

    const first = await decryptSecretsFile(file);
    const second = await decryptSecretsFile(file);

    expect(first).toBe(second); // same object reference, served from cache
  });

  it('invalidateSecretsCache forces a re-read', async () => {
    const file = writeFixture('plain.json', '{"apiKey":"sk-1"}');

    const first = await decryptSecretsFile(file);
    invalidateSecretsCache(file);
    const second = await decryptSecretsFile(file);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
