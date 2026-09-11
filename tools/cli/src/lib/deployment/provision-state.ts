import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  linkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256 } from '../config/releases/identity';
import { relativePath, slug } from '../config/releases/model';

/** Backend-native state is fixed beneath its data volume, never a path supplied
 * in private stdin. Existing parent permissions are validated, not rewritten. */
export function nativeDeploymentStateDirectory(
  dataDirectory: string,
  name: string,
  create = true,
): string {
  const selected = resolve(dataDirectory);
  slug.parse(name);
  let current = selected;
  for (const part of ['', 'ops', 'tale-deployments', name]) {
    if (part) {
      current = join(current, part);
      if (create) {
        try {
          mkdirSync(current, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
    }
    const info = lstatSync(current);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      (process.getuid &&
        (info.uid !== process.getuid() || (info.mode & 0o022) !== 0))
    )
      throw preconditionError(
        'Native deployment state has an unsafe directory or owner.',
      );
  }
  inspect(current, true);
  return current;
}

function inspect(file: string, directory: boolean): boolean {
  try {
    const info = lstatSync(file);
    if (
      info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) ||
      (process.getuid &&
        (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))
    )
      throw preconditionError(
        'Native provisioning state must be private and owned by the current account.',
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** The caller holds the native deployment lock. Only this private child stores
 * generated credentials; public bundle/receipt directories contain no secrets. */
export function provisionStatePath(
  directory: string,
  name: string,
  create = false,
): string {
  const selected = resolve(directory);
  if (!inspect(selected, true))
    throw preconditionError('Native provisioning state directory is missing.');
  const relative = relativePath.parse(name);
  if (relative.includes('/') || !relative.endsWith('.json'))
    throw preconditionError('Invalid native provisioning state name.');
  const root = join(selected, 'private');
  if (!inspect(root, true)) {
    if (create) mkdirSync(root, { mode: 0o700 });
  }
  return join(root, relative);
}

export function readProvisionStateProof<T>(
  file: string,
  schema: z.ZodType<T>,
  maxBytes = 64 * 1024,
): { value: T; sha256: string } | undefined {
  if (!inspect(file, false)) return undefined;
  const info = lstatSync(file);
  if (info.size > maxBytes)
    throw preconditionError(
      'Native provisioning state exceeds its private bound.',
    );
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  let digest: string;
  try {
    const opened = fstatSync(handle);
    if (
      opened.dev !== info.dev ||
      opened.ino !== info.ino ||
      opened.size !== info.size
    )
      throw new Error('State changed while opening');
    const bytes = Buffer.alloc(info.size + 1);
    let read = 0;
    for (;;) {
      const count = readSync(handle, bytes, read, bytes.length - read, null);
      if (count === 0) break;
      read += count;
      if (read > info.size) throw new Error('State grew');
    }
    const after = fstatSync(handle);
    if (
      read !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      throw new Error('State changed while reading');
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read)),
    );
    digest = sha256(bytes.subarray(0, read));
  } catch {
    throw preconditionError('Native provisioning state is invalid.');
  } finally {
    closeSync(handle);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw preconditionError(
      'Native provisioning state does not match its contract.',
    );
  return { value: parsed.data, sha256: digest };
}

export function readProvisionState<T>(
  file: string,
  schema: z.ZodType<T>,
): T | undefined {
  return readProvisionStateProof(file, schema)?.value;
}

/** Publish an fsynced intent before any native create. Never overwrite on first
 * creation; subsequent phase updates run under the same interprocess lock. */
export function writeProvisionState(
  file: string,
  value: unknown,
  create = false,
): { path: string; sha256: string } {
  if (!inspect(dirname(file), true))
    throw preconditionError('Private provisioning directory is missing.');
  inspect(file, false);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > 64 * 1024)
    throw preconditionError(
      'Native provisioning state exceeds its private bound.',
    );
  const temporary = `${file}.${randomUUID()}.new`;
  const handle = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(handle, bytes);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  let failure: unknown;
  try {
    if (create) linkSync(temporary, file);
    else renameSync(temporary, file);
  } catch (error) {
    failure = error;
  }
  try {
    unlinkSync(temporary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !failure)
      failure = error;
  }
  if (failure) throw failure;
  const parent = openSync(dirname(file), constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
  return { path: file, sha256: sha256(bytes) };
}
