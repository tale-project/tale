/** Maintainer-written release outcomes precede generated API and PR details. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dir, '../../..');
const EXACT_VERSION = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const MIGRATIONS = 'services/platform/backend/db/migrations';
const CONTRACT = 'services/platform/lib/shared/constants/api-contract.ts';

export function releaseNotesPath(version: string): string {
  if (!EXACT_VERSION.test(version)) {
    throw new Error('Release notes require an exact version such as v1.2.3');
  }
  return `.github/release-notes/${version}.md`;
}

/** The text under each `## <name>` heading, up to the next `## ` heading. */
function sections(notes: string, name: string): string[] {
  const headings = [...notes.matchAll(/^## (.+)$/gm)];
  return headings
    .filter((heading) => heading[1] === name)
    .map((match) => {
      const next = headings.find((heading) => heading.index > match.index);
      return notes.slice(match.index + match[0].length, next?.index).trim();
    });
}

export function validateReleaseNotes(raw: string): string {
  const notes = raw.replace(/\r\n/g, '\n').trim();
  for (const name of ['Highlights', 'Upgrade notes']) {
    const bodies = sections(notes, name);
    if (bodies.length !== 1) {
      throw new Error(`Release notes need exactly one "## ${name}" section`);
    }
    const body = bodies[0];
    if (
      !body.replace(/<!--[\s\S]*?-->/g, '').replace(/[\s*_-]/g, '') ||
      /\b(?:TODO|TBD)\b/.test(body)
    ) {
      throw new Error(`Release notes need authored text in "## ${name}"`);
    }
  }
  if (notes.indexOf('## Highlights') > notes.indexOf('## Upgrade notes')) {
    throw new Error('Highlights must precede Upgrade notes');
  }
  return `${notes}\n`;
}

/**
 * The boot migrator's rule (`isMigrationFile` in
 * `@tale/shared/db/migration-files`), copied because this script imports
 * Node built-ins only: `.sql`, and `.ts` data migrations, never a test or a
 * declaration file beside them.
 */
export function isMigrationFile(name: string): boolean {
  if (name.endsWith('.sql')) return true;
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.d.ts')
  );
}

/** What a release brings that its Upgrade notes must name. */
export interface ReleaseChanges {
  /** The candidate commit, in full. */
  candidate: string;
  /** The release tag the candidate is compared with, and its commit. */
  previous: { tag: string; commit: string };
  /** Migration files added since that tag, by file name, in order. */
  migrations: string[];
  /** `API_CONTRACT_VERSION` at that tag and at the candidate. */
  contract: { previous: string; current: string };
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commitOf(root: string, ref: string, missing: string): string {
  try {
    return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  } catch (error) {
    throw new Error(missing, { cause: error });
  }
}

function contractVersion(root: string, commit: string, at: string): string {
  let source: string;
  try {
    source = git(root, ['show', `${commit}:${CONTRACT}`]);
  } catch (error) {
    throw new Error(`Cannot read ${CONTRACT} at ${at}`, { cause: error });
  }
  const version = /^export const API_CONTRACT_VERSION = '([^']+)';$/m.exec(
    source,
  )?.[1];
  if (!version) {
    throw new Error(
      `Cannot read API_CONTRACT_VERSION from ${CONTRACT} at ${at}`,
    );
  }
  return version;
}

/**
 * Read from Git what `candidate` brings since the previous release: the
 * migration files it adds and its API contract version, beside that
 * release's. The previous release is `previousTag` when given, else the
 * nearest release tag before the candidate (`git describe` from its parent,
 * so a candidate already tagged still compares with the release before it).
 */
export function readReleaseChanges(options: {
  root: string;
  candidate?: string;
  previousTag?: string;
}): ReleaseChanges {
  const { root, previousTag } = options;
  const candidate = commitOf(
    root,
    options.candidate ?? 'HEAD',
    `Cannot compare the release notes without the candidate's Git history in ${root}`,
  );
  let tag: string;
  if (previousTag !== undefined) {
    if (!EXACT_VERSION.test(previousTag)) {
      throw new Error('--previous-tag takes a release tag such as v1.2.3');
    }
    tag = previousTag;
  } else {
    try {
      tag = git(root, [
        'describe',
        '--tags',
        '--abbrev=0',
        '--match',
        'v[0-9]*',
        `${candidate}^`,
      ]).trim();
    } catch (error) {
      throw new Error(
        `No release tag before ${candidate} to compare the release notes with: fetch the tags (git fetch --tags) or pass --previous-tag`,
        { cause: error },
      );
    }
  }
  const commit = commitOf(
    root,
    `refs/tags/${tag}`,
    `${tag} is not a tag in ${root}: fetch it (git fetch origin tag ${tag})`,
  );
  const before = spawnSync('git', [
    '-C',
    root,
    'merge-base',
    '--is-ancestor',
    commit,
    candidate,
  ]);
  if (commit === candidate || before.status !== 0) {
    throw new Error(`${tag} is not a release before ${candidate}`);
  }
  const migrations = git(root, [
    'diff',
    '-z',
    '--name-only',
    '--no-renames',
    '--diff-filter=A',
    commit,
    candidate,
    '--',
    MIGRATIONS,
  ])
    .split('\0')
    .filter((path) => path.startsWith(`${MIGRATIONS}/`))
    .map((path) => path.slice(MIGRATIONS.length + 1))
    .filter((name) => !name.includes('/') && isMigrationFile(name))
    .sort();
  return {
    candidate,
    previous: { tag, commit },
    migrations,
    contract: {
      previous: contractVersion(root, commit, tag),
      current: contractVersion(root, candidate, candidate),
    },
  };
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` holds `pattern` whole, not inside a longer name or number. */
function names(text: string, pattern: string): boolean {
  return new RegExp(`(?<![\\w.-])${pattern}(?![\\w-]|\\.\\w)`).test(text);
}

/**
 * Refuse Upgrade notes that leave out what the release brings: each
 * migration file added since the previous release, by its file name, and
 * the candidate's API contract version when it changed. Naming more, such
 * as an earlier release's migration, is not an error.
 */
export function validateUpgradeNotes(raw: string, changes: ReleaseChanges) {
  const [section] = sections(validateReleaseNotes(raw), 'Upgrade notes');
  // What the operator reads: a comment names nothing.
  const upgrade = section.replace(/<!--[\s\S]*?-->/g, '');
  const since = `since ${changes.previous.tag}`;
  const missing = changes.migrations
    .filter((file) => !names(upgrade, literal(file)))
    .map((file) => `migration ${file}, added ${since}`);
  const { previous, current } = changes.contract;
  if (current !== previous && !names(upgrade, `v?${literal(current)}`)) {
    missing.push(`API contract ${current}, changed from ${previous} ${since}`);
  }
  if (missing.length > 0) {
    throw new Error(
      missing.map((what) => `Upgrade notes do not name ${what}`).join('\n'),
    );
  }
}

export function composeReleaseNotes(
  authored: string,
  contract: string,
): string {
  if (!contract.trim())
    throw new Error('Generated API contract notes are empty');
  return `${validateReleaseNotes(authored).trim()}\n\n${contract.trim()}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'source-root': { type: 'string' },
      'previous-tag': { type: 'string' },
      'shape-only': { type: 'boolean' },
      contract: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (Boolean(values.contract) !== Boolean(values.out)) {
    throw new Error('--contract and --out must be supplied together');
  }
  if (values['source-root'] === '') {
    throw new Error('--source-root takes a checkout directory');
  }
  if (values['shape-only'] && values['previous-tag'] !== undefined) {
    throw new Error(
      '--previous-tag compares the release; --shape-only does not',
    );
  }
  const root = values['source-root'] ?? ROOT;
  const path = releaseNotesPath(values.version ?? '');
  const authored = validateReleaseNotes(
    await readFile(resolve(root, path), 'utf8'),
  );
  let compared = '';
  if (!values['shape-only']) {
    const changes = readReleaseChanges({
      root,
      previousTag: values['previous-tag'],
    });
    validateUpgradeNotes(authored, changes);
    const { previous, current } = changes.contract;
    compared = [
      `Upgrade notes name what ${changes.candidate} brings since ${changes.previous.tag} (${changes.previous.commit}):`,
      changes.migrations.length > 0
        ? `migrations ${changes.migrations.join(', ')};`
        : 'no migration;',
      current === previous
        ? `API contract unchanged at ${current}`
        : `API contract ${previous} -> ${current}`,
    ].join(' ');
  }
  if (values.contract && values.out) {
    await writeFile(
      values.out,
      composeReleaseNotes(authored, await readFile(values.contract, 'utf8')),
    );
  } else {
    console.log(`Validated ${path}`);
  }
  if (compared) console.log(compared);
}
