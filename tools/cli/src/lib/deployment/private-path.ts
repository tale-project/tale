import { lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The first ancestor directory, from the filesystem root down, that a private
 * file below it cannot rely on, or `undefined` when every ancestor holds. An
 * ancestor is untrusted when it is not a directory, is a symlink, is owned by
 * neither root nor the account the CLI runs as, or can be written by group or
 * other without being a root-owned sticky directory (the system temporary
 * directory). Another account could otherwise rename or replace what lies
 * below it. The path itself is not examined; the root, which has no parent, is
 * its own ancestor.
 */
export function untrustedAncestor(path: string): string | undefined {
  const ancestors: string[] = [];
  for (let ancestor = dirname(resolve(path)); ; ancestor = dirname(ancestor)) {
    ancestors.push(ancestor);
    if (dirname(ancestor) === ancestor) break;
  }
  const account = process.getuid?.();
  for (const ancestor of ancestors.reverse()) {
    const info = lstatSync(ancestor);
    const trustedOwner = info.uid === 0 || info.uid === account;
    const stickyRoot = info.uid === 0 && (info.mode & 0o1000) !== 0;
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !trustedOwner ||
      ((info.mode & 0o022) !== 0 && !stickyRoot)
    )
      return ancestor;
  }
  return undefined;
}
