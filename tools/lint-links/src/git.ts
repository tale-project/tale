/**
 * The repository as the retirement rules read it (`./retirements.ts`): a
 * file at a commit, the content files a change deletes or renames, and the
 * commit a change is compared with.
 */

import { spawnSync } from 'node:child_process';

import type { Change, GitReader } from './retirements';

function git(cwd: string, args: readonly string[]) {
  const run = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: run.status === 0,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
  };
}

/**
 * `git diff --name-status -z` output as changes. A rename carries a
 * similarity score (`R087`) and both paths; a copy is reported by its new
 * path only, since the original stays.
 */
export function parseNameStatus(output: string): Change[] {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes: Change[] = [];
  for (let i = 0; i < fields.length;) {
    const status = (fields[i++] ?? '').charAt(0);
    if (status === 'R') {
      const file = fields[i++] ?? '';
      const renamedTo = fields[i++] ?? '';
      changes.push({ status, file, renamedTo });
    } else if (status === 'C') {
      i += 1;
      changes.push({ status, file: fields[i++] ?? '' });
    } else {
      changes.push({ status, file: fields[i++] ?? '' });
    }
  }
  return changes;
}

/** A reader over the repository at `cwd`. */
export function createGitReader(cwd: string): GitReader {
  return {
    show(ref, file) {
      const run = git(cwd, ['show', `${ref}:${file}`]);
      return run.ok ? run.stdout : null;
    },
    changes(base, path) {
      const run = git(cwd, [
        'diff',
        '--name-status',
        '-z',
        '-M',
        base,
        '--',
        path,
      ]);
      if (!run.ok)
        throw new Error(`git diff ${base} failed: ${run.stderr.trim()}`);
      return parseNameStatus(run.stdout);
    },
  };
}

export type BaseResolution =
  | { base: string; source: string }
  | { skip: string }
  | { error: string };

/**
 * The commit a change is compared with. `LINT_LINKS_BASE` names it
 * explicitly. In GitHub Actions it is `HEAD^1`: a pull request is checked
 * out as GitHub's merge commit, whose first parent is the base branch, and
 * a push or a merge group as the commit on top of it — so the checkout
 * needs `fetch-depth: 2`, and a missing parent is an error, never a skip.
 * Anywhere else it is the merge base with `origin/main`; without one the
 * retirement rules are skipped with a warning.
 */
export function resolveBase(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): BaseResolution {
  const commit = (ref: string) => {
    const run = git(cwd, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${ref}^{commit}`,
    ]);
    return run.ok ? run.stdout.trim() : null;
  };
  if (env.LINT_LINKS_BASE) {
    const sha = commit(env.LINT_LINKS_BASE);
    return sha
      ? { base: sha, source: `LINT_LINKS_BASE=${env.LINT_LINKS_BASE}` }
      : { error: `LINT_LINKS_BASE=${env.LINT_LINKS_BASE} names no commit` };
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const sha = commit('HEAD^1');
    return sha
      ? { base: sha, source: 'HEAD^1' }
      : {
          error:
            'HEAD has no parent in this checkout — check the job out with `fetch-depth: 2`',
        };
  }
  const main = commit('origin/main');
  if (!main) {
    return {
      skip: 'no origin/main to compare with — run `git fetch origin main`, or set LINT_LINKS_BASE',
    };
  }
  const run = git(cwd, ['merge-base', 'HEAD', main]);
  return run.ok
    ? { base: run.stdout.trim(), source: 'the merge base with origin/main' }
    : { skip: 'HEAD shares no history with origin/main' };
}
