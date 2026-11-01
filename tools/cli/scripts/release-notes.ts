/** Maintainer-written release outcomes precede generated API and PR details. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dir, '../../..');
const EXACT_VERSION = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const MIGRATIONS = 'services/platform/backend/db/migrations';
const CONTRACT = 'services/platform/lib/shared/constants/api-contract.ts';
/**
 * The tale-project repositories anyone can open. The notes are published on
 * the GitHub release, the website's changelog and every deployment's in-app
 * changelog, whose readers get a 404 from any other repository of the
 * organization: v0.5.82's linked a commit of the private ops (#4676).
 */
const PUBLIC_REPOSITORIES = new Set(['tale', '.github']);

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
  const refused = privateRepositoryLinks(notes);
  if (refused.length > 0) throw new Error(refused.join('\n'));
  return `${notes}\n`;
}

/**
 * One refusal per address into a tale-project repository that is not public,
 * in any form: a link, an autolink, a bare URL or a reference definition, and
 * in a comment too, since the published body keeps comments.
 */
function privateRepositoryLinks(notes: string): string[] {
  const refused = new Set<string>();
  for (const [address, written = ''] of notes.matchAll(
    /(?<![\w-])github\.com\/tale-project\/([\w.-]+)[^\s<>()[\]"'`]*/gi,
  )) {
    const repository = written.replace(/\.+$/, '').replace(/\.git$/i, '');
    if (PUBLIC_REPOSITORIES.has(repository.toLowerCase())) continue;
    refused.add(
      `Release notes link ${address.replace(/[.,;:!?]+$/, '')}, but tale-project/${repository} is not a public repository: readers outside the organization cannot open it`,
    );
  }
  return [...refused];
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
  /** Migration files that tag already has, by file name, in order. */
  earlierMigrations: string[];
  /**
   * Pull requests and issues of tale-project/tale that tag already ships —
   * merged (the squash-merged subject's `(#N)`) or closed (`Closes #N`) —
   * and no commit since names again, in order: their work is not new.
   */
  shipped: number[];
  /** `API_CONTRACT_VERSION` at that tag and at the candidate. */
  contract: { previous: string; current: string };
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    // A release's whole history of commit messages, well past the 1 MiB default.
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Migration files in a NUL-separated list of paths, by file name, in order. */
function migrationFiles(paths: string): string[] {
  return paths
    .split('\0')
    .filter((path) => path.startsWith(`${MIGRATIONS}/`))
    .map((path) => path.slice(MIGRATIONS.length + 1))
    .filter((name) => !name.includes('/') && isMigrationFile(name))
    .sort();
}

/**
 * A reference to an issue or pull request of tale-project/tale: `#N`,
 * `tale-project/tale#N` or its address; the number is the first group.
 */
const REFERENCE = String.raw`(?:(?<![\w&#/])#|tale-project\/tale#|github\.com\/tale-project\/tale\/(?:pull|issues)\/)(\d+)(?!\w)`;

/** The numbers `text` refers to, as `REFERENCE` reads them. */
function references(text: string): number[] {
  return [...text.matchAll(new RegExp(REFERENCE, 'gi'))].map(([, n]) =>
    Number(n),
  );
}

/** GitHub's closing keywords: `Closes #N` closes issue N where it lands. */
const CLOSING = String.raw`close[sd]?|fix(?:e[sd])?|resolve[sd]?`;

/**
 * The numbers the commit messages of `log` (`git log -z --format=%B`) name:
 * the pull request a squash-merged subject ends with (`(#N)`), and each
 * reference one of `keywords` leads (`Closes #N`).
 */
function numbersNamed(log: string, keywords: string): Set<number> {
  const keyword = new RegExp(
    String.raw`\b(?:${keywords}):?\s+${REFERENCE}`,
    'gi',
  );
  const named = new Set<number>();
  for (const message of log.split('\0')) {
    const merged = /\(#(\d+)\)\s*$/.exec(message.split('\n', 1)[0]);
    if (merged) named.add(Number(merged[1]));
    for (const [, n] of message.matchAll(keyword)) named.add(Number(n));
  }
  return named;
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
 * release's, and what that release already ships: its migration files and
 * the pull requests and issues it merged or closed. The previous release is
 * `previousTag` when given, else the nearest release tag before the
 * candidate (`git describe` from its parent, so a candidate already tagged
 * still compares with the release before it).
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
  const migrations = migrationFiles(
    git(root, [
      'diff',
      '-z',
      '--name-only',
      '--no-renames',
      '--diff-filter=A',
      commit,
      candidate,
      '--',
      MIGRATIONS,
    ]),
  );
  const earlierMigrations = migrationFiles(
    git(root, ['ls-tree', '-z', '--name-only', commit, '--', `${MIGRATIONS}/`]),
  );
  // Shipped: merged or closed; `Refs #N` leaves an issue open. A number the
  // release's own commits merge, close or refer to again has new work in it.
  const since = numbersNamed(
    git(root, ['log', '-z', '--format=%B', `${commit}..${candidate}`]),
    `${CLOSING}|refs?|references|follow-up to|part of`,
  );
  const shipped = [
    ...numbersNamed(git(root, ['log', '-z', '--format=%B', commit]), CLOSING),
  ]
    .filter((n) => !since.has(n))
    .sort((a, b) => a - b);
  return {
    candidate,
    previous: { tag, commit },
    migrations,
    earlierMigrations,
    shipped,
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
 * What one statement of the notes says: each paragraph and top-level list
 * item, with its continuation lines and nested items. A comment names
 * nothing, since the reader does not see it.
 */
function statements(notes: string): string[] {
  return notes
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\n(?:[ \t]*\n)+(?=\S)|\n(?=(?:[-*+]|\d+[.)])[ \t])/)
    .filter((statement) => statement.trim());
}

/**
 * The migrations `statement` names: a migration file by its name, and a
 * number in a run of them after "migration" or "migrations" ("migrations
 * 0168 and 0194"). A four-digit number anywhere else is not a migration.
 */
function migrationsNamed(statement: string) {
  const named = [
    ...statement.matchAll(/(?<![\w.-])(\d{4})_\w+\.(?:sql|ts)(?![\w-]|\.\w)/g),
  ].map(([file, number]) => ({ written: file, number, file }));
  for (const [, run] of statement.matchAll(
    /\bmigrations?((?:[\s,`–—-]|\b(?:and|or|to)\b|\d{4}\b)+)/gi,
  ))
    for (const [number] of run.matchAll(/\d{4}/g))
      named.push({ written: number, number, file: '' });
  return named;
}

/** Whether `statement` names a release no later than `tag`, such as v0.5.87. */
function namesEarlierRelease(statement: string, tag: string): boolean {
  const parts = (version: string) =>
    version.slice(1).split(/[.-]/, 3).map(Number);
  const [major, minor, patch] = parts(tag);
  return [...statement.matchAll(/(?<![\w.-])v\d+\.\d+\.\d+(?![\w-]|\.\d)/g)]
    .map(([version]) => parts(version))
    .some(
      ([a, b, c]) =>
        a < major ||
        (a === major && (b < minor || (b === minor && c <= patch))),
    );
}

/**
 * One refusal per migration or pull request the notes present as new that
 * the previous release already ships, or per migration no release has. A
 * paragraph or list item that names the earlier release may name its work,
 * as v0.5.88's named the migrations v0.5.87's notes left out.
 */
function earlierWork(notes: string, changes: ReleaseChanges): string[] {
  const { tag } = changes.previous;
  const number = (file: string) => file.slice(0, 4);
  const added = new Set(changes.migrations);
  const addedNumbers = new Set(changes.migrations.map(number));
  const shipped = new Set(changes.shipped);
  const refused = new Set<string>();
  for (const statement of statements(notes)) {
    const attributed = namesEarlierRelease(statement, tag);
    for (const { written, number: n, file } of migrationsNamed(statement)) {
      if (file ? added.has(file) : addedNumbers.has(n)) continue;
      const earlier = changes.earlierMigrations.filter((name) =>
        file ? name === file : number(name) === n,
      );
      if (earlier.length === 0) {
        refused.add(
          `Release notes name migration ${written}, which neither ${tag} nor this release adds`,
        );
      } else if (!attributed) {
        const which = file ? '' : ` (${earlier.join(', ')})`;
        refused.add(
          `Release notes name migration ${written}${which}, which ${tag} already has: name the earlier release beside it, in the same paragraph or list item, or leave it out`,
        );
      }
    }
    if (attributed) continue;
    for (const cited of references(statement).filter((n) => shipped.has(n)))
      refused.add(
        `Release notes cite #${cited}, which ${tag} already ships and no commit since refers to: name the earlier release beside it, in the same paragraph or list item, or leave it out`,
      );
  }
  return [...refused];
}

/**
 * Refuse Upgrade notes that leave out what the release brings: each
 * migration file added since the previous release, by its file name, and
 * the candidate's API contract version when it changed. Refuse notes that
 * present the previous release's work as this release's: a migration it
 * already has, or a pull request or issue it already merged or closed,
 * unless the same paragraph or list item names the earlier release.
 */
export function validateUpgradeNotes(raw: string, changes: ReleaseChanges) {
  const notes = validateReleaseNotes(raw);
  const [section] = sections(notes, 'Upgrade notes');
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
  const refused = [
    ...missing.map((what) => `Upgrade notes do not name ${what}`),
    ...earlierWork(notes, changes),
  ];
  if (refused.length > 0) throw new Error(refused.join('\n'));
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
