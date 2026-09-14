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
 * the snapshot is the package directory alone, with every `workspace:` entry
 * stripped (those are monorepo links — a consumer supplies the peer itself),
 * committed as an orphan on the `dist/<name>` branch and force-pushed. A
 * release additionally pins the same commit with a `<name>-v<version>` tag.
 *
 *   bun scripts/publish-package.ts packages/ui [--remote <url>] [--tag ui-v1.2.3] [--dry-run]
 *
 * `--remote` defaults to the current `origin`. `--dry-run` builds the
 * snapshot and prints what would be pushed without touching the remote.
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

interface Options {
  packageDir: string;
  remote?: string;
  tag?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const [packageDir, ...rest] = argv;
  if (!packageDir) {
    throw new Error(
      'usage: bun scripts/publish-package.ts <package-dir> [--remote <url>] [--tag <tag>] [--dry-run]',
    );
  }
  const options: Options = { packageDir, dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remote') options.remote = rest[++i];
    else if (arg === '--tag') options.tag = rest[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Copy the package tree, skipping build output and dependency folders. */
function snapshot(source: string, target: string): void {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      if (EXCLUDED.has(name)) return false;
      if (name.endsWith('.tsbuildinfo')) return false;
      return true;
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
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
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

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `publish-${shortName}-`),
  );
  try {
    snapshot(packageDir, workDir);
    const stripped = stripWorkspaceLinks(manifest);
    fs.writeFileSync(
      path.join(workDir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const message = `${manifest.name}@${manifest.version} from ${sourceSha}`;
    git(['init', '--quiet', '--initial-branch', branch], workDir);
    git(['add', '--all'], workDir);
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
    if (options.tag) git(['tag', options.tag], workDir);

    const files = git(['ls-files'], workDir).split('\n').length;
    console.log(
      `${manifest.name}: ${files} files, source ${sourceSha.slice(0, 12)}`,
    );
    if (stripped.length > 0) {
      console.log(`stripped workspace links: ${stripped.join(', ')}`);
    }

    if (options.dryRun) {
      console.log(
        `dry run — would push ${branch}${options.tag ? ` and tag ${options.tag}` : ''} to ${remote}`,
      );
      return;
    }
    git(
      ['push', '--force', '--quiet', remote, `HEAD:refs/heads/${branch}`],
      workDir,
    );
    console.log(`pushed ${branch}`);
    if (options.tag) {
      git(['push', '--quiet', remote, `refs/tags/${options.tag}`], workDir);
      console.log(`pushed tag ${options.tag}`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
