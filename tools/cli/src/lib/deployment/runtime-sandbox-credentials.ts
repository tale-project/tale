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
 * The directory is `<state>/sandbox-incus`; `assertCredentialCustody` says
 * what holds.
 */
export function assertIncusCredentials(stateDirectory: string): void {
  assertCredentialCustody(join(stateDirectory, SANDBOX_INCUS_DIRECTORY), {
    label: 'Incus sandbox credentials',
    missing: `place ${SANDBOX_INCUS_FILES.join(', ')} in it before applying`,
  });
}

/**
 * Hold a directory of the three Incus PEM files to the CLI's custody of
 * private files.
 *
 * The directory must be a real directory that only root or the account
 * running the CLI owns, closed to group and other, below ancestors another
 * account cannot replace. Each of the three PEM files must be a regular file
 * with one link, owned the same way, closed to group and other, and neither
 * empty nor over the runtime's input limit. Only the metadata is read: this
 * never opens a credential, and a message names a path and never any content.
 * `label` names the directory in each message ("Incus sandbox credentials");
 * `missing` says what to do when the directory is not there.
 */
export function assertCredentialCustody(
  directory: string,
  { label, missing }: { label: string; missing: string },
): void {
  requireRuntime(
    typeof process.getuid === 'function',
    `The custody check of the ${label} needs a POSIX host.`,
  );
  const fileLabel = label.replace(/credentials$/, 'credential');
  const account = process.getuid();
  const trustedOwner = (info: Stats) => info.uid === 0 || info.uid === account;
  const directoryInfo = lstatSync(directory, { throwIfNoEntry: false });
  requireRuntime(
    directoryInfo !== undefined,
    `The ${label} directory ${directory} is missing; ${missing}.`,
  );
  requireRuntime(
    directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(),
    `The ${label} directory ${directory} must be a real directory, not a link or a file.`,
  );
  requireRuntime(
    trustedOwner(directoryInfo),
    `The ${label} directory ${directory} must be owned by root or by the account running the CLI.`,
  );
  requireRuntime(
    (directoryInfo.mode & 0o077) === 0,
    `The ${label} directory ${directory} must not be accessible to group or others (mode 0700).`,
  );
  const ancestor = untrustedAncestor(directory);
  requireRuntime(
    ancestor === undefined,
    `The ${label} directory ${directory} lies below ${ancestor}, which another account could replace or write to.`,
  );
  for (const name of SANDBOX_INCUS_FILES) {
    const file = join(directory, name);
    const info = lstatSync(file, { throwIfNoEntry: false });
    requireRuntime(
      info !== undefined,
      `The ${fileLabel} file ${file} is missing.`,
    );
    requireRuntime(
      info.isFile() && !info.isSymbolicLink(),
      `The ${fileLabel} file ${file} must be a regular file, not a link.`,
    );
    requireRuntime(
      info.nlink === 1,
      `The ${fileLabel} file ${file} must have a single hard link.`,
    );
    requireRuntime(
      trustedOwner(info),
      `The ${fileLabel} file ${file} must be owned by root or by the account running the CLI.`,
    );
    requireRuntime(
      (info.mode & 0o077) === 0,
      `The ${fileLabel} file ${file} must not be accessible to group or others (mode 0600).`,
    );
    requireRuntime(info.size > 0, `The ${fileLabel} file ${file} is empty.`);
    requireRuntime(
      info.size <= RUNTIME_INPUT_LIMIT,
      `The ${fileLabel} file ${file} exceeds ${RUNTIME_INPUT_LIMIT} bytes.`,
    );
  }
}
