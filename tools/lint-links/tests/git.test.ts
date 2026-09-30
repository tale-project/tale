import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitReader, parseNameStatus, resolveBase } from '../src/git';

// A throwaway repository: one commit with two pages, then a change that
// deletes one, renames the other and edits a third.
const repo = mkdtempSync(join(tmpdir(), 'tale-lint-links-git-'));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): string {
  const run = spawnSync(
    'git',
    [
      '-C',
      repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      ...args,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
}
function write(file: string, text: string) {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), text);
}

git('init', '-q', '-b', 'main');
write('docs/en/gone.md', '# Gone\n');
write(
  'docs/en/moved.md',
  '# Moved\n\nA body long enough to be recognised as the same file.\n',
);
write('docs/en/edited.md', '# Edited\n');
write('docs/published.json', '{"slugs":["edited","gone","moved"]}\n');
git('add', '-A');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD');
git('mv', 'docs/en/moved.md', 'docs/en/renamed.md');
git('rm', '-q', 'docs/en/gone.md');
write('docs/en/edited.md', '# Edited\n\nMore.\n');
git('add', '-A');
git('commit', '-q', '-m', 'change');

describe('createGitReader', () => {
  const reader = createGitReader(repo);

  test('lists what a change deletes and renames, with the rename target', () => {
    const changes = reader.changes(base, 'docs/');
    expect(changes.filter(({ status }) => status !== 'M')).toEqual([
      { status: 'D', file: 'docs/en/gone.md' },
      {
        status: 'R',
        file: 'docs/en/moved.md',
        renamedTo: 'docs/en/renamed.md',
      },
    ]);
    expect(changes).toContainEqual({ status: 'M', file: 'docs/en/edited.md' });
  });

  test('reads a file at a commit, and nothing where it did not exist', () => {
    expect(reader.show(base, 'docs/published.json')).toContain('"gone"');
    expect(reader.show(base, 'docs/en/renamed.md')).toBeNull();
  });
});

describe('parseNameStatus', () => {
  test('reads a copy by its new path only', () => {
    expect(
      parseNameStatus('C075\0docs/a.md\0docs/b.md\0D\0docs/c.md\0'),
    ).toEqual([
      { status: 'C', file: 'docs/b.md' },
      { status: 'D', file: 'docs/c.md' },
    ]);
  });
});

describe('resolveBase', () => {
  test('takes LINT_LINKS_BASE first, and refuses one that names no commit', () => {
    expect(resolveBase(repo, { LINT_LINKS_BASE: base })).toEqual({
      base,
      source: `LINT_LINKS_BASE=${base}`,
    });
    expect(resolveBase(repo, { LINT_LINKS_BASE: 'no-such-ref' })).toEqual({
      error: 'LINT_LINKS_BASE=no-such-ref names no commit',
    });
  });

  test('compares with the parent commit in GitHub Actions', () => {
    expect(resolveBase(repo, { GITHUB_ACTIONS: 'true' })).toEqual({
      base,
      source: 'HEAD^1',
    });
  });

  test('uses the merge base with origin/main locally, and skips without one', () => {
    expect(resolveBase(repo, {})).toMatchObject({
      skip: expect.stringContaining('no origin/main'),
    });
    git('update-ref', 'refs/remotes/origin/main', base);
    expect(resolveBase(repo, {})).toEqual({
      base,
      source: 'the merge base with origin/main',
    });
  });

  test('refuses a checkout without the parent in GitHub Actions', () => {
    const lone = mkdtempSync(join(tmpdir(), 'tale-lint-links-lone-'));
    try {
      spawnSync('git', ['-C', lone, 'init', '-q']);
      spawnSync('git', [
        '-C',
        lone,
        '-c',
        'user.name=T',
        '-c',
        'user.email=t@example.test',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'only',
      ]);
      expect(resolveBase(lone, { GITHUB_ACTIONS: 'true' })).toMatchObject({
        error: expect.stringContaining('fetch-depth: 2'),
      });
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });
});
