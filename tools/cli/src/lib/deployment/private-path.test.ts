import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { untrustedAncestor } from './private-path';

const describePosix = describe.skipIf(process.platform === 'win32');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'private-path-')));
  roots.push(root);
  return root;
}

describePosix('the ancestors of a private path', () => {
  test('trusts a chain of account-owned directories that only the account can write', () => {
    const root = scratch();
    mkdirSync(join(root, 'a', 'b'), { recursive: true, mode: 0o700 });
    expect(untrustedAncestor(join(root, 'a', 'b', 'file'))).toBeUndefined();
  });

  test('names the first ancestor from the root down that is a symlink', () => {
    const root = scratch();
    mkdirSync(join(root, 'real', 'inner'), { recursive: true, mode: 0o700 });
    symlinkSync(join(root, 'real'), join(root, 'link'));
    expect(untrustedAncestor(join(root, 'link', 'inner', 'file'))).toBe(
      join(root, 'link'),
    );
  });

  test('names an ancestor that group or other can write unless it is sticky and owned by root', () => {
    const root = scratch();
    const open = join(root, 'open');
    mkdirSync(join(open, 'private'), { recursive: true, mode: 0o700 });
    chmodSync(open, 0o777);
    expect(untrustedAncestor(join(open, 'private', 'file'))).toBe(open);
    chmodSync(open, 0o770);
    expect(untrustedAncestor(join(open, 'private', 'file'))).toBe(open);
    chmodSync(open, 0o755);
    expect(untrustedAncestor(join(open, 'private', 'file'))).toBeUndefined();
  });

  test('does not trust a sticky directory the account owns', () => {
    const root = scratch();
    const sticky = join(root, 'sticky');
    mkdirSync(join(sticky, 'private'), { recursive: true, mode: 0o700 });
    chmodSync(sticky, 0o1777);
    expect(untrustedAncestor(join(sticky, 'private', 'file'))).toBe(sticky);
  });

  const system = realpathSync('/tmp');
  const info = statSync(system);
  test.skipIf(
    info.uid !== 0 || (info.mode & 0o1000) === 0 || (info.mode & 0o022) === 0,
  )('trusts the world-writable sticky temporary directory of root', () => {
    expect(untrustedAncestor(join(system, 'file'))).toBeUndefined();
  });

  test('walks as far as the filesystem root', () => {
    expect(untrustedAncestor('/entry')).toBeUndefined();
    expect(untrustedAncestor('/')).toBeUndefined();
  });

  test.skipIf(process.getuid?.() !== 0)(
    'names an ancestor owned by an account that is neither root nor the CLI',
    () => {
      const root = scratch();
      const foreign = join(root, 'foreign');
      mkdirSync(join(foreign, 'private'), { recursive: true, mode: 0o700 });
      chownSync(foreign, 54321, 54321);
      expect(untrustedAncestor(join(foreign, 'private', 'file'))).toBe(foreign);
    },
  );
});
