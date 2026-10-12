#!/usr/bin/env bun
/**
 * Publish a workspace package as a root-level git snapshot so another
 * repository can install it with a GitHub URL:
 *
 *   "@tale/ui": "github:tale-project/tale#dist/ui"
 *   "@tale/ui": "github:tale-project/tale#ui-v0.5.25"
 *
 * Bun (1.4) cannot install a package that lives in a subdirectory of a git
 * repository and rejects `workspace:` ranges inside a downloaded package, so
 * the snapshot is the package directory and its license, with every `workspace:` entry
 * stripped (those are monorepo links — a consumer supplies the peer itself),
 * committed as an orphan. Without `--release`, that commit is force-pushed to
 * the rolling `dist/<name>` branch.
 *
 * With `--release v1.2.3`, it is pushed only as the `<name>-v1.2.3` tag, and
 * no branch moves. The checkout must be the clean commit `--source` names, and
 * the remote's `v1.2.3` release tag must name that commit too. A published tag
 * never moves: when it already exists, the run succeeds without pushing if its
 * contents are identical and fails if they differ.
 *
 *   bun scripts/publish-package.ts packages/ui [--remote <url>] [--dry-run]
 *   bun scripts/publish-package.ts packages/ui --release v1.2.3 --source <sha>
 *     [--checkout <source-directory>] [--remote <url>] [--dry-run]
 *
 * Run from the trusted tooling checkout and use `--checkout` to read a
 * historical source without loading that source's Bun configuration.
 *
 * `--remote` defaults to the current `origin`. `--dry-run` builds the
 * snapshot and prints what would be pushed without changing the remote; a
 * release still reads the remote's tags.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXCLUDED = new Set([
  'node_modules',
  'storybook-static',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.turbo',
]);

/** The spelling Release gives a version: `v` and an exact semantic version. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

interface Options {
  packageDir: string;
  remote?: string;
  /** Optional release source; Bun keeps running from the trusted tooling cwd. */
  checkout?: string;
  /** The release tag to pin and the commit it names; absent for `dist/`. */
  release?: { tag: string; source: string };
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const [packageDir, ...rest] = argv;
  if (!packageDir) {
    throw new Error(
      'usage: bun scripts/publish-package.ts <package-dir> [--remote <url>] [--release <vX.Y.Z> --source <sha> [--checkout <source-directory>]] [--dry-run]',
    );
  }
  const options: Options = { packageDir, dryRun: false };
  let release: string | undefined;
  let source: string | undefined;
  let checkout: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remote') options.remote = rest[++i];
    else if (arg === '--release') release = rest[++i] ?? '';
    else if (arg === '--source') source = rest[++i] ?? '';
    else if (arg === '--checkout') checkout = rest[++i] ?? '';
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (release !== undefined || source !== undefined) {
    if (release === undefined || !RELEASE_TAG.test(release)) {
      throw new Error('--release takes a release tag such as v1.2.3');
    }
    if (source === undefined || !COMMIT_SHA.test(source)) {
      throw new Error(
        '--release needs --source with the full commit SHA its tag names',
      );
    }
    options.release = { tag: release, source };
  }
  if (checkout !== undefined) {
    if (!checkout) {
      throw new Error('--checkout takes a source checkout directory');
    }
    if (!options.release) {
      throw new Error('--checkout requires --release and --source');
    }
    options.checkout = checkout;
  }
  return options;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The commit `tag` names on the remote, an annotated tag peeled, or null. */
function remoteTag(remote: string, tag: string, cwd: string): string | null {
  const ref = `refs/tags/${tag}`;
  let named: string | null = null;
  const listed = git(['ls-remote', '--tags', remote, ref, `${ref}^{}`], cwd);
  for (const line of listed.split('\n')) {
    const [sha = '', name] = line.split('\t');
    if (name === `${ref}^{}`) return sha;
    if (name === ref) named = sha;
  }
  return named;
}

/**
 * A version tag holds the released bytes: the checkout is the commit
 * `--source` names, unchanged where the snapshot reads, and the remote's
 * release tag names that commit as well.
 */
function assertReleaseSource(
  repoRoot: string,
  packageDir: string,
  head: string,
  remote: string,
  release: { tag: string; source: string },
): void {
  const { tag, source } = release;
  if (head !== source) {
    throw new Error(
      `the checkout is ${head}, not the release source ${source}`,
    );
  }
  const packagePath = path.relative(repoRoot, packageDir).split(path.sep);
  const changed = git(
    [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      packagePath.join('/') || '.',
      'LICENSE',
    ],
    repoRoot,
  );
  if (changed) {
    throw new Error(`the checkout differs from ${source}:\n${changed}`);
  }
  const released = remoteTag(remote, tag, repoRoot);
  if (released === null) {
    throw new Error(
      `the remote has no release tag ${tag}; package tags pin published releases only`,
    );
  }
  if (released !== source) {
    throw new Error(`release tag ${tag} names ${released}, not ${source}`);
  }
}

/**
 * Push `tag` for the snapshot at HEAD of `workDir`. A tag the remote already
 * has stays as it is: identical contents make a repeat a no-op, and different
 * contents fail.
 */
function publishTag(
  workDir: string,
  remote: string,
  tag: string,
  dryRun: boolean,
): void {
  const existing = remoteTag(remote, tag, workDir);
  if (existing !== null) {
    git(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--depth=1',
        remote,
        `refs/tags/${tag}`,
      ],
      workDir,
    );
    const published = git(['rev-parse', 'FETCH_HEAD^{tree}'], workDir);
    if (published !== git(['rev-parse', 'HEAD^{tree}'], workDir)) {
      throw new Error(
        `${tag} already names ${existing} with different contents; reconcile the publication conflict without moving the existing tag`,
      );
    }
    console.log(`${tag} already names ${existing} with these contents`);
    return;
  }
  if (dryRun) {
    console.log(`dry run — would push tag ${tag} to ${remote}`);
    return;
  }
  git(['tag', tag], workDir);
  git(['push', '--quiet', remote, `refs/tags/${tag}`], workDir);
  console.log(`pushed tag ${tag}`);
}

/** Tracked package paths and their directories; local ignored files are absent. */
function trackedSnapshotPaths(repoRoot: string, source: string): Set<string> {
  const paths = new Set(['']);
  const tracked = git(
    ['ls-files', '--cached', '-z', '--', path.relative(repoRoot, source)],
    repoRoot,
  );
  for (const file of tracked.split('\0').filter(Boolean)) {
    const relative = path.relative(source, path.resolve(repoRoot, file));
    paths.add(relative);
    let directory = path.dirname(relative);
    while (directory !== '.') {
      paths.add(directory);
      directory = path.dirname(directory);
    }
  }
  return paths;
}

/** Copy package source, skipping outputs and dependencies in every mode. */
function snapshot(source: string, target: string, tracked?: Set<string>): void {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      if (EXCLUDED.has(name)) return false;
      if (name.endsWith('.tsbuildinfo')) return false;
      return !tracked || tracked.has(path.relative(source, entry));
    },
  });
}

type Manifest = Record<string, unknown> & {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** Drop every `workspace:` range — a consumer resolves those peers itself. */
function stripWorkspaceLinks(manifest: Manifest): string[] {
  const stripped: string[] = [];
  for (const block of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const) {
    const entries = manifest[block];
    if (!entries) continue;
    for (const [name, range] of Object.entries(entries)) {
      if (range.startsWith('workspace:')) {
        delete entries[name];
        stripped.push(`${block}.${name}`);
      }
    }
  }
  return stripped;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sourceCwd = options.checkout
    ? path.resolve(process.cwd(), options.checkout)
    : process.cwd();
  const repoRoot = git(['rev-parse', '--show-toplevel'], sourceCwd);
  const packageDir = path.resolve(repoRoot, options.packageDir);
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${options.packageDir} has no package.json`);
  }
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as Manifest;
  const shortName = manifest.name.replace(/^@[^/]+\//, '');
  const branch = `dist/${shortName}`;
  const sourceSha = git(['rev-parse', 'HEAD'], repoRoot);
  const remote =
    options.remote ?? git(['remote', 'get-url', 'origin'], repoRoot);
  if (options.release) {
    assertReleaseSource(
      repoRoot,
      packageDir,
      sourceSha,
      remote,
      options.release,
    );
  }

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `publish-${shortName}-`),
  );
  try {
    snapshot(
      packageDir,
      workDir,
      options.release ? trackedSnapshotPaths(repoRoot, packageDir) : undefined,
    );
    // Repository-root snapshots lose the parent license. Carry it with the
    // source unless the package supplies a license of its own.
    const hasLicense = fs
      .readdirSync(workDir)
      .some((name) => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
    if (!hasLicense)
      fs.copyFileSync(
        path.join(repoRoot, 'LICENSE'),
        path.join(workDir, 'LICENSE'),
      );
    const stripped = stripWorkspaceLinks(manifest);
    fs.writeFileSync(
      path.join(workDir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const message = `${manifest.name}@${manifest.version} from ${sourceSha}`;
    git(['init', '--quiet', '--initial-branch', branch], workDir);
    // Files tracked by the release stay included even when its package's
    // ignore rules would hide them in a fresh repository-root snapshot.
    git(['add', '--all', ...(options.release ? ['--force'] : [])], workDir);
    git(
      [
        '-c',
        'user.name=tale-publish',
        '-c',
        'user.email=publish@tale.dev',
        'commit',
        '--quiet',
        '--message',
        message,
      ],
      workDir,
    );

    const files = git(['ls-files'], workDir).split('\n').length;
    console.log(
      `${manifest.name}: ${files} files, source ${sourceSha.slice(0, 12)}`,
    );
    if (stripped.length > 0) {
      console.log(`stripped workspace links: ${stripped.join(', ')}`);
    }

    // A version pins its own commit and leaves the rolling branch to `main`.
    if (options.release) {
      publishTag(
        workDir,
        remote,
        `${shortName}-${options.release.tag}`,
        options.dryRun,
      );
      return;
    }
    if (options.dryRun) {
      console.log(`dry run — would push ${branch} to ${remote}`);
      return;
    }
    git(
      ['push', '--force', '--quiet', remote, `HEAD:refs/heads/${branch}`],
      workDir,
    );
    console.log(`pushed ${branch}`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
