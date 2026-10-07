import { afterEach, expect, test } from 'bun:test';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const actionPath = '.github/actions/setup-cli/action.yml';
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tale-action-archive-'));
  roots.push(root);
  return root;
}

function git(
  args: string[],
  environment?: Record<string, string>,
): Buffer<ArrayBuffer> {
  // Model GitHub's source bytes, independently of a Windows checkout's CRLF
  // preference. Command-local overrides leave the developer's Git config intact.
  const child = Bun.spawnSync(
    ['git', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args],
    {
      cwd: repository,
      env: { ...process.env, ...environment },
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  );
  if (child.exitCode !== 0)
    throw new Error(
      `Git archive fixture failed (exit ${child.exitCode}, signal ${child.signalCode ?? 'none'}): ${child.stderr.toString()}`,
    );
  return Buffer.from(child.stdout);
}

function trackedFiles() {
  return git(['ls-tree', '-rz', 'HEAD'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [metadata, path] = entry.split('\t');
      const [mode, , blob] = metadata!.split(' ');
      return { path: path!, mode: mode!, blob: blob! };
    });
}

// Inventory extraction without following symlinks: their entries belong to
// the archive, while their target trees are checked separately below.
async function archivePaths(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      paths.push(`${entry.name}/`);
      for (const child of await archivePaths(join(directory, entry.name)))
        paths.push(`${entry.name}/${child}`);
    } else paths.push(entry.name);
  }
  return paths.sort();
}

// Compare the dereferenced copy with the real extracted target, including
// empty directories and every file's bytes. Copies must contain no symlinks.
async function expectCopiedTree(
  source: string,
  destination: string,
): Promise<void> {
  const sourceStat = await stat(source);
  const copiedStat = await lstat(destination);
  expect(copiedStat.isSymbolicLink()).toBe(false);
  expect(copiedStat.isDirectory()).toBe(sourceStat.isDirectory());
  if (sourceStat.isDirectory()) {
    const entries = (await readdir(source)).sort();
    expect((await readdir(destination)).sort()).toEqual(entries);
    for (const entry of entries)
      await expectCopiedTree(join(source, entry), join(destination, entry));
  } else {
    expect(sourceStat.isFile()).toBe(true);
    expect(copiedStat.isFile()).toBe(true);
    expect(await readFile(destination)).toEqual(await readFile(source));
  }
}

test('the real source ZIP carries every tracked file and retains the setup action', async () => {
  const root = await temporaryDirectory();
  const archivePath = join(root, 'source.zip');
  // This tests uncommitted attribute corrections without writing the active
  // Git index. Published commits use the same attributes through git archive.
  // Store entries without compression: this proves inventory, link metadata,
  // CRCs and source bytes; compressing every asset only adds CI CPU contention.
  git([
    'archive',
    '--worktree-attributes',
    '--format=zip',
    '-0',
    `--output=${archivePath}`,
    'HEAD',
  ]);
  const archive = await JSZip.loadAsync(await readFile(archivePath), {
    checkCRC32: true,
  });
  const paths = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  const tracked = trackedFiles();
  expect(paths).toEqual(tracked.map((entry) => entry.path).sort());
  expect(await archive.file(actionPath)!.async('nodebuffer')).toEqual(
    git(['show', `HEAD:${actionPath}`]),
  );

  // An archive reader may follow directory symlinks while copying an action,
  // and the runner aborts on a dangling one before setup-cli can run. Every
  // link must resolve inside this complete source snapshot.
  for (const entry of tracked.filter((file) => file.mode === '120000')) {
    const link = archive.file(entry.path)!;
    expect(Number(link.unixPermissions) & 0o170000).toBe(0o120000);
    const target = await link.async('string');
    expect(target).toBe(git(['cat-file', 'blob', entry.blob]).toString());
    const resolved = posix.normalize(
      posix.join(posix.dirname(entry.path), target),
    );
    expect(resolved.startsWith('../')).toBe(false);
    expect(
      paths.some(
        (path) => path === resolved || path.startsWith(`${resolved}/`),
      ),
    ).toBe(true);
  }
}, 60_000);

test.skipIf(process.platform === 'win32')(
  'the source TAR can be copied with links followed while Git checkout retains every fixture link',
  async () => {
    const root = await temporaryDirectory();
    const extracted = join(root, 'extracted');
    const copied = join(root, 'copied');
    const checkout = join(root, 'checkout');
    await mkdir(extracted);
    await mkdir(checkout);
    const archivePath = join(root, 'source.tar');
    git([
      'archive',
      '--worktree-attributes',
      '--format=tar',
      `--output=${archivePath}`,
      'HEAD',
    ]);
    const unpack = Bun.spawnSync(['tar', '-xf', archivePath, '-C', extracted], {
      timeout: 30_000,
      killSignal: 'SIGKILL',
    });
    expect(unpack.exitCode, unpack.stderr.toString()).toBe(0);
    const tracked = trackedFiles();
    const expectedPaths = new Set(tracked.map((entry) => entry.path));
    for (const entry of tracked) {
      let directory = posix.dirname(entry.path);
      while (directory !== '.') {
        expectedPaths.add(`${directory}/`);
        directory = posix.dirname(directory);
      }
    }
    expect(await archivePaths(extracted)).toEqual([...expectedPaths].sort());

    const copiedAction = join(copied, actionPath);
    await mkdir(dirname(copiedAction), { recursive: true });
    await cp(join(extracted, actionPath), copiedAction, { dereference: true });
    expect(await readFile(copiedAction)).toEqual(
      git(['show', `HEAD:${actionPath}`]),
    );

    // Mirrors the runner's failure seam for every tracked link, without
    // copying unrelated source assets a second time. Extraction alone accepts
    // dangling symlinks; real recursive dereferencing must read each target.
    const links = tracked.filter((entry) => entry.mode === '120000');
    for (const link of links) {
      const source = join(extracted, link.path);
      const destination = join(copied, link.path);
      expect((await lstat(source)).isSymbolicLink()).toBe(true);
      expect(await readlink(source)).toBe(
        git(['cat-file', 'blob', link.blob]).toString(),
      );
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, dereference: true });
      await expectCopiedTree(source, destination);
    }
    const environment = { GIT_INDEX_FILE: join(root, 'checkout-index') };
    git(['read-tree', 'HEAD'], environment);
    git(
      [
        '-c',
        'core.symlinks=true',
        'checkout-index',
        `--prefix=${checkout}/`,
        '--',
        ...links.map((entry) => entry.path),
      ],
      environment,
    );
    for (const link of links) {
      const file = join(checkout, link.path);
      expect((await lstat(file)).isSymbolicLink()).toBe(true);
      expect(await readlink(file)).toBe(
        git(['cat-file', 'blob', link.blob]).toString(),
      );
    }
  },
  60_000,
);

test.skipIf(process.platform === 'win32')(
  'recursive dereferencing copies real linked bytes and rejects a dangling target',
  async () => {
    const root = await temporaryDirectory();
    const target = join(root, 'target');
    await mkdir(target);
    await writeFile(join(target, 'source.txt'), 'owned archive fixture\n');
    const link = join(root, 'valid-link');
    await symlink('target', link, 'dir');
    const copied = join(root, 'valid-copy');
    await cp(link, copied, { recursive: true, dereference: true });
    await expectCopiedTree(link, copied);

    const dangling = join(root, 'dangling-link');
    await symlink('missing-target', dangling, 'dir');
    await expect(
      cp(dangling, join(root, 'broken-copy'), {
        recursive: true,
        dereference: true,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  },
  5_000,
);
