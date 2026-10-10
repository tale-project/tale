import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observationFile } from './observation-files';
const testPosix = test.skipIf(process.platform === 'win32');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
testPosix.each([
  'symlink',
  'hardlink',
  'writable-file',
  'writable-parent',
  'oversized',
])('refuses %s rather than trusting the retained pathname', (fault) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'observation-custody-')),
  );
  roots.push(root);
  const directory = join(root, 'private');
  mkdirSync(directory, { mode: 0o700 });
  const file = join(directory, 'artifact');
  writeFileSync(file, 'retained', { mode: 0o644 });
  expect(observationFile(file, 8).bytes.toString()).toBe('retained');
  if (fault === 'symlink') {
    rmSync(file);
    symlinkSync(join(root, 'missing'), file);
  }
  if (fault === 'hardlink') linkSync(file, join(directory, 'other'));
  if (fault === 'writable-file') chmodSync(file, 0o666);
  if (fault === 'writable-parent') chmodSync(directory, 0o777);
  expect(() => observationFile(file, fault === 'oversized' ? 7 : 8)).toThrow();
});
