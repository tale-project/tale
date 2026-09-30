#!/usr/bin/env bun
/*
  The link gate (`bun run lint:links`, run by CI and by `bun run check`):
  every link in the documentation sites, and every link into them from the
  rest of the repository, lands on a page, a file or a section that exists.

  Each site describes what it answers (`services/<site>/scripts/link-site.ts`
  exports `LINK_SITE_MODULE`); the rules are the documentation frame's
  (`@tale/ui/docs/links`), the same ones each site's own test suite runs over
  its content. A finding names the file, the line and the fix — usually the
  page the address meant, or the page a redirect lands on.
*/

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LinkSiteModule } from '@tale/ui/docs/links';

import { lintLinks, type Finding } from './src/lint';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The documentation sites whose addresses are judged. */
const SITE_MODULES = [
  'services/docs/scripts/link-site.ts',
  'services/ui-docs/scripts/link-site.ts',
];

/** The origin that docs paths built in code are appended to. */
const DOCS_ORIGIN = 'https://docs.tale.dev';

/** Largest file scanned; anything bigger is data, not prose or code. */
const MAX_BYTES = 2_000_000;

/**
 * Never scanned for references: the lockfile, and release notes fetched from
 * GitHub (`releases-manifest.ts`) — history that quotes the addresses a
 * release shipped with, which the redirects keep answering.
 */
function skip(file: string): boolean {
  return (
    file === 'bun.lock' ||
    file.startsWith('services/web/app/generated/') ||
    file.endsWith('.snap')
  );
}

function isLinkSiteModule(value: unknown): value is LinkSiteModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'site' in value &&
    'pages' in value &&
    typeof value.pages === 'function' &&
    'contentRoot' in value &&
    typeof value.contentRoot === 'string'
  );
}

async function loadModules(): Promise<LinkSiteModule[]> {
  const modules: LinkSiteModule[] = [];
  for (const path of SITE_MODULES) {
    const loaded: unknown = await import(resolve(REPO_ROOT, path));
    const module =
      typeof loaded === 'object' &&
      loaded !== null &&
      'LINK_SITE_MODULE' in loaded
        ? loaded.LINK_SITE_MODULE
        : undefined;
    if (!isLinkSiteModule(module)) {
      throw new Error(`${path} must export a LINK_SITE_MODULE`);
    }
    modules.push(module);
  }
  return modules;
}

function trackedFiles(): string[] {
  const listed = spawnSync(
    'git',
    // Untracked files too (not ignored ones), so a new file is judged before
    // its first commit.
    [
      '-C',
      REPO_ROOT,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  }
  return [...new Set(listed.stdout.split('\0').filter(Boolean))];
}

/** A tracked file's text, or null for a binary, oversized or missing file. */
function read(file: string): string | null {
  const path = resolve(REPO_ROOT, file);
  try {
    const stat = statSync(path);
    // A submodule or a symlinked directory is tracked as a path too.
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const text = readFileSync(path, 'utf8');
    return text.includes('\0') ? null : text;
  } catch (error) {
    // Tracked but deleted in the working tree: nothing to judge.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function format(finding: Finding): string {
  return `${finding.file}:${finding.line}:${finding.column} [${finding.rule}] ${finding.detail}`;
}

const modules = await loadModules();
const files = trackedFiles();
const findings = lintLinks({
  modules,
  files,
  read,
  docsOrigin: DOCS_ORIGIN,
  skip,
});

if (findings.length > 0) {
  console.error(
    `Links that do not land (${findings.length}) — fix the address, or link the page a redirect lands on:`,
  );
  for (const finding of findings) console.error(format(finding));
  process.exit(1);
}
const pages = modules.reduce(
  (total, module) => total + module.pages().length,
  0,
);
console.log(
  `lint:links — ${pages} documentation pages and ${files.length} tracked files: every link lands.`,
);
