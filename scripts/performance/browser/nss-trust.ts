import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const sha256 = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Refuse preexisting NSS state');
}
async function ownedDirectory(path: string) {
  const info = await lstat(path);
  assert(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid!(),
    'NSS directory is not owned',
  );
}

/** Claim absence before the negative browser. Its entire process must close
 * before install. Preserve its newly-created NSS files inside this disposable
 * container; never delete them or publish an unverified key DB as an artifact. */
export async function claimNssTarget(target: string) {
  assert(
    isAbsolute(target) &&
      resolve(target) === target &&
      basename(target) === 'nssdb',
    'Invalid NSS target',
  );
  const parent = dirname(target);
  const preserved = `${target}.untrusted-owned`;
  await absent(target);
  await absent(preserved);
  try {
    await ownedDirectory(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let used = false;
  return {
    async install(
      source: string,
      expected: { name: string; sha256: string }[],
    ) {
      assert(!used, 'NSS claim already consumed');
      used = true;
      assert.deepEqual(
        expected.map((file) => file.name),
        ['cert9.db', 'key4.db'],
        'Only verified public trust databases may be installed',
      );
      for (const file of expected) {
        assert.match(file.sha256, /^[a-f0-9]{64}$/);
        const from = join(source, file.name);
        const info = await lstat(from);
        assert(
          info.isFile() &&
            !info.isSymbolicLink() &&
            info.size <= 64 * 1024 * 1024,
          'Invalid public NSS source',
        );
        assert.equal(
          sha256(await readFile(from)),
          file.sha256,
          'Public NSS source differs from its verified receipt',
        );
      }
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await ownedDirectory(parent);
      await absent(preserved);
      let created = false;
      try {
        await ownedDirectory(target);
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const prior: { name: string; bytes: number }[] = [];
      if (created) {
        const names = await readdir(target);
        assert(names.length <= 9, 'Unexpected NSS file count');
        for (const name of names) {
          assert(
            /^(?:cert9\.db|key4\.db)(?:-(?:journal|shm|wal))?$|^pkcs11\.txt$/.test(
              name,
            ),
            'Unexpected NSS file',
          );
          const info = await lstat(join(target, name));
          assert(
            info.isFile() &&
              !info.isSymbolicLink() &&
              info.uid === process.getuid!() &&
              info.size <= 64 * 1024 * 1024,
            'Unowned NSS file',
          );
          prior.push({ name, bytes: info.size });
        }
        await rename(target, preserved);
      }
      await mkdir(target, { mode: 0o700 });
      const copied = [];
      for (const file of expected) {
        const to = join(target, file.name);
        await copyFile(join(source, file.name), to);
        await chmod(to, 0o600);
        const info = await lstat(to);
        assert.equal(info.uid, process.getuid!());
        const hash = sha256(await readFile(to));
        assert.equal(hash, file.sha256, 'Installed NSS bytes differ');
        copied.push({
          name: file.name,
          sha256: hash,
          uid: info.uid,
          mode: info.mode & 0o777,
        });
      }
      return {
        target,
        priorCreatedByNegativeBrowser: created,
        preservedInsideContainer: created ? preserved : null,
        priorFiles: prior,
        copied,
      };
    },
  };
}
