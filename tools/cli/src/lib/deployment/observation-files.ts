import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { parse, resolve, sep } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { sha256 } from '../config/releases/identity';

/** Artifact stages are public-readable immutable files inside private native
 * state. Unlike a private credential journal, 0644 is their maintained mode.
 * Never follow links or read beyond the size captured before opening. */
export function observationFile(file: string, maximum: number) {
  const absolute = resolve(file);
  let parent = parse(absolute).root;
  const parts = absolute.slice(parent.length).split(sep);
  for (const part of parts.slice(0, -1)) {
    parent = resolve(parent, part);
    const info = lstatSync(parent);
    const owner = process.getuid?.() ?? info.uid;
    const trustedOwner = info.uid === 0 || info.uid === owner;
    const stickyRoot = info.uid === 0 && (info.mode & 0o1000) !== 0;
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !trustedOwner ||
      ((info.mode & 0o022) !== 0 && !stickyRoot)
    )
      throw preconditionError('Observation file has an unsafe ancestor.');
  }
  const info = lstatSync(absolute);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maximum ||
    (process.getuid &&
      ((info.uid !== 0 && info.uid !== process.getuid()) ||
        (info.mode & 0o022) !== 0))
  )
    throw preconditionError(
      'Observation file has unsafe custody or exceeds its bound.',
    );
  const handle = openSync(
    absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(handle);
    if (
      !opened.isFile() ||
      opened.ino !== info.ino ||
      opened.dev !== info.dev ||
      opened.size !== info.size ||
      opened.ctimeMs !== info.ctimeMs
    )
      throw Error('changed');
    const bytes = Buffer.alloc(info.size + 1);
    let read = 0;
    for (;;) {
      const count = readSync(handle, bytes, read, bytes.length - read, null);
      if (!count) break;
      read += count;
      if (read > info.size) throw Error('grew');
    }
    const after = fstatSync(handle);
    const final = lstatSync(absolute);
    if (
      read !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs ||
      final.ino !== info.ino ||
      final.dev !== info.dev ||
      final.ctimeMs !== info.ctimeMs ||
      final.mtimeMs !== info.mtimeMs ||
      final.isSymbolicLink()
    )
      throw Error('changed');
    const content = bytes.subarray(0, read);
    return { bytes: content, sha256: sha256(content) };
  } catch {
    throw preconditionError('Observation file changed while being read.');
  } finally {
    closeSync(handle);
  }
}
