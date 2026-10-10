import { expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureGit } from '../src/lib/config/releases/tests/fixture-git';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureDirectories = [
  'tools/cli/scripts/fixtures/ci-orphan-checks-6ad49e4',
  'tools/cli/scripts/fixtures/ci-orphan-seven',
];

test('source-hashed CI fixtures retain their exact bytes on autocrlf checkouts', async () => {
  const paths = (
    await Promise.all(
      fixtureDirectories.map(async (directory) => {
        const names = (await readdir(join(root, directory)))
          .filter((name) => name.endsWith('.txt'))
          .sort();
        expect(names.length, directory).toBeGreaterThan(0);
        return names.map((name) => `${directory}/${name}`);
      }),
    )
  ).flat();
  const attributes = await readFile(join(root, '.gitattributes'));
  const gitSource = fixtureGit(root);
  const effective = gitSource(
    'check-attr',
    '-z',
    'text',
    'eol',
    '--',
    ...paths,
  );
  expect(effective.split('\0').filter(Boolean)).toEqual(
    paths.flatMap((path) => [path, 'text', 'set', path, 'eol', 'lf']),
  );

  const directory = await mkdtemp(join(tmpdir(), 'ci-orphan-fixture-eol-'));
  try {
    const globalAttributes = join(directory, 'empty-global-attributes');
    await writeFile(globalAttributes, '');
    const git = fixtureGit(directory, {
      command: [
        'git',
        '-c',
        'core.autocrlf=true',
        '-c',
        'core.safecrlf=false',
        '-c',
        `core.attributesFile=${globalAttributes}`,
      ],
    });
    git('init', '--quiet');
    await writeFile(join(directory, '.gitattributes'), attributes);
    const source = new Map<string, Buffer>();
    for (const path of paths) {
      const bytes = await readFile(join(root, path));
      expect(bytes.includes('\r\n'), path).toBe(false);
      source.set(path, bytes);
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes);
    }
    git('add', '--', '.gitattributes', ...paths);
    for (const withAttributes of [true, false]) {
      // Checkout reads attributes from the index. Keep every fixture blob
      // unchanged while removing only the custody rule for the negative control.
      await writeFile(
        join(directory, '.gitattributes'),
        withAttributes ? attributes : '',
      );
      git('add', '--', '.gitattributes');
      for (const path of paths) await rm(join(directory, path));
      git('checkout-index', '--force', '--', ...paths);
      for (const path of paths) {
        const bytes = await readFile(join(directory, path));
        expect(bytes.includes('\r\n'), path).toBe(!withAttributes);
        const original = source.get(path);
        if (!original) throw new Error('Missing fixture bytes');
        if (withAttributes) expect(bytes.equals(original), path).toBe(true);
        else expect(bytes.equals(original), path).toBe(false);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
