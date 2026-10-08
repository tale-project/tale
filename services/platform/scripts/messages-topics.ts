/**
 * The message catalogs live one file per topic and locale:
 * `messages/<locale>/<topic>.yml`, a topic being one top-level namespace
 * (`settings`, `chat`, …). Every base locale has the same topic files; a
 * regional override (`de-CH`) has the ones it overrides.
 *
 * `split` turns single-file catalogs (`messages/<locale>.yml`) into that
 * layout. It cuts the text at the top-level keys, so comments and quoting
 * stay as they were, and refuses to write anything unless every topic file
 * parses back to exactly the subtree it came from.
 *
 * `resolve` carries a branch's catalog edits across the split. Run it when a
 * rebase onto main, or a merge of main, stops on a deleted
 * `messages/<locale>.yml`: for each such file it splits the branch's version
 * and the version the branch's edits were written against, and three-way
 * merges every topic the branch changed into the topic file from main
 * (`git merge-file`, conflict markers where both changed the same lines).
 * Then `git add messages` and `git rebase --continue` (or commit the merge);
 * a rebase stops again on each later commit that edits a catalog, so run it
 * at every stop.
 *
 * Usage (from `services/platform`):
 *   bun scripts/messages-topics.ts split [messagesDir]
 *   bun scripts/messages-topics.ts resolve [messagesDir]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve as resolvePath,
} from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { parse } from 'yaml';

/** Files in `messages/` that hold no locale (cross-locale keys). */
const SHARED_FILES = new Set(['global.yml']);

const TOPIC_LINE = /^([A-Za-z0-9_]+):\s*(#.*)?$/;

/**
 * The topics of a single-file catalog, each as the text of its own file: the
 * lines under its top-level key, one indentation level less. A comment at the
 * left margin goes with what follows it: the next topic when it heads one,
 * else the topic it sits in.
 */
export function splitCatalog(text: string): Map<string, string> {
  const topics = new Map<string, string[]>();
  let current: string[] | null = null;
  let margin: string[] = [];
  for (const line of text.split('\n')) {
    const topic = TOPIC_LINE.exec(line);
    if (topic) {
      current = margin;
      margin = [];
      topics.set(topic[1], current);
      continue;
    }
    if (line.startsWith('#') || (line.trim() === '' && margin.length > 0)) {
      margin.push(line);
      continue;
    }
    if (line.trim() === '') {
      current?.push('');
      continue;
    }
    if (current === null || !line.startsWith('  ')) {
      throw new Error(`unexpected top-level line: ${JSON.stringify(line)}`);
    }
    current.push(...margin, line.slice(2));
    margin = [];
  }
  current?.push(...margin);
  const out = new Map<string, string>();
  for (const [topic, lines] of topics) {
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    while (lines.length > 0 && lines[0] === '') lines.shift();
    out.set(topic, `${lines.join('\n')}\n`);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Throws unless every topic text parses to its subtree of `text`. */
function verifySplit(text: string, topics: Map<string, string>): void {
  const whole: unknown = parse(text);
  if (!isRecord(whole)) throw new Error('the catalog is not a mapping');
  const names = [...topics.keys()].sort();
  const expected = Object.keys(whole).sort();
  if (!isDeepStrictEqual(names, expected)) {
    throw new Error(`topics ${names.join(',')} vs keys ${expected.join(',')}`);
  }
  for (const [topic, topicText] of topics) {
    if (!isDeepStrictEqual(parse(topicText), whole[topic])) {
      throw new Error(`topic ${topic} does not parse to its subtree`);
    }
  }
}

function localeFiles(messagesDir: string): string[] {
  return readdirSync(messagesDir)
    .filter((file) => file.endsWith('.yml') && !SHARED_FILES.has(file))
    .sort();
}

export function split(messagesDir: string): void {
  const files = localeFiles(messagesDir);
  if (files.length === 0) {
    console.log(`No single-file catalogs in ${messagesDir}.`);
    return;
  }
  // Verify every locale before writing any of them.
  const plans = files.map((file) => {
    const text = readFileSync(join(messagesDir, file), 'utf8');
    const topics = splitCatalog(text);
    verifySplit(text, topics);
    return { locale: file.slice(0, -'.yml'.length), file, topics };
  });
  for (const { locale, file, topics } of plans) {
    const dir = join(messagesDir, locale);
    mkdirSync(dir, { recursive: true });
    for (const [topic, text] of topics) {
      writeFileSync(join(dir, `${topic}.yml`), text);
    }
    rmSync(join(messagesDir, file));
    console.log(`${file} → ${locale}/ (${topics.size} topics)`);
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A file's text at a revision; empty when the revision has no such file. */
function fileAt(rev: string, file: string, root: string): string {
  const shown = spawnSync('git', ['show', `${rev}:${file}`], {
    cwd: root,
    encoding: 'utf8',
  });
  return shown.status === 0 ? shown.stdout : '';
}

function revision(name: string, root: string): string | undefined {
  const parsed = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `${name}^{commit}`],
    { cwd: root, encoding: 'utf8' },
  );
  return parsed.status === 0 ? parsed.stdout.trim() : undefined;
}

/**
 * The branch's catalog edits being carried: from `base` to `branch`. A
 * rebase replays one commit (REBASE_HEAD, written on its parent); a merge of
 * main brings main into the branch (HEAD, written since the merge base).
 */
function carriedEdits(root: string): { base: string; branch: string } {
  const replayed = revision('REBASE_HEAD', root);
  if (replayed !== undefined) {
    return {
      base: git(['rev-parse', `${replayed}^`], root).trim(),
      branch: replayed,
    };
  }
  const merged = revision('MERGE_HEAD', root);
  if (merged !== undefined) {
    const head = git(['rev-parse', 'HEAD'], root).trim();
    return {
      base: git(['merge-base', head, merged], root).trim(),
      branch: head,
    };
  }
  throw new Error('No rebase or merge is in progress.');
}

/**
 * Three-way merges `after` (written against `before`) into `target`; the
 * number of conflicts left as markers.
 */
function mergeTopic(
  target: string,
  before: string,
  after: string,
  scratch: string,
): number {
  const basePath = join(scratch, 'base.yml');
  const theirPath = join(scratch, 'theirs.yml');
  writeFileSync(basePath, before);
  writeFileSync(theirPath, after);
  const merged = spawnSync(
    'git',
    [
      'merge-file',
      '-L',
      'main',
      '-L',
      'base',
      '-L',
      'branch',
      target,
      basePath,
      theirPath,
    ],
    { encoding: 'utf8' },
  );
  if (merged.status === null || merged.status > 127) {
    throw new Error(`git merge-file failed on ${target}: ${merged.stderr}`);
  }
  return merged.status;
}

/** Returns the topic files left with conflict markers. */
export function resolve(messagesDir: string): string[] {
  // Git names the real path; the given one may run through a symlink.
  const dir = realpathSync(messagesDir);
  const root = git(['rev-parse', '--show-toplevel'], dir).trim();
  const relDir = relative(root, dir);
  const { base, branch } = carriedEdits(root);
  const conflicts: string[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'messages-topics-'));
  try {
    const changed = git(
      ['diff', '--name-only', base, branch, '--', relDir],
      root,
    )
      .split('\n')
      .filter((file) => dirname(file) === relDir && file.endsWith('.yml'))
      .filter((file) => !SHARED_FILES.has(basename(file)));
    for (const file of changed) {
      const locale = basename(file, '.yml');
      const before = splitCatalog(fileAt(base, file, root));
      const after = splitCatalog(fileAt(branch, file, root));
      for (const topic of new Set([...before.keys(), ...after.keys()])) {
        const was = before.get(topic) ?? '';
        const is = after.get(topic) ?? '';
        if (was === is) continue;
        mkdirSync(join(dir, locale), { recursive: true });
        const target = join(dir, locale, `${topic}.yml`);
        if (!existsSync(target)) writeFileSync(target, '');
        const name = relative(root, target);
        if (mergeTopic(target, was, is, scratch) > 0) {
          conflicts.push(name);
          console.log(`CONFLICT ${name} (resolve the markers)`);
        } else {
          console.log(`merged ${name}`);
        }
      }
      const monolith = join(root, file);
      if (existsSync(monolith)) rmSync(monolith);
      git(['rm', '--cached', '--quiet', '--ignore-unmatch', file], root);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return conflicts;
}

if (import.meta.main) {
  const [command, dirArg] = process.argv.slice(2);
  const messagesDir = resolvePath(dirArg ?? 'messages');
  if (command === 'split') split(messagesDir);
  else if (command === 'resolve') {
    if (resolve(messagesDir).length > 0) process.exit(1);
  } else {
    console.error(
      'Usage: bun scripts/messages-topics.ts split|resolve [messagesDir]',
    );
    process.exit(1);
  }
}
