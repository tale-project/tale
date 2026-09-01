// @vitest-environment node

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteSecret } from './file_io';

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
