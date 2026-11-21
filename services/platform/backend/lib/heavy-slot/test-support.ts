// What a suite puts in place of the object store's streamed read, when it
// tests a lane that reads a stored file through the heavy slot. Test-only:
// never imported by shipped code.

import { writeFile } from 'node:fs/promises';

/**
 * A stand-in for `s3GetObjectToFile` whose store holds what `bytes()`
 * answers at the moment it is asked: the bytes are written to the file the
 * lane names, as the real read writes them; `null` is an object that is not
 * there.
 */
export function objectToFile(
  bytes: () => Uint8Array | null,
): (
  store: unknown,
  key: string,
  filePath: string,
  opts?: { maxBytes?: number },
) => Promise<{ size: number; contentType: string | null } | null> {
  return async (_store, _key, filePath) => {
    const held = bytes();
    if (held === null) return null;
    await writeFile(filePath, held, { flag: 'wx', mode: 0o600 });
    return { size: held.byteLength, contentType: null };
  };
}
