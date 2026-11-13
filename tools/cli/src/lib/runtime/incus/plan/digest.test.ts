import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  incusStateDirectory,
  loadPlanKey,
  PLAN_KEY_FILE,
  PlanKey,
} from './digest';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

const roots: string[] = [];
function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tale-plan-key-'));
  roots.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of roots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describePosix('the plan key (design D-11)', () => {
  test('is made once, 0600 in a 0700 directory, and read back the same', async () => {
    const state = root();
    const first = await loadPlanKey(state);
    const file = join(incusStateDirectory(state), PLAN_KEY_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(incusStateDirectory(state)).mode & 0o777).toBe(0o700);
    expect(readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    const second = await loadPlanKey(state);
    expect(second.digest({ a: 1 })).toBe(first.digest({ a: 1 }));
    expect(readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
  });

  test('two runs that race make one key', async () => {
    const state = root();
    const keys = await Promise.all(
      Array.from({ length: 8 }, () => loadPlanKey(state)),
    );
    const digests = new Set(keys.map((key) => key.digest('x')));
    expect(digests.size).toBe(1);
  });

  test('a key readable by others, a link or a malformed file is refused', async () => {
    const open = root();
    await loadPlanKey(open);
    const file = join(incusStateDirectory(open), PLAN_KEY_FILE);
    chmodSync(file, 0o644);
    await expect(loadPlanKey(open)).rejects.toThrow('mode 0600');

    const linked = root();
    mkdirSync(incusStateDirectory(linked), { recursive: true });
    const elsewhere = join(linked, 'elsewhere');
    writeFileSync(elsewhere, `${'1'.repeat(64)}\n`, { mode: 0o600 });
    symlinkSync(elsewhere, join(incusStateDirectory(linked), PLAN_KEY_FILE));
    await expect(loadPlanKey(linked)).rejects.toThrow('symbolic link');

    const short = root();
    mkdirSync(incusStateDirectory(short), { recursive: true });
    writeFileSync(join(incusStateDirectory(short), PLAN_KEY_FILE), 'abc\n', {
      mode: 0o600,
    });
    await expect(loadPlanKey(short)).rejects.toThrow('is not a plan key');
  });
});

describe('keyed digests', () => {
  const key = new PlanKey(new Uint8Array(32).fill(1));
  const other = new PlanKey(new Uint8Array(32).fill(2));

  test('ignore key order and differ per key', () => {
    expect(key.digest({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(
      key.digest({ b: [2, { d: 4, c: 3 }], a: 1 }),
    );
    expect(key.digest({ a: 1 })).not.toBe(other.digest({ a: 1 }));
    expect(key.digest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a value and the bytes of its JSON never share a digest', () => {
    const value = 'secret';
    expect(key.digest(value)).not.toBe(
      key.digestBytes(new TextEncoder().encode(JSON.stringify(value))),
    );
  });

  test('a low-entropy secret is not its plain hash', () => {
    const plain = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify('hunter2'))
      .digest('hex');
    expect(key.digest('hunter2')).not.toBe(plain);
  });

  test('the key never serializes', () => {
    expect(JSON.stringify({ key })).toBe('{"key":"[plan key]"}');
    expect(String(key)).toBe('[plan key]');
  });
});
