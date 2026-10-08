import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

const claimed = new Set<string>();

/** One boot-owned location, never a request path or an agent workspace.
 * The Docker lifetime owner is the cross-process fence. This claim also
 * refuses two independently cached journals in the same spawner process. */
export async function claimAdmissionDirectory(root: string): Promise<{
  file: string;
  assertCurrent: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root === '/'
  )
    throw new Error('Invalid native admission root');
  const path = join(root, '.host-admission');
  const verifyParents = async () => {
    let cursor = parse(path).root;
    for (const part of root.slice(cursor.length).split('/')) {
      cursor = join(cursor, part);
      const stat = await lstat(cursor);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.uid !== uid && stat.uid !== 0) ||
        ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)
      )
        throw new Error('Native admission root is not owned');
    }
    if ((await realpath(root)) !== root)
      throw new Error('Native admission root changed');
  };
  await verifyParents();
  await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
    if (
      !(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      )
    )
      throw error;
  });
  if (claimed.has(path))
    throw new Error('Native admission coordinator already exists');
  claimed.add(path);
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const initial = await handle.stat();
      if (
        !initial.isDirectory() ||
        initial.uid !== uid ||
        (initial.mode & 0o077) !== 0
      )
        throw new Error('Native admission directory is not private');
      let closed = false;
      const assertCurrent = async () => {
        if (closed) throw new Error('Native admission directory closed');
        await verifyParents();
        const current = await lstat(path);
        if (
          current.isSymbolicLink() ||
          current.dev !== initial.dev ||
          current.ino !== initial.ino ||
          current.uid !== uid ||
          (current.mode & 0o077) !== 0 ||
          (await realpath(path)) !== path
        )
          throw new Error('Native admission directory changed');
        if (dirname(join(path, 'journal.json')) !== path)
          throw new Error('Invalid native journal location');
      };
      await assertCurrent();
      return {
        file: join(path, 'journal.json'),
        assertCurrent,
        close: async () => {
          if (closed) return;
          closed = true;
          await handle.close();
          claimed.delete(path);
        },
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    claimed.delete(path);
    throw error;
  }
}
