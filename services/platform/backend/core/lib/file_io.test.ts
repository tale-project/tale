// @vitest-environment node

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteSecret, readJsonFile } from './file_io';

/** Root bypasses file permissions, so the EACCES lane cannot be produced. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

let dir: string;
let prevUmask: number;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fileio-test-'));
  prevUmask = process.umask(0o022);
});

afterEach(() => {
  process.umask(prevUmask);
  rmSync(dir, { recursive: true, force: true });
});

describe('atomicWriteSecret', () => {
  it('writes the file with mode 0o600 under umask 0o022', async () => {
    const target = path.join(dir, 'secret.json');
    await atomicWriteSecret(target, '{"apiKey":"x"}');

    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(target, 'utf-8')).toBe('{"apiKey":"x"}');
  });

  it('still produces 0o600 under a more permissive umask 0o002', async () => {
    process.umask(0o002);

    const target = path.join(dir, 'secret.json');
    await atomicWriteSecret(target, 'hello');

    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('still produces 0o600 under a stricter umask 0o077', async () => {
    process.umask(0o077);

    const target = path.join(dir, 'secret.json');
    await atomicWriteSecret(target, 'hello');

    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('replaces an existing file atomically', async () => {
    const target = path.join(dir, 'secret.json');
    writeFileSync(target, 'old', { mode: 0o600 });

    await atomicWriteSecret(target, 'new');

    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('does not leave a temp file behind on success', async () => {
    const target = path.join(dir, 'secret.json');
    await atomicWriteSecret(target, 'hello');

    const { readdirSync } = await import('node:fs');
    const remaining = readdirSync(dir);
    expect(remaining).toEqual([path.basename(target)]);
  });
});

describe('readJsonFile', () => {
  const parse = (content: string): unknown => JSON.parse(content);

  it('reads and hashes a well-formed file', async () => {
    const target = path.join(dir, 'config.json');
    writeFileSync(target, '{"a":1}');
    const result = await readJsonFile(target, 1024, parse);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ a: 1 });
  });

  it('labels a genuinely missing file not_found', async () => {
    const result = await readJsonFile(path.join(dir, 'nope.json'), 1024, parse);
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('labels a path through a regular file not_found (ENOTDIR)', async () => {
    const file = path.join(dir, 'file.txt');
    writeFileSync(file, 'x');
    const result = await readJsonFile(
      path.join(file, 'config.json'),
      1024,
      parse,
    );
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  // Regression: every stat() failure used to read as `not_found`, so a
  // mis-permissioned config volume silently downgraded governance policies
  // to their defaults. Only ENOENT/ENOTDIR are "absent"; EACCES is a fault.
  it.skipIf(IS_ROOT)(
    'labels a present-but-unreadable file inaccessible, not not_found',
    async () => {
      const locked = path.join(dir, 'locked');
      mkdirSync(locked);
      const target = path.join(locked, 'config.json');
      writeFileSync(target, '{"a":1}');
      chmodSync(locked, 0o000);
      try {
        const result = await readJsonFile(target, 1024, parse);
        expect(result).toMatchObject({ ok: false, error: 'inaccessible' });
        if (!result.ok) expect(result.message).toMatch(/EACCES|permission/i);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );
});
