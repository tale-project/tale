import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), 'tale-package-publication-'));
  roots.push(root);
  const source = join(root, 'source');
  const remote = join(root, 'remote.git');
  const packageDir = join(source, 'packages', name);
  mkdirSync(packageDir, { recursive: true });
  // Keep local signing, hooks and identity configuration out of this fixture.
  const config = join(root, 'gitconfig');
  writeFileSync(config, '');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  function git(args: string[], cwd = source): string {
    return execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['init', '--quiet', '--bare', remote]);
  const license = readFileSync(join(repository, 'LICENSE'), 'utf8');
  writeFileSync(join(source, 'LICENSE'), license);
  git(['add', 'LICENSE']);
  git([
    '-c',
    'user.name=Package fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Initial source',
  ]);

  return {
    packageDir,
    license,
    publish() {
      execFileSync(
        process.execPath,
        [
          join(repository, 'scripts/publish-package.ts'),
          `packages/${name}`,
          '--remote',
          remote,
        ],
        { cwd: source, env, timeout: 15_000, stdio: 'pipe' },
      );
    },
    published(file: string) {
      return git(['show', `dist/${name}:${file}`], remote);
    },
    files() {
      return git(['ls-tree', '--name-only', `dist/${name}`], remote)
        .trim()
        .split('\n');
    },
  };
}

for (const name of ['ui', 'marketing-ui']) {
  test(`the published ${name} snapshot carries its license, identity and usable documentation links`, () => {
    const state = fixture(name);
    const packageSource = join(repository, 'packages', name);
    const manifest = JSON.parse(
      readFileSync(join(packageSource, 'package.json'), 'utf8'),
    );
    manifest.devDependencies = {
      ...manifest.devDependencies,
      '@tale/publication-fixture': 'workspace:*',
    };
    writeFileSync(
      join(state.packageDir, 'package.json'),
      JSON.stringify(manifest),
    );
    writeFileSync(
      join(state.packageDir, 'README.md'),
      readFileSync(join(packageSource, 'README.md')),
    );
    state.publish();

    expect(state.published('LICENSE')).toBe(state.license);
    const published = JSON.parse(state.published('package.json'));
    expect(published.license).toBe('MIT');
    expect(published.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/tale-project/tale.git',
      directory: `packages/${name}`,
    });
    expect(published.homepage).toBe('https://ui.tale.dev');
    expect(published.bugs).toEqual({
      url: 'https://github.com/tale-project/tale/issues',
    });
    expect(
      published.devDependencies['@tale/publication-fixture'],
    ).toBeUndefined();

    const readme = state.published('README.md');
    expect(readme).toContain(
      name === 'ui'
        ? 'https://ui.tale.dev/docs/getting-started/introduction'
        : 'https://ui.tale.dev/docs/marketing-ui/overview',
    );
    const links = [...readme.matchAll(/\]\(([^)]+)\)/g)].map(
      (match) => match[1]!,
    );
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      if (/^[a-z]+:/i.test(link) || link.startsWith('#')) continue;
      const target = posix.normalize(link.split('#')[0]!);
      expect(
        target,
        `README link escapes the ${name} snapshot: ${link}`,
      ).not.toMatch(/^(?:\.\.(?:\/|$)|\/)/);
    }
  });
}

for (const filename of ['LICENSE', 'LICENSE.md', 'license.txt']) {
  test(`a package-specific ${filename} survives publication`, () => {
    const state = fixture('independent');
    writeFileSync(
      join(state.packageDir, 'package.json'),
      JSON.stringify({ name: '@example/independent', version: '1.0.0' }),
    );
    const license = 'A package-specific license, distinct from the repository.';
    writeFileSync(join(state.packageDir, filename), license);
    state.publish();
    expect(state.published(filename)).toBe(license);
    if (filename !== 'LICENSE') expect(state.files()).not.toContain('LICENSE');
  });
}

test('a root license correction republishes package snapshots', () => {
  const workflow = parse(
    readFileSync(
      join(repository, '.github/workflows/publish-packages.yml'),
      'utf8',
    ),
  );
  expect(workflow.on.push.paths).toContain('LICENSE');
});
