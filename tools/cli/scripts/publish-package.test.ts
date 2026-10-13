import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix } from 'node:path';
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
  const identity = [
    '-c',
    'user.name=Package fixture',
    '-c',
    'user.email=fixture@example.invalid',
  ];
  function git(args: string[], cwd = source): string {
    return execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  function commit(message: string): string {
    git(['add', '--all']);
    git([...identity, 'commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  }
  /** The publisher's exit status and output, run from the source checkout. */
  function runFrom(cwd: string, ...args: string[]) {
    const result = spawnSync(
      process.execPath,
      [
        join(repository, 'scripts/publish-package.ts'),
        `packages/${name}`,
        '--remote',
        remote,
        ...args,
      ],
      { cwd, env, timeout: 15_000, encoding: 'utf8' },
    );
    return { status: result.status, output: result.stdout + result.stderr };
  }
  const run = (...args: string[]) => runFrom(source, ...args);
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['init', '--quiet', '--bare', remote]);
  const license = readFileSync(join(repository, 'LICENSE'), 'utf8');
  writeFileSync(join(source, 'LICENSE'), license);
  commit('Initial source');

  return {
    source,
    packageDir,
    license,
    commit,
    run,
    runFrom,
    publish(...args: string[]) {
      const result = run(...args);
      if (result.status !== 0) throw new Error(result.output);
      return result.output;
    },
    checkout(revision: string) {
      git(['checkout', '--quiet', '--detach', revision]);
    },
    /** Tag `revision` as `version` on the remote, as Release does. */
    tagRelease(version: string, revision: string, annotated: boolean) {
      git(
        annotated
          ? [...identity, 'tag', '--annotate', '-m', version, version, revision]
          : ['tag', version, revision],
      );
      git(['push', '--quiet', remote, `refs/tags/${version}`]);
    },
    /** Run git in the remote, the repository consumers install from. */
    remoteGit(args: string[]) {
      return git([...identity, ...args], remote);
    },
    /** Every remote ref with the object it names, in refname order. */
    refs() {
      return git(['for-each-ref', '--format=%(refname) %(objectname)'], remote)
        .split('\n')
        .filter(Boolean);
    },
    published(file: string, ref = `dist/${name}`) {
      return git(['show', `${ref}:${file}`], remote);
    },
    files() {
      return git(['ls-tree', '--name-only', `dist/${name}`], remote)
        .trim()
        .split('\n');
    },
  };
}

/**
 * A package whose `marker.txt` tells its sources apart: `released` is tagged
 * `v1.2.3` on the remote, and `later` is the main commit after it.
 */
function releaseHistory(name: string, annotated = false) {
  const state = fixture(name);
  writeFileSync(
    join(state.packageDir, 'package.json'),
    JSON.stringify({ name: `@tale/${name}`, version: '0.1.0' }),
  );
  writeFileSync(join(state.packageDir, 'marker.txt'), 'released\n');
  const released = state.commit('Released source');
  state.tagRelease('v1.2.3', released, annotated);
  writeFileSync(join(state.packageDir, 'marker.txt'), 'later main\n');
  const later = state.commit('Later main');
  return { ...state, released, later };
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

test('a push to main replaces the rolling snapshot and pins no version', () => {
  const state = fixture('marketing-ui');
  writeFileSync(
    join(state.packageDir, 'package.json'),
    JSON.stringify({ name: '@tale/marketing-ui', version: '0.1.0' }),
  );
  writeFileSync(join(state.packageDir, 'marker.txt'), 'first\n');
  state.commit('First');
  state.publish();
  const first = state.refs();
  writeFileSync(join(state.packageDir, 'marker.txt'), 'second\n');
  const second = state.commit('Second');
  expect(state.publish()).toContain('pushed dist/marketing-ui');

  const head = state.remoteGit(['rev-parse', 'dist/marketing-ui']).trim();
  expect(state.refs()).toEqual([`refs/heads/dist/marketing-ui ${head}`]);
  expect(first).not.toEqual(state.refs());
  expect(state.published('marker.txt')).toBe('second\n');
  expect(state.remoteGit(['log', '-1', '--format=%s', head]).trim()).toBe(
    `@tale/marketing-ui@0.1.0 from ${second}`,
  );
  // One orphan commit, replaced rather than stacked on the last snapshot.
  expect(state.remoteGit(['rev-list', '--count', head]).trim()).toBe('1');
});

test.each([
  ['lightweight', false],
  ['annotated', true],
] as const)(
  'a %s release tag gets its package tag from its own commit, and dist/ui stays on main',
  (_kind, annotated) => {
    const state = releaseHistory('ui', annotated);
    state.publish();
    const before = state.refs();
    state.checkout(state.released);
    const release = ['--release', 'v1.2.3', '--source', state.released];

    expect(state.publish(...release, '--dry-run')).toContain(
      'dry run — would push tag ui-v1.2.3',
    );
    expect(state.refs()).toEqual(before);
    expect(state.publish(...release)).toContain('pushed tag ui-v1.2.3');

    // The package tag is the only new ref; the rolling branch keeps main.
    const pinned = state.remoteGit(['rev-parse', 'ui-v1.2.3']).trim();
    expect(state.refs()).toEqual(
      [...before, `refs/tags/ui-v1.2.3 ${pinned}`].toSorted(),
    );
    expect(state.published('marker.txt')).toBe('later main\n');
    expect(state.published('marker.txt', 'ui-v1.2.3')).toBe('released\n');
    expect(state.published('LICENSE', 'ui-v1.2.3')).toBe(state.license);
    expect(state.remoteGit(['log', '-1', '--format=%s', pinned]).trim()).toBe(
      `@tale/ui@0.1.0 from ${state.released}`,
    );
  },
);

test('a release names its tag and the commit it pins together', () => {
  const state = fixture('ui');
  const source = '0123456789abcdef0123456789abcdef01234567';
  const tag = '--release takes a release tag such as v1.2.3';
  const commit = '--release needs --source with the full commit SHA';
  for (const [args, reason] of [
    [['--release', 'v1.2.3'], commit],
    [['--release', 'v1.2.3', '--source', source.slice(0, 12)], commit],
    [['--source', source], tag],
    [['--release', '1.2.3', '--source', source], tag],
    [['--release'], tag],
    [
      ['--checkout', state.source],
      '--checkout requires --release and --source',
    ],
    [
      ['--release', 'v1.2.3', '--source', source, '--checkout'],
      '--checkout takes a source checkout directory',
    ],
  ] as const) {
    const refused = state.run(...args);
    expect(refused.status, args.join(' ')).not.toBe(0);
    expect(refused.output).toContain(reason);
  }
  expect(state.refs()).toEqual([]);
});

test('a release reads its separate source checkout without executing its Bun configuration', () => {
  const state = fixture('ui');
  writeFileSync(
    join(state.packageDir, 'package.json'),
    JSON.stringify({ name: '@tale/ui', version: '0.1.0' }),
  );
  writeFileSync(join(state.packageDir, 'marker.txt'), 'released\n');
  writeFileSync(
    join(state.source, 'bunfig.toml'),
    'preload = ["./preload.ts"]\n',
  );
  writeFileSync(
    join(state.source, 'preload.ts'),
    'import { writeFileSync } from "node:fs"; writeFileSync(new URL("source-preload-ran", import.meta.url), "ran");\n',
  );
  const released = state.commit(
    'Released source with its own Bun configuration',
  );
  state.tagRelease('v1.2.3', released, false);
  const before = state.refs();

  const result = state.runFrom(
    repository,
    '--checkout',
    state.source,
    '--release',
    'v1.2.3',
    '--source',
    released,
  );
  expect(result.status, result.output).toBe(0);
  expect(existsSync(join(state.source, 'source-preload-ran'))).toBe(false);
  const pinned = state.remoteGit(['rev-parse', 'ui-v1.2.3']).trim();
  expect(state.refs()).toEqual(
    [...before, `refs/tags/ui-v1.2.3 ${pinned}`].toSorted(),
  );
  expect(state.published('marker.txt', 'ui-v1.2.3')).toBe('released\n');
});

test.each(['ui', 'marketing-ui'])(
  'a %s release snapshot contains only files tracked at its source',
  (name) => {
    const state = fixture(name);
    writeFileSync(
      join(state.packageDir, 'package.json'),
      JSON.stringify({ name: `@tale/${name}`, version: '0.1.0' }),
    );
    writeFileSync(join(state.packageDir, 'marker.txt'), 'released\n');
    writeFileSync(join(state.packageDir, 'tracked-output.txt'), 'tracked\n');
    state.commit('Track package source before its ignore rule');
    writeFileSync(join(state.packageDir, '.gitignore'), 'tracked-output.txt\n');
    writeFileSync(
      join(state.packageDir, '..', '..', '.gitignore'),
      `packages/${name}/.env.local\npackages/${name}/local-captures/\n`,
    );
    const released = state.commit('Released source');
    state.tagRelease('v1.2.3', released, false);
    const before = state.refs();

    // The root ignore rules keep Git status clean, but are absent from the
    // repository-root snapshot. These bytes are absent from the release's
    // source and must never enter its immutable package snapshot.
    writeFileSync(join(state.packageDir, '.env.local'), 'local-only fixture\n');
    mkdirSync(join(state.packageDir, 'local-captures'));
    writeFileSync(
      join(state.packageDir, 'local-captures', 'render.txt'),
      'local-only capture\n',
    );
    state.publish('--release', 'v1.2.3', '--source', released);

    const tag = `${name}-v1.2.3`;
    const pinned = state.remoteGit(['rev-parse', tag]).trim();
    expect(state.refs()).toEqual(
      [...before, `refs/tags/${tag} ${pinned}`].toSorted(),
    );
    expect(
      state.remoteGit(['ls-tree', '-r', '--name-only', tag]).trim().split('\n'),
    ).toEqual([
      '.gitignore',
      'LICENSE',
      'marker.txt',
      'package.json',
      'tracked-output.txt',
    ]);
    expect(state.published('marker.txt', tag)).toBe('released\n');
    expect(state.published('tracked-output.txt', tag)).toBe('tracked\n');
  },
);

test('a release refuses a checkout or tag that is not its source, and changes nothing', () => {
  const state = releaseHistory('ui');
  const { released, later } = state;
  const before = state.refs();
  for (const { checkout, release, source, reason } of [
    // Main's bytes under an older version: its tag names another commit.
    {
      checkout: later,
      release: 'v1.2.3',
      source: later,
      reason: `release tag v1.2.3 names ${released}, not ${later}`,
    },
    // The bound commit is not the one checked out.
    {
      checkout: later,
      release: 'v1.2.3',
      source: released,
      reason: `the checkout is ${later}, not the release source ${released}`,
    },
    // No release has this version.
    {
      checkout: released,
      release: 'v1.2.4',
      source: released,
      reason: 'the remote has no release tag v1.2.4',
    },
  ]) {
    state.checkout(checkout);
    const refused = state.run('--release', release, '--source', source);
    expect(refused.status, reason).not.toBe(0);
    expect(refused.output).toContain(reason);
  }
  // Uncommitted package bytes are not the released commit either.
  writeFileSync(join(state.packageDir, 'marker.txt'), 'edited\n');
  const edited = state.run('--release', 'v1.2.3', '--source', released);
  expect(edited.status).not.toBe(0);
  expect(edited.output).toContain(`the checkout differs from ${released}`);
  expect(state.refs()).toEqual(before);
});

test('repeating a release keeps its package tag, including one an earlier publisher wrote', () => {
  const state = releaseHistory('ui');
  state.checkout(state.released);
  const release = ['--release', 'v1.2.3', '--source', state.released];
  state.publish(...release);
  const pinned = state.refs();
  expect(state.publish(...release)).toContain('ui-v1.2.3 already names');
  expect(state.refs()).toEqual(pinned);

  // The same bytes in another commit, as the previous publisher made them.
  const tree = state.remoteGit(['rev-parse', 'ui-v1.2.3^{tree}']).trim();
  const earlier = state
    .remoteGit(['commit-tree', tree, '-m', 'Earlier publisher'])
    .trim();
  state.remoteGit(['tag', '--force', 'ui-v1.2.3', earlier]);
  const kept = state.refs();
  expect(state.publish(...release)).toContain(
    `ui-v1.2.3 already names ${earlier} with these contents`,
  );
  expect(state.refs()).toEqual(kept);
});

test('a package tag holding other bytes is refused, never moved', () => {
  const state = releaseHistory('ui');
  // What dispatching the old `tag_version` on main left behind: main's
  // rolling snapshot pinned under the older version.
  state.publish();
  const wrong = state.remoteGit(['rev-parse', 'dist/ui']).trim();
  state.remoteGit(['tag', 'ui-v1.2.3', wrong]);
  const before = state.refs();

  state.checkout(state.released);
  const refused = state.run('--release', 'v1.2.3', '--source', state.released);
  expect(refused.status).not.toBe(0);
  expect(refused.output).toContain(
    `ui-v1.2.3 already names ${wrong} with different contents`,
  );
  expect(state.refs()).toEqual(before);
});

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: {
    push: { branches?: string[]; tags?: string[] };
    workflow_dispatch: { inputs: Record<string, unknown> };
  };
  concurrency?: { group?: string };
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string[];
      permissions?: Record<string, string>;
      steps: Step[];
    }
  >;
};
const workflowFile = (name: string) =>
  parse(
    readFileSync(join(repository, '.github/workflows', name), 'utf8'),
  ) as Workflow;

test('Publish packages pins a version only when dispatched for a release tag and its commit', () => {
  const publication = workflowFile('publish-packages.yml');
  // Release writes its tag with GITHUB_TOKEN, which starts no push run, so
  // a tag trigger would only ever fire for a hand-pushed tag, ahead of the
  // release it belongs to.
  expect(publication.on.push.tags).toBeUndefined();
  expect(publication.on.push.branches).toEqual(['main']);
  expect(Object.keys(publication.on.workflow_dispatch.inputs)).toEqual([
    'release_tag',
    'source_sha',
  ]);
  // A later push to main must not replace a waiting release publication.
  expect(publication.concurrency?.group).toBe(
    '${{ github.workflow }}-${{ inputs.release_tag || github.ref }}',
  );
  const publish = publication.jobs.publish!.steps.find(
    (step) => step.name === 'Publish snapshot',
  )!.run!;
  expect(publish).not.toContain('cd release-source');
  expect(publish).toContain('--checkout "${GITHUB_WORKSPACE}/release-source"');
  expect(publish).toContain('--release "$VERSION" --source "$SOURCE_SHA"');
});

test.skipIf(process.platform === 'win32')(
  'Publish snapshot keeps its token-bearing Bun process in the trusted checkout',
  () => {
    const publish = workflowFile(
      'publish-packages.yml',
    ).jobs.publish!.steps.find((step) => step.name === 'Publish snapshot')!;
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'tale-trusted-package-tooling-')),
    );
    roots.push(workspace);
    mkdirSync(join(workspace, 'scripts'));
    mkdirSync(join(workspace, 'release-source'));
    writeFileSync(
      join(workspace, 'scripts', 'publish-package.ts'),
      'import { writeFileSync } from "node:fs"; writeFileSync(process.env.CALLS!, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n',
    );
    writeFileSync(
      join(workspace, 'release-source', 'bunfig.toml'),
      'preload = ["./preload.ts"]\n',
    );
    const sourceMarker = join(workspace, 'source-preload-ran');
    writeFileSync(
      join(workspace, 'release-source', 'preload.ts'),
      'import { writeFileSync } from "node:fs"; writeFileSync(process.env.SOURCE_EXECUTION_MARKER!, "ran");\n',
    );
    const source = 'c'.repeat(40);
    const calls = join(workspace, 'calls.json');
    const result = spawnSync('bash', ['-c', publish.run!], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
        GITHUB_WORKSPACE: workspace,
        GITHUB_REPOSITORY: 'synthetic/publication',
        GITHUB_TOKEN: '',
        PACKAGE: 'ui',
        VERSION: 'v1.2.3',
        SOURCE_SHA: source,
        CALLS: calls,
        SOURCE_EXECUTION_MARKER: sourceMarker,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(sourceMarker)).toBe(false);
    expect(JSON.parse(readFileSync(calls, 'utf8'))).toEqual({
      cwd: workspace,
      args: [
        'packages/ui',
        '--remote',
        'https://x-access-token:@github.com/synthetic/publication.git',
        '--release',
        'v1.2.3',
        '--source',
        source,
        '--checkout',
        join(workspace, 'release-source'),
      ],
    });
  },
);

test.skipIf(process.platform === 'win32')(
  'Release dispatches Publish packages with its tag and commit once the release exists',
  () => {
    const release = workflowFile('release.yml');
    const publication = workflowFile('publish-packages.yml');
    const job = release.jobs['publish-packages']!;
    expect(job.needs).toEqual(['prepare', 'create-release']);
    expect(job.if).toBe("needs.prepare.outputs.sites_only != 'true'");
    expect(job.permissions).toEqual(release.jobs['trigger-cli']!.permissions);
    expect(release.jobs.summary!.needs).toContain('publish-packages');
    const step = job.steps.find(
      (entry) => entry.name === 'Dispatch package publication',
    )!;
    expect(step.env).toEqual({
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      REPO: '${{ github.repository }}',
      RELEASE_TAG: '${{ needs.prepare.outputs.version }}',
      SOURCE_SHA: '${{ needs.prepare.outputs.source_sha }}',
    });

    // Run the step against a stand-in gh that records its arguments.
    const root = mkdtempSync(join(tmpdir(), 'tale-package-dispatch-'));
    roots.push(root);
    writeFileSync(
      join(root, 'gh'),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CALLS"\n',
    );
    chmodSync(join(root, 'gh'), 0o755);
    const source = 'c'.repeat(40);
    const result = spawnSync('bash', ['-c', step.run!], {
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH}`,
        CALLS: join(root, 'calls'),
        REPO: 'tale-project/tale',
        RELEASE_TAG: 'v1.2.3',
        SOURCE_SHA: source,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(join(root, 'calls'), 'utf8').trim().split('\n'),
    ).toEqual([
      'workflow',
      'run',
      'publish-packages.yml',
      '--repo',
      'tale-project/tale',
      '--ref',
      'main',
      '--field',
      'release_tag=v1.2.3',
      '--field',
      `source_sha=${source}`,
    ]);
    // Every field it sends is an input Publish packages declares.
    expect(Object.keys(publication.on.workflow_dispatch.inputs)).toEqual([
      'release_tag',
      'source_sha',
    ]);
  },
);
