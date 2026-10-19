import { lstatSync, type Stats } from 'node:fs';
import { join } from 'node:path';

import { untrustedAncestor } from './private-path';
import { RUNTIME_INPUT_LIMIT, requireRuntime } from './runtime-model';
import {
  SANDBOX_INCUS_DIRECTORY,
  SANDBOX_INCUS_FILES,
} from './runtime-sandbox';

/**
 * Hold the credentials of a bundle that declares the Incus sandbox to the same
 * custody the CLI applies to its other private files, before Docker is touched.
 *
 * The directory `<state>/sandbox-incus` must be a real directory that only
 * root or the account running the CLI owns, closed to group and other, below
 * ancestors another account cannot replace. Each of the three PEM files must
 * be a regular file with one link, owned the same way, closed to group and
 * other, and neither empty nor over the runtime's input limit. Only the
 * metadata is read: the CLI never opens a credential, and a message names a
 * path and never any content.
 */
export function assertIncusCredentials(stateDirectory: string): void {
  requireRuntime(
    typeof process.getuid === 'function',
    'The Incus sandbox shape needs a POSIX host.',
  );
  const account = process.getuid();
  const trustedOwner = (info: Stats) => info.uid === 0 || info.uid === account;
  const directory = join(stateDirectory, SANDBOX_INCUS_DIRECTORY);
  const directoryInfo = lstatSync(directory, { throwIfNoEntry: false });
  requireRuntime(
    directoryInfo !== undefined,
    `The Incus sandbox credentials directory ${directory} is missing; place ${SANDBOX_INCUS_FILES.join(', ')} in it before applying.`,
  );
  requireRuntime(
    directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(),
    `The Incus sandbox credentials directory ${directory} must be a real directory, not a link or a file.`,
  );
  requireRuntime(
    trustedOwner(directoryInfo),
    `The Incus sandbox credentials directory ${directory} must be owned by root or by the account running the CLI.`,
  );
  requireRuntime(
    (directoryInfo.mode & 0o077) === 0,
    `The Incus sandbox credentials directory ${directory} must not be accessible to group or others (mode 0700).`,
  );
  const ancestor = untrustedAncestor(directory);
  requireRuntime(
    ancestor === undefined,
    `The Incus sandbox credentials directory ${directory} lies below ${ancestor}, which another account could replace or write to.`,
  );
  for (const name of SANDBOX_INCUS_FILES) {
    const file = join(directory, name);
    const info = lstatSync(file, { throwIfNoEntry: false });
    requireRuntime(
      info !== undefined,
      `The Incus sandbox credential file ${file} is missing.`,
    );
    requireRuntime(
      info.isFile() && !info.isSymbolicLink(),
      `The Incus sandbox credential file ${file} must be a regular file, not a link.`,
    );
    requireRuntime(
      info.nlink === 1,
      `The Incus sandbox credential file ${file} must have a single hard link.`,
    );
    requireRuntime(
      trustedOwner(info),
      `The Incus sandbox credential file ${file} must be owned by root or by the account running the CLI.`,
    );
    requireRuntime(
      (info.mode & 0o077) === 0,
      `The Incus sandbox credential file ${file} must not be accessible to group or others (mode 0600).`,
    );
    requireRuntime(
      info.size > 0,
      `The Incus sandbox credential file ${file} is empty.`,
    );
    requireRuntime(
      info.size <= RUNTIME_INPUT_LIMIT,
      `The Incus sandbox credential file ${file} exceeds ${RUNTIME_INPUT_LIMIT} bytes.`,
    );
  }
}
