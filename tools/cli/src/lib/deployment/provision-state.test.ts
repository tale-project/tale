import { expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  provisionStatePath,
  nativeDeploymentStateDirectory,
  readProvisionState,
  writeProvisionState,
} from './provision-state';

const schema = z.strictObject({
  phase: z.enum(['pending', 'ready']),
  secret: z.string(),
});
const pending = { phase: 'pending', secret: 'synthetic-private' } as const;
// This store implements the POSIX durability/private-owner contract used only
// by managed commands, which refuse Windows before filesystem or native work.
const testPosix = test.skipIf(process.platform === 'win32');
function fixture(body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'tale-private-intent-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

testPosix(
  'private intent is exclusive, bounded, durable and retains exact credentials on phase update',
  () =>
    fixture((root) => {
      const missing = provisionStatePath(root, 'client-one.json');
      expect(readProvisionState(missing, schema)).toBeUndefined();
      expect(readdirSync(root)).toEqual([]);
      const file = provisionStatePath(root, 'client-one.json', true);
      const proof = writeProvisionState(file, pending, true);
      expect(proof.path).toBe(file);
      expect(proof.sha256).toHaveLength(64);
      expect(readProvisionState(file, schema)).toEqual(pending);
      expect(statSync(file).mode & 0o077).toBe(0);
      expect(() =>
        writeProvisionState(file, { ...pending, secret: 'replacement' }, true),
      ).toThrow();
      expect(readProvisionState(file, schema)).toEqual(pending);
      writeProvisionState(file, { ...pending, phase: 'ready' });
      expect(readProvisionState(file, schema)).toEqual({
        ...pending,
        phase: 'ready',
      });
      expect(readdirSync(join(root, 'private'))).toEqual(['client-one.json']);
      const before = readFileSync(file);
      expect(() =>
        writeProvisionState(file, { secret: 'x'.repeat(65536) }),
      ).toThrow('bound');
      expect(readFileSync(file)).toEqual(before);
    }),
);

testPosix(
  'private state refuses symlinks, shared links, exposed permissions and unsafe names before writing',
  () =>
    fixture((root) => {
      const outside = join(root, 'outside');
      mkdirSync(outside, { mode: 0o700 });
      const selected = join(root, 'selected');
      mkdirSync(selected, { mode: 0o700 });
      symlinkSync(outside, join(selected, 'private'));
      expect(() => provisionStatePath(selected, 'client.json', true)).toThrow(
        'private',
      );
      expect(readdirSync(outside)).toEqual([]);
      expect(() => provisionStatePath(selected, '../bad.json', true)).toThrow();
      const file = provisionStatePath(root, 'client.json', true);
      symlinkSync(join(outside, 'missing'), file);
      expect(() => writeProvisionState(file, pending, true)).toThrow();
      expect(existsSync(join(outside, 'missing'))).toBe(false);
      rmSync(file);
      writeFileSync(file, JSON.stringify(pending), { mode: 0o600 });
      linkSync(file, join(outside, 'linked'));
      expect(() => readProvisionState(file, schema)).toThrow('private');
      rmSync(join(outside, 'linked'));
      chmodSync(file, 0o644);
      expect(() => readProvisionState(file, schema)).toThrow('private');
      chmodSync(file, 0o600);
      for (const content of [
        'not-json',
        '{"secret":"unknown"}',
        'x'.repeat(65537),
      ]) {
        writeFileSync(file, content);
        expect(() => readProvisionState(file, schema)).toThrow();
      }
    }),
);

testPosix(
  'native state admission refuses a missing data root or symlinked/exposed parents before creating deployment data',
  () =>
    fixture((root) => {
      const missing = join(root, 'missing');
      expect(() => nativeDeploymentStateDirectory(missing, 'north')).toThrow();
      expect(existsSync(missing)).toBe(false);
      const outside = join(root, 'outside');
      mkdirSync(outside, { mode: 0o700 });
      symlinkSync(outside, join(root, 'ops'));
      expect(() => nativeDeploymentStateDirectory(root, 'north')).toThrow(
        'unsafe',
      );
      expect(readdirSync(outside)).toEqual([]);
      rmSync(join(root, 'ops'));
      mkdirSync(join(root, 'ops'), { mode: 0o777 });
      chmodSync(join(root, 'ops'), 0o777);
      expect(() => nativeDeploymentStateDirectory(root, 'north')).toThrow(
        'unsafe',
      );
      expect(readdirSync(join(root, 'ops'))).toEqual([]);
      chmodSync(join(root, 'ops'), 0o700);
      const selected = nativeDeploymentStateDirectory(root, 'north');
      expect(selected).toBe(join(root, 'ops/tale-deployments/north'));
      expect(statSync(selected).mode & 0o777).toBe(0o700);
      expect(nativeDeploymentStateDirectory(root, 'north')).toBe(selected);
    }),
);
