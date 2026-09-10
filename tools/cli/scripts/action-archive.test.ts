import { afterEach, expect, test } from 'bun:test';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const actionPath = '.github/actions/setup-cli/action.yml';
const excludedLinks = new Set([
  'services/platform/tests/e2e/fixtures/config/default/connectors',
  'services/platform/tests/e2e/fixtures/config/default/token-sources',
]);
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
  const child = Bun.spawnSync(['git', ...args], {
    cwd: repository,
    env: { ...process.env, ...environment },
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  if (child.exitCode !== 0)
    throw new Error(`Git archive fixture failed: ${child.stderr.toString()}`);
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

test('the real source ZIP excludes only dangling fixture links and retains the setup action', async () => {
  const root = await temporaryDirectory();
  const archivePath = join(root, 'source.zip');
  // This tests uncommitted attribute corrections without writing the active
  // Git index. Published commits use the same attributes through git archive.
  git([
    'archive',
    '--worktree-attributes',
    '--format=zip',
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
  expect(paths).toEqual(
    tracked
      .map((entry) => entry.path)
      .filter((path) => !excludedLinks.has(path))
      .sort(),
  );
  expect(await archive.file(actionPath)!.async('nodebuffer')).toEqual(
    git(['show', `HEAD:${actionPath}`]),
  );

  // An archive reader may follow directory symlinks while copying an action.
  // Every retained link must resolve inside this complete source snapshot.
  for (const entry of tracked.filter((file) => file.mode === '120000')) {
    if (excludedLinks.has(entry.path)) continue;
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
    // Mirrors the runner's failure seam: extraction alone accepts dangling
    // symlinks, but a subsequent dereferencing copy must be able to read them.
    await cp(extracted, copied, { recursive: true, dereference: true });
    expect(await readFile(join(copied, actionPath))).toEqual(
      git(['show', `HEAD:${actionPath}`]),
    );

    const links = trackedFiles().filter((entry) => entry.mode === '120000');
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
